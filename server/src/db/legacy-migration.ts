import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { AppDatabase } from "./database.js";
import { asNullableDate, hasMigration, withTransaction } from "./database.js";

const MIGRATION_KEY = "legacy-json-to-mysql-v1";

export interface LegacyMigrationResult {
  migrated: boolean;
  users: number;
  histories: number;
  message: string;
}

export async function migrateLegacyJsonData(
  database: AppDatabase,
  dataDir: string
): Promise<LegacyMigrationResult> {
  if (process.env.MYSQL_MIGRATE_JSON === "false") {
    return { migrated: false, users: 0, histories: 0, message: "MYSQL_MIGRATE_JSON=false，已跳过 JSON 迁移" };
  }
  if (await hasMigration(database.pool, MIGRATION_KEY)) {
    return { migrated: false, users: 0, histories: 0, message: "旧 JSON 数据已经迁移过" };
  }

  const authData = await readJsonObject(path.join(dataDir, "auth.json"));
  const historyData = await readJsonArray(path.join(dataDir, "history.json"));
  const users = Array.isArray(authData?.users) ? authData.users : [];
  const sessions = Array.isArray(authData?.sessions) ? authData.sessions : [];
  const loginRecords = Array.isArray(authData?.loginRecords) ? authData.loginRecords : [];
  const usageRecords = Array.isArray(authData?.usageRecords) ? authData.usageRecords : [];
  const creditTransactions = Array.isArray(authData?.creditTransactions) ? authData.creditTransactions : [];
  const rechargeCards = Array.isArray(authData?.rechargeCards) ? authData.rechargeCards : [];

  const userIds = new Set(
    users
      .map((item) => asRecord(item)?.id)
      .filter((value): value is string => typeof value === "string")
  );
  const cardIds = new Set(
    rechargeCards
      .map((item) => asRecord(item)?.id)
      .filter((value): value is string => typeof value === "string")
  );

  await withTransaction(database.pool, async (connection) => {
    for (const raw of users) await insertUser(connection, raw);
    for (const raw of sessions) await insertSession(connection, raw, userIds);
    for (const raw of loginRecords) await insertLoginRecord(connection, raw, userIds);
    for (const raw of rechargeCards) await insertRechargeCard(connection, raw, userIds);
    for (const raw of creditTransactions) await insertCreditTransaction(connection, raw, userIds, cardIds);
    for (const raw of usageRecords) await insertUsageRecord(connection, raw, userIds);
    for (const raw of historyData) await insertHistoryRecord(connection, raw, userIds);

    await connection.execute(
      `INSERT INTO app_schema_migrations (migration_key, applied_at, details)
       VALUES (?, ?, ?)`,
      [
        MIGRATION_KEY,
        new Date(),
        `users=${users.length}; histories=${historyData.length}; source=${path.resolve(dataDir)}`
      ]
    );
  });

  return {
    migrated: users.length > 0 || historyData.length > 0,
    users: users.length,
    histories: historyData.length,
    message: users.length > 0 || historyData.length > 0
      ? `已将旧 JSON 数据迁移到 MySQL：用户 ${users.length} 个，历史 ${historyData.length} 条`
      : "未发现旧 JSON 数据，已初始化 MySQL"
  };
}

async function insertUser(connection: PoolConnection, value: unknown): Promise<void> {
  const item = asRecord(value);
  if (!item || !isString(item.id) || !isString(item.username) || !isString(item.usernameKey) ||
      !isString(item.passwordSalt) || !isString(item.passwordHash) || !isString(item.createdAt)) return;
  const creditCents = toNonNegativeInteger(item.creditCents) ?? Math.max(0, Math.round(toNumber(item.credits) * 100));
  await connection.execute(
    `INSERT IGNORE INTO app_users
      (id, username, username_key, password_salt, password_hash, role, status, created_at, approved_at, last_login_at, credit_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.username,
      item.usernameKey,
      item.passwordSalt,
      item.passwordHash,
      item.role === "admin" ? "admin" : "user",
      validStatus(item.status),
      asNullableDate(item.createdAt) || new Date(),
      asNullableDate(asString(item.approvedAt)),
      asNullableDate(asString(item.lastLoginAt)),
      creditCents
    ]
  );
}

async function insertSession(connection: PoolConnection, value: unknown, userIds: Set<string>): Promise<void> {
  const item = asRecord(value);
  if (!item || !isString(item.tokenHash) || !isString(item.userId) || !userIds.has(item.userId) ||
      !isString(item.createdAt) || !isString(item.expiresAt)) return;
  const expiresAt = asNullableDate(item.expiresAt);
  if (!expiresAt || expiresAt.getTime() <= Date.now()) return;
  await connection.execute(
    `INSERT IGNORE INTO app_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    [item.tokenHash, item.userId, asNullableDate(item.createdAt) || new Date(), expiresAt]
  );
}

async function insertLoginRecord(connection: PoolConnection, value: unknown, userIds: Set<string>): Promise<void> {
  const item = asRecord(value);
  if (!item || !isString(item.id) || !isString(item.username) || !isString(item.createdAt)) return;
  const userId = isString(item.userId) && userIds.has(item.userId) ? item.userId : null;
  await connection.execute(
    `INSERT IGNORE INTO app_login_records
      (id, user_id, username, success, reason, created_at, client_ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      userId,
      item.username,
      item.success === true ? 1 : 0,
      asString(item.reason),
      asNullableDate(item.createdAt) || new Date(),
      asString(item.clientIp),
      asString(item.userAgent)
    ]
  );
}

async function insertRechargeCard(connection: PoolConnection, value: unknown, userIds: Set<string>): Promise<void> {
  const item = asRecord(value);
  if (!item || !isString(item.id) || !isString(item.codeHash) || !isString(item.codePreview) ||
      !isString(item.createdAt) || !isString(item.createdBy)) return;
  const creditCents = toPositiveInteger(item.creditCents);
  if (!creditCents) return;
  const redeemedUserId = isString(item.redeemedByUserId) && userIds.has(item.redeemedByUserId)
    ? item.redeemedByUserId
    : null;
  await connection.execute(
    `INSERT IGNORE INTO app_recharge_cards
      (id, code_hash, code_preview, credit_cents, created_at, created_by, redeemed_at, redeemed_by_user_id, redeemed_by_username)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.codeHash,
      item.codePreview,
      creditCents,
      asNullableDate(item.createdAt) || new Date(),
      item.createdBy,
      asNullableDate(asString(item.redeemedAt)),
      redeemedUserId,
      asString(item.redeemedByUsername)
    ]
  );
}

async function insertCreditTransaction(
  connection: PoolConnection,
  value: unknown,
  userIds: Set<string>,
  cardIds: Set<string>
): Promise<void> {
  const item = asRecord(value);
  if (!item || !isString(item.id) || !isString(item.userId) || !userIds.has(item.userId) ||
      !isString(item.username) || !isString(item.createdAt) || !validCreditType(item.type)) return;
  const amountCents = toInteger(item.amountCents);
  const balanceAfterCents = toNonNegativeInteger(item.balanceAfterCents);
  if (amountCents === undefined || balanceAfterCents === undefined) return;
  await connection.execute(
    `INSERT IGNORE INTO app_credit_transactions
      (id, user_id, username, created_at, type, amount_cents, balance_after_cents, note, provider, model, reference_id, card_id, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.userId,
      item.username,
      asNullableDate(item.createdAt) || new Date(),
      item.type,
      amountCents,
      balanceAfterCents,
      asString(item.note),
      asString(item.provider),
      asString(item.model),
      asString(item.referenceId),
      isString(item.cardId) && cardIds.has(item.cardId) ? item.cardId : null,
      isString(item.actorUserId) && userIds.has(item.actorUserId) ? item.actorUserId : null
    ]
  );
}

async function insertUsageRecord(connection: PoolConnection, value: unknown, userIds: Set<string>): Promise<void> {
  const item = asRecord(value);
  if (!item || !isString(item.id) || !isString(item.userId) || !userIds.has(item.userId) ||
      !isString(item.username) || !isString(item.createdAt) || !isString(item.provider) ||
      !isString(item.model) || !validOperation(item.operation) || !isString(item.size) || !validUsageStatus(item.status)) return;
  await connection.execute(
    `INSERT IGNORE INTO app_usage_records
      (id, user_id, username, created_at, provider, model, operation, size, prompt, image_count, status,
       duration_ms, cost, request_id, operation_id, points_cost_cents, points_refunded, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.userId,
      item.username,
      asNullableDate(item.createdAt) || new Date(),
      item.provider,
      item.model,
      item.operation,
      item.size,
      asString(item.prompt),
      toNonNegativeInteger(item.imageCount) || 0,
      item.status,
      toNonNegativeInteger(item.durationMs) ?? null,
      finiteOrNull(item.cost),
      asString(item.requestId),
      asString(item.operationId),
      item.pointsCost === undefined ? null : Math.max(0, Math.round(toNumber(item.pointsCost) * 100)),
      item.pointsRefunded === true ? 1 : 0,
      asString(item.error)
    ]
  );
}

async function insertHistoryRecord(connection: PoolConnection, value: unknown, userIds: Set<string>): Promise<void> {
  const item = asRecord(value);
  if (!item || !isString(item.id) || !isString(item.createdAt) || !validProvider(item.provider) ||
      !isString(item.providerName) || !isString(item.model) || !isString(item.prompt) ||
      !validOperation(item.operation) || !isString(item.size) || !Array.isArray(item.images)) return;
  const clientId = asString(item.clientId);
  const ownerUserId = clientId && userIds.has(clientId) ? clientId : null;
  await connection.execute(
    `INSERT IGNORE INTO app_history_records
      (id, owner_user_id, client_id, provider, provider_name, model, prompt, operation, size,
       duration_ms, cost, created_at, client_ip, user_agent, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      item.id,
      ownerUserId,
      clientId,
      item.provider,
      item.providerName,
      item.model,
      item.prompt,
      item.operation,
      item.size,
      toNonNegativeInteger(item.durationMs) ?? null,
      finiteOrNull(item.cost),
      asNullableDate(item.createdAt) || new Date(),
      asString(item.clientIp),
      asString(item.userAgent)
    ]
  );

  for (let index = 0; index < item.images.length; index += 1) {
    const image = asRecord(item.images[index]);
    if (!image || !isString(image.url)) continue;
    const fileName = extractFileName(image.url) || `legacy_${item.id}_${index + 1}.bin`;
    await connection.execute(
      `INSERT IGNORE INTO app_history_images
        (id, history_id, position_index, file_name, image_url, width, height, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        item.id,
        index,
        fileName,
        image.url,
        toPositiveInteger(image.width) ?? null,
        toPositiveInteger(image.height) ?? null,
        asString(image.mimeType),
        asNullableDate(item.createdAt) || new Date()
      ]
    );
  }
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return asRecord(parsed) || undefined;
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw new Error(`读取旧数据失败：${filePath}，${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readJsonArray(filePath: string): Promise<unknown[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw new Error(`读取旧数据失败：${filePath}，${error instanceof Error ? error.message : String(error)}`);
  }
}

function extractFileName(url: string): string | undefined {
  try {
    const raw = new URL(url, "http://localhost").pathname.split("/").pop();
    return raw ? decodeURIComponent(raw).slice(0, 255) : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function asString(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function isString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function toNumber(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function toInteger(value: unknown): number | undefined { const number = Number(value); return Number.isInteger(number) ? number : undefined; }
function toNonNegativeInteger(value: unknown): number | undefined { const number = toInteger(value); return number !== undefined && number >= 0 ? number : undefined; }
function toPositiveInteger(value: unknown): number | undefined { const number = toInteger(value); return number !== undefined && number > 0 ? number : undefined; }
function finiteOrNull(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function validStatus(value: unknown): "pending" | "active" | "disabled" | "rejected" {
  return value === "active" || value === "disabled" || value === "rejected" ? value : "pending";
}
function validCreditType(value: unknown): value is "generation_charge" | "generation_refund" | "card_recharge" | "admin_adjustment" {
  return value === "generation_charge" || value === "generation_refund" || value === "card_recharge" || value === "admin_adjustment";
}
function validUsageStatus(value: unknown): value is "success" | "submitted" | "failed" {
  return value === "success" || value === "submitted" || value === "failed";
}
function validOperation(value: unknown): value is "text-to-image" | "image-edit" {
  return value === "text-to-image" || value === "image-edit";
}
function validProvider(value: unknown): value is "lingke" | "grsai" | "nanobanana" {
  return value === "lingke" || value === "grsai" || value === "nanobanana";
}
function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

import { randomUUID } from "node:crypto";
import type {
  PoolConnection,
  RowDataPacket
} from "mysql2/promise";
import { AuthError } from "../auth.js";
import type { AppDatabase } from "../db/database.js";
import {
  mysqlDateToIso,
  withTransaction
} from "../db/database.js";

export interface StorageSettings {
  enforcementEnabled: boolean;
  baseImageLimit: number;
  baseRetentionDays: number;
  graceDays: number;
  updatedAt: string;
}

export interface StoragePackage {
  id: string;
  name: string;
  description?: string;
  imageLimitBonus: number;
  retentionDaysBonus: number;
  validDays: number;
  pointsCost: number;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface StorageEntitlement {
  id: string;
  packageId?: string;
  packageName: string;
  imageLimitBonus: number;
  retentionDaysBonus: number;
  pointsCost: number;
  purchasedAt: string;
  expiresAt: string;
  inGrace: boolean;
}

export interface StorageAccountSummary {
  settings: StorageSettings;
  packages: StoragePackage[];
  entitlements: StorageEntitlement[];
  currentImageCount: number;
  currentHistoryCount: number;
  effectiveImageLimit: number;
  effectiveRetentionDays: number;
  imageLimitBonus: number;
  retentionDaysBonus: number;
}

export async function readStorageSettings(
  database: AppDatabase
): Promise<StorageSettings> {
  const [rows] = await database.pool.query<RowDataPacket[]>(
    `SELECT *
     FROM app_storage_settings
     WHERE id = 1
     LIMIT 1`
  );
  const row = rows[0];
  if (!row) throw new Error("存储策略配置不存在");
  return mapStorageSettings(row);
}

export async function updateStorageSettings(
  database: AppDatabase,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<StorageSettings> {
  const current = await readStorageSettings(database);

  const enforcementEnabled =
    input.enforcementEnabled === undefined
      ? current.enforcementEnabled
      : input.enforcementEnabled === true;

  const baseImageLimit =
    input.baseImageLimit === undefined
      ? current.baseImageLimit
      : requiredInteger(input.baseImageLimit, 1, 100000, "基础图片数量");

  const baseRetentionDays =
    input.baseRetentionDays === undefined
      ? current.baseRetentionDays
      : requiredInteger(input.baseRetentionDays, 1, 3650, "基础保存天数");

  const graceDays =
    input.graceDays === undefined
      ? current.graceDays
      : requiredInteger(input.graceDays, 0, 90, "到期宽限天数");

  await database.pool.query(
    `UPDATE app_storage_settings
     SET enforcement_enabled = ?,
         base_image_limit = ?,
         base_retention_days = ?,
         grace_days = ?,
         updated_at = UTC_TIMESTAMP(3),
         updated_by_user_id = ?
     WHERE id = 1`,
    [
      enforcementEnabled ? 1 : 0,
      baseImageLimit,
      baseRetentionDays,
      graceDays,
      actorUserId
    ]
  );

  return readStorageSettings(database);
}

export async function listStoragePackages(
  database: AppDatabase,
  includeDisabled = false
): Promise<StoragePackage[]> {
  const [rows] = await database.pool.query<RowDataPacket[]>(
    `SELECT *
     FROM app_storage_packages
     ${includeDisabled ? "" : "WHERE enabled = 1"}
     ORDER BY sort_order ASC, points_cost_cents ASC, created_at ASC`
  );
  return rows.map(mapStoragePackage);
}

export async function createStoragePackage(
  database: AppDatabase,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<StoragePackage> {
  const normalized = normalizePackage(input, false);
  const id = randomUUID();
  const now = new Date();

  await database.pool.query(
    `INSERT INTO app_storage_packages (
       id, name, description,
       image_limit_bonus, retention_days_bonus,
       valid_days, points_cost_cents,
       enabled, sort_order,
       created_at, updated_at, updated_by_user_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      normalized.name!,
      normalized.description ?? null,
      normalized.imageLimitBonus!,
      normalized.retentionDaysBonus!,
      normalized.validDays!,
      normalized.pointsCostCents!,
      normalized.enabled ? 1 : 0,
      normalized.sortOrder!,
      now,
      now,
      actorUserId
    ]
  );

  return requireStoragePackage(database, id);
}

export async function updateStoragePackage(
  database: AppDatabase,
  packageId: string,
  input: Record<string, unknown>,
  actorUserId: string
): Promise<StoragePackage> {
  const current = await requireStoragePackage(database, packageId);
  const normalized = normalizePackage(input, true);
  const fields: string[] = [];
  const values: Array<string | number | null> = [];

  if (normalized.name !== undefined) {
    fields.push("name = ?");
    values.push(normalized.name);
  }
  if (normalized.description !== undefined) {
    fields.push("description = ?");
    values.push(normalized.description);
  }
  if (normalized.imageLimitBonus !== undefined) {
    fields.push("image_limit_bonus = ?");
    values.push(normalized.imageLimitBonus);
  }
  if (normalized.retentionDaysBonus !== undefined) {
    fields.push("retention_days_bonus = ?");
    values.push(normalized.retentionDaysBonus);
  }
  if (normalized.validDays !== undefined) {
    fields.push("valid_days = ?");
    values.push(normalized.validDays);
  }
  if (normalized.pointsCostCents !== undefined) {
    fields.push("points_cost_cents = ?");
    values.push(normalized.pointsCostCents);
  }
  if (normalized.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(normalized.enabled ? 1 : 0);
  }
  if (normalized.sortOrder !== undefined) {
    fields.push("sort_order = ?");
    values.push(normalized.sortOrder);
  }

  const nextImageBonus =
    normalized.imageLimitBonus ?? current.imageLimitBonus;
  const nextRetentionBonus =
    normalized.retentionDaysBonus ?? current.retentionDaysBonus;

  if (nextImageBonus === 0 && nextRetentionBonus === 0) {
    throw new AuthError(
      400,
      "INVALID_STORAGE_PACKAGE",
      "图片数量和保存天数不能同时为 0"
    );
  }

  if (!fields.length) {
    throw new AuthError(
      400,
      "STORAGE_PACKAGE_NO_CHANGES",
      "没有需要保存的存储方案修改"
    );
  }

  fields.push(
    "updated_at = UTC_TIMESTAMP(3)",
    "updated_by_user_id = ?"
  );
  values.push(actorUserId, packageId);

  await database.pool.query(
    `UPDATE app_storage_packages
     SET ${fields.join(", ")}
     WHERE id = ?`,
    values
  );

  return requireStoragePackage(database, packageId);
}

export async function deleteStoragePackage(
  database: AppDatabase,
  packageId: string
): Promise<void> {
  const [result] = await database.pool.query(
    "DELETE FROM app_storage_packages WHERE id = ?",
    [packageId]
  );
  const affected = Number(
    (result as { affectedRows?: number }).affectedRows || 0
  );
  if (affected < 1) {
    throw new AuthError(
      404,
      "STORAGE_PACKAGE_NOT_FOUND",
      "存储方案不存在"
    );
  }
}

export async function getStorageAccountSummary(
  database: AppDatabase,
  userId: string
): Promise<StorageAccountSummary> {
  const settings = await readStorageSettings(database);
  const packages = await listStoragePackages(database, false);
  const now = new Date();
  const graceCutoff = new Date(
    now.getTime() -
      settings.graceDays * 24 * 60 * 60 * 1000
  );

  const [entitlementRows] =
    await database.pool.query<RowDataPacket[]>(
      `SELECT *
       FROM app_storage_entitlements
       WHERE user_id = ? AND expires_at > ?
       ORDER BY expires_at ASC, purchased_at DESC
       LIMIT 200`,
      [userId, graceCutoff]
    );

  const entitlements =
    entitlementRows.map((row) =>
      mapStorageEntitlement(row, now)
    );

  const imageLimitBonus =
    entitlements.reduce(
      (sum, item) => sum + item.imageLimitBonus,
      0
    );

  const retentionDaysBonus =
    entitlements.reduce(
      (sum, item) => sum + item.retentionDaysBonus,
      0
    );

  const [usageRows] =
    await database.pool.query<RowDataPacket[]>(
      `SELECT
         COUNT(DISTINCT h.id) AS histories,
         COUNT(i.id) AS images
       FROM app_history_records h
       LEFT JOIN app_history_images i
         ON i.history_id = h.id
       WHERE h.owner_user_id = ?`,
      [userId]
    );

  return {
    settings,
    packages,
    entitlements,
    currentImageCount:
      Number(usageRows[0]?.images || 0),
    currentHistoryCount:
      Number(usageRows[0]?.histories || 0),
    effectiveImageLimit:
      settings.baseImageLimit + imageLimitBonus,
    effectiveRetentionDays:
      settings.baseRetentionDays + retentionDaysBonus,
    imageLimitBonus,
    retentionDaysBonus
  };
}

export async function redeemStoragePackage(
  database: AppDatabase,
  userId: string,
  packageId: string
): Promise<{
  balance: number;
  entitlement: StorageEntitlement;
  summary: StorageAccountSummary;
}> {
  const settings = await readStorageSettings(database);
  if (!settings.enforcementEnabled) {
    throw new AuthError(
      409,
      "STORAGE_POLICY_DISABLED",
      "站长当前暂停了存储权益兑换"
    );
  }

  const result = await withTransaction(
    database.pool,
    async (connection) => {
      const user =
        await requireActiveUserForUpdate(
          connection,
          userId
        );

      if (String(user.role) === "admin") {
        throw new AuthError(
          400,
          "STORAGE_ADMIN_UNLIMITED",
          "站长账号无需兑换存储权益"
        );
      }

      const [packageRows] =
        await connection.query<RowDataPacket[]>(
          `SELECT *
           FROM app_storage_packages
           WHERE id = ? AND enabled = 1
           LIMIT 1
           FOR UPDATE`,
          [packageId]
        );

      const packageRow = packageRows[0];
      if (!packageRow) {
        throw new AuthError(
          404,
          "STORAGE_PACKAGE_NOT_FOUND",
          "存储方案不存在或已下架"
        );
      }

      const costCents =
        Number(packageRow.points_cost_cents || 0);
      const balanceCents =
        Number(user.credit_cents || 0);

      if (costCents <= 0) {
        throw new AuthError(
          400,
          "INVALID_STORAGE_PACKAGE_PRICE",
          "存储方案积分价格不正确"
        );
      }

      if (balanceCents < costCents) {
        throw new AuthError(
          402,
          "INSUFFICIENT_CREDITS",
          "积分不足，无法兑换该存储方案"
        );
      }

      const entitlementId = randomUUID();
      const transactionId = randomUUID();
      const purchasedAt = new Date();
      const validDays =
        Number(packageRow.valid_days || 0);
      const expiresAt = new Date(
        purchasedAt.getTime() +
          validDays * 24 * 60 * 60 * 1000
      );
      const balanceAfter =
        balanceCents - costCents;

      await connection.query(
        `UPDATE app_users
         SET credit_cents = ?
         WHERE id = ?`,
        [balanceAfter, userId]
      );

      await connection.query(
        `INSERT INTO app_credit_transactions (
           id, user_id, username, created_at,
           type, amount_cents, balance_after_cents,
           note, provider, model, reference_id,
           card_id, actor_user_id
         ) VALUES (
           ?, ?, ?, ?, 'admin_adjustment', ?, ?,
           ?, NULL, NULL, ?, NULL, ?
         )`,
        [
          transactionId,
          userId,
          String(user.username),
          purchasedAt,
          -costCents,
          balanceAfter,
          `存储权益兑换：${String(packageRow.name)}`,
          `storage:${entitlementId}`,
          userId
        ]
      );

      await connection.query(
        `INSERT INTO app_storage_entitlements (
           id, user_id, package_id, package_name,
           image_limit_bonus, retention_days_bonus,
           points_cost_cents, purchased_at,
           expires_at, credit_transaction_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entitlementId,
          userId,
          String(packageRow.id),
          String(packageRow.name),
          Number(packageRow.image_limit_bonus || 0),
          Number(packageRow.retention_days_bonus || 0),
          costCents,
          purchasedAt,
          expiresAt,
          transactionId
        ]
      );

      return {
        balance:
          centsToPoints(balanceAfter),
        entitlementId
      };
    }
  );

  const summary =
    await getStorageAccountSummary(
      database,
      userId
    );

  const entitlement =
    summary.entitlements.find(
      (item) =>
        item.id === result.entitlementId
    );

  if (!entitlement) {
    throw new Error(
      "存储权益已兑换，但读取权益结果失败"
    );
  }

  return {
    balance: result.balance,
    entitlement,
    summary
  };
}

async function requireStoragePackage(
  database: AppDatabase,
  packageId: string
): Promise<StoragePackage> {
  const [rows] =
    await database.pool.query<RowDataPacket[]>(
      `SELECT *
       FROM app_storage_packages
       WHERE id = ?
       LIMIT 1`,
      [packageId]
    );

  if (!rows[0]) {
    throw new AuthError(
      404,
      "STORAGE_PACKAGE_NOT_FOUND",
      "存储方案不存在"
    );
  }

  return mapStoragePackage(rows[0]);
}

async function requireActiveUserForUpdate(
  connection: PoolConnection,
  userId: string
): Promise<RowDataPacket> {
  const [rows] =
    await connection.query<RowDataPacket[]>(
      `SELECT
         id, username, role,
         status, credit_cents
       FROM app_users
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [userId]
    );

  const row = rows[0];
  if (!row || row.status !== "active") {
    throw new AuthError(
      403,
      "ACCOUNT_NOT_ACTIVE",
      "账号当前不可用"
    );
  }

  return row;
}

function normalizePackage(
  input: Record<string, unknown>,
  partial: boolean
): {
  name?: string;
  description?: string | null;
  imageLimitBonus?: number;
  retentionDaysBonus?: number;
  validDays?: number;
  pointsCostCents?: number;
  enabled?: boolean;
  sortOrder?: number;
} {
  const output: {
    name?: string;
    description?: string | null;
    imageLimitBonus?: number;
    retentionDaysBonus?: number;
    validDays?: number;
    pointsCostCents?: number;
    enabled?: boolean;
    sortOrder?: number;
  } = {};

  if (!partial || input.name !== undefined) {
    output.name =
      requiredText(input.name, 60, "方案名称");
  }

  if (!partial || input.description !== undefined) {
    output.description =
      optionalText(input.description, 300) || null;
  }

  if (!partial || input.imageLimitBonus !== undefined) {
    output.imageLimitBonus =
      requiredInteger(
        input.imageLimitBonus ?? 0,
        0,
        100000,
        "增加图片数量"
      );
  }

  if (!partial || input.retentionDaysBonus !== undefined) {
    output.retentionDaysBonus =
      requiredInteger(
        input.retentionDaysBonus ?? 0,
        0,
        3650,
        "增加保存天数"
      );
  }

  if (!partial || input.validDays !== undefined) {
    output.validDays =
      requiredInteger(
        input.validDays,
        1,
        3650,
        "权益有效天数"
      );
  }

  if (!partial || input.pointsCost !== undefined) {
    const points =
      requiredNumber(
        input.pointsCost,
        0.01,
        1000000,
        "兑换积分"
      );

    output.pointsCostCents =
      Math.round(points * 100);
  }

  if (!partial || input.enabled !== undefined) {
    output.enabled =
      input.enabled !== false;
  }

  if (!partial || input.sortOrder !== undefined) {
    output.sortOrder =
      requiredInteger(
        input.sortOrder ?? 0,
        0,
        9999,
        "排序"
      );
  }

  if (
    !partial &&
    !output.imageLimitBonus &&
    !output.retentionDaysBonus
  ) {
    throw new AuthError(
      400,
      "INVALID_STORAGE_PACKAGE",
      "图片数量和保存天数至少需要增加一项"
    );
  }

  return output;
}

function mapStorageSettings(
  row: RowDataPacket
): StorageSettings {
  return {
    enforcementEnabled:
      Boolean(row.enforcement_enabled),
    baseImageLimit:
      Number(row.base_image_limit || 20),
    baseRetentionDays:
      Number(row.base_retention_days || 7),
    graceDays:
      Number(row.grace_days || 0),
    updatedAt:
      mysqlDateToIso(row.updated_at) ||
      new Date().toISOString()
  };
}

function mapStoragePackage(
  row: RowDataPacket
): StoragePackage {
  return {
    id: String(row.id),
    name: String(row.name),
    description:
      row.description
        ? String(row.description)
        : undefined,
    imageLimitBonus:
      Number(row.image_limit_bonus || 0),
    retentionDaysBonus:
      Number(row.retention_days_bonus || 0),
    validDays:
      Number(row.valid_days || 0),
    pointsCost:
      centsToPoints(
        Number(row.points_cost_cents || 0)
      ),
    enabled: Boolean(row.enabled),
    sortOrder:
      Number(row.sort_order || 0),
    createdAt:
      mysqlDateToIso(row.created_at) ||
      new Date().toISOString(),
    updatedAt:
      mysqlDateToIso(row.updated_at) ||
      new Date().toISOString()
  };
}

function mapStorageEntitlement(
  row: RowDataPacket,
  now: Date
): StorageEntitlement {
  const expiresAt =
    mysqlDateToIso(row.expires_at) ||
    new Date().toISOString();

  return {
    id: String(row.id),
    packageId:
      row.package_id
        ? String(row.package_id)
        : undefined,
    packageName:
      String(row.package_name),
    imageLimitBonus:
      Number(row.image_limit_bonus || 0),
    retentionDaysBonus:
      Number(row.retention_days_bonus || 0),
    pointsCost:
      centsToPoints(
        Number(row.points_cost_cents || 0)
      ),
    purchasedAt:
      mysqlDateToIso(row.purchased_at) ||
      new Date().toISOString(),
    expiresAt,
    inGrace:
      new Date(expiresAt).getTime() <=
      now.getTime()
  };
}

function requiredText(
  value: unknown,
  max: number,
  label: string
): string {
  const text =
    typeof value === "string"
      ? value.trim()
      : "";

  if (!text) {
    throw new AuthError(
      400,
      "INVALID_STORAGE_VALUE",
      `请填写${label}`
    );
  }

  if (
    text.length > max ||
    /[\u0000-\u001F\u007F]/u.test(text)
  ) {
    throw new AuthError(
      400,
      "INVALID_STORAGE_VALUE",
      `${label}不能超过 ${max} 个字符且不能包含控制字符`
    );
  }

  return text;
}

function optionalText(
  value: unknown,
  max: number
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const text = value.trim();
  return text
    ? text.slice(0, max)
    : undefined;
}

function requiredInteger(
  value: unknown,
  min: number,
  max: number,
  label: string
): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isInteger(numeric) ||
    numeric < min ||
    numeric > max
  ) {
    throw new AuthError(
      400,
      "INVALID_STORAGE_VALUE",
      `${label}需为 ${min}–${max} 的整数`
    );
  }

  return numeric;
}

function requiredNumber(
  value: unknown,
  min: number,
  max: number,
  label: string
): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isFinite(numeric) ||
    numeric < min ||
    numeric > max
  ) {
    throw new AuthError(
      400,
      "INVALID_STORAGE_VALUE",
      `${label}需为 ${min}–${max} 的数字`
    );
  }

  return numeric;
}

function centsToPoints(
  cents: number
): number {
  return Number(
    (cents / 100).toFixed(2)
  );
}

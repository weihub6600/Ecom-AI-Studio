import { randomBytes, randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { AppDatabase } from "./db/database.js";
import { mysqlDateToIso, withTransaction } from "./db/database.js";
import {
  AuthError,
  type AdminUserSummary,
  type AuthAuditContext,
  type CreditTransaction,
  type CreditTransactionType,
  type GeneratedRechargeCard,
  type GenerationReservation,
  type GenerationSettlement,
  type LoginRecord,
  type PublicUser,
  type RechargeCardSummary,
  type UsageRecord,
  type UsageRecordInput,
  type UserRole,
  type UserStatus
} from "./auth/contracts.js";
import {
  DEFAULT_SESSION_TTL_SECONDS,
  assertCreditBalance,
  centsToPoints,
  clampLimit,
  createRechargeCode,
  createSessionToken,
  derivePassword,
  emptySettlement,
  hashRechargeCode,
  hashToken,
  isDuplicateEntry,
  loginStatusError,
  maskRechargeCode,
  normalizeAuditText,
  normalizeCardQuantity,
  normalizeOptionalUsername,
  normalizePassword,
  normalizePositivePointsToCents,
  normalizeRechargeCode,
  normalizeSignedPointsToCents,
  normalizeTrustedPointsToCents,
  normalizeUnknownText,
  normalizeUsername,
  normalizeUserStatus,
  nullableNonNegativeNumber,
  nullableString,
  optionalNonNegativeInteger,
  optionalNonNegativeNumber,
  positiveIntegerOrDefault,
  verifyPassword
} from "./auth/helpers.js";

export * from "./auth/contracts.js";
export { AUTH_COOKIE_NAME, createClearSessionCookie, createSessionCookie, readAuthToken } from "./auth/cookies.js";

interface AuthServiceOptions {
  database: AppDatabase;
  sessionTtlSeconds?: number;
  adminUsername?: string;
}

interface UserRow extends RowDataPacket {
  id: string;
  username: string;
  username_key: string;
  password_salt: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  approved_at: string | null;
  last_login_at: string | null;
  credit_cents: number;
}

export function createAuthService(options: AuthServiceOptions) {
  const { pool } = options.database;
  const sessionTtlSeconds = positiveIntegerOrDefault(options.sessionTtlSeconds, DEFAULT_SESSION_TTL_SECONDS);
  const configuredAdminUsername = normalizeOptionalUsername(options.adminUsername);
  const configuredAdminKey = configuredAdminUsername?.toLocaleLowerCase("zh-CN");

  async function initialize(): Promise<void> {
    await pool.execute("DELETE FROM app_sessions WHERE expires_at <= ?", [new Date()]);
    if (!configuredAdminKey) return;

    await withTransaction(pool, async (connection) => {
      const [adminRows] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM app_users WHERE role = 'admin' LIMIT 1 FOR UPDATE"
      );
      if (adminRows.length > 0) return;
      await connection.execute(
        `UPDATE app_users
         SET role = 'admin', status = 'active', approved_at = COALESCE(approved_at, ?)
         WHERE username_key = ?`,
        [new Date(), configuredAdminKey]
      );
    });
  }

  async function register(
    usernameInput: unknown,
    passwordInput: unknown
  ): Promise<{ user: PublicUser; pending: boolean; token?: string }> {
    const username = normalizeUsername(usernameInput);
    const password = normalizePassword(passwordInput);
    const usernameKey = username.toLocaleLowerCase("zh-CN");
    const passwordSalt = randomBytes(16).toString("base64");
    const passwordHash = (await derivePassword(password, passwordSalt)).toString("base64");

    return withTransaction(pool, async (connection) => {
      const [existing] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM app_users WHERE username_key = ? LIMIT 1 FOR UPDATE",
        [usernameKey]
      );
      if (existing.length > 0) throw new AuthError(409, "USERNAME_EXISTS", "该用户名已经注册");

      const [adminRows] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM app_users WHERE role = 'admin' LIMIT 1 FOR UPDATE"
      );
      const isFirstConfiguredAdmin = Boolean(configuredAdminKey && usernameKey === configuredAdminKey && adminRows.length === 0);
      const createdAt = new Date();
      const userId = randomUUID();
      const role: UserRole = isFirstConfiguredAdmin ? "admin" : "user";
      const status: UserStatus = isFirstConfiguredAdmin ? "active" : "pending";

      await connection.execute(
        `INSERT INTO app_users
          (id, username, username_key, password_salt, password_hash, role, status, created_at, approved_at, last_login_at, credit_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          userId,
          username,
          usernameKey,
          passwordSalt,
          passwordHash,
          role,
          status,
          createdAt,
          isFirstConfiguredAdmin ? createdAt : null,
          isFirstConfiguredAdmin ? createdAt : null
        ]
      );

      const user = await requireUser(connection, userId);
      if (!isFirstConfiguredAdmin) return { user: toPublicUser(user), pending: true };

      const { token, tokenHash, expiresAt } = createSessionToken(sessionTtlSeconds);
      await connection.execute(
        "INSERT INTO app_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        [tokenHash, userId, createdAt, expiresAt]
      );
      await insertLoginRecord(connection, {
        userId,
        username,
        success: true,
        reason: "站长账号首次注册",
        createdAt
      });
      return { user: toPublicUser(user), pending: false, token };
    });
  }

  async function login(
    usernameInput: unknown,
    passwordInput: unknown,
    context: AuthAuditContext = {}
  ): Promise<{ user: PublicUser; token: string }> {
    const username = normalizeUsername(usernameInput);
    const password = normalizePassword(passwordInput);
    const usernameKey = username.toLocaleLowerCase("zh-CN");
    const [rows] = await pool.query<UserRow[]>("SELECT * FROM app_users WHERE username_key = ? LIMIT 1", [usernameKey]);
    const user = rows[0];
    const passwordValid = user ? await verifyPassword(password, user.password_salt, user.password_hash) : false;
    const createdAt = new Date();

    if (!user || !passwordValid) {
      await insertLoginRecord(pool, {
        userId: user?.id,
        username: user?.username || username,
        success: false,
        reason: "用户名或密码不正确",
        createdAt,
        clientIp: normalizeAuditText(context.clientIp, 120),
        userAgent: normalizeAuditText(context.userAgent, 600)
      });
      throw new AuthError(401, "INVALID_CREDENTIALS", "用户名或密码不正确");
    }

    const statusError = loginStatusError(user.status);
    if (statusError) {
      await insertLoginRecord(pool, {
        userId: user.id,
        username: user.username,
        success: false,
        reason: statusError.message,
        createdAt,
        clientIp: normalizeAuditText(context.clientIp, 120),
        userAgent: normalizeAuditText(context.userAgent, 600)
      });
      throw statusError;
    }

    return withTransaction(pool, async (connection) => {
      await connection.execute("DELETE FROM app_sessions WHERE expires_at <= ?", [createdAt]);
      const { token, tokenHash, expiresAt } = createSessionToken(sessionTtlSeconds);
      await connection.execute(
        "INSERT INTO app_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        [tokenHash, user.id, createdAt, expiresAt]
      );
      await connection.execute("UPDATE app_users SET last_login_at = ? WHERE id = ?", [createdAt, user.id]);
      await insertLoginRecord(connection, {
        userId: user.id,
        username: user.username,
        success: true,
        reason: "登录成功",
        createdAt,
        clientIp: normalizeAuditText(context.clientIp, 120),
        userAgent: normalizeAuditText(context.userAgent, 600)
      });
      const updated = await requireUser(connection, user.id);
      return { user: toPublicUser(updated), token };
    });
  }

  async function getUserByToken(token: string | undefined): Promise<PublicUser | undefined> {
    if (!token) return undefined;
    const [rows] = await pool.query<UserRow[]>(
      `SELECT u.*
       FROM app_sessions s
       INNER JOIN app_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'
       LIMIT 1`,
      [hashToken(token), new Date()]
    );
    return rows[0] ? toPublicUser(rows[0]) : undefined;
  }

  async function logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await pool.execute("DELETE FROM app_sessions WHERE token_hash = ?", [hashToken(token)]);
  }

  async function listUsers(): Promise<AdminUserSummary[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.*,
         (SELECT COUNT(*) FROM app_login_records l WHERE l.user_id = u.id) AS login_count,
         (SELECT COUNT(*) FROM app_usage_records g WHERE g.user_id = u.id) AS usage_count,
         (SELECT l2.client_ip FROM app_login_records l2
          WHERE l2.user_id = u.id AND l2.success = 1
          ORDER BY l2.created_at DESC LIMIT 1) AS last_login_ip
       FROM app_users u
       ORDER BY u.created_at DESC`
    );
    return rows.map((row) => ({
      ...toPublicUser(row as UserRow),
      loginCount: Number(row.login_count || 0),
      usageCount: Number(row.usage_count || 0),
      lastLoginIp: nullableString(row.last_login_ip)
    }));
  }

  async function listLoginRecords(userId: string, limit = 100): Promise<LoginRecord[]> {
    await ensureUser(pool, userId);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM app_login_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, clampLimit(limit)]
    );
    return rows.map(toLoginRecord);
  }

  async function listUsageRecords(userId: string, limit = 100): Promise<UsageRecord[]> {
    await ensureUser(pool, userId);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM app_usage_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, clampLimit(limit)]
    );
    return rows.map(toUsageRecord);
  }

  async function getUsageRecordByRequestId(userId: string, requestId: string): Promise<UsageRecord | undefined> {
    await ensureUser(pool, userId);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM app_usage_records WHERE user_id = ? AND request_id = ? ORDER BY created_at DESC LIMIT 1`,
      [userId, requestId]
    );
    return rows[0] ? toUsageRecord(rows[0]) : undefined;
  }

  async function listPendingUsageRecords(limit = 50): Promise<UsageRecord[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM app_usage_records
       WHERE status = 'submitted' AND request_id IS NOT NULL
       ORDER BY created_at ASC LIMIT ?`,
      [clampLimit(limit)]
    );
    return rows.map(toUsageRecord);
  }

  async function listCreditTransactions(userId: string, limit = 200): Promise<CreditTransaction[]> {
    await ensureUser(pool, userId);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM app_credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, clampLimit(limit)]
    );
    return rows.map(toCreditTransaction);
  }

  async function updateUser(
    userId: string,
    changes: { username?: unknown; status?: unknown },
    actorUserId: string
  ): Promise<PublicUser> {
    return withTransaction(pool, async (connection) => {
      await requireAdmin(connection, actorUserId);
      const user = await requireUser(connection, userId, true);

      if (changes.username !== undefined) {
        const username = normalizeUsername(changes.username);
        const usernameKey = username.toLocaleLowerCase("zh-CN");
        const [existing] = await connection.query<RowDataPacket[]>(
          "SELECT id FROM app_users WHERE username_key = ? AND id <> ? LIMIT 1 FOR UPDATE",
          [usernameKey, userId]
        );
        if (existing.length > 0) throw new AuthError(409, "USERNAME_EXISTS", "该用户名已经被其他账号使用");
        await connection.execute("UPDATE app_users SET username = ?, username_key = ? WHERE id = ?", [username, usernameKey, userId]);
        await connection.execute("UPDATE app_login_records SET username = ? WHERE user_id = ?", [username, userId]);
        await connection.execute("UPDATE app_usage_records SET username = ? WHERE user_id = ?", [username, userId]);
        await connection.execute("UPDATE app_credit_transactions SET username = ? WHERE user_id = ?", [username, userId]);
        await connection.execute("UPDATE app_recharge_cards SET redeemed_by_username = ? WHERE redeemed_by_user_id = ?", [username, userId]);
      }

      if (changes.status !== undefined) {
        const status = normalizeUserStatus(changes.status);
        if (user.role === "admin" && status !== "active") {
          throw new AuthError(400, "ADMIN_STATUS_LOCKED", "不能封禁或拒绝站长账号");
        }
        if (user.id === actorUserId && status !== "active") {
          throw new AuthError(400, "SELF_STATUS_LOCKED", "不能封禁当前登录的站长账号");
        }
        await connection.execute(
          "UPDATE app_users SET status = ?, approved_at = CASE WHEN ? = 'active' THEN COALESCE(approved_at, ?) ELSE approved_at END WHERE id = ?",
          [status, status, new Date(), userId]
        );
        if (status !== "active") await connection.execute("DELETE FROM app_sessions WHERE user_id = ?", [userId]);
      }

      return toPublicUser(await requireUser(connection, userId));
    });
  }

  async function forceLogout(userId: string, actorUserId: string): Promise<void> {
    await withTransaction(pool, async (connection) => {
      await requireAdmin(connection, actorUserId);
      await requireUser(connection, userId, true);
      if (userId === actorUserId) throw new AuthError(400, "SELF_LOGOUT_BLOCKED", "不能从后台强制退出当前站长账号");
      await connection.execute("DELETE FROM app_sessions WHERE user_id = ?", [userId]);
    });
  }

  async function adjustCredits(
    userId: string,
    amountInput: unknown,
    noteInput: unknown,
    actorUserId: string
  ): Promise<{ user: PublicUser; transaction: CreditTransaction }> {
    const amountCents = normalizeSignedPointsToCents(amountInput);
    const note = normalizeUnknownText(noteInput, 300) || "站长后台调整积分";

    return withTransaction(pool, async (connection) => {
      await requireAdmin(connection, actorUserId);
      const user = await requireUser(connection, userId, true);
      const nextBalance = Number(user.credit_cents) + amountCents;
      assertCreditBalance(nextBalance, "扣减后积分不能低于 0");
      await connection.execute("UPDATE app_users SET credit_cents = ? WHERE id = ?", [nextBalance, userId]);
      const stored = await insertCreditTransaction(connection, {
        userId,
        username: user.username,
        type: "admin_adjustment",
        amountCents,
        balanceAfterCents: nextBalance,
        note,
        actorUserId
      });
      return { user: toPublicUser({ ...user, credit_cents: nextBalance }), transaction: stored };
    });
  }

  async function generateRechargeCards(
    amountInput: unknown,
    quantityInput: unknown,
    actorUserId: string
  ): Promise<GeneratedRechargeCard[]> {
    const creditCents = normalizePositivePointsToCents(amountInput);
    const quantity = normalizeCardQuantity(quantityInput);

    return withTransaction(pool, async (connection) => {
      const actor = await requireAdmin(connection, actorUserId);
      const output: GeneratedRechargeCard[] = [];
      const createdAt = new Date();

      for (let index = 0; index < quantity; index += 1) {
        let inserted: GeneratedRechargeCard | undefined;
        for (let attempt = 0; attempt < 20 && !inserted; attempt += 1) {
          const code = createRechargeCode();
          const id = randomUUID();
          try {
            await connection.execute(
              `INSERT INTO app_recharge_cards
                (id, code_hash, code_preview, credit_cents, created_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [id, hashRechargeCode(code), maskRechargeCode(code), creditCents, createdAt, actor.username]
            );
            inserted = {
              id,
              code,
              codePreview: maskRechargeCode(code),
              points: centsToPoints(creditCents),
              createdAt: createdAt.toISOString(),
              createdBy: actor.username,
              status: "unused"
            };
          } catch (error) {
            if (!isDuplicateEntry(error)) throw error;
          }
        }
        if (!inserted) throw new Error("生成唯一卡密失败，请重试");
        output.push(inserted);
      }
      return output;
    });
  }

  async function listRechargeCards(limit = 200): Promise<RechargeCardSummary[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM app_recharge_cards ORDER BY created_at DESC LIMIT ?",
      [clampLimit(limit)]
    );
    return rows.map(toRechargeCardSummary);
  }

  async function deleteUnusedRechargeCard(cardId: string, actorUserId: string): Promise<void> {
    if (!cardId) throw new AuthError(400, "INVALID_CARD_ID", "缺少卡密 ID");
    await withTransaction(pool, async (connection) => {
      await requireAdmin(connection, actorUserId);
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT id, redeemed_at FROM app_recharge_cards WHERE id = ? LIMIT 1 FOR UPDATE",
        [cardId]
      );
      const card = rows[0];
      if (!card) throw new AuthError(404, "CARD_NOT_FOUND", "卡密不存在");
      if (card.redeemed_at) throw new AuthError(409, "CARD_ALREADY_REDEEMED", "已使用的卡密不能删除");
      await connection.execute("DELETE FROM app_recharge_cards WHERE id = ?", [cardId]);
    });
  }

  async function redeemRechargeCard(userId: string, codeInput: unknown): Promise<{ user: PublicUser; transaction: CreditTransaction }> {
    const codeHash = hashRechargeCode(normalizeRechargeCode(codeInput));
    return withTransaction(pool, async (connection) => {
      const user = await requireUser(connection, userId, true);
      if (user.status !== "active") throw loginStatusError(user.status) || new AuthError(403, "ACCOUNT_INACTIVE", "账号不可用");
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT * FROM app_recharge_cards WHERE code_hash = ? LIMIT 1 FOR UPDATE",
        [codeHash]
      );
      const card = rows[0];
      if (!card) throw new AuthError(404, "CARD_NOT_FOUND", "卡密不存在或输入错误");
      if (card.redeemed_at) throw new AuthError(409, "CARD_ALREADY_REDEEMED", "该卡密已经被使用");
      const creditCents = Number(card.credit_cents);
      const nextBalance = Number(user.credit_cents) + creditCents;
      assertCreditBalance(nextBalance, "充值后积分余额超过系统上限");

      const redeemedAt = new Date();
      await connection.execute("UPDATE app_users SET credit_cents = ? WHERE id = ?", [nextBalance, userId]);
      await connection.execute(
        `UPDATE app_recharge_cards
         SET redeemed_at = ?, redeemed_by_user_id = ?, redeemed_by_username = ?
         WHERE id = ?`,
        [redeemedAt, user.id, user.username, card.id]
      );
      const transaction = await insertCreditTransaction(connection, {
        userId,
        username: user.username,
        type: "card_recharge",
        amountCents: creditCents,
        balanceAfterCents: nextBalance,
        note: `卡密充值 ${centsToPoints(creditCents)} 积分`,
        cardId: String(card.id)
      });
      return { user: toPublicUser({ ...user, credit_cents: nextBalance }), transaction };
    });
  }

  async function reserveGenerationCredits(
    userId: string,
    pointsCostInput: number,
    provider: string,
    model: string
  ): Promise<GenerationReservation> {
    const costCents = normalizeTrustedPointsToCents(pointsCostInput);
    return withTransaction(pool, async (connection) => {
      const user = await requireUser(connection, userId, true);
      if (user.status !== "active") throw loginStatusError(user.status) || new AuthError(403, "ACCOUNT_INACTIVE", "账号不可用");
      const operationId = randomUUID();
      if (user.role === "admin" || costCents === 0) {
        return { operationId, pointsCost: 0, balance: centsToPoints(Number(user.credit_cents)) };
      }
      if (Number(user.credit_cents) < costCents) {
        throw new AuthError(
          402,
          "INSUFFICIENT_CREDITS",
          `积分不足：本次需要 ${centsToPoints(costCents)} 积分，当前剩余 ${centsToPoints(Number(user.credit_cents))} 积分`
        );
      }
      const nextBalance = Number(user.credit_cents) - costCents;
      await connection.execute("UPDATE app_users SET credit_cents = ? WHERE id = ?", [nextBalance, userId]);
      await insertCreditTransaction(connection, {
        userId,
        username: user.username,
        type: "generation_charge",
        amountCents: -costCents,
        balanceAfterCents: nextBalance,
        note: `${provider} · ${model} AI 生图`,
        provider,
        model,
        referenceId: operationId
      });
      return { operationId, pointsCost: centsToPoints(costCents), balance: centsToPoints(nextBalance) };
    });
  }

  async function refundGenerationCredits(
    userId: string,
    operationId: string,
    reason: string
  ): Promise<{ balance: number; refunded: boolean }> {
    const settlement = await settleGenerationCredits(userId, operationId, 0, reason);
    return { balance: settlement.balance, refunded: settlement.refunded };
  }

  async function settleGenerationCredits(
    userId: string,
    operationId: string,
    actualPointsCostInput: number,
    reason: string
  ): Promise<GenerationSettlement> {
    const targetCostCents = normalizeTrustedPointsToCents(actualPointsCostInput);
    return withTransaction(pool, async (connection) => {
      const user = await requireUser(connection, userId, true);
      return settleGenerationInTransaction(connection, user, operationId, targetCostCents, reason);
    });
  }

  async function recordUsage(input: UsageRecordInput): Promise<void> {
    const [users] = await pool.query<RowDataPacket[]>("SELECT username FROM app_users WHERE id = ? LIMIT 1", [input.userId]);
    const user = users[0];
    if (!user) return;
    await pool.execute(
      `INSERT INTO app_usage_records
        (id, user_id, username, created_at, provider, model, operation, size, prompt, image_count, status,
         duration_ms, cost, request_id, operation_id, points_cost_cents, points_refunded, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.userId,
        String(user.username),
        new Date(),
        normalizeAuditText(input.provider, 80) || "unknown",
        normalizeAuditText(input.model, 160) || "unknown",
        input.operation,
        normalizeAuditText(input.size, 80) || "auto",
        normalizeAuditText(input.prompt, 5000) ?? null,
        Math.max(0, Math.trunc(input.imageCount) || 0),
        input.status,
        optionalNonNegativeInteger(input.durationMs),
        optionalNonNegativeNumber(input.cost),
        normalizeAuditText(input.requestId, 200) ?? null,
        normalizeAuditText(input.operationId, 200) ?? null,
        typeof input.pointsCost === "number" ? normalizeTrustedPointsToCents(input.pointsCost) : null,
        input.pointsRefunded === true ? 1 : 0,
        normalizeAuditText(input.error, 800) ?? null
      ]
    );
  }

  async function finalizeAsyncUsage(
    userId: string,
    requestId: string,
    update: {
      status: "success" | "failed";
      imageCount?: number;
      actualPointsCost?: number;
      durationMs?: number;
      cost?: number;
      error?: string;
    }
  ): Promise<GenerationSettlement> {
    return withTransaction(pool, async (connection) => {
      const user = await requireUser(connection, userId, true);
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT * FROM app_usage_records
         WHERE user_id = ? AND request_id = ?
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [userId, requestId]
      );
      const record = rows[0];
      if (!record) return emptySettlement(Number(user.credit_cents));

      const operationId = nullableString(record.operation_id);
      let settlement = emptySettlement(Number(user.credit_cents), Number(record.points_cost_cents || 0));
      if (operationId) {
        const targetCostCents = update.status === "failed"
          ? 0
          : normalizeTrustedPointsToCents(update.actualPointsCost ?? centsToPoints(Number(record.points_cost_cents || 0)));
        settlement = await settleGenerationInTransaction(
          connection,
          user,
          operationId,
          targetCostCents,
          update.status === "failed" ? update.error || "异步生成任务失败" : "按实际成功生成图片数量结算"
        );
      }

      await connection.execute(
        `UPDATE app_usage_records SET
           status = ?,
           image_count = COALESCE(?, image_count),
           duration_ms = COALESCE(?, duration_ms),
           cost = COALESCE(?, cost),
           error = ?,
           points_cost_cents = ?,
           points_refunded = CASE WHEN ? > 0 THEN 1 ELSE points_refunded END
         WHERE id = ?`,
        [
          update.status,
          typeof update.imageCount === "number" ? Math.max(0, Math.trunc(update.imageCount)) : null,
          optionalNonNegativeInteger(update.durationMs),
          optionalNonNegativeNumber(update.cost),
          normalizeAuditText(update.error, 800) ?? null,
          Math.round(settlement.pointsCost * 100),
          Math.round(settlement.refundAmount * 100),
          String(record.id)
        ]
      );
      return settlement;
    });
  }

  return {
    authFile: options.database.storageLabel,
    sessionTtlSeconds,
    initialize,
    register,
    login,
    logout,
    getUserByToken,
    listUsers,
    listLoginRecords,
    listUsageRecords,
    getUsageRecordByRequestId,
    listPendingUsageRecords,
    listCreditTransactions,
    updateUser,
    forceLogout,
    adjustCredits,
    generateRechargeCards,
    listRechargeCards,
    deleteUnusedRechargeCard,
    redeemRechargeCard,
    reserveGenerationCredits,
    refundGenerationCredits,
    settleGenerationCredits,
    recordUsage,
    finalizeAsyncUsage
  };
}

async function settleGenerationInTransaction(
  connection: PoolConnection,
  user: UserRow,
  operationId: string,
  targetCostCents: number,
  reason: string
): Promise<GenerationSettlement> {
  const [charges] = await connection.query<RowDataPacket[]>(
    `SELECT * FROM app_credit_transactions
     WHERE user_id = ? AND type = 'generation_charge' AND reference_id = ?
     LIMIT 1 FOR UPDATE`,
    [user.id, operationId]
  );
  const charge = charges[0];
  if (!charge) return emptySettlement(Number(user.credit_cents));

  const chargedCents = Math.abs(Number(charge.amount_cents || 0));
  const [refunds] = await connection.query<RowDataPacket[]>(
    `SELECT * FROM app_credit_transactions
     WHERE user_id = ? AND type = 'generation_refund' AND reference_id = ?
     LIMIT 1 FOR UPDATE`,
    [user.id, operationId]
  );
  const existingRefund = refunds[0];
  if (existingRefund) {
    const refundCents = Math.max(0, Number(existingRefund.amount_cents || 0));
    return {
      balance: centsToPoints(Number(user.credit_cents)),
      pointsCost: centsToPoints(Math.max(0, chargedCents - refundCents)),
      refunded: refundCents > 0,
      refundAmount: centsToPoints(refundCents)
    };
  }

  const finalCostCents = Math.min(chargedCents, Math.max(0, targetCostCents));
  const refundCents = chargedCents - finalCostCents;
  let balance = Number(user.credit_cents);
  if (refundCents > 0) {
    balance += refundCents;
    assertCreditBalance(balance, "退款后积分余额超过系统上限");
    await connection.execute("UPDATE app_users SET credit_cents = ? WHERE id = ?", [balance, user.id]);
    await insertCreditTransaction(connection, {
      userId: user.id,
      username: user.username,
      type: "generation_refund",
      amountCents: refundCents,
      balanceAfterCents: balance,
      note: normalizeUnknownText(reason, 300) || "AI 生图退款",
      provider: nullableString(charge.provider),
      model: nullableString(charge.model),
      referenceId: operationId
    });
  }
  await connection.execute(
    `UPDATE app_usage_records
     SET points_cost_cents = ?, points_refunded = CASE WHEN ? > 0 THEN 1 ELSE points_refunded END
     WHERE user_id = ? AND operation_id = ?`,
    [finalCostCents, refundCents, user.id, operationId]
  );
  return {
    balance: centsToPoints(balance),
    pointsCost: centsToPoints(finalCostCents),
    refunded: refundCents > 0,
    refundAmount: centsToPoints(refundCents)
  };
}

async function insertLoginRecord(
  executor: PoolConnection | AppDatabase["pool"],
  input: {
    userId?: string;
    username: string;
    success: boolean;
    reason?: string;
    createdAt: Date;
    clientIp?: string;
    userAgent?: string;
  }
): Promise<void> {
  await executor.execute(
    `INSERT INTO app_login_records
      (id, user_id, username, success, reason, created_at, client_ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.userId || null,
      input.username,
      input.success ? 1 : 0,
      input.reason || null,
      input.createdAt,
      input.clientIp || null,
      input.userAgent || null
    ]
  );
}

async function insertCreditTransaction(
  connection: PoolConnection,
  input: {
    userId: string;
    username: string;
    type: CreditTransactionType;
    amountCents: number;
    balanceAfterCents: number;
    note?: string;
    provider?: string;
    model?: string;
    referenceId?: string;
    cardId?: string;
    actorUserId?: string;
  }
): Promise<CreditTransaction> {
  const id = randomUUID();
  const createdAt = new Date();
  await connection.execute(
    `INSERT INTO app_credit_transactions
      (id, user_id, username, created_at, type, amount_cents, balance_after_cents,
       note, provider, model, reference_id, card_id, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.username,
      createdAt,
      input.type,
      input.amountCents,
      input.balanceAfterCents,
      input.note || null,
      input.provider || null,
      input.model || null,
      input.referenceId || null,
      input.cardId || null,
      input.actorUserId || null
    ]
  );
  return {
    id,
    userId: input.userId,
    username: input.username,
    createdAt: createdAt.toISOString(),
    type: input.type,
    amount: centsToPoints(input.amountCents),
    balanceAfter: centsToPoints(input.balanceAfterCents),
    note: input.note,
    provider: input.provider,
    model: input.model,
    referenceId: input.referenceId,
    cardId: input.cardId,
    actorUserId: input.actorUserId
  };
}

async function ensureUser(executor: AppDatabase["pool"] | PoolConnection, userId: string): Promise<void> {
  const [rows] = await executor.query<RowDataPacket[]>("SELECT id FROM app_users WHERE id = ? LIMIT 1", [userId]);
  if (!rows[0]) throw new AuthError(404, "USER_NOT_FOUND", "用户不存在");
}

async function requireUser(connection: PoolConnection, userId: string, lock = false): Promise<UserRow> {
  const [rows] = await connection.query<UserRow[]>(
    `SELECT * FROM app_users WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [userId]
  );
  const user = rows[0];
  if (!user) throw new AuthError(404, "USER_NOT_FOUND", "用户不存在");
  return user;
}

async function requireAdmin(connection: PoolConnection, userId: string): Promise<UserRow> {
  const user = await requireUser(connection, userId, true);
  if (user.role !== "admin" || user.status !== "active") {
    throw new AuthError(403, "ADMIN_REQUIRED", "只有站长可以执行该操作");
  }
  return user;
}

function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: mysqlDateToIso(user.created_at) || new Date().toISOString(),
    approvedAt: mysqlDateToIso(user.approved_at),
    lastLoginAt: mysqlDateToIso(user.last_login_at),
    credits: centsToPoints(Number(user.credit_cents))
  };
}

function toLoginRecord(row: RowDataPacket): LoginRecord {
  return {
    id: String(row.id),
    userId: nullableString(row.user_id),
    username: String(row.username),
    success: Boolean(row.success),
    reason: nullableString(row.reason),
    createdAt: mysqlDateToIso(row.created_at) || new Date().toISOString(),
    clientIp: nullableString(row.client_ip),
    userAgent: nullableString(row.user_agent)
  };
}

function toUsageRecord(row: RowDataPacket): UsageRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    username: String(row.username),
    createdAt: mysqlDateToIso(row.created_at) || new Date().toISOString(),
    provider: String(row.provider),
    model: String(row.model),
    operation: row.operation === "image-edit" ? "image-edit" : "text-to-image",
    size: String(row.size),
    prompt: nullableString(row.prompt),
    imageCount: Number(row.image_count || 0),
    status: row.status === "success" || row.status === "submitted" ? row.status : "failed",
    durationMs: nullableNonNegativeNumber(row.duration_ms),
    cost: nullableNonNegativeNumber(row.cost),
    requestId: nullableString(row.request_id),
    operationId: nullableString(row.operation_id),
    pointsCost: row.points_cost_cents === null || row.points_cost_cents === undefined
      ? undefined
      : centsToPoints(Number(row.points_cost_cents)),
    pointsRefunded: Boolean(row.points_refunded) || undefined,
    error: nullableString(row.error)
  };
}

function toCreditTransaction(row: RowDataPacket): CreditTransaction {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    username: String(row.username),
    createdAt: mysqlDateToIso(row.created_at) || new Date().toISOString(),
    type: row.type as CreditTransactionType,
    amount: centsToPoints(Number(row.amount_cents)),
    balanceAfter: centsToPoints(Number(row.balance_after_cents)),
    note: nullableString(row.note),
    provider: nullableString(row.provider),
    model: nullableString(row.model),
    referenceId: nullableString(row.reference_id),
    cardId: nullableString(row.card_id),
    actorUserId: nullableString(row.actor_user_id)
  };
}

function toRechargeCardSummary(row: RowDataPacket): RechargeCardSummary {
  const redeemedAt = mysqlDateToIso(row.redeemed_at);
  return {
    id: String(row.id),
    codePreview: String(row.code_preview),
    points: centsToPoints(Number(row.credit_cents)),
    createdAt: mysqlDateToIso(row.created_at) || new Date().toISOString(),
    createdBy: String(row.created_by),
    redeemedAt,
    redeemedByUserId: nullableString(row.redeemed_by_user_id),
    redeemedByUsername: nullableString(row.redeemed_by_username),
    status: redeemedAt ? "redeemed" : "unused"
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

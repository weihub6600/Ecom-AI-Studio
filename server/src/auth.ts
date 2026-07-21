import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const AUTH_COOKIE_NAME = "ecom_ai_session";

export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "active" | "disabled" | "rejected";
export type UsageStatus = "success" | "submitted" | "failed";
export type CreditTransactionType = "generation_charge" | "generation_refund" | "card_recharge" | "admin_adjustment";

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  approvedAt?: string;
  lastLoginAt?: string;
  credits: number;
}

export interface AdminUserSummary extends PublicUser {
  loginCount: number;
  usageCount: number;
  lastLoginIp?: string;
}

export interface LoginRecord {
  id: string;
  userId?: string;
  username: string;
  success: boolean;
  reason?: string;
  createdAt: string;
  clientIp?: string;
  userAgent?: string;
}

export interface UsageRecord {
  id: string;
  userId: string;
  username: string;
  createdAt: string;
  provider: string;
  model: string;
  operation: "text-to-image" | "image-edit";
  size: string;
  prompt?: string;
  imageCount: number;
  status: UsageStatus;
  durationMs?: number;
  cost?: number;
  requestId?: string;
  operationId?: string;
  pointsCost?: number;
  pointsRefunded?: boolean;
  error?: string;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  username: string;
  createdAt: string;
  type: CreditTransactionType;
  amount: number;
  balanceAfter: number;
  note?: string;
  provider?: string;
  model?: string;
  referenceId?: string;
  cardId?: string;
  actorUserId?: string;
}

export interface RechargeCardSummary {
  id: string;
  codePreview: string;
  points: number;
  createdAt: string;
  createdBy: string;
  redeemedAt?: string;
  redeemedByUserId?: string;
  redeemedByUsername?: string;
  status: "unused" | "redeemed";
}

export interface GeneratedRechargeCard extends RechargeCardSummary {
  code: string;
}

interface StoredUser {
  id: string;
  username: string;
  usernameKey: string;
  passwordSalt: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  approvedAt?: string;
  lastLoginAt?: string;
  creditCents: number;
}

interface StoredSession {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

interface StoredCreditTransaction {
  id: string;
  userId: string;
  username: string;
  createdAt: string;
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

interface StoredRechargeCard {
  id: string;
  codeHash: string;
  codePreview: string;
  creditCents: number;
  createdAt: string;
  createdBy: string;
  redeemedAt?: string;
  redeemedByUserId?: string;
  redeemedByUsername?: string;
}

interface AuthData {
  users: StoredUser[];
  sessions: StoredSession[];
  loginRecords: LoginRecord[];
  usageRecords: UsageRecord[];
  creditTransactions: StoredCreditTransaction[];
  rechargeCards: StoredRechargeCard[];
}

interface AuthServiceOptions {
  dataDir: string;
  sessionTtlSeconds?: number;
  adminUsername?: string;
}

export interface AuthAuditContext {
  clientIp?: string;
  userAgent?: string;
}

export interface UsageRecordInput {
  userId: string;
  provider: string;
  model: string;
  operation: "text-to-image" | "image-edit";
  size: string;
  prompt?: string;
  imageCount: number;
  status: UsageStatus;
  durationMs?: number;
  cost?: number;
  requestId?: string;
  operationId?: string;
  pointsCost?: number;
  pointsRefunded?: boolean;
  error?: string;
}

export interface GenerationReservation {
  operationId: string;
  pointsCost: number;
  balance: number;
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_KEY_LENGTH = 64;
const USERNAME_PATTERN = /^[A-Za-z0-9_\u4e00-\u9fff]{2,32}$/u;
const MAX_POINTS_CENTS = 100_000_000;
const CARD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createAuthService(options: AuthServiceOptions) {
  const dataDir = path.resolve(options.dataDir);
  const authFile = path.join(dataDir, "auth.json");
  const sessionTtlSeconds = positiveIntegerOrDefault(options.sessionTtlSeconds, DEFAULT_SESSION_TTL_SECONDS);
  const configuredAdminUsername = normalizeOptionalUsername(options.adminUsername);
  const configuredAdminKey = configuredAdminUsername?.toLocaleLowerCase("zh-CN");
  let writeQueue: Promise<void> = Promise.resolve();

  async function initialize(): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    await withWriteLock(async () => {
      const data = await readAuthData(authFile);
      let changed = !(await fileExists(authFile));
      const hasAdmin = data.users.some((item) => item.role === "admin");
      if (!hasAdmin && configuredAdminKey) {
        const matched = data.users.find((item) => item.usernameKey === configuredAdminKey);
        if (matched) {
          matched.role = "admin";
          matched.status = "active";
          matched.approvedAt ||= new Date().toISOString();
          changed = true;
        }
      }
      const activeSessions = removeExpiredSessions(data.sessions)
        .filter((item) => data.users.some((user) => user.id === item.userId && user.status === "active"));
      if (activeSessions.length !== data.sessions.length) {
        data.sessions = activeSessions;
        changed = true;
      }
      // 启动时始终写回规范化数据，自动补齐旧版账号缺少的积分、卡密和流水字段。
      await atomicWriteJson(authFile, data);
    });
  }

  async function register(
    usernameInput: unknown,
    passwordInput: unknown
  ): Promise<{ user: PublicUser; pending: boolean; token?: string }> {
    const username = normalizeUsername(usernameInput);
    const password = normalizePassword(passwordInput);

    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const usernameKey = username.toLocaleLowerCase("zh-CN");
      if (data.users.some((item) => item.usernameKey === usernameKey)) {
        throw new AuthError(409, "USERNAME_EXISTS", "该用户名已经注册");
      }

      const isFirstConfiguredAdmin = Boolean(
        configuredAdminKey &&
        usernameKey === configuredAdminKey &&
        !data.users.some((item) => item.role === "admin")
      );
      const createdAt = new Date().toISOString();
      const passwordSalt = randomBytes(16).toString("base64");
      const passwordHash = (await derivePassword(password, passwordSalt)).toString("base64");
      const user: StoredUser = {
        id: randomUUID(),
        username,
        usernameKey,
        passwordSalt,
        passwordHash,
        role: isFirstConfiguredAdmin ? "admin" : "user",
        status: isFirstConfiguredAdmin ? "active" : "pending",
        createdAt,
        approvedAt: isFirstConfiguredAdmin ? createdAt : undefined,
        creditCents: 0
      };

      data.users.push(user);
      data.sessions = removeExpiredSessions(data.sessions);

      if (isFirstConfiguredAdmin) {
        const { token, session } = createSession(user.id, sessionTtlSeconds);
        data.sessions.unshift(session);
        user.lastLoginAt = createdAt;
        appendLoginRecord(data, {
          userId: user.id,
          username: user.username,
          success: true,
          reason: "站长账号首次注册",
          createdAt
        });
        await atomicWriteJson(authFile, data);
        return { user: toPublicUser(user), pending: false, token };
      }

      await atomicWriteJson(authFile, data);
      return { user: toPublicUser(user), pending: true };
    });
  }

  async function login(
    usernameInput: unknown,
    passwordInput: unknown,
    context: AuthAuditContext = {}
  ): Promise<{ user: PublicUser; token: string }> {
    const username = normalizeUsername(usernameInput);
    const password = normalizePassword(passwordInput);

    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const usernameKey = username.toLocaleLowerCase("zh-CN");
      const user = data.users.find((item) => item.usernameKey === usernameKey);
      const createdAt = new Date().toISOString();
      const passwordValid = user ? await verifyPassword(password, user.passwordSalt, user.passwordHash) : false;

      if (!user || !passwordValid) {
        appendLoginRecord(data, {
          userId: user?.id,
          username: user?.username || username,
          success: false,
          reason: "用户名或密码不正确",
          createdAt,
          clientIp: normalizeAuditText(context.clientIp, 120),
          userAgent: normalizeAuditText(context.userAgent, 600)
        });
        await atomicWriteJson(authFile, data);
        throw new AuthError(401, "INVALID_CREDENTIALS", "用户名或密码不正确");
      }

      const statusError = loginStatusError(user.status);
      if (statusError) {
        appendLoginRecord(data, {
          userId: user.id,
          username: user.username,
          success: false,
          reason: statusError.message,
          createdAt,
          clientIp: normalizeAuditText(context.clientIp, 120),
          userAgent: normalizeAuditText(context.userAgent, 600)
        });
        await atomicWriteJson(authFile, data);
        throw statusError;
      }

      const { token, session } = createSession(user.id, sessionTtlSeconds);
      const activeSessions = removeExpiredSessions(data.sessions).slice(0, 5000);
      data.sessions = [session, ...activeSessions];
      user.lastLoginAt = createdAt;
      appendLoginRecord(data, {
        userId: user.id,
        username: user.username,
        success: true,
        createdAt,
        clientIp: normalizeAuditText(context.clientIp, 120),
        userAgent: normalizeAuditText(context.userAgent, 600)
      });
      await atomicWriteJson(authFile, data);
      return { user: toPublicUser(user), token };
    });
  }

  async function getUserByToken(token: string | undefined): Promise<PublicUser | undefined> {
    if (!token) return undefined;
    await writeQueue;
    const data = await readAuthData(authFile);
    const tokenHash = hashToken(token);
    const now = Date.now();
    const session = data.sessions.find((item) => item.tokenHash === tokenHash && Date.parse(item.expiresAt) > now);
    if (!session) return undefined;
    const user = data.users.find((item) => item.id === session.userId && item.status === "active");
    return user ? toPublicUser(user) : undefined;
  }

  async function logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const tokenHash = hashToken(token);
      data.sessions = removeExpiredSessions(data.sessions).filter((item) => item.tokenHash !== tokenHash);
      await atomicWriteJson(authFile, data);
    });
  }

  async function listUsers(): Promise<AdminUserSummary[]> {
    await writeQueue;
    const data = await readAuthData(authFile);
    return data.users
      .map((user) => {
        const loginRecords = data.loginRecords.filter((item) => item.userId === user.id);
        const latestSuccessful = loginRecords.find((item) => item.success);
        return {
          ...toPublicUser(user),
          loginCount: loginRecords.length,
          usageCount: data.usageRecords.filter((item) => item.userId === user.id).length,
          lastLoginIp: latestSuccessful?.clientIp
        };
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async function listLoginRecords(userId: string, limit = 100): Promise<LoginRecord[]> {
    await writeQueue;
    const data = await readAuthData(authFile);
    ensureUserExists(data, userId);
    return data.loginRecords.filter((item) => item.userId === userId).slice(0, clampLimit(limit));
  }

  async function listUsageRecords(userId: string, limit = 100): Promise<UsageRecord[]> {
    await writeQueue;
    const data = await readAuthData(authFile);
    ensureUserExists(data, userId);
    return data.usageRecords.filter((item) => item.userId === userId).slice(0, clampLimit(limit));
  }

  async function listCreditTransactions(userId: string, limit = 200): Promise<CreditTransaction[]> {
    await writeQueue;
    const data = await readAuthData(authFile);
    ensureUserExists(data, userId);
    return data.creditTransactions
      .filter((item) => item.userId === userId)
      .slice(0, clampLimit(limit))
      .map(toCreditTransaction);
  }

  async function updateUser(
    userId: string,
    changes: { username?: unknown; status?: unknown },
    actorUserId: string
  ): Promise<PublicUser> {
    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const user = ensureUserExists(data, userId);

      if (changes.username !== undefined) {
        const username = normalizeUsername(changes.username);
        const usernameKey = username.toLocaleLowerCase("zh-CN");
        if (data.users.some((item) => item.id !== user.id && item.usernameKey === usernameKey)) {
          throw new AuthError(409, "USERNAME_EXISTS", "该用户名已经被其他账号使用");
        }
        user.username = username;
        user.usernameKey = usernameKey;
        for (const record of data.loginRecords) {
          if (record.userId === user.id) record.username = username;
        }
        for (const record of data.usageRecords) {
          if (record.userId === user.id) record.username = username;
        }
        for (const record of data.creditTransactions) {
          if (record.userId === user.id) record.username = username;
        }
        for (const card of data.rechargeCards) {
          if (card.redeemedByUserId === user.id) card.redeemedByUsername = username;
        }
      }

      if (changes.status !== undefined) {
        const status = normalizeUserStatus(changes.status);
        if (user.role === "admin" && status !== "active") {
          throw new AuthError(400, "ADMIN_STATUS_LOCKED", "不能封禁或拒绝站长账号");
        }
        if (user.id === actorUserId && status !== "active") {
          throw new AuthError(400, "SELF_STATUS_LOCKED", "不能封禁当前登录的站长账号");
        }
        user.status = status;
        if (status === "active") user.approvedAt ||= new Date().toISOString();
        if (status !== "active") {
          data.sessions = data.sessions.filter((item) => item.userId !== user.id);
        }
      }

      await atomicWriteJson(authFile, data);
      return toPublicUser(user);
    });
  }

  async function forceLogout(userId: string, actorUserId: string): Promise<void> {
    await withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const user = ensureUserExists(data, userId);
      if (user.id === actorUserId) {
        throw new AuthError(400, "SELF_LOGOUT_BLOCKED", "不能从后台强制退出当前站长账号");
      }
      data.sessions = data.sessions.filter((item) => item.userId !== userId);
      await atomicWriteJson(authFile, data);
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

    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      ensureAdmin(data, actorUserId);
      const user = ensureUserExists(data, userId);
      const nextBalance = user.creditCents + amountCents;
      if (nextBalance < 0) {
        throw new AuthError(400, "NEGATIVE_CREDIT_BALANCE", "扣减后积分不能低于 0");
      }
      if (nextBalance > MAX_POINTS_CENTS) {
        throw new AuthError(400, "CREDIT_BALANCE_TOO_LARGE", "用户积分余额超过系统上限");
      }
      user.creditCents = nextBalance;
      const stored = appendCreditTransaction(data, user, {
        type: "admin_adjustment",
        amountCents,
        note,
        actorUserId
      });
      await atomicWriteJson(authFile, data);
      return { user: toPublicUser(user), transaction: toCreditTransaction(stored) };
    });
  }

  async function generateRechargeCards(
    amountInput: unknown,
    quantityInput: unknown,
    actorUserId: string
  ): Promise<GeneratedRechargeCard[]> {
    const creditCents = normalizePositivePointsToCents(amountInput);
    const quantity = normalizeCardQuantity(quantityInput);

    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const actor = ensureAdmin(data, actorUserId);
      const output: GeneratedRechargeCard[] = [];
      const createdAt = new Date().toISOString();

      for (let index = 0; index < quantity; index += 1) {
        let code = "";
        let codeHash = "";
        for (let attempt = 0; attempt < 20; attempt += 1) {
          code = createRechargeCode();
          codeHash = hashRechargeCode(code);
          if (!data.rechargeCards.some((item) => item.codeHash === codeHash)) break;
        }
        if (!code || !codeHash || data.rechargeCards.some((item) => item.codeHash === codeHash)) {
          throw new Error("生成唯一卡密失败，请重试");
        }
        const card: StoredRechargeCard = {
          id: randomUUID(),
          codeHash,
          codePreview: maskRechargeCode(code),
          creditCents,
          createdAt,
          createdBy: actor.username
        };
        data.rechargeCards.unshift(card);
        output.push({ ...toRechargeCardSummary(card), code });
      }

      await atomicWriteJson(authFile, data);
      return output;
    });
  }

  async function listRechargeCards(limit = 200): Promise<RechargeCardSummary[]> {
    await writeQueue;
    const data = await readAuthData(authFile);
    return data.rechargeCards.slice(0, clampLimit(limit)).map(toRechargeCardSummary);
  }

  async function deleteUnusedRechargeCard(
    cardId: string,
    actorUserId: string
  ): Promise<void> {
    if (!cardId) {
      throw new AuthError(400, "INVALID_CARD_ID", "缺少卡密 ID");
    }

    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      ensureAdmin(data, actorUserId);

      const cardIndex = data.rechargeCards.findIndex(
        (item) => item.id === cardId
      );

      if (cardIndex < 0) {
        throw new AuthError(404, "CARD_NOT_FOUND", "卡密不存在");
      }

      const card = data.rechargeCards[cardIndex];

      if (!card) {
        throw new AuthError(404, "CARD_NOT_FOUND", "卡密不存在");
      }

      if (card.redeemedAt) {
        throw new AuthError(
          409,
          "CARD_ALREADY_REDEEMED",
          "已使用的卡密不能删除"
        );
      }

      data.rechargeCards.splice(cardIndex, 1);
      await atomicWriteJson(authFile, data);
    });
  }

  async function redeemRechargeCard(userId: string, codeInput: unknown): Promise<{ user: PublicUser; transaction: CreditTransaction }> {
    const normalizedCode = normalizeRechargeCode(codeInput);
    const codeHash = hashRechargeCode(normalizedCode);

    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const user = ensureUserExists(data, userId);
      if (user.status !== "active") throw loginStatusError(user.status) || new AuthError(403, "ACCOUNT_INACTIVE", "账号不可用");
      const card = data.rechargeCards.find((item) => item.codeHash === codeHash);
      if (!card) throw new AuthError(404, "CARD_NOT_FOUND", "卡密不存在或输入错误");
      if (card.redeemedAt) throw new AuthError(409, "CARD_ALREADY_REDEEMED", "该卡密已经被使用");
      const nextBalance = user.creditCents + card.creditCents;
      if (nextBalance > MAX_POINTS_CENTS) throw new AuthError(400, "CREDIT_BALANCE_TOO_LARGE", "充值后积分余额超过系统上限");
      user.creditCents = nextBalance;
      card.redeemedAt = new Date().toISOString();
      card.redeemedByUserId = user.id;
      card.redeemedByUsername = user.username;
      const stored = appendCreditTransaction(data, user, {
        type: "card_recharge",
        amountCents: card.creditCents,
        note: `卡密充值 ${centsToPoints(card.creditCents)} 积分`,
        cardId: card.id
      });
      await atomicWriteJson(authFile, data);
      return { user: toPublicUser(user), transaction: toCreditTransaction(stored) };
    });
  }

  async function reserveGenerationCredits(
    userId: string,
    pointsCostInput: number,
    provider: string,
    model: string
  ): Promise<GenerationReservation> {
    const costCents = normalizeTrustedPointsToCents(pointsCostInput);
    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const user = ensureUserExists(data, userId);
      if (user.status !== "active") throw loginStatusError(user.status) || new AuthError(403, "ACCOUNT_INACTIVE", "账号不可用");
      const operationId = randomUUID();

      // 站长账号用于维护和测试，不扣积分。
      if (user.role === "admin" || costCents === 0) {
        return { operationId, pointsCost: 0, balance: centsToPoints(user.creditCents) };
      }

      if (user.creditCents < costCents) {
        throw new AuthError(
          402,
          "INSUFFICIENT_CREDITS",
          `积分不足：本次需要 ${centsToPoints(costCents)} 积分，当前剩余 ${centsToPoints(user.creditCents)} 积分`
        );
      }
      user.creditCents -= costCents;
      appendCreditTransaction(data, user, {
        type: "generation_charge",
        amountCents: -costCents,
        note: `${provider} · ${model} AI 生图`,
        provider,
        model,
        referenceId: operationId
      });
      await atomicWriteJson(authFile, data);
      return {
        operationId,
        pointsCost: centsToPoints(costCents),
        balance: centsToPoints(user.creditCents)
      };
    });
  }

  async function refundGenerationCredits(
    userId: string,
    operationId: string,
    reason: string
  ): Promise<{ balance: number; refunded: boolean }> {
    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const user = ensureUserExists(data, userId);
      const refunded = refundGenerationInData(data, user, operationId, reason);
      if (refunded) await atomicWriteJson(authFile, data);
      return { balance: centsToPoints(user.creditCents), refunded };
    });
  }

  async function recordUsage(input: UsageRecordInput): Promise<void> {
    await withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const user = data.users.find((item) => item.id === input.userId);
      if (!user) return;
      const record: UsageRecord = {
        id: randomUUID(),
        userId: user.id,
        username: user.username,
        createdAt: new Date().toISOString(),
        provider: normalizeAuditText(input.provider, 80) || "unknown",
        model: normalizeAuditText(input.model, 160) || "unknown",
        operation: input.operation,
        size: normalizeAuditText(input.size, 80) || "auto",
        prompt: normalizeAuditText(input.prompt, 5000),
        imageCount: Math.max(0, Math.trunc(input.imageCount) || 0),
        status: input.status,
        durationMs: optionalNonNegativeNumber(input.durationMs),
        cost: optionalNonNegativeNumber(input.cost),
        requestId: normalizeAuditText(input.requestId, 200),
        operationId: normalizeAuditText(input.operationId, 200),
        pointsCost: optionalNonNegativeNumber(input.pointsCost),
        pointsRefunded: input.pointsRefunded === true ? true : undefined,
        error: normalizeAuditText(input.error, 800)
      };
      data.usageRecords.unshift(record);
      await atomicWriteJson(authFile, data);
    });
  }

  async function finalizeAsyncUsage(
    userId: string,
    requestId: string,
    update: {
      status: "success" | "failed";
      imageCount?: number;
      durationMs?: number;
      cost?: number;
      error?: string;
    }
  ): Promise<{ balance: number; refunded: boolean }> {
    return withWriteLock(async () => {
      const data = await readAuthData(authFile);
      const user = ensureUserExists(data, userId);
      const record = data.usageRecords.find((item) => item.userId === userId && item.requestId === requestId);
      if (!record) return { balance: centsToPoints(user.creditCents), refunded: false };
      record.status = update.status;
      if (typeof update.imageCount === "number") record.imageCount = Math.max(0, Math.trunc(update.imageCount));
      if (typeof update.durationMs === "number" && update.durationMs >= 0) record.durationMs = update.durationMs;
      if (typeof update.cost === "number" && update.cost >= 0) record.cost = update.cost;
      record.error = normalizeAuditText(update.error, 800);
      let refunded = false;
      if (update.status === "failed" && record.operationId && !record.pointsRefunded) {
        refunded = refundGenerationInData(data, user, record.operationId, update.error || "异步生成任务失败");
        if (refunded) record.pointsRefunded = true;
      }
      await atomicWriteJson(authFile, data);
      return { balance: centsToPoints(user.creditCents), refunded };
    });
  }

  function withWriteLock<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  return {
    authFile,
    sessionTtlSeconds,
    initialize,
    register,
    login,
    logout,
    getUserByToken,
    listUsers,
    listLoginRecords,
    listUsageRecords,
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
    recordUsage,
    finalizeAsyncUsage
  };
}

export function readAuthToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== AUTH_COOKIE_NAME) continue;
    const rawValue = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function createSessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(1, Math.trunc(maxAgeSeconds))}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function createClearSessionCookie(secure: boolean): string {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function normalizeUsername(value: unknown): string {
  if (typeof value !== "string") throw new AuthError(400, "INVALID_USERNAME", "请输入用户名");
  const username = value.trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError(400, "INVALID_USERNAME", "用户名需为 2–32 位中文、字母、数字或下划线");
  }
  return username;
}

function normalizeOptionalUsername(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  return USERNAME_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizePassword(value: unknown): string {
  if (typeof value !== "string") throw new AuthError(400, "INVALID_PASSWORD", "请输入密码");
  if (value.length < 8 || value.length > 128) {
    throw new AuthError(400, "INVALID_PASSWORD", "密码长度需为 8–128 位");
  }
  return value;
}

function normalizeUserStatus(value: unknown): UserStatus {
  if (value === "pending" || value === "active" || value === "disabled" || value === "rejected") return value;
  throw new AuthError(400, "INVALID_USER_STATUS", "用户状态不正确");
}

function loginStatusError(status: UserStatus): AuthError | undefined {
  if (status === "pending") return new AuthError(403, "ACCOUNT_PENDING", "注册申请正在等待站长审核");
  if (status === "disabled") return new AuthError(403, "ACCOUNT_DISABLED", "账号已被站长封禁");
  if (status === "rejected") return new AuthError(403, "ACCOUNT_REJECTED", "注册申请未通过审核，请联系站长");
  return undefined;
}

function normalizePositivePointsToCents(value: unknown): number {
  const cents = parsePointsToCents(value);
  if (cents <= 0) throw new AuthError(400, "INVALID_POINTS", "积分面额必须大于 0");
  return cents;
}

function normalizeSignedPointsToCents(value: unknown): number {
  const cents = parsePointsToCents(value);
  if (cents === 0) throw new AuthError(400, "INVALID_POINTS", "积分调整数不能为 0");
  return cents;
}

function parsePointsToCents(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) throw new AuthError(400, "INVALID_POINTS", "请输入有效积分数值");
  const cents = Math.round(numeric * 100);
  if (Math.abs(cents / 100 - numeric) > 1e-9) {
    throw new AuthError(400, "INVALID_POINTS", "积分最多保留两位小数");
  }
  if (Math.abs(cents) > MAX_POINTS_CENTS) throw new AuthError(400, "INVALID_POINTS", "积分数值超过系统上限");
  return cents;
}

function normalizeTrustedPointsToCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("模型积分价格不正确");
  return Math.round(value * 100);
}

function normalizeCardQuantity(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) {
    throw new AuthError(400, "INVALID_CARD_QUANTITY", "单次生成卡密数量需为 1–200 张");
  }
  return numeric;
}

function normalizeRechargeCode(value: unknown): string {
  if (typeof value !== "string") throw new AuthError(400, "INVALID_CARD_CODE", "请输入卡密");
  const code = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{8,80}$/.test(code)) throw new AuthError(400, "INVALID_CARD_CODE", "卡密格式不正确");
  return code;
}

function normalizeUnknownText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(Buffer.from(key));
    });
  });
}

async function verifyPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  const actual = await derivePassword(password, salt);
  const expected = Buffer.from(storedHash, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createSession(userId: string, ttlSeconds: number): { token: string; session: StoredSession } {
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
  return {
    token,
    session: {
      tokenHash: hashToken(token),
      userId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    }
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashRechargeCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function createRechargeCode(): string {
  const bytes = randomBytes(16);
  let body = "";
  for (const byte of bytes) body += CARD_ALPHABET[byte % CARD_ALPHABET.length];
  return `BJR-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}

function maskRechargeCode(code: string): string {
  const parts = code.split("-");
  const last = parts.at(-1) || "****";
  return `BJR-****-****-****-${last}`;
}

function removeExpiredSessions(sessions: StoredSession[]): StoredSession[] {
  const now = Date.now();
  return sessions.filter((item) => Date.parse(item.expiresAt) > now);
}

function appendLoginRecord(data: AuthData, input: Omit<LoginRecord, "id">): void {
  data.loginRecords.unshift({ id: randomUUID(), ...input });
}

function appendCreditTransaction(
  data: AuthData,
  user: StoredUser,
  input: Omit<StoredCreditTransaction, "id" | "userId" | "username" | "createdAt" | "balanceAfterCents">
): StoredCreditTransaction {
  const record: StoredCreditTransaction = {
    id: randomUUID(),
    userId: user.id,
    username: user.username,
    createdAt: new Date().toISOString(),
    balanceAfterCents: user.creditCents,
    ...input
  };
  data.creditTransactions.unshift(record);
  return record;
}

function refundGenerationInData(data: AuthData, user: StoredUser, operationId: string, reason: string): boolean {
  const charge = data.creditTransactions.find(
    (item) => item.userId === user.id && item.type === "generation_charge" && item.referenceId === operationId
  );
  if (!charge || charge.amountCents >= 0) return false;
  const existingRefund = data.creditTransactions.some(
    (item) => item.userId === user.id && item.type === "generation_refund" && item.referenceId === operationId
  );
  if (existingRefund) return false;
  const refundCents = Math.abs(charge.amountCents);
  user.creditCents += refundCents;
  appendCreditTransaction(data, user, {
    type: "generation_refund",
    amountCents: refundCents,
    note: `生成失败退还积分：${normalizeAuditText(reason, 300) || "生成失败"}`,
    provider: charge.provider,
    model: charge.model,
    referenceId: operationId
  });
  const usage = data.usageRecords.find((item) => item.userId === user.id && item.operationId === operationId);
  if (usage) usage.pointsRefunded = true;
  return true;
}

function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    approvedAt: user.approvedAt,
    lastLoginAt: user.lastLoginAt,
    credits: centsToPoints(user.creditCents)
  };
}

function toCreditTransaction(record: StoredCreditTransaction): CreditTransaction {
  return {
    id: record.id,
    userId: record.userId,
    username: record.username,
    createdAt: record.createdAt,
    type: record.type,
    amount: centsToPoints(record.amountCents),
    balanceAfter: centsToPoints(record.balanceAfterCents),
    note: record.note,
    provider: record.provider,
    model: record.model,
    referenceId: record.referenceId,
    cardId: record.cardId,
    actorUserId: record.actorUserId
  };
}

function toRechargeCardSummary(card: StoredRechargeCard): RechargeCardSummary {
  return {
    id: card.id,
    codePreview: card.codePreview,
    points: centsToPoints(card.creditCents),
    createdAt: card.createdAt,
    createdBy: card.createdBy,
    redeemedAt: card.redeemedAt,
    redeemedByUserId: card.redeemedByUserId,
    redeemedByUsername: card.redeemedByUsername,
    status: card.redeemedAt ? "redeemed" : "unused"
  };
}

function centsToPoints(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function emptyAuthData(): AuthData {
  return {
    users: [],
    sessions: [],
    loginRecords: [],
    usageRecords: [],
    creditTransactions: [],
    rechargeCards: []
  };
}

async function readAuthData(filePath: string): Promise<AuthData> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return normalizeAuthData(parsed);
  } catch (error) {
    if (isMissingFileError(error)) return emptyAuthData();
    if (error instanceof SyntaxError) {
      const brokenFile = `${filePath}.broken-${Date.now()}`;
      await rename(filePath, brokenFile).catch(() => undefined);
      const clean = emptyAuthData();
      await atomicWriteJson(filePath, clean);
      return clean;
    }
    throw error;
  }
}

function normalizeAuthData(value: unknown): AuthData {
  if (!value || typeof value !== "object") throw new SyntaxError("auth.json 格式不正确");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.users) || !Array.isArray(raw.sessions)) {
    throw new SyntaxError("auth.json 格式不正确");
  }

  return {
    users: raw.users.map((item) => normalizeStoredUser(item)),
    sessions: raw.sessions.filter(isStoredSession),
    loginRecords: Array.isArray(raw.loginRecords) ? raw.loginRecords.filter(isLoginRecord) : [],
    usageRecords: Array.isArray(raw.usageRecords) ? raw.usageRecords.map(normalizeUsageRecord).filter(isDefined) : [],
    creditTransactions: Array.isArray(raw.creditTransactions)
      ? raw.creditTransactions.map(normalizeStoredCreditTransaction).filter(isDefined)
      : [],
    rechargeCards: Array.isArray(raw.rechargeCards)
      ? raw.rechargeCards.map(normalizeStoredRechargeCard).filter(isDefined)
      : []
  };
}

function normalizeStoredUser(value: unknown): StoredUser {
  if (!value || typeof value !== "object") throw new SyntaxError("用户记录格式不正确");
  const item = value as Partial<StoredUser> & { credits?: unknown };
  if (
    typeof item.id !== "string" ||
    typeof item.username !== "string" ||
    typeof item.usernameKey !== "string" ||
    typeof item.passwordSalt !== "string" ||
    typeof item.passwordHash !== "string" ||
    typeof item.createdAt !== "string"
  ) {
    throw new SyntaxError("用户记录格式不正确");
  }
  const legacyCredits = typeof item.credits === "number" && Number.isFinite(item.credits) ? Math.round(item.credits * 100) : 0;
  return {
    id: item.id,
    username: item.username,
    usernameKey: item.usernameKey,
    passwordSalt: item.passwordSalt,
    passwordHash: item.passwordHash,
    createdAt: item.createdAt,
    role: item.role === "admin" ? "admin" : "user",
    status: item.status === "active" || item.status === "disabled" || item.status === "rejected" ? item.status : "pending",
    approvedAt: typeof item.approvedAt === "string" ? item.approvedAt : undefined,
    lastLoginAt: typeof item.lastLoginAt === "string" ? item.lastLoginAt : undefined,
    creditCents: typeof item.creditCents === "number" && Number.isInteger(item.creditCents) && item.creditCents >= 0
      ? item.creditCents
      : Math.max(0, legacyCredits)
  };
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredSession>;
  return (
    typeof item.tokenHash === "string" &&
    typeof item.userId === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.expiresAt === "string"
  );
}

function isLoginRecord(value: unknown): value is LoginRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LoginRecord>;
  return (
    typeof item.id === "string" &&
    (item.userId === undefined || typeof item.userId === "string") &&
    typeof item.username === "string" &&
    typeof item.success === "boolean" &&
    typeof item.createdAt === "string"
  );
}

function normalizeUsageRecord(value: unknown): UsageRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<UsageRecord>;
  if (
    typeof item.id !== "string" ||
    typeof item.userId !== "string" ||
    typeof item.username !== "string" ||
    typeof item.createdAt !== "string" ||
    typeof item.provider !== "string" ||
    typeof item.model !== "string" ||
    (item.operation !== "text-to-image" && item.operation !== "image-edit") ||
    typeof item.size !== "string" ||
    typeof item.imageCount !== "number" ||
    (item.status !== "success" && item.status !== "submitted" && item.status !== "failed")
  ) return undefined;
  return {
    id: item.id,
    userId: item.userId,
    username: item.username,
    createdAt: item.createdAt,
    provider: item.provider,
    model: item.model,
    operation: item.operation,
    size: item.size,
    prompt: typeof item.prompt === "string" ? item.prompt : undefined,
    imageCount: item.imageCount,
    status: item.status,
    durationMs: optionalNonNegativeNumber(item.durationMs),
    cost: optionalNonNegativeNumber(item.cost),
    requestId: typeof item.requestId === "string" ? item.requestId : undefined,
    operationId: typeof item.operationId === "string" ? item.operationId : undefined,
    pointsCost: optionalNonNegativeNumber(item.pointsCost),
    pointsRefunded: item.pointsRefunded === true ? true : undefined,
    error: typeof item.error === "string" ? item.error : undefined
  };
}

function normalizeStoredCreditTransaction(value: unknown): StoredCreditTransaction | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<StoredCreditTransaction>;
  if (
    typeof item.id !== "string" || typeof item.userId !== "string" || typeof item.username !== "string" ||
    typeof item.createdAt !== "string" ||
    (item.type !== "generation_charge" && item.type !== "generation_refund" && item.type !== "card_recharge" && item.type !== "admin_adjustment") ||
    typeof item.amountCents !== "number" || !Number.isInteger(item.amountCents) ||
    typeof item.balanceAfterCents !== "number" || !Number.isInteger(item.balanceAfterCents)
  ) return undefined;
  return {
    id: item.id,
    userId: item.userId,
    username: item.username,
    createdAt: item.createdAt,
    type: item.type,
    amountCents: item.amountCents,
    balanceAfterCents: item.balanceAfterCents,
    note: typeof item.note === "string" ? item.note : undefined,
    provider: typeof item.provider === "string" ? item.provider : undefined,
    model: typeof item.model === "string" ? item.model : undefined,
    referenceId: typeof item.referenceId === "string" ? item.referenceId : undefined,
    cardId: typeof item.cardId === "string" ? item.cardId : undefined,
    actorUserId: typeof item.actorUserId === "string" ? item.actorUserId : undefined
  };
}

function normalizeStoredRechargeCard(value: unknown): StoredRechargeCard | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<StoredRechargeCard>;
  if (
    typeof item.id !== "string" || typeof item.codeHash !== "string" || typeof item.codePreview !== "string" ||
    typeof item.creditCents !== "number" || !Number.isInteger(item.creditCents) || item.creditCents <= 0 ||
    typeof item.createdAt !== "string" || typeof item.createdBy !== "string"
  ) return undefined;
  return {
    id: item.id,
    codeHash: item.codeHash,
    codePreview: item.codePreview,
    creditCents: item.creditCents,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    redeemedAt: typeof item.redeemedAt === "string" ? item.redeemedAt : undefined,
    redeemedByUserId: typeof item.redeemedByUserId === "string" ? item.redeemedByUserId : undefined,
    redeemedByUsername: typeof item.redeemedByUsername === "string" ? item.redeemedByUsername : undefined
  };
}

function ensureUserExists(data: AuthData, userId: string): StoredUser {
  const user = data.users.find((item) => item.id === userId);
  if (!user) throw new AuthError(404, "USER_NOT_FOUND", "用户不存在");
  return user;
}

function ensureAdmin(data: AuthData, userId: string): StoredUser {
  const user = ensureUserExists(data, userId);
  if (user.role !== "admin" || user.status !== "active") throw new AuthError(403, "ADMIN_REQUIRED", "只有站长可以执行该操作");
  return user;
}

function clampLimit(value: number): number {
  return Math.min(Math.max(Math.trunc(value) || 100, 1), 500);
}

function normalizeAuditText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function optionalNonNegativeNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempFile, filePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

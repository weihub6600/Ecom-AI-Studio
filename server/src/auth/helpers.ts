import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { AuthError, type GenerationSettlement, type UserStatus } from "./contracts.js";

export const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_KEY_LENGTH = 64;
const USERNAME_PATTERN = /^[A-Za-z0-9_\u4e00-\u9fff]{2,32}$/u;
const MAX_POINTS_CENTS = 100_000_000;
const CARD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeUsername(value: unknown): string {
  if (typeof value !== "string") throw new AuthError(400, "INVALID_USERNAME", "请输入用户名");
  const username = value.trim();
  if (!USERNAME_PATTERN.test(username)) throw new AuthError(400, "INVALID_USERNAME", "用户名需为 2–32 位中文、字母、数字或下划线");
  return username;
}

export function normalizeOptionalUsername(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && USERNAME_PATTERN.test(normalized) ? normalized : undefined;
}

export function normalizePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) throw new AuthError(400, "INVALID_PASSWORD", "密码长度需为 8–128 位");
  return value;
}

export function normalizeUserStatus(value: unknown): UserStatus {
  if (value === "pending" || value === "active" || value === "disabled" || value === "rejected") return value;
  throw new AuthError(400, "INVALID_USER_STATUS", "用户状态不正确");
}

export function loginStatusError(status: UserStatus): AuthError | undefined {
  if (status === "pending") return new AuthError(403, "ACCOUNT_PENDING", "注册申请正在等待站长审核");
  if (status === "disabled") return new AuthError(403, "ACCOUNT_DISABLED", "账号已被站长封禁");
  if (status === "rejected") return new AuthError(403, "ACCOUNT_REJECTED", "注册申请未通过审核，请联系站长");
  return undefined;
}

export function normalizePositivePointsToCents(value: unknown): number {
  const cents = parsePointsToCents(value);
  if (cents <= 0) throw new AuthError(400, "INVALID_POINTS", "积分面额必须大于 0");
  return cents;
}

export function normalizeSignedPointsToCents(value: unknown): number {
  const cents = parsePointsToCents(value);
  if (cents === 0) throw new AuthError(400, "INVALID_POINTS", "积分调整数不能为 0");
  return cents;
}

function parsePointsToCents(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) throw new AuthError(400, "INVALID_POINTS", "请输入有效积分数值");
  const cents = Math.round(numeric * 100);
  if (Math.abs(cents / 100 - numeric) > 1e-9) throw new AuthError(400, "INVALID_POINTS", "积分最多保留两位小数");
  if (Math.abs(cents) > MAX_POINTS_CENTS) throw new AuthError(400, "INVALID_POINTS", "积分数值超过系统上限");
  return cents;
}

export function normalizeTrustedPointsToCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("模型积分价格不正确");
  return Math.round(value * 100);
}

export function normalizeCardQuantity(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) throw new AuthError(400, "INVALID_CARD_QUANTITY", "单次生成卡密数量需为 1–200 张");
  return numeric;
}

export function normalizeRechargeCode(value: unknown): string {
  if (typeof value !== "string") throw new AuthError(400, "INVALID_CARD_CODE", "请输入卡密");
  const code = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{8,80}$/.test(code)) throw new AuthError(400, "INVALID_CARD_CODE", "卡密格式不正确");
  return code;
}

export function normalizeUnknownText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export function normalizeAuditText(value: string | undefined, maxLength: number): string | undefined {
  return value?.trim().slice(0, maxLength) || undefined;
}

export async function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(Buffer.from(key));
    });
  });
}

export async function verifyPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  const actual = await derivePassword(password, salt);
  const expected = Buffer.from(storedHash, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionToken(ttlSeconds: number): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
}

export function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function hashRechargeCode(code: string): string { return createHash("sha256").update(code).digest("hex"); }

export function createRechargeCode(): string {
  const bytes = randomBytes(16);
  const characters = Array.from(bytes, (byte) => CARD_ALPHABET[byte % CARD_ALPHABET.length]).join("");
  return `BJR-${characters.slice(0, 4)}-${characters.slice(4, 8)}-${characters.slice(8, 12)}-${characters.slice(12, 16)}`;
}

export function maskRechargeCode(code: string): string {
  const parts = code.split("-");
  return parts.length >= 5 ? `${parts[0]}-${parts[1]}-****-****-${parts[4]}` : `${code.slice(0, 8)}****`;
}

export function centsToPoints(cents: number): number { return Number((cents / 100).toFixed(2)); }
export function clampLimit(value: number): number { return Math.min(Math.max(Math.trunc(value) || 100, 1), 500); }
export function positiveIntegerOrDefault(value: number | undefined, fallback: number): number { return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback; }
export function optionalNonNegativeNumber(value: number | undefined): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
export function optionalNonNegativeInteger(value: number | undefined): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null; }
export function nullableString(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
export function nullableNonNegativeNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}
export function assertCreditBalance(balance: number, message: string): void {
  if (balance < 0) throw new AuthError(400, "NEGATIVE_CREDIT_BALANCE", "积分余额不能低于 0");
  if (balance > MAX_POINTS_CENTS) throw new AuthError(400, "CREDIT_BALANCE_TOO_LARGE", message);
}
export function emptySettlement(balanceCents: number, pointsCostCents = 0): GenerationSettlement {
  return { balance: centsToPoints(balanceCents), pointsCost: centsToPoints(pointsCostCents), refunded: false, refundAmount: 0 };
}
export function isDuplicateEntry(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY");
}

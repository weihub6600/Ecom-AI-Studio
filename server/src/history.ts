import { lookup } from "node:dns/promises";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type HistoryProviderId = "lingke" | "grsai" | "nanobanana";
export type HistoryOperation = "text-to-image" | "image-edit";

export interface HistoryImage {
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface HistorySaveInput {
  clientId: string;
  provider: HistoryProviderId;
  providerName: string;
  model: string;
  prompt: string;
  operation: HistoryOperation;
  size: string;
  durationMs?: number;
  cost?: number;
  images: HistoryImage[];
}

export interface HistoryRequestContext {
  clientIp?: string;
  userAgent?: string;
  ownerUsername?: string;
}

export interface StoredHistoryRecord extends Omit<HistorySaveInput, "clientId"> {
  id: string;
  createdAt: string;
  /** 旧版记录可能没有 clientId；新记录始终会写入。 */
  clientId?: string;
  clientIp?: string;
  userAgent?: string;
}

export class HistoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryValidationError";
  }
}

interface HistoryServiceOptions {
  dataDir: string;
  /** 为兼容现有调用保留；当前版本始终永久保存，不自动清理历史记录。 */
  maxRecords?: number;
  maxImageBytes?: number;
  downloadTimeoutMs?: number;
}

interface StoredFile {
  fileName: string;
  mimeType: string;
}

const DEFAULT_MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;

export function parseHistoryClientId(value: unknown): string {
  if (typeof value !== "string") throw new HistoryValidationError("clientId 必须是字符串");
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(normalized)) {
    throw new HistoryValidationError("clientId 格式不正确");
  }
  return normalized;
}

export function parseHistorySaveInput(value: unknown): HistorySaveInput {
  const body = asObject(value, "请求体格式不正确");
  const clientId = parseHistoryClientId(body.clientId);
  const provider = readProvider(body.provider);
  const providerName = readRequiredString(body.providerName, "providerName", 80);
  const model = readRequiredString(body.model, "model", 160);
  const prompt = readRequiredString(body.prompt, "prompt", 5000);
  const operation = readOperation(body.operation);
  const size = readRequiredString(body.size, "size", 80);
  const durationMs = readOptionalNonNegativeNumber(body.durationMs, "durationMs");
  const cost = readOptionalNonNegativeNumber(body.cost, "cost");

  if (!Array.isArray(body.images) || body.images.length === 0 || body.images.length > 4) {
    throw new HistoryValidationError("images 必须包含 1 至 4 张图片");
  }

  const images = body.images.map((item, index) => {
    const image = asObject(item, `images[${index}] 格式不正确`);
    const url = readRequiredString(image.url, `images[${index}].url`, 20_000);
    const width = readOptionalPositiveInteger(image.width, `images[${index}].width`);
    const height = readOptionalPositiveInteger(image.height, `images[${index}].height`);
    const mimeType = readOptionalString(image.mimeType, `images[${index}].mimeType`, 120);
    return { url, width, height, mimeType };
  });

  return {
    clientId,
    provider,
    providerName,
    model,
    prompt,
    operation,
    size,
    durationMs,
    cost,
    images
  };
}

export function createHistoryService(options: HistoryServiceOptions) {
  const dataDir = path.resolve(options.dataDir);
  const generatedDir = path.join(dataDir, "generated");
  const indexFile = path.join(dataDir, "history.json");
  const maxImageBytes = positiveIntegerOrDefault(options.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES);
  const downloadTimeoutMs = positiveIntegerOrDefault(options.downloadTimeoutMs, DEFAULT_DOWNLOAD_TIMEOUT_MS);
  let writeQueue: Promise<void> = Promise.resolve();

  async function initialize(): Promise<void> {
    await mkdir(generatedDir, { recursive: true });
    try {
      await readFile(indexFile, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        await atomicWriteJson(indexFile, []);
        return;
      }
      throw error;
    }
  }

  async function list(limit = 20, clientId?: string): Promise<StoredHistoryRecord[]> {
    await writeQueue;
    const records = await readRecords(indexFile);
    const filtered = clientId ? records.filter((item) => item.clientId === clientId) : records;
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
    return filtered.slice(0, safeLimit);
  }

  async function save(input: HistorySaveInput, context: HistoryRequestContext = {}): Promise<StoredHistoryRecord> {
    return withWriteLock(async () => {
      const id = randomUUID();
      const savedFiles: string[] = [];

      try {
        const images: HistoryImage[] = [];
        const timestamp = formatLocalDateTimeStamp(new Date());
        const ownerUsername = normalizeOutputOwner(context.ownerUsername);
        let nextSequence = await findNextOutputSequence(generatedDir, ownerUsername, timestamp);

        for (let index = 0; index < input.images.length; index += 1) {
          const source = input.images[index];
          if (!source) continue;

          const fileBaseName = `${ownerUsername}_${timestamp}_${String(nextSequence).padStart(3, "0")}`;
          nextSequence += 1;

          const stored = await downloadAndStoreImage(
            source.url,
            fileBaseName,
            generatedDir,
            maxImageBytes,
            downloadTimeoutMs
          );
          savedFiles.push(stored.fileName);
          images.push({
            ...source,
            url: `/generated/${encodeURIComponent(stored.fileName)}`,
            mimeType: stored.mimeType
          });
        }

        if (images.length === 0) {
          throw new Error("没有可保存的生成图片");
        }

        const record: StoredHistoryRecord = {
          provider: input.provider,
          providerName: input.providerName,
          model: input.model,
          prompt: input.prompt,
          operation: input.operation,
          size: input.size,
          durationMs: input.durationMs,
          cost: input.cost,
          id,
          createdAt: new Date().toISOString(),
          clientId: input.clientId,
          clientIp: normalizeAuditText(context.clientIp, 120),
          userAgent: normalizeAuditText(context.userAgent, 600),
          images
        };

        const current = await readRecords(indexFile);
        const combined = [record, ...current];

        // 永久保存全部服务器历史：不再按数量截断，也不自动删除旧图片。
        await atomicWriteJson(indexFile, combined);
        return record;
      } catch (error) {
        await Promise.all(savedFiles.map((fileName) => rm(path.join(generatedDir, fileName), { force: true })));
        throw error;
      }
    });
  }

  async function remove(id: string, clientId?: string): Promise<boolean> {
    return withWriteLock(async () => {
      const records = await readRecords(indexFile);
      const record = records.find((item) => item.id === id && (!clientId || item.clientId === clientId));
      if (!record) return false;

      // 网页删除仅移除 history.json 中的记录，服务器原图继续永久保留。
      await atomicWriteJson(indexFile, records.filter((item) => item.id !== id));
      return true;
    });
  }

  async function clear(clientId?: string): Promise<void> {
    await withWriteLock(async () => {
      // 只清除当前用户在网页中的历史记录；data/generated 中的服务器原图始终保留。
      const records = await readRecords(indexFile);
      const retained = clientId ? records.filter((item) => item.clientId !== clientId) : [];
      await atomicWriteJson(indexFile, retained);
    });
  }

  function withWriteLock<T>(task: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(task, task);
    writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  return {
    dataDir,
    generatedDir,
    initialize,
    list,
    save,
    remove,
    clear
  };
}

async function downloadAndStoreImage(
  sourceUrl: string,
  fileBaseName: string,
  generatedDir: string,
  maxImageBytes: number,
  timeoutMs: number
): Promise<StoredFile> {
  const dataImage = decodeDataImage(sourceUrl, maxImageBytes);
  if (dataImage) {
    const extension = extensionFromMimeType(dataImage.mimeType);
    const fileName = `${fileBaseName}.${extension}`;
    await writeFile(path.join(generatedDir, fileName), dataImage.buffer, { flag: "wx" });
    return { fileName, mimeType: dataImage.mimeType };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchWithSafeRedirects(sourceUrl, controller.signal);
    if (!response.ok) {
      throw new Error(`下载生成图片失败：HTTP ${response.status}`);
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maxImageBytes) {
      throw new Error(`生成图片超过服务器保存上限 ${formatMegabytes(maxImageBytes)}`);
    }
    if (!response.body) throw new Error("生成图片响应为空");

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (!part.value) continue;
      totalBytes += part.value.byteLength;
      if (totalBytes > maxImageBytes) {
        await reader.cancel();
        throw new Error(`生成图片超过服务器保存上限 ${formatMegabytes(maxImageBytes)}`);
      }
      chunks.push(Buffer.from(part.value));
    }

    const buffer = Buffer.concat(chunks, totalBytes);
    const headerMimeType = normalizeImageMimeType(response.headers.get("content-type"));
    const mimeType = headerMimeType || detectImageMimeType(buffer);
    if (!mimeType) throw new Error("服务商返回的内容不是受支持的图片格式");

    const extension = extensionFromMimeType(mimeType);
    const fileName = `${fileBaseName}.${extension}`;
    await writeFile(path.join(generatedDir, fileName), buffer, { flag: "wx" });
    return { fileName, mimeType };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("下载生成图片超时，未能保存到服务器");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function findNextOutputSequence(
  generatedDir: string,
  ownerUsername: string,
  timestamp: string
): Promise<number> {
  const entries = await readdir(generatedDir, { withFileTypes: true });
  const prefix = `${ownerUsername}_${timestamp}_`;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedPrefix}(\\d+)\\.(?:png|jpe?g|webp|gif)$`, "i");
  let maximum = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = pattern.exec(entry.name);
    if (!match) continue;
    const sequence = Number(match[1]);
    if (Number.isSafeInteger(sequence) && sequence > maximum) maximum = sequence;
  }

  return maximum + 1;
}

function formatLocalDateTimeStamp(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function normalizeOutputOwner(value: string | undefined): string {
  const normalized = value?.trim();
  if (normalized && /^[A-Za-z0-9_\u4e00-\u9fff]{2,32}$/u.test(normalized)) return normalized;
  return "user";
}

async function fetchWithSafeRedirects(initialUrl: string, signal: AbortSignal): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const parsed = await assertSafeRemoteUrl(currentUrl);
    const response = await fetch(parsed, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "User-Agent": "Ecom-AI-Studio/0.1 image-archiver"
      }
    });

    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("图片下载重定向缺少地址");
    currentUrl = new URL(location, parsed).toString();
  }
  throw new Error("图片下载重定向次数过多");
}

async function assertSafeRemoteUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new HistoryValidationError("图片地址不是有效 URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HistoryValidationError("仅允许保存 HTTP 或 HTTPS 图片");
  }
  if (parsed.username || parsed.password) {
    throw new HistoryValidationError("图片地址不能包含账号信息");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new HistoryValidationError("不允许保存本机或局域网地址中的图片");
  }

  const directIpVersion = isIP(hostname);
  if (directIpVersion > 0) {
    if (isPrivateAddress(hostname)) throw new HistoryValidationError("不允许保存本机或局域网地址中的图片");
    return parsed;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new HistoryValidationError("图片域名解析到了不安全的网络地址");
  }
  return parsed;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;

  if (isIP(normalized) !== 4) return false;
  const parts = normalized.split(".").map(Number);
  const first = parts[0];
  const second = parts[1];
  if (first === undefined || second === undefined) return true;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function decodeDataImage(raw: string, maxImageBytes: number): { buffer: Buffer; mimeType: string } | undefined {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/i.exec(raw);
  if (!match) return undefined;
  const declaredMime = normalizeImageMimeType(match[1] || "");
  if (!declaredMime) throw new HistoryValidationError("不支持该 data URL 图片格式");
  const buffer = Buffer.from((match[2] || "").replace(/\s/g, ""), "base64");
  if (buffer.byteLength === 0) throw new HistoryValidationError("data URL 图片内容为空");
  if (buffer.byteLength > maxImageBytes) {
    throw new HistoryValidationError(`生成图片超过服务器保存上限 ${formatMegabytes(maxImageBytes)}`);
  }
  const detectedMime = detectImageMimeType(buffer);
  if (!detectedMime) throw new HistoryValidationError("data URL 内容不是有效图片");
  return { buffer, mimeType: detectedMime };
}

function normalizeImageMimeType(value: string | null): string | undefined {
  const mime = (value || "").split(";", 1)[0]?.trim().toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime || "")) return mime;
  return undefined;
}

function detectImageMimeType(buffer: Buffer): string | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  const gifHeader = buffer.toString("ascii", 0, 6);
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "image/gif";
  return undefined;
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

async function readRecords(indexFile: string): Promise<StoredHistoryRecord[]> {
  try {
    const raw = await readFile(indexFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredHistoryRecord) : [];
  } catch (error) {
    if (isMissingFileError(error)) return [];
    if (error instanceof SyntaxError) {
      const brokenFile = `${indexFile}.broken-${Date.now()}`;
      await rename(indexFile, brokenFile);
      await atomicWriteJson(indexFile, []);
      return [];
    }
    throw error;
  }
}

function isStoredHistoryRecord(value: unknown): value is StoredHistoryRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredHistoryRecord>;
  return (
    typeof item.id === "string" &&
    typeof item.createdAt === "string" &&
    (item.clientId === undefined || typeof item.clientId === "string") &&
    (item.clientIp === undefined || typeof item.clientIp === "string") &&
    (item.userAgent === undefined || typeof item.userAgent === "string") &&
    (item.provider === "lingke" || item.provider === "grsai" || item.provider === "nanobanana") &&
    typeof item.model === "string" &&
    typeof item.prompt === "string" &&
    Array.isArray(item.images) &&
    item.images.every((image) => Boolean(image && typeof image.url === "string"))
  );
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempFile, filePath);
}


function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HistoryValidationError(message);
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new HistoryValidationError(`${field} 必须是字符串`);
  const normalized = value.trim();
  if (!normalized) throw new HistoryValidationError(`${field} 不能为空`);
  if (normalized.length > maxLength) throw new HistoryValidationError(`${field} 长度不能超过 ${maxLength}`);
  return normalized;
}

function readOptionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new HistoryValidationError(`${field} 必须是字符串`);
  if (value.length > maxLength) throw new HistoryValidationError(`${field} 长度不能超过 ${maxLength}`);
  return value;
}

function readProvider(value: unknown): HistoryProviderId {
  if (value === "lingke" || value === "grsai" || value === "nanobanana") return value;
  throw new HistoryValidationError("provider 不正确");
}

function readOperation(value: unknown): HistoryOperation {
  if (value === "text-to-image" || value === "image-edit") return value;
  throw new HistoryValidationError("operation 不正确");
}

function readOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HistoryValidationError(`${field} 必须是正整数`);
  }
  return value;
}

function readOptionalNonNegativeNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new HistoryValidationError(`${field} 必须是非负数`);
  }
  return value;
}

function normalizeAuditText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}


function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

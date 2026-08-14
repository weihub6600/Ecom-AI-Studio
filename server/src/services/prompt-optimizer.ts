import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { AppDatabase } from "../db/database.js";
import { AuthError } from "../auth.js";
import { fetchWithTimeout } from "../utils/http.js";

type JsonRecord = Record<string, unknown>;
type AuthType = "bearer" | "header" | "query" | "none";
type OptimizeMode = "standard" | "ecommerce" | "concise";

interface SettingsRow extends RowDataPacket {
  id: string;
  enabled: number;
  base_url: string;
  endpoint: string;
  model: string;
  api_key_ciphertext: string;
  auth_type: string;
  auth_header: string;
  auth_scheme: string;
  auth_query_name: string;
  timeout_ms: number;
  temperature: number | string;
  headers_json: string | null;
  request_template_json: string | null;
  response_text_path: string;
  system_prompt: string;
  updated_at: string | Date;
}

export interface PromptOptimizerAdminSettings {
  enabled: boolean;
  baseUrl: string;
  endpoint: string;
  model: string;
  apiKeyConfigured: boolean;
  authType: AuthType;
  authHeader: string;
  authScheme: string;
  authQueryName: string;
  timeoutMs: number;
  temperature: number;
  headers: JsonRecord;
  requestTemplate: JsonRecord;
  responseTextPath: string;
  systemPrompt: string;
  updatedAt?: string;
}

export interface PromptOptimizeInput {
  prompt: string;
  mode: OptimizeMode;
  generationMode: "text-to-image" | "image-edit";
  provider?: string;
  model?: string;
  modelName?: string;
  size?: string;
}

export interface PromptOptimizeResult {
  optimizedPrompt: string;
  durationMs: number;
}

export interface PromptOptimizerService {
  getAdminSettings(): Promise<PromptOptimizerAdminSettings>;
  update(input: JsonRecord): Promise<PromptOptimizerAdminSettings>;
  optimize(input: PromptOptimizeInput): Promise<PromptOptimizeResult>;
  test(): Promise<{ ok: true; preview: string; durationMs: number }>;
}

const SETTINGS_ID = "default";

const DEFAULT_SYSTEM_PROMPT = `你是一名专业的 AI 图片提示词优化助手，擅长电商视觉、商业摄影和图像生成指令设计。
你的任务是优化用户提供的图片生成提示词，而不是替用户改变需求。

必须遵守：
1. 只输出最终优化后的提示词，不要解释、分析、加标题或使用 Markdown 代码块。
2. 不得虚构品牌、规格、功能、功效、认证、产地、价格、成分、促销信息等产品事实。
3. 用户明确要求保留的 Logo、包装文字、颜色、数量、瓶型、产品结构和主体特征必须保留。
4. 参考图生成时，重点优化场景、构图、镜头、灯光、材质、氛围和视觉层级，不得擅自重设计商品。
5. 文生图时，可以补全主体、环境、镜头、构图、光线、材质、色调和画面层次，但不得加入与用户意图冲突的内容。
6. 不要在最终提示词中提及 API 服务商、模型 ID 或“提示词优化”等技术信息。
7. 使用用户原始语言输出，除非用户明确要求翻译。`;

const DEFAULT_REQUEST_TEMPLATE: JsonRecord = {
  model: "{{model}}",
  messages: [
    { role: "system", content: "{{system_prompt}}" },
    { role: "user", content: "{{user_prompt}}" }
  ],
  temperature: "{{temperature}}"
};

export function createPromptOptimizerService(database: AppDatabase): PromptOptimizerService {
  const { pool } = database;
  let initialization: Promise<void> | undefined;

  async function ensureInitialized(): Promise<void> {
    if (!initialization) {
      initialization = initializeSchema().catch((error) => {
        initialization = undefined;
        throw error;
      });
    }
    await initialization;
  }

  async function initializeSchema(): Promise<void> {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_prompt_optimizer_settings (
        id VARCHAR(40) NOT NULL PRIMARY KEY,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        base_url VARCHAR(500) NOT NULL DEFAULT '',
        endpoint VARCHAR(300) NOT NULL DEFAULT '/v1/chat/completions',
        model VARCHAR(160) NOT NULL DEFAULT '',
        api_key_ciphertext TEXT NOT NULL,
        auth_type VARCHAR(20) NOT NULL DEFAULT 'bearer',
        auth_header VARCHAR(80) NOT NULL DEFAULT 'Authorization',
        auth_scheme VARCHAR(80) NOT NULL DEFAULT 'Bearer',
        auth_query_name VARCHAR(80) NOT NULL DEFAULT 'api_key',
        timeout_ms INT UNSIGNED NOT NULL DEFAULT 60000,
        temperature DECIMAL(4,2) NOT NULL DEFAULT 0.40,
        headers_json LONGTEXT NULL,
        request_template_json LONGTEXT NULL,
        response_text_path VARCHAR(500) NOT NULL DEFAULT 'choices[0].message.content',
        system_prompt TEXT NOT NULL,
        updated_at DATETIME(3) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await pool.query(
      `INSERT IGNORE INTO app_prompt_optimizer_settings (
        id, enabled, base_url, endpoint, model, api_key_ciphertext,
        auth_type, auth_header, auth_scheme, auth_query_name,
        timeout_ms, temperature, headers_json, request_template_json,
        response_text_path, system_prompt, updated_at
      ) VALUES (?, 0, '', '/v1/chat/completions', '', '', 'bearer', 'Authorization', 'Bearer', 'api_key', 60000, 0.40, ?, ?, 'choices[0].message.content', ?, ?)`,
      [
        SETTINGS_ID,
        JSON.stringify({}),
        JSON.stringify(DEFAULT_REQUEST_TEMPLATE),
        DEFAULT_SYSTEM_PROMPT,
        new Date()
      ]
    );
  }

  async function readRow(): Promise<SettingsRow> {
    await ensureInitialized();
    const [rows] = await pool.query<SettingsRow[]>(
      "SELECT * FROM app_prompt_optimizer_settings WHERE id = ? LIMIT 1",
      [SETTINGS_ID]
    );
    const current = rows[0];
    if (!current) {
      throw new AuthError(500, "PROMPT_OPTIMIZER_SETTINGS_MISSING", "提示词优化配置不存在");
    }
    return current;
  }

  async function getAdminSettings(): Promise<PromptOptimizerAdminSettings> {
    return serialize(await readRow());
  }

  async function update(input: JsonRecord): Promise<PromptOptimizerAdminSettings> {
    const current = await readRow();

    const enabled = input.enabled === undefined ? Boolean(current.enabled) : Boolean(input.enabled);
    const baseUrl = normalizeBaseUrl(readText(input.baseUrl, current.base_url, 500));
    const endpoint = normalizeEndpoint(readText(input.endpoint, current.endpoint, 300));
    const model = readText(input.model, current.model, 160);
    const authType = normalizeAuthType(input.authType ?? current.auth_type);
    const authHeader = readText(input.authHeader, current.auth_header, 80) || "Authorization";
    const authScheme = readText(input.authScheme, current.auth_scheme, 80);
    const authQueryName = readText(input.authQueryName, current.auth_query_name, 80) || "api_key";
    const timeoutMs = boundedNumber(input.timeoutMs, Number(current.timeout_ms) || 60000, 1000, 180000);
    const temperature = boundedNumber(input.temperature, Number(current.temperature) || 0.4, 0, 2);
    const headers = readObject(input.headers, parseObject(current.headers_json, {}));
    const requestTemplate = readObject(input.requestTemplate, parseObject(current.request_template_json, DEFAULT_REQUEST_TEMPLATE));
    const responseTextPath = readText(input.responseTextPath, current.response_text_path, 500) || "choices[0].message.content";
    const systemPrompt = readText(input.systemPrompt, current.system_prompt || DEFAULT_SYSTEM_PROMPT, 12000) || DEFAULT_SYSTEM_PROMPT;

    let apiKeyCiphertext = current.api_key_ciphertext || "";
    if (input.clearApiKey === true) apiKeyCiphertext = "";
    const nextApiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (nextApiKey) apiKeyCiphertext = encryptSecret(nextApiKey);

    if (enabled && (!baseUrl || !endpoint || !model || (authType !== "none" && !apiKeyCiphertext))) {
      throw new AuthError(
        400,
        "PROMPT_OPTIMIZER_CONFIG_INCOMPLETE",
        "启用提示词优化前，请完整填写 Base URL、Endpoint、模型与认证信息"
      );
    }

    await pool.query(
      `UPDATE app_prompt_optimizer_settings SET
        enabled = ?, base_url = ?, endpoint = ?, model = ?, api_key_ciphertext = ?,
        auth_type = ?, auth_header = ?, auth_scheme = ?, auth_query_name = ?,
        timeout_ms = ?, temperature = ?, headers_json = ?, request_template_json = ?,
        response_text_path = ?, system_prompt = ?, updated_at = ?
       WHERE id = ?`,
      [
        enabled ? 1 : 0, baseUrl, endpoint, model, apiKeyCiphertext,
        authType, authHeader, authScheme, authQueryName,
        Math.round(timeoutMs), temperature, JSON.stringify(headers), JSON.stringify(requestTemplate),
        responseTextPath, systemPrompt, new Date(), SETTINGS_ID
      ]
    );

    return getAdminSettings();
  }

  async function optimize(input: PromptOptimizeInput): Promise<PromptOptimizeResult> {
    const current = await readRow();
    if (!current.enabled) {
      throw new AuthError(503, "PROMPT_OPTIMIZER_DISABLED", "站长尚未启用提示词智能优化");
    }
    return execute(current, normalizeInput(input));
  }

  async function test(): Promise<{ ok: true; preview: string; durationMs: number }> {
    const result = await execute(
      await readRow(),
      {
        prompt: "为一瓶饮料制作高级电商主图，突出产品主体和商业摄影质感。",
        mode: "ecommerce",
        generationMode: "image-edit",
        size: "1:1"
      },
      true
    );
    return { ok: true, preview: result.optimizedPrompt, durationMs: result.durationMs };
  }

  async function execute(
    current: SettingsRow,
    input: PromptOptimizeInput,
    ignoreEnabled = false
  ): Promise<PromptOptimizeResult> {
    if (!ignoreEnabled && !current.enabled) {
      throw new AuthError(503, "PROMPT_OPTIMIZER_DISABLED", "提示词优化服务未启用");
    }

    const baseUrl = normalizeBaseUrl(current.base_url);
    const endpoint = normalizeEndpoint(current.endpoint);
    const model = current.model.trim();
    const authType = normalizeAuthType(current.auth_type);

    if (!baseUrl || !endpoint || !model) {
      throw new AuthError(503, "PROMPT_OPTIMIZER_NOT_CONFIGURED", "提示词优化 API 尚未配置完整");
    }

    const apiKey = current.api_key_ciphertext ? decryptSecret(current.api_key_ciphertext) : "";
    if (authType !== "none" && !apiKey) {
      throw new AuthError(503, "PROMPT_OPTIMIZER_KEY_MISSING", "提示词优化 API Key 尚未配置");
    }

    const variables: Record<string, string | number> = {
      model,
      system_prompt: current.system_prompt || DEFAULT_SYSTEM_PROMPT,
      user_prompt: buildUserPrompt(input),
      temperature: Number(current.temperature) || 0.4,
      original_prompt: input.prompt,
      optimize_mode: input.mode,
      generation_mode: input.generationMode,
      target_provider: input.provider || "",
      target_model: input.modelName || input.model || "",
      size: input.size || ""
    };

    const body = expandTemplate(parseObject(current.request_template_json, DEFAULT_REQUEST_TEMPLATE), variables);
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    for (const [key, value] of Object.entries(parseObject(current.headers_json, {}))) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        headers[key] = String(value);
      }
    }

    let url = joinUrl(baseUrl, endpoint);
    if (authType === "query") {
      const parsed = new URL(url);
      parsed.searchParams.set(current.auth_query_name.trim() || "api_key", apiKey);
      url = parsed.toString();
    } else if (authType !== "none") {
      const headerName = current.auth_header.trim() || "Authorization";
      const scheme = current.auth_scheme.trim();
      headers[headerName] = scheme ? `${scheme} ${apiKey}` : apiKey;
    }

    const startedAt = Date.now();
    let response: Response;

    try {
      response = await fetchWithTimeout(
        url,
        { method: "POST", headers, body: JSON.stringify(body) },
        Math.max(1000, Number(current.timeout_ms) || 60000)
      );
    } catch (error) {
      throw new AuthError(
        502,
        "PROMPT_OPTIMIZER_NETWORK_ERROR",
        error instanceof Error ? `提示词优化 API 请求失败：${error.message}` : "提示词优化 API 请求失败"
      );
    }

    const raw = await response.text();
    let data: unknown;

    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = raw;
    }

    if (!response.ok) {
      throw new AuthError(
        502,
        "PROMPT_OPTIMIZER_UPSTREAM_ERROR",
        `提示词优化 API 返回 HTTP ${response.status}：${compactError(data)}`
      );
    }

    const configuredPath = current.response_text_path.trim();
    const selected = configuredPath ? valueAtPath(data, configuredPath) : undefined;
    const optimizedPrompt = cleanOutput(textFromValue(selected) || autoDetectText(data));

    if (!optimizedPrompt) {
      throw new AuthError(
        502,
        "PROMPT_OPTIMIZER_RESPONSE_INVALID",
        "API 已响应，但没有解析到文本结果，请检查后台的响应文本路径"
      );
    }

    return {
      optimizedPrompt: optimizedPrompt.slice(0, 5000),
      durationMs: Date.now() - startedAt
    };
  }

  return { getAdminSettings, update, optimize, test };
}

function normalizeInput(input: PromptOptimizeInput): PromptOptimizeInput {
  const prompt = String(input.prompt || "").trim();
  if (prompt.length < 2 || prompt.length > 5000) {
    throw new AuthError(400, "INVALID_PROMPT", "提示词长度需为 2–5000 个字符");
  }

  return {
    prompt,
    mode: input.mode === "standard" || input.mode === "concise" ? input.mode : "ecommerce",
    generationMode: input.generationMode === "text-to-image" ? "text-to-image" : "image-edit",
    provider: String(input.provider || "").slice(0, 80),
    model: String(input.model || "").slice(0, 180),
    modelName: String(input.modelName || "").slice(0, 180),
    size: String(input.size || "").slice(0, 80)
  };
}

function buildUserPrompt(input: PromptOptimizeInput): string {
  const modeInstruction = input.mode === "concise"
    ? "精简优化：删除重复和含糊表达，保留全部关键约束，让指令更直接、更容易被图片模型执行。"
    : input.mode === "standard"
      ? "标准优化：保持用户原意，补全主体、环境、构图、镜头、光线、材质与必要细节，但不要过度扩写。"
      : "电商增强：在保持商品事实和用户要求不变的前提下，强化商品主体、商业摄影、画面层级、构图、镜头、光线、材质与高级质感。";

  const generationInstruction = input.generationMode === "image-edit"
    ? "当前为参考图生成：必须保留参考图中的商品主体、包装、Logo、文字、颜色、比例和结构，只优化场景与视觉呈现。"
    : "当前为文生图：可合理补全画面信息，但不得虚构产品事实或加入与用户需求冲突的元素。";

  const context = [
    input.modelName || input.model ? `目标图片模型：${input.modelName || input.model}` : "",
    input.size ? `目标尺寸/比例：${input.size}` : ""
  ].filter(Boolean).join("\n");

  return [
    "请优化下面的图片生成提示词。",
    modeInstruction,
    generationInstruction,
    context,
    "",
    "用户原始提示词：",
    input.prompt,
    "",
    "只输出最终可直接用于图片生成的优化提示词。"
  ].join("\n").trim();
}

function serialize(row: SettingsRow): PromptOptimizerAdminSettings {
  return {
    enabled: Boolean(row.enabled),
    baseUrl: row.base_url,
    endpoint: row.endpoint,
    model: row.model,
    apiKeyConfigured: Boolean(row.api_key_ciphertext),
    authType: normalizeAuthType(row.auth_type),
    authHeader: row.auth_header,
    authScheme: row.auth_scheme,
    authQueryName: row.auth_query_name,
    timeoutMs: Number(row.timeout_ms) || 60000,
    temperature: Number(row.temperature) || 0.4,
    headers: parseObject(row.headers_json, {}),
    requestTemplate: parseObject(row.request_template_json, DEFAULT_REQUEST_TEMPLATE),
    responseTextPath: row.response_text_path,
    systemPrompt: row.system_prompt || DEFAULT_SYSTEM_PROMPT,
    updatedAt: toIso(row.updated_at)
  };
}

function expandTemplate(value: unknown, vars: Record<string, string | number>): unknown {
  if (typeof value === "string") {
    const exact = /^\{\{([a-z0-9_]+)\}\}$/i.exec(value);
    if (exact) return vars[exact[1] || ""] ?? "";
    return value.replace(/\{\{([a-z0-9_]+)\}\}/gi, (_m, key: string) => String(vars[key] ?? ""));
  }

  if (Array.isArray(value)) return value.map((item) => expandTemplate(item, vars));

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([key, item]) => [key, expandTemplate(item, vars)])
    );
  }

  return value;
}

function valueAtPath(root: unknown, path: string): unknown {
  const normalized = path.replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
  let current: unknown = root;

  for (const part of normalized.split(".")) {
    if (!part) continue;
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else {
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

function autoDetectText(data: unknown): string {
  const paths = [
    "choices[0].message.content",
    "output_text",
    "output[0].content[0].text",
    "content[0].text",
    "data.text",
    "result.text",
    "text"
  ];

  for (const path of paths) {
    const result = textFromValue(valueAtPath(data, path));
    if (result) return result;
  }
  return textFromValue(data);
}

function textFromValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join("\n").trim();

  if (value && typeof value === "object") {
    const record = value as JsonRecord;
    for (const key of ["text", "content", "output_text", "value"]) {
      const result = textFromValue(record[key]);
      if (result) return result;
    }
  }

  return "";
}

function cleanOutput(value: string): string {
  let result = String(value || "").trim();
  result = result.replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/, "");
  result = result.replace(/^(?:优化后的提示词|优化提示词|最终提示词|prompt)\s*[:：]\s*/i, "");

  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("“") && result.endsWith("”"))
  ) {
    result = result.slice(1, -1);
  }

  return result.trim();
}

function compactError(value: unknown): string {
  const text = textFromValue(value);
  if (text) return text.replace(/\s+/g, " ").slice(0, 300);

  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return "未知上游错误";
  }
}

function parseObject(value: string | null, fallback: JsonRecord): JsonRecord {
  if (!value) return { ...fallback };

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonRecord;
    }
  } catch {
    // Use fallback.
  }

  return { ...fallback };
}

function readObject(value: unknown, fallback: JsonRecord): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : fallback;
}

function readText(value: unknown, fallback: string, maxLength: number): string {
  if (value === undefined || value === null) return fallback;
  return String(value).trim().slice(0, maxLength);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeAuthType(value: unknown): AuthType {
  return value === "header" || value === "query" || value === "none" ? value : "bearer";
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AuthError(400, "INVALID_PROMPT_OPTIMIZER_BASE_URL", "提示词优化 Base URL 格式不正确");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AuthError(400, "INVALID_PROMPT_OPTIMIZER_BASE_URL", "Base URL 仅支持 HTTP 或 HTTPS");
  }

  return trimmed;
}

function normalizeEndpoint(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function joinUrl(baseUrl: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

function encryptSecret(value: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

function decryptSecret(value: string): string {
  const [version, ivText, tagText, encryptedText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new AuthError(500, "PROMPT_OPTIMIZER_SECRET_INVALID", "提示词优化 API Key 密文格式无效");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivText, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new AuthError(
      500,
      "PROMPT_OPTIMIZER_SECRET_DECRYPT_FAILED",
      "无法解密提示词优化 API Key，请确认 API_PROVIDER_SECRET 未发生变化"
    );
  }
}

function encryptionKey(): Buffer {
  const secret = process.env.API_PROVIDER_SECRET;
  const normalizedSecret = secret?.trim();
  const insecureSecret = normalizedSecret
    ? /^(?:replace-with-at-least-32-random-characters|change-me|your-secret|default)$/i.test(normalizedSecret)
    : true;

  if (!secret || secret.length < 32 || insecureSecret) {
    throw new AuthError(
      503,
      "API_PROVIDER_SECRET_MISSING",
      "服务端必须配置长度至少 32 位的随机 API_PROVIDER_SECRET"
    );
  }

  return createHash("sha256").update(secret, "utf8").digest();
}

function toIso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

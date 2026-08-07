import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import type {
  ResultSetHeader,
  RowDataPacket
} from "mysql2/promise";
import type {
  AppDatabase
} from "../db/database.js";
import {
  AuthError
} from "../auth/contracts.js";
import {
  isBuiltInProviderId,
  setBuiltInProviderRuntimeConfigs,
  type BuiltInProviderId,
  type BuiltInProviderRuntimeConfig
} from "./provider-runtime.js";

interface ProviderSettingRow
  extends RowDataPacket {
  provider_id:
    BuiltInProviderId;
  display_name: string;
  base_url: string;
  generate_endpoint: string;
  status_endpoint:
    string | null;
  api_key_ciphertext: string;
  timeout_ms: number;
  enabled: number;
  options_json:
    string |
    Record<string, unknown>;
  created_at:
    string |
    Date;
  updated_at:
    string |
    Date;
}

export interface AdminBuiltInProvider {
  id: BuiltInProviderId;
  adapter:
    BuiltInProviderId;
  adapterLabel: string;
  displayName: string;
  baseUrl: string;
  generateEndpoint: string;
  statusEndpoint: string;
  timeoutMs: number;
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
  imageSize?: string;
  updatedAt: string;
}

interface ProviderDefault {
  id: BuiltInProviderId;
  displayName: string;
  baseUrl: string;
  generateEndpoint: string;
  statusEndpoint: string;
  apiKey: string;
  timeoutMs: number;
  options: Record<string, string>;
}

export interface ProviderSecretStatus {
  configured: boolean;
  source: "API_PROVIDER_SECRET";
  message: string;
}

export function createBuiltInProviderSettingsService(
  database: AppDatabase
) {
  const cache =
    new Map<
      BuiltInProviderId,
      ProviderSettingRow
    >();

  let initialized = false;

  async function initialize():
    Promise<void> {
    await database.pool.query(
      `CREATE TABLE IF NOT EXISTS
         app_builtin_provider_settings (
           provider_id VARCHAR(40)
             NOT NULL PRIMARY KEY,
           display_name VARCHAR(120)
             NOT NULL,
           base_url VARCHAR(500)
             NOT NULL,
           generate_endpoint VARCHAR(300)
             NOT NULL,
           status_endpoint VARCHAR(300)
             NULL,
           api_key_ciphertext TEXT
             NOT NULL,
           timeout_ms INT UNSIGNED
             NOT NULL DEFAULT 300000,
           enabled TINYINT(1)
             NOT NULL DEFAULT 1,
           options_json JSON
             NOT NULL,
           updated_by_user_id CHAR(36)
             NULL,
           created_at DATETIME(3)
             NOT NULL,
           updated_at DATETIME(3)
             NOT NULL,
           KEY idx_builtin_provider_enabled
             (enabled, updated_at)
         )
         ENGINE=InnoDB
         DEFAULT CHARSET=utf8mb4
         COLLATE=utf8mb4_unicode_ci`
    );

    await database.pool.execute<
      ResultSetHeader
    >(
      `UPDATE
         app_builtin_provider_settings
       SET
         display_name = ?,
         updated_at = ?
       WHERE
         provider_id = 'lingke'
         AND TRIM(display_name) IN (
           '百嘉瑞AI',
           'BJR AI'
         )`,
      [
        "ZHE AI",
        new Date()
      ]
    );

    for (
      const item of
        readDefaults()
    ) {
      const now =
        new Date();

      await database.pool.execute<
        ResultSetHeader
      >(
        `INSERT INTO
           app_builtin_provider_settings (
             provider_id,
             display_name,
             base_url,
             generate_endpoint,
             status_endpoint,
             api_key_ciphertext,
             timeout_ms,
             enabled,
             options_json,
             created_at,
             updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?,
             ?, 1, ?, ?, ?
           )
           ON DUPLICATE KEY UPDATE
             provider_id =
               VALUES(provider_id)`,
        [
          item.id,
          item.displayName,
          item.baseUrl,
          item.generateEndpoint,
          item.statusEndpoint ||
            null,
          item.apiKey
            ? encryptSecret(
                item.apiKey
              )
            : "",
          item.timeoutMs,
          JSON.stringify(
            item.options
          ),
          now,
          now
        ]
      );
    }

    initialized = true;
    await reload();
  }

  async function ensureInitialized():
    Promise<void> {
    if (!initialized) {
      await initialize();
    }
  }

  function getSecurityStatus():
    ProviderSecretStatus {
    const configured =
      isProviderSecretConfigured();

    return {
      configured,
      source: "API_PROVIDER_SECRET",
      message: configured
        ? "API Key 加密密钥已配置"
        : "请在 .env 配置至少 32 位随机 API_PROVIDER_SECRET"
    };
  }

  async function reload():
    Promise<void> {
    const [rows] =
      await database.pool.query<
        ProviderSettingRow[]
      >(
        `SELECT *
         FROM
           app_builtin_provider_settings
         ORDER BY
           FIELD(
             provider_id,
             'lingke',
             'grsai',
             'nanobanana'
           )`
      );

    cache.clear();

    const runtime:
      BuiltInProviderRuntimeConfig[] =
      [];

    for (const row of rows) {
      if (
        !isBuiltInProviderId(
          row.provider_id
        )
      ) {
        continue;
      }

      cache.set(
        row.provider_id,
        row
      );

      runtime.push({
        id:
          row.provider_id,
        displayName:
          row.display_name,
        baseUrl:
          row.base_url,
        generateEndpoint:
          row.generate_endpoint,
        statusEndpoint:
          row.status_endpoint ||
          undefined,
        apiKey:
          decryptSecretSafe(
            row.api_key_ciphertext
          ),
        timeoutMs:
          Number(row.timeout_ms) ||
          300_000,
        enabled:
          Boolean(row.enabled),
        options:
          parseOptions(
            row.options_json
          )
      });
    }

    setBuiltInProviderRuntimeConfigs(
      runtime
    );
  }

  async function listAdmin():
    Promise<AdminBuiltInProvider[]> {
    await ensureInitialized();

    return Array
      .from(cache.values())
      .map((row) => {
        const options =
          parseOptions(
            row.options_json
          );

        const apiKey =
          decryptSecretSafe(
            row.api_key_ciphertext
          );

        return {
          id:
            row.provider_id,
          adapter:
            row.provider_id,
          adapterLabel:
            adapterLabel(
              row.provider_id
            ),
          displayName:
            row.display_name,
          baseUrl:
            row.base_url,
          generateEndpoint:
            row.generate_endpoint,
          statusEndpoint:
            row.status_endpoint ||
            "",
          timeoutMs:
            Number(
              row.timeout_ms
            ) ||
            300_000,
          enabled:
            Boolean(row.enabled),
          apiKeyConfigured:
            Boolean(apiKey),
          apiKeyPreview:
            maskApiKey(apiKey),
          imageSize:
            row.provider_id ===
              "nanobanana"
              ? (
                  options.imageSize ||
                  "4K"
                )
              : undefined,
          updatedAt:
            toIso(
              row.updated_at
            )
        };
      });
  }

  async function update(
    providerId: string,
    input: Record<
      string,
      unknown
    >,
    actorUserId: string
  ):
    Promise<AdminBuiltInProvider> {
    await ensureInitialized();

    if (
      !isBuiltInProviderId(
        providerId
      )
    ) {
      throw new AuthError(
        404,
        "BUILTIN_PROVIDER_NOT_FOUND",
        "内置 API 服务商不存在"
      );
    }

    const current =
      cache.get(providerId);

    if (!current) {
      throw new AuthError(
        404,
        "BUILTIN_PROVIDER_NOT_FOUND",
        "内置 API 服务商不存在"
      );
    }

    const displayName =
      input.displayName ===
        undefined
        ? current.display_name
        : requiredText(
            input.displayName,
            120,
            "请输入服务商名称"
          );

    const baseUrl =
      input.baseUrl ===
        undefined
        ? current.base_url
        : normalizeBaseUrl(
            input.baseUrl
          );

    const generateEndpoint =
      input.generateEndpoint ===
        undefined
        ? current.generate_endpoint
        : normalizeEndpoint(
            input.generateEndpoint,
            false
          );

    const statusEndpoint =
      input.statusEndpoint ===
        undefined
        ? (
            current.status_endpoint ||
            ""
          )
        : normalizeEndpoint(
            input.statusEndpoint,
            true
          );

    const timeoutMs =
      input.timeoutMs ===
        undefined
        ? Number(
            current.timeout_ms
          )
        : boundedInteger(
            input.timeoutMs,
            1_000,
            900_000,
            "超时时间需为 1,000–900,000 毫秒"
          );

    const enabled =
      input.enabled ===
        undefined
        ? Boolean(
            current.enabled
          )
        : normalizeBoolean(
            input.enabled
          );

    const clearApiKey =
      input.clearApiKey ===
        undefined
        ? false
        : normalizeBoolean(
            input.clearApiKey
          );

    const newApiKey =
      optionalText(
        input.apiKey,
        4_000
      );

    let apiKeyCiphertext =
      current.api_key_ciphertext;

    if (clearApiKey) {
      apiKeyCiphertext = "";
    }
    else if (newApiKey) {
      const encrypted =
        encryptSecret(newApiKey);

      if (
        decryptSecretSafe(encrypted) !==
        newApiKey
      ) {
        throw new AuthError(
          500,
          "API_KEY_VERIFY_FAILED",
          "API Key 加密自检失败，请检查 API_PROVIDER_SECRET"
        );
      }

      apiKeyCiphertext =
        encrypted;
    }

    const options =
      parseOptions(
        current.options_json
      );

    if (
      providerId ===
        "nanobanana" &&
      input.imageSize !==
        undefined
    ) {
      options.imageSize =
        normalizeImageSize(
          input.imageSize
        );
    }

    await database.pool.execute<
      ResultSetHeader
    >(
      `UPDATE
         app_builtin_provider_settings
       SET
         display_name = ?,
         base_url = ?,
         generate_endpoint = ?,
         status_endpoint = ?,
         api_key_ciphertext = ?,
         timeout_ms = ?,
         enabled = ?,
         options_json = ?,
         updated_by_user_id = ?,
         updated_at = ?
       WHERE
         provider_id = ?`,
      [
        displayName,
        baseUrl,
        generateEndpoint,
        statusEndpoint ||
          null,
        apiKeyCiphertext,
        timeoutMs,
        enabled ? 1 : 0,
        JSON.stringify(options),
        actorUserId,
        new Date(),
        providerId
      ]
    );

    await reload();

    const item =
      (
        await listAdmin()
      ).find(
        (provider) =>
          provider.id ===
          providerId
      );

    if (!item) {
      throw new Error(
        "更新内置服务商后读取失败"
      );
    }

    return item;
  }

  return {
    initialize,
    reload,
    listAdmin,
    update,
    getSecurityStatus
  };
}

function readDefaults():
  ProviderDefault[] {
  const grsaiKey =
    process.env.GRSAI_API_KEY ||
    "";

  const grsaiBase =
    stripTrailingSlash(
      process.env.GRSAI_BASE_URL ||
      "https://grsai.dakka.com.cn"
    );

  const grsaiEndpoint =
    process.env
      .GRSAI_IMAGE_ENDPOINT ||
    "/v1/api/generate";

  return [
    {
      id: "lingke",
      displayName:
        "ZHE AI",
      baseUrl:
        stripTrailingSlash(
          process.env
            .LINGKE_BASE_URL ||
          "https://api.lk888.ai"
        ),
      generateEndpoint:
        process.env
          .LINGKE_IMAGE_ENDPOINT ||
        "/v1/media/generate",
      statusEndpoint:
        process.env
          .LINGKE_STATUS_ENDPOINT ||
        "/v1/media/status",
      apiKey:
        process.env
          .LINGKE_API_KEY ||
        "",
      timeoutMs:
        positiveEnv(
          "LINGKE_TIMEOUT_MS",
          300_000
        ),
      options: {}
    },
    {
      id: "grsai",
      displayName:
        "GPT",
      baseUrl:
        grsaiBase,
      generateEndpoint:
        grsaiEndpoint,
      statusEndpoint: "",
      apiKey:
        grsaiKey,
      timeoutMs:
        positiveEnv(
          "GRSAI_TIMEOUT_MS",
          300_000
        ),
      options: {}
    },
    {
      id: "nanobanana",
      displayName:
        "Nano Banana",
      baseUrl:
        stripTrailingSlash(
          process.env
            .NANO_BANANA_BASE_URL ||
          grsaiBase
        ),
      generateEndpoint:
        process.env
          .NANO_BANANA_IMAGE_ENDPOINT ||
        grsaiEndpoint,
      statusEndpoint: "",
      apiKey:
        process.env
          .NANO_BANANA_API_KEY ||
        grsaiKey,
      timeoutMs:
        positiveEnv(
          "NANO_BANANA_TIMEOUT_MS",
          300_000
        ),
      options: {
        imageSize:
          normalizeImageSize(
            process.env
              .NANO_BANANA_IMAGE_SIZE ||
            "4K"
          )
      }
    }
  ];
}

function adapterLabel(
  provider: BuiltInProviderId
): string {
  if (provider === "lingke") {
    return "ZHE AI 异步专用协议";
  }

  if (provider === "grsai") {
    return "GRSAI 同步专用协议";
  }

  return "Nano Banana 4K 专用协议";
}

function normalizeBaseUrl(
  value: unknown
): string {
  const text =
    requiredText(
      value,
      500,
      "请输入 Base URL"
    );

  let url: URL;

  try {
    url = new URL(text);
  }
  catch {
    throw new AuthError(
      400,
      "INVALID_BASE_URL",
      "Base URL 格式不正确"
    );
  }

  if (
    url.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !==
        "production" &&
      url.protocol === "http:"
    )
  ) {
    throw new AuthError(
      400,
      "INSECURE_BASE_URL",
      "生产环境中的 Base URL 必须使用 HTTPS"
    );
  }

  return stripTrailingSlash(
    url.toString()
  );
}

function normalizeEndpoint(
  value: unknown,
  allowEmpty: boolean
): string {
  const text =
    typeof value ===
      "string"
      ? value.trim()
      : "";

  if (
    allowEmpty &&
    !text
  ) {
    return "";
  }

  if (
    !text ||
    text.length > 300 ||
    !text.startsWith("/")
  ) {
    throw new AuthError(
      400,
      "INVALID_ENDPOINT",
      "接口路径必须以 / 开头"
    );
  }

  return text;
}

function normalizeImageSize(
  value: unknown
): string {
  const text =
    typeof value ===
      "string"
      ? value.trim()
        .toUpperCase()
      : "";

  if (
    text !== "1K" &&
    text !== "2K" &&
    text !== "4K"
  ) {
    throw new AuthError(
      400,
      "INVALID_IMAGE_SIZE",
      "Nano Banana 清晰度只能是 1K、2K 或 4K"
    );
  }

  return text;
}

function requiredText(
  value: unknown,
  maxLength: number,
  message: string
): string {
  const text =
    typeof value ===
      "string"
      ? value.trim()
      : "";

  if (
    !text ||
    text.length >
      maxLength
  ) {
    throw new AuthError(
      400,
      "INVALID_TEXT",
      message
    );
  }

  return text;
}

function optionalText(
  value: unknown,
  maxLength: number
): string | undefined {
  if (
    typeof value !==
      "string"
  ) {
    return undefined;
  }

  const text =
    value.trim();

  return text
    ? text.slice(
        0,
        maxLength
      )
    : undefined;
}

function normalizeBoolean(
  value: unknown
): boolean {
  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  throw new AuthError(
    400,
    "INVALID_BOOLEAN",
    "布尔参数格式不正确"
  );
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  message: string
): number {
  const numeric =
    Number(value);

  if (
    !Number.isInteger(
      numeric
    ) ||
    numeric < min ||
    numeric > max
  ) {
    throw new AuthError(
      400,
      "INVALID_INTEGER",
      message
    );
  }

  return numeric;
}

function parseOptions(
  value: unknown
):
  Record<string, string> {
  try {
    const parsed =
      typeof value ===
        "string"
        ? JSON.parse(value)
        : value;

    if (
      parsed &&
      typeof parsed ===
        "object" &&
      !Array.isArray(parsed)
    ) {
      return Object.fromEntries(
        Object.entries(parsed)
          .map(
            ([key, item]) => [
              key,
              String(item)
            ]
          )
      );
    }
  }
  catch {
    // Use an empty object.
  }

  return {};
}

function encryptSecret(
  value: string
): string {
  const iv =
    randomBytes(12);

  const cipher =
    createCipheriv(
      "aes-256-gcm",
      encryptionKey(),
      iv
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        value,
        "utf8"
      ),
      cipher.final()
    ]);

  const tag =
    cipher.getAuthTag();

  return [
    "v1",
    iv.toString(
      "base64url"
    ),
    tag.toString(
      "base64url"
    ),
    encrypted.toString(
      "base64url"
    )
  ].join(".");
}

function decryptSecretSafe(
  value: string
): string {
  if (!value) return "";

  try {
    const [
      version,
      ivText,
      tagText,
      encryptedText
    ] =
      value.split(".");

    if (
      version !== "v1" ||
      !ivText ||
      !tagText ||
      !encryptedText
    ) {
      return "";
    }

    const decipher =
      createDecipheriv(
        "aes-256-gcm",
        encryptionKey(),
        Buffer.from(
          ivText,
          "base64url"
        )
      );

    decipher.setAuthTag(
      Buffer.from(
        tagText,
        "base64url"
      )
    );

    return Buffer.concat([
      decipher.update(
        Buffer.from(
          encryptedText,
          "base64url"
        )
      ),
      decipher.final()
    ]).toString("utf8");
  }
  catch {
    return "";
  }
}

function isProviderSecretConfigured():
  boolean {
  const secret =
    process.env
      .API_PROVIDER_SECRET
      ?.trim();

  if (
    !secret ||
    secret.length < 32
  ) {
    return false;
  }

  return !/^(?:replace-with-at-least-32-random-characters|change-me|your-secret|default)$/i
    .test(secret);
}

function encryptionKey():
  Buffer {
  const secret =
    process.env
      .API_PROVIDER_SECRET
      ?.trim();

  if (
    !secret ||
    !isProviderSecretConfigured()
  ) {
    throw new AuthError(
      503,
      "API_PROVIDER_SECRET_MISSING",
      "服务端必须配置长度至少 32 位的随机 API_PROVIDER_SECRET"
    );
  }

  return createHash(
    "sha256"
  )
    .update(secret)
    .digest();
}

function maskApiKey(
  value: string
): string {
  if (!value) return "";

  const suffix =
    value.slice(-4);

  return `****${suffix}`;
}

function positiveEnv(
  name: string,
  fallback: number
): number {
  const value =
    Number(
      process.env[name]
    );

  return (
    Number.isFinite(value) &&
    value >= 1_000
  )
    ? Math.trunc(value)
    : fallback;
}

function stripTrailingSlash(
  value: string
): string {
  return value.replace(
    /\/+$/,
    ""
  );
}

function toIso(
  value:
    string |
    Date
): string {
  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  const normalized =
    value.includes("T")
      ? value
      : `${value.replace(
          " ",
          "T"
        )}Z`;

  const date =
    new Date(normalized);

  return Number.isNaN(
    date.getTime()
  )
    ? new Date()
        .toISOString()
    : date.toISOString();
}

export type BuiltInProviderSettingsService =
  ReturnType<
    typeof createBuiltInProviderSettingsService
  >;

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
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ModelCapability
} from "../types.js";
import {
  ProviderHttpError,
  fetchSafeExternalWithTimeout,
  readJsonResponse,
  redactProviderDetails
} from "../utils/http.js";

type JsonRecord = Record<string, unknown>;
type AuthType = "bearer" | "header" | "query" | "none";
type AdapterType = "template-json" | "openai-images-json";

interface ProviderRow extends RowDataPacket {
  id: string;
  display_name: string;
  base_url: string;
  endpoint: string;
  adapter: AdapterType;
  api_key_ciphertext: string;
  auth_header: string;
  auth_scheme: string;
  enabled: number;
  sort_order: number;
  request_method: string;
  timeout_ms: number;
  auth_config_json: string | JsonRecord | null;
  headers_json: string | JsonRecord | null;
  request_template_json: string | JsonRecord | null;
  response_mapping_json: string | JsonRecord | null;
  async_config_json: string | JsonRecord | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface ModelRow extends RowDataPacket {
  provider_id: string;
  model_id: string;
  api_model_id: string | null;
  display_name: string;
  description: string;
  enabled: number;
  sort_order: number;
  sizes_json: string | string[];
  qualities_json: string | string[] | null;
  max_output_images: number;
  supports_reference_images: number;
  max_reference_images: number;
  supports_negative_prompt: number;
  supports_seed: number;
  size_mapping_json: string | JsonRecord | null;
  request_overrides_json: string | JsonRecord | null;
  unit_credit_cents: number | string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface CollationRow extends RowDataPacket {
  COLLATION_NAME: string | null;
}

interface ColumnRow extends RowDataPacket {
  COLUMN_NAME: string;
}

export interface AdminApiProvider {
  id: string;
  displayName: string;
  baseUrl: string;
  endpoint: string;
  adapter: AdapterType;
  apiKeyConfigured: boolean;
  authType: AuthType;
  authHeader: string;
  authScheme: string;
  authQueryName: string;
  requestMethod: string;
  timeoutMs: number;
  enabled: boolean;
  sortOrder: number;
  headers: JsonRecord;
  requestTemplate: JsonRecord;
  responseMapping: JsonRecord;
  asyncConfig: JsonRecord;
  createdAt: string;
  updatedAt: string;
  models: AdminApiProviderModel[];
}

export interface AdminApiProviderModel {
  provider: string;
  model: string;
  apiModelId: string;
  name: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  sizes: string[];
  qualities: string[];
  maxOutputImages: number;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  sizeMapping: JsonRecord;
  requestOverrides: JsonRecord;
  points: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomRuntimeModel {
  provider: string;
  model: string;
  name: string;
  providerName: string;
  enabled: boolean;
  points: number;
  configured: boolean;
  sortOrder: number;
  capability: ModelCapability;
  updatedAt?: string;
}

export interface AdminProviderTestResult {
  ok: boolean;
  provider: string;
  model: string;
  durationMs: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  response?: unknown;
  imageCount?: number;
  requestId?: string;
  taskId?: string;
  pending?: boolean;
  providerStatus?: string;
  error?: string;
}

const DEFAULT_TEMPLATE: JsonRecord = {
  model: "{{api_model_id}}",
  prompt: "{{prompt}}",
  size: "{{size}}",
  n: "{{count}}",
  quality: "{{quality}}",
  negative_prompt: "{{negative_prompt}}",
  seed: "{{seed}}",
  response_format: "url"
};

const DEFAULT_RESPONSE_MAPPING: JsonRecord = {
  imageUrlPath: "data[*].url",
  imageBase64Path: "data[*].b64_json",
  requestIdPath: "id"
};

const DEFAULT_ASYNC_CONFIG: JsonRecord = {
  enabled: false,
  taskIdPath: "data.task_id",
  statusEndpoint: "/v1/tasks/{{task_id}}",
  statusMethod: "GET",
  statusPath: "data.status",
  successValues: ["SUCCESS", "SUCCEEDED", "COMPLETED"],
  pendingValues: ["PENDING", "QUEUED", "PROCESSING", "RUNNING"],
  failureValues: ["FAILED", "ERROR", "CANCELLED"],
  pollIntervalMs: 3000,
  maxWaitMs: 300000,
  resultMapping: DEFAULT_RESPONSE_MAPPING
};

const PROVIDER_EXTRA_COLUMNS: Record<string, string> = {
  request_method: "VARCHAR(12) NOT NULL DEFAULT 'POST'",
  timeout_ms: "INT UNSIGNED NOT NULL DEFAULT 300000",
  auth_config_json: "JSON NULL",
  headers_json: "JSON NULL",
  request_template_json: "JSON NULL",
  response_mapping_json: "JSON NULL",
  async_config_json: "JSON NULL"
};

const MODEL_EXTRA_COLUMNS: Record<string, string> = {
  api_model_id: "VARCHAR(160) NULL",
  sort_order: "INT UNSIGNED NOT NULL DEFAULT 500",
  qualities_json: "JSON NULL",
  supports_reference_images: "TINYINT(1) NOT NULL DEFAULT 0",
  max_reference_images: "INT UNSIGNED NOT NULL DEFAULT 0",
  size_mapping_json: "JSON NULL",
  request_overrides_json: "JSON NULL"
};

export function createCustomProviderService(
  database: AppDatabase
) {
  const { pool } = database;
  const providers = new Map<string, ProviderRow>();
  const models = new Map<string, CustomRuntimeModel>();
  let initialized = false;

  async function initialize(): Promise<void> {
    const collation = await resolveCoreCollation();

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_api_providers (
        id VARCHAR(40) NOT NULL PRIMARY KEY,
        display_name VARCHAR(120) NOT NULL,
        base_url VARCHAR(500) NOT NULL,
        endpoint VARCHAR(300) NOT NULL,
        adapter VARCHAR(40) NOT NULL DEFAULT 'template-json',
        api_key_ciphertext TEXT NOT NULL,
        auth_header VARCHAR(80) NOT NULL DEFAULT 'Authorization',
        auth_scheme VARCHAR(40) NOT NULL DEFAULT 'Bearer',
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT UNSIGNED NOT NULL DEFAULT 500,
        request_method VARCHAR(12) NOT NULL DEFAULT 'POST',
        timeout_ms INT UNSIGNED NOT NULL DEFAULT 300000,
        auth_config_json JSON NULL,
        headers_json JSON NULL,
        request_template_json JSON NULL,
        response_mapping_json JSON NULL,
        async_config_json JSON NULL,
        created_by_user_id CHAR(36) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        KEY idx_app_api_provider_enabled (enabled, updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collation}`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_api_provider_models (
        provider_id VARCHAR(40) NOT NULL,
        model_id VARCHAR(160) NOT NULL,
        api_model_id VARCHAR(160) NULL,
        display_name VARCHAR(160) NOT NULL,
        description VARCHAR(500) NOT NULL DEFAULT '',
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT UNSIGNED NOT NULL DEFAULT 500,
        sizes_json JSON NOT NULL,
        qualities_json JSON NULL,
        max_output_images INT UNSIGNED NOT NULL DEFAULT 1,
        supports_reference_images TINYINT(1) NOT NULL DEFAULT 0,
        max_reference_images INT UNSIGNED NOT NULL DEFAULT 0,
        supports_negative_prompt TINYINT(1) NOT NULL DEFAULT 0,
        supports_seed TINYINT(1) NOT NULL DEFAULT 0,
        size_mapping_json JSON NULL,
        request_overrides_json JSON NULL,
        unit_credit_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (provider_id, model_id),
        KEY idx_app_api_model_enabled (enabled, updated_at),
        CONSTRAINT fk_app_api_model_provider
          FOREIGN KEY (provider_id)
          REFERENCES app_api_providers(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collation}`
    );

    await ensureColumns(
      "app_api_providers",
      PROVIDER_EXTRA_COLUMNS
    );
    await ensureColumns(
      "app_api_provider_models",
      MODEL_EXTRA_COLUMNS
    );

    initialized = true;
    await reload();
  }

  async function ensureInitialized(): Promise<void> {
    if (!initialized) await initialize();
  }

  async function reload(): Promise<void> {
    const [providerResult, modelResult] = await Promise.all([
      pool.query<ProviderRow[]>(
        `SELECT * FROM app_api_providers
         ORDER BY sort_order ASC, created_at ASC`
      ),
      pool.query<ModelRow[]>(
        `SELECT * FROM app_api_provider_models
         ORDER BY provider_id ASC, sort_order ASC, created_at ASC`
      )
    ]);

    providers.clear();
    models.clear();

    for (const row of providerResult[0]) {
      providers.set(row.id, row);
    }

    for (const row of modelResult[0]) {
      const provider = providers.get(row.provider_id);
      if (!provider) continue;

      const sizes = parseStringArray(row.sizes_json, ["1024x1024"]);
      const qualities = parseStringArray(
        row.qualities_json,
        []
      );
      const maxReferenceImages = Math.max(
        0,
        Number(row.max_reference_images) || 0
      );

      const capability: ModelCapability = {
        id: row.model_id,
        provider: row.provider_id,
        providerName: provider.display_name,
        providerSortOrder: Number(provider.sort_order) || 500,
        name: row.display_name,
        description: row.description,
        configured: providerConfigured(provider),
        supportsReferenceImages: Boolean(row.supports_reference_images),
        maxReferenceImages,
        supportsNegativePrompt: Boolean(row.supports_negative_prompt),
        supportsSeed: Boolean(row.supports_seed),
        sizes,
        sizeMapping: Object.fromEntries(
          Object.entries(parseJsonRecord(row.size_mapping_json, {}))
            .filter(([, value]) => typeof value === "string")
            .map(([key, value]) => [key, String(value)])
        ),
        qualities: qualities as ModelCapability["qualities"],
        maxOutputImages: Math.max(1, Number(row.max_output_images) || 1),
        asynchronous: Boolean(readAsyncConfig(provider).enabled)
      };

      models.set(modelKey(row.provider_id, row.model_id), {
        provider: row.provider_id,
        model: row.model_id,
        name: row.display_name,
        providerName: provider.display_name,
        enabled: Boolean(provider.enabled) && Boolean(row.enabled),
        points: Number(row.unit_credit_cents) / 100,
        configured: providerConfigured(provider),
        sortOrder: Number(row.sort_order) || 500,
        capability,
        updatedAt: toIso(row.updated_at)
      });
    }
  }

  function listPublicModels(): Array<ModelCapability & { creditCost: number; modelSortOrder: number }> {
    return Array.from(models.values())
      .filter((item) => item.enabled)
      .sort((a, b) =>
        (a.capability.providerSortOrder ?? 9999) - (b.capability.providerSortOrder ?? 9999) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name)
      )
      .map((item) => ({
        ...item.capability,
        creditCost: item.points,
        modelSortOrder: item.sortOrder
      }));
  }

  function getRuntimeModel(
    provider: string,
    model: string
  ): CustomRuntimeModel | undefined {
    return models.get(modelKey(provider, model));
  }

  function hasProvider(provider: string): boolean {
    return providers.has(provider);
  }

  async function listAdmin(): Promise<AdminApiProvider[]> {
    await ensureInitialized();
    const [modelRows] = await pool.query<ModelRow[]>(
      `SELECT * FROM app_api_provider_models
       ORDER BY provider_id ASC, sort_order ASC, created_at ASC`
    );
    const grouped = new Map<string, AdminApiProviderModel[]>();
    for (const row of modelRows) {
      const list = grouped.get(row.provider_id) || [];
      list.push(toAdminModel(row));
      grouped.set(row.provider_id, list);
    }

    return Array.from(providers.values()).map((row) => {
      const auth = readAuthConfig(row);
      return {
        id: row.id,
        displayName: row.display_name,
        baseUrl: row.base_url,
        endpoint: row.endpoint,
        adapter: normalizeAdapter(row.adapter),
        apiKeyConfigured: Boolean(row.api_key_ciphertext),
        authType: auth.type,
        authHeader: auth.headerName,
        authScheme: auth.scheme,
        authQueryName: auth.queryName,
        requestMethod: normalizeMethod(row.request_method),
        timeoutMs: Number(row.timeout_ms) || 300000,
        enabled: Boolean(row.enabled),
        sortOrder: Number(row.sort_order) || 500,
        headers: parseJsonRecord(row.headers_json, {}),
        requestTemplate: readRequestTemplate(row),
        responseMapping: readResponseMapping(row),
        asyncConfig: readAsyncConfig(row),
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
        models: grouped.get(row.id) || []
      };
    });
  }

  async function createProvider(
    input: Record<string, unknown>,
    actorUserId: string
  ): Promise<AdminApiProvider> {
    await ensureInitialized();

    const id = normalizeProviderId(input.id);
    if (isBuiltInProvider(id)) {
      throw new AuthError(
        409,
        "PROVIDER_ID_RESERVED",
        "该服务商标识已被系统内置服务商占用"
      );
    }

    const displayName = requiredText(
      input.displayName,
      120,
      "请输入服务商名称"
    );
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const endpoint = normalizeEndpoint(input.endpoint);
    const requestMethod = normalizeMethodInput(input.requestMethod);
    const timeoutMs = boundedInteger(
      input.timeoutMs,
      1000,
      900000,
      300000,
      "请求超时需为 1000–900000 毫秒"
    );
    const enabled = input.enabled === undefined
      ? true
      : normalizeBoolean(input.enabled);
    const sortOrder = boundedInteger(
      input.sortOrder,
      1,
      9999,
      500,
      "前台排序需为 1–9999"
    );

    const authConfig = normalizeAuthConfig(input);
    const apiKey = optionalText(input.apiKey, 4000) || "";
    if (authConfig.type !== "none" && !apiKey) {
      throw new AuthError(
        400,
        "API_KEY_REQUIRED",
        "当前认证方式需要填写 API Key"
      );
    }

    const headers = normalizeJsonRecordInput(input.headers, {}, 30000, "自定义 Header JSON 格式不正确");
    const requestTemplate = normalizeJsonRecordInput(
      input.requestTemplate,
      DEFAULT_TEMPLATE,
      50000,
      "请求模板 JSON 格式不正确"
    );
    const responseMapping = normalizeJsonRecordInput(
      input.responseMapping,
      DEFAULT_RESPONSE_MAPPING,
      30000,
      "响应映射 JSON 格式不正确"
    );
    const asyncConfig = normalizeAsyncConfig(input.asyncConfig);
    const now = new Date();

    try {
      await pool.execute<ResultSetHeader>(
        `INSERT INTO app_api_providers (
          id, display_name, base_url, endpoint, adapter,
          api_key_ciphertext, auth_header, auth_scheme,
          enabled, sort_order, request_method, timeout_ms,
          auth_config_json, headers_json, request_template_json,
          response_mapping_json, async_config_json,
          created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'template-json', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          displayName,
          baseUrl,
          endpoint,
          apiKey ? encryptSecret(apiKey) : "",
          authConfig.headerName,
          authConfig.scheme,
          enabled ? 1 : 0,
          sortOrder,
          requestMethod,
          timeoutMs,
          JSON.stringify(authConfig),
          JSON.stringify(headers),
          JSON.stringify(requestTemplate),
          JSON.stringify(responseMapping),
          JSON.stringify(asyncConfig),
          actorUserId,
          now,
          now
        ]
      );
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new AuthError(
          409,
          "PROVIDER_EXISTS",
          "服务商标识已经存在"
        );
      }
      throw error;
    }

    await reload();
    return requireAdminProvider(id);
  }

  async function updateProvider(
    providerId: string,
    input: Record<string, unknown>
  ): Promise<AdminApiProvider> {
    await ensureInitialized();
    const current = providers.get(providerId);
    if (!current) {
      throw new AuthError(404, "PROVIDER_NOT_FOUND", "API 服务商不存在");
    }

    const currentAuth = readAuthConfig(current);
    const displayName = input.displayName === undefined
      ? current.display_name
      : requiredText(input.displayName, 120, "请输入服务商名称");
    const baseUrl = input.baseUrl === undefined
      ? current.base_url
      : normalizeBaseUrl(input.baseUrl);
    const endpoint = input.endpoint === undefined
      ? current.endpoint
      : normalizeEndpoint(input.endpoint);
    const requestMethod = input.requestMethod === undefined
      ? normalizeMethod(current.request_method)
      : normalizeMethodInput(input.requestMethod);
    const timeoutMs = input.timeoutMs === undefined
      ? Number(current.timeout_ms) || 300000
      : boundedInteger(input.timeoutMs, 1000, 900000, 300000, "请求超时需为 1000–900000 毫秒");
    const enabled = input.enabled === undefined
      ? Boolean(current.enabled)
      : normalizeBoolean(input.enabled);
    const sortOrder = input.sortOrder === undefined
      ? Number(current.sort_order) || 500
      : boundedInteger(input.sortOrder, 1, 9999, 500, "前台排序需为 1–9999");

    const authConfig = hasAnyAuthField(input)
      ? normalizeAuthConfig({ ...currentAuth, ...input })
      : currentAuth;
    const headers = input.headers === undefined
      ? parseJsonRecord(current.headers_json, {})
      : normalizeJsonRecordInput(input.headers, {}, 30000, "自定义 Header JSON 格式不正确");
    const requestTemplate = input.requestTemplate === undefined
      ? readRequestTemplate(current)
      : normalizeJsonRecordInput(input.requestTemplate, DEFAULT_TEMPLATE, 50000, "请求模板 JSON 格式不正确");
    const responseMapping = input.responseMapping === undefined
      ? readResponseMapping(current)
      : normalizeJsonRecordInput(input.responseMapping, DEFAULT_RESPONSE_MAPPING, 30000, "响应映射 JSON 格式不正确");
    const asyncConfig = input.asyncConfig === undefined
      ? readAsyncConfig(current)
      : normalizeAsyncConfig(input.asyncConfig);

    const apiKey = optionalText(input.apiKey, 4000);
    const clearApiKey = input.clearApiKey === true;
    let nextCipher = current.api_key_ciphertext;
    if (clearApiKey) nextCipher = "";
    else if (apiKey) nextCipher = encryptSecret(apiKey);

    if (authConfig.type !== "none" && !nextCipher) {
      throw new AuthError(
        400,
        "API_KEY_REQUIRED",
        "当前认证方式需要 API Key；请填写新 Key 或改为无认证"
      );
    }

    await pool.execute(
      `UPDATE app_api_providers SET
        display_name = ?, base_url = ?, endpoint = ?, adapter = 'template-json',
        api_key_ciphertext = ?, auth_header = ?, auth_scheme = ?,
        enabled = ?, sort_order = ?, request_method = ?, timeout_ms = ?,
        auth_config_json = ?, headers_json = ?, request_template_json = ?,
        response_mapping_json = ?, async_config_json = ?, updated_at = ?
       WHERE id = ?`,
      [
        displayName,
        baseUrl,
        endpoint,
        nextCipher,
        authConfig.headerName,
        authConfig.scheme,
        enabled ? 1 : 0,
        sortOrder,
        requestMethod,
        timeoutMs,
        JSON.stringify(authConfig),
        JSON.stringify(headers),
        JSON.stringify(requestTemplate),
        JSON.stringify(responseMapping),
        JSON.stringify(asyncConfig),
        new Date(),
        providerId
      ]
    );

    await reload();
    return requireAdminProvider(providerId);
  }

  async function deleteProvider(providerId: string): Promise<void> {
    await ensureInitialized();
    const result = await pool.execute<ResultSetHeader>(
      `DELETE FROM app_api_providers WHERE id = ?`,
      [providerId]
    );
    if (result[0].affectedRows < 1) {
      throw new AuthError(404, "PROVIDER_NOT_FOUND", "API 服务商不存在");
    }
    await reload();
  }

  async function cloneProvider(
    providerId: string,
    input: Record<string, unknown>,
    actorUserId: string
  ): Promise<AdminApiProvider> {
    await ensureInitialized();

    const source = providers.get(providerId);
    if (!source) {
      throw new AuthError(404, "PROVIDER_NOT_FOUND", "API 服务商不存在");
    }

    const requestedId = optionalText(input.id, 40);
    const nextId = requestedId
      ? normalizeProviderId(requestedId)
      : nextProviderCloneId(providerId);

    if (isBuiltInProvider(nextId)) {
      throw new AuthError(
        409,
        "PROVIDER_ID_RESERVED",
        "复制后的服务商 ID 不能使用系统内置标识"
      );
    }

    if (providers.has(nextId)) {
      throw new AuthError(
        409,
        "PROVIDER_EXISTS",
        "复制后的服务商 ID 已存在"
      );
    }

    const displayName =
      optionalText(input.displayName, 120) ||
      `${source.display_name} 副本`;
    const includeModels =
      input.includeModels === undefined
        ? true
        : normalizeBoolean(input.includeModels);
    const now = new Date();

    await pool.execute<ResultSetHeader>(
      `INSERT INTO app_api_providers (
        id, display_name, base_url, endpoint, adapter,
        api_key_ciphertext, auth_header, auth_scheme,
        enabled, sort_order, request_method, timeout_ms,
        auth_config_json, headers_json, request_template_json,
        response_mapping_json, async_config_json,
        created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'template-json', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextId,
        displayName,
        source.base_url,
        source.endpoint,
        source.api_key_ciphertext,
        source.auth_header,
        source.auth_scheme,
        0,
        Math.min(9999, (Number(source.sort_order) || 500) + 1),
        normalizeMethod(source.request_method),
        Number(source.timeout_ms) || 300000,
        JSON.stringify(readAuthConfig(source)),
        JSON.stringify(parseJsonRecord(source.headers_json, {})),
        JSON.stringify(readRequestTemplate(source)),
        JSON.stringify(readResponseMapping(source)),
        JSON.stringify(readAsyncConfig(source)),
        actorUserId,
        now,
        now
      ]
    );

    if (includeModels) {
      const [rows] = await pool.query<ModelRow[]>(
        `SELECT * FROM app_api_provider_models
         WHERE provider_id = ?
         ORDER BY sort_order ASC, created_at ASC`,
        [providerId]
      );

      for (const row of rows) {
        await pool.execute<ResultSetHeader>(
          `INSERT INTO app_api_provider_models (
            provider_id, model_id, api_model_id, display_name, description,
            enabled, sort_order, sizes_json, qualities_json, max_output_images,
            supports_reference_images, max_reference_images,
            supports_negative_prompt, supports_seed,
            size_mapping_json, request_overrides_json,
            unit_credit_cents, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nextId,
            row.model_id,
            row.api_model_id,
            row.display_name,
            row.description,
            0,
            Number(row.sort_order) || 500,
            JSON.stringify(parseStringArray(row.sizes_json, ["1024x1024"])),
            JSON.stringify(parseStringArray(row.qualities_json, [])),
            Number(row.max_output_images) || 1,
            row.supports_reference_images ? 1 : 0,
            Number(row.max_reference_images) || 0,
            row.supports_negative_prompt ? 1 : 0,
            row.supports_seed ? 1 : 0,
            JSON.stringify(parseJsonRecord(row.size_mapping_json, {})),
            JSON.stringify(parseJsonRecord(row.request_overrides_json, {})),
            Number(row.unit_credit_cents) || 0,
            now,
            now
          ]
        );
      }
    }

    await reload();
    return requireAdminProvider(nextId);
  }

  async function createModel(
    providerId: string,
    input: Record<string, unknown>
  ): Promise<AdminApiProviderModel> {
    await ensureInitialized();
    if (!providers.has(providerId)) {
      throw new AuthError(404, "PROVIDER_NOT_FOUND", "请先新增 API 服务商");
    }

    const model = requiredText(input.model, 160, "请输入模型 ID");
    const apiModelId = optionalText(input.apiModelId, 160) || model;
    const name = requiredText(input.name, 160, "请输入模型显示名称");
    const description = optionalText(input.description, 500) || "";
    const enabled = input.enabled === undefined
      ? true
      : normalizeBoolean(input.enabled);
    const sortOrder = boundedInteger(
      input.sortOrder,
      1,
      9999,
      500,
      "模型显示顺序需为 1–9999"
    );
    const sizes = normalizeSizes(input.sizes);
    const qualities = normalizeQualities(input.qualities);
    const maxOutputImages = boundedInteger(
      input.maxOutputImages,
      1,
      16,
      1,
      "单次出图数量需为 1–16"
    );
    const supportsReferenceImages = input.supportsReferenceImages === undefined
      ? false
      : normalizeBoolean(input.supportsReferenceImages);
    const maxReferenceImages = supportsReferenceImages
      ? boundedInteger(input.maxReferenceImages, 1, 32, 1, "参考图数量需为 1–32")
      : 0;
    const supportsNegativePrompt = input.supportsNegativePrompt === undefined
      ? false
      : normalizeBoolean(input.supportsNegativePrompt);
    const supportsSeed = input.supportsSeed === undefined
      ? false
      : normalizeBoolean(input.supportsSeed);
    const sizeMapping = normalizeJsonRecordInput(input.sizeMapping, {}, 20000, "尺寸映射 JSON 格式不正确");
    const requestOverrides = normalizeJsonRecordInput(input.requestOverrides, {}, 30000, "模型请求覆盖 JSON 格式不正确");
    const points = normalizePoints(input.points);
    const now = new Date();

    try {
      await pool.execute<ResultSetHeader>(
        `INSERT INTO app_api_provider_models (
          provider_id, model_id, api_model_id, display_name, description,
          enabled, sort_order, sizes_json, qualities_json, max_output_images,
          supports_reference_images, max_reference_images,
          supports_negative_prompt, supports_seed,
          size_mapping_json, request_overrides_json,
          unit_credit_cents, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          providerId,
          model,
          apiModelId,
          name,
          description,
          enabled ? 1 : 0,
          sortOrder,
          JSON.stringify(sizes),
          JSON.stringify(qualities),
          maxOutputImages,
          supportsReferenceImages ? 1 : 0,
          maxReferenceImages,
          supportsNegativePrompt ? 1 : 0,
          supportsSeed ? 1 : 0,
          JSON.stringify(sizeMapping),
          JSON.stringify(requestOverrides),
          Math.round(points * 100),
          now,
          now
        ]
      );
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new AuthError(409, "MODEL_EXISTS", "该服务商下的模型 ID 已存在");
      }
      throw error;
    }

    await reload();
    return requireAdminModel(providerId, model);
  }

  async function updateModel(
    providerId: string,
    modelId: string,
    input: Record<string, unknown>
  ): Promise<AdminApiProviderModel> {
    await ensureInitialized();
    const current = await readModelRow(providerId, modelId);
    if (!current) {
      throw new AuthError(404, "MODEL_NOT_FOUND", "自定义模型不存在");
    }

    const apiModelId = input.apiModelId === undefined
      ? (current.api_model_id || current.model_id)
      : requiredText(input.apiModelId, 160, "请输入 API 模型 ID");
    const name = input.name === undefined
      ? current.display_name
      : requiredText(input.name, 160, "请输入模型显示名称");
    const description = input.description === undefined
      ? current.description
      : (optionalText(input.description, 500) || "");
    const enabled = input.enabled === undefined
      ? Boolean(current.enabled)
      : normalizeBoolean(input.enabled);
    const sortOrder = input.sortOrder === undefined
      ? (Number(current.sort_order) || 500)
      : boundedInteger(input.sortOrder, 1, 9999, 500, "模型显示顺序需为 1–9999");
    const sizes = input.sizes === undefined
      ? parseStringArray(current.sizes_json, ["1024x1024"])
      : normalizeSizes(input.sizes);
    const qualities = input.qualities === undefined
      ? parseStringArray(current.qualities_json, [])
      : normalizeQualities(input.qualities);
    const maxOutputImages = input.maxOutputImages === undefined
      ? Number(current.max_output_images)
      : boundedInteger(input.maxOutputImages, 1, 16, 1, "单次出图数量需为 1–16");
    const supportsReferenceImages = input.supportsReferenceImages === undefined
      ? Boolean(current.supports_reference_images)
      : normalizeBoolean(input.supportsReferenceImages);
    const maxReferenceImages = supportsReferenceImages
      ? (input.maxReferenceImages === undefined
          ? Math.max(1, Number(current.max_reference_images) || 1)
          : boundedInteger(input.maxReferenceImages, 1, 32, 1, "参考图数量需为 1–32"))
      : 0;
    const supportsNegativePrompt = input.supportsNegativePrompt === undefined
      ? Boolean(current.supports_negative_prompt)
      : normalizeBoolean(input.supportsNegativePrompt);
    const supportsSeed = input.supportsSeed === undefined
      ? Boolean(current.supports_seed)
      : normalizeBoolean(input.supportsSeed);
    const sizeMapping = input.sizeMapping === undefined
      ? parseJsonRecord(current.size_mapping_json, {})
      : normalizeJsonRecordInput(input.sizeMapping, {}, 20000, "尺寸映射 JSON 格式不正确");
    const requestOverrides = input.requestOverrides === undefined
      ? parseJsonRecord(current.request_overrides_json, {})
      : normalizeJsonRecordInput(input.requestOverrides, {}, 30000, "模型请求覆盖 JSON 格式不正确");
    const points = input.points === undefined
      ? Number(current.unit_credit_cents) / 100
      : normalizePoints(input.points);

    await pool.execute(
      `UPDATE app_api_provider_models SET
        api_model_id = ?, display_name = ?, description = ?, enabled = ?,
        sort_order = ?, sizes_json = ?, qualities_json = ?, max_output_images = ?,
        supports_reference_images = ?, max_reference_images = ?,
        supports_negative_prompt = ?, supports_seed = ?,
        size_mapping_json = ?, request_overrides_json = ?,
        unit_credit_cents = ?, updated_at = ?
       WHERE provider_id = ? AND model_id = ?`,
      [
        apiModelId,
        name,
        description,
        enabled ? 1 : 0,
        sortOrder,
        JSON.stringify(sizes),
        JSON.stringify(qualities),
        maxOutputImages,
        supportsReferenceImages ? 1 : 0,
        maxReferenceImages,
        supportsNegativePrompt ? 1 : 0,
        supportsSeed ? 1 : 0,
        JSON.stringify(sizeMapping),
        JSON.stringify(requestOverrides),
        Math.round(points * 100),
        new Date(),
        providerId,
        modelId
      ]
    );

    await reload();
    return requireAdminModel(providerId, modelId);
  }

  async function deleteModel(
    providerId: string,
    modelId: string
  ): Promise<void> {
    await ensureInitialized();
    const result = await pool.execute<ResultSetHeader>(
      `DELETE FROM app_api_provider_models
       WHERE provider_id = ? AND model_id = ?`,
      [providerId, modelId]
    );
    if (result[0].affectedRows < 1) {
      throw new AuthError(404, "MODEL_NOT_FOUND", "自定义模型不存在");
    }
    await reload();
  }

  async function cloneModel(
    providerId: string,
    modelId: string,
    input: Record<string, unknown>
  ): Promise<AdminApiProviderModel> {
    await ensureInitialized();

    if (!providers.has(providerId)) {
      throw new AuthError(404, "PROVIDER_NOT_FOUND", "API 服务商不存在");
    }

    const source = await readModelRow(providerId, modelId);
    if (!source) {
      throw new AuthError(404, "MODEL_NOT_FOUND", "自定义模型不存在");
    }

    const requestedModel = optionalText(input.model, 160);
    const nextModelId = requestedModel
      ? requiredText(requestedModel, 160, "请输入复制后的模型 ID")
      : await nextModelCloneId(providerId, modelId);

    if (await readModelRow(providerId, nextModelId)) {
      throw new AuthError(409, "MODEL_EXISTS", "复制后的模型 ID 已存在");
    }

    const displayName =
      optionalText(input.name, 160) ||
      `${source.display_name} 副本`;
    const now = new Date();

    await pool.execute<ResultSetHeader>(
      `INSERT INTO app_api_provider_models (
        provider_id, model_id, api_model_id, display_name, description,
        enabled, sort_order, sizes_json, qualities_json, max_output_images,
        supports_reference_images, max_reference_images,
        supports_negative_prompt, supports_seed,
        size_mapping_json, request_overrides_json,
        unit_credit_cents, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        providerId,
        nextModelId,
        source.api_model_id || source.model_id,
        displayName,
        source.description,
        0,
        Math.min(9999, (Number(source.sort_order) || 500) + 1),
        JSON.stringify(parseStringArray(source.sizes_json, ["1024x1024"])),
        JSON.stringify(parseStringArray(source.qualities_json, [])),
        Number(source.max_output_images) || 1,
        source.supports_reference_images ? 1 : 0,
        Number(source.max_reference_images) || 0,
        source.supports_negative_prompt ? 1 : 0,
        source.supports_seed ? 1 : 0,
        JSON.stringify(parseJsonRecord(source.size_mapping_json, {})),
        JSON.stringify(parseJsonRecord(source.request_overrides_json, {})),
        Number(source.unit_credit_cents) || 0,
        now,
        now
      ]
    );

    await reload();
    return requireAdminModel(providerId, nextModelId);
  }

  async function previewRequest(
    providerId: string,
    modelId: string,
    input: Record<string, unknown>
  ) {
    await ensureInitialized();
    const request = buildTestRequest(providerId, modelId, input);
    const prepared = await prepareRequest(request, false, true);
    return redactPrepared(prepared);
  }

  async function testModel(
    providerId: string,
    modelId: string,
    input: Record<string, unknown>
  ): Promise<AdminProviderTestResult> {
    await ensureInitialized();
    const request = buildTestRequest(providerId, modelId, input);
    const startedAt = Date.now();
    let prepared: PreparedRequest | undefined;

    try {
      prepared = await prepareRequest(request, true, true);
      const submitBody = await sendPrepared(prepared);
      const mapping = readResponseMapping(prepared.provider);
      const asyncConfig = readAsyncConfig(prepared.provider);
      const taskId = firstString(
        readFirstPath(submitBody, stringValue(asyncConfig.taskIdPath)),
        readFirstPath(submitBody, stringValue(mapping.taskIdPath)),
        readFirstPath(submitBody, "id")
      );
      const providerStatus = firstString(
        readFirstPath(submitBody, stringValue(asyncConfig.statusPath)),
        readFirstPath(submitBody, "status")
      );

      if (Boolean(asyncConfig.enabled) && taskId) {
        return {
          ok: true,
          pending: true,
          provider: providerId,
          model: modelId,
          durationMs: Date.now() - startedAt,
          request: redactPrepared(prepared),
          response: redactProviderDetails(submitBody),
          imageCount: 0,
          requestId: firstString(
            readFirstPath(submitBody, stringValue(mapping.requestIdPath)),
            readFirstPath(submitBody, "id")
          ),
          taskId,
          providerStatus
        };
      }

      const result = parseExecutedResult(submitBody, mapping, taskId);
      if (result.images.length < 1) {
        return {
          ok: false,
          provider: providerId,
          model: modelId,
          durationMs: Date.now() - startedAt,
          request: redactPrepared(prepared),
          response: redactProviderDetails(submitBody),
          imageCount: 0,
          requestId: result.requestId,
          taskId: result.taskId,
          providerStatus,
          error: "服务商已响应，但没有解析到图片，请检查响应映射"
        };
      }

      return {
        ok: true,
        provider: providerId,
        model: modelId,
        durationMs: Date.now() - startedAt,
        request: redactPrepared(prepared),
        response: redactProviderDetails(result.raw),
        imageCount: result.images.length,
        requestId: result.requestId,
        taskId: result.taskId,
        providerStatus
      };
    } catch (error) {
      return {
        ok: false,
        provider: providerId,
        model: modelId,
        durationMs: Date.now() - startedAt,
        request: prepared
          ? redactPrepared(prepared)
          : { method: "POST", url: "", headers: {}, body: {} },
        response: error instanceof ProviderHttpError
          ? redactProviderDetails(error.details)
          : undefined,
        error: error instanceof Error ? error.message : "测试失败"
      };
    }
  }

  async function testTask(
    providerId: string,
    modelId: string,
    taskId: string
  ): Promise<AdminProviderTestResult> {
    await ensureInitialized();
    const startedAt = Date.now();
    let prepared: PreparedRequest | undefined;

    try {
      const request = buildTestRequest(providerId, modelId, {});
      prepared = await prepareRequest(request, true, true);
      const asyncConfig = readAsyncConfig(prepared.provider);
      if (!Boolean(asyncConfig.enabled)) {
        throw new AuthError(
          400,
          "ASYNC_PROVIDER_DISABLED",
          "该服务商未启用异步任务模式"
        );
      }

      const snapshot = await readAsyncSnapshot(
        prepared,
        taskId,
        asyncConfig
      );

      if (snapshot.state === "failure") {
        return {
          ok: false,
          provider: providerId,
          model: modelId,
          durationMs: Date.now() - startedAt,
          request: redactPrepared(prepared),
          response: redactProviderDetails(snapshot.body),
          imageCount: 0,
          taskId,
          providerStatus: snapshot.status,
          error: snapshot.error || "异步生图任务失败"
        };
      }

      if (snapshot.state === "pending") {
        return {
          ok: true,
          pending: true,
          provider: providerId,
          model: modelId,
          durationMs: Date.now() - startedAt,
          request: redactPrepared(prepared),
          response: redactProviderDetails(snapshot.body),
          imageCount: 0,
          requestId: snapshot.result?.requestId,
          taskId,
          providerStatus: snapshot.status
        };
      }

      const result = snapshot.result!;
      return {
        ok: result.images.length > 0,
        pending: false,
        provider: providerId,
        model: modelId,
        durationMs: Date.now() - startedAt,
        request: redactPrepared(prepared),
        response: redactProviderDetails(snapshot.body),
        imageCount: result.images.length,
        requestId: result.requestId,
        taskId,
        providerStatus: snapshot.status,
        error: result.images.length > 0
          ? undefined
          : "任务已完成，但没有解析到图片，请检查异步结果映射"
      };
    } catch (error) {
      return {
        ok: false,
        provider: providerId,
        model: modelId,
        durationMs: Date.now() - startedAt,
        request: prepared
          ? redactPrepared(prepared)
          : { method: "GET", url: "", headers: {}, body: {} },
        response: error instanceof ProviderHttpError
          ? redactProviderDetails(error.details)
          : undefined,
        taskId,
        error: error instanceof Error ? error.message : "查询测试任务失败"
      };
    }
  }

  async function generate(
    request: GenerateImageRequest
  ): Promise<GenerateImageResult> {
    await ensureInitialized();
    const runtime = getRuntimeModel(request.provider, request.model);
    if (!runtime || !runtime.enabled) {
      throw new AuthError(404, "MODEL_NOT_FOUND", "自定义模型不存在或未启用");
    }
    if (request.images.length > runtime.capability.maxReferenceImages) {
      throw new AuthError(
        400,
        "TOO_MANY_IMAGES",
        `该模型最多支持 ${runtime.capability.maxReferenceImages} 张参考图`
      );
    }
    if (request.images.length > 0 && !runtime.capability.supportsReferenceImages) {
      throw new AuthError(
        400,
        "REFERENCE_IMAGES_UNSUPPORTED",
        "该模型未开启参考图能力"
      );
    }

    const startedAt = Date.now();
    const prepared = await prepareRequest(request, true);
    const executed = await executePrepared(request, prepared);

    if (executed.images.length < 1) {
      throw new ProviderHttpError(
        "服务商未返回可识别的图片，请检查响应映射",
        502,
        redactProviderDetails(executed.raw)
      );
    }

    return {
      provider: request.provider,
      model: request.model,
      images: executed.images.slice(0, request.count),
      durationMs: Date.now() - startedAt,
      requestId: executed.requestId,
      taskId: executed.taskId,
      status: "completed"
    };
  }

  async function prepareRequest(
    request: GenerateImageRequest,
    includeSecret: boolean,
    allowDisabled = false
  ): Promise<PreparedRequest> {
    const provider = providers.get(request.provider);
    if (!provider || (!provider.enabled && !allowDisabled)) {
      throw new AuthError(400, "PROVIDER_DISABLED", "API 服务商未启用");
    }
    const model = await readModelRow(request.provider, request.model);
    if (!model || (!model.enabled && !allowDisabled)) {
      throw new AuthError(404, "MODEL_NOT_FOUND", "自定义模型不存在或未启用");
    }

    const apiKey = provider.api_key_ciphertext
      ? decryptSecret(provider.api_key_ciphertext)
      : "";
    const auth = readAuthConfig(provider);
    const variables = buildVariables(request, model, apiKey);
    const baseTemplate = readRequestTemplate(provider);
    const overrides = parseJsonRecord(model.request_overrides_json, {});
    const mergedTemplate = deepMerge(baseTemplate, overrides);
    const body = renderTemplate(mergedTemplate, variables);

    let url = joinUrl(provider.base_url, provider.endpoint);
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    const customHeaders = renderTemplate(
      parseJsonRecord(provider.headers_json, {}),
      variables
    );
    if (isRecord(customHeaders)) {
      for (const [key, value] of Object.entries(customHeaders)) {
        if (value === undefined || value === null) continue;
        headers[key] = String(value);
      }
    }

    if (auth.type === "query" && apiKey) {
      const parsed = new URL(url);
      parsed.searchParams.set(auth.queryName || "api_key", apiKey);
      url = parsed.toString();
    } else if ((auth.type === "bearer" || auth.type === "header") && apiKey) {
      const name = auth.headerName || "Authorization";
      headers[name] = auth.scheme
        ? `${auth.scheme} ${apiKey}`
        : apiKey;
    }

    const method = normalizeMethod(provider.request_method);
    return {
      provider,
      model,
      method,
      url,
      headers,
      body,
      variables,
      timeoutMs: Number(provider.timeout_ms) || 300000,
      includeSecret
    };
  }

  async function sendPrepared(
    prepared: PreparedRequest
  ): Promise<unknown> {
    const init: RequestInit = {
      method: prepared.method,
      headers: prepared.headers
    };
    if (prepared.method !== "GET" && prepared.method !== "HEAD") {
      init.body = JSON.stringify(prepared.body ?? {});
    }

    const response = await fetchSafeExternalWithTimeout(
      prepared.url,
      init,
      prepared.timeoutMs
    );
    return readJsonResponse(response);
  }

  async function executePrepared(
    request: GenerateImageRequest,
    prepared: PreparedRequest
  ): Promise<ExecutedResult> {
    const body = await sendPrepared(prepared);
    const mapping = readResponseMapping(prepared.provider);
    const asyncConfig = readAsyncConfig(prepared.provider);

    const taskId = firstString(
      readFirstPath(body, stringValue(asyncConfig.taskIdPath)),
      readFirstPath(body, stringValue(mapping.taskIdPath)),
      readFirstPath(body, "id")
    );

    if (Boolean(asyncConfig.enabled) && taskId) {
      return pollAsyncResult(
        request,
        prepared,
        body,
        taskId,
        asyncConfig
      );
    }

    return parseExecutedResult(body, mapping, taskId);
  }

  async function readAsyncSnapshot(
    prepared: PreparedRequest,
    taskId: string,
    asyncConfig: JsonRecord
  ): Promise<AsyncSnapshot> {
    const statusEndpoint = requiredConfigText(
      asyncConfig.statusEndpoint,
      "异步模式已启用，但未配置任务查询接口"
    );
    const statusPath = requiredConfigText(
      asyncConfig.statusPath,
      "异步模式已启用，但未配置状态字段路径"
    );
    const statusMethod = normalizeMethod(String(asyncConfig.statusMethod || "GET"));
    const success = normalizeStatusSet(
      asyncConfig.successValues,
      ["SUCCESS", "SUCCEEDED", "COMPLETED"]
    );
    const pending = normalizeStatusSet(
      asyncConfig.pendingValues,
      ["PENDING", "QUEUED", "PROCESSING", "RUNNING"]
    );
    const failure = normalizeStatusSet(
      asyncConfig.failureValues,
      ["FAILED", "ERROR", "CANCELLED"]
    );
    const resultMapping = isRecord(asyncConfig.resultMapping)
      ? asyncConfig.resultMapping
      : readResponseMapping(prepared.provider);

    const variables = {
      ...prepared.variables,
      task_id: taskId,
      taskId
    };
    const renderedEndpoint = String(
      renderTemplate(statusEndpoint, variables)
    );
    let url = renderedEndpoint.startsWith("http://")
      || renderedEndpoint.startsWith("https://")
      ? renderedEndpoint
      : joinUrl(prepared.provider.base_url, renderedEndpoint);

    const auth = readAuthConfig(prepared.provider);
    const apiKey = prepared.provider.api_key_ciphertext
      ? decryptSecret(prepared.provider.api_key_ciphertext)
      : "";
    const headers = { ...prepared.headers };

    if (auth.type === "query" && apiKey) {
      const parsed = new URL(url);
      parsed.searchParams.set(auth.queryName || "api_key", apiKey);
      url = parsed.toString();
    }

    const pollResponse = await fetchSafeExternalWithTimeout(
      url,
      { method: statusMethod, headers },
      Math.min(prepared.timeoutMs, 120000)
    );
    const body = await readJsonResponse(pollResponse);
    const statusRaw = readFirstPath(body, statusPath);
    const status = String(statusRaw ?? "").trim().toUpperCase();

    if (success.has(status)) {
      return {
        state: "success",
        status,
        body,
        result: parseExecutedResult(body, resultMapping, taskId)
      };
    }

    if (failure.has(status)) {
      const errorPath = stringValue(asyncConfig.errorMessagePath)
        || stringValue((resultMapping as JsonRecord).errorMessagePath);
      const message = firstString(
        errorPath ? readFirstPath(body, errorPath) : undefined,
        "异步生图任务失败"
      );
      return {
        state: "failure",
        status,
        body,
        error: message || "异步生图任务失败"
      };
    }

    return {
      state: "pending",
      status: status || "PENDING",
      body
    };
  }

  async function pollAsyncResult(
    _request: GenerateImageRequest,
    prepared: PreparedRequest,
    submitBody: unknown,
    taskId: string,
    asyncConfig: JsonRecord
  ): Promise<ExecutedResult> {
    const pollIntervalMs = boundedConfigNumber(
      asyncConfig.pollIntervalMs,
      500,
      30000,
      3000
    );
    const maxWaitMs = boundedConfigNumber(
      asyncConfig.maxWaitMs,
      3000,
      900000,
      300000
    );

    const start = Date.now();
    let latest: unknown = submitBody;

    while (Date.now() - start <= maxWaitMs) {
      await sleep(pollIntervalMs);
      const snapshot = await readAsyncSnapshot(
        prepared,
        taskId,
        asyncConfig
      );
      latest = snapshot.body;

      if (snapshot.state === "success") {
        return snapshot.result!;
      }

      if (snapshot.state === "failure") {
        throw new ProviderHttpError(
          snapshot.error || "异步生图任务失败",
          502,
          redactProviderDetails(snapshot.body)
        );
      }
    }

    throw new ProviderHttpError(
      "异步生图任务等待超时，请检查轮询配置",
      504,
      redactProviderDetails(latest)
    );
  }

  function parseExecutedResult(
    body: unknown,
    mapping: JsonRecord,
    taskId?: string
  ): ExecutedResult {
    const images = extractImagesByMapping(body, mapping);
    const requestIdPath = stringValue(mapping.requestIdPath);
    const taskIdPath = stringValue(mapping.taskIdPath);
    const requestId = firstString(
      requestIdPath ? readFirstPath(body, requestIdPath) : undefined,
      readFirstPath(body, "id"),
      readFirstPath(body, "request_id"),
      readFirstPath(body, "requestId")
    );
    const mappedTaskId = firstString(
      taskId,
      taskIdPath ? readFirstPath(body, taskIdPath) : undefined
    );
    return { images, requestId, taskId: mappedTaskId, raw: body };
  }

  function buildTestRequest(
    providerId: string,
    modelId: string,
    input: Record<string, unknown>
  ): GenerateImageRequest {
    const runtime = getRuntimeModel(providerId, modelId);
    if (!runtime) {
      throw new AuthError(404, "MODEL_NOT_FOUND", "请先保存模型配置");
    }
    const prompt = optionalText(input.prompt, 5000) || "A premium product photography image on a clean studio background";
    const size = optionalText(input.size, 80) || runtime.capability.sizes[0] || "1024x1024";
    const count = boundedInteger(input.count, 1, Math.max(1, runtime.capability.maxOutputImages), 1, "测试出图数量不正确");
    const qualityRaw = optionalText(input.quality, 20) || "auto";
    const images = Array.isArray(input.images)
      ? input.images
          .filter(isRecord)
          .map((item, index) => ({
            name: String(item.name || `reference-${index + 1}.png`),
            mimeType: normalizeMimeType(item.mimeType),
            dataUrl: String(item.dataUrl || "")
          }))
          .filter((item) => item.dataUrl.startsWith("data:image/"))
      : [];

    return {
      provider: providerId,
      model: modelId,
      operation: images.length > 0 ? "image-edit" : "text-to-image",
      prompt,
      negativePrompt: optionalText(input.negativePrompt, 3000),
      images,
      size,
      quality: qualityRaw as GenerateImageRequest["quality"],
      count,
      seed: input.seed === undefined ? undefined : Number(input.seed)
    };
  }

  async function resolveCoreCollation(): Promise<string> {
    const [rows] = await pool.query<CollationRow[]>(
      `SELECT COLLATION_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'app_users'
         AND COLUMN_NAME = 'id'
       LIMIT 1`
    );
    const collation = rows[0]?.COLLATION_NAME || "utf8mb4_0900_ai_ci";
    if (!/^[A-Za-z0-9_]+$/.test(collation)) {
      throw new Error("读取到无效的数据库排序规则");
    }
    return collation;
  }

  async function ensureColumns(
    table: string,
    definitions: Record<string, string>
  ): Promise<void> {
    if (!/^[a-z0-9_]+$/i.test(table)) {
      throw new Error("无效数据库表名");
    }

    for (const [name, definition] of Object.entries(definitions)) {
      if (!/^[a-z0-9_]+$/i.test(name)) {
        throw new Error("无效数据库列名");
      }

      const [rows] = await pool.query<ColumnRow[]>(
        `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [table, name]
      );

      if (rows.length > 0) {
        continue;
      }

      try {
        await pool.query(
          `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`
        );
      } catch (error) {
        const mysqlError =
          error && typeof error === "object"
            ? error as { code?: unknown; errno?: unknown }
            : undefined;

        const code = String(mysqlError?.code || "");
        const errno = Number(mysqlError?.errno);

        if (code === "ER_DUP_FIELDNAME" || errno === 1060) {
          continue;
        }

        throw error;
      }
    }
  }

  async function requireAdminProvider(providerId: string): Promise<AdminApiProvider> {
    const item = (await listAdmin()).find((provider) => provider.id === providerId);
    if (!item) throw new AuthError(404, "PROVIDER_NOT_FOUND", "API 服务商不存在");
    return item;
  }

  async function requireAdminModel(
    providerId: string,
    modelId: string
  ): Promise<AdminApiProviderModel> {
    const row = await readModelRow(providerId, modelId);
    if (!row) throw new AuthError(404, "MODEL_NOT_FOUND", "自定义模型不存在");
    return toAdminModel(row);
  }

  async function readModelRow(
    providerId: string,
    modelId: string
  ): Promise<ModelRow | undefined> {
    const [rows] = await pool.query<ModelRow[]>(
      `SELECT * FROM app_api_provider_models
       WHERE provider_id = ? AND model_id = ? LIMIT 1`,
      [providerId, modelId]
    );
    return rows[0];
  }

  function nextProviderCloneId(providerId: string): string {
    const normalizedBase = providerId
      .replace(/[^a-z0-9_-]/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30) || "provider";

    for (let index = 1; index <= 999; index += 1) {
      const suffix = index === 1 ? "-copy" : `-copy-${index}`;
      const candidate = `${normalizedBase.slice(0, 40 - suffix.length)}${suffix}`
        .toLowerCase();
      if (!providers.has(candidate) && !isBuiltInProvider(candidate)) {
        return candidate;
      }
    }

    throw new AuthError(
      409,
      "PROVIDER_CLONE_ID_EXHAUSTED",
      "无法自动生成可用的服务商副本 ID，请手动指定"
    );
  }

  async function nextModelCloneId(
    providerId: string,
    modelId: string
  ): Promise<string> {
    const base = modelId
      .replace(/\s+/g, "-")
      .slice(0, 140) || "model";

    for (let index = 1; index <= 999; index += 1) {
      const suffix = index === 1 ? "-copy" : `-copy-${index}`;
      const candidate = `${base.slice(0, 160 - suffix.length)}${suffix}`;
      if (!(await readModelRow(providerId, candidate))) {
        return candidate;
      }
    }

    throw new AuthError(
      409,
      "MODEL_CLONE_ID_EXHAUSTED",
      "无法自动生成可用的模型副本 ID，请手动指定"
    );
  }

  return {
    initialize,
    reload,
    listPublicModels,
    getRuntimeModel,
    hasProvider,
    listAdmin,
    createProvider,
    updateProvider,
    deleteProvider,
    cloneProvider,
    createModel,
    updateModel,
    deleteModel,
    cloneModel,
    previewRequest,
    testModel,
    testTask,
    generate
  };
}

interface PreparedRequest {
  provider: ProviderRow;
  model: ModelRow;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  variables: JsonRecord;
  timeoutMs: number;
  includeSecret: boolean;
}

interface ExecutedResult {
  images: Array<{ url: string; mimeType?: string }>;
  requestId?: string;
  taskId?: string;
  raw: unknown;
}

interface AsyncSnapshot {
  state: "pending" | "success" | "failure";
  status: string;
  body: unknown;
  result?: ExecutedResult;
  error?: string;
}

function toAdminModel(row: ModelRow): AdminApiProviderModel {
  return {
    provider: row.provider_id,
    model: row.model_id,
    apiModelId: row.api_model_id || row.model_id,
    name: row.display_name,
    description: row.description,
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sort_order) || 500,
    sizes: parseStringArray(row.sizes_json, ["1024x1024"]),
    qualities: parseStringArray(row.qualities_json, []),
    maxOutputImages: Number(row.max_output_images) || 1,
    supportsReferenceImages: Boolean(row.supports_reference_images),
    maxReferenceImages: Number(row.max_reference_images) || 0,
    supportsNegativePrompt: Boolean(row.supports_negative_prompt),
    supportsSeed: Boolean(row.supports_seed),
    sizeMapping: parseJsonRecord(row.size_mapping_json, {}),
    requestOverrides: parseJsonRecord(row.request_overrides_json, {}),
    points: Number(row.unit_credit_cents) / 100,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function buildVariables(
  request: GenerateImageRequest,
  model: ModelRow,
  apiKey: string
): JsonRecord {
  const sizeMapping = parseJsonRecord(model.size_mapping_json, {});
  const mappedSize = typeof sizeMapping[request.size] === "string"
    ? String(sizeMapping[request.size])
    : request.size;
  const sizeMatch = /^(\d+)x(\d+)$/.exec(mappedSize);
  const references = request.images.map((image) => image.dataUrl);

  const variables: JsonRecord = {
    model: request.model,
    api_model_id: model.api_model_id || model.model_id,
    apiModelId: model.api_model_id || model.model_id,
    prompt: request.prompt,
    negative_prompt: request.negativePrompt,
    negativePrompt: request.negativePrompt,
    size: mappedSize,
    original_size: request.size,
    count: request.count,
    n: request.count,
    quality: request.quality,
    seed: request.seed,
    operation: request.operation,
    reference_images: references,
    referenceImages: references,
    api_key: apiKey,
    apiKey,
    width: sizeMatch ? Number(sizeMatch[1]) : undefined,
    height: sizeMatch ? Number(sizeMatch[2]) : undefined
  };

  references.forEach((image, index) => {
    variables[`reference_image_${index + 1}`] = image;
  });
  return variables;
}

function renderTemplate(value: unknown, variables: JsonRecord): unknown {
  if (typeof value === "string") {
    const exact = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(value);
    if (exact) {
      const result = variables[exact[1]!];
      if (result === undefined || result === null || result === "") return undefined;
      if (Array.isArray(result) && result.length === 0) return undefined;
      return result;
    }
    return value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key) => {
      const result = variables[String(key)];
      return result === undefined || result === null ? "" : String(result);
    });
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => renderTemplate(item, variables))
      .filter((item) => item !== undefined);
  }
  if (isRecord(value)) {
    const output: JsonRecord = {};
    for (const [key, item] of Object.entries(value)) {
      const rendered = renderTemplate(item, variables);
      if (rendered !== undefined) output[key] = rendered;
    }
    return output;
  }
  return value;
}

function deepMerge(base: JsonRecord, override: JsonRecord): JsonRecord {
  const result: JsonRecord = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = deepMerge(result[key] as JsonRecord, value);
    } else if (value === null) {
      delete result[key];
    } else {
      result[key] = value;
    }
  }
  return result;
}

function extractImagesByMapping(
  body: unknown,
  mapping: JsonRecord
): Array<{ url: string; mimeType?: string }> {
  const images: Array<{ url: string; mimeType?: string }> = [];
  const urlPath = stringValue(mapping.imageUrlPath);
  const base64Path = stringValue(mapping.imageBase64Path);

  if (urlPath) {
    for (const value of readPathValues(body, urlPath)) {
      const url = extractStringFromValue(value);
      if (url) images.push({ url });
    }
  }

  if (base64Path) {
    for (const value of readPathValues(body, base64Path)) {
      const base64 = extractStringFromValue(value);
      if (!base64) continue;
      images.push({
        url: base64.startsWith("data:image/")
          ? base64
          : `data:image/png;base64,${base64}`,
        mimeType: "image/png"
      });
    }
  }

  if (images.length === 0) {
    return extractImagesFallback(body);
  }
  return dedupeImages(images);
}

function readPathValues(root: unknown, path: string): unknown[] {
  if (!path.trim()) return [];
  const normalized = path
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/\[\*\]/g, ".*")
    .replace(/^\./, "");
  const tokens = normalized.split(".").filter(Boolean);
  let current: unknown[] = [root];

  for (const token of tokens) {
    const next: unknown[] = [];
    for (const item of current) {
      if (token === "*") {
        if (Array.isArray(item)) next.push(...item);
        else if (isRecord(item)) next.push(...Object.values(item));
        continue;
      }
      if (Array.isArray(item) && /^\d+$/.test(token)) {
        const index = Number(token);
        if (index < item.length) next.push(item[index]);
        continue;
      }
      if (isRecord(item) && token in item) {
        next.push(item[token]);
      }
    }
    current = next;
    if (current.length === 0) break;
  }
  return current.filter((item) => item !== undefined && item !== null);
}

function readFirstPath(root: unknown, path?: string): unknown {
  return path ? readPathValues(root, path)[0] : undefined;
}

function extractStringFromValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isRecord(value)) {
    return firstString(
      value.url,
      value.image_url,
      value.imageUrl,
      value.b64_json,
      value.base64
    );
  }
  return undefined;
}

function extractImagesFallback(body: any): Array<{ url: string; mimeType?: string }> {
  const candidates: unknown[] = [];
  for (const value of [
    body?.data,
    body?.images,
    body?.output,
    body?.result?.data,
    body?.result?.images
  ]) {
    if (Array.isArray(value)) candidates.push(...value);
  }
  if (typeof body?.url === "string") candidates.push(body.url);

  const images: Array<{ url: string; mimeType?: string }> = [];
  for (const item of candidates) {
    if (typeof item === "string") {
      images.push({ url: item });
      continue;
    }
    if (!isRecord(item)) continue;
    const url = firstString(item.url, item.image_url, item.imageUrl);
    if (url) {
      images.push({ url });
      continue;
    }
    const base64 = firstString(item.b64_json, item.base64, item.image_base64);
    if (base64) {
      images.push({
        url: base64.startsWith("data:image/")
          ? base64
          : `data:image/png;base64,${base64}`,
        mimeType: "image/png"
      });
    }
  }
  return dedupeImages(images);
}

function dedupeImages<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function readAuthConfig(row: ProviderRow): {
  type: AuthType;
  headerName: string;
  scheme: string;
  queryName: string;
} {
  const raw = parseJsonRecord(row.auth_config_json, {});
  const typeRaw = String(raw.type || "").toLowerCase();
  const type: AuthType = ["bearer", "header", "query", "none"].includes(typeRaw)
    ? typeRaw as AuthType
    : (row.auth_header ? (row.auth_scheme ? "bearer" : "header") : "none");
  return {
    type,
    headerName: String(raw.headerName || row.auth_header || "Authorization"),
    scheme: String(raw.scheme ?? row.auth_scheme ?? (type === "bearer" ? "Bearer" : "")),
    queryName: String(raw.queryName || "api_key")
  };
}

function normalizeAuthConfig(input: Record<string, unknown>): {
  type: AuthType;
  headerName: string;
  scheme: string;
  queryName: string;
} {
  const raw = String(input.authType ?? input.type ?? "bearer").trim().toLowerCase();
  if (!["bearer", "header", "query", "none"].includes(raw)) {
    throw new AuthError(400, "INVALID_AUTH_TYPE", "认证方式不正确");
  }
  const type = raw as AuthType;
  return {
    type,
    headerName: optionalText(input.authHeader ?? input.headerName, 80)
      || (type === "bearer" ? "Authorization" : "X-API-Key"),
    scheme: input.authScheme !== undefined || input.scheme !== undefined
      ? String(input.authScheme ?? input.scheme ?? "").trim().slice(0, 40)
      : (type === "bearer" ? "Bearer" : ""),
    queryName: optionalText(input.authQueryName ?? input.queryName, 80) || "api_key"
  };
}

function hasAnyAuthField(input: Record<string, unknown>): boolean {
  return ["authType", "type", "authHeader", "headerName", "authScheme", "scheme", "authQueryName", "queryName"]
    .some((key) => input[key] !== undefined);
}

function readRequestTemplate(row: ProviderRow): JsonRecord {
  return parseJsonRecord(row.request_template_json, DEFAULT_TEMPLATE);
}

function readResponseMapping(row: ProviderRow): JsonRecord {
  return parseJsonRecord(row.response_mapping_json, DEFAULT_RESPONSE_MAPPING);
}

function readAsyncConfig(row: ProviderRow): JsonRecord {
  return parseJsonRecord(row.async_config_json, DEFAULT_ASYNC_CONFIG);
}

function normalizeAsyncConfig(value: unknown): JsonRecord {
  const config = normalizeJsonRecordInput(value, DEFAULT_ASYNC_CONFIG, 40000, "异步任务配置 JSON 格式不正确");
  return deepMerge(DEFAULT_ASYNC_CONFIG, config);
}

function normalizeProviderId(value: unknown): string {
  const id = requiredText(value, 40, "请输入服务商标识").toLocaleLowerCase("en-US");
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) {
    throw new AuthError(
      400,
      "INVALID_PROVIDER_ID",
      "服务商标识需为 2–40 位小写字母、数字、下划线或连字符"
    );
  }
  return id;
}

function normalizeBaseUrl(value: unknown): string {
  const text = requiredText(value, 500, "请输入 Base URL");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new AuthError(400, "INVALID_BASE_URL", "Base URL 格式不正确");
  }
  if (
    url.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && url.protocol === "http:")
  ) {
    throw new AuthError(400, "INSECURE_BASE_URL", "生产环境中的 API Base URL 必须使用 HTTPS");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function normalizeEndpoint(value: unknown): string {
  const endpoint = requiredText(value, 300, "请输入生图接口路径");
  if (!endpoint.startsWith("/") && !/^https?:\/\//i.test(endpoint)) {
    throw new AuthError(400, "INVALID_ENDPOINT", "接口路径必须以 / 开头，或填写完整 HTTPS URL");
  }
  return endpoint;
}

function normalizeMethodInput(value: unknown): string {
  return normalizeMethod(requiredText(value ?? "POST", 12, "请输入请求方式"));
}

function normalizeMethod(value: string): string {
  const method = String(value || "POST").trim().toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) {
    throw new AuthError(400, "INVALID_REQUEST_METHOD", "请求方式仅支持 GET/POST/PUT/PATCH/DELETE/HEAD");
  }
  return method;
}

function normalizeAdapter(value: unknown): AdapterType {
  return value === "openai-images-json" ? "openai-images-json" : "template-json";
}

function normalizeSizes(value: unknown): string[] {
  // V14_3_0_1_DESCRIPTIVE_SIZE_LABELS
  // sizes are front-end display labels. The actual provider value is resolved
  // separately through size_mapping_json, so descriptive labels such as
  // "4K 正方形 (1:1)" must remain valid.
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，\n]/)
      : [];

  const normalized = items
    .map((item) => String(item).trim())
    .filter(Boolean);

  const tooLong = normalized.find((item) => item.length > 80);
  if (tooLong) {
    throw new AuthError(
      400,
      "INVALID_MODEL_SIZE_LABEL",
      "尺寸名称不能超过 80 个字符"
    );
  }

  const result = Array.from(new Set(normalized)).slice(0, 40);
  if (result.length < 1) {
    throw new AuthError(
      400,
      "INVALID_MODEL_SIZES",
      "至少填写一个尺寸或比例选项"
    );
  }
  return result;
}

function normalizeQualities(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，\n]/)
      : [];
  return Array.from(
    new Set(items.map((item) => String(item).trim()).filter(Boolean))
  ).slice(0, 20);
}

function parseStringArray(value: unknown, fallback: string[]): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) {
      const list = parsed.map(String).map((item) => item.trim()).filter(Boolean);
      if (list.length) return list;
    }
  } catch {
    // ignore
  }
  return [...fallback];
}

function parseJsonRecord(value: unknown, fallback: JsonRecord): JsonRecord {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (isRecord(parsed)) return parsed;
  } catch {
    // ignore
  }
  return structuredCloneSafe(fallback);
}

function normalizeJsonRecordInput(
  value: unknown,
  fallback: JsonRecord,
  maxLength: number,
  message: string
): JsonRecord {
  if (value === undefined || value === null || value === "") {
    return structuredCloneSafe(fallback);
  }
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (value.length > maxLength) throw new AuthError(400, "JSON_TOO_LARGE", message);
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new AuthError(400, "INVALID_JSON", message);
    }
  }
  if (!isRecord(parsed)) throw new AuthError(400, "INVALID_JSON_OBJECT", message);
  const encoded = JSON.stringify(parsed);
  if (encoded.length > maxLength) throw new AuthError(400, "JSON_TOO_LARGE", message);
  return parsed;
}

function normalizePoints(value: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1_000_000) {
    throw new AuthError(400, "INVALID_MODEL_PRICE", "积分价格需为 0–1,000,000");
  }
  return Math.round(numeric * 100) / 100;
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  message: string
): number {
  const numeric = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new AuthError(400, "INVALID_INTEGER", message);
  }
  return numeric;
}

function boundedConfigNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max
    ? numeric
    : fallback;
}

function normalizeBoolean(value: unknown): boolean {
  if (value === true || value === false) return value;
  throw new AuthError(400, "INVALID_BOOLEAN", "布尔参数格式不正确");
}

function requiredText(value: unknown, maxLength: number, message: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength) {
    throw new AuthError(400, "INVALID_TEXT", message);
  }
  return text;
}

function requiredConfigText(value: unknown, message: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ProviderHttpError(message, 500);
  return text;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.slice(0, maxLength);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function providerConfigured(row: ProviderRow): boolean {
  const auth = readAuthConfig(row);
  return auth.type === "none" || Boolean(row.api_key_ciphertext);
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
  if (!value) return "";
  const [version, ivText, tagText, encryptedText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("API Key 密文格式不正确");
  }
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
      "服务端必须单独配置长度至少 32 位的随机 API_PROVIDER_SECRET"
    );
  }
  return createHash("sha256").update(secret).digest();
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function joinUrl(baseUrl: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return baseUrl.replace(/\/+$/, "") + "/" + endpoint.replace(/^\/+/, "");
}

function modelKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function isBuiltInProvider(provider: string): boolean {
  return new Set(["lingke", "grsai", "nanobanana"]).has(provider);
}

function isDuplicateEntry(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ER_DUP_ENTRY"
  );
}

function toIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeStatusSet(value: unknown, fallback: string[]): Set<string> {
  const items = Array.isArray(value) ? value : fallback;
  return new Set(items.map((item) => String(item).trim().toUpperCase()).filter(Boolean));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeMimeType(value: unknown): "image/jpeg" | "image/png" | "image/webp" {
  return value === "image/jpeg" || value === "image/webp" ? value : "image/png";
}

function redactPrepared(prepared: PreparedRequest): AdminProviderTestResult["request"] {
  const headers: Record<string, string> = {};
  let secret = "";
  try {
    secret = prepared.provider.api_key_ciphertext
      ? decryptSecret(prepared.provider.api_key_ciphertext)
      : "";
  } catch {
    secret = "";
  }
  for (const [key, value] of Object.entries(prepared.headers)) {
    const containsSecret = Boolean(secret && value.includes(secret));
    headers[key] = /(authorization|api.?key|token|secret)/i.test(key) || containsSecret
      ? "[REDACTED]"
      : value;
  }
  let url = prepared.url;
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/(api.?key|token|secret)/i.test(key)) parsed.searchParams.set(key, "[REDACTED]");
    }
    url = parsed.toString();
  } catch {
    // keep original
  }
  return {
    method: prepared.method,
    url,
    headers,
    body: redactProviderDetails(prepared.body)
  };
}

export type CustomProviderService = ReturnType<typeof createCustomProviderService>;

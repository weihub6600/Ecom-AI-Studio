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
  fetchWithTimeout,
  readJsonResponse
} from "../utils/http.js";

type ApiProviderAdapter =
  "openai-images-json";

interface ProviderRow extends RowDataPacket {
  id: string;
  display_name: string;
  base_url: string;
  endpoint: string;
  adapter: ApiProviderAdapter;
  api_key_ciphertext: string;
  auth_header: string;
  auth_scheme: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface ModelRow extends RowDataPacket {
  provider_id: string;
  model_id: string;
  display_name: string;
  description: string;
  enabled: number;
  sizes_json: string;
  max_output_images: number;
  supports_negative_prompt: number;
  supports_seed: number;
  unit_credit_cents: number;
  created_at: string;
  updated_at: string;
}

interface CollationRow extends RowDataPacket {
  COLLATION_NAME: string | null;
}

export interface AdminApiProvider {
  id: string;
  displayName: string;
  baseUrl: string;
  endpoint: string;
  adapter: ApiProviderAdapter;
  apiKeyConfigured: boolean;
  authHeader: string;
  authScheme: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  models: AdminApiProviderModel[];
}

export interface AdminApiProviderModel {
  provider: string;
  model: string;
  name: string;
  description: string;
  enabled: boolean;
  sizes: string[];
  maxOutputImages: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
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
  capability: ModelCapability;
  updatedAt?: string;
}

export function createCustomProviderService(
  database: AppDatabase
) {
  const {
    pool
  } = database;

  const providers =
    new Map<string, ProviderRow>();

  const models =
    new Map<string, CustomRuntimeModel>();

  let initialized = false;

  async function initialize():
    Promise<void> {
    const collation =
      await resolveCoreCollation();

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_api_providers (
        id VARCHAR(40) NOT NULL PRIMARY KEY,
        display_name VARCHAR(120) NOT NULL,
        base_url VARCHAR(500) NOT NULL,
        endpoint VARCHAR(300) NOT NULL,
        adapter VARCHAR(40) NOT NULL,
        api_key_ciphertext TEXT NOT NULL,
        auth_header VARCHAR(80) NOT NULL DEFAULT 'Authorization',
        auth_scheme VARCHAR(40) NOT NULL DEFAULT 'Bearer',
        enabled TINYINT(1) NOT NULL DEFAULT 1,
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
        display_name VARCHAR(160) NOT NULL,
        description VARCHAR(500) NOT NULL DEFAULT '',
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        sizes_json JSON NOT NULL,
        max_output_images INT UNSIGNED NOT NULL DEFAULT 1,
        supports_negative_prompt TINYINT(1) NOT NULL DEFAULT 0,
        supports_seed TINYINT(1) NOT NULL DEFAULT 0,
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

    initialized = true;
    await reload();
  }

  async function ensureInitialized():
    Promise<void> {
    if (!initialized) {
      await initialize();
    }
  }

  async function reload():
    Promise<void> {
    const [
      providerResult,
      modelResult
    ] =
      await Promise.all([
        pool.query<ProviderRow[]>(
          `SELECT *
           FROM app_api_providers
           ORDER BY created_at ASC`
        ),
        pool.query<ModelRow[]>(
          `SELECT *
           FROM app_api_provider_models
           ORDER BY created_at ASC`
        )
      ]);

    providers.clear();
    models.clear();

    for (
      const row of
        providerResult[0]
    ) {
      providers.set(
        row.id,
        row
      );
    }

    for (
      const row of
        modelResult[0]
    ) {
      const provider =
        providers.get(
          row.provider_id
        );

      if (!provider) continue;

      const capability:
        ModelCapability = {
          id: row.model_id,
          provider:
            row.provider_id,
          providerName:
            provider.display_name,
          name:
            row.display_name,
          description:
            row.description,
          configured:
            Boolean(
              provider.api_key_ciphertext
            ),
          supportsReferenceImages:
            false,
          maxReferenceImages: 0,
          supportsNegativePrompt:
            Boolean(
              row.supports_negative_prompt
            ),
          supportsSeed:
            Boolean(
              row.supports_seed
            ),
          sizes:
            parseStringArray(
              row.sizes_json
            ),
          qualities: [
            "auto",
            "high",
            "medium",
            "low"
          ],
          maxOutputImages:
            Math.max(
              1,
              Number(
                row.max_output_images
              )
            ),
          asynchronous: false
        };

      models.set(
        modelKey(
          row.provider_id,
          row.model_id
        ),
        {
          provider:
            row.provider_id,
          model: row.model_id,
          name:
            row.display_name,
          providerName:
            provider.display_name,
          enabled:
            Boolean(
              provider.enabled
            ) &&
            Boolean(row.enabled),
          points:
            Number(
              row.unit_credit_cents
            ) / 100,
          configured:
            Boolean(
              provider.api_key_ciphertext
            ),
          capability,
          updatedAt:
            toIso(
              row.updated_at
            )
        }
      );
    }
  }

  function listPublicModels():
    Array<
      ModelCapability & {
        creditCost: number
      }
    > {
    return Array
      .from(
        models.values()
      )
      .filter(
        (item) =>
          item.enabled
      )
      .map(
        (item) => ({
          ...item.capability,
          creditCost:
            item.points
        })
      );
  }

  function getRuntimeModel(
    provider: string,
    model: string
  ):
    CustomRuntimeModel |
    undefined {
    return models.get(
      modelKey(
        provider,
        model
      )
    );
  }

  function hasProvider(
    provider: string
  ): boolean {
    return providers.has(
      provider
    );
  }

  async function listAdmin():
    Promise<AdminApiProvider[]> {
    await ensureInitialized();

    const providerModels =
      new Map<
        string,
        AdminApiProviderModel[]
      >();

    for (
      const item of
        models.values()
    ) {
      const row =
        (
          await pool.query<ModelRow[]>(
            `SELECT *
             FROM app_api_provider_models
             WHERE
               provider_id = ?
               AND model_id = ?
             LIMIT 1`,
            [
              item.provider,
              item.model
            ]
          )
        )[0][0];

      if (!row) continue;

      const list =
        providerModels.get(
          item.provider
        ) || [];

      list.push(
        toAdminModel(row)
      );

      providerModels.set(
        item.provider,
        list
      );
    }

    return Array
      .from(
        providers.values()
      )
      .map(
        (row) => ({
          id: row.id,
          displayName:
            row.display_name,
          baseUrl:
            row.base_url,
          endpoint:
            row.endpoint,
          adapter:
            row.adapter,
          apiKeyConfigured:
            Boolean(
              row.api_key_ciphertext
            ),
          authHeader:
            row.auth_header,
          authScheme:
            row.auth_scheme,
          enabled:
            Boolean(row.enabled),
          createdAt:
            toIso(
              row.created_at
            ),
          updatedAt:
            toIso(
              row.updated_at
            ),
          models:
            providerModels.get(
              row.id
            ) || []
        })
      );
  }

  async function createProvider(
    input: Record<
      string,
      unknown
    >,
    actorUserId: string
  ):
    Promise<AdminApiProvider> {
    await ensureInitialized();

    const id =
      normalizeProviderId(
        input.id
      );

    if (
      isBuiltInProvider(id)
    ) {
      throw new AuthError(
        409,
        "PROVIDER_ID_RESERVED",
        "该服务商标识已被系统内置服务商占用"
      );
    }

    const displayName =
      requiredText(
        input.displayName,
        120,
        "请输入服务商名称"
      );

    const baseUrl =
      normalizeBaseUrl(
        input.baseUrl
      );

    const endpoint =
      normalizeEndpoint(
        input.endpoint
      );

    const apiKey =
      requiredText(
        input.apiKey,
        4000,
        "请输入 API Key"
      );

    const authHeader =
      optionalText(
        input.authHeader,
        80
      ) ||
      "Authorization";

    const authScheme =
      optionalText(
        input.authScheme,
        40
      ) ??
      "Bearer";

    const now =
      new Date();

    try {
      await pool.execute<
        ResultSetHeader
      >(
        `INSERT INTO app_api_providers (
          id,
          display_name,
          base_url,
          endpoint,
          adapter,
          api_key_ciphertext,
          auth_header,
          auth_scheme,
          enabled,
          created_by_user_id,
          created_at,
          updated_at
        ) VALUES (
          ?, ?, ?, ?,
          'openai-images-json',
          ?, ?, ?, 1, ?, ?, ?
        )`,
        [
          id,
          displayName,
          baseUrl,
          endpoint,
          encryptSecret(apiKey),
          authHeader,
          authScheme,
          actorUserId,
          now,
          now
        ]
      );
    }
    catch (error) {
      if (
        isDuplicateEntry(
          error
        )
      ) {
        throw new AuthError(
          409,
          "PROVIDER_EXISTS",
          "服务商标识已经存在"
        );
      }

      throw error;
    }

    await reload();

    const created =
      (
        await listAdmin()
      ).find(
        (item) =>
          item.id === id
      );

    if (!created) {
      throw new Error(
        "新增服务商后读取失败"
      );
    }

    return created;
  }

  async function updateProvider(
    providerId: string,
    input: Record<
      string,
      unknown
    >
  ):
    Promise<AdminApiProvider> {
    await ensureInitialized();

    const current =
      providers.get(
        providerId
      );

    if (!current) {
      throw new AuthError(
        404,
        "PROVIDER_NOT_FOUND",
        "API 服务商不存在"
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

    const endpoint =
      input.endpoint ===
        undefined
        ? current.endpoint
        : normalizeEndpoint(
            input.endpoint
          );

    const authHeader =
      input.authHeader ===
        undefined
        ? current.auth_header
        : (
            optionalText(
              input.authHeader,
              80
            ) ||
            "Authorization"
          );

    const authScheme =
      input.authScheme ===
        undefined
        ? current.auth_scheme
        : (
            optionalText(
              input.authScheme,
              40
            ) ??
            ""
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

    const apiKey =
      optionalText(
        input.apiKey,
        4000
      );

    await pool.execute(
      `UPDATE app_api_providers
       SET
         display_name = ?,
         base_url = ?,
         endpoint = ?,
         api_key_ciphertext =
           CASE
             WHEN ? IS NULL
             THEN api_key_ciphertext
             ELSE ?
           END,
         auth_header = ?,
         auth_scheme = ?,
         enabled = ?,
         updated_at = ?
       WHERE id = ?`,
      [
        displayName,
        baseUrl,
        endpoint,
        apiKey || null,
        apiKey
          ? encryptSecret(apiKey)
          : "",
        authHeader,
        authScheme,
        enabled ? 1 : 0,
        new Date(),
        providerId
      ]
    );

    await reload();

    return requireAdminProvider(
      providerId
    );
  }

  async function deleteProvider(
    providerId: string
  ):
    Promise<void> {
    await ensureInitialized();

    const result =
      await pool.execute<
        ResultSetHeader
      >(
        `DELETE FROM
           app_api_providers
         WHERE id = ?`,
        [providerId]
      );

    if (
      result[0]
        .affectedRows < 1
    ) {
      throw new AuthError(
        404,
        "PROVIDER_NOT_FOUND",
        "API 服务商不存在"
      );
    }

    await reload();
  }

  async function createModel(
    providerId: string,
    input: Record<
      string,
      unknown
    >
  ):
    Promise<AdminApiProviderModel> {
    await ensureInitialized();

    if (
      !providers.has(
        providerId
      )
    ) {
      throw new AuthError(
        404,
        "PROVIDER_NOT_FOUND",
        "请先新增 API 服务商"
      );
    }

    const model =
      requiredText(
        input.model,
        160,
        "请输入模型 ID"
      );

    const name =
      requiredText(
        input.name,
        160,
        "请输入模型显示名称"
      );

    const description =
      optionalText(
        input.description,
        500
      ) || "";

    const sizes =
      normalizeSizes(
        input.sizes
      );

    const maxOutputImages =
      boundedInteger(
        input.maxOutputImages,
        1,
        4,
        1,
        "单次出图数量需为 1–4"
      );

    const supportsNegativePrompt =
      input.supportsNegativePrompt ===
        undefined
        ? false
        : normalizeBoolean(
            input.supportsNegativePrompt
          );

    const supportsSeed =
      input.supportsSeed ===
        undefined
        ? false
        : normalizeBoolean(
            input.supportsSeed
          );

    const points =
      normalizePoints(
        input.points
      );

    const now =
      new Date();

    try {
      await pool.execute<
        ResultSetHeader
      >(
        `INSERT INTO
           app_api_provider_models (
             provider_id,
             model_id,
             display_name,
             description,
             enabled,
             sizes_json,
             max_output_images,
             supports_negative_prompt,
             supports_seed,
             unit_credit_cents,
             created_at,
             updated_at
           ) VALUES (
             ?, ?, ?, ?, 1,
             ?, ?, ?, ?, ?, ?, ?
           )`,
        [
          providerId,
          model,
          name,
          description,
          JSON.stringify(sizes),
          maxOutputImages,
          supportsNegativePrompt
            ? 1
            : 0,
          supportsSeed
            ? 1
            : 0,
          Math.round(
            points * 100
          ),
          now,
          now
        ]
      );
    }
    catch (error) {
      if (
        isDuplicateEntry(
          error
        )
      ) {
        throw new AuthError(
          409,
          "MODEL_EXISTS",
          "该服务商下的模型 ID 已存在"
        );
      }

      throw error;
    }

    await reload();

    return requireAdminModel(
      providerId,
      model
    );
  }

  async function updateModel(
    providerId: string,
    modelId: string,
    input: Record<
      string,
      unknown
    >
  ):
    Promise<AdminApiProviderModel> {
    await ensureInitialized();

    const current =
      await readModelRow(
        providerId,
        modelId
      );

    if (!current) {
      throw new AuthError(
        404,
        "MODEL_NOT_FOUND",
        "自定义模型不存在"
      );
    }

    const name =
      input.name ===
        undefined
        ? current.display_name
        : requiredText(
            input.name,
            160,
            "请输入模型显示名称"
          );

    const description =
      input.description ===
        undefined
        ? current.description
        : (
            optionalText(
              input.description,
              500
            ) || ""
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

    const sizes =
      input.sizes ===
        undefined
        ? parseStringArray(
            current.sizes_json
          )
        : normalizeSizes(
            input.sizes
          );

    const maxOutputImages =
      input.maxOutputImages ===
        undefined
        ? Number(
            current.max_output_images
          )
        : boundedInteger(
            input.maxOutputImages,
            1,
            4,
            1,
            "单次出图数量需为 1–4"
          );

    const supportsNegativePrompt =
      input.supportsNegativePrompt ===
        undefined
        ? Boolean(
            current
              .supports_negative_prompt
          )
        : normalizeBoolean(
            input
              .supportsNegativePrompt
          );

    const supportsSeed =
      input.supportsSeed ===
        undefined
        ? Boolean(
            current.supports_seed
          )
        : normalizeBoolean(
            input.supportsSeed
          );

    const points =
      input.points ===
        undefined
        ? Number(
            current
              .unit_credit_cents
          ) / 100
        : normalizePoints(
            input.points
          );

    await pool.execute(
      `UPDATE
         app_api_provider_models
       SET
         display_name = ?,
         description = ?,
         enabled = ?,
         sizes_json = ?,
         max_output_images = ?,
         supports_negative_prompt = ?,
         supports_seed = ?,
         unit_credit_cents = ?,
         updated_at = ?
       WHERE
         provider_id = ?
         AND model_id = ?`,
      [
        name,
        description,
        enabled ? 1 : 0,
        JSON.stringify(sizes),
        maxOutputImages,
        supportsNegativePrompt
          ? 1
          : 0,
        supportsSeed
          ? 1
          : 0,
        Math.round(
          points * 100
        ),
        new Date(),
        providerId,
        modelId
      ]
    );

    await reload();

    return requireAdminModel(
      providerId,
      modelId
    );
  }

  async function deleteModel(
    providerId: string,
    modelId: string
  ):
    Promise<void> {
    await ensureInitialized();

    const result =
      await pool.execute<
        ResultSetHeader
      >(
        `DELETE FROM
           app_api_provider_models
         WHERE
           provider_id = ?
           AND model_id = ?`,
        [
          providerId,
          modelId
        ]
      );

    if (
      result[0]
        .affectedRows < 1
    ) {
      throw new AuthError(
        404,
        "MODEL_NOT_FOUND",
        "自定义模型不存在"
      );
    }

    await reload();
  }

  async function generate(
    request:
      GenerateImageRequest
  ):
    Promise<
      GenerateImageResult
    > {
    await ensureInitialized();

    const runtime =
      getRuntimeModel(
        request.provider,
        request.model
      );

    if (
      !runtime ||
      !runtime.enabled
    ) {
      throw new AuthError(
        404,
        "MODEL_NOT_FOUND",
        "自定义模型不存在或未启用"
      );
    }

    const provider =
      providers.get(
        request.provider
      );

    if (
      !provider ||
      !provider.enabled
    ) {
      throw new AuthError(
        400,
        "PROVIDER_DISABLED",
        "API 服务商未启用"
      );
    }

    if (
      request.images.length > 0
    ) {
      throw new AuthError(
        400,
        "CUSTOM_PROVIDER_IMAGE_EDIT_UNSUPPORTED",
        "当前自定义服务商适配器仅支持文字生成图片"
      );
    }

    const apiKey =
      decryptSecret(
        provider
          .api_key_ciphertext
      );

    const url =
      joinUrl(
        provider.base_url,
        provider.endpoint
      );

    const headers:
      Record<string, string> = {
        "Content-Type":
          "application/json"
      };

    if (
      provider.auth_header &&
      apiKey
    ) {
      headers[
        provider.auth_header
      ] =
        provider.auth_scheme
          ? `${provider.auth_scheme} ${apiKey}`
          : apiKey;
    }

    const startedAt =
      Date.now();

    const response =
      await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers,
          body:
            JSON.stringify({
              model:
                request.model,
              prompt:
                request.prompt,
              size:
                request.size,
              n:
                request.count,
              quality:
                request.quality,
              negative_prompt:
                request.negativePrompt,
              seed:
                request.seed,
              response_format:
                "url"
            })
        },
        Number(
          process.env
            .CUSTOM_PROVIDER_TIMEOUT_MS ||
          300_000
        )
      );

    const body =
      await readJsonResponse(
        response
      );

    const images =
      extractImages(body);

    if (
      images.length < 1
    ) {
      throw new ProviderHttpError(
        "自定义服务商未返回可识别的图片 URL 或 Base64 数据",
        502
      );
    }

    return {
      provider:
        request.provider,
      model:
        request.model,
      images:
        images.slice(
          0,
          request.count
        ),
      durationMs:
        Date.now() -
        startedAt,
      requestId:
        firstString(
          body?.id,
          body?.request_id,
          body?.requestId
        ),
      status: "completed"
    };
  }

  async function resolveCoreCollation():
    Promise<string> {
    const [rows] =
      await pool.query<
        CollationRow[]
      >(
        `SELECT COLLATION_NAME
         FROM information_schema.COLUMNS
         WHERE
           TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'app_users'
           AND COLUMN_NAME = 'id'
         LIMIT 1`
      );

    const collation =
      rows[0]?.COLLATION_NAME ||
      "utf8mb4_0900_ai_ci";

    if (
      !/^[A-Za-z0-9_]+$/.test(
        collation
      )
    ) {
      throw new Error(
        "读取到无效的数据库排序规则"
      );
    }

    return collation;
  }

  async function requireAdminProvider(
    providerId: string
  ):
    Promise<AdminApiProvider> {
    const item =
      (
        await listAdmin()
      ).find(
        (provider) =>
          provider.id ===
          providerId
      );

    if (!item) {
      throw new AuthError(
        404,
        "PROVIDER_NOT_FOUND",
        "API 服务商不存在"
      );
    }

    return item;
  }

  async function requireAdminModel(
    providerId: string,
    modelId: string
  ):
    Promise<
      AdminApiProviderModel
    > {
    const row =
      await readModelRow(
        providerId,
        modelId
      );

    if (!row) {
      throw new AuthError(
        404,
        "MODEL_NOT_FOUND",
        "自定义模型不存在"
      );
    }

    return toAdminModel(row);
  }

  async function readModelRow(
    providerId: string,
    modelId: string
  ):
    Promise<
      ModelRow |
      undefined
    > {
    const [rows] =
      await pool.query<
        ModelRow[]
      >(
        `SELECT *
         FROM
           app_api_provider_models
         WHERE
           provider_id = ?
           AND model_id = ?
         LIMIT 1`,
        [
          providerId,
          modelId
        ]
      );

    return rows[0];
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
    createModel,
    updateModel,
    deleteModel,
    generate
  };
}

function toAdminModel(
  row: ModelRow
):
  AdminApiProviderModel {
  return {
    provider:
      row.provider_id,
    model:
      row.model_id,
    name:
      row.display_name,
    description:
      row.description,
    enabled:
      Boolean(row.enabled),
    sizes:
      parseStringArray(
        row.sizes_json
      ),
    maxOutputImages:
      Number(
        row.max_output_images
      ),
    supportsNegativePrompt:
      Boolean(
        row.supports_negative_prompt
      ),
    supportsSeed:
      Boolean(
        row.supports_seed
      ),
    points:
      Number(
        row.unit_credit_cents
      ) / 100,
    createdAt:
      toIso(
        row.created_at
      ),
    updatedAt:
      toIso(
        row.updated_at
      )
  };
}

function normalizeProviderId(
  value: unknown
): string {
  const id =
    requiredText(
      value,
      40,
      "请输入服务商标识"
    )
      .toLocaleLowerCase(
        "en-US"
      );

  if (
    !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(
      id
    )
  ) {
    throw new AuthError(
      400,
      "INVALID_PROVIDER_ID",
      "服务商标识需为 2–40 位小写字母、数字、下划线或连字符"
    );
  }

  return id;
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
      "生产环境中的 API Base URL 必须使用 HTTPS"
    );
  }

  url.pathname =
    url.pathname.replace(
      /\/+$/,
      ""
    );

  return url.toString()
    .replace(/\/$/, "");
}

function normalizeEndpoint(
  value: unknown
): string {
  const endpoint =
    requiredText(
      value,
      300,
      "请输入生图接口路径"
    );

  if (
    !endpoint.startsWith("/")
  ) {
    throw new AuthError(
      400,
      "INVALID_ENDPOINT",
      "接口路径必须以 / 开头"
    );
  }

  return endpoint;
}

function normalizeSizes(
  value: unknown
): string[] {
  const items =
    Array.isArray(value)
      ? value
      : typeof value ===
          "string"
        ? value.split(
            /[,，\n]/
          )
        : [];

  const result =
    Array.from(
      new Set(
        items
          .map(
            (item) =>
              String(item)
                .trim()
          )
          .filter(
            (item) =>
              /^(auto|\d+:\d+|\d+x\d+)$/.test(
                item
              )
          )
      )
    ).slice(0, 30);

  if (
    result.length < 1
  ) {
    throw new AuthError(
      400,
      "INVALID_MODEL_SIZES",
      "至少填写一个尺寸，例如 1024x1024"
    );
  }

  return result;
}

function parseStringArray(
  value: unknown
): string[] {
  try {
    const parsed =
      typeof value ===
        "string"
        ? JSON.parse(value)
        : value;

    if (
      Array.isArray(parsed)
    ) {
      return parsed
        .map(String)
        .filter(Boolean);
    }
  }
  catch {
    // Fall through.
  }

  return [
    "1024x1024"
  ];
}

function normalizePoints(
  value: unknown
): number {
  const numeric =
    typeof value ===
      "number"
      ? value
      : typeof value ===
          "string" &&
          value.trim()
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isFinite(
      numeric
    ) ||
    numeric < 0 ||
    numeric > 1_000_000
  ) {
    throw new AuthError(
      400,
      "INVALID_MODEL_PRICE",
      "积分价格需为 0–1,000,000"
    );
  }

  return (
    Math.round(
      numeric * 100
    ) / 100
  );
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  message: string
): number {
  const numeric =
    value === undefined
      ? fallback
      : Number(value);

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

  if (!text) {
    return undefined;
  }

  return text.slice(
    0,
    maxLength
  );
}

function encryptSecret(
  value: string
): string {
  const key =
    encryptionKey();

  const iv =
    randomBytes(12);

  const cipher =
    createCipheriv(
      "aes-256-gcm",
      key,
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
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString(
      "base64url"
    )
  ].join(".");
}

function decryptSecret(
  value: string
): string {
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
    throw new Error(
      "API Key 密文格式不正确"
    );
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

function encryptionKey():
  Buffer {
  const secret =
    process.env
      .API_PROVIDER_SECRET ||
    process.env
      .CSRF_SECRET;

  if (
    !secret ||
    secret.length < 32
  ) {
    throw new AuthError(
      503,
      "API_PROVIDER_SECRET_MISSING",
      "服务端尚未配置 API_PROVIDER_SECRET"
    );
  }

  return createHash(
    "sha256"
  )
    .update(secret)
    .digest();
}

function extractImages(
  body: any
):
  Array<{
    url: string;
    mimeType?: string;
  }> {
  const candidates:
    unknown[] = [];

  for (
    const value of [
      body?.data,
      body?.images,
      body?.output,
      body?.result?.data,
      body?.result?.images
    ]
  ) {
    if (
      Array.isArray(value)
    ) {
      candidates.push(
        ...value
      );
    }
  }

  if (
    typeof body?.url ===
      "string"
  ) {
    candidates.push(
      body.url
    );
  }

  const images:
    Array<{
      url: string;
      mimeType?: string;
    }> = [];

  for (
    const item of
      candidates
  ) {
    if (
      typeof item ===
        "string"
    ) {
      images.push({
        url: item
      });
      continue;
    }

    if (
      !item ||
      typeof item !==
        "object"
    ) {
      continue;
    }

    const record =
      item as Record<
        string,
        unknown
      >;

    const url =
      firstString(
        record.url,
        record.image_url,
        record.imageUrl
      );

    if (url) {
      images.push({
        url
      });
      continue;
    }

    const base64 =
      firstString(
        record.b64_json,
        record.base64,
        record.image_base64
      );

    if (base64) {
      images.push({
        url:
          base64.startsWith(
            "data:image/"
          )
            ? base64
            : `data:image/png;base64,${base64}`,
        mimeType:
          "image/png"
      });
    }
  }

  return images;
}

function firstString(
  ...values: unknown[]
):
  string |
  undefined {
  for (
    const value of
      values
  ) {
    if (
      typeof value ===
        "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return undefined;
}

function joinUrl(
  baseUrl: string,
  endpoint: string
): string {
  return (
    baseUrl.replace(
      /\/+$/,
      ""
    ) +
    "/" +
    endpoint.replace(
      /^\/+/,
      ""
    )
  );
}

function modelKey(
  provider: string,
  model: string
): string {
  return `${provider}:${model}`;
}

function isBuiltInProvider(
  provider: string
): boolean {
  return new Set([
    "lingke",
    "grsai",
    "nanobanana"
  ]).has(provider);
}

function isDuplicateEntry(
  error: unknown
): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (
      error as {
        code?: unknown
      }
    ).code ===
      "ER_DUP_ENTRY"
  );
}

function toIso(
  value: string
): string {
  const normalized =
    value.includes("T")
      ? value
      : value.replace(
          " ",
          "T"
        ) + "Z";

  const date =
    new Date(normalized);

  return Number.isNaN(
    date.getTime()
  )
    ? new Date()
        .toISOString()
    : date.toISOString();
}

export type CustomProviderService =
  ReturnType<
    typeof createCustomProviderService
  >;

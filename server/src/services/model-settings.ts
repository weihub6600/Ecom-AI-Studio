import type {
  ResultSetHeader,
  RowDataPacket
} from "mysql2/promise";
import type {
  AppDatabase
} from "../db/database.js";
import {
  getModels
} from "../models.js";
import {
  AuthError
} from "../auth/contracts.js";
import {
  getDefaultModelUnitCreditCost
} from "../pricing.js";
import type {
  ModelCapability,
  ProviderId
} from "../types.js";
import {
  getBuiltInProviderRuntimeConfig,
  isBuiltInProviderId,
  setBuiltInModelRuntimeConfigs,
  type BuiltInModelRuntimeConfig
} from "./provider-runtime.js";

interface ColumnRow
  extends RowDataPacket {
  COLUMN_NAME: string;
}

interface ModelSettingRow
  extends RowDataPacket {
  provider: string;
  model_id: string;
  display_name: string;
  enabled: number;
  unit_credit_cents:
    number |
    string;
  api_model_id:
    string |
    null;
  description:
    string |
    null;
  sizes_json:
    string |
    string[] |
    null;
  qualities_json:
    string |
    string[] |
    null;
  max_output_images:
    number |
    null;
  supports_reference_images:
    number |
    null;
  max_reference_images:
    number |
    null;
  supports_negative_prompt:
    number |
    null;
  supports_seed:
    number |
    null;
  asynchronous:
    number |
    null;
  sort_order:
    number |
    null;
  updated_at:
    string |
    Date |
    null;
}

export interface RuntimeModelSetting {
  provider: ProviderId;
  model: string;
  apiModelId: string;
  name: string;
  providerName: string;
  enabled: boolean;
  points: number;
  configured: boolean;
  sortOrder: number;
  capability: ModelCapability;
  updatedAt?: string;
}

export interface ModelUpdateInput {
  enabled?: unknown;
  points?: unknown;
  name?: unknown;
  apiModelId?: unknown;
  description?: unknown;
  sizes?: unknown;
  qualities?: unknown;
  maxOutputImages?: unknown;
  supportsReferenceImages?:
    unknown;
  maxReferenceImages?: unknown;
  supportsNegativePrompt?:
    unknown;
  supportsSeed?: unknown;
  sortOrder?: unknown;
}

const EXTRA_COLUMNS:
  Record<string, string> = {
    api_model_id:
      "VARCHAR(160) NULL",
    description:
      "VARCHAR(500) NULL",
    sizes_json:
      "JSON NULL",
    qualities_json:
      "JSON NULL",
    max_output_images:
      "INT UNSIGNED NULL",
    supports_reference_images:
      "TINYINT(1) NULL",
    max_reference_images:
      "INT UNSIGNED NULL",
    supports_negative_prompt:
      "TINYINT(1) NULL",
    supports_seed:
      "TINYINT(1) NULL",
    asynchronous:
      "TINYINT(1) NULL",
    sort_order:
      "INT UNSIGNED NULL"
  };

export function createModelSettingsService(
  database: AppDatabase
) {
  const cache =
    new Map<
      string,
      RuntimeModelSetting
    >();

  async function initialize():
    Promise<void> {
    await ensureColumns();

    const now =
      new Date();

    for (
      const model of
        getModels()
    ) {
      await database.pool.execute<
        ResultSetHeader
      >(
        `INSERT INTO
           app_model_settings (
             provider,
             model_id,
             display_name,
             enabled,
             unit_credit_cents,
             api_model_id,
             description,
             sizes_json,
             max_output_images,
             supports_reference_images,
             max_reference_images,
             supports_negative_prompt,
             supports_seed,
             asynchronous,
             created_at,
             updated_at
           ) VALUES (
             ?, ?, ?, 1, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?,
             ?, ?
           )
           ON DUPLICATE KEY UPDATE
             provider =
               VALUES(provider)`,
        [
          model.provider,
          model.id,
          model.name,
          Math.round(
            getDefaultModelUnitCreditCost(
              model.provider,
              model.id
            ) * 100
          ),
          defaultApiModelId(
            model.provider,
            model.id
          ),
          model.description,
          JSON.stringify(
            model.sizes
          ),
          model.maxOutputImages,
          model.supportsReferenceImages
            ? 1
            : 0,
          model.maxReferenceImages,
          model.supportsNegativePrompt
            ? 1
            : 0,
          model.supportsSeed
            ? 1
            : 0,
          model.asynchronous
            ? 1
            : 0,
          now,
          now
        ]
      );
    }

    await reload();
  }

  async function reload():
    Promise<void> {
    const [rows] =
      await database.pool.query<
        ModelSettingRow[]
      >(
        `SELECT *
         FROM app_model_settings`
      );

    const settings =
      new Map(
        rows.map(
          (row) => [
            modelKey(
              row.provider,
              row.model_id
            ),
            row
          ]
        )
      );

    cache.clear();

    const runtimeModels:
      BuiltInModelRuntimeConfig[] =
      [];

    for (
      const base of
        getModels()
    ) {
      const row =
        settings.get(
          modelKey(
            base.provider,
            base.id
          )
        );

      const capability:
        ModelCapability = {
          ...base,
          name:
            row?.display_name ||
            base.name,
          description:
            row?.description ??
            base.description,
          sizes:
            parseSizes(
              row?.sizes_json,
              base.sizes
            ),
          qualities:
            parseQualities(
              row?.qualities_json,
              base.qualities
            ),
          maxOutputImages:
            nullableInteger(
              row?.max_output_images,
              base.maxOutputImages
            ),
          supportsReferenceImages:
            nullableBoolean(
              row?.supports_reference_images,
              base.supportsReferenceImages
            ),
          maxReferenceImages:
            nullableInteger(
              row?.max_reference_images,
              base.maxReferenceImages
            ),
          supportsNegativePrompt:
            nullableBoolean(
              row?.supports_negative_prompt,
              base.supportsNegativePrompt
            ),
          supportsSeed:
            nullableBoolean(
              row?.supports_seed,
              base.supportsSeed
            ),
          asynchronous:
            nullableBoolean(
              row?.asynchronous,
              Boolean(
                base.asynchronous
              )
            )
        };

      const item:
        RuntimeModelSetting = {
          provider:
            base.provider,
          model:
            base.id,
          apiModelId:
            row?.api_model_id ||
            defaultApiModelId(
              base.provider,
              base.id
            ),
          name:
            capability.name,
          providerName:
            capability.providerName,
          enabled:
            row
              ? Boolean(
                  row.enabled
                )
              : true,
          points:
            row
              ? Number(
                  row
                    .unit_credit_cents
                ) / 100
              : getDefaultModelUnitCreditCost(
                  base.provider,
                  base.id
                ),
          configured:
            base.configured,
          sortOrder:
            nullableInteger(
              row?.sort_order,
              500
            ),
          capability,
          updatedAt:
            toIsoOptional(
              row?.updated_at
            )
        };

      cache.set(
        modelKey(
          base.provider,
          base.id
        ),
        item
      );

      if (
        isBuiltInProviderId(
          base.provider
        )
      ) {
        runtimeModels.push({
          provider:
            base.provider,
          model:
            base.id,
          apiModelId:
            item.apiModelId,
          name:
            item.name,
          description:
            capability.description,
          sizes:
            capability.sizes,
          qualities:
            capability.qualities,
          maxOutputImages:
            capability
              .maxOutputImages,
          supportsReferenceImages:
            capability
              .supportsReferenceImages,
          maxReferenceImages:
            capability
              .maxReferenceImages,
          supportsNegativePrompt:
            capability
              .supportsNegativePrompt,
          supportsSeed:
            capability
              .supportsSeed,
          asynchronous:
            Boolean(
              capability
                .asynchronous
            )
        });
      }
    }

    setBuiltInModelRuntimeConfigs(
      runtimeModels
    );
  }

  function listAll():
    RuntimeModelSetting[] {
    return Array.from(
      cache.values()
    );
  }

  function listPublicModels():
    Array<
      ModelCapability & {
        creditCost: number;
        modelSortOrder: number;
      }
    > {
    return listAll()
      .filter((item) => {
        const provider =
          getBuiltInProviderRuntimeConfig(
            item.provider
          );

        return (
          item.enabled &&
          (
            provider
              ? provider.enabled
              : true
          )
        );
      })
      .map((item) => {
        const provider = getBuiltInProviderRuntimeConfig(item.provider);
        return {
          ...item.capability,
          providerSortOrder: provider?.sortOrder ?? 100,
          modelSortOrder: item.sortOrder,
          creditCost: item.points
        };
      });
  }

  function get(
    provider: string,
    modelId: string
  ):
    RuntimeModelSetting |
    undefined {
    return cache.get(
      modelKey(
        provider,
        modelId
      )
    );
  }

  function getEnabled(
    provider: string,
    modelId: string
  ):
    RuntimeModelSetting |
    undefined {
    const item =
      get(
        provider,
        modelId
      );

    const providerSetting =
      getBuiltInProviderRuntimeConfig(
        provider
      );

    return (
      item?.enabled &&
      (
        providerSetting
          ? providerSetting.enabled
          : true
      )
    )
      ? item
      : undefined;
  }

  function getPriceList() {
    return listPublicModels()
      .map((item) => {
        const setting =
          get(
            item.provider,
            item.id
          );

        return {
          provider:
            item.provider,
          model:
            item.id,
          name:
            item.provider ===
              "lingke"
              ? `${item.providerName} · ${item.name}`
              : item.name,
          points:
            setting?.points ||
            0
        };
      });
  }

  async function update(
    provider: string,
    modelId: string,
    input: ModelUpdateInput,
    actorUserId: string
  ):
    Promise<RuntimeModelSetting> {
    const current =
      get(
        provider,
        modelId
      );

    if (!current) {
      throw new AuthError(
        404,
        "MODEL_NOT_FOUND",
        "模型不存在"
      );
    }

    const enabled =
      input.enabled ===
        undefined
        ? current.enabled
        : normalizeBoolean(
            input.enabled
          );

    const points =
      input.points ===
        undefined
        ? current.points
        : normalizePoints(
            input.points
          );

    const sortOrder =
      input.sortOrder ===
        undefined
        ? current.sortOrder
        : boundedInteger(
            input.sortOrder,
            1,
            9999,
            "模型显示顺序需为 1–9999"
          );

    const name =
      input.name ===
        undefined
        ? current.name
        : normalizeText(
            input.name,
            160,
            "模型名称不能为空"
          );

    const apiModelId =
      input.apiModelId ===
        undefined
        ? current.apiModelId
        : normalizeText(
            input.apiModelId,
            160,
            "API 模型 ID 不能为空"
          );

    const description =
      input.description ===
        undefined
        ? current
            .capability
            .description
        : normalizeText(
            input.description,
            500,
            "模型说明不能为空"
          );

    const sizes =
      input.sizes ===
        undefined
        ? current
            .capability
            .sizes
        : normalizeSizes(
            input.sizes
          );

    const qualities =
      input.qualities ===
        undefined
        ? current
            .capability
            .qualities
        : normalizeQualities(
            input.qualities
          );

    const maxOutputImages =
      input.maxOutputImages ===
        undefined
        ? current
            .capability
            .maxOutputImages
        : boundedInteger(
            input.maxOutputImages,
            1,
            16,
            "单次最大出图数需为 1–16"
          );

    const supportsReferenceImages =
      input.supportsReferenceImages ===
        undefined
        ? current
            .capability
            .supportsReferenceImages
        : normalizeBoolean(
            input
              .supportsReferenceImages
          );

    const maxReferenceImages =
      input.maxReferenceImages ===
        undefined
        ? current
            .capability
            .maxReferenceImages
        : boundedInteger(
            input.maxReferenceImages,
            0,
            32,
            "最大参考图数量需为 0–32"
          );

    const supportsNegativePrompt =
      input.supportsNegativePrompt ===
        undefined
        ? current
            .capability
            .supportsNegativePrompt
        : normalizeBoolean(
            input
              .supportsNegativePrompt
          );

    const supportsSeed =
      input.supportsSeed ===
        undefined
        ? current
            .capability
            .supportsSeed
        : normalizeBoolean(
            input.supportsSeed
          );

    await database.pool.execute<
      ResultSetHeader
    >(
      `UPDATE app_model_settings
       SET
         display_name = ?,
         enabled = ?,
         unit_credit_cents = ?,
         sort_order = ?,
         api_model_id = ?,
         description = ?,
         sizes_json = ?,
         qualities_json = ?,
         max_output_images = ?,
         supports_reference_images = ?,
         max_reference_images = ?,
         supports_negative_prompt = ?,
         supports_seed = ?,
         updated_at = ?,
         updated_by_user_id = ?
       WHERE
         provider = ?
         AND model_id = ?`,
      [
        name,
        enabled ? 1 : 0,
        Math.round(
          points * 100
        ),
        sortOrder,
        apiModelId,
        description,
        JSON.stringify(sizes),
        JSON.stringify(qualities),
        maxOutputImages,
        supportsReferenceImages
          ? 1
          : 0,
        maxReferenceImages,
        supportsNegativePrompt
          ? 1
          : 0,
        supportsSeed
          ? 1
          : 0,
        new Date(),
        actorUserId,
        provider,
        modelId
      ]
    );

    await reload();

    const updated =
      get(
        provider,
        modelId
      );

    if (!updated) {
      throw new Error(
        "更新模型后读取失败"
      );
    }

    return updated;
  }

  async function ensureColumns():
    Promise<void> {
    const [rows] =
      await database.pool.query<
        ColumnRow[]
      >(
        `SELECT COLUMN_NAME
         FROM
           information_schema.COLUMNS
         WHERE
           TABLE_SCHEMA = ?
           AND TABLE_NAME =
             'app_model_settings'`,
        [
          database.databaseName
        ]
      );

    const existing =
      new Set(
        rows.map(
          (row) =>
            String(
              row.COLUMN_NAME
            )
        )
      );

    for (
      const [
        column,
        definition
      ] of Object.entries(
        EXTRA_COLUMNS
      )
    ) {
      if (
        existing.has(column)
      ) {
        continue;
      }

      if (
        !/^[a-z_]+$/.test(
          column
        )
      ) {
        throw new Error(
          "模型设置字段名不安全"
        );
      }

      await database.pool.query(
        `ALTER TABLE
           app_model_settings
         ADD COLUMN
           ${column}
           ${definition}`
      );
    }
  }

  return {
    initialize,
    reload,
    listAll,
    listPublicModels,
    get,
    getEnabled,
    getPriceList,
    update
  };
}

function defaultApiModelId(
  provider: string,
  modelId: string
): string {
  if (
    provider === "lingke"
  ) {
    return (
      process.env
        .LINGKE_IMAGE_MODEL ||
      modelId
    );
  }

  if (
    modelId ===
      "grsai-gpt-image-2"
  ) {
    return "gpt-image-2";
  }

  if (
    modelId ===
      "grsai-gpt-image-2-vip"
  ) {
    return "gpt-image-2-vip";
  }

  if (
    modelId ===
      "nanobanana-nano-banana-pro"
  ) {
    return "nano-banana-pro";
  }

  if (
    modelId ===
      "nanobanana-nano-banana-2"
  ) {
    return "nano-banana-2";
  }

  return modelId;
}

function modelKey(
  provider: string,
  model: string
): string {
  return `${provider}:${model}`;
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
    "INVALID_MODEL_ENABLED",
    "模型布尔参数不正确"
  );
}

function normalizePoints(
  value: unknown
): number {
  const numeric =
    typeof value ===
      "number"
      ? value
      : typeof value ===
          "string"
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
      "单张积分价格需为 0–1,000,000"
    );
  }

  const cents =
    Math.round(
      numeric * 100
    );

  if (
    Math.abs(
      cents / 100 -
      numeric
    ) > 1e-9
  ) {
    throw new AuthError(
      400,
      "INVALID_MODEL_PRICE",
      "积分价格最多保留两位小数"
    );
  }

  return cents / 100;
}

function normalizeText(
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
      "INVALID_MODEL_TEXT",
      message
    );
  }

  return text;
}

function normalizeSizes(
  value: unknown
): string[] {
  const values =
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
        values
          .map(
            (item) =>
              String(item)
                .trim()
          )
          .filter(
            (item) =>
              item === "auto" ||
              /^\d+x\d+$/.test(
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
      "至少填写一个有效尺寸"
    );
  }

  return result;
}

function normalizeQualities(
  value: unknown
): ModelCapability["qualities"] {
  const values =
    Array.isArray(value)
      ? value
      : typeof value ===
          "string"
        ? value.split(
            /[,，\r\n]/
          )
        : [];

  const allowed =
    new Set([
      "auto",
      "high",
      "medium",
      "low"
    ]);

  const result =
    Array.from(
      new Set(
        values
          .map((item) =>
            String(item)
              .trim()
              .toLowerCase()
          )
          .filter((item) =>
            allowed.has(item)
          )
      )
    ) as ModelCapability["qualities"];

  return result;
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
      "INVALID_MODEL_INTEGER",
      message
    );
  }

  return numeric;
}

function parseSizes(
  value: unknown,
  fallback: string[]
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
      const result =
        parsed
          .map(String)
          .filter(Boolean);

      if (result.length > 0) {
        return result;
      }
    }
  }
  catch {
    // Use fallback.
  }

  return fallback;
}

function parseQualities(
  value: unknown,
  fallback: ModelCapability["qualities"]
): ModelCapability["qualities"] {
  try {
    const parsed =
      typeof value ===
        "string"
        ? JSON.parse(value)
        : value;

    if (Array.isArray(parsed)) {
      return normalizeQualities(parsed);
    }
  }
  catch {
    // Use fallback.
  }

  return fallback;
}

function nullableBoolean(
  value:
    number |
    null |
    undefined,
  fallback: boolean
): boolean {
  return value ===
    null ||
    value ===
      undefined
    ? fallback
    : Boolean(value);
}

function nullableInteger(
  value:
    number |
    null |
    undefined,
  fallback: number
): number {
  const numeric =
    Number(value);

  return (
    value !== null &&
    value !== undefined &&
    Number.isInteger(
      numeric
    )
  )
    ? numeric
    : fallback;
}

function toIsoOptional(
  value:
    string |
    Date |
    null |
    undefined
):
  string |
  undefined {
  if (!value) return undefined;

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
    ? undefined
    : date.toISOString();
}

export type ModelSettingsService =
  ReturnType<
    typeof createModelSettingsService
  >;

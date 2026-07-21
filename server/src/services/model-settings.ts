import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { AppDatabase } from "../db/database.js";
import { getModels } from "../models.js";
import { AuthError } from "../auth/contracts.js";
import { getDefaultModelUnitCreditCost } from "../pricing.js";
import type { ModelCapability, ProviderId } from "../types.js";

export interface RuntimeModelSetting {
  provider: ProviderId;
  model: string;
  name: string;
  providerName: string;
  enabled: boolean;
  points: number;
  configured: boolean;
  capability: ModelCapability;
  updatedAt?: string;
}

export function createModelSettingsService(database: AppDatabase) {
  const cache = new Map<string, RuntimeModelSetting>();

  async function initialize(): Promise<void> {
    const now = new Date();
    for (const model of getModels()) {
      await database.pool.execute<ResultSetHeader>(
        `INSERT INTO app_model_settings
          (provider, model_id, display_name, enabled, unit_credit_cents, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
        [model.provider, model.id, model.name, Math.round(getDefaultModelUnitCreditCost(model.provider, model.id) * 100), now, now]
      );
    }
    await reload();
  }

  async function reload(): Promise<void> {
    const [rows] = await database.pool.query<RowDataPacket[]>("SELECT * FROM app_model_settings");
    const settings = new Map(rows.map((row) => [`${row.provider}:${row.model_id}`, row]));
    cache.clear();
    for (const model of getModels()) {
      const row = settings.get(`${model.provider}:${model.id}`);
      const item: RuntimeModelSetting = {
        provider: model.provider,
        model: model.id,
        name: model.name,
        providerName: model.providerName,
        enabled: row ? Boolean(row.enabled) : true,
        points: row ? Number(row.unit_credit_cents) / 100 : getDefaultModelUnitCreditCost(model.provider, model.id),
        configured: model.configured,
        capability: model,
        updatedAt: row?.updated_at ? new Date(String(row.updated_at).replace(" ", "T") + "Z").toISOString() : undefined
      };
      cache.set(`${model.provider}:${model.id}`, item);
    }
  }

  function listAll(): RuntimeModelSetting[] {
    return Array.from(cache.values());
  }

  function listPublicModels(): Array<ModelCapability & { creditCost: number }> {
    return listAll()
      .filter((item) => item.enabled)
      .map((item) => ({ ...item.capability, creditCost: item.points }));
  }

  function get(provider: string, modelId: string): RuntimeModelSetting | undefined {
    return cache.get(`${provider}:${modelId}`);
  }

  function getEnabled(provider: string, modelId: string): RuntimeModelSetting | undefined {
    const item = get(provider, modelId);
    return item?.enabled ? item : undefined;
  }

  function getPriceList() {
    return listAll().filter((item) => item.enabled).map((item) => ({
      provider: item.provider,
      model: item.model,
      name: item.provider === "lingke" ? `${item.providerName} · ${item.name}` : item.name,
      points: item.points
    }));
  }

  async function update(
    provider: string,
    modelId: string,
    input: { enabled?: unknown; points?: unknown },
    actorUserId: string
  ): Promise<RuntimeModelSetting> {
    const current = get(provider, modelId);
    if (!current) throw new AuthError(404, "MODEL_NOT_FOUND", "模型不存在");

    const enabled = input.enabled === undefined ? current.enabled : normalizeBoolean(input.enabled);
    const points = input.points === undefined ? current.points : normalizePoints(input.points);
    await database.pool.execute<ResultSetHeader>(
      `UPDATE app_model_settings
       SET enabled = ?, unit_credit_cents = ?, updated_at = ?, updated_by_user_id = ?
       WHERE provider = ? AND model_id = ?`,
      [enabled ? 1 : 0, Math.round(points * 100), new Date(), actorUserId, provider, modelId]
    );
    await reload();
    return get(provider, modelId)!;
  }

  return { initialize, reload, listAll, listPublicModels, get, getEnabled, getPriceList, update };
}

function normalizeBoolean(value: unknown): boolean {
  if (value === true || value === false) return value;
  throw new AuthError(400, "INVALID_MODEL_ENABLED", "模型启用状态不正确");
}

function normalizePoints(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1_000_000) {
    throw new AuthError(400, "INVALID_MODEL_PRICE", "单张积分价格需为 0–1,000,000");
  }
  const cents = Math.round(numeric * 100);
  if (Math.abs(cents / 100 - numeric) > 1e-9) throw new AuthError(400, "INVALID_MODEL_PRICE", "积分价格最多保留两位小数");
  return cents / 100;
}

export type ModelSettingsService = ReturnType<typeof createModelSettingsService>;

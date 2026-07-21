import type { ModelCapability, ProviderId } from "./types.js";

export interface CreditPriceItem {
  provider: ProviderId;
  model: string;
  name: string;
  points: number;
}

export function getDefaultModelUnitCreditCost(provider: ProviderId, modelId: string): number {
  if (provider === "lingke") return 1.5;
  if (provider === "grsai") return modelId === "grsai-gpt-image-2-vip" ? 2 : 1;
  if (provider === "nanobanana") return modelId === "nanobanana-nano-banana-pro" ? 3 : 2;
  return 0;
}

export function calculateGenerationCreditCost(unitPoints: number, imageCount: number): number {
  const safeCount = Math.max(0, Math.trunc(imageCount));
  return Number((Math.max(0, unitPoints) * safeCount).toFixed(2));
}

export function buildDefaultCreditPriceList(models: ModelCapability[]): CreditPriceItem[] {
  return models.map((model) => ({
    provider: model.provider,
    model: model.id,
    name: model.provider === "lingke" ? `${model.providerName} · ${model.name}` : model.name,
    points: getDefaultModelUnitCreditCost(model.provider, model.id)
  }));
}

import type {
  BuiltInModel,
  GenericModel,
  ModelDraft,
  ProviderDraft
} from "./types";

export function emptyProviderDraft(): ProviderDraft {
  return {
    id: "",
    displayName: "",
    baseUrl: "https://",
    endpoint: "/v1/images/generations",
    statusEndpoint: "",
    apiKey: "",
    clearApiKey: false,
    authType: "bearer",
    authHeader: "Authorization",
    authScheme: "Bearer",
    authQueryName: "api_key",
    requestMethod: "POST",
    timeoutMs: 300000,
    enabled: true,
    sortOrder: 500,
    imageSize: "4K",
    headersText: pretty({}),
    requestTemplateText: pretty({
      model: "{{api_model_id}}",
      prompt: "{{prompt}}",
      size: "{{size}}",
      n: "{{count}}",
      response_format: "url"
    }),
    responseMappingText: pretty({
      imageUrlPath: "data[*].url",
      imageBase64Path: "data[*].b64_json",
      requestIdPath: "id"
    }),
    asyncConfigText: pretty({
      enabled: false,
      taskIdPath: "id",
      statusEndpoint: "/v1/tasks/{{task_id}}",
      statusMethod: "GET",
      statusPath: "status",
      successValues: ["succeeded", "completed"],
      pendingValues: ["queued", "processing", "running"],
      failureValues: ["failed", "error"],
      pollIntervalMs: 3000,
      maxWaitMs: 300000,
      resultMapping: {
        imageUrlPath: "data[*].url",
        requestIdPath: "id"
      }
    })
  };
}

export function emptyModelDraft(): ModelDraft {
  return {
    model: "",
    apiModelId: "",
    name: "",
    description: "",
    enabled: true,
    sortOrder: 500,
    sizesText: "1024x1024",
    qualitiesText: "",
    maxOutputImages: 1,
    supportsReferenceImages: false,
    maxReferenceImages: 1,
    supportsNegativePrompt: false,
    supportsSeed: false,
    sizeMappingText: pretty({}),
    requestOverridesText: pretty({}),
    points: "1"
  };
}

export function isGenericModel(model: GenericModel | BuiltInModel): model is GenericModel {
  return "qualities" in model;
}

export function parseObject(value: string, label: string): Record<string, unknown> {
  const text = value.trim();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label}不是有效 JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

export function splitList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function pretty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(min, Math.min(max, numeric))
    : fallback;
}

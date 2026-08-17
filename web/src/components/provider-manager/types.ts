export type AuthType = "bearer" | "header" | "query" | "none";
export type ProviderKind = "generic" | "builtin";
export type EditorTab = "connection" | "protocol" | "models" | "test";

export interface GenericModel {
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
  sizeMapping: Record<string, unknown>;
  requestOverrides: Record<string, unknown>;
  points: number;
  createdAt: string;
  updatedAt: string;
}

export interface GenericProvider {
  id: string;
  displayName: string;
  baseUrl: string;
  endpoint: string;
  adapter: string;
  apiKeyConfigured: boolean;
  authType: AuthType;
  authHeader: string;
  authScheme: string;
  authQueryName: string;
  requestMethod: string;
  timeoutMs: number;
  enabled: boolean;
  sortOrder: number;
  headers: Record<string, unknown>;
  requestTemplate: Record<string, unknown>;
  responseMapping: Record<string, unknown>;
  asyncConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  models: GenericModel[];
}

export interface BuiltInProvider {
  id: string;
  adapter: string;
  adapterLabel: string;
  displayName: string;
  baseUrl: string;
  generateEndpoint: string;
  statusEndpoint: string;
  timeoutMs: number;
  enabled: boolean;
  sortOrder: number;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
  imageSize?: string;
  updatedAt: string;
}

export interface BuiltInModel {
  provider: string;
  model: string;
  apiModelId: string;
  name: string;
  providerName: string;
  enabled: boolean;
  points: number;
  configured: boolean;
  description: string;
  sortOrder: number;
  sizes: string[];
  qualities: string[];
  maxOutputImages: number;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  asynchronous: boolean;
  updatedAt?: string;
}

export interface UnifiedProvider {
  key: string;
  kind: ProviderKind;
  id: string;
  displayName: string;
  baseUrl: string;
  endpoint: string;
  enabled: boolean;
  sortOrder: number;
  apiKeyConfigured: boolean;
  adapterLabel: string;
  modelCount: number;
}

export interface ProviderDraft {
  id: string;
  displayName: string;
  baseUrl: string;
  endpoint: string;
  statusEndpoint: string;
  apiKey: string;
  clearApiKey: boolean;
  authType: AuthType;
  authHeader: string;
  authScheme: string;
  authQueryName: string;
  requestMethod: string;
  timeoutMs: number;
  enabled: boolean;
  sortOrder: number;
  imageSize: string;
  headersText: string;
  requestTemplateText: string;
  responseMappingText: string;
  asyncConfigText: string;
}

export interface ModelDraft {
  model: string;
  apiModelId: string;
  name: string;
  description: string;
  enabled: boolean;
  sortOrder: number;
  sizesText: string;
  qualitiesText: string;
  maxOutputImages: number;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  sizeMappingText: string;
  requestOverridesText: string;
  points: string;
}

export interface TestResult {
  ok: boolean;
  pending?: boolean;
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
  providerStatus?: string;
  error?: string;
}

export interface SizeMapRow {
  label: string;
  apiValue: string;
}

export type ProviderPresetId =
  | "blank"
  | "katuai"
  | "lingke"
  | "grsai";

export type ModelPresetId =
  | "blank"
  | "katu-1k"
  | "katu-2k"
  | "katu-4k"
  | "lingke-gpt-image-2"
  | "grsai-gpt-image-2"
  | "grsai-vip-1k"
  | "grsai-vip-2k"
  | "grsai-vip-4k";

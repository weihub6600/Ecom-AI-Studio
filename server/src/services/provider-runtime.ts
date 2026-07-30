export type BuiltInProviderId =
  | "lingke"
  | "grsai"
  | "nanobanana";

export interface BuiltInProviderRuntimeConfig {
  id: BuiltInProviderId;
  displayName: string;
  baseUrl: string;
  generateEndpoint: string;
  statusEndpoint?: string;
  apiKey: string;
  timeoutMs: number;
  enabled: boolean;
  options: Record<string, string>;
}

export interface BuiltInModelRuntimeConfig {
  provider: BuiltInProviderId;
  model: string;
  apiModelId: string;
  name: string;
  description: string;
  sizes: string[];
  maxOutputImages: number;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  asynchronous: boolean;
}

const providers =
  new Map<
    BuiltInProviderId,
    BuiltInProviderRuntimeConfig
  >();

const models =
  new Map<
    string,
    BuiltInModelRuntimeConfig
  >();

export function isBuiltInProviderId(
  value: string
): value is BuiltInProviderId {
  return (
    value === "lingke" ||
    value === "grsai" ||
    value === "nanobanana"
  );
}

export function setBuiltInProviderRuntimeConfigs(
  values: BuiltInProviderRuntimeConfig[]
): void {
  providers.clear();

  for (const value of values) {
    providers.set(
      value.id,
      value
    );
  }
}

export function getBuiltInProviderRuntimeConfig(
  provider: string
):
  BuiltInProviderRuntimeConfig |
  undefined {
  return isBuiltInProviderId(provider)
    ? providers.get(provider)
    : undefined;
}

export function setBuiltInModelRuntimeConfigs(
  values: BuiltInModelRuntimeConfig[]
): void {
  models.clear();

  for (const value of values) {
    models.set(
      modelKey(
        value.provider,
        value.model
      ),
      value
    );
  }
}

export function getBuiltInModelRuntimeConfig(
  provider: string,
  model: string
):
  BuiltInModelRuntimeConfig |
  undefined {
  return models.get(
    modelKey(
      provider,
      model
    )
  );
}

function modelKey(
  provider: string,
  model: string
): string {
  return `${provider}:${model}`;
}

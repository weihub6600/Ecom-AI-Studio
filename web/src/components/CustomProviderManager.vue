<script setup lang="ts">
import { platformConfirm } from "../services/platform-feedback";
import {
  computed,
  onMounted,
  reactive,
  ref
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";

import type {
  BuiltInModel,
  BuiltInProvider,
  EditorTab,
  GenericModel,
  GenericProvider,
  ModelDraft,
  ModelPresetId,
  ProviderDraft,
  ProviderKind,
  ProviderPresetId,
  SizeMapRow,
  TestResult,
  UnifiedProvider
} from "./provider-manager/types";
import {
  GRSAI_STANDARD_RATIOS,
  GRSAI_VIP_SIZE_MAPS,
  KATU_SIZE_MAPS,
  LINGKE_COMMON_SIZES,
  providerPresets
} from "./provider-manager/presets";

const genericProviders = ref<GenericProvider[]>([]);
const builtInProviders = ref<BuiltInProvider[]>([]);
const builtInModels = ref<BuiltInModel[]>([]);
const variables = ref<string[]>([]);

const loading = ref(true);
const saving = ref("");
const errorMessage = ref("");
const successMessage = ref("");
const providerSearch = ref("");
const selectedKey = ref("");
const selectedModelId = ref("");
const activeTab = ref<EditorTab>("connection");
const creatingProvider = ref(false);
const creatingModel = ref(false);
const testPolling = ref(false);
const testElapsedSeconds = ref(0);
let testRunSerial = 0;

const providerDraft = reactive<ProviderDraft>(emptyProviderDraft());
const modelDraft = reactive<ModelDraft>(emptyModelDraft());

const testForm = reactive({
  prompt: "高端电商商品摄影，纯净棚拍背景，真实材质，柔和商业光",
  negativePrompt: "",
  size: "1024x1024",
  quality: "auto",
  count: 1,
  seed: ""
});
const testPreview = ref<unknown>(null);
const testResult = ref<TestResult | null>(null);

const providerPresetId = ref<ProviderPresetId>("blank");
const modelPresetId = ref<ModelPresetId>("blank");
const sizeRows = ref<SizeMapRow[]>([]);

const unifiedProviders = computed<UnifiedProvider[]>(() => {
  const generic = genericProviders.value.map((provider) => ({
    key: `generic:${provider.id}`,
    kind: "generic" as const,
    id: provider.id,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    endpoint: provider.endpoint,
    enabled: provider.enabled,
    sortOrder: provider.sortOrder || 500,
    apiKeyConfigured: provider.apiKeyConfigured,
    adapterLabel: "通用协议",
    modelCount: provider.models.length
  }));

  const builtin = builtInProviders.value.map((provider) => ({
    key: `builtin:${provider.id}`,
    kind: "builtin" as const,
    id: provider.id,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    endpoint: provider.generateEndpoint,
    enabled: provider.enabled,
    sortOrder: provider.sortOrder || 100,
    apiKeyConfigured: provider.apiKeyConfigured,
    adapterLabel: provider.adapterLabel || "兼容协议",
    modelCount: builtInModels.value.filter((model) => model.provider === provider.id).length
  }));

  return [...builtin, ...generic]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
});

const filteredProviders = computed(() => {
  const keyword = providerSearch.value.trim().toLowerCase();
  if (!keyword) return unifiedProviders.value;
  return unifiedProviders.value.filter((item) =>
    `${item.displayName} ${item.id} ${item.baseUrl} ${item.adapterLabel}`
      .toLowerCase()
      .includes(keyword)
  );
});

const selectedUnified = computed(() =>
  unifiedProviders.value.find((item) => item.key === selectedKey.value) || null
);

const selectedKind = computed<ProviderKind | null>(() =>
  selectedUnified.value?.kind || null
);

const selectedGeneric = computed(() => {
  if (selectedKind.value !== "generic") return null;
  return genericProviders.value.find((item) => item.id === selectedUnified.value?.id) || null;
});

const selectedBuiltin = computed(() => {
  if (selectedKind.value !== "builtin") return null;
  return builtInProviders.value.find((item) => item.id === selectedUnified.value?.id) || null;
});

const currentModels = computed<Array<GenericModel | BuiltInModel>>(() => {
  const list =
    selectedKind.value === "generic"
      ? [...(selectedGeneric.value?.models || [])]
      : selectedKind.value === "builtin"
        ? builtInModels.value.filter((item) => item.provider === selectedBuiltin.value?.id)
        : [];

  return list.sort((a, b) =>
    (a.sortOrder || 500) - (b.sortOrder || 500) ||
    a.name.localeCompare(b.name)
  );
});

const selectedModel = computed<Array<GenericModel | BuiltInModel>[number] | null>(() =>
  currentModels.value.find((item) => item.model === selectedModelId.value) || null
);

const stats = computed(() => ({
  providers: unifiedProviders.value.length,
  enabledProviders: unifiedProviders.value.filter((item) => item.enabled).length,
  models: unifiedProviders.value.reduce((sum, item) => sum + item.modelCount, 0)
}));

const availableModelPresets = computed(() => {
  const baseUrl = (
    selectedGeneric.value?.baseUrl ||
    providerDraft.baseUrl ||
    ""
  ).toLowerCase();
  const providerId = (
    selectedGeneric.value?.id ||
    providerDraft.id ||
    ""
  ).toLowerCase();

  const common = [
    {
      id: "blank" as ModelPresetId,
      name: "空白模型",
      hint: "只填最基础参数"
    }
  ];

  if (baseUrl.includes("katuai.cn") || providerId.includes("katu")) {
    return [
      ...common,
      { id: "katu-1k" as ModelPresetId, name: "Image-2 · 1K", hint: "13 种比例自动映射" },
      { id: "katu-2k" as ModelPresetId, name: "Image-2 · 2K", hint: "13 种比例自动映射" },
      { id: "katu-4k" as ModelPresetId, name: "Image-2 · 4K", hint: "13 种比例自动映射" }
    ];
  }

  if (baseUrl.includes("lk888.ai") || providerId.includes("lingke")) {
    return [
      ...common,
      {
        id: "lingke-gpt-image-2" as ModelPresetId,
        name: "GPT Image 2",
        hint: "参考图最多 14 张 · 常用尺寸"
      }
    ];
  }

  if (baseUrl.includes("grsai") || providerId.includes("grsai")) {
    return [
      ...common,
      { id: "grsai-gpt-image-2" as ModelPresetId, name: "GPT Image 2", hint: "比例直接传 API" },
      { id: "grsai-vip-1k" as ModelPresetId, name: "GPT Image 2 VIP · 1K", hint: "比例映射为 1K 像素" },
      { id: "grsai-vip-2k" as ModelPresetId, name: "GPT Image 2 VIP · 2K", hint: "比例映射为 2K 像素" },
      { id: "grsai-vip-4k" as ModelPresetId, name: "GPT Image 2 VIP · 4K", hint: "比例映射为 4K 像素" }
    ];
  }

  return common;
});

const isGeneric = computed(() => selectedKind.value === "generic");
const canDeleteProvider = computed(() => isGeneric.value && !creatingProvider.value);
const canCloneProvider = computed(() => Boolean(selectedUnified.value) && !creatingProvider.value);
const canCloneModel = computed(() => Boolean(selectedModel.value) && !creatingModel.value);

type KnownApiProfile = "lingke" | "grsai" | "katu" | "other";

const knownApiProfile = computed<KnownApiProfile>(() => {
  const provider = selectedUnified.value;
  if (!provider) return "other";

  const fingerprint = `${provider.id} ${provider.displayName} ${provider.baseUrl}`.toLowerCase();

  if (fingerprint.includes("lk888") || fingerprint.includes("lingke")) return "lingke";
  if (fingerprint.includes("grsai") || fingerprint.includes("dakka.com.cn")) return "grsai";
  if (fingerprint.includes("katu") || fingerprint.includes("咖图")) return "katu";
  return "other";
});

const qualityEnabled = computed(() =>
  splitList(modelDraft.qualitiesText).length > 0
);

const qualityCanEdit = computed(() =>
  isGeneric.value || knownApiProfile.value === "lingke"
);

const standardQualityValues = ["auto", "high", "medium", "low"] as const;

const requestTemplateUsesCount = computed(() => {
  if (selectedKind.value !== "generic") {
    return knownApiProfile.value === "lingke";
  }
  return providerDraft.requestTemplateText.includes("{{count}}");
});

const requestTemplateUsesQuality = computed(() => {
  if (selectedKind.value !== "generic") {
    return Boolean(selectedModel.value?.qualities?.length);
  }
  return providerDraft.requestTemplateText.includes("{{quality}}");
});

const outputCountHint = computed(() => {
  if (knownApiProfile.value === "grsai") {
    return "GRSAI 文档未提供 n / count 参数，建议固定为 1 张。";
  }
  if (knownApiProfile.value === "lingke") {
    return "LingkeAI 文档提供 n 参数，但没有声明最大值；当前数字是本站安全上限。";
  }
  if (knownApiProfile.value === "katu") {
    return "咖图文档提供 n 参数，但没有声明最大值；建议从 1、2、4 逐步实测。";
  }
  return requestTemplateUsesCount.value
    ? "当前协议已使用 {{count}} 数量变量。"
    : "当前协议未使用 {{count}}；若设为大于 1，第三方可能仍只生成 1 张。";
});

const referenceLimitHint = computed(() => {
  if (knownApiProfile.value === "lingke") {
    return "文档明确：GPT Image 2 最多 14 张参考图。";
  }
  if (knownApiProfile.value === "grsai") {
    return "GRSAI 文档确认支持参考图数组，但没有声明最大数量；这里是本站限制。";
  }
  if (knownApiProfile.value === "katu") {
    return "咖图文档确认支持 reference_images，但没有声明最大数量；这里是本站限制。";
  }
  return "按第三方 API 实际限制填写；未知时建议保守设置。";
});

const qualityHint = computed(() => {
  if (knownApiProfile.value === "lingke") {
    return "文档明确支持：auto / high / medium / low。";
  }
  if (knownApiProfile.value === "grsai") {
    return "GRSAI 当前文档未声明 Quality 参数，建议关闭。";
  }
  if (knownApiProfile.value === "katu") {
    return "咖图当前文档未声明 Quality 参数，建议关闭。";
  }
  return requestTemplateUsesQuality.value
    ? "当前协议已引用 {{quality}}。"
    : "当前协议未引用 {{quality}}；开启后也不会自动传给第三方。";
});

onMounted(loadAll);

async function loadAll() {
  loading.value = true;
  clearMessages();

  try {
    const [genericData, builtinData] = await Promise.all([
      apiRequest<{
        providers: GenericProvider[];
        variables?: string[];
      }>("/api/admin/api-providers"),
      apiRequest<{
        providers: BuiltInProvider[];
        models: BuiltInModel[];
      }>("/api/admin/builtin-api-providers")
    ]);

    genericProviders.value = genericData.providers || [];
    variables.value = genericData.variables || [];
    builtInProviders.value = builtinData.providers || [];
    builtInModels.value = builtinData.models || [];

    if (
      selectedKey.value &&
      !unifiedProviders.value.some((item) => item.key === selectedKey.value)
    ) {
      selectedKey.value = "";
    }

    if (!selectedKey.value && unifiedProviders.value[0]) {
      selectProvider(unifiedProviders.value[0].key);
    } else if (selectedUnified.value) {
      syncProviderDraft();
      syncSelectedModel();
    }
  } catch (error) {
    errorMessage.value = messageOf(error, "读取服务商配置失败");
  } finally {
    loading.value = false;
  }
}

function selectProvider(key: string) {
  cancelTestPolling();
  selectedKey.value = key;
  selectedModelId.value = "";
  creatingProvider.value = false;
  creatingModel.value = false;
  activeTab.value = "connection";
  testPreview.value = null;
  testResult.value = null;
  syncProviderDraft();
  selectedModelId.value = currentModels.value[0]?.model || "";
  syncSelectedModel();
}

function syncProviderDraft() {
  if (selectedGeneric.value) {
    const provider = selectedGeneric.value;
    Object.assign(providerDraft, {
      id: provider.id,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      endpoint: provider.endpoint,
      statusEndpoint: "",
      apiKey: "",
      clearApiKey: false,
      authType: provider.authType || "bearer",
      authHeader: provider.authHeader || "Authorization",
      authScheme: provider.authScheme ?? "Bearer",
      authQueryName: provider.authQueryName || "api_key",
      requestMethod: provider.requestMethod || "POST",
      timeoutMs: provider.timeoutMs || 300000,
      enabled: provider.enabled,
      sortOrder: provider.sortOrder || 500,
      imageSize: "4K",
      headersText: pretty(provider.headers || {}),
      requestTemplateText: pretty(provider.requestTemplate || {}),
      responseMappingText: pretty(provider.responseMapping || {}),
      asyncConfigText: pretty(provider.asyncConfig || {})
    });
    return;
  }

  if (selectedBuiltin.value) {
    const provider = selectedBuiltin.value;
    Object.assign(providerDraft, {
      id: provider.id,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      endpoint: provider.generateEndpoint,
      statusEndpoint: provider.statusEndpoint || "",
      apiKey: "",
      clearApiKey: false,
      authType: "bearer",
      authHeader: "Authorization",
      authScheme: "Bearer",
      authQueryName: "api_key",
      requestMethod: "POST",
      timeoutMs: provider.timeoutMs || 300000,
      enabled: provider.enabled,
      sortOrder: provider.sortOrder || 100,
      imageSize: provider.imageSize || "4K",
      headersText: pretty({}),
      requestTemplateText: pretty({}),
      responseMappingText: pretty({}),
      asyncConfigText: pretty({})
    });
  }
}

function startCreateProvider() {
  cancelTestPolling();
  selectedKey.value = "";
  selectedModelId.value = "";
  creatingProvider.value = true;
  creatingModel.value = false;
  activeTab.value = "connection";
  Object.assign(providerDraft, emptyProviderDraft());
  Object.assign(modelDraft, emptyModelDraft());
  providerPresetId.value = "blank";
  modelPresetId.value = "blank";
  sizeRows.value = [{ label: "1024x1024", apiValue: "1024x1024" }];
  testPreview.value = null;
  testResult.value = null;
  clearMessages();
}

function startCreateProviderWithPreset(presetId: ProviderPresetId) {
  startCreateProvider();
  providerPresetId.value = presetId;
  applyProviderPreset(presetId, false);
}

async function applyProviderPreset(
  presetId: ProviderPresetId,
  confirmOverwrite = true
) {
  if (
    confirmOverwrite &&
    !creatingProvider.value &&
    selectedKind.value === "generic" &&
    !await platformConfirm("套用模板会覆盖当前连接与协议字段，但不会清除已保存的 API Key。继续吗？")
  ) {
    return;
  }

  const keepApiKey = providerDraft.apiKey;
  const keepClearApiKey = providerDraft.clearApiKey;
  const keepEnabled = providerDraft.enabled;
  const keepSortOrder = providerDraft.sortOrder;

  if (presetId === "katuai") {
    Object.assign(providerDraft, {
      id: creatingProvider.value ? "katuai-api" : providerDraft.id,
      displayName: creatingProvider.value ? "咖图 AI" : providerDraft.displayName,
      baseUrl: "https://www.katuai.cn",
      endpoint: "/v1/images/generations",
      requestMethod: "POST",
      timeoutMs: 300000,
      authType: "bearer",
      authHeader: "Authorization",
      authScheme: "Bearer",
      authQueryName: "api_key",
      headersText: pretty({
        Prefer: "respond-async"
      }),
      requestTemplateText: pretty({
        model: "{{api_model_id}}",
        prompt: "{{prompt}}",
        size: "{{size}}",
        n: "{{count}}",
        response_format: "url",
        reference_images: "{{reference_images}}"
      }),
      responseMappingText: pretty({
        requestIdPath: "id",
        taskIdPath: "id"
      }),
      asyncConfigText: pretty({
        enabled: true,
        taskIdPath: "id",
        statusEndpoint: "/v1/images/tasks/{{task_id}}",
        statusMethod: "GET",
        statusPath: "status",
        successValues: ["succeeded", "partially_succeeded"],
        pendingValues: ["queued", "processing", "running"],
        failureValues: ["failed"],
        pollIntervalMs: 3000,
        maxWaitMs: 300000,
        resultMapping: {
          imageUrlPath: "data[*].result.image.url",
          requestIdPath: "id"
        }
      })
    });
  } else if (presetId === "lingke") {
    Object.assign(providerDraft, {
      id: creatingProvider.value ? "lingke-api" : providerDraft.id,
      displayName: creatingProvider.value ? "LingkeAI" : providerDraft.displayName,
      baseUrl: "https://api.lk888.ai",
      endpoint: "/v1/media/generate",
      requestMethod: "POST",
      timeoutMs: 300000,
      authType: "bearer",
      authHeader: "Authorization",
      authScheme: "Bearer",
      authQueryName: "key",
      headersText: pretty({}),
      requestTemplateText: pretty({
        model: "{{api_model_id}}",
        prompt: "{{prompt}}",
        params: {
          images: "{{reference_images}}",
          size: "{{size}}",
          n: "{{count}}",
          quality: "{{quality}}",
          response_format: "url"
        }
      }),
      responseMappingText: pretty({
        requestIdPath: "task_id",
        taskIdPath: "task_id"
      }),
      asyncConfigText: pretty({
        enabled: true,
        taskIdPath: "task_id",
        statusEndpoint: "/v1/media/status?task_id={{task_id}}",
        statusMethod: "GET",
        statusPath: "state",
        successValues: ["success"],
        pendingValues: ["pending", "running"],
        failureValues: ["failed"],
        pollIntervalMs: 4000,
        maxWaitMs: 180000,
        errorMessagePath: "error",
        resultMapping: {
          imageUrlPath: "result_url",
          requestIdPath: "task_id"
        }
      })
    });
  } else if (presetId === "grsai") {
    Object.assign(providerDraft, {
      id: creatingProvider.value ? "grsai-api" : providerDraft.id,
      displayName: creatingProvider.value ? "GRSAI" : providerDraft.displayName,
      baseUrl: "https://grsai.dakka.com.cn",
      endpoint: "/v1/api/generate",
      requestMethod: "POST",
      timeoutMs: 300000,
      authType: "bearer",
      authHeader: "Authorization",
      authScheme: "Bearer",
      authQueryName: "api_key",
      headersText: pretty({}),
      requestTemplateText: pretty({
        model: "{{api_model_id}}",
        prompt: "{{prompt}}",
        images: "{{reference_images}}",
        aspectRatio: "{{size}}",
        replyType: "json"
      }),
      responseMappingText: pretty({
        imageUrlPath: "results[*].url",
        requestIdPath: "id"
      }),
      asyncConfigText: pretty({
        enabled: false
      })
    });
  } else {
    Object.assign(providerDraft, emptyProviderDraft());
  }

  providerDraft.apiKey = keepApiKey;
  providerDraft.clearApiKey = keepClearApiKey;
  providerDraft.enabled = keepEnabled;
  providerDraft.sortOrder = keepSortOrder;
  providerPresetId.value = presetId;
  successMessage.value =
    presetId === "blank"
      ? "已恢复空白通用模板"
      : `已套用 ${providerPresets.find((item) => item.id === presetId)?.name || "服务商"} 模板`;
}

async function cloneProvider() {
  const selected = selectedUnified.value;
  if (!selected || creatingProvider.value) return;

  clearMessages();

  if (selected.kind === "generic") {
    if (!await platformConfirm(`复制“${selected.displayName}”以及它的全部模型吗？副本默认停用，API Key 会在服务端安全复制。`)) {
      return;
    }

    saving.value = "provider-clone";
    try {
      const data = await apiRequest<{ provider: GenericProvider }>(
        `/api/admin/api-providers/${encodeURIComponent(selected.id)}/clone`,
        jsonRequest({ includeModels: true })
      );
      await loadAll();
      selectProvider(`generic:${data.provider.id}`);
      successMessage.value = `已复制为“${data.provider.displayName}”，副本默认停用`;
    } catch (error) {
      errorMessage.value = messageOf(error, "复制服务商失败");
    } finally {
      saving.value = "";
    }
    return;
  }

  const builtin = selectedBuiltin.value;
  if (!builtin) return;

  startCreateProvider();
  const inferred: ProviderPresetId =
    builtin.id === "lingke"
      ? "lingke"
      : builtin.id === "grsai"
        ? "grsai"
        : "blank";

  applyProviderPreset(inferred, false);
  providerDraft.id = `${builtin.id}-copy`;
  providerDraft.displayName = `${builtin.displayName} 副本`;
  providerDraft.baseUrl = builtin.baseUrl;
  providerDraft.endpoint = builtin.generateEndpoint;
  providerDraft.timeoutMs = builtin.timeoutMs;
  providerDraft.sortOrder = Math.min(9999, builtin.sortOrder + 1);
  providerDraft.enabled = false;
  providerDraft.apiKey = "";
  successMessage.value = "已生成系统适配器的通用副本草稿；为安全起见，API Key 需要重新填写后再创建";
}

async function cloneModel() {
  const provider = selectedGeneric.value;
  const model = selectedModel.value;

  if (!provider || !model || selectedKind.value !== "generic") {
    errorMessage.value = "系统适配器模型请先复制服务商为通用配置，再复制模型";
    return;
  }

  if (!await platformConfirm(`复制模型“${model.name}”吗？副本默认停用。`)) {
    return;
  }

  saving.value = "model-clone";
  clearMessages();
  try {
    const data = await apiRequest<{ model: GenericModel }>(
      `/api/admin/api-providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(model.model)}/clone`,
      jsonRequest({})
    );
    await loadAll();
    selectedModelId.value = data.model.model;
    syncSelectedModel();
    activeTab.value = "models";
    successMessage.value = `已复制为“${data.model.name}”，副本默认停用`;
  } catch (error) {
    errorMessage.value = messageOf(error, "复制模型失败");
  } finally {
    saving.value = "";
  }
}

function applyModelPreset(presetId: ModelPresetId) {
  const keepSortOrder = modelDraft.sortOrder || nextModelSortOrder();

  if (presetId === "blank") {
    Object.assign(modelDraft, emptyModelDraft(), { sortOrder: keepSortOrder });
    sizeRows.value = [{ label: "1024x1024", apiValue: "1024x1024" }];
    modelPresetId.value = presetId;
    return;
  }

  if (presetId.startsWith("katu-")) {
    const tier = presetId.endsWith("2k")
      ? "2K"
      : presetId.endsWith("4k")
        ? "4K"
        : "1K";
    const mapping = KATU_SIZE_MAPS[tier] || KATU_SIZE_MAPS["1K"]!;
    Object.assign(modelDraft, {
      model: `image-2-${tier.toLowerCase()}`,
      apiModelId: "image-2",
      name: `Image-2 · ${tier}`,
      description: `咖图 Image-2 ${tier} · 比例自动映射到对应像素尺寸`,
      enabled: false,
      qualitiesText: "",
      maxOutputImages: 1,
      supportsReferenceImages: true,
      maxReferenceImages: 1,
      supportsNegativePrompt: false,
      supportsSeed: false,
      points: modelDraft.points || "1"
    });
    setSizeRowsFromMap(mapping);
  } else if (presetId === "lingke-gpt-image-2") {
    Object.assign(modelDraft, {
      model: "gpt-image-2",
      apiModelId: "gpt-image-2",
      name: "GPT Image 2",
      description: "LingkeAI GPT Image 2 · 文生图 / 图生图 · 多图参考",
      enabled: false,
      qualitiesText: "auto, high, medium, low",
      maxOutputImages: 1,
      supportsReferenceImages: true,
      maxReferenceImages: 14,
      supportsNegativePrompt: false,
      supportsSeed: false,
      points: modelDraft.points || "1"
    });
    sizeRows.value = LINGKE_COMMON_SIZES.map((item) => ({
      label: item,
      apiValue: item
    }));
    syncSizeRowsToDraft();
  } else if (presetId === "grsai-gpt-image-2") {
    Object.assign(modelDraft, {
      model: "gpt-image-2",
      apiModelId: "gpt-image-2",
      name: "GPT Image 2",
      description: "GRSAI GPT Image 2 · 比例可直接传入 API",
      enabled: false,
      qualitiesText: "",
      maxOutputImages: 1,
      supportsReferenceImages: true,
      maxReferenceImages: 1,
      supportsNegativePrompt: false,
      supportsSeed: false,
      points: modelDraft.points || "1"
    });
    sizeRows.value = GRSAI_STANDARD_RATIOS.map((item) => ({
      label: item,
      apiValue: item
    }));
    syncSizeRowsToDraft();
  } else if (presetId.startsWith("grsai-vip-")) {
    const tier = presetId.endsWith("2k")
      ? "2K"
      : presetId.endsWith("4k")
        ? "4K"
        : "1K";
    const mapping = GRSAI_VIP_SIZE_MAPS[tier] || GRSAI_VIP_SIZE_MAPS["1K"]!;
    Object.assign(modelDraft, {
      model: `gpt-image-2-vip-${tier.toLowerCase()}`,
      apiModelId: "gpt-image-2-vip",
      name: `GPT Image 2 VIP · ${tier}`,
      description: `GRSAI GPT Image 2 VIP ${tier} · 比例自动映射到像素尺寸`,
      enabled: false,
      qualitiesText: "",
      maxOutputImages: 1,
      supportsReferenceImages: true,
      maxReferenceImages: 1,
      supportsNegativePrompt: false,
      supportsSeed: false,
      points: modelDraft.points || "1"
    });
    setSizeRowsFromMap(mapping);
  }

  modelDraft.sortOrder = keepSortOrder;
  modelPresetId.value = presetId;
  testForm.size = sizeRows.value[0]?.label || "1024x1024";
  successMessage.value = "模型模板已套用，可继续调整积分、尺寸和能力";
}

function setSizeRowsFromMap(mapping: Record<string, string>) {
  sizeRows.value = Object.entries(mapping).map(([label, apiValue]) => ({
    label,
    apiValue
  }));
  syncSizeRowsToDraft();
}

function syncSizeRowsFromDraft() {
  const labels = splitList(modelDraft.sizesText);
  let mapping: Record<string, unknown> = {};
  try {
    mapping = parseObject(modelDraft.sizeMappingText, "尺寸映射");
  } catch {
    mapping = {};
  }

  sizeRows.value = labels.map((label) => ({
    label,
    apiValue:
      typeof mapping[label] === "string"
        ? String(mapping[label])
        : label
  }));

  if (sizeRows.value.length === 0) {
    sizeRows.value = [{ label: "1024x1024", apiValue: "1024x1024" }];
  }
}

function syncSizeRowsToDraft() {
  const cleaned = sizeRows.value
    .map((row) => ({
      label: row.label.trim(),
      apiValue: row.apiValue.trim() || row.label.trim()
    }))
    .filter((row) => row.label);

  if (cleaned.length === 0) {
    cleaned.push({
      label: "1024x1024",
      apiValue: "1024x1024"
    });
  }

  sizeRows.value = cleaned;
  modelDraft.sizesText = cleaned.map((row) => row.label).join(", ");

  const mapping = Object.fromEntries(
    cleaned
      .filter((row) => row.apiValue && row.apiValue !== row.label)
      .map((row) => [row.label, row.apiValue])
  );
  modelDraft.sizeMappingText = pretty(mapping);
}

function addSizeRow() {
  sizeRows.value.push({
    label: "",
    apiValue: ""
  });
}

function removeSizeRow(index: number) {
  sizeRows.value.splice(index, 1);
  syncSizeRowsToDraft();
}

function selectModel(modelId: string) {
  cancelTestPolling();
  selectedModelId.value = modelId;
  creatingModel.value = false;
  modelPresetId.value = "blank";
  syncSelectedModel();
  testPreview.value = null;
  testResult.value = null;
}

function syncSelectedModel() {
  const model = selectedModel.value;
  if (!model) {
    Object.assign(modelDraft, emptyModelDraft());
    sizeRows.value = [{ label: "1024x1024", apiValue: "1024x1024" }];
    return;
  }

  const generic = isGenericModel(model);
  Object.assign(modelDraft, {
    model: model.model,
    apiModelId: model.apiModelId || model.model,
    name: model.name,
    description: model.description,
    enabled: model.enabled,
    sortOrder: model.sortOrder || 500,
    sizesText: model.sizes.join(", "),
    qualitiesText: model.qualities.join(", "),
    maxOutputImages: model.maxOutputImages,
    supportsReferenceImages: model.supportsReferenceImages,
    maxReferenceImages: model.maxReferenceImages || 1,
    supportsNegativePrompt: model.supportsNegativePrompt,
    supportsSeed: model.supportsSeed,
    sizeMappingText: generic ? pretty(model.sizeMapping || {}) : pretty({}),
    requestOverridesText: generic ? pretty(model.requestOverrides || {}) : pretty({}),
    points: String(model.points)
  });

  testForm.size = model.sizes[0] || "1024x1024";
  testForm.quality = model.qualities[0] || "";
  syncSizeRowsFromDraft();
}

function startCreateModel() {
  if (!selectedUnified.value || selectedKind.value !== "generic") {
    errorMessage.value = "现有兼容服务商的模型由系统注册；新增自定义模型请先新增通用服务商";
    return;
  }

  const presetToKeep = modelPresetId.value;
  const presetStillAvailable = availableModelPresets.value.some(
    (item) => item.id === presetToKeep
  );

  creatingModel.value = true;
  selectedModelId.value = "";
  Object.assign(modelDraft, emptyModelDraft(), {
    sortOrder: nextModelSortOrder()
  });
  sizeRows.value = [{ label: "1024x1024", apiValue: "1024x1024" }];
  modelPresetId.value = "blank";
  activeTab.value = "models";
  clearMessages();

  if (presetToKeep !== "blank" && presetStillAvailable) {
    applyModelPreset(presetToKeep);
  }
}

function nextModelSortOrder() {
  const maxOrder = currentModels.value.reduce(
    (max, item) => Math.max(max, Number(item.sortOrder) || 0),
    0
  );
  return Math.min(9999, maxOrder > 0 ? maxOrder + 10 : 100);
}

function toggleQualitySupport(event: Event) {
  if (!qualityCanEdit.value) return;

  const checked = (event.target as HTMLInputElement).checked;
  if (!checked) {
    modelDraft.qualitiesText = "";
    testForm.quality = "";
    return;
  }

  if (knownApiProfile.value === "lingke") {
    modelDraft.qualitiesText = "auto, high, medium, low";
  } else {
    modelDraft.qualitiesText = "auto";
  }
  testForm.quality = splitList(modelDraft.qualitiesText)[0] || "";
}

function toggleQualityValue(value: string) {
  if (!qualityCanEdit.value) return;

  const current = splitList(modelDraft.qualitiesText);
  const exists = current.includes(value);
  const next = exists
    ? current.filter((item) => item !== value)
    : [...current, value];

  modelDraft.qualitiesText = standardQualityValues
    .filter((item) => next.includes(item))
    .join(", ");

  const available = splitList(modelDraft.qualitiesText);
  if (!available.includes(testForm.quality)) {
    testForm.quality = available[0] || "";
  }
}

async function saveProvider() {
  clearMessages();

  if (creatingProvider.value || selectedKind.value === "generic") {
    await saveGenericProvider();
    return;
  }

  if (selectedKind.value === "builtin") {
    await saveBuiltInProvider();
  }
}

async function saveGenericProvider() {
  let headers: Record<string, unknown>;
  let requestTemplate: Record<string, unknown>;
  let responseMapping: Record<string, unknown>;
  let asyncConfig: Record<string, unknown>;

  try {
    headers = parseObject(providerDraft.headersText, "额外 Header");
    requestTemplate = parseObject(providerDraft.requestTemplateText, "请求模板");
    responseMapping = parseObject(providerDraft.responseMappingText, "响应映射");
    asyncConfig = parseObject(providerDraft.asyncConfigText, "异步配置");
  } catch (error) {
    errorMessage.value = messageOf(error, "JSON 配置错误");
    return;
  }

  const payload = {
    id: providerDraft.id.trim(),
    displayName: providerDraft.displayName.trim(),
    baseUrl: providerDraft.baseUrl.trim(),
    endpoint: providerDraft.endpoint.trim(),
    apiKey: providerDraft.apiKey.trim() || undefined,
    clearApiKey: providerDraft.clearApiKey,
    authType: providerDraft.authType,
    authHeader: providerDraft.authHeader.trim(),
    authScheme: providerDraft.authScheme.trim(),
    authQueryName: providerDraft.authQueryName.trim(),
    requestMethod: providerDraft.requestMethod,
    timeoutMs: Number(providerDraft.timeoutMs),
    enabled: providerDraft.enabled,
    sortOrder: Number(providerDraft.sortOrder),
    headers,
    requestTemplate,
    responseMapping,
    asyncConfig
  };

  saving.value = "provider";
  try {
    if (creatingProvider.value) {
      const data = await apiRequest<{ provider: GenericProvider }>(
        "/api/admin/api-providers",
        jsonRequest(payload)
      );
      selectedKey.value = `generic:${data.provider.id}`;
      creatingProvider.value = false;
      successMessage.value = `已创建 ${data.provider.displayName}`;
    } else if (selectedGeneric.value) {
      await apiRequest(
        `/api/admin/api-providers/${encodeURIComponent(selectedGeneric.value.id)}`,
        jsonRequest(payload, "PATCH")
      );
      successMessage.value = "服务商配置已保存";
    }

    providerDraft.apiKey = "";
    providerDraft.clearApiKey = false;
    await loadAll();
  } catch (error) {
    errorMessage.value = messageOf(error, "保存服务商失败");
  } finally {
    saving.value = "";
  }
}

async function saveBuiltInProvider() {
  const provider = selectedBuiltin.value;
  if (!provider) return;

  if (
    providerDraft.clearApiKey &&
    !await platformConfirm(`确定清除 ${provider.displayName} 的 API Key 吗？`)
  ) {
    return;
  }

  saving.value = "provider";
  try {
    await apiRequest(
      `/api/admin/builtin-api-providers/${encodeURIComponent(provider.id)}`,
      jsonRequest({
        displayName: providerDraft.displayName.trim(),
        baseUrl: providerDraft.baseUrl.trim(),
        generateEndpoint: providerDraft.endpoint.trim(),
        statusEndpoint: providerDraft.statusEndpoint.trim(),
        timeoutMs: Number(providerDraft.timeoutMs),
        enabled: providerDraft.enabled,
        sortOrder: Number(providerDraft.sortOrder),
        apiKey: providerDraft.apiKey.trim() || undefined,
        clearApiKey: providerDraft.clearApiKey,
        imageSize: provider.id === "nanobanana"
          ? providerDraft.imageSize
          : undefined
      }, "PATCH")
    );
    successMessage.value = "服务商配置已保存";
    providerDraft.apiKey = "";
    providerDraft.clearApiKey = false;
    await loadAll();
  } catch (error) {
    errorMessage.value = messageOf(error, "保存服务商失败");
  } finally {
    saving.value = "";
  }
}

async function deleteProvider() {
  const provider = selectedGeneric.value;
  if (!provider) return;
  if (!await platformConfirm(`确定删除“${provider.displayName}”及其全部模型吗？`)) return;

  saving.value = "provider-delete";
  clearMessages();
  try {
    await apiRequest(
      `/api/admin/api-providers/${encodeURIComponent(provider.id)}`,
      { method: "DELETE" }
    );
    selectedKey.value = "";
    successMessage.value = "服务商已删除";
    await loadAll();
  } catch (error) {
    errorMessage.value = messageOf(error, "删除服务商失败");
  } finally {
    saving.value = "";
  }
}

async function saveModel() {
  syncSizeRowsToDraft();

  if (!selectedUnified.value) {
    errorMessage.value = "请先选择服务商";
    return;
  }

  saving.value = "model";
  clearMessages();

  try {
    if (selectedKind.value === "builtin") {
      const model = selectedModel.value;
      if (!model) return;

      if (
        knownApiProfile.value === "grsai" &&
        Number(modelDraft.maxOutputImages) > 1
      ) {
        errorMessage.value =
          "GRSAI 当前文档没有 n / count 数量参数，单次最多请保持为 1。";
        return;
      }

      await apiRequest(
        `/api/admin/builtin-api-providers/${encodeURIComponent(selectedUnified.value.id)}/models/${encodeURIComponent(model.model)}`,
        jsonRequest({
          name: modelDraft.name.trim(),
          apiModelId: modelDraft.apiModelId.trim() || model.model,
          description: modelDraft.description.trim(),
          sortOrder: Number(modelDraft.sortOrder),
          sizes: splitList(modelDraft.sizesText),
          maxOutputImages: Number(modelDraft.maxOutputImages),
          supportsReferenceImages: modelDraft.supportsReferenceImages,
          maxReferenceImages: modelDraft.supportsReferenceImages
            ? Number(modelDraft.maxReferenceImages)
            : 0,
          qualities: splitList(modelDraft.qualitiesText),
          supportsNegativePrompt: modelDraft.supportsNegativePrompt,
          supportsSeed: modelDraft.supportsSeed,
          enabled: modelDraft.enabled,
          points: Number(modelDraft.points)
        }, "PATCH")
      );
      successMessage.value = "模型参数已保存";
      await loadAll();
      return;
    }

    const provider = selectedGeneric.value;
    if (!provider) return;

    if (creatingModel.value) {
      // V14_3_0_1_LINGKE_INTERNAL_ID
      // Lingke uses one third-party API model id (gpt-image-2), while the
      // console may keep separate 1K / 2K / 4K local configurations.
      // If the legacy template still leaves the internal id as gpt-image-2,
      // infer the tier from the display name / size labels before POSTing.
      if (
        knownApiProfile.value === "lingke" &&
        modelDraft.model.trim() === "gpt-image-2" &&
        modelDraft.apiModelId.trim() === "gpt-image-2"
      ) {
        const tierSource = [
          modelDraft.name,
          ...sizeRows.value.map((row) => row.label)
        ].join(" ");
        const tierMatch = /(?:^|[^0-9A-Za-z])(1K|2K|4K)(?=$|[^0-9A-Za-z])/i.exec(tierSource);
        const tier = tierMatch?.[1]?.toLowerCase();
        if (tier) {
          modelDraft.model = `gpt-image-2-${tier}`;
        }
      }

      const modelId = modelDraft.model.trim();
      const modelName = modelDraft.name.trim();

      if (!modelId) {
        errorMessage.value =
          "请先选择模型模板，或填写“内部模型 ID”后再创建。";
        return;
      }

      if (!modelName) {
        errorMessage.value =
          "请输入模型显示名称后再创建。";
        return;
      }

      if (!modelDraft.apiModelId.trim()) {
        modelDraft.apiModelId = modelId;
      }
    }

    let sizeMapping: Record<string, unknown>;
    let requestOverrides: Record<string, unknown>;
    try {
      sizeMapping = parseObject(modelDraft.sizeMappingText, "尺寸映射");
      requestOverrides = parseObject(modelDraft.requestOverridesText, "请求覆盖");
    } catch (error) {
      errorMessage.value = messageOf(error, "模型 JSON 配置错误");
      return;
    }

    if (
      Number(modelDraft.maxOutputImages) > 1 &&
      !requestTemplateUsesCount.value
    ) {
      errorMessage.value =
        "当前请求模板没有使用 {{count}} 数量变量。请先在协议模板接入数量参数，或把单次最多设为 1。";
      return;
    }

    if (
      qualityEnabled.value &&
      !requestTemplateUsesQuality.value
    ) {
      errorMessage.value =
        "已开启 Quality，但当前请求模板没有使用 {{quality}}。请先在协议模板加入该变量，或关闭 Quality。";
      return;
    }

    const payload = {
      model: modelDraft.model.trim(),
      apiModelId: modelDraft.apiModelId.trim() || modelDraft.model.trim(),
      name: modelDraft.name.trim(),
      description: modelDraft.description.trim(),
      enabled: modelDraft.enabled,
      sortOrder: Number(modelDraft.sortOrder),
      sizes: splitList(modelDraft.sizesText),
      qualities: splitList(modelDraft.qualitiesText),
      maxOutputImages: Number(modelDraft.maxOutputImages),
      supportsReferenceImages: modelDraft.supportsReferenceImages,
      maxReferenceImages: modelDraft.supportsReferenceImages
        ? Number(modelDraft.maxReferenceImages)
        : 0,
      supportsNegativePrompt: modelDraft.supportsNegativePrompt,
      supportsSeed: modelDraft.supportsSeed,
      sizeMapping,
      requestOverrides,
      points: Number(modelDraft.points)
    };

    if (creatingModel.value) {
      const data = await apiRequest<{ model: GenericModel }>(
        `/api/admin/api-providers/${encodeURIComponent(provider.id)}/models`,
        jsonRequest(payload)
      );
      selectedModelId.value = data.model.model;
      creatingModel.value = false;
      successMessage.value = "模型已创建";
    } else if (selectedModel.value) {
      await apiRequest(
        `/api/admin/api-providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(selectedModel.value.model)}`,
        jsonRequest(payload, "PATCH")
      );
      successMessage.value = "模型参数已保存";
    }

    await loadAll();
    if (selectedModelId.value) selectModel(selectedModelId.value);
  } catch (error) {
    errorMessage.value = messageOf(error, "保存模型失败");
  } finally {
    saving.value = "";
  }
}

async function deleteModel() {
  const provider = selectedGeneric.value;
  const model = selectedModel.value;
  if (!provider || !model || selectedKind.value !== "generic") return;
  if (!await platformConfirm(`确定删除模型“${model.name}”吗？`)) return;

  saving.value = "model-delete";
  clearMessages();
  try {
    await apiRequest(
      `/api/admin/api-providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(model.model)}`,
      { method: "DELETE" }
    );
    selectedModelId.value = "";
    successMessage.value = "模型已删除";
    await loadAll();
  } catch (error) {
    errorMessage.value = messageOf(error, "删除模型失败");
  } finally {
    saving.value = "";
  }
}

async function previewRequest() {
  const provider = selectedGeneric.value;
  const model = selectedModel.value;
  if (!provider || !model || selectedKind.value !== "generic") {
    errorMessage.value = "API 调试仅适用于通用协议服务商";
    return;
  }

  saving.value = "preview";
  clearMessages();
  try {
    const data = await apiRequest<{ preview: unknown }>(
      `/api/admin/api-providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(model.model)}/preview`,
      jsonRequest(testPayload())
    );
    testPreview.value = data.preview;
    testResult.value = null;
    successMessage.value = "请求已渲染；没有向第三方发送请求";
  } catch (error) {
    errorMessage.value = messageOf(error, "请求预览失败");
  } finally {
    saving.value = "";
  }
}

async function runTest() {
  const provider = selectedGeneric.value;
  const model = selectedModel.value;
  if (!provider || !model || selectedKind.value !== "generic") {
    errorMessage.value = "请选择一个通用协议模型";
    return;
  }

  if (!await platformConfirm("真实测试会调用第三方 API，并可能产生第三方费用，但不会扣本站用户积分。继续吗？")) {
    return;
  }

  cancelTestPolling();
  const runId = ++testRunSerial;
  saving.value = "test";
  testPolling.value = false;
  testElapsedSeconds.value = 0;
  clearMessages();
  testResult.value = null;

  try {
    const startedAt = Date.now();
    const data = await apiRequest<{ result: TestResult }>(
      `/api/admin/api-providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(model.model)}/test`,
      jsonRequest(testPayload())
    );
    testResult.value = data.result;

    if (data.result.pending && data.result.taskId) {
      saving.value = "";
      testPolling.value = true;
      successMessage.value = `任务已提交 · ${data.result.providerStatus || "QUEUED"} · 正在后台轮询`;
      await pollTestUntilDone(
        provider.id,
        model.model,
        data.result.taskId,
        runId,
        startedAt
      );
      return;
    }

    successMessage.value = data.result.ok
      ? `API 测试通过，解析到 ${data.result.imageCount || 0} 张图片`
      : "";
    if (!data.result.ok) {
      errorMessage.value = data.result.error || "API 测试未通过";
    }
  } catch (error) {
    errorMessage.value = messageOf(error, "API 测试失败");
  } finally {
    if (runId === testRunSerial) {
      saving.value = "";
    }
  }
}

async function pollTestUntilDone(
  providerId: string,
  modelId: string,
  taskId: string,
  runId: number,
  startedAt: number
) {
  const asyncConfig = selectedGeneric.value?.asyncConfig || {};
  const interval = clampNumber(asyncConfig.pollIntervalMs, 1000, 10000, 3000);
  const maxWait = clampNumber(asyncConfig.maxWaitMs, 10000, 900000, 300000);

  while (runId === testRunSerial && Date.now() - startedAt <= maxWait) {
    await delay(interval);
    if (runId !== testRunSerial) return;

    testElapsedSeconds.value = Math.round((Date.now() - startedAt) / 1000);

    try {
      const data = await apiRequest<{ result: TestResult }>(
        `/api/admin/api-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/test-status`,
        jsonRequest({ taskId })
      );
      testResult.value = data.result;

      if (data.result.pending) {
        successMessage.value = `异步任务处理中 · ${data.result.providerStatus || "PROCESSING"} · ${testElapsedSeconds.value}s`;
        continue;
      }

      testPolling.value = false;
      if (data.result.ok) {
        successMessage.value = `API 测试通过 · ${testElapsedSeconds.value}s · ${data.result.imageCount || 0} 张图片`;
      } else {
        errorMessage.value = data.result.error || "异步任务失败";
      }
      return;
    } catch (error) {
      testPolling.value = false;
      errorMessage.value = messageOf(error, "查询异步测试任务失败");
      return;
    }
  }

  if (runId === testRunSerial) {
    testPolling.value = false;
    errorMessage.value = "测试任务等待超时。第三方任务可能仍在继续，请在服务商后台确认。";
  }
}

function cancelTestPolling() {
  testRunSerial += 1;
  testPolling.value = false;
  testElapsedSeconds.value = 0;
}

function copyVariable(variable: string) {
  const token = `{{${variable}}}`;
  navigator.clipboard?.writeText(token).catch(() => undefined);
  successMessage.value = `${token} 已复制`;
}

function testPayload() {
  return {
    prompt: testForm.prompt,
    negativePrompt: testForm.negativePrompt || undefined,
    size: testForm.size,
    quality: testForm.quality,
    count: Number(testForm.count),
    seed: testForm.seed.trim() ? Number(testForm.seed) : undefined
  };
}

function emptyProviderDraft(): ProviderDraft {
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

function emptyModelDraft(): ModelDraft {
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

function isGenericModel(model: GenericModel | BuiltInModel): model is GenericModel {
  return "qualities" in model;
}

function parseObject(value: string, label: string): Record<string, unknown> {
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

function splitList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pretty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(min, Math.min(max, numeric))
    : fallback;
}

function clearMessages() {
  errorMessage.value = "";
  successMessage.value = "";
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
</script>

<template>
  <section class="provider-center">
    <header class="center-head">
      <div class="head-copy">
        <span class="eyebrow">MODEL INFRASTRUCTURE · V14.2.7</span>
        <h2>模型与服务商</h2>
        <p>服务商、协议、模型能力、启停与价格集中在一个页面管理。</p>
      </div>

      <div class="head-actions">
        <div class="metric">
          <strong>{{ stats.providers }}</strong>
          <span>服务商</span>
        </div>
        <div class="metric">
          <strong>{{ stats.models }}</strong>
          <span>模型</span>
        </div>
        <div class="metric">
          <strong>{{ stats.enabledProviders }}</strong>
          <span>已启用</span>
        </div>
        <button class="primary-button" type="button" @click="startCreateProvider">
          ＋ 新增服务商
        </button>
      </div>
    </header>

    <div v-if="successMessage" class="notice success">
      <span>{{ successMessage }}</span>
      <button type="button" @click="successMessage = ''">×</button>
    </div>
    <div v-if="errorMessage" class="notice error">
      <span>{{ errorMessage }}</span>
      <button type="button" @click="errorMessage = ''">×</button>
    </div>

    <div class="provider-workspace">
      <aside class="provider-sidebar">
        <div class="sidebar-title">
          <div>
            <strong>服务商</strong>
            <span>{{ stats.providers }} 个</span>
          </div>
          <button type="button" title="刷新" @click="loadAll">↻</button>
        </div>

        <div class="search-box">
          <span>⌕</span>
          <input v-model="providerSearch" placeholder="搜索名称、ID 或域名" />
        </div>

        <div v-if="loading" class="empty-list">正在读取配置…</div>

        <div v-else class="provider-scroll">
          <button
            v-for="provider in filteredProviders"
            :key="provider.key"
            type="button"
            class="provider-row"
            :class="{ active: provider.key === selectedKey }"
            @click="selectProvider(provider.key)"
          >
            <span class="provider-avatar">
              {{ provider.displayName.slice(0, 1).toUpperCase() }}
            </span>

            <span class="provider-copy">
              <span class="provider-name-line">
                <strong>{{ provider.displayName }}</strong>
                <i :class="{ on: provider.enabled }"></i>
              </span>
              <small>
                {{ provider.id }} · {{ provider.modelCount }} 模型
              </small>
            </span>

            <em :class="{ legacy: provider.kind === 'builtin' }">
              {{ provider.kind === "builtin" ? "系统" : "自定义" }}
            </em>
          </button>

          <div v-if="filteredProviders.length === 0" class="empty-list">
            没有匹配的服务商
          </div>
        </div>

        <div class="sidebar-foot">
          <span>API Key 加密保存</span>
          <span>{{ stats.enabledProviders }}/{{ stats.providers }} 在线</span>
        </div>
      </aside>

      <main class="provider-main">
        <div v-if="!creatingProvider && !selectedUnified" class="blank-state">
          <div class="blank-icon">＋</div>
          <h3>开始接入模型服务商</h3>
          <p>可以从空白配置开始，也可以直接套用三家常用 API 模板。</p>

          <div class="quick-start-grid">
            <button
              v-for="preset in providerPresets"
              :key="preset.id"
              type="button"
              @click="startCreateProviderWithPreset(preset.id)"
            >
              <strong>{{ preset.name }}</strong>
              <span>{{ preset.hint }}</span>
            </button>
          </div>
        </div>

        <template v-else>
          <header class="provider-head">
            <div class="provider-head-copy">
              <div class="provider-title-line">
                <h3>
                  {{ creatingProvider ? "新增模型服务商" : selectedUnified?.displayName }}
                </h3>
                <span
                  v-if="!creatingProvider"
                  class="type-badge"
                  :class="{ legacy: selectedKind === 'builtin' }"
                >
                  {{ selectedKind === "builtin" ? "系统适配器" : "通用协议" }}
                </span>
                <span
                  v-if="!creatingProvider"
                  class="status-badge"
                  :class="{ on: providerDraft.enabled }"
                >
                  {{ providerDraft.enabled ? "已启用" : "已停用" }}
                </span>
              </div>

              <p v-if="!creatingProvider && selectedUnified">
                {{ selectedUnified.baseUrl }}{{ selectedUnified.endpoint }}
              </p>
              <p v-else>
                先选择接入模板，再填写 API Key；保存后继续添加模型。
              </p>
            </div>

            <div class="provider-actions">
              <label class="switch-line">
                <input v-model="providerDraft.enabled" type="checkbox" />
                <span>前台启用</span>
              </label>

              <button
                v-if="canCloneProvider"
                class="soft-button"
                type="button"
                :disabled="saving === 'provider-clone'"
                @click="cloneProvider"
              >
                {{ saving === "provider-clone" ? "复制中…" : "复制" }}
              </button>

              <button
                v-if="canDeleteProvider"
                class="danger-button"
                type="button"
                :disabled="saving === 'provider-delete'"
                @click="deleteProvider"
              >
                删除
              </button>

              <button
                class="primary-button"
                type="button"
                :disabled="saving === 'provider'"
                @click="saveProvider"
              >
                {{
                  saving === "provider"
                    ? "保存中…"
                    : creatingProvider
                      ? "创建服务商"
                      : "保存修改"
                }}
              </button>
            </div>
          </header>

          <div
            v-if="creatingProvider || isGeneric"
            class="preset-bar"
          >
            <div>
              <strong>快速接入模板</strong>
              <span>自动填写请求、响应和异步规则，不包含 API Key。</span>
            </div>

            <div class="preset-buttons">
              <button
                v-for="preset in providerPresets"
                :key="preset.id"
                type="button"
                :class="{ active: providerPresetId === preset.id }"
                @click="applyProviderPreset(preset.id)"
              >
                <strong>{{ preset.name }}</strong>
                <small>{{ preset.hint }}</small>
              </button>
            </div>
          </div>

          <nav class="main-tabs">
            <button
              type="button"
              :class="{ active: activeTab === 'connection' }"
              @click="activeTab = 'connection'"
            >
              连接与认证
            </button>
            <button
              type="button"
              :disabled="selectedKind === 'builtin' && !creatingProvider"
              :class="{ active: activeTab === 'protocol' }"
              @click="activeTab = 'protocol'"
            >
              API 协议
            </button>
            <button
              type="button"
              :disabled="creatingProvider"
              :class="{ active: activeTab === 'models' }"
              @click="activeTab = 'models'"
            >
              模型与价格
            </button>
            <button
              v-if="isGeneric && !creatingProvider"
              type="button"
              :class="{ active: activeTab === 'test' }"
              @click="activeTab = 'test'"
            >
              API 调试
            </button>
          </nav>

          <section v-if="activeTab === 'connection'" class="section-body">
            <div class="overview-grid">
              <article>
                <span>API Key</span>
                <strong>
                  {{
                    selectedUnified?.apiKeyConfigured
                      ? "已配置"
                      : providerDraft.apiKey
                        ? "待保存"
                        : "未配置"
                  }}
                </strong>
                <small>密钥不会在后台明文回显</small>
              </article>
              <article>
                <span>调用模式</span>
                <strong>
                  {{
                    selectedKind === "builtin"
                      ? "系统适配"
                      : providerDraft.asyncConfigText.includes('"enabled": true')
                        ? "异步任务"
                        : "同步请求"
                  }}
                </strong>
                <small>协议页可以继续调整</small>
              </article>
              <article>
                <span>模型数量</span>
                <strong>{{ currentModels.length }}</strong>
                <small>价格统一在模型页编辑</small>
              </article>
            </div>

            <div class="section-title">
              <div>
                <h4>连接信息</h4>
                <p>日常最常改的配置全部放在这里。</p>
              </div>
              <span
                v-if="!creatingProvider && selectedUnified?.apiKeyConfigured"
                class="key-ok"
              >
                API Key 已配置
              </span>
            </div>

            <div class="form-grid">
              <label>
                <span>服务商 ID</span>
                <input
                  v-model="providerDraft.id"
                  :disabled="!creatingProvider"
                  placeholder="katuai-api"
                />
                <small>创建后不可修改，用于内部路由</small>
              </label>

              <label>
                <span>显示名称</span>
                <input v-model="providerDraft.displayName" placeholder="咖图 AI" />
              </label>

              <label class="wide">
                <span>Base URL</span>
                <input v-model="providerDraft.baseUrl" placeholder="https://api.example.com" />
              </label>

              <div class="connection-primary-row">
                <label>
                  <span>生成接口</span>
                  <input v-model="providerDraft.endpoint" placeholder="/v1/images/generations" />
                </label>

                <label>
                  <span>请求超时</span>
                  <div class="input-unit">
                    <input
                      v-model.number="providerDraft.timeoutMs"
                      type="number"
                      min="1000"
                      max="900000"
                    />
                    <b>ms</b>
                  </div>
                </label>

                <label>
                  <span>前台排序</span>
                  <input
                    v-model.number="providerDraft.sortOrder"
                    type="number"
                    min="1"
                    max="9999"
                  />
                </label>
              </div>

              <label v-if="selectedKind !== 'builtin'">
                <span>请求方式</span>
                <select v-model="providerDraft.requestMethod">
                  <option>POST</option>
                  <option>GET</option>
                  <option>PUT</option>
                  <option>PATCH</option>
                </select>
              </label>

              <label v-if="selectedKind === 'builtin' && providerDraft.statusEndpoint">
                <span>任务查询接口</span>
                <input v-model="providerDraft.statusEndpoint" />
              </label>

              <template v-if="creatingProvider || isGeneric">
                <label>
                  <span>认证方式</span>
                  <select v-model="providerDraft.authType">
                    <option value="bearer">Bearer Token</option>
                    <option value="header">自定义 Header</option>
                    <option value="query">Query 参数</option>
                    <option value="none">无认证</option>
                  </select>
                </label>

                <label v-if="providerDraft.authType !== 'none' && providerDraft.authType !== 'query'">
                  <span>Header 名称</span>
                  <input v-model="providerDraft.authHeader" placeholder="Authorization" />
                </label>

                <label v-if="providerDraft.authType === 'bearer'">
                  <span>认证前缀</span>
                  <input v-model="providerDraft.authScheme" placeholder="Bearer" />
                </label>

                <label v-if="providerDraft.authType === 'query'">
                  <span>Query 参数名</span>
                  <input v-model="providerDraft.authQueryName" placeholder="api_key" />
                </label>
              </template>

              <label class="wide">
                <span>
                  {{
                    selectedUnified?.apiKeyConfigured
                      ? "更换 API Key（留空保持原 Key）"
                      : "API Key"
                  }}
                </span>
                <input
                  v-model="providerDraft.apiKey"
                  type="password"
                  autocomplete="new-password"
                  placeholder="sk-..."
                />
              </label>

              <label
                v-if="!creatingProvider && selectedUnified?.apiKeyConfigured"
                class="check-card wide"
              >
                <input v-model="providerDraft.clearApiKey" type="checkbox" />
                <span>
                  <strong>清除当前 API Key</strong>
                  <small>保存后立即失效，操作前请确认。</small>
                </span>
              </label>
            </div>

            <div v-if="selectedKind === 'builtin'" class="compat-note">
              <div>
                <strong>系统兼容适配器</strong>
                <span>
                  为了不影响现有线上任务，这类服务商保留原执行器。你可以停用，或点击“复制”生成一个可完全编辑、可删除的通用服务商副本。
                </span>
              </div>
              <button class="soft-button" type="button" @click="cloneProvider">
                复制为通用配置
              </button>
            </div>
          </section>

          <section v-else-if="activeTab === 'protocol'" class="section-body">
            <div class="section-title">
              <div>
                <h4>API 协议</h4>
                <p>常用模板已经自动配置；只有遇到特殊中转 API 时才需要展开高级编辑。</p>
              </div>
            </div>

            <div class="protocol-summary">
              <article>
                <span>请求</span>
                <strong>{{ providerDraft.requestMethod }}</strong>
                <small>{{ providerDraft.endpoint }}</small>
              </article>
              <article>
                <span>响应</span>
                <strong>字段映射</strong>
                <small>自动提取 URL / Base64 / task_id</small>
              </article>
              <article>
                <span>异步</span>
                <strong>
                  {{
                    providerDraft.asyncConfigText.includes('"enabled": true')
                      ? "已启用"
                      : "关闭"
                  }}
                </strong>
                <small>支持任务轮询与测试状态跟踪</small>
              </article>
            </div>

            <details class="protocol-card" open>
              <summary>
                <div>
                  <strong>请求模板</strong>
                  <span>发送给第三方的 JSON Body</span>
                </div>
                <b>REQUEST</b>
              </summary>

              <div class="protocol-content">
                <div class="variable-row">
                  <button
                    v-for="variable in variables"
                    :key="variable"
                    type="button"
                    @click="copyVariable(variable)"
                  >
                    {{ variable }}
                  </button>
                </div>

                <textarea
                  v-model="providerDraft.requestTemplateText"
                  class="code-editor"
                  spellcheck="false"
                ></textarea>
              </div>
            </details>

            <details class="protocol-card">
              <summary>
                <div>
                  <strong>响应解析</strong>
                  <span>图片 URL、Base64、Request ID、Task ID</span>
                </div>
                <b>RESPONSE</b>
              </summary>

              <div class="protocol-content">
                <textarea
                  v-model="providerDraft.responseMappingText"
                  class="code-editor medium"
                  spellcheck="false"
                ></textarea>
              </div>
            </details>

            <details class="protocol-card">
              <summary>
                <div>
                  <strong>异步任务</strong>
                  <span>查询地址、状态字段、终态与结果映射</span>
                </div>
                <b>ASYNC</b>
              </summary>

              <div class="protocol-content">
                <textarea
                  v-model="providerDraft.asyncConfigText"
                  class="code-editor tall"
                  spellcheck="false"
                ></textarea>
              </div>
            </details>

            <details class="protocol-card">
              <summary>
                <div>
                  <strong>额外 Header</strong>
                  <span>例如 Prefer: respond-async</span>
                </div>
                <b>HEADER</b>
              </summary>

              <div class="protocol-content">
                <textarea
                  v-model="providerDraft.headersText"
                  class="code-editor short"
                  spellcheck="false"
                ></textarea>
              </div>
            </details>
          </section>

          <section v-else-if="activeTab === 'models'" class="section-body model-section">
            <div class="section-title model-section-title">
              <div>
                <h4>模型与价格</h4>
                <p>模型能力、尺寸、前台启停和单张积分在这里一次完成。</p>
              </div>

              <button
                v-if="isGeneric"
                class="primary-button"
                type="button"
                @click="startCreateModel"
              >
                ＋ 新增模型
              </button>
            </div>

            <div
              v-if="isGeneric"
              class="model-preset-panel"
            >
              <div>
                <strong>模型模板</strong>
                <span>根据当前服务商自动推荐尺寸和能力配置。</span>
              </div>

              <div class="model-preset-buttons">
                <button
                  v-for="preset in availableModelPresets"
                  :key="preset.id"
                  type="button"
                  :class="{ active: modelPresetId === preset.id }"
                  @click="applyModelPreset(preset.id)"
                >
                  <strong>{{ preset.name }}</strong>
                  <small>{{ preset.hint }}</small>
                </button>
              </div>
            </div>

            <div class="model-workspace">
              <aside class="model-list">
                <header>
                  <strong>模型列表</strong>
                  <span>{{ currentModels.length }}</span>
                </header>

                <button
                  v-for="model in currentModels"
                  :key="model.model"
                  type="button"
                  class="model-row"
                  :class="{ active: model.model === selectedModelId }"
                  @click="selectModel(model.model)"
                >
                  <span class="model-row-main">
                    <strong>{{ model.name }}</strong>
                    <small>{{ model.model }}</small>
                  </span>
                  <span class="model-row-price">
                    <strong>{{ model.points }}</strong>
                    <small>积分/张 · 顺序 {{ model.sortOrder || 500 }}</small>
                  </span>
                  <i :class="{ on: model.enabled }"></i>
                </button>

                <div v-if="currentModels.length === 0" class="empty-model">
                  暂无模型
                </div>
              </aside>

              <div class="model-editor">
                <div v-if="!creatingModel && !selectedModel" class="blank-model">
                  <div class="blank-icon small">M</div>
                  <h4>选择一个模型</h4>
                  <p>编辑价格、尺寸、参考图和 API Model ID。</p>
                </div>

                <template v-else>
                  <header class="model-head">
                    <div>
                      <span class="eyebrow">
                        {{ creatingModel ? "NEW MODEL" : "MODEL CONFIG" }}
                      </span>
                      <h4>{{ creatingModel ? "新增模型" : selectedModel?.name }}</h4>
                      <p>{{ creatingModel ? "创建后立即进入当前服务商" : selectedModel?.model }}</p>
                    </div>

                    <div class="model-actions">
                      <button
                        v-if="isGeneric && canCloneModel"
                        class="soft-button"
                        type="button"
                        :disabled="saving === 'model-clone'"
                        @click="cloneModel"
                      >
                        {{ saving === "model-clone" ? "复制中…" : "复制模型" }}
                      </button>

                      <button
                        v-if="isGeneric && !creatingModel"
                        class="danger-button"
                        type="button"
                        :disabled="saving === 'model-delete'"
                        @click="deleteModel"
                      >
                        删除
                      </button>

                      <button
                        class="primary-button"
                        type="button"
                        :disabled="saving === 'model'"
                        @click="saveModel"
                      >
                        {{ saving === "model" ? "保存中…" : creatingModel ? "创建模型" : "保存模型" }}
                      </button>
                    </div>
                  </header>

                  <div class="pricing-card">
                    <div>
                      <span>前台状态</span>
                      <label class="switch-line large">
                        <input v-model="modelDraft.enabled" type="checkbox" />
                        <strong>{{ modelDraft.enabled ? "允许使用" : "暂不开放" }}</strong>
                      </label>
                    </div>

                    <label>
                      <span>单张积分</span>
                      <div class="price-input">
                        <input
                          v-model="modelDraft.points"
                          type="number"
                          min="0"
                          step="0.01"
                        />
                        <b>积分 / 张</b>
                      </div>
                    </label>

                    <label>
                      <span>单次最多</span>
                      <div class="price-input">
                        <input
                          v-model.number="modelDraft.maxOutputImages"
                          type="number"
                          min="1"
                          max="16"
                        />
                        <b>张</b>
                      </div>
                      <small class="field-help">{{ outputCountHint }}</small>
                    </label>

                    <label>
                      <span>显示顺序</span>
                      <div class="price-input">
                        <input
                          v-model.number="modelDraft.sortOrder"
                          type="number"
                          min="1"
                          max="9999"
                          step="1"
                        />
                        <b>小值靠前</b>
                      </div>
                    </label>
                  </div>

                  <div class="section-subtitle">
                    <strong>基础信息</strong>
                    <span>内部 ID 与第三方实际 Model ID 分开管理。</span>
                  </div>

                  <div class="form-grid model-form-grid">
                    <label>
                      <span>内部模型 ID</span>
                      <input
                        v-model="modelDraft.model"
                        :disabled="!creatingModel"
                        placeholder="image-2-1k"
                      />
                    </label>

                    <label>
                      <span>API Model ID</span>
                      <input
                        v-model="modelDraft.apiModelId"
                        placeholder="image-2"
                      />
                    </label>

                    <label>
                      <span>显示名称</span>
                      <input v-model="modelDraft.name" />
                    </label>

                    <label class="wide">
                      <span>模型说明</span>
                      <input v-model="modelDraft.description" />
                    </label>
                  </div>

                  <div class="section-subtitle">
                    <strong>模型能力</strong>
                    <span>开启后前台会自动显示对应输入项。</span>
                  </div>

                  <div class="capability-grid">
                    <label :class="{ active: modelDraft.supportsReferenceImages }">
                      <input
                        v-model="modelDraft.supportsReferenceImages"
                        type="checkbox"
                      />
                      <span>
                        <strong>参考图</strong>
                        <small>文生图 / 图生图 / 多图参考</small>
                      </span>
                    </label>

                    <label
                      class="quality-capability"
                      :class="{ active: qualityEnabled, locked: !qualityCanEdit }"
                    >
                      <input
                        v-if="qualityCanEdit"
                        type="checkbox"
                        :checked="qualityEnabled"
                        @change="toggleQualitySupport"
                      />
                      <span>
                        <strong>Quality</strong>
                        <small>{{ qualityHint }}</small>
                      </span>
                    </label>

                    <label :class="{ active: modelDraft.supportsNegativePrompt }">
                      <input
                        v-model="modelDraft.supportsNegativePrompt"
                        type="checkbox"
                      />
                      <span>
                        <strong>反向提示词</strong>
                        <small>negative_prompt</small>
                      </span>
                    </label>

                    <label :class="{ active: modelDraft.supportsSeed }">
                      <input
                        v-model="modelDraft.supportsSeed"
                        type="checkbox"
                      />
                      <span>
                        <strong>Seed</strong>
                        <small>固定随机种子</small>
                      </span>
                    </label>
                  </div>

                  <div
                    v-if="qualityCanEdit && qualityEnabled"
                    class="quality-settings"
                  >
                    <div>
                      <strong>Quality 可选值</strong>
                      <small>{{ qualityHint }}</small>
                    </div>
                    <div class="quality-option-list">
                      <button
                        v-for="quality in standardQualityValues"
                        :key="quality"
                        type="button"
                        :class="{ active: splitList(modelDraft.qualitiesText).includes(quality) }"
                        @click="toggleQualityValue(quality)"
                      >
                        {{ quality }}
                      </button>
                    </div>
                  </div>

                  <div
                    v-if="modelDraft.supportsReferenceImages"
                    class="reference-limit"
                  >
                    <span>
                      <strong>最大参考图数</strong>
                      <small>{{ referenceLimitHint }}</small>
                    </span>
                    <div class="reference-limit-actions">
                      <button
                        v-if="knownApiProfile === 'lingke' && modelDraft.maxReferenceImages !== 14"
                        class="soft-button compact"
                        type="button"
                        @click="modelDraft.maxReferenceImages = 14"
                      >
                        使用文档值 14
                      </button>
                      <input
                        v-model.number="modelDraft.maxReferenceImages"
                        type="number"
                        min="1"
                        max="32"
                      />
                    </div>
                  </div>

                  <div class="section-subtitle size-title">
                    <div>
                      <strong>尺寸与比例</strong>
                      <span>左侧是前台展示值，右侧是实际发送给 API 的值。</span>
                    </div>

                    <button
                      v-if="isGeneric"
                      class="soft-button"
                      type="button"
                      @click="addSizeRow"
                    >
                      ＋ 添加尺寸
                    </button>
                  </div>

                  <div class="size-builder">
                    <div class="size-builder-head">
                      <span>前台选项</span>
                      <span>API 实际值</span>
                      <span></span>
                    </div>

                    <div
                      v-for="(row, index) in sizeRows"
                    :key="index"
                      class="size-builder-row"
                    >
                      <input
                        v-model="row.label"
                        :disabled="!isGeneric"
                        placeholder="1:1"
                      />
                      <input
                        v-model="row.apiValue"
                        :disabled="!isGeneric"
                        placeholder="1024x1024"
                      />
                      <button
                        v-if="isGeneric"
                        type="button"
                        title="删除这一项"
                        @click="removeSizeRow(index)"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <details v-if="isGeneric" class="advanced-model">
                    <summary>
                      <div>
                        <strong>高级模型覆盖</strong>
                        <span>只有个别模型参数与服务商默认协议不同时才需要修改。</span>
                      </div>
                      <b>JSON</b>
                    </summary>

                    <div class="advanced-model-body">
                      <label>
                        <span>模型请求覆盖</span>
                        <textarea
                          v-model="modelDraft.requestOverridesText"
                          class="code-editor model-code"
                          spellcheck="false"
                        ></textarea>
                      </label>

                      <label>
                        <span>当前尺寸映射 JSON</span>
                        <textarea
                          v-model="modelDraft.sizeMappingText"
                          class="code-editor model-code"
                          spellcheck="false"
                          readonly
                        ></textarea>
                      </label>
                    </div>
                  </details>

                  <div v-if="selectedKind === 'builtin'" class="compat-note compact-note">
                    <div>
                      <strong>系统模型受兼容执行器保护</strong>
                      <span>
                        价格、启停和基础能力可以直接编辑。如果要新增、删除或复制模型，请先把服务商复制为通用配置。
                      </span>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </section>

          <section v-else-if="activeTab === 'test'" class="section-body">
            <div class="section-title">
              <div>
                <h4>API 调试</h4>
                <p>建议先预览请求，再发送真实测试；异步任务会独立轮询，不会一直占住浏览器请求。</p>
              </div>

              <button
                v-if="testPolling"
                class="soft-button"
                type="button"
                @click="cancelTestPolling"
              >
                停止轮询
              </button>
            </div>

            <div v-if="!selectedModel" class="compat-note">
              <div>
                <strong>请先选择模型</strong>
                <span>API 调试需要一个已经保存的模型。</span>
              </div>
            </div>

            <div v-else class="debug-layout">
              <div class="debug-form">
                <label class="debug-prompt">
                  <span>测试 Prompt</span>
                  <textarea
                    v-model="testForm.prompt"
                    class="prompt-editor"
                  ></textarea>
                </label>

                <div class="debug-fields">
                  <label>
                    <span>尺寸</span>
                    <select v-model="testForm.size">
                      <option
                        v-for="size in selectedModel.sizes"
                        :key="size"
                        :value="size"
                      >
                        {{ size }}
                      </option>
                    </select>
                  </label>

                  <label v-if="selectedModel.qualities.length > 0">
                    <span>Quality</span>
                    <select v-model="testForm.quality">
                      <option
                        v-for="quality in selectedModel.qualities"
                        :key="quality"
                        :value="quality"
                      >
                        {{ quality }}
                      </option>
                    </select>
                  </label>

                  <label>
                    <span>数量</span>
                    <input
                      v-model.number="testForm.count"
                      type="number"
                      min="1"
                      :max="selectedModel.maxOutputImages"
                    />
                  </label>

                  <label v-if="selectedModel.supportsSeed">
                    <span>Seed</span>
                    <input v-model="testForm.seed" placeholder="可留空" />
                  </label>
                </div>

                <div class="debug-actions">
                  <button
                    class="soft-button"
                    type="button"
                    :disabled="saving === 'preview' || testPolling"
                    @click="previewRequest"
                  >
                    预览请求
                  </button>

                  <button
                    class="primary-button"
                    type="button"
                    :disabled="saving === 'test' || testPolling"
                    @click="runTest"
                  >
                    {{
                      saving === "test"
                        ? "正在提交…"
                        : testPolling
                          ? `轮询中 ${testElapsedSeconds}s`
                          : "发送真实测试"
                    }}
                  </button>
                </div>
              </div>

              <div class="debug-console">
                <header>
                  <div>
                    <span>DEBUG RESULT</span>
                    <strong>调试结果</strong>
                    <small v-if="testResult?.taskId">
                      Task {{ testResult.taskId }}
                    </small>
                  </div>

                  <b
                    :class="{
                      pending: testResult?.pending,
                      ok: testResult && !testResult.pending && testResult.ok,
                      bad: testResult && !testResult.ok
                    }"
                  >
                    {{
                      testResult?.pending
                        ? testResult.providerStatus || "PROCESSING"
                        : testResult
                          ? testResult.ok
                            ? "PASS"
                            : "FAIL"
                          : "READY"
                    }}
                  </b>
                </header>

                <div v-if="testResult" class="debug-meta">
                  <span>
                    状态
                    <strong>{{ testResult.providerStatus || "—" }}</strong>
                  </span>
                  <span>
                    图片
                    <strong>{{ testResult.imageCount || 0 }}</strong>
                  </span>
                  <span>
                    耗时
                    <strong>
                      {{
                        testElapsedSeconds ||
                        Math.round(testResult.durationMs / 1000)
                      }}s
                    </strong>
                  </span>
                </div>

                <pre>{{
                  pretty(
                    testResult ||
                    testPreview ||
                    {
                      tip: "先预览 URL / Header / Body；确认无误后再发送真实请求。"
                    }
                  )
                }}</pre>
              </div>
            </div>
          </section>
        </template>
      </main>
    </div>
  </section>
</template>

<style scoped>
.provider-center{
  --page:#f4f6fa;
  --panel:#ffffff;
  --panel-soft:#f8f9fc;
  --line:#e5e8f0;
  --line-strong:#d9dde8;
  --text:#171a26;
  --muted:#6f7687;
  --subtle:#979eae;
  --accent:#5b5fe9;
  --accent-deep:#4d50d8;
  --accent-soft:#eef0ff;
  --green:#159665;
  --green-soft:#ebf8f2;
  --red:#c94a5d;
  --red-soft:#fff0f2;
  color:var(--text);
  background:var(--page);
  border:1px solid var(--line);
  border-radius:22px;
  overflow:hidden;
  box-shadow:0 18px 60px rgba(31,38,63,.07);
  font-size:14px;
}
*{
  box-sizing:border-box;
}
button,
input,
select,
textarea{
  font:inherit;
}
button{
  font-weight:700;
}
.center-head{
  min-height:106px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:28px;
  padding:24px 28px;
  background:rgba(255,255,255,.96);
  border-bottom:1px solid var(--line);
}
.head-copy{
  min-width:0;
}
.eyebrow{
  display:block;
  margin-bottom:6px;
  color:var(--accent);
  font-size:11px;
  font-weight:850;
  letter-spacing:.14em;
}
.center-head h2{
  margin:0;
  font-size:28px;
  line-height:1.15;
  letter-spacing:-.035em;
}
.center-head p{
  margin:8px 0 0;
  color:var(--muted);
  font-size:14px;
}
.head-actions{
  display:flex;
  align-items:center;
  gap:14px;
  flex-shrink:0;
}
.metric{
  min-width:72px;
  padding:2px 16px 2px 0;
  border-right:1px solid var(--line);
}
.metric strong,
.metric span{
  display:block;
}
.metric strong{
  font-size:22px;
  line-height:1;
}
.metric span{
  margin-top:5px;
  color:var(--muted);
  font-size:12px;
}
.primary-button,
.soft-button,
.danger-button{
  min-height:42px;
  padding:0 16px;
  border-radius:11px;
  cursor:pointer;
  transition:.18s ease;
}
.primary-button{
  border:1px solid var(--accent);
  color:#fff;
  background:linear-gradient(180deg,#6569ef 0%,var(--accent) 100%);
  box-shadow:0 7px 18px rgba(91,95,233,.20);
}
.primary-button:hover{
  transform:translateY(-1px);
  box-shadow:0 9px 24px rgba(91,95,233,.25);
}
.soft-button{
  border:1px solid var(--line-strong);
  color:#4b5162;
  background:#fff;
}
.soft-button:hover{
  border-color:#c9cde0;
  background:#fafbff;
}
.danger-button{
  border:1px solid #f0cdd3;
  color:var(--red);
  background:#fff;
}
.danger-button:hover{
  background:var(--red-soft);
}
button:disabled{
  opacity:.45;
  cursor:not-allowed;
  transform:none!important;
}
.notice{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  margin:14px 18px 0;
  padding:12px 14px;
  border-radius:12px;
  font-size:13px;
}
.notice button{
  border:0;
  background:transparent;
  cursor:pointer;
  font-size:18px;
}
.notice.success{
  color:#156b4d;
  background:#eefaf5;
  border:1px solid #caeadc;
}
.notice.error{
  color:#a6384a;
  background:#fff2f4;
  border:1px solid #f0d0d6;
}
.provider-workspace{
  display:grid;
  width:100%;
  max-width:none;
  min-height:760px;
  margin:0;
  grid-template-columns:290px minmax(0,1fr);
  justify-content:stretch;
}
.provider-sidebar{
  display:flex;
  min-width:0;
  flex-direction:column;
  padding:20px 16px 14px;
  background:#fafbfc;
  border-right:1px solid var(--line);
}
.sidebar-title{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 4px 14px;
}
.sidebar-title>div{
  display:flex;
  align-items:center;
  gap:8px;
}
.sidebar-title strong{
  font-size:16px;
}
.sidebar-title span{
  padding:2px 7px;
  border-radius:999px;
  color:var(--muted);
  background:#eef0f4;
  font-size:11px;
}
.sidebar-title button{
  width:34px;
  height:34px;
  border:1px solid var(--line);
  border-radius:9px;
  color:var(--muted);
  background:#fff;
  cursor:pointer;
}
.search-box{
  display:grid;
  grid-template-columns:24px 1fr;
  align-items:center;
  min-height:44px;
  padding:0 12px;
  border:1px solid var(--line);
  border-radius:11px;
  color:#9aa0ae;
  background:#fff;
}
.search-box input{
  min-width:0;
  border:0;
  outline:0;
  color:var(--text);
  background:transparent;
  font-size:13px;
}
.provider-scroll{
  min-height:0;
  overflow:auto;
  margin-top:10px;
  padding-right:2px;
}
.provider-row{
  width:100%;
  display:grid;
  grid-template-columns:42px minmax(0,1fr) auto;
  align-items:center;
  gap:11px;
  margin-bottom:8px;
  padding:11px;
  border:1px solid transparent;
  border-radius:13px;
  color:var(--text);
  background:transparent;
  text-align:left;
  cursor:pointer;
}
.provider-row:hover{
  border-color:var(--line);
  background:#fff;
}
.provider-row.active{
  border-color:#d6d8ff;
  background:#fff;
  box-shadow:0 6px 20px rgba(36,42,66,.07);
}
.provider-avatar{
  width:42px;
  height:42px;
  display:grid;
  place-items:center;
  border-radius:12px;
  color:#4e52d9;
  background:linear-gradient(145deg,#f0efff,#e9ecff);
  font-size:15px;
  font-weight:850;
}
.provider-copy{
  min-width:0;
}
.provider-name-line{
  display:flex;
  align-items:center;
  gap:7px;
  min-width:0;
}
.provider-copy strong{
  overflow:hidden;
  font-size:14px;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.provider-copy small{
  display:block;
  margin-top:4px;
  color:var(--muted);
  font-size:11px;
}
.provider-name-line i,
.model-row>i{
  width:8px;
  height:8px;
  flex:0 0 auto;
  border-radius:50%;
  background:#c6cad4;
}
.provider-name-line i.on,
.model-row>i.on{
  background:#1cad72;
  box-shadow:0 0 0 3px #e5f7ef;
}
.provider-row em{
  padding:4px 7px;
  border-radius:999px;
  color:#59608a;
  background:#eef0ff;
  font-size:10px;
  font-style:normal;
  font-weight:750;
}
.provider-row em.legacy{
  color:#777d8b;
  background:#f0f1f4;
}
.sidebar-foot{
  display:flex;
  justify-content:space-between;
  gap:10px;
  margin-top:auto;
  padding:13px 4px 0;
  border-top:1px solid var(--line);
  color:#959baa;
  font-size:10px;
}
.provider-main{
  min-width:0;
  padding:24px 26px 34px;
  background:var(--panel);
}
.blank-state,
.blank-model{
  min-height:600px;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  color:var(--muted);
  text-align:center;
}
.blank-icon{
  width:58px;
  height:58px;
  display:grid;
  place-items:center;
  border-radius:18px;
  color:var(--accent);
  background:var(--accent-soft);
  font-size:30px;
  font-weight:400;
}
.blank-icon.small{
  width:48px;
  height:48px;
  font-size:18px;
  font-weight:800;
}
.blank-state h3{
  margin:16px 0 0;
  color:var(--text);
  font-size:24px;
}
.blank-state p,
.blank-model p{
  margin:7px 0 18px;
  font-size:14px;
}
.quick-start-grid{
  width:min(720px,100%);
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
}
.quick-start-grid button{
  padding:16px;
  border:1px solid var(--line);
  border-radius:14px;
  color:var(--text);
  background:#fff;
  text-align:left;
  cursor:pointer;
}
.quick-start-grid button:hover{
  border-color:#cfd2fa;
  box-shadow:0 8px 22px rgba(35,41,67,.06);
}
.quick-start-grid strong,
.quick-start-grid span{
  display:block;
}
.quick-start-grid strong{
  font-size:14px;
}
.quick-start-grid span{
  margin-top:5px;
  color:var(--muted);
  font-size:12px;
}
.provider-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:22px;
}
.provider-title-line{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:9px;
}
.provider-title-line h3{
  margin:0;
  font-size:25px;
  letter-spacing:-.03em;
}
.provider-head-copy p{
  margin:7px 0 0;
  color:var(--muted);
  font-size:13px;
  word-break:break-all;
}
.type-badge,
.status-badge{
  padding:5px 8px;
  border-radius:999px;
  font-size:10px;
  font-weight:800;
}
.type-badge{
  color:#5257c9;
  background:#eef0ff;
}
.type-badge.legacy{
  color:#737988;
  background:#f0f1f4;
}
.status-badge{
  color:#8a6370;
  background:#f5f0f2;
}
.status-badge.on{
  color:#12704d;
  background:#eaf8f1;
}
.provider-actions,
.model-actions{
  display:flex;
  align-items:center;
  gap:9px;
}
.switch-line{
  display:flex;
  align-items:center;
  gap:7px;
  min-height:40px;
  padding:0 10px;
  color:#545a69;
  font-size:13px;
  font-weight:700;
}
.switch-line input{
  width:16px;
  height:16px;
  accent-color:var(--accent);
}
.switch-line.large{
  padding:0;
  min-height:0;
}
.preset-bar{
  display:grid;
  grid-template-columns:210px minmax(0,1fr);
  align-items:center;
  gap:18px;
  margin-top:20px;
  padding:14px;
  border:1px solid #e2e4f8;
  border-radius:14px;
  background:#f8f8ff;
}
.preset-bar>div:first-child strong,
.preset-bar>div:first-child span{
  display:block;
}
.preset-bar>div:first-child strong{
  font-size:13px;
}
.preset-bar>div:first-child span{
  margin-top:4px;
  color:var(--muted);
  font-size:11px;
}
.preset-buttons{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
}
.preset-buttons button{
  min-width:132px;
  padding:9px 10px;
  border:1px solid var(--line);
  border-radius:10px;
  color:#4d5362;
  background:#fff;
  text-align:left;
  cursor:pointer;
}
.preset-buttons button.active{
  border-color:#bfc2ff;
  background:#f0f1ff;
  color:#3e43c5;
}
.preset-buttons strong,
.preset-buttons small{
  display:block;
}
.preset-buttons strong{
  font-size:12px;
}
.preset-buttons small{
  margin-top:3px;
  color:var(--muted);
  font-size:11px;
}
.main-tabs{
  display:flex;
  gap:26px;
  margin-top:22px;
  border-bottom:1px solid var(--line);
}
.main-tabs button{
  position:relative;
  padding:13px 2px 14px;
  border:0;
  color:#7a8190;
  background:transparent;
  font-size:14px;
  cursor:pointer;
}
.main-tabs button.active{
  color:var(--text);
}
.main-tabs button.active::after{
  content:"";
  position:absolute;
  left:0;
  right:0;
  bottom:-1px;
  height:3px;
  border-radius:3px;
  background:var(--accent);
}
.section-body{
  padding-top:24px;
}
.overview-grid,
.protocol-summary{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:12px;
  margin-bottom:24px;
}
.overview-grid article,
.protocol-summary article{
  padding:15px 16px;
  border:1px solid var(--line);
  border-radius:13px;
  background:var(--panel-soft);
}
.overview-grid span,
.overview-grid strong,
.overview-grid small,
.protocol-summary span,
.protocol-summary strong,
.protocol-summary small{
  display:block;
}
.overview-grid span,
.protocol-summary span{
  color:var(--muted);
  font-size:11px;
}
.overview-grid strong,
.protocol-summary strong{
  margin-top:5px;
  font-size:16px;
}
.overview-grid small,
.protocol-summary small{
  overflow:hidden;
  margin-top:4px;
  color:var(--subtle);
  font-size:10px;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.section-title,
.section-subtitle{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
}
.section-title{
  margin-bottom:18px;
}
.section-title h4{
  margin:0;
  font-size:19px;
}
.section-title p{
  margin:5px 0 0;
  color:var(--muted);
  font-size:12px;
}
.section-subtitle{
  margin:24px 0 12px;
}
.section-subtitle>span,
.section-subtitle>div>span{
  color:var(--muted);
  font-size:11px;
}
.section-subtitle strong{
  font-size:14px;
}
.key-ok{
  padding:6px 9px;
  border-radius:999px;
  color:#137651;
  background:var(--green-soft);
  font-size:11px;
  font-weight:750;
}
.form-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:15px 16px;
}
.connection-primary-row{
  display:grid;
  grid-column:1/-1;
  grid-template-columns:minmax(0,1.7fr) minmax(180px,.8fr) minmax(150px,.65fr);
  gap:16px;
  align-items:start;
}
.connection-primary-row>label{
  min-width:0;
}
.form-grid label{
  display:flex;
  min-width:0;
  flex-direction:column;
  gap:7px;
}
.form-grid label>span,
.debug-form label>span,
.advanced-model label>span{
  color:#626979;
  font-size:12px;
  font-weight:700;
}
.form-grid label>small{
  color:#a0a6b3;
  font-size:10px;
}
.form-grid .wide{
  grid-column:1/-1;
}
.form-grid input,
.form-grid select,
.form-grid textarea,
.debug-fields input,
.debug-fields select,
.debug-prompt textarea,
.reference-limit input,
.size-builder input{
  width:100%;
  min-height:43px;
  padding:0 12px;
  border:1px solid var(--line-strong);
  border-radius:10px;
  outline:0;
  color:var(--text);
  background:#fff;
  font-size:13px;
  transition:.15s ease;
}
.form-grid input:focus,
.form-grid select:focus,
.form-grid textarea:focus,
.debug-fields input:focus,
.debug-fields select:focus,
.debug-prompt textarea:focus,
.reference-limit input:focus,
.size-builder input:focus{
  border-color:#afb2fa;
  box-shadow:0 0 0 3px #f0f1ff;
}
.form-grid input:disabled{
  color:#858b99;
  background:#f6f7f9;
}
.input-unit{
  position:relative;
}
.input-unit input{
  padding-right:54px;
}
.input-unit b{
  position:absolute;
  top:50%;
  right:12px;
  color:#959baa;
  font-size:10px;
  transform:translateY(-50%);
}
.check-card{
  display:flex!important;
  flex-direction:row!important;
  align-items:center;
  gap:10px!important;
  padding:12px 13px;
  border:1px solid #f0d8dc;
  border-radius:11px;
  background:#fffafb;
}
.check-card input{
  width:16px;
  min-height:16px;
  accent-color:var(--red);
}
.check-card strong,
.check-card small{
  display:block;
}
.check-card strong{
  color:#a53f50;
  font-size:12px;
}
.check-card small{
  margin-top:3px;
  color:#9d7d83;
  font-size:10px;
}
.compat-note{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  margin-top:20px;
  padding:14px 16px;
  border:1px solid #e4e5f4;
  border-radius:13px;
  background:#fafaff;
}
.compat-note strong,
.compat-note span{
  display:block;
}
.compat-note strong{
  font-size:13px;
}
.compat-note span{
  margin-top:4px;
  color:var(--muted);
  font-size:11px;
  line-height:1.6;
}
.compact-note{
  justify-content:flex-start;
}
.protocol-card,
.advanced-model{
  margin-bottom:12px;
  border:1px solid var(--line);
  border-radius:13px;
  background:#fff;
  overflow:hidden;
}
.protocol-card summary,
.advanced-model summary{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  padding:14px 16px;
  cursor:pointer;
  list-style:none;
}
.protocol-card summary::-webkit-details-marker,
.advanced-model summary::-webkit-details-marker{
  display:none;
}
.protocol-card summary strong,
.protocol-card summary span,
.advanced-model summary strong,
.advanced-model summary span{
  display:block;
}
.protocol-card summary strong,
.advanced-model summary strong{
  font-size:13px;
}
.protocol-card summary span,
.advanced-model summary span{
  margin-top:4px;
  color:var(--muted);
  font-size:10px;
}
.protocol-card summary b,
.advanced-model summary b{
  color:#757bd7;
  font-size:10px;
  letter-spacing:.08em;
}
.protocol-content{
  padding:0 16px 16px;
}
.variable-row{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  margin-bottom:10px;
}
.variable-row button{
  padding:5px 8px;
  border:1px solid #e1e3ed;
  border-radius:7px;
  color:#596070;
  background:#f8f9fb;
  font-size:10px;
  cursor:pointer;
}
.code-editor{
  width:100%;
  min-height:220px;
  padding:13px;
  border:1px solid #252a3a;
  border-radius:10px;
  outline:0;
  color:#dfe5f2;
  background:#151925;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:12px;
  line-height:1.6;
  resize:vertical;
}
.code-editor.medium{
  min-height:150px;
}
.code-editor.tall{
  min-height:250px;
}
.code-editor.short{
  min-height:100px;
}
.model-section-title{
  margin-bottom:14px;
}
.model-preset-panel{
  display:grid;
  grid-template-columns:180px minmax(0,1fr);
  gap:16px;
  align-items:start;
  margin-bottom:16px;
  padding:14px;
  border:1px solid #e2e4f8;
  border-radius:14px;
  background:#f9f9ff;
}
.model-preset-panel>div:first-child strong,
.model-preset-panel>div:first-child span{
  display:block;
}
.model-preset-panel>div:first-child strong{
  font-size:13px;
}
.model-preset-panel>div:first-child span{
  margin-top:4px;
  color:var(--muted);
  font-size:10px;
}
.model-preset-buttons{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
}
.model-preset-buttons button{
  padding:8px 10px;
  border:1px solid var(--line);
  border-radius:9px;
  color:#525866;
  background:#fff;
  cursor:pointer;
  text-align:left;
}
.model-preset-buttons button.active{
  border-color:#bfc2ff;
  color:#4246c8;
  background:#eff0ff;
}
.model-preset-buttons strong,
.model-preset-buttons small{
  display:block;
}
.model-preset-buttons strong{
  font-size:13px;
}
.model-preset-buttons small{
  margin-top:4px;
  color:var(--muted);
  font-size:10px;
}
.model-workspace{
  display:grid;
  grid-template-columns:260px minmax(0,1fr);
  min-height:590px;
  border:1px solid var(--line);
  border-radius:15px;
  overflow:hidden;
}
.model-list{
  padding:14px 12px;
  background:#fafbfc;
  border-right:1px solid var(--line);
}
.model-list header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 4px 9px;
}
.model-list header strong{
  font-size:13px;
}
.model-list header span{
  color:var(--muted);
  font-size:11px;
}
.model-row{
  width:100%;
  display:grid;
  grid-template-columns:minmax(0,1fr) auto 8px;
  align-items:center;
  gap:9px;
  margin-bottom:7px;
  padding:11px 10px;
  border:1px solid transparent;
  border-radius:11px;
  color:var(--text);
  background:transparent;
  text-align:left;
  cursor:pointer;
}
.model-row:hover{
  border-color:var(--line);
  background:#fff;
}
.model-row.active{
  border-color:#d7d9ff;
  background:#fff;
  box-shadow:0 4px 14px rgba(37,43,68,.05);
}
.model-row-main{
  min-width:0;
}
.model-row-main strong,
.model-row-main small,
.model-row-price strong,
.model-row-price small{
  display:block;
}
.model-row-main strong{
  overflow:hidden;
  font-size:14px;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.model-row-main small{
  margin-top:4px;
  color:var(--muted);
  font-size:11px;
}
.model-row-price{
  min-width:50px;
  text-align:right;
}
.model-row-price strong{
  font-size:14px;
}
.model-row-price small{
  margin-top:2px;
  color:#8f95a3;
  font-size:10px;
}
.model-editor{
  min-width:0;
  padding:18px 20px 24px;
  background:#fff;
}
.model-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:18px;
  padding-bottom:15px;
}
.model-head h4{
  margin:3px 0 0;
  font-size:20px;
}
.model-head p{
  margin:4px 0 0;
  color:var(--muted);
  font-size:11px;
}
.pricing-card{
  display:grid;
  grid-template-columns:1fr 1.1fr 1.2fr 1fr;
  gap:12px;
  margin-bottom:20px;
  padding:14px;
  border:1px solid #e3e5f5;
  border-radius:14px;
  background:linear-gradient(135deg,#fafaff 0%,#f6f7ff 100%);
}
.pricing-card>div,
.pricing-card>label{
  display:flex;
  flex-direction:column;
  justify-content:flex-start;
  gap:8px;
  min-width:0;
}
.pricing-card>div>span,
.pricing-card>label>span{
  color:var(--muted);
  font-size:12px;
  font-weight:700;
}
.price-input{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  align-items:center;
  min-height:42px;
  border:1px solid #d9dcee;
  border-radius:10px;
  background:#fff;
}
.price-input input{
  width:100%;
  min-width:0;
  height:40px;
  padding:0 10px;
  border:0;
  outline:0;
  background:transparent;
  font-size:15px;
  font-weight:800;
}
.price-input b{
  padding-right:10px;
  color:#777e8e;
  font-size:9px;
}
.field-help{
  display:block;
  margin-top:2px;
  color:#8b90a0;
  font-size:10px;
  font-weight:500;
  line-height:1.45;
}
.model-form-grid{
  grid-template-columns:repeat(3,minmax(0,1fr));
}
.quality-settings{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  margin-top:10px;
  padding:13px 14px;
  border:1px solid #e2e4f3;
  border-radius:11px;
  background:#fbfbff;
}
.quality-settings strong,
.quality-settings small{
  display:block;
}
.quality-settings strong{
  font-size:13px;
}
.quality-settings small{
  margin-top:4px;
  color:var(--muted);
  font-size:11px;
}
.quality-option-list{
  display:flex;
  flex-wrap:wrap;
  justify-content:flex-end;
  gap:7px;
}
.quality-option-list button{
  min-width:68px;
  height:34px;
  padding:0 12px;
  border:1px solid #dcdfee;
  border-radius:9px;
  color:#51586a;
  background:#fff;
  font-size:12px;
  font-weight:750;
  cursor:pointer;
}
.quality-option-list button.active{
  border-color:#b9bcff;
  color:#4f46e5;
  background:#f1f1ff;
  box-shadow:0 0 0 2px rgba(99,102,241,.06);
}
.capability-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
}
.capability-grid label{
  display:flex;
  align-items:center;
  gap:10px;
  padding:12px;
  border:1px solid var(--line);
  border-radius:11px;
  background:#fff;
  cursor:pointer;
}
.capability-grid label.active{
  border-color:#c8cbff;
  background:#f7f7ff;
}
.capability-grid label.locked{
  cursor:default;
}
.capability-grid input{
  width:16px;
  height:16px;
  accent-color:var(--accent);
}
.capability-grid strong,
.capability-grid small{
  display:block;
}
.capability-grid strong{
  font-size:14px;
}
.capability-grid small{
  margin-top:4px;
  color:var(--muted);
  font-size:11px;
  line-height:1.45;
}
.reference-limit{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  margin-top:10px;
  padding:11px 12px;
  border:1px solid var(--line);
  border-radius:11px;
  background:#fbfbfc;
}
.reference-limit strong,
.reference-limit small{
  display:block;
}
.reference-limit strong{
  font-size:14px;
}
.reference-limit small{
  margin-top:4px;
  color:var(--muted);
  font-size:11px;
  line-height:1.45;
}
.reference-limit input{
  width:100px;
}
.reference-limit-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:8px;
}
.reference-limit-actions .compact{
  min-height:34px;
  padding:0 10px;
  font-size:10px;
  white-space:nowrap;
}
.size-title{
  align-items:flex-end;
}
.size-title>div{
  min-width:0;
}
.size-title>div strong,
.size-title>div span{
  display:block;
}
.size-title>div span{
  margin-top:4px;
}
.size-builder{
  border:1px solid var(--line);
  border-radius:12px;
  overflow:hidden;
}
.size-builder-head,
.size-builder-row{
  display:grid;
  grid-template-columns:1fr 1.4fr 38px;
  align-items:center;
  gap:10px;
}
.size-builder-head{
  padding:9px 12px;
  color:#777e8d;
  background:#f7f8fa;
  font-size:10px;
  font-weight:750;
}
.size-builder-row{
  padding:8px 10px;
  border-top:1px solid #eff0f3;
}
.size-builder-row:first-of-type{
  border-top:0;
}
.size-builder-row input{
  min-height:38px;
  font-size:12px;
}
.size-builder-row button{
  width:32px;
  height:32px;
  border:1px solid #efd5da;
  border-radius:8px;
  color:var(--red);
  background:#fff;
  cursor:pointer;
}
.advanced-model{
  margin-top:14px;
}
.advanced-model-body{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
  padding:0 14px 14px;
}
.advanced-model-body label{
  display:flex;
  flex-direction:column;
  gap:6px;
}
.model-code{
  min-height:160px;
}
.empty-model{
  padding:30px 8px;
  color:#969cab;
  text-align:center;
  font-size:11px;
}
.debug-layout{
  display:grid;
  grid-template-columns:minmax(330px,.8fr) minmax(0,1.2fr);
  gap:16px;
}
.debug-form,
.debug-console{
  border:1px solid var(--line);
  border-radius:14px;
  overflow:hidden;
}
.debug-form{
  padding:16px;
  background:#fff;
}
.debug-prompt{
  display:flex;
  flex-direction:column;
  gap:7px;
}
.prompt-editor{
  min-height:145px!important;
  padding:11px!important;
  resize:vertical;
}
.debug-fields{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:11px;
  margin-top:12px;
}
.debug-fields label{
  display:flex;
  flex-direction:column;
  gap:6px;
}
.debug-actions{
  display:flex;
  justify-content:flex-end;
  gap:9px;
  margin-top:15px;
}
.debug-console{
  min-width:0;
  color:#dfe4f0;
  background:#151925;
}
.debug-console header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  padding:14px 15px;
  border-bottom:1px solid #292e3e;
}
.debug-console header span,
.debug-console header strong,
.debug-console header small{
  display:block;
}
.debug-console header span{
  color:#838ca4;
  font-size:9px;
  letter-spacing:.12em;
}
.debug-console header strong{
  margin-top:3px;
  font-size:14px;
}
.debug-console header small{
  margin-top:3px;
  color:#8d96ac;
  font-size:9px;
}
.debug-console header>b{
  padding:5px 8px;
  border-radius:999px;
  color:#8f98ad;
  background:#242938;
  font-size:10px;
}
.debug-console header>b.pending{
  color:#d2b863;
  background:#332f21;
}
.debug-console header>b.ok{
  color:#6ed2a3;
  background:#1d332a;
}
.debug-console header>b.bad{
  color:#e78393;
  background:#38232a;
}
.debug-meta{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:8px;
  padding:10px 14px;
  border-bottom:1px solid #292e3e;
}
.debug-meta span{
  color:#858ea4;
  font-size:9px;
}
.debug-meta strong{
  display:block;
  margin-top:3px;
  color:#eef1f7;
  font-size:11px;
}
.debug-console pre{
  min-height:380px;
  max-height:620px;
  overflow:auto;
  margin:0;
  padding:14px;
  color:#cbd3e2;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;
  line-height:1.6;
  white-space:pre-wrap;
  word-break:break-word;
}
.empty-list{
  padding:35px 8px;
  color:#979daa;
  text-align:center;
  font-size:12px;
}
@media (max-width:1200px){
  .provider-workspace{
    grid-template-columns:250px minmax(0,1fr);
  }
  .preset-bar,
  .model-preset-panel{
    grid-template-columns:1fr;
  }
  .model-workspace{
    grid-template-columns:220px minmax(0,1fr);
  }
}
@media (max-width:900px){
  .center-head,
  .provider-head{
    align-items:flex-start;
    flex-direction:column;
  }
  .head-actions,
  .provider-actions{
    flex-wrap:wrap;
  }
  .provider-workspace{
    display:block;
  }
  .provider-sidebar{
    border-right:0;
    border-bottom:1px solid var(--line);
  }
  .provider-scroll{
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:6px;
    max-height:320px;
  }
  .provider-row{
    margin-bottom:0;
  }
  .overview-grid,
  .protocol-summary,
  .pricing-card,
  .capability-grid,
  .debug-fields{
    grid-template-columns:1fr;
  }
  .form-grid,
  .model-form-grid,
  .advanced-model-body,
  .debug-layout,
  .connection-primary-row{
    grid-template-columns:1fr;
  }
  .quality-settings{
    align-items:flex-start;
    flex-direction:column;
  }
  .quality-option-list{
    justify-content:flex-start;
  }
  .model-workspace{
    display:block;
  }
  .model-list{
    border-right:0;
    border-bottom:1px solid var(--line);
  }
}
</style>

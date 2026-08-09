<script setup lang="ts">
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

type BuiltInProviderId =
  | "lingke"
  | "grsai"
  | "nanobanana";

interface BuiltInProvider {
  id: BuiltInProviderId;
  adapter: BuiltInProviderId;
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

interface BuiltInModel {
  provider:
    BuiltInProviderId;
  model: string;
  apiModelId: string;
  name: string;
  providerName: string;
  enabled: boolean;
  points: number;
  configured: boolean;
  description: string;
  sizes: string[];
  maxOutputImages: number;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  asynchronous: boolean;
  updatedAt?: string;
}

interface ProviderSecretStatus {
  configured: boolean;
  source: "API_PROVIDER_SECRET";
  message: string;
}

interface ProviderDraft {
  displayName: string;
  baseUrl: string;
  generateEndpoint: string;
  statusEndpoint: string;
  timeoutMs: number;
  enabled: boolean;
  sortOrder: number;
  apiKey: string;
  clearApiKey: boolean;
  imageSize: string;
}

interface ModelDraft {
  name: string;
  apiModelId: string;
  description: string;
  sizes: string;
  maxOutputImages: number;
  supportsReferenceImages: boolean;
  maxReferenceImages: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  enabled: boolean;
  points: string;
}

interface ProviderEditor {
  provider: BuiltInProvider;
  draft: ProviderDraft;
}

interface ModelEditor {
  model: BuiltInModel;
  draft: ModelDraft;
}

const providers =
  ref<BuiltInProvider[]>([]);

const models =
  ref<BuiltInModel[]>([]);

const providerSecretStatus =
  ref<ProviderSecretStatus>({
    configured: false,
    source: "API_PROVIDER_SECRET",
    message:
      "正在检查 API Key 加密配置"
  });

const providerDrafts =
  reactive<
    Record<
      string,
      ProviderDraft
    >
  >({});

const modelDrafts =
  reactive<
    Record<
      string,
      ModelDraft
    >
  >({});

const loading =
  ref(true);

const saving =
  ref("");

const errorMessage =
  ref("");

const successMessage =
  ref("");

const providerEditors =
  computed<
    ProviderEditor[]
  >(() => {
    const result:
      ProviderEditor[] = [];

    for (
      const provider of
        providers.value
    ) {
      const draft =
        providerDrafts[
          provider.id
        ];

      if (draft) {
        result.push({
          provider,
          draft
        });
      }
    }

    return result;
  });

onMounted(loadData);

async function loadData() {
  loading.value = true;
  clearMessages();

  try {
    const data =
      await apiRequest<{
        providers:
          BuiltInProvider[];
        models:
          BuiltInModel[];
        security:
          ProviderSecretStatus;
      }>(
        "/api/admin/builtin-api-providers"
      );

    providers.value =
      data.providers || [];

    models.value =
      data.models || [];

    providerSecretStatus.value =
      data.security || {
        configured: false,
        source:
          "API_PROVIDER_SECRET",
        message:
          "无法确认 API Key 加密配置"
      };

    syncDrafts();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "读取内置 API 服务商失败"
      );
  }
  finally {
    loading.value = false;
  }
}

function syncDrafts() {
  for (
    const provider of
      providers.value
  ) {
    providerDrafts[
      provider.id
    ] = {
      displayName:
        provider.displayName,
      baseUrl:
        provider.baseUrl,
      generateEndpoint:
        provider.generateEndpoint,
      statusEndpoint:
        provider.statusEndpoint,
      timeoutMs:
        provider.timeoutMs,
      enabled:
        provider.enabled,
      sortOrder: provider.sortOrder || 100,
      apiKey: "",
      clearApiKey: false,
      imageSize:
        provider.imageSize ||
        "4K"
    };
  }

  for (
    const model of
      models.value
  ) {
    modelDrafts[
      modelKey(model)
    ] = {
      name:
        model.name,
      apiModelId:
        model.apiModelId,
      description:
        model.description,
      sizes:
        model.sizes.join(","),
      maxOutputImages:
        model.maxOutputImages,
      supportsReferenceImages:
        model
          .supportsReferenceImages,
      maxReferenceImages:
        model
          .maxReferenceImages,
      supportsNegativePrompt:
        model
          .supportsNegativePrompt,
      supportsSeed:
        model.supportsSeed,
      enabled:
        model.enabled,
      points:
        String(model.points)
    };
  }
}

function modelsFor(
  provider:
    BuiltInProvider
): BuiltInModel[] {
  return models.value.filter(
    (model) =>
      model.provider ===
      provider.id
  );
}

function modelEditorsFor(
  provider:
    BuiltInProvider
): ModelEditor[] {
  const result:
    ModelEditor[] = [];

  for (
    const model of
      modelsFor(provider)
  ) {
    const draft =
      modelDrafts[
        modelKey(model)
      ];

    if (draft) {
      result.push({
        model,
        draft
      });
    }
  }

  return result;
}

async function saveProvider(
  provider:
    BuiltInProvider
) {
  const draft =
    providerDrafts[
      provider.id
    ];

  if (!draft) return;

  if (
    draft.clearApiKey &&
    !window.confirm(
      `确定清除 ${provider.displayName} 的 API Key 吗？`
    )
  ) {
    return;
  }

  saving.value =
    `provider:${provider.id}`;

  clearMessages();

  try {
    const result =
      await apiRequest<{
        provider:
          BuiltInProvider;
        security:
          ProviderSecretStatus;
      }>(
        `/api/admin/builtin-api-providers/${encodeURIComponent(provider.id)}`,
        jsonRequest({
          displayName:
            draft.displayName,
          baseUrl:
            draft.baseUrl,
          generateEndpoint:
            draft.generateEndpoint,
          statusEndpoint:
            draft.statusEndpoint,
          timeoutMs:
            Number(
              draft.timeoutMs
            ),
          enabled:
            draft.enabled,
          sortOrder: Number(draft.sortOrder),
          apiKey:
            draft.apiKey.trim() ||
            undefined,
          clearApiKey:
            draft.clearApiKey,
          imageSize:
            provider.id ===
              "nanobanana"
              ? draft.imageSize
              : undefined
        }, "PATCH")
      );

    await loadData();

    providerSecretStatus.value =
      result.security;

    successMessage.value =
      result.provider
        .apiKeyConfigured
        ? `${result.provider.displayName} 配置已保存，API Key ${result.provider.apiKeyPreview} 已立即载入`
        : `${result.provider.displayName} 配置已保存；当前未配置 API Key`;
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "保存服务商失败"
      );
  }
  finally {
    saving.value = "";
  }
}

async function saveModel(
  model:
    BuiltInModel
) {
  const key =
    modelKey(model);

  const draft =
    modelDrafts[key];

  if (!draft) return;

  saving.value =
    `model:${key}`;

  clearMessages();

  try {
    await apiRequest(
      `/api/admin/builtin-api-providers/${encodeURIComponent(model.provider)}/models/${encodeURIComponent(model.model)}`,
      jsonRequest({
        name:
          draft.name,
        apiModelId:
          draft.apiModelId,
        description:
          draft.description,
        sizes:
          splitSizes(
            draft.sizes
          ),
        maxOutputImages:
          Number(
            draft.maxOutputImages
          ),
        supportsReferenceImages:
          draft
            .supportsReferenceImages,
        maxReferenceImages:
          Number(
            draft.maxReferenceImages
          ),
        supportsNegativePrompt:
          draft
            .supportsNegativePrompt,
        supportsSeed:
          draft.supportsSeed,
        enabled:
          draft.enabled,
        points:
          Number(
            draft.points
          )
      }, "PATCH")
    );

    successMessage.value =
      `${model.name} 参数已保存`;

    await loadData();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "保存模型参数失败"
      );
  }
  finally {
    saving.value = "";
  }
}

function modelKey(
  model: {
    provider: string;
    model: string;
  }
): string {
  return (
    `${model.provider}:` +
    model.model
  );
}

function splitSizes(
  value: string
): string[] {
  return value
    .split(/[,，\n]/)
    .map(
      (item) =>
        item.trim()
    )
    .filter(Boolean);
}

function clearMessages() {
  errorMessage.value = "";
  successMessage.value = "";
}

function messageOf(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error
    ? error.message
    : fallback;
}
</script>

<template>
  <section class="builtin-provider-manager">
    <div class="provider-summary-row">
      <article>
        <span>内置服务商</span>
        <strong>{{ providers.length }}</strong>
      </article>

      <article>
        <span>内置模型</span>
        <strong>{{ models.length }}</strong>
      </article>

      <article>
        <span>当前配置</span>
        <strong>云端配置优先</strong>
      </article>
    </div>

    <p
      v-if="!providerSecretStatus.configured"
      class="provider-message error"
    >
      {{ providerSecretStatus.message }}
    </p>

    <p
      v-if="successMessage"
      class="provider-message success"
    >
      {{ successMessage }}
    </p>

    <p
      v-if="errorMessage"
      class="provider-message error"
    >
      {{ errorMessage }}
    </p>

    <div
      v-if="loading"
      class="provider-empty"
    >
      正在读取已接入服务商…
    </div>

    <div
      v-else
      class="builtin-provider-list"
    >
      <article
        v-for="{ provider, draft } in providerEditors"
        :key="provider.id"
        class="builtin-provider-card"
      >
        <header>
          <div>
            <span>{{ provider.id }}</span>
            <h3>{{ provider.displayName }}</h3>
            <p>{{ provider.adapterLabel }}</p>
          </div>

          <i :class="{ active: provider.enabled }">
            {{ provider.enabled ? '已启用' : '已停用' }}
          </i>
        </header>

        <div
          class="builtin-provider-form"
        >
          <label>
            显示名称
            <input
              v-model="draft.displayName"
            />
          </label>

          <label class="wide">
            Base URL
            <input
              v-model="draft.baseUrl"
            />
          </label>

          <label>
            生图接口路径
            <input
              v-model="draft.generateEndpoint"
            />
          </label>

          <label
            v-if="provider.id === 'lingke'"
          >
            任务查询接口
            <input
              v-model="draft.statusEndpoint"
            />
          </label>

          <label>
            请求超时（毫秒）
            <input
              v-model.number="draft.timeoutMs"
              type="number"
              min="1000"
              max="900000"
            />
          </label>

          <label>
            前台排序
            <input v-model.number="draft.sortOrder" type="number" min="1" max="9999" title="数值越小越靠前" />
          </label>

          <label
            v-if="provider.id === 'nanobanana'"
          >
            默认清晰度
            <select
              v-model="draft.imageSize"
            >
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </label>

          <label class="wide">
            更换 API Key
            <input
              v-model="draft.apiKey"
              type="password"
              autocomplete="new-password"
              :placeholder="provider.apiKeyConfigured
                ? `当前 ${provider.apiKeyPreview}，留空不更换`
                : '尚未配置 API Key'"
            />
          </label>

          <label class="provider-check">
            <input
              v-model="draft.enabled"
              type="checkbox"
            />
            允许前台使用
          </label>

          <label class="provider-check danger-check">
            <input
              v-model="draft.clearApiKey"
              type="checkbox"
            />
            清除当前 API Key
          </label>
        </div>

        <button
          class="provider-primary"
          type="button"
          :disabled="saving === `provider:${provider.id}`"
          @click="saveProvider(provider)"
        >
          {{
            saving === `provider:${provider.id}`
              ? '保存中…'
              : '保存服务商配置'
          }}
        </button>

        <div class="builtin-model-section">
          <header>
            <strong>模型参数</strong>
            <span>
              {{ modelsFor(provider).length }} 个模型
            </span>
          </header>

          <details
            v-for="{ model, draft: modelDraft } in modelEditorsFor(provider)"
            :key="modelKey(model)"
            class="builtin-model-editor"
          >
            <summary>
              <div>
                <strong>{{ model.name }}</strong>
                <code>{{ model.model }}</code>
              </div>

              <span>
                {{ model.points }} 积分/张
              </span>

              <i :class="{ active: model.enabled }">
                {{ model.enabled ? '启用' : '停用' }}
              </i>
            </summary>

            <div
              class="builtin-model-form"
            >
              <label>
                模型显示名称
                <input
                  v-model="modelDraft.name"
                />
              </label>

              <label>
                API 模型 ID
                <input
                  v-model="modelDraft.apiModelId"
                />
              </label>

              <label class="wide">
                模型说明
                <textarea
                  v-model="modelDraft.description"
                ></textarea>
              </label>

              <label class="wide">
                支持尺寸
                <input
                  v-model="modelDraft.sizes"
                />
              </label>

              <label>
                单次最大出图数
                <input
                  v-model.number="modelDraft.maxOutputImages"
                  type="number"
                  min="1"
                  max="4"
                />
              </label>

              <label>
                最大参考图数量
                <input
                  v-model.number="modelDraft.maxReferenceImages"
                  type="number"
                  min="0"
                  max="8"
                />
              </label>

              <label>
                每张积分
                <input
                  v-model="modelDraft.points"
                  type="number"
                  min="0"
                  step="0.01"
                />
              </label>

              <label class="provider-check">
                <input
                  v-model="modelDraft.enabled"
                  type="checkbox"
                />
                启用模型
              </label>

              <label class="provider-check">
                <input
                  v-model="modelDraft.supportsReferenceImages"
                  type="checkbox"
                />
                支持参考图
              </label>

              <label class="provider-check">
                <input
                  v-model="modelDraft.supportsNegativePrompt"
                  type="checkbox"
                />
                支持反向提示词
              </label>

              <label class="provider-check">
                <input
                  v-model="modelDraft.supportsSeed"
                  type="checkbox"
                />
                支持随机种子
              </label>
            </div>

            <div class="model-protocol-note">
              <span>
                内部模型 ID：{{ model.model }}
              </span>
              <span>
                {{
                  model.asynchronous
                    ? '异步专用协议'
                    : '同步专用协议'
                }}
              </span>
              <span>
                {{
                  model.configured
                    ? 'API Key 已配置'
                    : '缺少 API Key'
                }}
              </span>
            </div>

            <button
              class="provider-primary"
              type="button"
              :disabled="saving === `model:${modelKey(model)}`"
              @click="saveModel(model)"
            >
              {{
                saving === `model:${modelKey(model)}`
                  ? '保存中…'
                  : '保存模型参数'
              }}
            </button>
          </details>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  onMounted,
  reactive,
  ref
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";

interface ProviderModel {
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

interface ApiProvider {
  id: string;
  displayName: string;
  baseUrl: string;
  endpoint: string;
  adapter: "openai-images-json";
  apiKeyConfigured: boolean;
  authHeader: string;
  authScheme: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  models: ProviderModel[];
}

const providers =
  ref<ApiProvider[]>([]);

const loading =
  ref(true);

const saving =
  ref("");

const errorMessage =
  ref("");

const successMessage =
  ref("");

const providerForm =
  reactive({
    id: "",
    displayName: "",
    baseUrl: "",
    endpoint:
      "/v1/images/generations",
    apiKey: "",
    authHeader:
      "Authorization",
    authScheme:
      "Bearer",
    sortOrder: 500
  });

const selectedProviderId =
  ref("");

const modelForm =
  reactive({
    model: "",
    name: "",
    description: "",
    sizes:
      "1024x1024,1024x1536,1536x1024",
    maxOutputImages: 1,
    supportsNegativePrompt:
      false,
    supportsSeed:
      false,
    points: "1"
  });

onMounted(loadProviders);

async function loadProviders() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<{
        providers:
          ApiProvider[];
      }>(
        "/api/admin/api-providers"
      );

    providers.value =
      data.providers || [];

    if (
      !selectedProviderId.value &&
      providers.value[0]
    ) {
      selectedProviderId.value =
        providers.value[0].id;
    }
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "读取 API 服务商失败"
      );
  }
  finally {
    loading.value = false;
  }
}

async function createProvider() {
  saving.value =
    "provider";
  clearMessages();

  try {
    const data =
      await apiRequest<{
        provider:
          ApiProvider;
      }>(
        "/api/admin/api-providers",
        jsonRequest({
          ...providerForm
        })
      );

    successMessage.value =
      `已新增服务商 ${data.provider.displayName}`;

    selectedProviderId.value =
      data.provider.id;

    Object.assign(
      providerForm,
      {
        id: "",
        displayName: "",
        baseUrl: "",
        endpoint:
          "/v1/images/generations",
        apiKey: "",
        authHeader:
          "Authorization",
        authScheme:
          "Bearer",
        sortOrder: 500
      }
    );

    await loadProviders();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "新增服务商失败"
      );
  }
  finally {
    saving.value = "";
  }
}

async function toggleProvider(
  provider: ApiProvider
) {
  saving.value =
    provider.id;
  clearMessages();

  try {
    await apiRequest(
      `/api/admin/api-providers/${encodeURIComponent(provider.id)}`,
      jsonRequest({
        enabled:
          !provider.enabled
      }, "PATCH")
    );

    successMessage.value =
      provider.enabled
        ? "服务商已停用"
        : "服务商已启用";

    await loadProviders();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "更新服务商失败"
      );
  }
  finally {
    saving.value = "";
  }
}

async function updateProviderSort(provider: ApiProvider) {
  const raw = window.prompt(`设置 ${provider.displayName} 的前台排序（数值越小越靠前）`, String(provider.sortOrder || 500));
  if (raw === null) return;
  const sortOrder = Number(raw);
  if (!Number.isInteger(sortOrder) || sortOrder < 1 || sortOrder > 9999) {
    errorMessage.value = "排序需为 1–9999 的整数";
    return;
  }
  saving.value = provider.id;
  clearMessages();
  try {
    await apiRequest(`/api/admin/api-providers/${encodeURIComponent(provider.id)}`, jsonRequest({ sortOrder }, "PATCH"));
    successMessage.value = "前台排序已更新";
    await loadProviders();
  } catch (error) {
    errorMessage.value = messageOf(error, "更新服务商排序失败");
  } finally { saving.value = ""; }
}

async function replaceApiKey(
  provider: ApiProvider
) {
  const apiKey =
    window.prompt(
      `输入 ${provider.displayName} 的新 API Key`
    );

  if (
    apiKey === null ||
    !apiKey.trim()
  ) {
    return;
  }

  saving.value =
    provider.id;
  clearMessages();

  try {
    await apiRequest(
      `/api/admin/api-providers/${encodeURIComponent(provider.id)}`,
      jsonRequest({
        apiKey:
          apiKey.trim()
      }, "PATCH")
    );

    successMessage.value =
      "API Key 已安全更新";

    await loadProviders();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "更新 API Key 失败"
      );
  }
  finally {
    saving.value = "";
  }
}

async function deleteProvider(
  provider: ApiProvider
) {
  if (
    !window.confirm(
      `确定删除 ${provider.displayName} 及其全部模型吗？`
    )
  ) {
    return;
  }

  saving.value =
    provider.id;
  clearMessages();

  try {
    await apiRequest(
      `/api/admin/api-providers/${encodeURIComponent(provider.id)}`,
      {
        method: "DELETE"
      }
    );

    if (
      selectedProviderId.value ===
        provider.id
    ) {
      selectedProviderId.value =
        "";
    }

    successMessage.value =
      "API 服务商已删除";

    await loadProviders();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "删除服务商失败"
      );
  }
  finally {
    saving.value = "";
  }
}

async function createModel() {
  if (
    !selectedProviderId.value
  ) {
    errorMessage.value =
      "请先选择一个 API 服务商";
    return;
  }

  saving.value =
    "model";
  clearMessages();

  try {
    await apiRequest(
      `/api/admin/api-providers/${encodeURIComponent(selectedProviderId.value)}/models`,
      jsonRequest({
        ...modelForm,
        sizes:
          modelForm.sizes
            .split(/[,，\n]/)
            .map(
              (item) =>
                item.trim()
            )
            .filter(Boolean),
        points:
          Number(
            modelForm.points
          )
      })
    );

    successMessage.value =
      "模型已新增并可在创作工作台使用";

    Object.assign(
      modelForm,
      {
        model: "",
        name: "",
        description: "",
        sizes:
          "1024x1024,1024x1536,1536x1024",
        maxOutputImages: 1,
        supportsNegativePrompt:
          false,
        supportsSeed:
          false,
        points: "1"
      }
    );

    await loadProviders();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "新增模型失败"
      );
  }
  finally {
    saving.value = "";
  }
}

async function toggleModel(
  model: ProviderModel
) {
  saving.value =
    `${model.provider}:${model.model}`;
  clearMessages();

  try {
    await apiRequest(
      `/api/admin/api-providers/${encodeURIComponent(model.provider)}/models/${encodeURIComponent(model.model)}`,
      jsonRequest({
        enabled:
          !model.enabled
      }, "PATCH")
    );

    successMessage.value =
      model.enabled
        ? "模型已停用"
        : "模型已启用";

    await loadProviders();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "更新模型失败"
      );
  }
  finally {
    saving.value = "";
  }
}

async function updateModelPrice(
  model: ProviderModel
) {
  const value =
    window.prompt(
      `设置 ${model.name} 每张图片积分`,
      String(model.points)
    );

  if (
    value === null
  ) {
    return;
  }

  const points =
    Number(value);

  if (
    !Number.isFinite(points) ||
    points < 0
  ) {
    errorMessage.value =
      "积分价格格式不正确";
    return;
  }

  saving.value =
    `${model.provider}:${model.model}`;
  clearMessages();

  try {
    await apiRequest(
      `/api/admin/api-providers/${encodeURIComponent(model.provider)}/models/${encodeURIComponent(model.model)}`,
      jsonRequest({
        points
      }, "PATCH")
    );

    successMessage.value =
      "模型积分价格已更新";

    await loadProviders();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "更新模型价格失败"
      );
  }
  finally {
    saving.value = "";
  }
}

async function deleteModel(
  model: ProviderModel
) {
  if (
    !window.confirm(
      `确定删除模型 ${model.name} 吗？`
    )
  ) {
    return;
  }

  saving.value =
    `${model.provider}:${model.model}`;
  clearMessages();

  try {
    await apiRequest(
      `/api/admin/api-providers/${encodeURIComponent(model.provider)}/models/${encodeURIComponent(model.model)}`,
      {
        method: "DELETE"
      }
    );

    successMessage.value =
      "模型已删除";

    await loadProviders();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "删除模型失败"
      );
  }
  finally {
    saving.value = "";
  }
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
  <div class="provider-manager">
    <header class="provider-manager-hero">
      <div>
        <span>DYNAMIC PROVIDER REGISTRY</span>
        <h2>模型服务商与模型</h2>
        <p>新增 OpenAI Images 兼容的同步 JSON 服务商。API Key 使用 AES-GCM 加密后保存。</p>
      </div>
      <button type="button" @click="loadProviders">刷新</button>
    </header>

    <p v-if="successMessage" class="provider-message success">{{ successMessage }}</p>
    <p v-if="errorMessage" class="provider-message error">{{ errorMessage }}</p>

    <div class="provider-manager-grid">
      <section class="provider-panel">
        <header><strong>新增模型服务商</strong><span>第一步</span></header>
        <div class="provider-form-grid">
          <label>服务商标识<input v-model="providerForm.id" placeholder="例如 openai-cn" /></label>
          <label>显示名称<input v-model="providerForm.displayName" placeholder="例如 OpenAI 国内代理" /></label>
          <label class="wide">Base URL<input v-model="providerForm.baseUrl" placeholder="https://api.example.com" /></label>
          <label class="wide">生图接口路径<input v-model="providerForm.endpoint" placeholder="/v1/images/generations" /></label>
          <label class="wide">API Key<input v-model="providerForm.apiKey" type="password" autocomplete="new-password" /></label>
          <label>认证 Header<input v-model="providerForm.authHeader" /></label>
          <label>认证前缀<input v-model="providerForm.authScheme" placeholder="Bearer" /></label>
          <label>前台排序<input v-model.number="providerForm.sortOrder" type="number" min="1" max="9999" title="数值越小越靠前" /></label>
        </div>
        <button class="provider-primary" type="button" :disabled="saving === 'provider'" @click="createProvider">
          {{ saving === 'provider' ? '正在新增…' : '新增服务商' }}
        </button>
      </section>

      <section class="provider-panel">
        <header><strong>为服务商新增模型</strong><span>第二步</span></header>
        <div class="provider-form-grid">
          <label class="wide">选择模型服务商
            <select v-model="selectedProviderId">
              <option value="">请选择</option>
              <option v-for="provider in providers" :key="provider.id" :value="provider.id">{{ provider.displayName }}</option>
            </select>
          </label>
          <label>模型 ID<input v-model="modelForm.model" placeholder="gpt-image-1" /></label>
          <label>显示名称<input v-model="modelForm.name" placeholder="GPT Image 1" /></label>
          <label class="wide">模型说明<input v-model="modelForm.description" placeholder="用于前端展示" /></label>
          <label class="wide">支持尺寸<input v-model="modelForm.sizes" placeholder="1024x1024,1024x1536" /></label>
          <label>最大出图数<input v-model.number="modelForm.maxOutputImages" type="number" min="1" max="4" /></label>
          <label>每张积分<input v-model="modelForm.points" type="number" min="0" step="0.01" /></label>
          <label class="provider-check"><input v-model="modelForm.supportsNegativePrompt" type="checkbox" />支持反向提示词</label>
          <label class="provider-check"><input v-model="modelForm.supportsSeed" type="checkbox" />支持随机种子</label>
        </div>
        <button class="provider-primary" type="button" :disabled="saving === 'model'" @click="createModel">
          {{ saving === 'model' ? '正在新增…' : '新增模型' }}
        </button>
      </section>
    </div>

    <div v-if="loading" class="provider-empty">正在读取服务商…</div>
    <div v-else-if="providers.length === 0" class="provider-empty">还没有自定义模型服务商</div>

    <div v-else class="provider-list">
      <article v-for="provider in providers" :key="provider.id" class="provider-card">
        <header>
          <div>
            <span>{{ provider.id }}</span>
            <h3>{{ provider.displayName }}</h3>
            <p>{{ provider.baseUrl }}{{ provider.endpoint }}</p>
          </div>
          <i :class="{ active: provider.enabled }">{{ provider.enabled ? '已启用' : '已停用' }}</i>
        </header>

        <div class="provider-security-line">
          <span>API Key：{{ provider.apiKeyConfigured ? '已加密保存' : '未配置' }}</span>
          <span>{{ provider.authHeader }}: {{ provider.authScheme || '(无前缀)' }} ***</span>
        </div>

        <div class="provider-actions">
          <button type="button" @click="toggleProvider(provider)">{{ provider.enabled ? '停用' : '启用' }}</button>
          <button type="button" @click="updateProviderSort(provider)">排序 {{ provider.sortOrder }}</button>
          <button type="button" @click="replaceApiKey(provider)">更换 API Key</button>
          <button class="danger" type="button" @click="deleteProvider(provider)">删除服务商</button>
        </div>

        <div class="provider-model-list">
          <div v-for="model in provider.models" :key="`${provider.id}:${model.model}`">
            <div>
              <strong>{{ model.name }}</strong>
              <code>{{ model.model }}</code>
              <p>{{ model.description || 'OpenAI Images 兼容同步模型' }}</p>
            </div>
            <span>{{ model.sizes.join(' · ') }}</span>
            <b>{{ model.points }} 积分/张</b>
            <i :class="{ active: model.enabled }">{{ model.enabled ? '启用' : '停用' }}</i>
            <div>
              <button type="button" @click="toggleModel(model)">{{ model.enabled ? '停用' : '启用' }}</button>
              <button type="button" @click="updateModelPrice(model)">改价格</button>
              <button class="danger" type="button" @click="deleteModel(model)">删除</button>
            </div>
          </div>
          <p v-if="provider.models.length === 0" class="provider-no-model">该服务商还没有模型</p>
        </div>
      </article>
    </div>
  </div>
</template>

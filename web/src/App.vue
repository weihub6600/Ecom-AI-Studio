<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import UserPanel from "./UserPanel.vue";
import AppHeader from "./components/AppHeader.vue";
import IntroSection from "./components/IntroSection.vue";
import AuthDialog from "./components/AuthDialog.vue";
import GenerationControls from "./components/GenerationControls.vue";
import ResultPanel from "./components/ResultPanel.vue";
import HistoryPanel from "./components/HistoryPanel.vue";
import { ApiError, apiRequest, jsonRequest } from "./api/client";
import type {
  AuthUser,
  GeneratedImage,
  GenerationResult,
  ModelCapability,
  OutputSize,
  ProviderId,
  ServerHistoryRecord,
  UploadImage
} from "./types";
import { formatSizeTitle, greatestCommonDivisor, providerDisplayName } from "./utils/format";

const DEFAULT_PROMPT = "为上传的商品生成高级简约电商主图，浅色摄影棚背景，柔和自然投影，保持商品外观、包装文字、Logo、颜色和结构完全不变，主体居中，商业产品摄影，高级质感。";
const HISTORY_LIMIT = 20;

const models = ref<ModelCapability[]>([]);
const selectedProviderId = ref<ProviderId>("grsai");
const selectedModelId = ref("gpt-image-2");
const prompt = ref(DEFAULT_PROMPT);
const generationMode = ref<"text-to-image" | "image-edit">("image-edit");
const negativePrompt = ref("模糊、变形、错误文字、重复商品、裁切商品、改变Logo、改变包装结构");
const outputSize = ref<OutputSize>("1024x1024");
const count = ref(1);
const seed = ref<number | undefined>(undefined);
const uploads = ref<UploadImage[]>([]);
const results = ref<GeneratedImage[]>([]);
const resultDimensions = ref<Record<number, string>>({});
const generationMeta = ref<GenerationResult | null>(null);
const loading = ref(false);
const pollingProgress = ref("");
const modelLoading = ref(true);
const errorMessage = ref("");
const historyRecords = ref<ServerHistoryRecord[]>([]);
const activeHistoryId = ref<string | null>(null);
const restoringHistory = ref(false);
const authUser = ref<AuthUser | null>(null);
const authReady = ref(false);
const authDialogOpen = ref(false);
const authMode = ref<"login" | "register">("login");
const userPanelOpen = ref(false);

const providers = computed(() => {
  const unique = new Map<ProviderId, string>();
  for (const model of models.value) unique.set(model.provider, providerDisplayName(model.provider, model.providerName));
  const providerOrder: ProviderId[] = ["grsai", "nanobanana", "lingke"];
  return Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) => {
    const aIndex = providerOrder.indexOf(a.id);
    const bIndex = providerOrder.indexOf(b.id);
    return (aIndex === -1 ? providerOrder.length : aIndex) - (bIndex === -1 ? providerOrder.length : bIndex);
  });
});
const availableModels = computed(() => models.value.filter((model) => model.provider === selectedProviderId.value));
const selectedModel = computed(() => availableModels.value.find((model) => model.id === selectedModelId.value) || availableModels.value[0]);
const sizeOptions = computed(() => (selectedModel.value?.sizes || []).map((value) => ({ value, title: formatSizeTitle(value) })));
const selectedUnitCreditCost = computed(() => selectedModel.value?.creditCost || 0);
const selectedCreditCost = computed(() => Number((selectedUnitCreditCost.value * Math.max(1, count.value)).toFixed(2)));
const hasEnoughCredits = computed(() => Boolean(!authUser.value || authUser.value.role === "admin" || authUser.value.credits >= selectedCreditCost.value));
const canGenerate = computed(() => Boolean(
  selectedModel.value?.configured &&
  prompt.value.trim().length >= 2 &&
  !loading.value &&
  hasEnoughCredits.value &&
  (generationMode.value === "text-to-image" || uploads.value.length > 0)
));
const operationLabel = computed(() => generationMode.value === "image-edit" ? "参考图生成" : "文字生成图片");
const selectedSizeLabel = computed(() => formatSizeTitle(outputSize.value));
const isAuthenticated = computed(() => Boolean(authUser.value));
const providerSymbol = computed(() => selectedProviderId.value === "grsai" ? "G" : selectedProviderId.value === "nanobanana" ? "N" : "百");

watch(selectedProviderId, () => {
  const firstModel = availableModels.value[0];
  if (firstModel && !availableModels.value.some((model) => model.id === selectedModelId.value)) selectedModelId.value = firstModel.id;
});

watch(selectedModel, (model) => {
  if (!model) return;
  if (!model.sizes.includes(outputSize.value)) outputSize.value = model.sizes[0] || "auto";
  count.value = Math.min(count.value, model.maxOutputImages);
  if (uploads.value.length > model.maxReferenceImages) uploads.value = uploads.value.slice(0, model.maxReferenceImages);
  if (!model.supportsSeed) seed.value = undefined;
  if (!model.supportsNegativePrompt) negativePrompt.value = "";
});

watch(generationMode, (mode) => {
  if (restoringHistory.value) return;
  errorMessage.value = "";
  results.value = [];
  generationMeta.value = null;
  if (mode === "text-to-image" && outputSize.value === "auto") outputSize.value = "1024x1024";
  if (mode === "image-edit" && outputSize.value === "1024x1024" && uploads.value.length === 0) outputSize.value = "auto";
});

onMounted(async () => {
  await Promise.all([loadCurrentUser(), loadModels()]);
  if (authUser.value) await loadHistory(true);
});

async function loadCurrentUser() {
  authReady.value = false;
  try {
    const data = await apiRequest<{ user: AuthUser }>("/api/auth/me");
    authUser.value = data.user;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) console.error("Load current user error", error);
    authUser.value = null;
  } finally {
    authReady.value = true;
  }
}

function openAuthDialog(mode: "login" | "register" = "login") {
  authMode.value = mode;
  authDialogOpen.value = true;
}

async function handleAuthenticated(user: AuthUser) {
  authUser.value = user;
  authDialogOpen.value = false;
  await loadHistory(true);
}

async function logout() {
  try {
    await apiRequest<{ success: boolean }>("/api/auth/logout", { method: "POST" });
  } catch {
    // 即使网络中断，也清理当前页面状态。
  } finally {
    authUser.value = null;
    userPanelOpen.value = false;
    historyRecords.value = [];
    activeHistoryId.value = null;
    results.value = [];
    resultDimensions.value = {};
    generationMeta.value = null;
  }
}

function handleBalanceUpdated(credits: number) {
  if (authUser.value) authUser.value = { ...authUser.value, credits };
}

function requireLogin(): boolean {
  if (authUser.value) return true;
  openAuthDialog("login");
  return false;
}

function openAdminPage() {
  window.location.href = "/admin";
}

async function loadModels() {
  modelLoading.value = true;
  errorMessage.value = "";
  try {
    const data = await apiRequest<{ models: ModelCapability[] }>("/api/models");
    models.value = data.models || [];
    const firstModel = models.value.find((model) => model.provider === "grsai") || models.value[0];
    if (firstModel) {
      selectedProviderId.value = firstModel.provider;
      selectedModelId.value = firstModel.id;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "服务端未启动";
  } finally {
    modelLoading.value = false;
  }
}

async function loadHistory(restoreLatest = false) {
  if (!authUser.value) {
    historyRecords.value = [];
    return;
  }
  try {
    const data = await apiRequest<{ history: ServerHistoryRecord[] }>(`/api/history?limit=${HISTORY_LIMIT}`);
    historyRecords.value = data.history || [];
    if (restoreLatest && historyRecords.value[0]) await restoreHistory(historyRecords.value[0], false);
  } catch (error) {
    handleProtectedApiError(error, "读取生成历史失败");
  }
}

async function saveGenerationToServer(meta: GenerationResult, generatedImages: GeneratedImage[]) {
  try {
    const data = await apiRequest<{ record: ServerHistoryRecord }>("/api/history", jsonRequest({
      provider: meta.provider,
      providerName: providerDisplayName(meta.provider, selectedModel.value?.providerName),
      model: meta.model,
      prompt: prompt.value.trim(),
      operation: generationMode.value,
      size: outputSize.value,
      durationMs: meta.durationMs,
      cost: meta.cost,
      images: generatedImages
    }));
    historyRecords.value = [data.record, ...historyRecords.value.filter((item) => item.id !== data.record.id)].slice(0, HISTORY_LIMIT);
    activeHistoryId.value = data.record.id;
    results.value = data.record.images;
    generationMeta.value = { ...meta, images: data.record.images };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    if (error instanceof ApiError && error.status === 401) {
      authUser.value = null;
      openAuthDialog("login");
    }
    errorMessage.value = `图片已经生成，但自动保存到服务器失败：${message}`;
  }
}

async function restoreHistory(record: ServerHistoryRecord, scrollToResult = true) {
  restoringHistory.value = true;
  try {
    const matchingModel = models.value.find((model) => model.provider === record.provider && model.id === record.model);
    selectedProviderId.value = record.provider;
    if (matchingModel) selectedModelId.value = matchingModel.id;
    generationMode.value = record.operation;
    await nextTick();
    if (!matchingModel || matchingModel.sizes.includes(record.size)) outputSize.value = record.size;
    prompt.value = record.prompt;
    results.value = record.images;
    resultDimensions.value = {};
    generationMeta.value = {
      provider: record.provider,
      model: record.model,
      images: record.images,
      durationMs: record.durationMs || 0,
      status: "completed",
      cost: record.cost
    };
    activeHistoryId.value = record.id;
  } finally {
    restoringHistory.value = false;
  }
  if (scrollToResult) window.requestAnimationFrame(() => document.querySelector(".preview-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

async function deleteHistory(record: ServerHistoryRecord) {
  if (!window.confirm("确定从生成历史中移除这条记录吗？服务器原图仍会保留。")) return;
  try {
    await apiRequest<{ success: boolean }>(`/api/history/${encodeURIComponent(record.id)}`, { method: "DELETE" });
    historyRecords.value = historyRecords.value.filter((item) => item.id !== record.id);
    if (activeHistoryId.value === record.id) clearActiveResult();
  } catch (error) {
    handleProtectedApiError(error, "删除历史记录失败");
  }
}

async function clearHistory() {
  if (!historyRecords.value.length || !window.confirm("确定清空当前账号的网页历史吗？服务器原图仍会保留。")) return;
  try {
    await apiRequest<{ success: boolean }>("/api/history", { method: "DELETE" });
    historyRecords.value = [];
    clearActiveResult();
  } catch (error) {
    handleProtectedApiError(error, "清空历史记录失败");
  }
}

function clearActiveResult() {
  activeHistoryId.value = null;
  results.value = [];
  generationMeta.value = null;
  resultDimensions.value = {};
}

async function addFiles(files: File[]) {
  errorMessage.value = "";
  const model = selectedModel.value;
  if (!model) {
    errorMessage.value = "模型信息尚未加载完成，请稍后重试";
    return;
  }
  if (!model.supportsReferenceImages || model.maxReferenceImages <= 0) {
    errorMessage.value = `${model.name} 不支持参考图上传`;
    return;
  }
  if (!files.length) return;

  const remaining = model.maxReferenceImages - uploads.value.length;
  if (remaining <= 0) {
    errorMessage.value = `该模型最多支持 ${model.maxReferenceImages} 张参考图`;
    return;
  }
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  const selectedFiles = files.slice(0, remaining);
  if (files.length > remaining) errorMessage.value = `只添加前 ${remaining} 张图片；该模型最多支持 ${model.maxReferenceImages} 张参考图`;

  for (const file of selectedFiles) {
    if (!allowed.has(file.type)) {
      errorMessage.value = `不支持 ${file.name}，仅允许 JPG、PNG、WEBP`;
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      errorMessage.value = `${file.name} 超过 10MB`;
      continue;
    }
    try {
      uploads.value.push({ id: createUploadId(file), name: file.name, mimeType: file.type as UploadImage["mimeType"], dataUrl: await readFile(file), size: file.size });
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : `读取 ${file.name} 失败`;
    }
  }
}

function createUploadId(file: File): string {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${file.name}-${file.lastModified}-${randomPart}`;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

function removeUpload(id: string) {
  uploads.value = uploads.value.filter((image) => image.id !== id);
}

async function generate() {
  if (!requireLogin() || !canGenerate.value || !selectedModel.value) return;
  loading.value = true;
  pollingProgress.value = "正在提交任务";
  errorMessage.value = "";
  clearActiveResult();
  const startedAt = Date.now();

  try {
    const response = await apiRequest<{ result: GenerationResult; credits?: number; pointsCost?: number }>("/api/images/generate", jsonRequest({
      provider: selectedModel.value.provider,
      model: selectedModel.value.id,
      operation: generationMode.value,
      prompt: prompt.value.trim(),
      negativePrompt: selectedModel.value.supportsNegativePrompt ? negativePrompt.value.trim() || undefined : undefined,
      images: generationMode.value === "image-edit" ? uploads.value.map(({ name, mimeType, dataUrl }) => ({ name, mimeType, dataUrl })) : [],
      size: outputSize.value,
      count: count.value,
      seed: selectedModel.value.supportsSeed ? seed.value : undefined
    }));
    if (typeof response.credits === "number") handleBalanceUpdated(response.credits);

    let result = response.result;
    if ((result.status === "pending" || result.status === "processing") && result.taskId) result = await pollGenerationTask(result, startedAt);
    if (result.status === "failed") throw new Error(result.error || "生成任务失败");

    const completedMeta: GenerationResult = { ...result, durationMs: Date.now() - startedAt };
    generationMeta.value = completedMeta;
    results.value = result.images || [];
    if (results.value.length) await saveGenerationToServer(completedMeta, results.value);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        authUser.value = null;
        openAuthDialog("login");
      }
      if (error.code === "INSUFFICIENT_CREDITS") userPanelOpen.value = true;
    }
    errorMessage.value = error instanceof Error ? error.message : "生成失败，请稍后重试";
  } finally {
    loading.value = false;
    pollingProgress.value = "";
  }
}

async function pollGenerationTask(initial: GenerationResult, startedAt: number): Promise<GenerationResult> {
  if (!initial.taskId) throw new Error("异步任务缺少 task_id");
  for (let attempt = 0; attempt < 150; attempt += 1) {
    pollingProgress.value = initial.progress || `任务处理中 · ${Math.round((Date.now() - startedAt) / 1000)}s`;
    await sleep(2000);
    const data = await apiRequest<{ result: GenerationResult; credits?: number }>(`/api/images/tasks/${encodeURIComponent(initial.provider)}/${encodeURIComponent(initial.taskId)}?model=${encodeURIComponent(initial.model)}`);
    if (typeof data.credits === "number") handleBalanceUpdated(data.credits);
    pollingProgress.value = data.result.progress || "任务处理中";
    if (data.result.status === "completed") return data.result;
    if (data.result.status === "failed") throw new Error(data.result.error || "生成任务失败");
  }
  throw new Error("生成任务等待超过 5 分钟，请稍后在服务商后台检查任务状态");
}

function sleep(ms: number) { return new Promise((resolve) => window.setTimeout(resolve, ms)); }

function onResultImageLoad(event: Event, index: number) {
  const image = event.currentTarget as HTMLImageElement;
  if (!image.naturalWidth || !image.naturalHeight) return;
  const divisor = greatestCommonDivisor(image.naturalWidth, image.naturalHeight);
  resultDimensions.value[index] = `${image.naturalWidth} × ${image.naturalHeight} · ${image.naturalWidth / divisor}:${image.naturalHeight / divisor}`;
}

async function downloadImage(image: GeneratedImage, index: number) {
  try {
    const response = await fetch(image.url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = resolveDownloadFileName(image.url, index, blob.type);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(image.url, "_blank", "noopener,noreferrer");
  }
}

function resolveDownloadFileName(imageUrl: string, index: number, mimeType: string): string {
  const serverFileName = extractServerFileName(imageUrl);
  if (serverFileName) return serverFileName;
  const now = new Date();
  const dateStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const timeStamp = `${dateStamp}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const owner = authUser.value?.username || "user";
  return `${owner}_${timeStamp}_${String(index + 1).padStart(3, "0")}.${extensionFromType(mimeType)}`;
}

function extractServerFileName(imageUrl: string): string | undefined {
  try {
    const rawName = new URL(imageUrl, window.location.href).pathname.split("/").pop();
    if (!rawName) return undefined;
    const fileName = decodeURIComponent(rawName);
    return /^[A-Za-z0-9_\u4e00-\u9fff]+_\d{8}_\d{6}_\d{3,}\.(?:png|jpe?g|webp|gif)$/iu.test(fileName) ? fileName : undefined;
  } catch {
    return undefined;
  }
}

function extensionFromType(type: string) {
  if (type.includes("svg")) return "svg";
  if (type.includes("jpeg")) return "jpg";
  if (type.includes("webp")) return "webp";
  return "png";
}

function handleProtectedApiError(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 401) {
    authUser.value = null;
    openAuthDialog("login");
  }
  errorMessage.value = error instanceof Error ? error.message : fallback;
}
</script>

<template>
  <div class="app-shell">
    <AppHeader
      :auth-ready="authReady"
      :user="authUser"
      @login="openAuthDialog('login')"
      @register="openAuthDialog('register')"
      @open-user="userPanelOpen = true"
      @open-admin="openAdminPage"
      @logout="logout"
    />

    <main class="workspace">
      <IntroSection :selected-model="selectedModel" />

      <div v-if="authReady && !isAuthenticated" class="auth-guard-notice">
        <div><strong>登录后才能使用 AI 生图</strong><span>普通用户注册后需要等待站长审核；审核通过并登录后才能提交 AI 生图任务。</span></div>
        <button type="button" @click="openAuthDialog('login')">立即登录</button>
      </div>

      <div v-if="errorMessage" class="alert" role="alert"><span class="alert-icon">!</span><span>{{ errorMessage }}</span><button type="button" @click="errorMessage = ''">关闭</button></div>

      <div class="studio-grid">
        <GenerationControls
          v-model:selected-provider-id="selectedProviderId"
          v-model:selected-model-id="selectedModelId"
          v-model:generation-mode="generationMode"
          v-model:prompt="prompt"
          v-model:negative-prompt="negativePrompt"
          v-model:output-size="outputSize"
          v-model:count="count"
          v-model:seed="seed"
          :providers="providers"
          :available-models="availableModels"
          :selected-model="selectedModel"
          :model-loading="modelLoading"
          :auth-user="authUser"
          :selected-unit-credit-cost="selectedUnitCreditCost"
          :selected-credit-cost="selectedCreditCost"
          :has-enough-credits="hasEnoughCredits"
          :uploads="uploads"
          :size-options="sizeOptions"
          :loading="loading"
          :can-generate="canGenerate"
          :is-authenticated="isAuthenticated"
          :operation-label="operationLabel"
          :provider-symbol="providerSymbol"
          @files-selected="addFiles"
          @remove-upload="removeUpload"
          @generate="generate"
          @open-user="userPanelOpen = true"
        />

        <div class="result-column">
          <ResultPanel
            :loading="loading"
            :polling-progress="pollingProgress"
            :results="results"
            :result-dimensions="resultDimensions"
            :generation-meta="generationMeta"
            :selected-model="selectedModel"
            :generation-mode="generationMode"
            :selected-size-label="selectedSizeLabel"
            @image-load="onResultImageLoad"
            @download="downloadImage"
          />
          <HistoryPanel
            :records="historyRecords"
            :active-history-id="activeHistoryId"
            :authenticated="isAuthenticated"
            @restore="restoreHistory"
            @remove="deleteHistory"
            @clear="clearHistory"
          />
        </div>
      </div>
    </main>

    <AuthDialog v-if="authDialogOpen" v-model:mode="authMode" @close="authDialogOpen = false" @authenticated="handleAuthenticated" />
    <UserPanel v-if="userPanelOpen && authUser" :user="authUser" @close="userPanelOpen = false" @balance-updated="handleBalanceUpdated" />
  </div>
</template>

<style src="./auth.css"></style>

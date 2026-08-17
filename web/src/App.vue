<script setup lang="ts">
import { platformConfirm } from "./services/platform-feedback";
// V14_3_1_3_1_PASS_MODELS_TO_HISTORY
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import AnnouncementBar from "./components/AnnouncementBar.vue";
import AppHeader from "./components/AppHeader.vue";
import HomeFloatingActions from "./components/HomeFloatingActions.vue";
import IntroSection from "./components/IntroSection.vue";
import AuthDialog from "./components/AuthDialog.vue";
import GenerationControls from "./components/GenerationControls.vue";
import ResultPanel from "./components/ResultPanel.vue";
import HistoryPanel from "./components/HistoryPanel.vue";
import RefineDialog from "./components/RefineDialog.vue";
import { ApiError, apiRequest, jsonRequest } from "./api/client";
import type {
  AuthUser,
  GeneratedImage,
  GenerationResult,
  ModelCapability,
  ImageQuality,
  OutputSize,
  ProviderId,
  ServerHistoryRecord,
  UploadImage
} from "./types";
import { formatSizeTitle, greatestCommonDivisor, providerDisplayName } from "./utils/format";

const props = withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  {
    embedded: false
  }
);

type GenerationPhase = "queue" | "analysis" | "creating" | "rendering" | "complete";

const DEFAULT_PROMPT = "";
const INTRO_COLLAPSED_STORAGE_KEY = "ecom-ai-studio:intro-collapsed";
const FAVORITES_STORAGE_KEY = "ecom-ai-studio:favorites";
const HISTORY_LIMIT = 3;

const models = ref<ModelCapability[]>([]);
const selectedProviderId = ref<ProviderId>("grsai");
const selectedModelId = ref("gpt-image-2");
const prompt = ref(DEFAULT_PROMPT);
const generationMode = ref<"text-to-image" | "image-edit">("image-edit");
const negativePrompt = ref("模糊、变形、错误文字、重复商品、裁切商品、改变Logo、改变包装结构");
const outputSize = ref<OutputSize>("1024x1024");
const quality = ref<ImageQuality | undefined>(undefined);
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
const refineRecord = ref<ServerHistoryRecord | null>(null);
const refineBusy = ref(false);
const authUser = ref<AuthUser | null>(null);
const authReady = ref(false);
const authDialogOpen = ref(false);
const authMode = ref<"login" | "register">("login");
const generationProgress = ref(0);
const generationPhase = ref<GenerationPhase>("queue");
let progressTimer: number | undefined;
let generationStartedAt = 0;
const introCollapsed = ref(false);
const lightboxIndex = ref<number | null>(null);
const favorites = ref<Set<string>>(new Set(loadFavorites()));

const providers = computed(() => {
  const unique = new Map<ProviderId, { name: string; sortOrder: number }>();
  for (const model of models.value) {
    const sortOrder = model.providerSortOrder ?? 9999;
    const current = unique.get(model.provider);
    if (!current || sortOrder < current.sortOrder) {
      unique.set(model.provider, {
        name: providerDisplayName(model.provider, model.providerName),
        sortOrder
      });
    }
  }
  return Array.from(unique, ([id, item]) => ({ id, ...item }))
    .sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name))
    .map(({ id, name }) => ({ id, name }));
});
const availableModels = computed(() => models.value.filter((model) => model.provider === selectedProviderId.value));
const selectedModel = computed(() => availableModels.value.find((model) => model.id === selectedModelId.value) || availableModels.value[0]);
const sizeOptions = computed(() =>
  (selectedModel.value?.sizes || []).map((value) => ({
    value,
    title: formatSizeTitle(value),
    apiValue: selectedModel.value?.sizeMapping?.[value] || value
  }))
);
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
const providerSymbol = computed(() => selectedProviderId.value === "grsai" ? "G" : selectedProviderId.value === "nanobanana" ? "N" : "Z");

const generationStatusText = computed(() => {
  const progress = Math.round(generationProgress.value);

  switch (generationPhase.value) {
    case "queue":
      return "正在排队...";
    case "analysis":
      return "正在分析商品与画面...";
    case "creating":
      return `AI 创作中 ${progress}%`;
    case "rendering":
      return `正在渲染成品 ${progress}%`;
    case "complete":
      return "渲染完成";
  }
});

watch(selectedProviderId, () => {
  const firstModel = availableModels.value[0];
  if (firstModel && !availableModels.value.some((model) => model.id === selectedModelId.value)) selectedModelId.value = firstModel.id;
});

watch(selectedModel, (model) => {
  if (!model) return;
  if (!model.sizes.includes(outputSize.value)) outputSize.value = model.sizes[0] || "auto";

  const modelQualities = model.qualities || [];
  if (modelQualities.length < 1) {
    quality.value = undefined;
  } else if (!quality.value || !modelQualities.includes(quality.value)) {
    quality.value = modelQualities[0];
  }

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

function handleGlobalKeydown(event: KeyboardEvent) {
  // Ctrl+Enter → 触发生成
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canGenerate.value && !loading.value) {
    event.preventDefault();
    generate();
    return;
  }
  // ESC → 关闭弹窗/面板/错误提示
  if (event.key === "Escape") {
    if (lightboxIndex.value !== null) {
      lightboxIndex.value = null;
      return;
    }
    if (authDialogOpen.value) { authDialogOpen.value = false; return; }
    if (errorMessage.value) { errorMessage.value = ""; return; }
  }
}

onMounted(async () => {
  window.addEventListener(
    "keydown",
    handleGlobalKeydown
  );

  window.addEventListener(
    "focus",
    refreshModelsWhenVisible
  );

  document.addEventListener(
    "visibilitychange",
    refreshModelsWhenVisible
  );

  await Promise.all([loadCurrentUser(), loadModels()]);

  const inviteCode = new URLSearchParams(
    window.location.search
  ).get("invite");

  if (inviteCode && !authUser.value) {
    authMode.value = "register";
    authDialogOpen.value = true;
  }
  syncIntroCollapsedState();
  if (authUser.value) {
    await loadHistory(true);
  }
});

onUnmounted(() => {
  stopGenerationProgress();
  window.removeEventListener(
    "keydown",
    handleGlobalKeydown
  );

  window.removeEventListener(
    "focus",
    refreshModelsWhenVisible
  );

  document.removeEventListener(
    "visibilitychange",
    refreshModelsWhenVisible
  );
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
  syncIntroCollapsedState();
  await loadHistory(true);
}

async function logout() {
  try {
    await apiRequest<{ success: boolean }>("/api/auth/logout", { method: "POST" });
  } catch {
    // 即使网络中断，也清理当前页面状态。
  } finally {
    authUser.value = null;
    historyRecords.value = [];
      activeHistoryId.value = null;
    results.value = [];
    resultDimensions.value = {};
    generationMeta.value = null;
    introCollapsed.value = false;
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

function openAccountPage(tab?: string) {
  window.location.href = tab
    ? `/account?tab=${encodeURIComponent(tab)}`
    : "/account";
}

function syncIntroCollapsedState() {
  if (!authUser.value) {
    introCollapsed.value = false;
    return;
  }

  try {
    introCollapsed.value = window.localStorage.getItem(INTRO_COLLAPSED_STORAGE_KEY) !== "false";
  } catch {
    introCollapsed.value = true;
  }
}

function toggleIntro() {
  if (!isAuthenticated.value) return;

  introCollapsed.value = !introCollapsed.value;

  try {
    window.localStorage.setItem(INTRO_COLLAPSED_STORAGE_KEY, String(introCollapsed.value));
  } catch {
    // 浏览器禁止访问 localStorage 时，仅保留当前页面状态。
  }
}

function scrollToSection(sectionId: "result-panel" | "history-panel") {
  window.requestAnimationFrame(() => {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });
}


function phaseFromProgress(progress: number): GenerationPhase {
  if (progress < 20) return "queue";
  if (progress < 38) return "analysis";
  if (progress < 86) return "creating";
  if (progress < 100) return "rendering";
  return "complete";
}

function progressDetailForPhase(phase: GenerationPhase): string {
  switch (phase) {
    case "queue":
      return "正在排队并等待模型接收任务";
    case "analysis":
      return "正在分析商品结构、参考图、构图与提示词";
    case "creating":
      return "模型正在生成主体、场景、光线与材质细节";
    case "rendering":
      return "正在进行高清渲染、结果整理与安全保存";
    case "complete":
      return "图片生成完成，正在载入最终预览";
  }
}

function stopGenerationProgress() {
  if (progressTimer !== undefined) {
    window.clearInterval(progressTimer);
    progressTimer = undefined;
  }
}

function setGenerationProgress(
  phase: GenerationPhase,
  progress: number,
  detail?: string
) {
  generationPhase.value = phase;
  generationProgress.value = Math.max(
    generationProgress.value,
    Math.min(100, Math.max(0, progress))
  );
  pollingProgress.value = detail || progressDetailForPhase(phase);
}

function startGenerationProgress() {
  stopGenerationProgress();
  generationStartedAt = Date.now();
  generationProgress.value = 6;
  generationPhase.value = "queue";
  pollingProgress.value = progressDetailForPhase("queue");

  progressTimer = window.setInterval(() => {
    const elapsed = Date.now() - generationStartedAt;
    let target = 6;

    if (elapsed < 2_500) {
      target = 6 + (elapsed / 2_500) * 12;
    } else if (elapsed < 6_500) {
      target = 18 + ((elapsed - 2_500) / 4_000) * 18;
    } else if (elapsed < 30_000) {
      target = 36 + ((elapsed - 6_500) / 23_500) * 48;
    } else {
      target = 84 + Math.min(12, ((elapsed - 30_000) / 60_000) * 12);
    }

    const nextProgress = Math.max(
      generationProgress.value,
      Math.min(96, target)
    );
    const nextPhase = phaseFromProgress(nextProgress);

    generationProgress.value = nextProgress;
    if (generationPhase.value !== "complete") {
      generationPhase.value = nextPhase;
      pollingProgress.value = progressDetailForPhase(nextPhase);
    }
  }, 650);
}

function updateProgressFromProvider(
  message?: string,
  status?: GenerationResult["status"]
) {
  const match = message?.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (match) {
    const providerProgress = Math.min(99, Math.max(0, Number(match[1])));
    generationProgress.value = Math.max(
      generationProgress.value,
      providerProgress
    );
    generationPhase.value = phaseFromProgress(generationProgress.value);
  } else if (status === "pending" && generationProgress.value < 20) {
    generationPhase.value = "queue";
  } else if (status === "processing" && generationProgress.value < 86) {
    generationPhase.value =
      generationProgress.value < 38 ? "analysis" : "creating";
  }

  if (message?.trim()) {
    pollingProgress.value = message.trim();
  }
}

async function finishGenerationProgress() {
  stopGenerationProgress();
  generationPhase.value = "complete";
  generationProgress.value = 100;
  pollingProgress.value = progressDetailForPhase("complete");
  await sleep(500);
}

function refreshModelsWhenVisible() {
  if (document.hidden) return;

  void loadModels(true);
}

async function loadModels(
  preserveSelection = false
) {
  modelLoading.value = true;
  errorMessage.value = "";

  const previousProvider =
    selectedProviderId.value;

  const previousModel =
    selectedModelId.value;

  try {
    const data =
      await apiRequest<{
        models:
          ModelCapability[];
      }>("/api/models");

    models.value =
      data.models || [];

    const previous =
      preserveSelection
        ? models.value.find(
            (model) =>
              model.provider ===
                previousProvider &&
              model.id ===
                previousModel
          )
        : undefined;

    const target =
      previous ||
      models.value.find(
        (model) =>
          model.provider ===
          "grsai"
      ) ||
      models.value[0];

    if (target) {
      selectedProviderId.value =
        target.provider;

      selectedModelId.value =
        target.id;
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "服务端未启动";
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

async function archiveHistorySources(
  record: ServerHistoryRecord,
  sourceUploads: UploadImage[] = uploads.value
): Promise<ServerHistoryRecord> {
  if (
    generationMode.value !== "image-edit" ||
    !sourceUploads.length
  ) {
    return record;
  }

  try {
    const data = await apiRequest<{
      record: ServerHistoryRecord;
    }>(
      `/api/history/${encodeURIComponent(record.id)}/source-images`,
      jsonRequest({
        images: sourceUploads.map(
          ({ mimeType, dataUrl }) => ({
            url: dataUrl,
            mimeType
          })
        )
      })
    );

    return data.record;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "未知错误";

    errorMessage.value =
      `图片已生成，但原始参考素材归档失败；以后“再次调整”时可能只能使用结果图：${message}`;

    return record;
  }
}

async function acceptSavedHistory(
  record: ServerHistoryRecord,
  meta: GenerationResult
) {
  historyRecords.value = [
    record,
    ...historyRecords.value.filter(
      (item) =>
        item.id !== record.id
    )
  ].slice(0, HISTORY_LIMIT);

  activeHistoryId.value =
    record.id;

  results.value =
    record.images;

  generationMeta.value = {
    ...meta,
    images:
      record.images
  };

}

async function saveGenerationToServer(
  meta: GenerationResult,
  generatedImages: GeneratedImage[],
  taskRecordId?: string
) {
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
    const recordWithSources =
      await archiveHistorySources(
        data.record
      );

    await acceptSavedHistory(
      recordWithSources,
      meta
    );

    if (taskRecordId) {
      await apiRequest<{ success: boolean }>(
        `/api/account/tasks/${encodeURIComponent(taskRecordId)}/link-history`,
        jsonRequest({
          historyId: data.record.id
        })
      );
    }

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
  if (!await platformConfirm("确定删除这条生成历史及服务器原图吗？删除后无法恢复。")) return;
  try {
    await apiRequest<{ success: boolean }>(`/api/history/${encodeURIComponent(record.id)}`, { method: "DELETE" });
    historyRecords.value = historyRecords.value.filter((item) => item.id !== record.id);
    if (activeHistoryId.value === record.id) clearActiveResult();
  } catch (error) {
    handleProtectedApiError(error, "删除历史记录失败");
  }
}

function openRefine(
  record: ServerHistoryRecord
) {
  refineRecord.value = record;
}

function buildRefineReferences(
  record: ServerHistoryRecord,
  maxReferenceImages: number
): Array<{
  image: GeneratedImage;
  kind: "source" | "result";
  index: number;
}> {
  const limit = Math.max(
    1,
    maxReferenceImages
  );

  const sources =
    record.sourceImages || [];

  const current =
    record.images || [];

  const references: Array<{
    image: GeneratedImage;
    kind: "source" | "result";
    index: number;
  }> = [];

  if (
    sources.length > 0 &&
    current.length > 0 &&
    limit > 1
  ) {
    const sourceLimit =
      Math.min(
        sources.length,
        limit - 1
      );

    for (
      let index = 0;
      index < sourceLimit;
      index += 1
    ) {
      const image = sources[index];
      if (image) {
        references.push({
          image,
          kind: "source",
          index
        });
      }
    }
  }

  for (
    let index = 0;
    index < current.length &&
    references.length < limit;
    index += 1
  ) {
    const image = current[index];
    if (image) {
      references.push({
        image,
        kind: "result",
        index
      });
    }
  }

  if (!references.length) {
    for (
      let index = 0;
      index < sources.length &&
      references.length < limit;
      index += 1
    ) {
      const image = sources[index];
      if (image) {
        references.push({
          image,
          kind: "source",
          index
        });
      }
    }
  }

  return references;
}

async function historyImageToUpload(
  item: {
    image: GeneratedImage;
    kind: "source" | "result";
    index: number;
  },
  recordId: string
): Promise<UploadImage> {
  const response =
    await fetch(
      item.image.url,
      {
        credentials: "same-origin"
      }
    );

  if (!response.ok) {
    throw new Error(
      `读取历史参考图失败：HTTP ${response.status}`
    );
  }

  const blob =
    await response.blob();

  const mimeType =
    blob.type === "image/png" ||
    blob.type === "image/jpeg" ||
    blob.type === "image/webp"
      ? blob.type
      : item.image.mimeType === "image/png" ||
          item.image.mimeType === "image/jpeg" ||
          item.image.mimeType === "image/webp"
        ? item.image.mimeType
        : undefined;

  if (!mimeType) {
    throw new Error(
      "当前历史图片格式不支持再次调整"
    );
  }

  const dataUrl =
    await new Promise<string>(
      (resolve, reject) => {
        const reader =
          new FileReader();

        reader.onload = () =>
          resolve(
            String(reader.result)
          );

        reader.onerror = () =>
          reject(
            new Error(
              "历史参考图读取失败"
            )
          );

        reader.readAsDataURL(blob);
      }
    );

  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType === "image/webp"
        ? "webp"
        : "png";

  return {
    id:
      `refine-${recordId}-${item.kind}-${item.index}-${Date.now()}`,
    name:
      item.kind === "source"
        ? `original-${item.index + 1}.${extension}`
        : `current-result-${item.index + 1}.${extension}`,
    mimeType,
    dataUrl,
    size:
      blob.size
  };
}

async function handleRefineConfirm(
  adjustmentPrompt: string
) {
  const record =
    refineRecord.value;

  if (
    !record ||
    refineBusy.value
  ) {
    return;
  }

  const nextPrompt =
    adjustmentPrompt.trim();

  if (nextPrompt.length < 2) {
    return;
  }

  const model =
    models.value.find(
      (item) =>
        item.provider ===
          record.provider &&
        item.id ===
          record.model
    );

  if (
    !model ||
    !model.configured
  ) {
    refineRecord.value = null;
    errorMessage.value =
      "原历史记录对应的模型当前不可用，请先在后台检查模型配置";
    return;
  }

  if (
    !model.supportsReferenceImages ||
    model.maxReferenceImages < 1
  ) {
    refineRecord.value = null;
    errorMessage.value =
      "该模型不支持参考图，因此无法基于当前结果进行再次调整";
    return;
  }

  const references =
    buildRefineReferences(
      record,
      model.maxReferenceImages
    );

  if (!references.length) {
    refineRecord.value = null;
    errorMessage.value =
      "这条历史记录没有可用于二次调整的图片";
    return;
  }

  refineBusy.value = true;

  try {
    const prepared:
      UploadImage[] = [];

    for (
      const reference of references
    ) {
      prepared.push(
        await historyImageToUpload(
          reference,
          record.id
        )
      );
    }

    restoringHistory.value = true;

    selectedProviderId.value =
      record.provider;

    await nextTick();

    selectedModelId.value =
      model.id;

    generationMode.value =
      "image-edit";

    await nextTick();

    if (
      model.sizes.includes(
        record.size
      )
    ) {
      outputSize.value =
        record.size;
    }

    count.value =
      Math.min(
        Math.max(
          1,
          record.images.length
        ),
        model.maxOutputImages
      );

    uploads.value =
      prepared;

    prompt.value =
      `基于这些参考图进行二次调整：${nextPrompt}`;

    results.value =
      record.images;

    resultDimensions.value =
      {};

    generationMeta.value = {
      provider:
        record.provider,
      model:
        record.model,
      images:
        record.images,
      durationMs:
        record.durationMs || 0,
      status:
        "completed",
      cost:
        record.cost
    };

    activeHistoryId.value =
      record.id;

    refineRecord.value =
      null;
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "载入历史素材失败";
    return;
  } finally {
    restoringHistory.value =
      false;
    refineBusy.value =
      false;
  }

  await nextTick();
  await generate();
}

async function clearHistory() {
  if (!historyRecords.value.length || !await platformConfirm("确定清空当前账号的生成历史及服务器原图吗？删除后无法恢复。")) return;
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
  errorMessage.value = "";
  clearActiveResult();
  startGenerationProgress();
  const startedAt = Date.now();

  try {
    const taskThumbnail =
      generationMode.value === "image-edit" &&
      uploads.value[0]
        ? await createTaskThumbnail(
            uploads.value[0].dataUrl
          )
        : undefined;

    const response = await apiRequest<{
      result: GenerationResult;
      credits?: number;
      pointsCost?: number;
      taskRecordId?: string;
      historyRecord?:
        ServerHistoryRecord;
    }>(
      "/api/images/generate",
      jsonRequest({
        provider: selectedModel.value.provider,
        model: selectedModel.value.id,
        operation: generationMode.value,
        prompt: prompt.value.trim(),
        negativePrompt: selectedModel.value.supportsNegativePrompt
          ? negativePrompt.value.trim() || undefined
          : undefined,
        images:
          generationMode.value === "image-edit"
            ? uploads.value.map(({ name, mimeType, dataUrl }) => ({
                name,
                mimeType,
                dataUrl
              }))
            : [],
        size: outputSize.value,
        quality:
          (selectedModel.value.qualities || []).length > 0
            ? quality.value || selectedModel.value.qualities[0]
            : undefined,
        count: count.value,
        seed: selectedModel.value.supportsSeed
          ? seed.value
          : undefined,
        taskThumbnail
      })
    );

    if (typeof response.credits === "number") {
      handleBalanceUpdated(response.credits);
    }



    let taskPayload: {
      result: GenerationResult;
      historyRecord?:
        ServerHistoryRecord;
    } = {
      result:
        response.result,
      historyRecord:
        response.historyRecord
    };

    let result =
      taskPayload.result;

    updateProgressFromProvider(
      result.progress,
      result.status
    );

    if (
      (result.status === "pending" || result.status === "processing") &&
      result.taskId
    ) {
      taskPayload =
        await pollGenerationTask(
          result,
          startedAt
        );

      result =
        taskPayload.result;
    }

    if (result.status === "failed") {
      throw new Error(result.error || "生成任务失败");
    }

    setGenerationProgress(
      "rendering",
      Math.max(94, generationProgress.value),
      "生成内容已返回，正在整理高清图片并保存历史"
    );

    const completedMeta: GenerationResult = {
      ...result,
      durationMs: Date.now() - startedAt
    };

    generationMeta.value = completedMeta;
    results.value = result.images || [];

    if (results.value.length) {
      if (taskPayload.historyRecord) {
        const historyWithSources =
          await archiveHistorySources(
            taskPayload.historyRecord
          );

        await acceptSavedHistory(
          historyWithSources,
          completedMeta
        );
      } else {
        await saveGenerationToServer(
          completedMeta,
          results.value,
          response.taskRecordId
        );
      }
    }

    await finishGenerationProgress();
  } catch (error) {
    stopGenerationProgress();
    generationProgress.value = 0;
    generationPhase.value = "queue";

    if (error instanceof ApiError) {
      if (error.status === 401) {
        authUser.value = null;
        openAuthDialog("login");
      }

      if (error.code === "INSUFFICIENT_CREDITS") {
        openAccountPage("credits");
      }
    }

    errorMessage.value =
      error instanceof Error
        ? error.message
        : "生成失败，请稍后重试";
  } finally {
    stopGenerationProgress();
    loading.value = false;
    pollingProgress.value = "";
  }
}

async function pollGenerationTask(
  initial: GenerationResult,
  startedAt: number
): Promise<{
  result: GenerationResult;
  historyRecord?: ServerHistoryRecord;
}> {
  if (!initial.taskId) {
    throw new Error("异步任务缺少 task_id");
  }

  updateProgressFromProvider(initial.progress, initial.status);

  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (!initial.progress) {
      pollingProgress.value =
        `任务处理中 · ${Math.round((Date.now() - startedAt) / 1000)}s`;
    }

    await sleep(2_000);

    const data = await apiRequest<{
      result: GenerationResult;
      credits?: number;
      historyRecord?:
        ServerHistoryRecord;
    }>(
      `/api/images/tasks/${encodeURIComponent(initial.provider)}/${encodeURIComponent(initial.taskId)}?model=${encodeURIComponent(initial.model)}`
    );

    if (typeof data.credits === "number") {
      handleBalanceUpdated(data.credits);
    }

    updateProgressFromProvider(
      data.result.progress,
      data.result.status
    );

    if (data.result.status === "completed") {
      return {
        result: data.result,
        historyRecord:
          data.historyRecord
      };
    }

    if (data.result.status === "failed") {
      throw new Error(
        data.result.error || "生成任务失败"
      );
    }
  }

  throw new Error(
    "生成任务等待超过 5 分钟，请稍后在服务商后台检查任务状态"
  );
}

async function createTaskThumbnail(
  dataUrl: string
): Promise<string | undefined> {
  try {
    const image =
      await new Promise<HTMLImageElement>(
        (resolve, reject) => {
          const element = new Image();
          element.onload = () =>
            resolve(element);
          element.onerror = () =>
            reject(
              new Error("缩略图读取失败")
            );
          element.src = dataUrl;
        }
      );

    const maxSide = 320;
    const scale = Math.min(
      1,
      maxSide /
        Math.max(
          image.naturalWidth,
          image.naturalHeight
        )
    );

    const canvas =
      document.createElement("canvas");

    canvas.width = Math.max(
      1,
      Math.round(
        image.naturalWidth * scale
      )
    );

    canvas.height = Math.max(
      1,
      Math.round(
        image.naturalHeight * scale
      )
    );

    const context =
      canvas.getContext("2d");

    if (!context) return undefined;

    context.drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas.toDataURL(
      "image/jpeg",
      0.78
    );
  } catch {
    return undefined;
  }
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

// 收藏管理
function loadFavorites(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function toggleFavorite(id: string) {
  const next = new Set(favorites.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  favorites.value = next;
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...next]));
  } catch { /* 忽略存储错误 */ }
}

// 打包下载所有结果图
async function downloadAllZip() {
  if (!results.value.length) return;
  try {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const folder = zip.folder("ecom-ai-images")!;

    for (let i = 0; i < results.value.length; i++) {
      const img = results.value[i];
      if (!img) continue;
      const resp = await fetch(img.url);
      const blob = await resp.blob();
      const ext = extensionFromType(blob.type);
      const name = resolveDownloadFileName(img.url, i, blob.type);
      folder.file(name || `result_${String(i + 1).padStart(2, "0")}.${ext}`, blob);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ecom-ai-images.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    errorMessage.value = "打包下载失败，请尝试单张下载";
  }
}
</script>

<template>
  <div class="app-shell" :class="{ 'is-authenticated': isAuthenticated }">
    <AppHeader
      v-if="!props.embedded"
      :auth-ready="authReady"
      :user="authUser"
      @login="openAuthDialog('login')"
      @register="openAuthDialog('register')"
      @open-user="openAccountPage()"
      @open-admin="openAdminPage"
      @logout="logout"
    />

    <AnnouncementBar v-if="!props.embedded" />

    <main class="workspace" :class="{ 'workspace-embedded': props.embedded }">
      <IntroSection
        :selected-model="selectedModel"
        :collapsible="isAuthenticated"
        :collapsed="introCollapsed"
        @toggle="toggleIntro"
      />

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
          v-model:quality="quality"
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
          :generation-progress="generationProgress"
          :generation-status-text="generationStatusText"
          @files-selected="addFiles"
          @remove-upload="removeUpload"
          @generate="generate"
          @open-user="openAccountPage()"
        />

        <div class="result-column">
          <ResultPanel
            :loading="loading"
            :polling-progress="pollingProgress"
            :generation-progress="generationProgress"
            :generation-phase="generationPhase"
            :generation-status-text="generationStatusText"
            :results="results"
            :result-dimensions="resultDimensions"
            :generation-meta="generationMeta"
            :selected-model="selectedModel"
            :generation-mode="generationMode"
            :selected-size-label="selectedSizeLabel"
            :authenticated="isAuthenticated"
            :history-count="historyRecords.length"
            :lightbox-index="lightboxIndex"
            @image-load="onResultImageLoad"
            @download="downloadImage"
            @download-all="downloadAllZip"
            @show-history="scrollToSection('history-panel')"
            @update:lightbox-index="lightboxIndex = $event"
          />
          <HistoryPanel
            :records="historyRecords"
            :models="models"
            :active-history-id="activeHistoryId"
            :authenticated="isAuthenticated"
            :favorites="favorites"
            @restore="restoreHistory"
            @adjust="openRefine"
            @remove="deleteHistory"
            @clear="clearHistory"
            @showResult="scrollToSection('result-panel')"
            @toggleFavorite="toggleFavorite"
          />
          <a
            class="history-more-link"
            href="/library"
          >
            进入作品库
          </a>
        </div>
      </div>
    </main>

    <HomeFloatingActions v-if="!props.embedded" />

    <RefineDialog
      v-if="refineRecord"
      :record="refineRecord"
      :busy="refineBusy"
      @close="!refineBusy && (refineRecord = null)"
      @confirm="handleRefineConfirm"
    />

    <AuthDialog v-if="authDialogOpen" v-model:mode="authMode" @close="authDialogOpen = false" @authenticated="handleAuthenticated" />
  </div>
</template>

<style src="./auth.css"></style>

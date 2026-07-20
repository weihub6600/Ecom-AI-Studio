<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { GeneratedImage, GenerationResult, ModelCapability, OutputSize, ProviderId, UploadImage } from "./types";

const promptTemplates = [
  "为上传的商品生成高级简约电商主图，浅色摄影棚背景，柔和自然投影，保持商品外观、包装文字、Logo、颜色和结构完全不变，主体居中，商业产品摄影，高级质感。",
  "生成清爽蓝白科技风电商首屏，加入柔和渐变、透明玻璃平台和克制的光效，商品保持真实比例和包装细节，画面干净，适合品牌官网。",
  "生成日式生活方式场景，原木桌面、自然窗光和浅色背景，商品作为视觉中心，构图留白，保持商品标签和包装不变。",
  "生成纯白背景商品效果图，修正光线和阴影，去除杂乱背景，不改变商品本体、形状、文字和Logo，适合电商平台白底主图。"
];

const CLIENT_ID_STORAGE_KEY = "ecom-ai-studio:client-id:v1";
const LOCAL_HISTORY_STORAGE_KEY = "ecom-ai-studio:local-history:v1";
const LOCAL_HISTORY_LIMIT = 20;

interface ServerHistoryRecord {
  id: string;
  createdAt: string;
  clientId: string;
  clientIp?: string;
  userAgent?: string;
  provider: ProviderId;
  providerName: string;
  model: string;
  prompt: string;
  operation: "text-to-image" | "image-edit";
  size: OutputSize;
  durationMs?: number;
  cost?: number;
  images: GeneratedImage[];
}

const models = ref<ModelCapability[]>([]);
const selectedProviderId = ref<ProviderId>("grsai");
const selectedModelId = ref("gpt-image-2");
const prompt = ref(promptTemplates[0] ?? "");
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
const dragging = ref(false);
const errorMessage = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const promptInput = ref<HTMLTextAreaElement | null>(null);
const localHistory = ref<ServerHistoryRecord[]>([]);
const clientId = ref("");
const activeHistoryId = ref<string | null>(null);
const restoringHistory = ref(false);

const providers = computed(() => {
  const unique = new Map<ProviderId, string>();
  for (const model of models.value) unique.set(model.provider, providerDisplayName(model.provider, model.providerName));

  // 固定服务商显示顺序：GRSAI、Nano Banana、百嘉瑞AI。
  const providerOrder: ProviderId[] = ["grsai", "nanobanana", "lingke"];

  return Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) => {
    const aIndex = providerOrder.indexOf(a.id);
    const bIndex = providerOrder.indexOf(b.id);
    const aOrder = aIndex === -1 ? providerOrder.length : aIndex;
    const bOrder = bIndex === -1 ? providerOrder.length : bIndex;
    return aOrder - bOrder;
  });
});
const availableModels = computed(() => models.value.filter((model) => model.provider === selectedProviderId.value));
const selectedModel = computed(() => availableModels.value.find((model) => model.id === selectedModelId.value) || availableModels.value[0]);
const sizeOptions = computed(() => (selectedModel.value?.sizes || []).map((value) => ({ value, title: formatSizeTitle(value) })));
const canGenerate = computed(() => Boolean(
  selectedModel.value?.configured &&
  prompt.value.trim().length >= 2 &&
  !loading.value &&
  (generationMode.value === "text-to-image" || uploads.value.length > 0)
));
const operationLabel = computed(() => generationMode.value === "image-edit" ? "参考图生成" : "文字生成图片");
const selectedSizeLabel = computed(() => formatSizeTitle(outputSize.value));
const providerSymbol = computed(() => {
  if (selectedProviderId.value === "grsai") return "G";
  if (selectedProviderId.value === "nanobanana") return "N";
  return "百";
});

function providerDisplayName(provider: ProviderId | string | undefined, providerName?: string): string {
  if (provider === "grsai") return "GPT";
  return providerName || "API";
}

function displayText(value: string): string {
  return value.replace(/GRSAI/g, "GPT");
}

watch(selectedProviderId, () => {
  const firstModel = availableModels.value[0];
  if (!firstModel) return;
  if (!availableModels.value.some((model) => model.id === selectedModelId.value)) {
    selectedModelId.value = firstModel.id;
  }
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
  if (mode === "text-to-image" && outputSize.value === "auto") {
    outputSize.value = "1024x1024";
  }
  if (mode === "image-edit" && outputSize.value === "1024x1024" && uploads.value.length === 0) {
    outputSize.value = "auto";
  }
});

onMounted(async () => {
  initializeClientId();
  await loadModels();
  await loadLocalHistory();
});

async function loadModels() {
  modelLoading.value = true;
  errorMessage.value = "";
  try {
    const response = await fetch("/api/models");
    if (!response.ok) throw new Error("无法读取模型列表");
    const data = await response.json();
    models.value = data.models || [];
    // 默认选择服务商列表中的第一个：GRSAI。
    const firstGrsai = models.value.find((model) => model.provider === "grsai");
    const firstModel = firstGrsai || models.value[0];
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

function createClientIdentifier(): string {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `client-${randomPart}`;
}

function initializeClientId() {
  try {
    const stored = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY)?.trim();
    if (stored && /^[A-Za-z0-9._:-]{8,160}$/.test(stored)) {
      clientId.value = stored;
      return;
    }
    clientId.value = createClientIdentifier();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId.value);
  } catch {
    // 浏览器禁用本地存储时仍允许生成，但刷新后本机历史无法保留。
    clientId.value = createClientIdentifier();
    errorMessage.value = "浏览器本地存储不可用，本机历史将在刷新后丢失；服务器归档不受影响。";
  }
}

async function loadLocalHistory() {
  try {
    const raw = window.localStorage.getItem(LOCAL_HISTORY_STORAGE_KEY);
    if (!raw) {
      localHistory.value = [];
      return;
    }

    const parsed: unknown = JSON.parse(raw);
    const records = Array.isArray(parsed)
      ? parsed.filter(isLocalHistoryRecord).filter((record) => record.clientId === clientId.value)
      : [];
    localHistory.value = records.slice(0, LOCAL_HISTORY_LIMIT);

    const latest = localHistory.value[0];
    if (latest) await restoreHistory(latest, false);
  } catch {
    localHistory.value = [];
    try {
      window.localStorage.removeItem(LOCAL_HISTORY_STORAGE_KEY);
    } catch {
      // 无需覆盖主要错误信息。
    }
    errorMessage.value = "本机历史数据已损坏，已自动重置；服务器归档仍然保留。";
  }
}

function isLocalHistoryRecord(value: unknown): value is ServerHistoryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ServerHistoryRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.clientId === "string" &&
    (record.provider === "lingke" || record.provider === "grsai" || record.provider === "nanobanana") &&
    typeof record.providerName === "string" &&
    typeof record.model === "string" &&
    typeof record.prompt === "string" &&
    (record.operation === "text-to-image" || record.operation === "image-edit") &&
    typeof record.size === "string" &&
    Array.isArray(record.images) &&
    record.images.every((image) => Boolean(image && typeof image.url === "string"))
  );
}

function persistLocalHistory() {
  try {
    window.localStorage.setItem(
      LOCAL_HISTORY_STORAGE_KEY,
      JSON.stringify(localHistory.value.slice(0, LOCAL_HISTORY_LIMIT))
    );
  } catch {
    errorMessage.value = "服务器已保存本次记录，但浏览器无法写入本机历史。";
  }
}

function addToLocalHistory(record: ServerHistoryRecord) {
  localHistory.value = [
    record,
    ...localHistory.value.filter((item) => item.id !== record.id)
  ].slice(0, LOCAL_HISTORY_LIMIT);
  persistLocalHistory();
}

async function saveGenerationToServer(meta: GenerationResult, generatedImages: GeneratedImage[]) {
  try {
    if (!clientId.value) initializeClientId();
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: clientId.value,
        provider: meta.provider,
        providerName: providerDisplayName(meta.provider, selectedModel.value?.providerName),
        model: meta.model,
        prompt: prompt.value.trim(),
        operation: generationMode.value,
        size: outputSize.value,
        durationMs: meta.durationMs,
        cost: meta.cost,
        images: generatedImages
      })
    });
    const data = await response.json() as { record?: ServerHistoryRecord; error?: { message?: string } };
    if (!response.ok || !data.record) throw new Error(data.error?.message || "自动保存到服务器失败");

    const record = data.record;
    addToLocalHistory(record);
    activeHistoryId.value = record.id;
    results.value = record.images;
    generationMeta.value = { ...meta, images: record.images };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    errorMessage.value = `图片已经生成，但自动保存到服务器失败：${message}`;
  }
}

async function restoreHistory(record: ServerHistoryRecord, scrollToResult = true) {
  restoringHistory.value = true;
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
  restoringHistory.value = false;
  if (scrollToResult) {
    window.requestAnimationFrame(() => document.querySelector(".preview-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

function deleteHistory(record: ServerHistoryRecord) {
  if (!window.confirm("确定从当前电脑的历史列表中移除这条记录吗？服务器归档和图片文件不会删除。")) return;
  localHistory.value = localHistory.value.filter((item) => item.id !== record.id);
  persistLocalHistory();
  if (activeHistoryId.value === record.id) {
    activeHistoryId.value = null;
    results.value = [];
    generationMeta.value = null;
    resultDimensions.value = {};
  }
}

function clearLocalHistory() {
  if (localHistory.value.length === 0 || !window.confirm("确定清空当前电脑最近 20 条历史吗？服务器上的完整归档不会删除。")) return;
  localHistory.value = [];
  persistLocalHistory();
  activeHistoryId.value = null;
  results.value = [];
  generationMeta.value = null;
  resultDimensions.value = {};
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function formatSizeTitle(value: OutputSize): string {
  if (value === "auto") return "自适应";
  const separator = value.includes("x") ? "x" : value.includes(":") ? ":" : "";
  if (!separator) return value;
  const [rawWidth, rawHeight] = value.split(separator);
  const width = Number(rawWidth);
  const height = Number(rawHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return value;
  const divisor = greatestCommonDivisor(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  const orientation = width === height ? "正方形" : width > height ? "横版" : "竖版";
  return `${orientation} ${ratio}`;
}

function openFileDialog() {
  fileInput.value?.click();
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  // 必须先复制 File 对象，再清空 input；避免部分浏览器清空后 FileList 失效。
  const files = Array.from(input.files || []);
  input.value = "";
  await addFiles(files);
}

async function onDrop(event: DragEvent) {
  dragging.value = false;
  await addFiles(Array.from(event.dataTransfer?.files || []));
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
  if (files.length === 0) return;

  const remaining = model.maxReferenceImages - uploads.value.length;
  if (remaining <= 0) {
    errorMessage.value = `该模型最多支持 ${model.maxReferenceImages} 张参考图`;
    return;
  }

  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  const selectedFiles = files.slice(0, remaining);

  if (files.length > remaining) {
    errorMessage.value = `只添加前 ${remaining} 张图片；该模型最多支持 ${model.maxReferenceImages} 张参考图`;
  }

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
      const dataUrl = await readFile(file);
      uploads.value.push({
        id: createUploadId(file),
        name: file.name,
        mimeType: file.type as UploadImage["mimeType"],
        dataUrl,
        size: file.size
      });
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : `读取 ${file.name} 失败`;
    }
  }
}

function createUploadId(file: File): string {
  // crypto.randomUUID() 在普通 HTTP 局域网地址下可能不可用；localhost 通常不会暴露该问题。
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

function useTemplate(template: string) {
  prompt.value = template;
}

function useCustomPrompt() {
  prompt.value = "";
  window.requestAnimationFrame(() => promptInput.value?.focus());
}

async function generate() {
  if (!canGenerate.value || !selectedModel.value) return;
  loading.value = true;
  pollingProgress.value = "正在提交任务";
  errorMessage.value = "";
  results.value = [];
  resultDimensions.value = {};
  generationMeta.value = null;
  const startedAt = Date.now();

  try {
    const response = await fetch("/api/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: selectedModel.value.provider,
        model: selectedModel.value.id,
        operation: generationMode.value,
        prompt: prompt.value.trim(),
        negativePrompt: selectedModel.value.supportsNegativePrompt ? negativePrompt.value.trim() || undefined : undefined,
        images: generationMode.value === "image-edit"
          ? uploads.value.map(({ name, mimeType, dataUrl }) => ({ name, mimeType, dataUrl }))
          : [],
        size: outputSize.value,
        count: count.value,
        seed: selectedModel.value.supportsSeed ? seed.value : undefined
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "生成失败");

    let result = data.result as GenerationResult;
    if ((result.status === "pending" || result.status === "processing") && result.taskId) {
      result = await pollGenerationTask(result, startedAt);
    }

    if (result.status === "failed") {
      throw new Error(result.error || "生成任务失败");
    }

    const completedMeta: GenerationResult = {
      ...result,
      durationMs: Date.now() - startedAt
    };
    generationMeta.value = completedMeta;
    results.value = result.images || [];
    if (results.value.length > 0) {
      await saveGenerationToServer(completedMeta, results.value);
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "生成失败，请稍后重试";
  } finally {
    loading.value = false;
    pollingProgress.value = "";
  }
}

async function pollGenerationTask(initial: GenerationResult, startedAt: number): Promise<GenerationResult> {
  if (!initial.taskId) throw new Error("异步任务缺少 task_id");

  const maxAttempts = 150;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    pollingProgress.value = initial.progress || `任务处理中 · ${Math.round((Date.now() - startedAt) / 1000)}s`;
    await sleep(2000);

    const url = `/api/images/tasks/${encodeURIComponent(initial.provider)}/${encodeURIComponent(initial.taskId)}?model=${encodeURIComponent(initial.model)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "查询生成任务失败");

    const result = data.result as GenerationResult;
    pollingProgress.value = result.progress || "任务处理中";

    if (result.status === "completed") return result;
    if (result.status === "failed") throw new Error(result.error || "生成任务失败");
  }

  throw new Error("生成任务等待超过 5 分钟，请稍后在服务商后台检查任务状态");
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function onResultImageLoad(event: Event, index: number) {
  const image = event.currentTarget as HTMLImageElement;
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) return;

  const divisor = greatestCommonDivisor(width, height);
  resultDimensions.value[index] = `${width} × ${height} · ${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x || 1;
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
  return `${dateStamp}_${String(index + 1).padStart(3, "0")}.${extensionFromType(mimeType)}`;
}

function extractServerFileName(imageUrl: string): string | undefined {
  try {
    const parsed = new URL(imageUrl, window.location.href);
    const rawName = parsed.pathname.split("/").pop();
    if (!rawName) return undefined;
    const fileName = decodeURIComponent(rawName);
    return /^\d{8}_\d{3,}\.(?:png|jpe?g|webp|gif)$/i.test(fileName) ? fileName : undefined;
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

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="BJR AI Studio 首页">
        <span class="brand-mark"><span></span><span></span></span>
        <span>
          <strong>BJR AI</strong>
          <small>STUDIO</small>
        </span>
      </a>
      <div class="topbar-center">
        <span class="live-dot"></span>
        BJR AI 双引擎电商视觉工作台
      </div>
      <div class="topbar-actions">
        <span class="mode-badge">BJR 0.1</span>
        <a class="github-link" href="https://517zhe.com/" target="_blank" rel="noopener noreferrer">517ZHE</a>
      </div>
    </header>

    <main class="workspace">
      <section class="intro">
        <div>
          <span class="eyebrow">ECOMMERCE CREATIVE ENGINE</span>
          <h1>一张商品图，生成完整商业视觉</h1>
          <p>支持百嘉瑞AI 与 GPT 双 API，可在 GPT Image 2 和 GPT Image 2 VIP 之间切换。</p>
        </div>
        <div class="intro-stats">
          <div><strong>{{ selectedModel?.name || '—' }}</strong><span>当前模型</span></div>
          <div><strong>{{ selectedModel?.configured ? '已连接' : '待配置' }}</strong><span>{{ providerDisplayName(selectedModel?.provider, selectedModel?.providerName) }}</span></div>
          <div><strong>{{ selectedModel?.sizes.length || 0 }} 档</strong><span>输出尺寸</span></div>
        </div>
      </section>

      <div v-if="errorMessage" class="alert" role="alert">
        <span class="alert-icon">!</span>
        <span>{{ errorMessage }}</span>
        <button type="button" @click="errorMessage = ''">关闭</button>
      </div>

      <div class="studio-grid">
        <section class="control-panel panel">
          <div class="panel-heading">
            <div>
              <span class="step-number">01</span>
              <div><h2>创作设置</h2><p>选择 API 服务商、模型并描述需要生成的画面</p></div>
            </div>
            <span class="operation-pill">{{ operationLabel }}</span>
          </div>

          <div class="field-block provider-field">
  <label>API 服务商</label>
  <div class="segmented provider-segmented">
              <button
                v-for="provider in providers"
                :key="provider.id"
                type="button"
                :class="{ active: selectedProviderId === provider.id }"
                @click="selectedProviderId = provider.id"
              >
                {{ provider.name }}
              </button>
            </div>
          </div>

          <div class="field-block">
            <label for="model-select">AI 模型</label>
            <div v-if="modelLoading" class="skeleton-input"></div>
            <template v-else-if="selectedModel">
              <select v-if="availableModels.length > 1" id="model-select" v-model="selectedModelId" class="select-control">
                <option v-for="model in availableModels" :key="model.id" :value="model.id">{{ model.name }}</option>
              </select>
              <div class="model-card" :class="{ disabled: !selectedModel.configured }">
                <div class="provider-symbol">{{ providerSymbol }}</div>
                <div class="model-copy"><strong>{{ providerDisplayName(selectedModel.provider, selectedModel.providerName) }} · {{ selectedModel.name }}</strong><span>{{ displayText(selectedModel.description) }}</span></div>
                <span class="status-tag" :class="selectedModel.configured ? 'ready' : 'offline'">
                  {{ selectedModel.configured ? '可用' : '需配置 Key' }}
                </span>
              </div>
            </template>
          </div>

          <div class="field-block">
            <label>生成方式</label>
            <div class="mode-selector">
              <button type="button" :class="{ active: generationMode === 'image-edit' }" :aria-pressed="generationMode === 'image-edit'" @click="generationMode = 'image-edit'">
                <span class="mode-icon">图</span>
                <div class="mode-copy">
  <div class="title">参考图生成</div>
  <div class="desc">上传商品图，保留主体并重构场景</div>
</div>
                <span class="mode-check">✓</span>
              </button>
              <button type="button" :class="{ active: generationMode === 'text-to-image' }" :aria-pressed="generationMode === 'text-to-image'" @click="generationMode = 'text-to-image'">
                <span class="mode-icon">文</span>
              <div class="mode-copy">
  <div class="title">文生图</div>
  <div class="desc">只输入文字，直接生成全新画面</div>
</div>
                <span class="mode-check">✓</span>
              </button>
            </div>
          </div>

          <div v-if="generationMode === 'image-edit'" class="field-block reference-block">
            <div class="label-row"><label>商品参考图</label><span>{{ uploads.length }}/{{ selectedModel?.maxReferenceImages || 0 }}</span></div>
            <div
              class="drop-zone"
              :class="{ dragging, compact: uploads.length > 0 }"
              @dragenter.prevent="dragging = true"
              @dragover.prevent="dragging = true"
              @dragleave.prevent="dragging = false"
              @drop.prevent="onDrop"
              @click="openFileDialog"
            >
              <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onFileChange" />
              <div class="upload-icon"><span></span></div>
              <strong>{{ uploads.length ? '继续添加参考图' : '拖拽或点击上传商品图' }}</strong>
              <small>JPG、PNG、WEBP，单张不超过 10MB</small>
            </div>
            <p v-if="uploads.length === 0" class="field-hint warning-hint">参考图生成模式至少需要上传 1 张图片。</p>
            <div v-if="uploads.length" class="upload-list">
              <div v-for="image in uploads" :key="image.id" class="upload-item">
                <img :src="image.dataUrl" :alt="image.name" />
                <div><strong>{{ image.name }}</strong><span>{{ formatBytes(image.size) }}</span></div>
                <button type="button" aria-label="删除图片" @click="removeUpload(image.id)">×</button>
              </div>
            </div>
          </div>

          <div v-else class="text-mode-tip">
            <span>✦</span>
            <div><strong>当前为文生图模式</strong><p>无需上传图片。建议选择明确的固定尺寸，再描述主体、场景、构图和光线。</p></div>
          </div>

          <div class="field-block">
            <div class="label-row"><label for="prompt">画面描述</label><span>{{ prompt.length }}/5000</span></div>
            <textarea ref="promptInput" id="prompt" v-model="prompt" maxlength="5000" rows="6" placeholder="描述商品、背景、构图、光线和需要保留的细节"></textarea>
            <div class="template-row">
              <button type="button" @click="useCustomPrompt">自定义</button>
              <button v-for="(template, index) in promptTemplates" :key="index" type="button" @click="useTemplate(template)">
                {{ ["高级棚拍", "科技首屏", "日式场景", "白底精修"][index] }}
              </button>
            </div>
          </div>

          <div v-if="selectedModel?.supportsNegativePrompt" class="field-block">
            <label for="negative-prompt">负面提示词</label>
            <input id="negative-prompt" v-model="negativePrompt" type="text" placeholder="不希望出现的内容" />
          </div>

          <div class="settings-grid" style="grid-template-columns: 1fr;">
            <div class="field-block size-block">
              <div class="label-row">
                <label>输出尺寸</label>
                <span v-if="generationMode === 'text-to-image' && outputSize === 'auto'">文生图建议选固定尺寸</span>
              </div>
              <div class="size-grid">
                <button
                  v-for="option in sizeOptions"
                  :key="option.value"
                  type="button"
                  class="size-card"
                  :class="{ active: outputSize === option.value }"
                  @click="outputSize = option.value"
                >
                  <span class="size-preview" :data-size="option.value"><i></i></span>
                  <span class="size-copy"><strong>{{ option.title }}</strong><small>{{ option.value === 'auto' ? 'AUTO' : option.value }}</small></span>
                  <span class="size-check">✓</span>
                </button>
              </div>
            </div>

                      </div>

          <div class="settings-grid small-settings">
            <div class="field-block">
              <label for="count">生成数量</label>
              <select id="count" v-model.number="count" class="select-control">
                <option v-for="item in selectedModel?.maxOutputImages || 1" :key="item" :value="item">{{ item }} 张</option>
              </select>
            </div>
            <div v-if="selectedModel?.supportsSeed" class="field-block">
              <label for="seed">随机种子</label>
              <input id="seed" v-model.number="seed" type="number" min="0" max="2147483647" placeholder="自动" />
            </div>
          </div>

          <button class="generate-button" type="button" :disabled="!canGenerate" @click="generate">
            <span v-if="loading" class="spinner"></span>
            <span v-else class="spark-icon">✦</span>
            {{ loading ? '正在生成商业视觉…' : '开始生成' }}
          </button>
        </section>

<div class="result-column">
        <section class="preview-panel panel">
          <div class="panel-heading preview-heading">
            <div>
              <span class="step-number">02</span>
              <div><h2>生成结果</h2><p>预览、比较并下载最终图片</p></div>
            </div>
            <div v-if="generationMeta" class="meta-row">
              <span>{{ (generationMeta.durationMs / 1000).toFixed(1) }}s</span>
              <span>{{ generationMeta.images.length }} 张</span>
              <span v-if="generationMeta.cost !== undefined">费用 {{ generationMeta.cost }}</span>
            </div>
          </div>

          <div v-if="loading" class="generation-stage loading-stage">
            <div class="orbital-loader"><span></span><span></span><span></span></div>
            <strong>模型正在构建商品场景</strong>
            <p>{{ pollingProgress || "正在分析商品结构、光线、材质和画面构图" }}</p>
            <div class="progress-track"><span></span></div>
          </div>

          <div v-else-if="results.length" class="result-gallery" :class="{ single: results.length === 1 }">
            <article v-for="(image, index) in results" :key="`${image.url.slice(0, 80)}-${index}`" class="result-card">
              <img :src="image.url" :alt="`生成结果 ${index + 1}`" @load="onResultImageLoad($event, index)" />
              <div class="result-actions">
                <div><strong>方案 {{ String(index + 1).padStart(2, '0') }}</strong><span>{{ resultDimensions[index] || selectedModel?.name }}</span></div>
                <button type="button" @click="downloadImage(image, index)">下载原图</button>
              </div>
            </article>
          </div>

          <div v-else class="generation-stage empty-stage">
            <div class="preview-art">
              <div class="art-glow one"></div><div class="art-glow two"></div>
              <div class="product-placeholder"><span>AI</span><small>PRODUCT VISUAL</small></div>
              <div class="floating-card card-one">主体保持</div>
              <div class="floating-card card-two">智能布光</div>
            </div>
            <strong>你的商品视觉将在这里呈现</strong>
            <p>左侧选择 API 服务商、上传商品图并填写画面描述，系统将自动返回最终结果。</p>
            <div class="empty-features">
              <span>✓ 双 API</span><span>✓ 文生图</span><span>✓ 高清下载</span>
            </div>
          </div>

          <div class="model-summary">
            <div><span>当前厂商</span><strong>{{ providerDisplayName(selectedModel?.provider, selectedModel?.providerName) }}</strong></div>
            <div><span>生成方式</span><strong>{{ generationMode === 'image-edit' ? '参考图生成' : '文生图' }}</strong></div>
            <div><span>输出规格</span><strong>{{ selectedSizeLabel }}</strong></div>
          </div>
        </section>

        <section class="history-panel panel">
        <div class="history-heading">
          <div>
            <span class="step-number">03</span>
            <div><h2>本机生成历史</h2><p>仅当前浏览器显示最近 20 条；所有记录由服务器完整归档</p></div>
          </div>
          <button v-if="localHistory.length" type="button" class="history-clear" @click="clearLocalHistory">清空本机</button>
        </div>

        <div v-if="localHistory.length" class="history-grid">
          <article v-for="record in localHistory" :key="record.id" class="history-card" :class="{ active: activeHistoryId === record.id }">
            <button type="button" class="history-thumb" @click="restoreHistory(record)">
              <img v-if="record.images[0]" :src="record.images[0].url" :alt="record.prompt" />
              <span v-if="record.images.length > 1">{{ record.images.length }} 张</span>
            </button>
            <div class="history-copy">
              <div class="history-meta">
                <strong>{{ providerDisplayName(record.provider, record.providerName) }} · {{ record.model }}</strong>
                <span>{{ formatHistoryDate(record.createdAt) }}</span>
              </div>
              <p>{{ record.prompt }}</p>
              <small>{{ record.operation === 'image-edit' ? '参考图生成' : '文生图' }} · {{ formatSizeTitle(record.size) }}</small>
            </div>
            <div class="history-actions">
              <button type="button" @click="restoreHistory(record)">恢复</button>
              <button type="button" class="danger" @click="deleteHistory(record)">从本机移除</button>
            </div>
          </article>
        </div>
        <div v-else class="history-empty">当前电脑还没有历史。下一次生成成功后会在本机保留最近 20 条，同时完整归档到服务器。</div>
      </section>
      </div>
    </div>
  </main>
  </div>
</template>

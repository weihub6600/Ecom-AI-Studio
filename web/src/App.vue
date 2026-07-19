<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { GeneratedImage, GenerationResult, ImageQuality, ModelCapability, OutputSize, UploadImage } from "./types";

const promptTemplates = [
  "为上传的商品生成高级简约电商主图，浅色摄影棚背景，柔和自然投影，保持商品外观、包装文字、Logo、颜色和结构完全不变，主体居中，商业产品摄影，高级质感。",
  "生成清爽蓝白科技风电商首屏，加入柔和渐变、透明玻璃平台和克制的光效，商品保持真实比例和包装细节，画面干净，适合品牌官网。",
  "生成日式生活方式场景，原木桌面、自然窗光和浅色背景，商品作为视觉中心，构图留白，保持商品标签和包装不变。",
  "生成纯白背景商品效果图，修正光线和阴影，去除杂乱背景，不改变商品本体、形状、文字和Logo，适合电商平台白底主图。"
];

const sizeOptions: Array<{ value: OutputSize; title: string }> = [
  { value: "auto", title: "自适应" },
  { value: "1024x1024", title: "正方形 1:1" },
  { value: "1024x1536", title: "竖版 2:3" },
  { value: "1536x1024", title: "横版 3:2" },
  { value: "960x1280", title: "竖版 3:4" },
  { value: "1280x960", title: "横版 4:3" }
];

const models = ref<ModelCapability[]>([]);
const selectedModelId = ref("gpt-image-2");
const prompt = ref(promptTemplates[0] ?? "");
const generationMode = ref<"text-to-image" | "image-edit">("text-to-image");
const negativePrompt = ref("模糊、变形、错误文字、重复商品、裁切商品、改变Logo、改变包装结构");
const outputSize = ref<OutputSize>("1024x1024");
const quality = ref<ImageQuality>("auto");
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

const selectedModel = computed(() => models.value.find((model) => model.id === selectedModelId.value) || models.value[0]);
const canGenerate = computed(() => Boolean(
  selectedModel.value?.configured &&
  prompt.value.trim().length >= 2 &&
  !loading.value &&
  (generationMode.value === "text-to-image" || uploads.value.length > 0)
));
const operationLabel = computed(() => generationMode.value === "image-edit" ? "参考图生成" : "文字生成图片");
const selectedSizeLabel = computed(() => sizeOptions.find((item) => item.value === outputSize.value)?.title || outputSize.value);

watch(selectedModel, (model) => {
  if (!model) return;
  if (!model.sizes.includes(outputSize.value)) outputSize.value = model.sizes[0] || "auto";
  if (!model.qualities.includes(quality.value)) quality.value = model.qualities[0] || "auto";
  count.value = Math.min(count.value, model.maxOutputImages);
  if (uploads.value.length > model.maxReferenceImages) uploads.value = uploads.value.slice(0, model.maxReferenceImages);
  if (!model.supportsSeed) seed.value = undefined;
  if (!model.supportsNegativePrompt) negativePrompt.value = "";
});

watch(generationMode, (mode) => {
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
  await loadModels();
});

async function loadModels() {
  modelLoading.value = true;
  errorMessage.value = "";
  try {
    const response = await fetch("/api/models");
    if (!response.ok) throw new Error("无法读取模型列表");
    const data = await response.json();
    models.value = data.models || [];
    selectedModelId.value = models.value[0]?.id || "gpt-image-2";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "服务端未启动";
  } finally {
    modelLoading.value = false;
  }
}

function openFileDialog() {
  fileInput.value?.click();
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  addFiles(input.files);
  input.value = "";
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  addFiles(event.dataTransfer?.files || null);
}

async function addFiles(fileList: FileList | null) {
  errorMessage.value = "";
  if (!fileList || !selectedModel.value) return;
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  const remaining = selectedModel.value.maxReferenceImages - uploads.value.length;

  for (const file of Array.from(fileList).slice(0, Math.max(0, remaining))) {
    if (!allowed.has(file.type)) {
      errorMessage.value = `不支持 ${file.name}，仅允许 JPG、PNG、WEBP`;
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      errorMessage.value = `${file.name} 超过 10MB`;
      continue;
    }
    const dataUrl = await readFile(file);
    uploads.value.push({
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      name: file.name,
      mimeType: file.type as UploadImage["mimeType"],
      dataUrl,
      size: file.size
    });
  }
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
        quality: quality.value,
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

    generationMeta.value = {
      ...result,
      durationMs: Date.now() - startedAt
    };
    results.value = result.images || [];
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
    link.download = `ecom-ai-${Date.now()}-${index + 1}.${extensionFromType(blob.type)}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(image.url, "_blank", "noopener,noreferrer");
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
        百嘉瑞AI 电商视觉工作台
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
          <p>基于百嘉瑞AI GPT Image 2。支持文生图与参考图生成。生成方式清晰分离，输出尺寸直接对应接口 size 参数。</p>
        </div>
        <div class="intro-stats">
          <div><strong>GPT Image 2</strong><span>当前模型</span></div>
          <div><strong>{{ selectedModel?.configured ? '已连接' : '待配置' }}</strong><span>百嘉瑞AI</span></div>
          <div><strong>6 档</strong><span>输出尺寸</span></div>
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
              <div><h2>创作设置</h2><p>配置百嘉瑞AI 并描述需要生成的画面</p></div>
            </div>
            <span class="operation-pill">{{ operationLabel }}</span>
          </div>

          <div class="field-block">
            <label>AI 模型</label>
            <div v-if="modelLoading" class="skeleton-input"></div>
            <div v-else-if="selectedModel" class="model-card" :class="{ disabled: !selectedModel.configured }">
              <div class="provider-symbol">百</div>
              <div class="model-copy"><strong>{{ selectedModel.providerName }} · {{ selectedModel.name }}</strong><span>{{ selectedModel.description }}</span></div>
              <span class="status-tag" :class="selectedModel.configured ? 'ready' : 'offline'">
                {{ selectedModel.configured ? '可用' : '需配置 Key' }}
              </span>
            </div>
          </div>

          <div class="field-block">
            <label>生成方式</label>
            <div class="mode-selector">
              <button type="button" :class="{ active: generationMode === 'image-edit' }" :aria-pressed="generationMode === 'image-edit'" @click="generationMode = 'image-edit'">
                <span class="mode-icon">图</span>
                <span class="mode-copy"><strong>参考图生成</strong><small>上传商品图，保留主体并重构场景</small></span>
                <span class="mode-check">✓</span>
              </button>
              <button type="button" :class="{ active: generationMode === 'text-to-image' }" :aria-pressed="generationMode === 'text-to-image'" @click="generationMode = 'text-to-image'">
                <span class="mode-icon">文</span>
                <span class="mode-copy"><strong>文生图</strong><small>只输入文字，直接生成全新画面</small></span>
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

          <div class="settings-grid">
            <div class="field-block size-block">
              <div class="label-row">
                <label>输出尺寸</label>
                <span v-if="generationMode === 'text-to-image' && outputSize === 'auto'">文生图建议选固定尺寸</span>
              </div>
              <div class="size-grid">
                <button
                  v-for="option in sizeOptions.filter((item) => selectedModel?.sizes.includes(item.value))"
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

            <div class="field-block">
              <label>生成质量</label>
              <div class="segmented">
                <button v-for="item in selectedModel?.qualities || []" :key="item" type="button" :class="{ active: quality === item }" @click="quality = item">
                  {{ item === 'auto' ? '自动' : item === 'high' ? '高' : item === 'medium' ? '中' : '低' }}
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
            <p>左侧上传商品图并填写画面描述，百嘉瑞AI 将异步生成并自动返回最终结果。</p>
            <div class="empty-features">
              <span>✓ 异步任务</span><span>✓ 文生图</span><span>✓ 高清下载</span>
            </div>
          </div>

          <div class="model-summary">
            <div><span>当前厂商</span><strong>{{ selectedModel?.providerName || '—' }}</strong></div>
            <div><span>生成方式</span><strong>{{ generationMode === 'image-edit' ? '参考图生成' : '文生图' }}</strong></div>
            <div><span>输出规格</span><strong>{{ selectedSizeLabel }} · {{ quality === 'auto' ? '自动' : quality === 'high' ? '高质量' : quality === 'medium' ? '中质量' : '低质量' }}</strong></div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import type { AuthUser, ModelCapability, OutputSize, ProviderId, UploadImage } from "../types";
import { displayProviderText, formatBytes, formatPoints, providerDisplayName } from "../utils/format";

interface ProviderOption { id: ProviderId; name: string }
interface SizeOption { value: OutputSize; title: string }

const selectedProviderId = defineModel<ProviderId>("selectedProviderId", { required: true });
const selectedModelId = defineModel<string>("selectedModelId", { required: true });
const generationMode = defineModel<"text-to-image" | "image-edit">("generationMode", { required: true });
const prompt = defineModel<string>("prompt", { required: true });
const negativePrompt = defineModel<string>("negativePrompt", { required: true });
const outputSize = defineModel<OutputSize>("outputSize", { required: true });
const count = defineModel<number>("count", { required: true });
const seed = defineModel<number | undefined>("seed");

const props = defineProps<{
  providers: ProviderOption[];
  availableModels: ModelCapability[];
  selectedModel?: ModelCapability;
  modelLoading: boolean;
  authUser: AuthUser | null;
  selectedUnitCreditCost: number;
  selectedCreditCost: number;
  hasEnoughCredits: boolean;
  uploads: UploadImage[];
  sizeOptions: SizeOption[];
  loading: boolean;
  canGenerate: boolean;
  isAuthenticated: boolean;
  operationLabel: string;
  providerSymbol: string;
  generationProgress: number;
  generationStatusText: string;
}>();

const emit = defineEmits<{
  filesSelected: [files: File[]];
  removeUpload: [id: string];
  generate: [];
  openUser: [];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const promptInput = ref<HTMLTextAreaElement | null>(null);
const dragging = ref(false);

interface PromptPreset {
  id: string;
  name: string;
  prompt: string;
}

const MAX_PROMPT_PRESETS = 7;
const PROMPT_PRESET_STORAGE_PREFIX = "ecom-ai-studio:prompt-presets:";
const promptPresets = ref<PromptPreset[]>([]);

onMounted(loadPromptPresets);

watch(
  () => props.authUser?.id,
  () => loadPromptPresets()
);

function promptPresetStorageKey(): string {
  return `${PROMPT_PRESET_STORAGE_PREFIX}${props.authUser?.id || "guest"}`;
}

function loadPromptPresets() {
  try {
    const raw = window.localStorage.getItem(promptPresetStorageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    promptPresets.value = Array.isArray(parsed)
      ? parsed
          .filter((item): item is PromptPreset => Boolean(
            item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            typeof item.prompt === "string" &&
            item.name.trim() &&
            item.prompt.trim()
          ))
          .slice(0, MAX_PROMPT_PRESETS)
      : [];
  } catch {
    promptPresets.value = [];
  }
}

function persistPromptPresets() {
  window.localStorage.setItem(
    promptPresetStorageKey(),
    JSON.stringify(promptPresets.value.slice(0, MAX_PROMPT_PRESETS))
  );
}

function createPresetId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function saveCurrentPrompt() {
  const value = prompt.value.trim();
  if (!value) {
    window.alert("请先填写提示词，再保存预设。");
    promptInput.value?.focus();
    return;
  }
  if (promptPresets.value.length >= MAX_PROMPT_PRESETS) {
    window.alert(`最多只能保存 ${MAX_PROMPT_PRESETS} 组预设提示词，请先删除一组。`);
    return;
  }

  const suggestedName = `预设 ${promptPresets.value.length + 1}`;
  const name = window.prompt("请输入预设名称（最多 20 个字符）", suggestedName)?.trim();
  if (!name) return;

  promptPresets.value = [
    ...promptPresets.value,
    {
      id: createPresetId(),
      name: name.slice(0, 20),
      prompt: value
    }
  ];
  persistPromptPresets();
}

function usePreset(preset: PromptPreset) {
  prompt.value = preset.prompt;
}

function deletePreset(preset: PromptPreset) {
  if (!window.confirm(`确定删除预设“${preset.name}”吗？`)) return;
  promptPresets.value = promptPresets.value.filter((item) => item.id !== preset.id);
  persistPromptPresets();
}

function openFileDialog() {
  fileInput.value?.click();
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  emit("filesSelected", files);
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  emit("filesSelected", Array.from(event.dataTransfer?.files || []));
}

async function useCustomPrompt() {
  prompt.value = "";
  await nextTick();
  promptInput.value?.focus();
}
</script>

<template>
  <section class="control-panel panel">
    <div class="panel-heading">
      <div>
        <span class="step-number">01</span>
        <div>
          <h2>创作设置</h2>
          <p>选择 API 服务商、模型并描述需要生成的画面</p>
        </div>
      </div>
      <span class="operation-pill">{{ props.operationLabel }}</span>
    </div>

    <div class="field-block provider-field">
      <label>API 服务商</label>
      <div class="segmented provider-segmented">
        <button
          v-for="provider in props.providers"
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
      <div v-if="props.modelLoading" class="skeleton-input"></div>

      <template v-else-if="props.selectedModel">
        <select
          v-if="props.availableModels.length > 1"
          id="model-select"
          v-model="selectedModelId"
          class="select-control"
        >
          <option v-for="model in props.availableModels" :key="model.id" :value="model.id">
            {{ model.name }}
          </option>
        </select>

        <div
          class="model-card selected"
          :class="{ disabled: !props.selectedModel.configured }"
          aria-label="当前选中的 AI 模型"
        >
          <div class="provider-symbol">{{ props.providerSymbol }}</div>
          <div class="model-copy">
            <strong>
              {{ providerDisplayName(props.selectedModel.provider, props.selectedModel.providerName) }}
              · {{ props.selectedModel.name }}
            </strong>
            <span>{{ displayProviderText(props.selectedModel.description) }}</span>
          </div>
          <span class="model-selected-check" aria-hidden="true">✓</span>
          <span class="status-tag" :class="props.selectedModel.configured ? 'ready' : 'offline'">
            {{ props.selectedModel.configured ? "已选 · 可用" : "已选 · 需配置 Key" }}
          </span>
        </div>
      </template>
    </div>

    <div
      v-if="props.authUser"
      class="generation-credit-bar"
      :class="{ insufficient: !props.hasEnoughCredits }"
    >
      <span>
        单张
        <strong>{{ props.authUser.role === "admin" ? "0" : formatPoints(props.selectedUnitCreditCost) }}</strong>
        积分
      </span>

      <label class="credit-count-control">
        <span>生成数量</span>
        <select v-model.number="count" aria-label="生成数量">
          <option
            v-for="item in props.selectedModel?.maxOutputImages || 1"
            :key="item"
            :value="item"
          >
            {{ item }} 张
          </option>
        </select>
      </label>

      <span>
        {{
          props.authUser.role === "admin"
            ? "站长账号不限积分"
            : `预计消耗 ${formatPoints(props.selectedCreditCost)}，剩余 ${formatPoints(props.authUser.credits)} 积分`
        }}
      </span>

      <button v-if="props.authUser.role !== 'admin'" type="button" @click="emit('openUser')">
        充值与明细
      </button>
    </div>

    <div class="field-block">
      <label>生成方式</label>
      <div class="mode-selector">
        <button
          type="button"
          :class="{ active: generationMode === 'image-edit' }"
          :aria-pressed="generationMode === 'image-edit'"
          @click="generationMode = 'image-edit'"
        >
          <span class="mode-icon">图</span>
          <div class="mode-copy">
            <div class="title">参考图生成</div>
            <div class="desc">上传商品图，保留主体并重构场景</div>
          </div>
          <span class="mode-check">✓</span>
        </button>

        <button
          type="button"
          :class="{ active: generationMode === 'text-to-image' }"
          :aria-pressed="generationMode === 'text-to-image'"
          @click="generationMode = 'text-to-image'"
        >
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
      <div class="label-row">
        <label>商品参考图</label>
        <span>{{ props.uploads.length }}/{{ props.selectedModel?.maxReferenceImages || 0 }}</span>
      </div>

      <div
        class="drop-zone"
        :class="{ dragging, compact: props.uploads.length > 0 }"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
        @click="openFileDialog"
      >
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          @change="onFileChange"
        />
        <div class="upload-icon"><span></span></div>
        <strong>{{ props.uploads.length ? "继续添加参考图" : "拖拽或点击上传商品图" }}</strong>
        <small>JPG、PNG、WEBP，单张不超过 10MB</small>
      </div>

      <p v-if="props.uploads.length === 0" class="field-hint warning-hint">
        参考图生成模式至少需要上传 1 张图片。
      </p>

      <div v-if="props.uploads.length" class="upload-list">
        <div v-for="image in props.uploads" :key="image.id" class="upload-item">
          <img :src="image.dataUrl" :alt="image.name" />
          <div>
            <strong>{{ image.name }}</strong>
            <span>{{ formatBytes(image.size) }}</span>
          </div>
          <button type="button" aria-label="删除图片" @click="emit('removeUpload', image.id)">×</button>
        </div>
      </div>
    </div>

    <div v-else class="text-mode-tip">
      <span>✦</span>
      <div>
        <strong>当前为文生图模式</strong>
        <p>无需上传图片。建议选择明确的固定尺寸，再描述主体、场景、构图和光线。</p>
      </div>
    </div>

    <div class="field-block">
      <div class="label-row">
        <label for="prompt">提示词</label>
        <span>{{ prompt.length }}/5000</span>
      </div>
      <textarea
        ref="promptInput"
        id="prompt"
        v-model="prompt"
        maxlength="5000"
        rows="6"
        placeholder="请输入提示词，例如主体、场景、构图、光线和必须保留的细节"
      ></textarea>

      <div class="template-row">
        <button type="button" @click="useCustomPrompt">清空提示词</button>
        <button
          type="button"
          :disabled="!prompt.trim() || promptPresets.length >= MAX_PROMPT_PRESETS"
          @click="saveCurrentPrompt"
        >
          保存为预设（{{ promptPresets.length }}/{{ MAX_PROMPT_PRESETS }}）
        </button>
        <button
          v-for="preset in promptPresets"
          :key="preset.id"
          type="button"
          :title="`点击使用；双击删除：${preset.name}`"
          @click="usePreset(preset)"
          @dblclick.prevent="deletePreset(preset)"
        >
          {{ preset.name }}
        </button>
      </div>
      <p v-if="promptPresets.length" class="field-hint">
        已保存的预设仅属于当前账号和当前浏览器；点击使用，双击删除。
      </p>
    </div>

    <div v-if="props.selectedModel?.supportsNegativePrompt" class="field-block">
      <label for="negative-prompt">负面提示词</label>
      <input
        id="negative-prompt"
        v-model="negativePrompt"
        type="text"
        placeholder="不希望出现的内容"
      />
    </div>

    <div class="settings-grid" style="grid-template-columns: 1fr;">
      <div class="field-block size-block">
        <div class="label-row">
          <label>输出尺寸</label>
          <span v-if="generationMode === 'text-to-image' && outputSize === 'auto'">
            文生图建议选固定尺寸
          </span>
        </div>

        <div class="size-grid">
          <button
            v-for="option in props.sizeOptions"
            :key="option.value"
            type="button"
            class="size-card"
            :class="{ active: outputSize === option.value }"
            :aria-pressed="outputSize === option.value"
            @click="outputSize = option.value"
          >
            <span class="size-preview" :data-size="option.value"><i></i></span>
            <span class="size-copy">
              <strong>{{ option.title }}</strong>
              <small>{{ option.value === "auto" ? "AUTO" : option.value }}</small>
            </span>
            <span class="size-check">✓</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="props.selectedModel?.supportsSeed" class="settings-grid small-settings">
      <div class="field-block">
        <label for="seed">随机种子</label>
        <input id="seed" v-model.number="seed" type="number" min="0" max="2147483647" placeholder="自动" />
      </div>
    </div>

    <div
      v-if="props.loading"
      class="generate-progress-card"
      role="status"
      aria-live="polite"
    >
      <div class="generate-progress-head">
        <span class="phase-pulse" aria-hidden="true"></span>
        <strong>{{ props.generationStatusText }}</strong>
        <span>{{ Math.round(props.generationProgress) }}%</span>
      </div>
      <div
        class="generate-progress-track"
        role="progressbar"
        aria-label="图片生成进度"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(props.generationProgress)"
      >
        <span :style="{ width: `${Math.round(props.generationProgress)}%` }"></span>
      </div>
    </div>

    <button
      class="generate-button"
      type="button"
      :disabled="!props.canGenerate"
      @click="emit('generate')"
    >
      <span v-if="props.loading" class="spinner"></span>
      <span v-else class="spark-icon">✦</span>
      {{
        props.loading
          ? props.generationStatusText
          : !props.isAuthenticated
            ? "登录后开始生成"
            : !props.hasEnoughCredits
              ? "积分不足，请先充值"
              : "开始生成"
      }}
    </button>
  </section>
</template>

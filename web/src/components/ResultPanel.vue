<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import type { GeneratedImage, GenerationResult, ModelCapability } from "../types";
import { providerDisplayName } from "../utils/format";

type GenerationPhase = "queue" | "analysis" | "creating" | "rendering" | "complete";

const props = defineProps<{
  loading: boolean;
  pollingProgress: string;
  generationProgress: number;
  generationPhase: GenerationPhase;
  generationStatusText: string;
  results: GeneratedImage[];
  resultDimensions: Record<number, string>;
  generationMeta: GenerationResult | null;
  selectedModel?: ModelCapability;
  generationMode: "text-to-image" | "image-edit";
  selectedSizeLabel: string;
  authenticated: boolean;
  historyCount: number;
  lightboxIndex: number | null;
}>();

const emit = defineEmits<{
  imageLoad: [event: Event, index: number];
  download: [image: GeneratedImage, index: number];
  downloadAll: [];
  showHistory: [];
  "update:lightbox-index": [value: number | null];
}>();

const phaseSteps: Array<{ id: Exclude<GenerationPhase, "complete">; label: string }> = [
  { id: "queue", label: "任务排队" },
  { id: "analysis", label: "素材分析" },
  { id: "creating", label: "AI 创作" },
  { id: "rendering", label: "成品渲染" }
];

const currentPhaseIndex = computed(() => {
  if (props.generationPhase === "complete") return phaseSteps.length;
  return Math.max(0, phaseSteps.findIndex((step) => step.id === props.generationPhase));
});

const lightboxImage = computed(() => {
  const index = props.lightboxIndex;
  return index === null ? undefined : props.results[index];
});

function phaseState(index: number) {
  return {
    active: props.generationPhase !== "complete" && index === currentPhaseIndex.value,
    complete: props.generationPhase === "complete" || index < currentPhaseIndex.value
  };
}

// Lightbox
function openLightbox(index: number) {
  emit("update:lightbox-index", index);
}
function closeLightbox() {
  emit("update:lightbox-index", null);
}
function navigateLightbox(direction: 1 | -1) {
  if (props.lightboxIndex === null) return;
  const newIndex = props.lightboxIndex + direction;
  if (newIndex >= 0 && newIndex < props.results.length) {
    emit("update:lightbox-index", newIndex);
  }
}
function handleLightboxKeydown(e: KeyboardEvent) {
  if (props.lightboxIndex === null) return;
  if (e.key === "Escape") { closeLightbox(); return; }
  if (e.key === "ArrowLeft") { navigateLightbox(-1); return; }
  if (e.key === "ArrowRight") { navigateLightbox(1); return; }
}
onMounted(() => window.addEventListener("keydown", handleLightboxKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleLightboxKeydown));
</script>

<template>
  <section id="result-panel" class="preview-panel panel">
    <div class="panel-heading preview-heading">
      <div>
        <span class="step-number">02</span>
        <div>
          <h2>生成结果</h2>
          <p>预览、比较并下载最终图片</p>
        </div>
      </div>

      <div class="panel-heading-actions">
        <div v-if="props.generationMeta" class="meta-row">
          <span>{{ (props.generationMeta.durationMs / 1000).toFixed(1) }}s</span>
          <span>{{ props.generationMeta.images.length }} 张</span>
          <span v-if="props.generationMeta.cost !== undefined">费用 {{ props.generationMeta.cost }}</span>
        </div>

        <button
          v-if="props.results.length > 1"
          type="button"
          class="section-jump-button"
          @click="emit('downloadAll')"
        >
          打包下载
        </button>

        <button
          v-if="props.authenticated"
          type="button"
          class="section-jump-button"
          aria-controls="history-panel"
          @click="emit('showHistory')"
        >
          查看历史 <span>{{ props.historyCount }}</span>
        </button>
      </div>
    </div>

    <div v-if="props.loading" class="generation-stage loading-stage">
      <div class="generation-progress-shell">
        <div class="ai-working-orb" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>

        <strong class="generation-progress-title">{{ props.generationStatusText }}</strong>
        <p class="generation-progress-detail">
          {{ props.pollingProgress || "系统正在连接图像模型并准备创作任务" }}
        </p>

        <div class="generation-phase-steps" aria-label="生成阶段">
          <div
            v-for="(step, index) in phaseSteps"
            :key="step.id"
            class="generation-phase-step"
            :class="phaseState(index)"
          >
            <span class="phase-dot">
              <span>{{ phaseState(index).complete ? "✓" : index + 1 }}</span>
            </span>
            <small>{{ step.label }}</small>
          </div>
        </div>

        <div class="stage-progress-head">
          <span>整体进度</span>
          <strong>{{ Math.round(props.generationProgress) }}%</strong>
        </div>

        <div
          class="stage-progress-track"
          role="progressbar"
          aria-label="图片生成整体进度"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(props.generationProgress)"
        >
          <span :style="{ width: `${Math.round(props.generationProgress)}%` }"></span>
        </div>

        <small class="stage-progress-caption" style="font-size: 14px; line-height: 1.7;">
          进度为服务商状态与前端阶段估算的综合展示，实际完成时间可能因队列和图片尺寸而变化。
        </small>
      </div>
    </div>

    <div
      v-else-if="props.results.length"
      class="result-gallery"
      :class="{ single: props.results.length === 1 }"
    >
      <article
        v-for="(image, index) in props.results"
        :key="`${image.url.slice(0, 80)}-${index}`"
        class="result-card"
        role="button"
        tabindex="0"
        @click="openLightbox(index)"
        @keydown.enter="openLightbox(index)"
      >
        <img
          :src="image.url"
          :alt="`生成结果 ${index + 1}`"
          @load="emit('imageLoad', $event, index)"
        />
        <div class="result-actions">
          <div>
            <strong>方案 {{ String(index + 1).padStart(2, "0") }}</strong>
            <span>{{ props.resultDimensions[index] || props.selectedModel?.name }}</span>
          </div>
          <button type="button" @click.stop="emit('download', image, index)">下载原图</button>
        </div>
      </article>
    </div>

    <div v-else class="generation-stage empty-stage">
      <div class="preview-art">
        <div class="art-glow one"></div>
        <div class="art-glow two"></div>
        <div class="product-placeholder"><span>AI</span><small>PRODUCT VISUAL</small></div>
        <div class="floating-card card-one">主体保持</div>
        <div class="floating-card card-two">智能布光</div>
      </div>
      <strong>你的商品视觉将在这里呈现</strong>
      <p>左侧选择 API 服务商、上传商品图并填写画面描述，系统将自动返回最终结果。</p>
      <div class="empty-features">
        <span>✓ 多模型</span><span>✓ 文生图</span><span>✓ 高清下载</span>
      </div>
    </div>

    <div class="model-summary">
      <div>
        <span>当前厂商</span>
        <strong>{{ providerDisplayName(props.selectedModel?.provider, props.selectedModel?.providerName) }}</strong>
      </div>
      <div>
        <span>生成方式</span>
        <strong>{{ props.generationMode === "image-edit" ? "参考图生成" : "文生图" }}</strong>
      </div>
      <div>
        <span>输出规格</span>
        <strong>{{ props.selectedSizeLabel }}</strong>
      </div>
    </div>

    <!-- Lightbox 放大预览 -->
    <Teleport to="body">
      <div
        v-if="props.lightboxIndex !== null && lightboxImage"
        class="lightbox-overlay"
        @click.self="closeLightbox"
      >
        <button class="lightbox-close" @click="closeLightbox" aria-label="关闭预览">&times;</button>
        <button
          v-if="props.lightboxIndex > 0"
          class="lightbox-nav lightbox-prev"
          @click.stop="navigateLightbox(-1)"
          aria-label="上一张"
        >&#8249;</button>
        <button
          v-if="props.lightboxIndex < props.results.length - 1"
          class="lightbox-nav lightbox-next"
          @click.stop="navigateLightbox(1)"
          aria-label="下一张"
        >&#8250;</button>
        <div class="lightbox-content">
          <img
            :src="lightboxImage.url"
            :alt="`生成结果 ${props.lightboxIndex + 1}`"
          />
          <div class="lightbox-info">
            <span>方案 {{ String(props.lightboxIndex + 1).padStart(2, "0") }} / {{ props.results.length }}</span>
            <span v-if="props.resultDimensions[props.lightboxIndex]">{{ props.resultDimensions[props.lightboxIndex] }}</span>
            <button type="button" @click="emit('download', lightboxImage, props.lightboxIndex)">下载原图</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

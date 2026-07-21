<script setup lang="ts">
import type { GeneratedImage, GenerationResult, ModelCapability } from "../types";
import { providerDisplayName } from "../utils/format";

const props = defineProps<{
  loading: boolean;
  pollingProgress: string;
  results: GeneratedImage[];
  resultDimensions: Record<number, string>;
  generationMeta: GenerationResult | null;
  selectedModel?: ModelCapability;
  generationMode: "text-to-image" | "image-edit";
  selectedSizeLabel: string;
}>();
const emit = defineEmits<{
  imageLoad: [event: Event, index: number];
  download: [image: GeneratedImage, index: number];
}>();
</script>

<template>
  <section class="preview-panel panel">
    <div class="panel-heading preview-heading">
      <div><span class="step-number">02</span><div><h2>生成结果</h2><p>预览、比较并下载最终图片</p></div></div>
      <div v-if="props.generationMeta" class="meta-row"><span>{{ (props.generationMeta.durationMs / 1000).toFixed(1) }}s</span><span>{{ props.generationMeta.images.length }} 张</span><span v-if="props.generationMeta.cost !== undefined">费用 {{ props.generationMeta.cost }}</span></div>
    </div>

    <div v-if="props.loading" class="generation-stage loading-stage"><div class="orbital-loader"><span></span><span></span><span></span></div><strong>模型正在构建商品场景</strong><p>{{ props.pollingProgress || '正在分析商品结构、光线、材质和画面构图' }}</p><div class="progress-track"><span></span></div></div>

    <div v-else-if="props.results.length" class="result-gallery" :class="{ single: props.results.length === 1 }">
      <article v-for="(image, index) in props.results" :key="`${image.url.slice(0, 80)}-${index}`" class="result-card"><img :src="image.url" :alt="`生成结果 ${index + 1}`" @load="emit('imageLoad', $event, index)" /><div class="result-actions"><div><strong>方案 {{ String(index + 1).padStart(2, '0') }}</strong><span>{{ props.resultDimensions[index] || props.selectedModel?.name }}</span></div><button type="button" @click="emit('download', image, index)">下载原图</button></div></article>
    </div>

    <div v-else class="generation-stage empty-stage"><div class="preview-art"><div class="art-glow one"></div><div class="art-glow two"></div><div class="product-placeholder"><span>AI</span><small>PRODUCT VISUAL</small></div><div class="floating-card card-one">主体保持</div><div class="floating-card card-two">智能布光</div></div><strong>你的商品视觉将在这里呈现</strong><p>左侧选择 API 服务商、上传商品图并填写画面描述，系统将自动返回最终结果。</p><div class="empty-features"><span>✓ 多模型</span><span>✓ 文生图</span><span>✓ 高清下载</span></div></div>

    <div class="model-summary"><div><span>当前厂商</span><strong>{{ providerDisplayName(props.selectedModel?.provider, props.selectedModel?.providerName) }}</strong></div><div><span>生成方式</span><strong>{{ props.generationMode === 'image-edit' ? '参考图生成' : '文生图' }}</strong></div><div><span>输出规格</span><strong>{{ props.selectedSizeLabel }}</strong></div></div>
  </section>
</template>

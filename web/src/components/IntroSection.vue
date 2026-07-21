<script setup lang="ts">
import type { ModelCapability } from "../types";
import { providerDisplayName } from "../utils/format";

defineProps<{ selectedModel?: ModelCapability }>();
</script>

<template>
  <section class="intro">
    <div>
      <span class="eyebrow">ECOMMERCE CREATIVE ENGINE</span>
      <h1>一张商品图，生成完整商业视觉</h1>
      <p>支持百嘉瑞AI、GPT 与 Nano Banana 多种图像模型，可根据画质、速度和积分价格灵活选择。</p>
    </div>
    <div class="intro-stats">
      <div><strong>{{ selectedModel?.name || '—' }}</strong><span>当前模型</span></div>
      <div><strong>{{ selectedModel?.configured ? '已连接' : '待配置' }}</strong><span>{{ providerDisplayName(selectedModel?.provider, selectedModel?.providerName) }}</span></div>
      <div><strong>{{ selectedModel?.sizes.length || 0 }} 档</strong><span>输出尺寸</span></div>
    </div>
  </section>
</template>

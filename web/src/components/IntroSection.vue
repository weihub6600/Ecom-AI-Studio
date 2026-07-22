<script setup lang="ts">
import type { ModelCapability } from "../types";
import { providerDisplayName } from "../utils/format";

const props = withDefaults(defineProps<{
  selectedModel?: ModelCapability;
  collapsible?: boolean;
  collapsed?: boolean;
}>(), {
  collapsible: false,
  collapsed: false
});

const emit = defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <section class="intro" :class="{ 'intro--collapsed': props.collapsed }">
    <template v-if="props.collapsed">
      <div class="intro-compact-copy">
        <span class="eyebrow">AI CREATIVE STUDIO</span>
        <div>
          <strong>电商商品图工作台</strong>
          <span>
            当前模型：{{ props.selectedModel?.name || "尚未加载" }} ·
            {{ providerDisplayName(props.selectedModel?.provider, props.selectedModel?.providerName) }}
          </span>
        </div>
      </div>

      <button
        type="button"
        class="intro-toggle"
        aria-expanded="false"
        aria-label="展开工作台介绍"
        @click="emit('toggle')"
      >
        展开介绍
      </button>
    </template>

    <template v-else>
      <div class="intro-copy">
        <span class="eyebrow">ECOMMERCE CREATIVE ENGINE</span>
        <h1>一张商品图，生成完整商业视觉</h1>
        <p>支持百嘉瑞AI、GPT 与 Nano Banana 多种图像模型，可根据画质、速度和积分价格灵活选择。</p>
      </div>

      <div class="intro-side">
        <button
          v-if="props.collapsible"
          type="button"
          class="intro-toggle"
          aria-expanded="true"
          aria-label="收起工作台介绍"
          @click="emit('toggle')"
        >
          收起介绍
        </button>

        <div class="intro-stats">
          <div><strong>{{ props.selectedModel?.name || "—" }}</strong><span>当前模型</span></div>
          <div>
            <strong>{{ props.selectedModel?.configured ? "已连接" : "待配置" }}</strong>
            <span>{{ providerDisplayName(props.selectedModel?.provider, props.selectedModel?.providerName) }}</span>
          </div>
          <div><strong>{{ props.selectedModel?.sizes.length || 0 }} 档</strong><span>输出尺寸</span></div>
        </div>
      </div>
    </template>
  </section>
</template>

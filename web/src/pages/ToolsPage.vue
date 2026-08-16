<script setup lang="ts">
import {
  computed,
  ref
} from "vue";
import PlatformShell from "../components/PlatformShell.vue";

type ToolCategory =
  | "all"
  | "ai"
  | "operation"
  | "batch";

const search = ref("");
const category = ref<ToolCategory>("all");

const tools = [
  {
    title: "AI 图片生成",
    description: "文生图、参考图生成与多模型图片创作。",
    category: "ai",
    badge: "已上线",
    href: "/workspace",
    mark: "图",
    ready: true
  },
  {
    title: "AI 优化提示词",
    description: "面向电商视觉任务优化生成指令。",
    category: "ai",
    badge: "已上线",
    href: "/workspace",
    mark: "词",
    ready: true
  },
  {
    title: "批量商品图",
    description: "多 SKU、模板、队列和批量生成结果管理。",
    category: "batch",
    badge: "已上线",
    href: "/batch",
    mark: "批",
    ready: true
  },
  {
    title: "作品整理",
    description: "文件夹、标签、收藏与批量资产整理。",
    category: "batch",
    badge: "已上线",
    href: "/library",
    mark: "库",
    ready: true
  },
  {
    title: "ROI 计算器",
    description: "计算广告投入产出、费比与目标回报。",
    category: "operation",
    badge: "规划中",
    href: "",
    mark: "R",
    ready: false
  },
  {
    title: "毛利计算器",
    description: "综合售价、采购、平台、物流等费用计算毛利。",
    category: "operation",
    badge: "规划中",
    href: "",
    mark: "利",
    ready: false
  },
  {
    title: "保本 ROI",
    description: "按商品利润结构倒推广告保本投产线。",
    category: "operation",
    badge: "规划中",
    href: "",
    mark: "保",
    ready: false
  },
  {
    title: "利润倒推",
    description: "从目标利润反算最低售价或最高推广成本。",
    category: "operation",
    badge: "规划中",
    href: "",
    mark: "算",
    ready: false
  },
  {
    title: "智能抠图",
    description: "商品主体提取与透明背景输出。",
    category: "ai",
    badge: "待接入 API",
    href: "",
    mark: "抠",
    ready: false
  },
  {
    title: "高清放大",
    description: "面向电商素材的高分辨率修复与放大。",
    category: "ai",
    badge: "待接入 API",
    href: "",
    mark: "清",
    ready: false
  }
] as const;

const categories = [
  { value: "all", label: "全部" },
  { value: "ai", label: "AI 创作" },
  { value: "operation", label: "电商运营" },
  { value: "batch", label: "生产与资产" }
] as const;

const filteredTools = computed(() => {
  const query = search.value.trim().toLowerCase();
  return tools.filter((tool) => {
    if (category.value !== "all" && tool.category !== category.value) return false;
    if (!query) return true;
    return `${tool.title} ${tool.description}`.toLowerCase().includes(query);
  });
});
</script>

<template>
  <PlatformShell
    title="工具中心"
    subtitle="AI 工具 · 电商运营计算 · 批量生产"
  >
    <section class="v15-tools-page">
      <div class="v15-tools-hero">
        <span>ECOMMERCE TOOL CENTER</span>
        <h1>一个工具中心，覆盖创作与运营。</h1>
        <p>
          AI 工具使用模型能力；ROI、毛利、保本投产等计算类工具后续将直接本地计算，不消耗 AI 积分。
        </p>
      </div>

      <div class="v15-tools-toolbar">
        <label>
          <span>⌕</span>
          <input v-model="search" type="search" placeholder="搜索工具，例如 ROI、毛利、批量商品图" />
        </label>
        <nav>
          <button
            v-for="item in categories"
            :key="item.value"
            type="button"
            :class="{ active: category === item.value }"
            @click="category = item.value"
          >
            {{ item.label }}
          </button>
        </nav>
      </div>

      <div class="v15-tools-grid">
        <component
          :is="tool.ready ? 'a' : 'article'"
          v-for="tool in filteredTools"
          :key="tool.title"
          class="v15-tools-card"
          :class="{ disabled: !tool.ready }"
          :href="tool.ready ? tool.href : undefined"
        >
          <span class="v15-tools-mark">{{ tool.mark }}</span>
          <div>
            <i>{{ tool.badge }}</i>
            <h2>{{ tool.title }}</h2>
            <p>{{ tool.description }}</p>
          </div>
          <b>{{ tool.ready ? '打开 →' : '敬请期待' }}</b>
        </component>
      </div>

      <div v-if="filteredTools.length === 0" class="v15-tools-empty">
        没有找到匹配工具。
      </div>
    </section>
  </PlatformShell>
</template>

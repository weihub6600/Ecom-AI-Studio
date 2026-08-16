<script setup lang="ts">
import {
  computed,
  onMounted,
  ref
} from "vue";
import AnnouncementBar from "./components/AnnouncementBar.vue";
import {
  ApiError,
  apiRequest
} from "./api/client";
import type {
  AuthUser
} from "./types";
import {
  formatPoints
} from "./utils/format";

const user = ref<AuthUser | null>(null);
const ready = ref(false);

const displayName = computed(() =>
  user.value?.nickname?.trim() ||
  user.value?.username ||
  ""
);

const capabilityCards = [
  {
    eyebrow: "AI VISUAL",
    title: "AI 视觉创作",
    description: "商品主图、场景图、参考图再创作与多模型图像生成。",
    href: "/workspace",
    action: "进入创作工作台",
    mark: "AI"
  },
  {
    eyebrow: "BATCH STUDIO",
    title: "批量生产",
    description: "面向多 SKU 的批量商品图任务、模板与队列式生产。",
    href: "/batch",
    action: "打开批量工作室",
    mark: "批"
  },
  {
    eyebrow: "ECOM TOOLS",
    title: "电商运营工具",
    description: "逐步加入 ROI、毛利、保本投产、利润倒推等运营计算工具。",
    href: "/tools",
    action: "浏览工具中心",
    mark: "算"
  }
] as const;

const quickTools = [
  { title: "商品主图", desc: "快速进入 AI 商品图创作", href: "/workspace", badge: "AI", mark: "主" },
  { title: "商品场景图", desc: "参考商品图生成营销场景", href: "/workspace", badge: "AI", mark: "景" },
  { title: "批量商品图", desc: "多 SKU 批量生成与任务管理", href: "/batch", badge: "HOT", mark: "批" },
  { title: "AI 优化提示词", desc: "优化电商视觉生成指令", href: "/workspace", badge: "AI", mark: "词" },
  { title: "ROI 计算器", desc: "广告投入与回报快速测算", href: "/tools", badge: "规划中", mark: "R" },
  { title: "毛利计算器", desc: "售价、成本与费用结构测算", href: "/tools", badge: "规划中", mark: "利" }
] as const;

onMounted(async () => {
  try {
    const result = await apiRequest<{ user: AuthUser }>("/api/auth/me");
    user.value = result.user;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      console.error("Load cover account error", error);
    }
    user.value = null;
  } finally {
    ready.value = true;
  }
});
</script>

<template>
  <div class="v15-home">
    <header class="v15-home-nav">
      <a class="v15-home-brand" href="/">
        <span>Z</span>
        <div>
          <strong>ZHE AI</strong>
          <small>ECOMMERCE AI STUDIO</small>
        </div>
      </a>

      <nav>
        <a href="/workspace">AI 创作</a>
        <a href="/batch">批量生产</a>
        <a href="/tools">工具中心</a>
        <a href="/gallery">灵感广场</a>
      </nav>

      <div class="v15-home-account">
        <template v-if="ready && user">
          <span>{{ formatPoints(user.credits) }} 积分</span>
          <a href="/account">{{ displayName || user.username }}</a>
        </template>
        <a v-else-if="ready" class="primary" href="/workspace">登录 / 注册</a>
        <span v-else class="v15-home-account-skeleton"></span>
      </div>
    </header>

    <AnnouncementBar />

    <main>
      <section class="v15-hero">
        <div class="v15-hero-aura one"></div>
        <div class="v15-hero-aura two"></div>

        <div class="v15-hero-copy">
          <span class="v15-kicker">AI × ECOMMERCE · VISUAL & OPERATIONS</span>
          <h1>
            从一张商品图开始，
            <em>完成你的电商创作。</em>
          </h1>
          <p>
            ZHE AI 将多模型图像生成、批量生产、作品资产与电商运营工具整合到同一个工作平台。
            首页负责发现能力，进入工作台后再专注完成任务。
          </p>
          <div class="v15-hero-actions">
            <a class="primary" href="/workspace">开始 AI 创作 <b>→</b></a>
            <a href="/tools">探索全部工具</a>
          </div>
          <div class="v15-hero-tags">
            <span>商品主图</span>
            <span>场景图</span>
            <span>批量商品图</span>
            <span>作品资产</span>
            <span>电商计算工具</span>
          </div>
        </div>

        <div class="v15-hero-board" aria-label="平台能力预览">
          <div class="v15-board-window">
            <header>
              <span></span><span></span><span></span>
              <strong>ZHE AI WORKSPACE</strong>
            </header>
            <div class="v15-board-body">
              <aside>
                <i>首</i><i class="active">创</i><i>批</i><i>库</i><i>工</i>
              </aside>
              <section>
                <div class="v15-board-title">
                  <small>AI CREATION</small>
                  <strong>今天想完成什么？</strong>
                </div>
                <div class="v15-board-prompt">
                  <span>+</span>
                  <p>上传商品图，描述你想要的画面、场景或营销目标...</p>
                </div>
                <div class="v15-board-row">
                  <div></div><div></div><div></div>
                </div>
                <button>开始创作 →</button>
              </section>
            </div>
          </div>
        </div>
      </section>

      <section class="v15-home-section v15-capability-section">
        <div class="v15-section-heading">
          <div>
            <span>ONE PLATFORM · MULTIPLE WORKFLOWS</span>
            <h2>从创作到运营，按任务进入</h2>
          </div>
          <p>不让用户先理解模型和参数，而是先选择想完成的工作。</p>
        </div>

        <div class="v15-capability-grid">
          <a
            v-for="item in capabilityCards"
            :key="item.title"
            :href="item.href"
            class="v15-capability-card"
          >
            <span class="v15-capability-mark">{{ item.mark }}</span>
            <small>{{ item.eyebrow }}</small>
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
            <strong>{{ item.action }} <b>→</b></strong>
          </a>
        </div>
      </section>

      <section class="v15-home-section">
        <div class="v15-section-heading compact">
          <div>
            <span>QUICK ACCESS</span>
            <h2>热门工具</h2>
          </div>
          <a href="/tools">查看工具中心 →</a>
        </div>

        <div class="v15-tool-grid">
          <a
            v-for="tool in quickTools"
            :key="tool.title"
            :href="tool.href"
            class="v15-tool-card"
          >
            <span class="v15-tool-mark">{{ tool.mark }}</span>
            <div>
              <h3>{{ tool.title }}</h3>
              <p>{{ tool.desc }}</p>
            </div>
            <i>{{ tool.badge }}</i>
          </a>
        </div>
      </section>

      <section class="v15-home-section v15-flow-section">
        <div class="v15-flow-copy">
          <span>BUILT FOR DAILY ECOMMERCE WORK</span>
          <h2>已有能力不重做，重新组织成真正的平台。</h2>
          <p>
            生成任务、批量工作室、作品库、灵感广场和服务商 API 继续复用现有稳定底层。
            V15 先解决“用户从哪里进入、如何找到能力、如何持续工作”的产品结构问题。
          </p>
          <a href="/workspace">进入工作台 →</a>
        </div>
        <div class="v15-flow-steps">
          <article><span>01</span><div><strong>发现</strong><small>封面与工具中心</small></div></article>
          <article><span>02</span><div><strong>创作</strong><small>AI 工作台</small></div></article>
          <article><span>03</span><div><strong>生产</strong><small>批量任务</small></div></article>
          <article><span>04</span><div><strong>沉淀</strong><small>作品与资产</small></div></article>
        </div>
      </section>

      <section class="v15-final-cta">
        <span>ZHE AI · ECOMMERCE CREATIVE PLATFORM</span>
        <h2>开始你的下一次电商创作</h2>
        <div>
          <a class="primary" href="/workspace">进入 AI 工作台</a>
          <a href="/batch">批量生产</a>
        </div>
      </section>
    </main>

    <footer class="v15-home-footer">
      <strong>ZHE AI</strong>
      <span>AI 电商视觉与运营工作平台</span>
      <nav>
        <a href="/workspace">创作</a>
        <a href="/tools">工具</a>
        <a href="/gallery">灵感</a>
        <a href="/account">账户</a>
      </nav>
    </footer>
  </div>
</template>

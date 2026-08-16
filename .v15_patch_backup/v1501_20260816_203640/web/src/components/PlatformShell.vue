<script setup lang="ts">
import {
  computed,
  onMounted,
  ref
} from "vue";
import {
  ApiError,
  apiRequest
} from "../api/client";
import type {
  AuthUser
} from "../types";
import {
  formatPoints
} from "../utils/format";

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
  }>(),
  {
    subtitle: ""
  }
);

const user = ref<AuthUser | null>(null);
const authReady = ref(false);

const navItems = [
  { href: "/", mark: "首", label: "首页" },
  { href: "/workspace", mark: "创", label: "AI 创作" },
  { href: "/batch", mark: "批", label: "批量工作室" },
  { href: "/library", mark: "库", label: "作品库" },
  { href: "/gallery", mark: "灵", label: "灵感广场" },
  { href: "/tasks", mark: "任", label: "任务中心" },
  { href: "/tools", mark: "工", label: "工具中心" }
] as const;

const pathname = computed(() =>
  normalizePath(window.location.pathname)
);

const displayName = computed(() =>
  user.value?.nickname?.trim() ||
  user.value?.username ||
  "访客"
);

onMounted(async () => {
  try {
    const result = await apiRequest<{
      user: AuthUser;
    }>("/api/auth/me");
    user.value = result.user;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      console.error("Load platform shell account error", error);
    }
    user.value = null;
  } finally {
    authReady.value = true;
  }
});

function isActive(href: string): boolean {
  const current = pathname.value;
  if (href === "/") return current === "/";
  return current === href || current.startsWith(`${href}/`);
}

function normalizePath(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed || "/";
}
</script>

<template>
  <div class="v15-shell">
    <aside class="v15-sidebar">
      <a class="v15-sidebar-brand" href="/" aria-label="ZHE AI 首页">
        <span>Z</span>
        <div>
          <strong>ZHE AI</strong>
          <small>ECOM WORKSPACE</small>
        </div>
      </a>

      <nav class="v15-sidebar-nav" aria-label="主导航">
        <a
          v-for="item in navItems"
          :key="item.href"
          :href="item.href"
          :class="{ active: isActive(item.href) }"
        >
          <span class="v15-nav-mark">{{ item.mark }}</span>
          <strong>{{ item.label }}</strong>
          <i v-if="isActive(item.href)"></i>
        </a>
      </nav>

      <div class="v15-sidebar-bottom">
        <a href="/account">
          <span class="v15-nav-mark">我</span>
          <strong>我的账户</strong>
        </a>
        <a v-if="user?.role === 'admin'" href="/admin">
          <span class="v15-nav-mark">管</span>
          <strong>站长后台</strong>
        </a>
      </div>
    </aside>

    <section class="v15-stage">
      <header class="v15-topbar">
        <div class="v15-topbar-copy">
          <span>ZHE AI</span>
          <div>
            <strong>{{ props.title }}</strong>
            <small v-if="props.subtitle">{{ props.subtitle }}</small>
          </div>
        </div>

        <div class="v15-topbar-actions">
          <a class="v15-topbar-link" href="/gallery">灵感</a>
          <a class="v15-topbar-link" href="/tools">工具</a>

          <a
            v-if="authReady && user"
            class="v15-account-chip"
            href="/account"
          >
            <span>{{ displayName.slice(0, 1).toUpperCase() }}</span>
            <div>
              <strong>{{ displayName }}</strong>
              <small>{{ formatPoints(user.credits) }} 积分</small>
            </div>
          </a>
          <a
            v-else-if="authReady"
            class="v15-login-chip"
            href="/workspace"
          >
            登录 / 注册
          </a>
          <span v-else class="v15-account-skeleton"></span>
        </div>
      </header>

      <main class="v15-content">
        <slot />
      </main>
    </section>
  </div>
</template>

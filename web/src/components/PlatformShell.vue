<script setup lang="ts">
import {
  computed,
  onMounted,
  ref
} from "vue";
import {
  FolderOpen,
  House,
  Images,
  Layers3,
  Lightbulb,
  ListTodo,
  Shield,
  Sparkles,
  Wrench
} from "@lucide/vue";
import {
  ApiError,
  apiRequest
} from "../api/client";
import type {
  AuthUser
} from "../types";
import PlatformAccountMenu from "./PlatformAccountMenu.vue";

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
  { href: "/", icon: House, label: "首页" },
  { href: "/workspace", icon: Sparkles, label: "AI 创作" },
  { href: "/batch", icon: Layers3, label: "批量工作室" },
  { href: "/library", icon: Images, label: "作品库" },
  { href: "/gallery", icon: Lightbulb, label: "灵感广场" },
  { href: "/tasks", icon: ListTodo, label: "任务中心" },
  { href: "/tools", icon: Wrench, label: "工具中心" }
] as const;

const pathname = computed(() =>
  normalizePath(window.location.pathname)
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
          :title="item.label"
        >
          <span class="v15-nav-icon">
            <component
              :is="item.icon"
              :size="20"
              :stroke-width="1.85"
            />
          </span>
          <strong>{{ item.label }}</strong>
          <i v-if="isActive(item.href)"></i>
        </a>
      </nav>

      <div class="v15-sidebar-bottom">
        <a href="/account" title="我的账户">
          <span class="v15-nav-icon">
            <FolderOpen :size="20" :stroke-width="1.85" />
          </span>
          <strong>我的账户</strong>
        </a>
        <a
          v-if="user?.role === 'admin'"
          href="/admin"
          title="站长后台"
        >
          <span class="v15-nav-icon">
            <Shield :size="20" :stroke-width="1.85" />
          </span>
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

        <nav class="v15-topbar-nav" aria-label="快捷导航">
          <a href="/workspace" :class="{ active: isActive('/workspace') }">
            <Sparkles :size="16" :stroke-width="1.85" />
            AI 创作
          </a>
          <a href="/batch" :class="{ active: isActive('/batch') }">
            <Layers3 :size="16" :stroke-width="1.85" />
            批量生产
          </a>
          <a href="/tools" :class="{ active: isActive('/tools') }">
            <Wrench :size="16" :stroke-width="1.85" />
            工具中心
          </a>
          <a href="/gallery" :class="{ active: isActive('/gallery') }">
            <Lightbulb :size="16" :stroke-width="1.85" />
            灵感广场
          </a>
        </nav>

        <div class="v15-topbar-actions">
          <PlatformAccountMenu
            v-if="authReady && user"
            :user="user"
          />
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

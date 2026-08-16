<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";
import {
  ChevronDown,
  Images,
  LayoutDashboard,
  LogOut,
  Shield,
  WalletCards
} from "@lucide/vue";
import {
  apiRequest
} from "../api/client";
import type {
  AuthUser
} from "../types";
import {
  formatPoints
} from "../utils/format";

const props = defineProps<{
  user: AuthUser;
}>();

const open = ref(false);
const loggingOut = ref(false);

const displayName = computed(() =>
  props.user.nickname?.trim() ||
  props.user.username
);

onMounted(() => {
  document.addEventListener(
    "click",
    closeMenu
  );

  window.addEventListener(
    "keydown",
    handleKeydown
  );
});

onBeforeUnmount(() => {
  document.removeEventListener(
    "click",
    closeMenu
  );

  window.removeEventListener(
    "keydown",
    handleKeydown
  );
});

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    open.value = false;
  }
}

function closeMenu() {
  open.value = false;
}

function toggleMenu() {
  open.value = !open.value;
}

async function logout() {
  if (loggingOut.value) return;

  loggingOut.value = true;

  try {
    await apiRequest<{ success: boolean }>(
      "/api/auth/logout",
      {
        method: "POST"
      }
    );
  } catch {
    // 即使网络响应异常，也跳回首页让登录态重新刷新。
  } finally {
    window.location.href = "/";
  }
}
</script>

<template>
  <div
    class="v15-account-menu-wrap"
    @click.stop
  >
    <button
      type="button"
      class="v15-account-trigger"
      :class="{ active: open }"
      aria-label="账户菜单"
      :aria-expanded="open"
      @click="toggleMenu"
    >
      <span class="v15-account-avatar">
        {{ props.user.username.slice(0, 1).toUpperCase() }}
      </span>

      <span class="v15-account-trigger-copy">
        <strong>{{ displayName }}</strong>
        <small>{{ formatPoints(props.user.credits) }} 积分</small>
      </span>

      <ChevronDown
        :size="16"
        :stroke-width="1.9"
        class="v15-account-chevron"
      />
    </button>

    <transition name="v15-account-pop">
      <section
        v-if="open"
        class="v15-account-popover"
      >
        <header>
          <span class="v15-account-profile-avatar">
            {{ props.user.username.slice(0, 1).toUpperCase() }}
          </span>

          <div>
            <strong>{{ displayName }}</strong>
            <small>
              {{ props.user.username }}
              <span>·</span>
              {{
                props.user.role === "admin"
                  ? "站长账号"
                  : `${formatPoints(props.user.credits)} 积分`
              }}
            </small>
          </div>
        </header>

        <nav>
          <a href="/account">
            <LayoutDashboard :size="18" :stroke-width="1.8" />
            <span>
              <strong>我的账户</strong>
              <small>个人资料、积分与消息</small>
            </span>
          </a>

          <a href="/library">
            <Images :size="18" :stroke-width="1.8" />
            <span>
              <strong>我的作品</strong>
              <small>作品库、收藏与文件夹</small>
            </span>
          </a>

          <a href="/account?tab=credits">
            <WalletCards :size="18" :stroke-width="1.8" />
            <span>
              <strong>积分明细</strong>
              <small>查看余额与使用记录</small>
            </span>
          </a>

          <a
            v-if="props.user.role === 'admin'"
            href="/admin"
          >
            <Shield :size="18" :stroke-width="1.8" />
            <span>
              <strong>站长后台</strong>
              <small>用户、模型与系统管理</small>
            </span>
          </a>
        </nav>

        <button
          type="button"
          class="v15-account-logout"
          :disabled="loggingOut"
          @click="logout"
        >
          <LogOut :size="17" :stroke-width="1.8" />
          <span>{{ loggingOut ? "正在退出..." : "退出登录" }}</span>
        </button>
      </section>
    </transition>
  </div>
</template>

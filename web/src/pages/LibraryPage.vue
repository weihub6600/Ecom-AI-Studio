<script setup lang="ts">
import {
  onMounted,
  ref
} from "vue";
import PlatformShell from "../components/PlatformShell.vue";
import WorkLibrary from "../components/WorkLibrary.vue";
import {
  ApiError,
  apiRequest
} from "../api/client";
import type {
  AuthUser
} from "../types";

const user = ref<AuthUser | null>(null);
const ready = ref(false);

onMounted(async () => {
  try {
    const result = await apiRequest<{ user: AuthUser }>("/api/auth/me");
    user.value = result.user;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      console.error("Load library page account error", error);
    }
    user.value = null;
  } finally {
    ready.value = true;
  }
});
</script>

<template>
  <PlatformShell
    title="作品库"
    subtitle="作品 · 收藏 · 文件夹 · 标签 · 回收站"
  >
    <section v-if="ready && user" class="v15-page-surface v15-library-surface">
      <WorkLibrary :user-id="user.id" />
    </section>

    <section v-else-if="ready" class="v15-login-required">
      <span>库</span>
      <h2>登录后查看作品资产</h2>
      <p>你的生成结果、收藏、文件夹和标签都与账号关联。</p>
      <a href="/workspace">前往登录</a>
    </section>

    <section v-else class="v15-page-loading">正在加载作品库...</section>
  </PlatformShell>
</template>

<script setup lang="ts">
import {
  onMounted,
  ref
} from "vue";
import PlatformShell from "../components/PlatformShell.vue";
import BatchStudio from "../components/BatchStudio.vue";
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
      console.error("Load batch page account error", error);
    }
    user.value = null;
  } finally {
    ready.value = true;
  }
});

function handleBalanceUpdated(credits: number) {
  if (!user.value) return;
  user.value = {
    ...user.value,
    credits
  };
}
</script>

<template>
  <PlatformShell
    title="批量工作室"
    subtitle="多 SKU · 批次模板 · 队列任务 · 批量结果"
  >
    <section v-if="ready && user" class="v15-page-surface v15-batch-surface">
      <BatchStudio
        :user="user"
        @balance-updated="handleBalanceUpdated"
      />
    </section>

    <section v-else-if="ready" class="v15-login-required">
      <span>批</span>
      <h2>登录后使用批量工作室</h2>
      <p>批量任务会绑定账号、积分、模板与生成历史，请先进入 AI 工作台完成登录。</p>
      <a href="/workspace">前往登录</a>
    </section>

    <section v-else class="v15-page-loading">正在加载批量工作室...</section>
  </PlatformShell>
</template>

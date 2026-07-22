<script setup lang="ts">
import type { AuthUser } from "../types";
import { formatPoints } from "../utils/format";

const props = defineProps<{
  authReady: boolean;
  user: AuthUser | null;
}>();

const emit = defineEmits<{
  login: [];
  register: [];
  openUser: [];
  openAdmin: [];
  logout: [];
}>();
</script>

<template>
  <header class="topbar">
    <a class="brand" href="#" aria-label="BJR AI Studio 首页">
      <span class="brand-mark"><span></span><span></span></span>
      <span><strong>BJR AI</strong><small>STUDIO</small></span>
    </a>

    <div class="topbar-center">
      <span class="live-dot"></span>
      BJR AI 双引擎电商视觉工作台
    </div>

    <div class="topbar-actions">
      <span class="mode-badge">BJR 0.1</span>

      <template v-if="props.authReady">
        <template v-if="props.user">
          <span class="auth-user-chip">
            <span>{{ props.user.username.slice(0, 1).toUpperCase() }}</span>
            <b>{{ props.user.username }}</b>
            <small>{{ props.user.role === "admin" ? "不限积分" : `${formatPoints(props.user.credits)} 积分` }}</small>
          </span>
          <button type="button" class="auth-top-button account" @click="emit('openUser')">我的后台</button>
          <button v-if="props.user.role === 'admin'" type="button" class="auth-top-button admin" @click="emit('openAdmin')">站长后台</button>
          <button type="button" class="auth-top-button ghost" @click="emit('logout')">退出</button>
        </template>

        <template v-else>
          <button type="button" class="auth-top-button ghost" @click="emit('login')">登录</button>
          <button type="button" class="auth-top-button primary" @click="emit('register')">注册</button>
        </template>
      </template>

      <a class="github-link" href="https://517zhe.com/" target="_blank" rel="noopener noreferrer">517ZHE</a>
    </div>
  </header>
</template>

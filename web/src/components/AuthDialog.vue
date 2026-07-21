<script setup lang="ts">
import { ref, watch } from "vue";
import { apiRequest, jsonRequest } from "../api/client";
import type { AuthUser } from "../types";

const mode = defineModel<"login" | "register">("mode", { required: true });
const emit = defineEmits<{
  close: [];
  authenticated: [user: AuthUser];
}>();

const username = ref("");
const password = ref("");
const passwordConfirm = ref("");
const errorMessage = ref("");
const successMessage = ref("");
const submitting = ref(false);

watch(mode, resetMessages);

function resetMessages() {
  errorMessage.value = "";
  successMessage.value = "";
  password.value = "";
  passwordConfirm.value = "";
}

function close() {
  if (!submitting.value) emit("close");
}

async function submit() {
  errorMessage.value = "";
  successMessage.value = "";
  const normalizedUsername = username.value.trim();
  if (normalizedUsername.length < 2) {
    errorMessage.value = "用户名至少需要 2 位";
    return;
  }
  if (password.value.length < 8) {
    errorMessage.value = "密码至少需要 8 位";
    return;
  }
  if (mode.value === "register" && password.value !== passwordConfirm.value) {
    errorMessage.value = "两次输入的密码不一致";
    return;
  }

  submitting.value = true;
  try {
    const data = await apiRequest<{ user: AuthUser; pending?: boolean }>(
      `/api/auth/${mode.value}`,
      jsonRequest({ username: normalizedUsername, password: password.value })
    );
    if (mode.value === "register" && data.pending) {
      successMessage.value = "注册申请已提交，请等待站长审核。审核通过后再使用该账号登录。";
      mode.value = "login";
      password.value = "";
      passwordConfirm.value = "";
      return;
    }
    emit("authenticated", data.user);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "操作失败，请稍后重试";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="auth-overlay" @click.self="close">
    <section class="auth-dialog" role="dialog" aria-modal="true" :aria-label="mode === 'login' ? '用户登录' : '用户注册'">
      <button type="button" class="auth-dialog-close" aria-label="关闭" @click="close">×</button>
      <div class="auth-dialog-brand">
        <span class="brand-mark"><span></span><span></span></span>
        <div><strong>BJR AI</strong><small>ACCOUNT</small></div>
      </div>
      <h2>{{ mode === 'login' ? '欢迎回来' : '创建账号' }}</h2>
      <p>{{ mode === 'login' ? '只有审核通过的账号才能登录并使用 AI 生图。' : '提交注册申请后，需要等待站长审核通过。' }}</p>

      <div class="auth-tabs">
        <button type="button" :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button type="button" :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label><span>用户名</span><input v-model="username" type="text" autocomplete="username" minlength="2" maxlength="32" placeholder="2–32 位中文、字母、数字或下划线" /></label>
        <label><span>密码</span><input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" maxlength="128" placeholder="至少 8 位" /></label>
        <label v-if="mode === 'register'"><span>确认密码</span><input v-model="passwordConfirm" type="password" autocomplete="new-password" maxlength="128" placeholder="再次输入密码" /></label>
        <div v-if="successMessage" class="auth-form-success">{{ successMessage }}</div>
        <div v-if="errorMessage" class="auth-form-error">{{ errorMessage }}</div>
        <button type="submit" class="auth-submit" :disabled="submitting">
          <span v-if="submitting" class="spinner"></span>
          {{ submitting ? '正在提交…' : mode === 'login' ? '登录并进入工作台' : '提交注册申请' }}
        </button>
      </form>
    </section>
  </div>
</template>

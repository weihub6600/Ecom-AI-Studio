<script setup lang="ts">
import {
  onMounted,
  ref,
  watch
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";
import type {
  AuthUser
} from "../types";

interface CaptchaPayload {
  captcha: {
    id: string;
    imageUrl: string;
    expiresAt: string;
  };
}

interface RegistrationPolicyPayload {
  registration: {
    requiresApproval: boolean;
    updatedAt: string;
  };
}

const mode =
  defineModel<
    "login" |
    "register"
  >(
    "mode",
    {
      required: true
    }
  );

const emit =
  defineEmits<{
    close: [];
    authenticated: [
      user: AuthUser
    ];
  }>();

const username =
  ref("");

const password =
  ref("");

const passwordConfirm =
  ref("");

const captchaId =
  ref("");

const captchaImageUrl =
  ref("");

const captchaAnswer =
  ref("");

const captchaLoading =
  ref(false);

const registrationRequiresApproval =
  ref(true);

const policyLoading =
  ref(false);

const errorMessage =
  ref("");

const successMessage =
  ref("");

const submitting =
  ref(false);

watch(
  mode,
  async () => {
    resetMessages();
    await loadCaptcha();
  }
);

onMounted(async () => {
  await Promise.all([
    loadCaptcha(),
    loadRegistrationPolicy()
  ]);
});

function resetMessages() {
  errorMessage.value = "";
  successMessage.value = "";
  password.value = "";
  passwordConfirm.value = "";
  captchaAnswer.value = "";
}

function close() {
  if (!submitting.value) {
    emit("close");
  }
}


async function loadRegistrationPolicy() {
  if (policyLoading.value) {
    return;
  }

  policyLoading.value = true;

  try {
    const data =
      await apiRequest<
        RegistrationPolicyPayload
      >(
        "/api/auth/registration-policy"
      );

    registrationRequiresApproval.value =
      data.registration
        .requiresApproval;
  }
  catch {
    // 安全默认：读取失败时继续要求站长审核。
    registrationRequiresApproval.value =
      true;
  }
  finally {
    policyLoading.value = false;
  }
}

async function loadCaptcha() {
  if (captchaLoading.value) {
    return;
  }

  captchaLoading.value = true;
  captchaAnswer.value = "";

  try {
    const data =
      await apiRequest<
        CaptchaPayload
      >(
        "/api/auth/captcha"
      );

    captchaId.value =
      data.captcha.id;

    captchaImageUrl.value =
      data.captcha.imageUrl;
  }
  catch (error) {
    captchaId.value = "";
    captchaImageUrl.value = "";

    errorMessage.value =
      error instanceof Error
        ? error.message
        : "验证码加载失败，请稍后重试";
  }
  finally {
    captchaLoading.value = false;
  }
}

async function submit() {
  errorMessage.value = "";
  successMessage.value = "";

  const normalizedUsername =
    username.value.trim();

  const normalizedCaptcha =
    captchaAnswer.value
      .trim()
      .toUpperCase();

  if (
    normalizedUsername.length <
      2
  ) {
    errorMessage.value =
      "用户名至少需要 2 位";

    return;
  }

  if (
    password.value.length <
      8
  ) {
    errorMessage.value =
      "密码至少需要 8 位";

    return;
  }

  if (
    mode.value ===
      "register" &&
    password.value !==
      passwordConfirm.value
  ) {
    errorMessage.value =
      "两次输入的密码不一致";

    return;
  }

  if (
    !captchaId.value ||
    normalizedCaptcha.length <
      4
  ) {
    errorMessage.value =
      "请输入图片中的验证码";

    return;
  }

  submitting.value = true;

  try {
    const data =
      await apiRequest<{
        user: AuthUser;
        pending?: boolean;
      }>(
        `/api/auth/${mode.value}`,
        jsonRequest({
          username:
            normalizedUsername,
          password:
            password.value,
          captchaId:
            captchaId.value,
          captchaAnswer:
            normalizedCaptcha
        })
      );

    if (
      mode.value ===
        "register" &&
      data.pending
    ) {
      mode.value = "login";
      password.value = "";
      passwordConfirm.value = "";

      await loadCaptcha();

      successMessage.value =
        "注册申请已提交，请等待站长审核。审核通过后再使用该账号登录。";

      return;
    }

    emit(
      "authenticated",
      data.user
    );
  }
  catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "操作失败，请稍后重试";

    await loadCaptcha();
  }
  finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="auth-overlay"
    @click.self="close"
  >
    <section
      class="auth-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="mode === 'login'
        ? '用户登录'
        : '用户注册'"
    >
      <button
        type="button"
        class="auth-dialog-close"
        aria-label="关闭"
        @click="close"
      >
        ×
      </button>

      <div class="auth-dialog-brand">
        <span class="brand-mark">
          <span></span>
          <span></span>
        </span>

        <div>
          <strong>ZHE AI</strong>
          <small>ACCOUNT</small>
        </div>
      </div>

      <h2>
        {{
          mode === "login"
            ? "欢迎回来"
            : "创建账号"
        }}
      </h2>

      <p>
        {{
          mode === "login"
            ? "只有审核通过的账号才能登录并使用 AI 生图。"
            : registrationRequiresApproval
              ? "提交注册申请后，需要等待站长审核通过。"
              : "注册成功后账号会立即启用，并自动进入工作台。"
        }}
      </p>

      <div class="auth-tabs">
        <button
          type="button"
          :class="{
            active:
              mode === 'login'
          }"
          @click="mode = 'login'"
        >
          登录
        </button>

        <button
          type="button"
          :class="{
            active:
              mode === 'register'
          }"
          @click="mode = 'register'"
        >
          注册
        </button>
      </div>

      <form
        class="auth-form"
        @submit.prevent="submit"
      >
        <label>
          <span>用户名</span>

          <input
            v-model="username"
            type="text"
            autocomplete="username"
            minlength="2"
            maxlength="32"
            placeholder="2–32 位中文、字母、数字或下划线"
          />
        </label>

        <label>
          <span>密码</span>

          <input
            v-model="password"
            type="password"
            :autocomplete="mode === 'login'
              ? 'current-password'
              : 'new-password'"
            maxlength="128"
            placeholder="至少 8 位"
          />
        </label>

        <label
          v-if="mode === 'register'"
        >
          <span>确认密码</span>

          <input
            v-model="passwordConfirm"
            type="password"
            autocomplete="new-password"
            maxlength="128"
            placeholder="再次输入密码"
          />
        </label>

        <label class="auth-captcha-label">
          <span>验证码</span>

          <div class="auth-captcha-control">
            <input
              v-model="captchaAnswer"
              type="text"
              autocomplete="off"
              inputmode="text"
              maxlength="5"
              placeholder="输入图中字符"
            />

            <button
              type="button"
              class="auth-captcha-image"
              :disabled="captchaLoading"
              title="点击刷新验证码"
              aria-label="点击刷新验证码"
              @click="loadCaptcha"
            >
              <img
                v-if="captchaImageUrl"
                :src="captchaImageUrl"
                alt="图形验证码，点击可刷新"
              />

              <span v-else>
                {{
                  captchaLoading
                    ? "加载中…"
                    : "点击获取"
                }}
              </span>
            </button>
          </div>

          <small>
            不区分大小写，点击图片可更换一张
          </small>
        </label>

        <div
          v-if="successMessage"
          class="auth-form-success"
        >
          {{ successMessage }}
        </div>

        <div
          v-if="errorMessage"
          class="auth-form-error"
        >
          {{ errorMessage }}
        </div>

        <button
          type="submit"
          class="auth-submit"
          :disabled="
            submitting ||
            captchaLoading
          "
        >
          <span
            v-if="submitting"
            class="spinner"
          ></span>

          {{
            submitting
              ? "正在提交…"
              : mode === "login"
                ? "登录并进入工作台"
                : registrationRequiresApproval
                  ? "提交注册申请"
                  : "注册并进入工作台"
          }}
        </button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.auth-captcha-label {
  display: grid;
  gap: 7px;
}

.auth-captcha-control {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr)
    156px;
  gap: 10px;
  align-items: stretch;
}

.auth-captcha-control input {
  min-width: 0;
  text-transform: uppercase;
  letter-spacing: .12em;
}

.auth-captcha-image {
  height: 48px;
  padding: 0;
  overflow: hidden;
  border: 1px solid #dddfea;
  border-radius: 10px;
  background:
    linear-gradient(
      135deg,
      #f8f7ff,
      #eef8ff
    );
  color: #6254c9;
  font-size: 12px;
  font-weight: 800;
  transition:
    border-color .18s ease,
    box-shadow .18s ease,
    transform .18s ease;
}

.auth-captcha-image:hover:not(:disabled) {
  border-color: #a99fee;
  box-shadow:
    0 8px 18px
    rgba(86, 72, 184, .12);
  transform: translateY(-1px);
}

.auth-captcha-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
}

.auth-captcha-label > small {
  color: #9295a6;
  font-size: 10px;
  line-height: 1.5;
}

@media (max-width: 520px) {
  .auth-captcha-control {
    grid-template-columns:
      minmax(0, 1fr)
      132px;
  }
}
</style>

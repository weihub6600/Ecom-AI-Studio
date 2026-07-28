<script setup lang="ts">
import {
  onMounted,
  ref
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";

interface RegistrationSettings {
  requiresApproval: boolean;
  updatedAt: string;
}

const loading =
  ref(true);

const saving =
  ref(false);

const requiresApproval =
  ref(true);

const errorMessage =
  ref("");

const successMessage =
  ref("");

onMounted(loadSettings);

async function loadSettings() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<{
        registration:
          RegistrationSettings;
      }>(
        "/api/admin/registration-settings"
      );

    requiresApproval.value =
      data.registration
        .requiresApproval;
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "读取注册审核设置失败"
      );
  }
  finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const data =
      await apiRequest<{
        registration:
          RegistrationSettings;
      }>(
        "/api/admin/registration-settings",
        jsonRequest({
          requiresApproval:
            requiresApproval.value
        }, "PATCH")
      );

    requiresApproval.value =
      data.registration
        .requiresApproval;

    successMessage.value =
      requiresApproval.value
        ? "已开启注册审核：新账号注册后进入待审核状态"
        : "已关闭注册审核：新账号注册后将直接启用";
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "保存注册审核设置失败"
      );
  }
  finally {
    saving.value = false;
  }
}

function messageOf(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error
    ? error.message
    : fallback;
}
</script>

<template>
  <article class="registration-setting-card">
    <div class="registration-setting-copy">
      <span>REGISTRATION POLICY</span>

      <h2>新用户注册审核</h2>

      <p>
        {{
          requiresApproval
            ? "当前开启：新账号注册成功后进入待审核状态，需要站长手动启用。"
            : "当前关闭：新账号通过验证码并注册后，立即启用并自动登录。"
        }}
      </p>

      <small>
        修改只影响开关保存后的新注册用户；
        已经待审核的账号不会被自动放行。
      </small>
    </div>

    <div class="registration-setting-control">
      <label
        class="registration-switch"
        :class="{
          enabled:
            requiresApproval
        }"
      >
        <input
          v-model="requiresApproval"
          type="checkbox"
          :disabled="
            loading ||
            saving
          "
        />

        <span>
          <i></i>
        </span>

        <strong>
          {{
            requiresApproval
              ? "需要审核"
              : "直接启用"
          }}
        </strong>
      </label>

      <button
        type="button"
        :disabled="
          loading ||
          saving
        "
        @click="saveSettings"
      >
        {{
          saving
            ? "保存中…"
            : "保存开关"
        }}
      </button>
    </div>

    <p
      v-if="successMessage"
      class="registration-setting-message success"
    >
      {{ successMessage }}
    </p>

    <p
      v-if="errorMessage"
      class="registration-setting-message error"
    >
      {{ errorMessage }}
    </p>
  </article>
</template>

<style scoped>
.registration-setting-card {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr)
    auto;
  align-items: center;
  gap: 22px;
  margin-bottom: 18px;
  padding: 21px 23px;
  border: 1px solid #dfe2ee;
  border-radius: 17px;
  background:
    linear-gradient(
      135deg,
      #ffffff,
      #f6f4ff
    );
  box-shadow:
    0 12px 32px
    rgba(61, 57, 107, .06);
}

.registration-setting-copy > span {
  color: #6c59d4;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .15em;
}

.registration-setting-copy h2 {
  margin: 5px 0 0;
  color: #303445;
  font-size: 20px;
}

.registration-setting-copy p {
  margin: 7px 0 0;
  color: #666d80;
  font-size: 13px;
  line-height: 1.65;
}

.registration-setting-copy small {
  display: block;
  margin-top: 5px;
  color: #9297a7;
  font-size: 11px;
  line-height: 1.6;
}

.registration-setting-control {
  display: flex;
  align-items: center;
  gap: 11px;
}

.registration-switch {
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
}

.registration-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.registration-switch > span {
  position: relative;
  width: 52px;
  height: 29px;
  border-radius: 999px;
  background: #c9ced9;
  transition:
    background .18s ease;
}

.registration-switch > span i {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 23px;
  height: 23px;
  border-radius: 50%;
  background: #fff;
  box-shadow:
    0 2px 7px
    rgba(40, 45, 70, .18);
  transition:
    transform .18s ease;
}

.registration-switch.enabled > span {
  background: #6655d6;
}

.registration-switch.enabled > span i {
  transform:
    translateX(23px);
}

.registration-switch strong {
  min-width: 58px;
  color: #555d70;
  font-size: 12px;
}

.registration-setting-control button {
  min-height: 41px;
  padding: 0 15px;
  border: 0;
  border-radius: 10px;
  background: #6554d4;
  color: #fff;
  font-size: 12px;
  font-weight: 850;
}

.registration-setting-control button:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.registration-setting-message {
  grid-column: 1 / -1;
  margin: 0;
  padding: 10px 12px;
  border-radius: 9px;
  font-size: 12px;
}

.registration-setting-message.success {
  background: #ecf9f1;
  color: #26724d;
}

.registration-setting-message.error {
  background: #fff0f0;
  color: #a44242;
}

@media (max-width: 800px) {
  .registration-setting-card {
    grid-template-columns:
      1fr;
  }

  .registration-setting-control {
    justify-content:
      space-between;
  }
}

@media (max-width: 520px) {
  .registration-setting-control {
    align-items:
      stretch;
    flex-direction:
      column;
  }

  .registration-switch {
    justify-content:
      space-between;
  }
}
</style>

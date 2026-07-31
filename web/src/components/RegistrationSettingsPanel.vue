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
  registrationBonusEnabled: boolean;
  registrationBonusPoints: number;
  updatedAt: string;
}

const loading = ref(true);
const saving = ref(false);
const requiresApproval = ref(true);
const registrationBonusEnabled = ref(false);
const registrationBonusPoints = ref(0);
const errorMessage = ref("");
const successMessage = ref("");

onMounted(loadSettings);

async function loadSettings() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const data = await apiRequest<{
      registration: RegistrationSettings;
    }>("/api/admin/registration-settings");
    applySettings(data.registration);
  } catch (error) {
    errorMessage.value = messageOf(error, "读取注册设置失败");
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  const points = Number(registrationBonusPoints.value);
  if (!Number.isFinite(points) || points < 0 || points > 1_000_000) {
    errorMessage.value = "注册赠送积分必须是 0 至 1000000 之间的数字";
    return;
  }

  saving.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const data = await apiRequest<{
      registration: RegistrationSettings;
    }>(
      "/api/admin/registration-settings",
      jsonRequest({
        requiresApproval: requiresApproval.value,
        registrationBonusEnabled: registrationBonusEnabled.value,
        registrationBonusPoints: points
      }, "PATCH")
    );
    applySettings(data.registration);
    successMessage.value = "注册政策和新用户赠送积分设置已保存";
  } catch (error) {
    errorMessage.value = messageOf(error, "保存注册设置失败");
  } finally {
    saving.value = false;
  }
}

function applySettings(settings: RegistrationSettings) {
  requiresApproval.value = settings.requiresApproval;
  registrationBonusEnabled.value = settings.registrationBonusEnabled;
  registrationBonusPoints.value = settings.registrationBonusPoints;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
</script>

<template>
  <article class="registration-setting-card">
    <div class="registration-setting-copy">
      <span>REGISTRATION POLICY</span>
      <h2>新用户注册政策</h2>
      <p>统一设置新账号是否需要审核，以及注册成功后是否自动赠送积分。</p>
      <small>所有修改只影响保存设置之后的新注册用户，不追溯已有账号。</small>
    </div>

    <div class="registration-setting-options">
      <div class="registration-option-row">
        <div>
          <strong>新用户注册审核</strong>
          <p>{{ requiresApproval ? "注册后进入待审核状态" : "注册后直接启用并自动登录" }}</p>
        </div>
        <label class="registration-switch" :class="{ enabled: requiresApproval }">
          <input v-model="requiresApproval" type="checkbox" :disabled="loading || saving" />
          <span><i></i></span>
          <strong>{{ requiresApproval ? "需要审核" : "直接启用" }}</strong>
        </label>
      </div>

      <div class="registration-option-row bonus-row">
        <div>
          <strong>新注册用户赠送积分</strong>
          <p>{{ registrationBonusEnabled ? `注册成功自动赠送 ${registrationBonusPoints || 0} 积分` : "当前未开启注册赠送" }}</p>
        </div>
        <div class="bonus-controls">
          <label class="registration-switch" :class="{ enabled: registrationBonusEnabled }">
            <input v-model="registrationBonusEnabled" type="checkbox" :disabled="loading || saving" />
            <span><i></i></span>
            <strong>{{ registrationBonusEnabled ? "已开启" : "已关闭" }}</strong>
          </label>
          <label class="bonus-input">
            <span>赠送数量</span>
            <input
              v-model.number="registrationBonusPoints"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              :disabled="loading || saving || !registrationBonusEnabled"
            />
            <em>积分</em>
          </label>
        </div>
      </div>

      <button
        class="registration-save-button"
        type="button"
        :disabled="loading || saving"
        @click="saveSettings"
      >
        {{ saving ? "保存中…" : "保存注册设置" }}
      </button>
    </div>

    <p v-if="successMessage" class="registration-setting-message success">{{ successMessage }}</p>
    <p v-if="errorMessage" class="registration-setting-message error">{{ errorMessage }}</p>
  </article>
</template>

<style scoped>
.registration-setting-card {
  display: grid;
  grid-template-columns: minmax(240px, .75fr) minmax(420px, 1.4fr);
  align-items: start;
  gap: 24px;
  margin-bottom: 18px;
  padding: 22px 24px;
  border: 1px solid #dfe2ee;
  border-radius: 17px;
  background: linear-gradient(135deg, #ffffff, #f6f4ff);
  box-shadow: 0 12px 32px rgba(61, 57, 107, .06);
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
.registration-setting-copy p,
.registration-option-row p {
  margin: 7px 0 0;
  color: #666d80;
  font-size: 13px;
  line-height: 1.65;
}
.registration-setting-copy small {
  display: block;
  margin-top: 6px;
  color: #9297a7;
  font-size: 11px;
  line-height: 1.6;
}
.registration-setting-options {
  display: grid;
  gap: 13px;
}
.registration-option-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  padding: 15px 16px;
  border: 1px solid #e4e6ef;
  border-radius: 13px;
  background: rgba(255, 255, 255, .82);
}
.registration-option-row > div:first-child > strong {
  color: #34394b;
  font-size: 14px;
}
.registration-switch {
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  white-space: nowrap;
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
  transition: background .18s ease;
}
.registration-switch > span i {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 23px;
  height: 23px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 7px rgba(40, 45, 70, .18);
  transition: transform .18s ease;
}
.registration-switch.enabled > span { background: #6655d6; }
.registration-switch.enabled > span i { transform: translateX(23px); }
.registration-switch strong {
  min-width: 52px;
  color: #555d70;
  font-size: 12px;
}
.bonus-controls {
  display: flex;
  align-items: center;
  gap: 14px;
}
.bonus-input {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #555d70;
  font-size: 12px;
}
.bonus-input input {
  width: 110px;
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid #d6d9e4;
  border-radius: 9px;
  background: #fff;
  color: #303445;
}
.bonus-input input:disabled { background: #f0f1f5; color: #9ca1ae; }
.bonus-input em { font-style: normal; }
.registration-save-button {
  justify-self: end;
  min-height: 42px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: #6554d4;
  color: #fff;
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
}
.registration-save-button:disabled { opacity: .55; cursor: not-allowed; }
.registration-setting-message {
  grid-column: 1 / -1;
  margin: 0;
  padding: 10px 12px;
  border-radius: 9px;
  font-size: 12px;
}
.registration-setting-message.success { background: #ecf9f1; color: #26724d; }
.registration-setting-message.error { background: #fff0f0; color: #a44242; }
@media (max-width: 980px) {
  .registration-setting-card { grid-template-columns: 1fr; }
}
@media (max-width: 680px) {
  .registration-option-row,
  .bonus-controls { align-items: stretch; flex-direction: column; }
  .registration-switch { justify-content: space-between; }
  .bonus-input { justify-content: space-between; }
  .bonus-input input { flex: 1; width: auto; }
  .registration-save-button { justify-self: stretch; }
}
</style>

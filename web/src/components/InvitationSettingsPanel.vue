<script setup lang="ts">
import {
  onMounted,
  ref
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";
import {
  formatDate,
  formatPoints
} from "../utils/format";

interface InvitationSettings {
  enabled: boolean;
  inviterRewardPoints: number;
  inviteeRewardPoints: number;
  rewardTrigger:
    | "registration"
    | "activation";
  rewardTitle: string;
  rewardDescription: string;
  updatedAt: string;
}

interface InvitationAdminPayload {
  settings: InvitationSettings;
  summary: {
    total: number;
    rewarded: number;
    pending: number;
    issuedPoints: number;
  };
  recent: Array<{
    id: string;
    inviterUsername: string;
    inviteeUsername: string;
    status:
      | "pending"
      | "rewarded";
    inviterRewardPoints: number;
    inviteeRewardPoints: number;
    createdAt: string;
    rewardedAt?: string;
  }>;
}

const loading = ref(true);
const saving = ref(false);
const errorMessage = ref("");
const successMessage = ref("");
const payload = ref<InvitationAdminPayload | null>(null);

const enabled = ref(false);
const inviterRewardPoints = ref(10);
const inviteeRewardPoints = ref(5);
const rewardTrigger = ref<
  "registration" |
  "activation"
>("activation");
const rewardTitle = ref("邀请好友，双方得积分");
const rewardDescription = ref(
  "好友通过你的邀请链接注册并满足奖励条件后，双方自动获得积分。"
);

onMounted(loadSettings);

async function loadSettings() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<
        InvitationAdminPayload
      >(
        "/api/admin/invitation-settings"
      );

    payload.value = data;
    applySettings(data.settings);
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "读取邀请奖励设置失败"
      );
  }
  finally {
    loading.value = false;
  }
}

async function saveSettings() {
  const inviterPoints =
    Number(inviterRewardPoints.value);
  const inviteePoints =
    Number(inviteeRewardPoints.value);

  if (
    !Number.isFinite(inviterPoints) ||
    inviterPoints < 0 ||
    inviterPoints > 1_000_000 ||
    !Number.isFinite(inviteePoints) ||
    inviteePoints < 0 ||
    inviteePoints > 1_000_000
  ) {
    errorMessage.value =
      "邀请奖励积分必须是 0 至 1000000 之间的数字";
    return;
  }

  if (
    !rewardTitle.value.trim() ||
    !rewardDescription.value.trim()
  ) {
    errorMessage.value =
      "请填写活动标题和活动说明";
    return;
  }

  saving.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const result =
      await apiRequest<{
        settings: InvitationSettings;
      }>(
        "/api/admin/invitation-settings",
        jsonRequest(
          {
            enabled: enabled.value,
            inviterRewardPoints:
              inviterPoints,
            inviteeRewardPoints:
              inviteePoints,
            rewardTrigger:
              rewardTrigger.value,
            rewardTitle:
              rewardTitle.value.trim(),
            rewardDescription:
              rewardDescription.value.trim()
          },
          "PATCH"
        )
      );

    applySettings(result.settings);
    successMessage.value =
      "邀请奖励设置已保存";
    await loadSettings();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "保存邀请奖励设置失败"
      );
  }
  finally {
    saving.value = false;
  }
}

function applySettings(
  settings: InvitationSettings
) {
  enabled.value = settings.enabled;
  inviterRewardPoints.value =
    settings.inviterRewardPoints;
  inviteeRewardPoints.value =
    settings.inviteeRewardPoints;
  rewardTrigger.value =
    settings.rewardTrigger;
  rewardTitle.value =
    settings.rewardTitle;
  rewardDescription.value =
    settings.rewardDescription;
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
  <article class="invitation-admin-card">
    <header>
      <div>
        <span>INVITATION REWARDS</span>
        <h2>用户邀请奖励</h2>
        <p>设置邀请活动开关、双方奖励积分、奖励发放时机和用户端展示内容。</p>
      </div>
      <label class="invite-admin-switch" :class="{ enabled }">
        <input v-model="enabled" type="checkbox" :disabled="loading || saving" />
        <span><i></i></span>
        <strong>{{ enabled ? "已开启" : "已关闭" }}</strong>
      </label>
    </header>

    <div class="invitation-admin-grid">
      <label>
        <span>邀请人奖励</span>
        <div><input v-model.number="inviterRewardPoints" type="number" min="0" max="1000000" step="0.01" :disabled="loading || saving" /><em>积分</em></div>
      </label>
      <label>
        <span>新用户奖励</span>
        <div><input v-model.number="inviteeRewardPoints" type="number" min="0" max="1000000" step="0.01" :disabled="loading || saving" /><em>积分</em></div>
      </label>
      <label>
        <span>奖励发放时机</span>
        <select v-model="rewardTrigger" :disabled="loading || saving">
          <option value="registration">注册成功后立即发放</option>
          <option value="activation">账号审核启用后发放</option>
        </select>
      </label>
      <label class="wide">
        <span>活动标题</span>
        <input v-model="rewardTitle" type="text" maxlength="120" :disabled="loading || saving" />
      </label>
      <label class="wide">
        <span>活动说明</span>
        <textarea v-model="rewardDescription" maxlength="500" rows="3" :disabled="loading || saving"></textarea>
      </label>
    </div>

    <div v-if="payload" class="invitation-admin-summary">
      <div><span>邀请关系</span><strong>{{ payload.summary.total }}</strong></div>
      <div><span>已发奖励</span><strong>{{ payload.summary.rewarded }}</strong></div>
      <div><span>待生效</span><strong>{{ payload.summary.pending }}</strong></div>
      <div><span>累计发放积分</span><strong>{{ formatPoints(payload.summary.issuedPoints) }}</strong></div>
    </div>

    <button class="invitation-admin-save" type="button" :disabled="loading || saving" @click="saveSettings">
      {{ saving ? "保存中…" : "保存邀请奖励设置" }}
    </button>

    <p v-if="successMessage" class="invite-admin-message success">{{ successMessage }}</p>
    <p v-if="errorMessage" class="invite-admin-message error">{{ errorMessage }}</p>

    <div v-if="payload?.recent.length" class="invitation-admin-recent">
      <h3>最近邀请记录</h3>
      <table>
        <thead><tr><th>邀请人</th><th>新用户</th><th>状态</th><th>双方奖励</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="item in payload.recent" :key="item.id">
            <td>{{ item.inviterUsername }}</td>
            <td>{{ item.inviteeUsername }}</td>
            <td>{{ item.status === 'rewarded' ? '已发放' : '待生效' }}</td>
            <td>{{ formatPoints(item.inviterRewardPoints) }} / {{ formatPoints(item.inviteeRewardPoints) }}</td>
            <td>{{ formatDate(item.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </article>
</template>

<style scoped>
.invitation-admin-card{display:grid;gap:16px;margin-bottom:18px;padding:22px 24px;border:1px solid #dfe2ee;border-radius:17px;background:linear-gradient(135deg,#fff,#f5f8ff);box-shadow:0 12px 32px rgba(61,57,107,.06)}
.invitation-admin-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.invitation-admin-card header span{color:#6654d4;font-size:10px;font-weight:900;letter-spacing:.15em}.invitation-admin-card h2{margin:5px 0 0;font-size:20px}.invitation-admin-card header p{margin:6px 0 0;color:#6d7284;font-size:13px}.invite-admin-switch{display:flex;align-items:center;gap:9px;white-space:nowrap}.invite-admin-switch input{position:absolute;opacity:0}.invite-admin-switch>span{position:relative;width:52px;height:29px;border-radius:999px;background:#c9ced9}.invite-admin-switch>span i{position:absolute;left:3px;top:3px;width:23px;height:23px;border-radius:50%;background:#fff;transition:transform .18s}.invite-admin-switch.enabled>span{background:#6655d6}.invite-admin-switch.enabled>span i{transform:translateX(23px)}.invite-admin-switch strong{font-size:12px;color:#555d70}
.invitation-admin-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.invitation-admin-grid label{display:grid;gap:7px}.invitation-admin-grid label>span{color:#666c7e;font-size:12px;font-weight:750}.invitation-admin-grid label>div{display:flex;align-items:center;gap:8px}.invitation-admin-grid input,.invitation-admin-grid select,.invitation-admin-grid textarea{width:100%;min-height:40px;padding:0 11px;border:1px solid #d7dae5;border-radius:10px;background:#fff;color:#303445}.invitation-admin-grid textarea{padding:10px 11px;resize:vertical}.invitation-admin-grid em{font-style:normal;color:#777c8e;font-size:12px}.invitation-admin-grid .wide{grid-column:1/-1}
.invitation-admin-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.invitation-admin-summary div{padding:13px;border:1px solid #e2e4ed;border-radius:12px;background:#fff}.invitation-admin-summary span{display:block;color:#8b8fa0;font-size:10px}.invitation-admin-summary strong{display:block;margin-top:4px;color:#5f4dcc;font-size:20px}
.invitation-admin-save{justify-self:end;min-height:42px;padding:0 18px;border:0;border-radius:10px;background:#6554d4;color:#fff;font-size:12px;font-weight:850}.invite-admin-message{margin:0;padding:10px 12px;border-radius:9px;font-size:12px}.invite-admin-message.success{background:#ecf9f1;color:#26724d}.invite-admin-message.error{background:#fff0f0;color:#a44242}.invitation-admin-recent{overflow:auto;border:1px solid #e1e3eb;border-radius:13px;background:#fff}.invitation-admin-recent h3{margin:0;padding:14px 16px;border-bottom:1px solid #eceef3;font-size:14px}.invitation-admin-recent table{width:100%;border-collapse:collapse}.invitation-admin-recent th,.invitation-admin-recent td{padding:11px 14px;border-top:1px solid #eff0f4;text-align:left;font-size:12px}.invitation-admin-recent th{background:#f8f8fc;color:#777c8f}
@media(max-width:900px){.invitation-admin-grid{grid-template-columns:1fr 1fr}.invitation-admin-summary{grid-template-columns:1fr 1fr}.invitation-admin-card header{flex-direction:column}.invitation-admin-grid .wide{grid-column:1/-1}}@media(max-width:620px){.invitation-admin-grid,.invitation-admin-summary{grid-template-columns:1fr}.invitation-admin-grid .wide{grid-column:auto}.invitation-admin-save{justify-self:stretch}}
</style>

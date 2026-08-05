<script setup lang="ts">
import {
  computed,
  onMounted,
  ref
} from "vue";
import {
  apiRequest
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
}

interface InvitationRecord {
  id: string;
  username: string;
  status:
    | "pending"
    | "rewarded";
  rewardPoints: number;
  createdAt: string;
  rewardedAt?: string;
}

interface InvitationPayload {
  settings: InvitationSettings;
  code: string;
  summary: {
    total: number;
    rewarded: number;
    pending: number;
    earnedPoints: number;
  };
  recent: InvitationRecord[];
}

const loading = ref(true);
const errorMessage = ref("");
const successMessage = ref("");
const data = ref<InvitationPayload | null>(null);

const inviteLink = computed(() => {
  if (!data.value?.code) return "";
  const url = new URL(
    window.location.origin
  );
  url.searchParams.set(
    "invite",
    data.value.code
  );
  return url.toString();
});

onMounted(loadInvitation);

async function loadInvitation() {
  loading.value = true;
  errorMessage.value = "";

  try {
    data.value =
      await apiRequest<
        InvitationPayload
      >(
        "/api/account/invitation"
      );
  }
  catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取邀请奖励失败";
  }
  finally {
    loading.value = false;
  }
}

async function copyText(
  value: string,
  success: string
) {
  if (!value) return;

  try {
    await navigator.clipboard
      .writeText(value);
  }
  catch {
    const textarea =
      document.createElement(
        "textarea"
      );
    textarea.value = value;
    textarea.style.position =
      "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(
      textarea
    );
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  successMessage.value = success;
  window.setTimeout(() => {
    successMessage.value = "";
  }, 2500);
}
</script>

<template>
  <div
    v-if="loading"
    class="invite-loading"
  >
    正在读取邀请奖励…
  </div>

  <div
    v-else-if="errorMessage"
    class="invite-error"
  >
    {{ errorMessage }}
  </div>

  <div
    v-else-if="data"
    class="invite-shell"
  >
    <section class="invite-hero">
      <div>
        <span>INVITATION REWARDS</span>
        <h2>
          {{ data.settings.rewardTitle }}
        </h2>
        <p>
          {{ data.settings.rewardDescription }}
        </p>
        <small>
          {{
            data.settings.rewardTrigger ===
              'registration'
              ? '好友注册成功后立即发放奖励。'
              : '好友账号启用后发放奖励。'
          }}
        </small>
      </div>

      <div
        class="invite-status"
        :class="{
          enabled:
            data.settings.enabled
        }"
      >
        {{
          data.settings.enabled
            ? '活动进行中'
            : '活动暂未开启'
        }}
      </div>
    </section>

    <section class="invite-reward-grid">
      <article>
        <span>邀请人奖励</span>
        <strong>
          {{
            formatPoints(
              data.settings
                .inviterRewardPoints
            )
          }}
        </strong>
        <small>积分 / 位</small>
      </article>

      <article>
        <span>新用户奖励</span>
        <strong>
          {{
            formatPoints(
              data.settings
                .inviteeRewardPoints
            )
          }}
        </strong>
        <small>积分 / 位</small>
      </article>

      <article>
        <span>成功邀请</span>
        <strong>
          {{ data.summary.rewarded }}
        </strong>
        <small>累计 {{ data.summary.total }} 位</small>
      </article>

      <article>
        <span>累计获得</span>
        <strong>
          {{
            formatPoints(
              data.summary.earnedPoints
            )
          }}
        </strong>
        <small>邀请奖励积分</small>
      </article>
    </section>

    <section class="invite-code-card">
      <div>
        <span>我的邀请码</span>
        <strong>{{ data.code }}</strong>
      </div>
      <button
        type="button"
        @click="copyText(
          data.code,
          '邀请码已复制'
        )"
      >
        复制邀请码
      </button>
    </section>

    <section class="invite-link-card">
      <label>
        <span>我的邀请链接</span>
        <input
          :value="inviteLink"
          type="text"
          readonly
        />
      </label>
      <button
        type="button"
        @click="copyText(
          inviteLink,
          '邀请链接已复制'
        )"
      >
        复制邀请链接
      </button>
    </section>

    <p
      v-if="successMessage"
      class="invite-success"
    >
      {{ successMessage }}
    </p>

    <section class="invite-record-card">
      <header>
        <div>
          <span>INVITATION HISTORY</span>
          <h3>最近邀请记录</h3>
        </div>
        <small>
          待生效 {{ data.summary.pending }} 位
        </small>
      </header>

      <div
        v-if="data.recent.length === 0"
        class="invite-empty"
      >
        暂无邀请记录，复制邀请链接分享给好友即可开始。
      </div>

      <div
        v-else
        class="invite-record-list"
      >
        <article
          v-for="item in data.recent"
          :key="item.id"
        >
          <div>
            <strong>{{ item.username }}</strong>
            <span>{{ formatDate(item.createdAt) }}</span>
          </div>
          <div class="invite-record-result">
            <b
              :class="{
                rewarded:
                  item.status === 'rewarded'
              }"
            >
              {{
                item.status === 'rewarded'
                  ? '已发放'
                  : '待生效'
              }}
            </b>
            <small>
              +{{ formatPoints(item.rewardPoints) }} 积分
            </small>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.invite-shell {
  display: grid;
  gap: 16px;
}
.invite-loading,
.invite-error,
.invite-empty {
  padding: 38px;
  border: 1px dashed #d7d9e5;
  border-radius: 16px;
  background: #fff;
  color: #858a9d;
  text-align: center;
}
.invite-error {
  border-color: #efcaca;
  background: #fff2f2;
  color: #9d4141;
}
.invite-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 24px;
  border-radius: 20px;
  background:
    radial-gradient(
      circle at 85% 15%,
      rgba(255, 255, 255, .22),
      transparent 32%
    ),
    linear-gradient(
      135deg,
      #5f4bc9,
      #7d66e9
    );
  color: #fff;
  box-shadow:
    0 18px 42px
    rgba(80, 62, 184, .18);
}
.invite-hero span,
.invite-record-card header span {
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .16em;
}
.invite-hero h2 {
  margin: 7px 0 0;
  font-size: 25px;
}
.invite-hero p {
  max-width: 680px;
  margin: 9px 0 0;
  color: rgba(255, 255, 255, .82);
}
.invite-hero small {
  display: block;
  margin-top: 8px;
  color: rgba(255, 255, 255, .68);
}
.invite-status {
  padding: 7px 12px;
  border: 1px solid rgba(255, 255, 255, .22);
  border-radius: 999px;
  background: rgba(30, 24, 82, .24);
  color: #ddd8ff;
  font-size: 11px;
  font-weight: 850;
  white-space: nowrap;
}
.invite-status.enabled {
  background: rgba(38, 170, 110, .24);
  color: #d9ffeb;
}
.invite-reward-grid {
  display: grid;
  grid-template-columns:
    repeat(4, minmax(0, 1fr));
  gap: 13px;
}
.invite-reward-grid article {
  padding: 18px;
  border: 1px solid #e0e2ec;
  border-radius: 16px;
  background: #fff;
  box-shadow:
    0 10px 28px
    rgba(54, 58, 91, .05);
}
.invite-reward-grid span,
.invite-reward-grid small,
.invite-code-card span,
.invite-link-card label > span {
  display: block;
  color: #8a8fa1;
  font-size: 11px;
}
.invite-reward-grid strong {
  display: block;
  margin-top: 6px;
  color: #604dcb;
  font-size: 26px;
}
.invite-code-card,
.invite-link-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px;
  border: 1px solid #dfdfeb;
  border-radius: 16px;
  background: #fff;
}
.invite-code-card strong {
  display: block;
  margin-top: 5px;
  color: #39334f;
  font-size: 22px;
  letter-spacing: .08em;
}
.invite-code-card button,
.invite-link-card button {
  min-height: 42px;
  padding: 0 17px;
  border: 0;
  border-radius: 11px;
  background: #6654d6;
  color: #fff;
  font-size: 12px;
  font-weight: 850;
  white-space: nowrap;
}
.invite-link-card label {
  min-width: 0;
  flex: 1;
}
.invite-link-card input {
  width: 100%;
  min-height: 42px;
  margin-top: 7px;
  padding: 0 12px;
  border: 1px solid #d9dbe6;
  border-radius: 10px;
  background: #f8f8fc;
  color: #555b70;
}
.invite-success {
  margin: 0;
  padding: 11px 13px;
  border-radius: 11px;
  background: #eaf8f0;
  color: #28734e;
}
.invite-record-card {
  overflow: hidden;
  border: 1px solid #e0e2ec;
  border-radius: 17px;
  background: #fff;
}
.invite-record-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid #eceef3;
}
.invite-record-card header span {
  color: #6b57d4;
}
.invite-record-card h3 {
  margin: 4px 0 0;
  font-size: 18px;
}
.invite-record-card header small {
  color: #8f93a4;
}
.invite-record-list article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 15px 20px;
  border-top: 1px solid #eff0f4;
}
.invite-record-list article:first-child {
  border-top: 0;
}
.invite-record-list article > div:first-child {
  display: flex;
  flex-direction: column;
}
.invite-record-list strong {
  color: #383d4e;
}
.invite-record-list span {
  margin-top: 3px;
  color: #969aaa;
  font-size: 11px;
}
.invite-record-result {
  text-align: right;
}
.invite-record-result b {
  display: block;
  color: #a56e31;
  font-size: 12px;
}
.invite-record-result b.rewarded {
  color: #27744d;
}
.invite-record-result small {
  color: #777c90;
}
@media (max-width: 1000px) {
  .invite-reward-grid {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 620px) {
  .invite-hero,
  .invite-code-card,
  .invite-link-card,
  .invite-record-list article {
    align-items: stretch;
    flex-direction: column;
  }
  .invite-reward-grid {
    grid-template-columns: 1fr;
  }
  .invite-record-result {
    text-align: left;
  }
}
</style>

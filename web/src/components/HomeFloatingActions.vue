<script setup lang="ts">
import {
  computed,
  onMounted,
  ref
} from "vue";
import {
  Gift,
  MessageSquareMore,
  X
} from "@lucide/vue";
import {
  ApiError,
  apiRequest
} from "../api/client";
import type {
  AuthUser
} from "../types";

interface InvitationPayload {
  settings: {
    enabled: boolean;
    inviterRewardPoints: number;
    inviteeRewardPoints: number;
    rewardTitle: string;
    rewardDescription: string;
  };
}

const user =
  ref<AuthUser | null>(null);

const invitation =
  ref<InvitationPayload | null>(
    null
  );

const ready =
  ref(false);

const inviteHidden =
  ref(false);

const feedbackHidden =
  ref(false);

const invitationEnabled =
  computed(() =>
    Boolean(
      invitation.value
        ?.settings.enabled
    )
  );

onMounted(load);

async function load() {
  try {
    const auth =
      await apiRequest<{
        user: AuthUser;
      }>(
        "/api/auth/me"
      );

    user.value =
      auth.user;

    inviteHidden.value =
      isHiddenToday(
        "invite"
      );

    feedbackHidden.value =
      isHiddenToday(
        "feedback"
      );

    try {
      invitation.value =
        await apiRequest<
          InvitationPayload
        >(
          "/api/account/invitation"
        );
    }
    catch {
      invitation.value =
        null;
    }
  }
  catch (error) {
    if (
      !(
        error instanceof
          ApiError &&
        error.status === 401
      )
    ) {
      console.error(
        "Load home floating actions error",
        error
      );
    }

    user.value = null;
  }
  finally {
    ready.value = true;
  }
}

function openInvites() {
  window.location.href =
    "/account?tab=invites";
}

function openFeedback() {
  window.location.href =
    "/account?tab=feedback";
}

function hideToday(
  type:
    | "invite"
    | "feedback"
) {
  if (!user.value) return;

  try {
    window.localStorage
      .setItem(
        storageKey(type),
        todayKey()
      );
  }
  catch {
    // localStorage 不可用时，仅隐藏当前页面。
  }

  if (type === "invite") {
    inviteHidden.value =
      true;
  }
  else {
    feedbackHidden.value =
      true;
  }
}

function isHiddenToday(
  type:
    | "invite"
    | "feedback"
): boolean {
  if (!user.value) {
    return false;
  }

  try {
    return (
      window.localStorage
        .getItem(
          storageKey(type)
        ) === todayKey()
    );
  }
  catch {
    return false;
  }
}

function storageKey(
  type:
    | "invite"
    | "feedback"
): string {
  return [
    "ecom-ai-studio",
    "home-float-hide",
    type,
    user.value?.id ||
      "guest"
  ].join(":");
}

function todayKey(): string {
  const now =
    new Date();

  return [
    now.getFullYear(),
    String(
      now.getMonth() + 1
    ).padStart(
      2,
      "0"
    ),
    String(
      now.getDate()
    ).padStart(
      2,
      "0"
    )
  ].join("-");
}
</script>

<template>
  <div
    v-if="
      ready &&
      user &&
      (
        (
          invitationEnabled &&
          !inviteHidden
        ) ||
        !feedbackHidden
      )
    "
    class="home-floating-actions"
  >
    <article
      v-if="
        invitationEnabled &&
        !inviteHidden
      "
      class="home-float-item invite"
    >
      <button
        type="button"
        class="home-float-main"
        aria-label="邀请有礼"
        @click="openInvites"
      >
        <span>
          <Gift
            :size="19"
            :stroke-width="2"
          />
        </span>

        <div>
          <strong>邀请有礼</strong>
          <small>
            邀好友得奖励
          </small>
        </div>

        <i>HOT</i>
      </button>

      <button
        type="button"
        class="home-float-close"
        title="今日不再显示，明天恢复"
        aria-label="今日关闭邀请有礼入口"
        @click.stop="
          hideToday(
            'invite'
          )
        "
      >
        <X
          :size="12"
          :stroke-width="2"
        />
      </button>
    </article>

    <article
      v-if="
        !feedbackHidden
      "
      class="home-float-item feedback"
    >
      <button
        type="button"
        class="home-float-main"
        aria-label="用户反馈"
        @click="openFeedback"
      >
        <span>
          <MessageSquareMore
            :size="19"
            :stroke-width="2"
          />
        </span>

        <div>
          <strong>意见反馈</strong>
          <small>
            建议与问题
          </small>
        </div>
      </button>

      <button
        type="button"
        class="home-float-close"
        title="今日不再显示，明天恢复"
        aria-label="今日关闭反馈入口"
        @click.stop="
          hideToday(
            'feedback'
          )
        "
      >
        <X
          :size="12"
          :stroke-width="2"
        />
      </button>
    </article>
  </div>
</template>


<style scoped>
.home-floating-actions{
  position:fixed;
  z-index:85;
  right:20px;
  bottom:92px;
  display:grid;
  gap:9px;
  pointer-events:none;
}
.home-float-item{
  position:relative;
  pointer-events:auto;
}
.home-float-main{
  display:flex;
  align-items:center;
  min-width:142px;
  gap:8px;
  padding:7px 28px 7px 7px;
  border:1px solid rgba(218,220,231,.96);
  border-radius:14px;
  background:rgba(255,255,255,.96);
  color:#484c5b;
  box-shadow:
    0 10px 30px
    rgba(34,37,55,.12);
  backdrop-filter:blur(14px);
  cursor:pointer;
  transition:
    transform .18s ease,
    border-color .18s ease,
    box-shadow .18s ease;
}
.home-float-main:hover{
  transform:translateY(-2px);
  border-color:#cbc4ed;
  box-shadow:
    0 14px 34px
    rgba(52,45,98,.16);
}
.home-float-main>span{
  display:grid;
  place-items:center;
  flex:0 0 35px;
  width:35px;
  height:35px;
  border-radius:10px;
  background:#efecff;
  color:#6552cf;
}
.home-float-main>div{
  display:grid;
  min-width:0;
  gap:1px;
  text-align:left;
}
.home-float-main strong{
  color:#3f4352;
  font-size:11px;
  line-height:1.2;
  white-space:nowrap;
}
.home-float-main small{
  color:#9599a7;
  font-size:8.5px;
  white-space:nowrap;
}
.home-float-item.invite .home-float-main{
  border-color:#d9d0ff;
  background:
    linear-gradient(
      135deg,
      rgba(255,255,255,.98),
      rgba(247,244,255,.98)
    );
}
.home-float-item.invite .home-float-main>span{
  position:relative;
  background:
    linear-gradient(
      135deg,
      #6c57da,
      #8a70ef
    );
  color:#fff;
  box-shadow:
    0 6px 16px
    rgba(103,82,207,.22);
}
.home-float-item.invite .home-float-main>span::after{
  content:"";
  position:absolute;
  inset:-5px;
  border:1px solid rgba(108,87,218,.24);
  border-radius:14px;
  animation:
    invite-halo 2.2s ease-out
    infinite;
}
.home-float-main>i{
  position:absolute;
  top:-6px;
  right:20px;
  padding:2px 5px;
  border-radius:999px;
  background:#f05d7b;
  color:#fff;
  font-size:7px;
  font-style:normal;
  font-weight:900;
  letter-spacing:.05em;
  box-shadow:
    0 4px 10px
    rgba(240,93,123,.2);
}
.home-float-close{
  position:absolute;
  z-index:2;
  top:5px;
  right:5px;
  display:grid;
  place-items:center;
  width:19px;
  height:19px;
  padding:0;
  border:0;
  border-radius:6px;
  background:transparent;
  color:#a3a6b0;
  cursor:pointer;
  opacity:.66;
}
.home-float-close:hover{
  background:#f0f0f4;
  color:#666a78;
  opacity:1;
}
@keyframes invite-halo{
  0%{
    opacity:.8;
    transform:scale(.9);
  }
  70%,
  100%{
    opacity:0;
    transform:scale(1.12);
  }
}
@media(max-width:720px){
  .home-floating-actions{
    right:12px;
    bottom:76px;
  }
  .home-float-main{
    min-width:0;
    width:46px;
    height:46px;
    padding:5px;
    border-radius:14px;
  }
  .home-float-main>span{
    width:34px;
    height:34px;
  }
  .home-float-main>div,
  .home-float-main>i{
    display:none;
  }
  .home-float-close{
    top:-5px;
    right:-5px;
    border:1px solid #e0e1e7;
    background:#fff;
  }
}
</style>

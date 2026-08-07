<script setup lang="ts">
import { ref, watch } from "vue";
import { apiRequest, jsonRequest } from "../api/client";
import type { AuthUser } from "../types";

const props = defineProps<{ user: AuthUser }>();
const emit = defineEmits<{ userUpdated: [user: AuthUser] }>();

const nickname = ref(props.user.nickname || "");
const savingProfile = ref(false);
const profileMessage = ref("");
const profileError = ref("");
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const changingPassword = ref(false);
const passwordMessage = ref("");
const passwordError = ref("");

watch(
  () => props.user.nickname,
  (value) => { nickname.value = value || ""; }
);

async function saveProfile() {
  profileMessage.value = "";
  profileError.value = "";
  if (nickname.value.trim().length > 40) {
    profileError.value = "昵称不能超过 40 个字符";
    return;
  }
  savingProfile.value = true;
  try {
    const data = await apiRequest<{ user: AuthUser }>(
      "/api/account/profile",
      jsonRequest({ nickname: nickname.value }, "PATCH")
    );
    emit("userUpdated", data.user);
    nickname.value = data.user.nickname || "";
    profileMessage.value = "昵称已保存";
  } catch (error) {
    profileError.value = error instanceof Error ? error.message : "保存昵称失败";
  } finally {
    savingProfile.value = false;
  }
}

async function changePassword() {
  passwordMessage.value = "";
  passwordError.value = "";
  if (newPassword.value.length < 8 || newPassword.value.length > 128) {
    passwordError.value = "新密码长度需为 8–128 位";
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = "两次输入的新密码不一致";
    return;
  }
  if (currentPassword.value === newPassword.value) {
    passwordError.value = "新密码不能与当前密码相同";
    return;
  }

  changingPassword.value = true;
  try {
    await apiRequest(
      "/api/account/password",
      jsonRequest({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value
      })
    );
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    passwordMessage.value = "密码修改成功。为保证安全，其他登录会话和当前会话均已失效，请重新登录。";
  } catch (error) {
    passwordError.value = error instanceof Error ? error.message : "修改密码失败";
  } finally {
    changingPassword.value = false;
  }
}
</script>

<template>
  <div class="profile-security-grid">
    <article class="profile-card">
      <span class="eyebrow">PROFILE</span>
      <h2>个人资料</h2>
      <p>登录用户名保持独立；昵称可用于后续作品广场等公开展示。</p>

      <div class="readonly-row">
        <span>登录用户名</span>
        <strong>{{ user.username }}</strong>
      </div>

      <label>
        <span>公开昵称</span>
        <input
          v-model="nickname"
          maxlength="40"
          placeholder="未设置时默认显示用户名"
        />
        <small>{{ nickname.length }}/40</small>
      </label>

      <p v-if="profileMessage" class="message success">{{ profileMessage }}</p>
      <p v-if="profileError" class="message error">{{ profileError }}</p>

      <button type="button" :disabled="savingProfile" @click="saveProfile">
        {{ savingProfile ? '保存中…' : '保存昵称' }}
      </button>
    </article>

    <article class="profile-card password-card">
      <span class="eyebrow">SECURITY</span>
      <h2>修改密码</h2>
      <p v-if="user.mustChangePassword" class="forced-tip">
        当前密码由站长重置，建议立即设置为只有你知道的新密码。
      </p>
      <p v-else>修改后全部已登录设备都会退出，避免旧会话继续使用。</p>

      <label>
        <span>当前密码</span>
        <input v-model="currentPassword" type="password" autocomplete="current-password" />
      </label>
      <label>
        <span>新密码</span>
        <input v-model="newPassword" type="password" autocomplete="new-password" />
      </label>
      <label>
        <span>确认新密码</span>
        <input v-model="confirmPassword" type="password" autocomplete="new-password" />
      </label>

      <p v-if="passwordMessage" class="message success">
        {{ passwordMessage }} <a href="/">返回重新登录</a>
      </p>
      <p v-if="passwordError" class="message error">{{ passwordError }}</p>

      <button
        type="button"
        :disabled="changingPassword || !currentPassword || !newPassword || !confirmPassword"
        @click="changePassword"
      >
        {{ changingPassword ? '修改中…' : '确认修改密码' }}
      </button>
    </article>
  </div>
</template>

<style scoped>
.profile-security-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.profile-card {
  border: 1px solid #e7e9ef;
  border-radius: 16px;
  background: #fff;
  padding: 22px;
  box-shadow: 0 7px 22px rgba(34, 40, 57, .035);
}
.eyebrow { color: #7669cb; font-size: 10px; font-weight: 800; letter-spacing: .14em; }
h2 { margin: 6px 0 5px; color: #242836; font-size: 19px; }
p { margin: 0 0 18px; color: #7b8290; font-size: 12px; line-height: 1.6; }
.readonly-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-radius: 10px;
  background: #f7f8fb;
  padding: 11px 12px;
  margin-bottom: 14px;
  font-size: 12px;
}
.readonly-row span { color: #858b98; }
.readonly-row strong { color: #343846; }
label { display: grid; gap: 6px; margin-top: 12px; }
label > span { color: #606776; font-size: 11px; font-weight: 700; }
label small { justify-self: end; color: #a0a5ae; font-size: 10px; }
input {
  height: 40px;
  box-sizing: border-box;
  border: 1px solid #dfe2e8;
  border-radius: 9px;
  outline: none;
  padding: 0 11px;
  font-size: 12px;
}
input:focus { border-color: #8a80d6; box-shadow: 0 0 0 3px rgba(138,128,214,.1); }
button {
  min-height: 39px;
  margin-top: 16px;
  border: 0;
  border-radius: 9px;
  background: #272a3a;
  color: #fff;
  padding: 0 16px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
button:disabled { opacity: .55; cursor: not-allowed; }
.message { margin: 12px 0 0; border-radius: 9px; padding: 9px 11px; }
.message.success { background: #eff9f3; color: #25704e; }
.message.error { background: #fff2f0; color: #a93b33; }
.message a { color: inherit; font-weight: 800; }
.forced-tip { background: #fff8eb; color: #9a661d; border-radius: 9px; padding: 9px 11px; }
@media (max-width: 800px) { .profile-security-grid { grid-template-columns: 1fr; } }
</style>

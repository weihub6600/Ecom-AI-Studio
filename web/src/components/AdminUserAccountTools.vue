<script setup lang="ts">
import { ref, watch } from "vue";
import { apiRequest, jsonRequest } from "../api/client";
import type { AdminUserSummary } from "../types";

const props = defineProps<{ user: AdminUserSummary }>();
const emit = defineEmits<{ userUpdated: [user: AdminUserSummary] }>();

const note = ref(props.user.adminNote || "");
const tempPassword = ref("");
const saving = ref(false);
const resetting = ref(false);
const message = ref("");
const errorMessage = ref("");

watch(
  () => props.user.id,
  () => {
    note.value = props.user.adminNote || "";
    tempPassword.value = "";
    message.value = "";
    errorMessage.value = "";
  }
);
watch(
  () => props.user.adminNote,
  (value) => { note.value = value || ""; }
);

async function saveNote() {
  saving.value = true;
  message.value = "";
  errorMessage.value = "";
  try {
    const data = await apiRequest<{ user: AdminUserSummary }>(
      `/api/admin/users/${encodeURIComponent(props.user.id)}`,
      jsonRequest({ adminNote: note.value }, "PATCH")
    );
    const merged = { ...props.user, ...data.user, adminNote: note.value.trim() || undefined };
    emit("userUpdated", merged);
    message.value = "站长备注已保存";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存备注失败";
  } finally {
    saving.value = false;
  }
}

async function resetPassword() {
  if (tempPassword.value.length < 8 || tempPassword.value.length > 128) {
    errorMessage.value = "临时密码长度需为 8–128 位";
    return;
  }
  if (!window.confirm(`确定重置“${props.user.username}”的密码吗？该用户全部登录会话会立即失效。`)) {
    return;
  }

  resetting.value = true;
  message.value = "";
  errorMessage.value = "";
  try {
    const data = await apiRequest<{ user: AdminUserSummary }>(
      `/api/admin/users/${encodeURIComponent(props.user.id)}/reset-password`,
      jsonRequest({ newPassword: tempPassword.value })
    );
    tempPassword.value = "";
    emit("userUpdated", { ...props.user, ...data.user, mustChangePassword: true });
    message.value = "密码已重置。请将临时密码安全告知用户，并提醒用户登录后修改。";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "重置密码失败";
  } finally {
    resetting.value = false;
  }
}
</script>

<template>
  <div class="user-tools">
    <div class="identity-row">
      <span>公开昵称</span>
      <strong>{{ user.nickname || '未设置' }}</strong>
    </div>

    <label>
      <span>站长备注</span>
      <textarea v-model="note" maxlength="500" rows="3" placeholder="仅站长可见，例如：大客户、测试账号、合作商家"></textarea>
      <small>{{ note.length }}/500</small>
    </label>
    <button type="button" :disabled="saving" @click="saveNote">
      {{ saving ? '保存中…' : '保存备注' }}
    </button>

    <div v-if="user.role !== 'admin'" class="reset-box">
      <label>
        <span>重置密码</span>
        <input
          v-model="tempPassword"
          type="password"
          autocomplete="new-password"
          placeholder="设置 8–128 位临时密码"
        />
      </label>
      <button type="button" class="danger" :disabled="resetting || !tempPassword" @click="resetPassword">
        {{ resetting ? '重置中…' : '重置用户密码' }}
      </button>
      <small v-if="user.mustChangePassword" class="password-flag">当前账号已被标记为“建议修改临时密码”</small>
    </div>

    <p v-if="message" class="tool-message success">{{ message }}</p>
    <p v-if="errorMessage" class="tool-message error">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.user-tools {
  display: grid;
  gap: 10px;
  margin: 14px 0;
  border: 1px solid #eceef3;
  border-radius: 12px;
  background: #fbfbfd;
  padding: 13px;
}
.identity-row { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; }
.identity-row span { color: #858b97; }
.identity-row strong { color: #343845; }
label { display: grid; gap: 5px; }
label > span { color: #6d7381; font-size: 11px; font-weight: 700; }
textarea, input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dfe2e8;
  border-radius: 8px;
  outline: none;
  background: #fff;
  padding: 8px 9px;
  color: #343845;
  font-size: 11px;
  resize: vertical;
}
input { height: 36px; resize: none; }
label small { justify-self: end; color: #a1a5ae; font-size: 9px; }
button {
  justify-self: start;
  min-height: 32px;
  border: 1px solid #d9dde5;
  border-radius: 8px;
  background: #fff;
  padding: 0 11px;
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
}
button.danger { border-color: #efc3bd; background: #fff5f3; color: #ad3b32; }
button:disabled { opacity: .55; cursor: not-allowed; }
.reset-box { display: grid; gap: 8px; border-top: 1px solid #eceef3; padding-top: 10px; }
.password-flag { color: #a16c20; font-size: 9.5px; }
.tool-message { margin: 0; border-radius: 8px; padding: 8px 9px; font-size: 10.5px; line-height: 1.45; }
.tool-message.success { background: #eff8f3; color: #28704f; }
.tool-message.error { background: #fff1ef; color: #a93e35; }
</style>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiRequest, jsonRequest } from "../api/client";

interface Announcement {
  id: string;
  title: string;
  content: string;
  kind: "info" | "warning" | "success";
  pinned: boolean;
  published: boolean;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
}

const records = ref<Announcement[]>([]);
const loading = ref(false);
const saving = ref(false);
const editingId = ref("");
const title = ref("");
const content = ref("");
const kind = ref<Announcement["kind"]>("info");
const pinned = ref(false);
const published = ref(true);
const startsAt = ref("");
const endsAt = ref("");
const message = ref("");
const errorMessage = ref("");

onMounted(load);

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const data = await apiRequest<{ announcements: Announcement[] }>(
      "/api/admin/announcements"
    );
    records.value = data.announcements || [];
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取公告失败";
  } finally {
    loading.value = false;
  }
}

function edit(item: Announcement) {
  editingId.value = item.id;
  title.value = item.title;
  content.value = item.content;
  kind.value = item.kind;
  pinned.value = item.pinned;
  published.value = item.published;
  startsAt.value = toLocalInput(item.startsAt);
  endsAt.value = toLocalInput(item.endsAt);
  message.value = "";
  errorMessage.value = "";
}

function resetForm() {
  editingId.value = "";
  title.value = "";
  content.value = "";
  kind.value = "info";
  pinned.value = false;
  published.value = true;
  startsAt.value = "";
  endsAt.value = "";
}

async function save() {
  if (!title.value.trim() || !content.value.trim()) {
    errorMessage.value = "请填写公告标题和内容";
    return;
  }
  saving.value = true;
  message.value = "";
  errorMessage.value = "";
  try {
    const payload = {
      title: title.value,
      content: content.value,
      kind: kind.value,
      pinned: pinned.value,
      published: published.value,
      startsAt: startsAt.value ? new Date(startsAt.value).toISOString() : null,
      endsAt: endsAt.value ? new Date(endsAt.value).toISOString() : null
    };
    if (editingId.value) {
      await apiRequest(
        `/api/admin/announcements/${encodeURIComponent(editingId.value)}`,
        jsonRequest(payload, "PATCH")
      );
      message.value = "公告已更新";
    } else {
      await apiRequest(
        "/api/admin/announcements",
        jsonRequest(payload)
      );
      message.value = "公告已创建";
    }
    resetForm();
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存公告失败";
  } finally {
    saving.value = false;
  }
}

async function togglePublished(item: Announcement) {
  try {
    await apiRequest(
      `/api/admin/announcements/${encodeURIComponent(item.id)}`,
      jsonRequest({ published: !item.published }, "PATCH")
    );
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "更新公告状态失败";
  }
}

async function remove(item: Announcement) {
  if (!window.confirm(`确定删除公告“${item.title}”吗？`)) return;
  try {
    await apiRequest(
      `/api/admin/announcements/${encodeURIComponent(item.id)}`,
      { method: "DELETE" }
    );
    if (editingId.value === item.id) resetForm();
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "删除公告失败";
  }
}

function toLocalInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
</script>

<template>
  <div class="announcement-admin">
    <section class="editor-card">
      <header>
        <div>
          <span>ANNOUNCEMENT</span>
          <h2>{{ editingId ? '编辑公告' : '发布新公告' }}</h2>
          <p>发布后会显示在首页顶部；可设置置顶和展示时间。</p>
        </div>
        <button v-if="editingId" type="button" class="soft" @click="resetForm">取消编辑</button>
      </header>

      <div class="form-grid">
        <label class="wide"><span>标题</span><input v-model="title" maxlength="80" placeholder="例如：服务维护通知" /></label>
        <label class="wide"><span>内容</span><textarea v-model="content" maxlength="1200" rows="4" placeholder="请输入公告正文"></textarea></label>
        <label><span>类型</span><select v-model="kind"><option value="info">普通</option><option value="warning">提醒</option><option value="success">活动/成功</option></select></label>
        <label><span>开始展示</span><input v-model="startsAt" type="datetime-local" /></label>
        <label><span>结束展示</span><input v-model="endsAt" type="datetime-local" /></label>
        <div class="checks">
          <label><input v-model="published" type="checkbox" />立即发布</label>
          <label><input v-model="pinned" type="checkbox" />置顶</label>
        </div>
      </div>

      <p v-if="message" class="message success">{{ message }}</p>
      <p v-if="errorMessage" class="message error">{{ errorMessage }}</p>
      <button type="button" class="primary" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : editingId ? '保存修改' : '发布公告' }}
      </button>
    </section>

    <section class="list-card">
      <header><div><span>PUBLISHED / DRAFT</span><h2>公告列表</h2></div><button type="button" class="soft" :disabled="loading" @click="load">刷新</button></header>
      <div v-if="loading" class="empty">正在读取…</div>
      <div v-else-if="!records.length" class="empty">暂无公告</div>
      <div v-else class="announcement-list">
        <article v-for="item in records" :key="item.id">
          <div class="record-main">
            <div class="record-tags">
              <i :class="item.kind">{{ item.kind === 'warning' ? '提醒' : item.kind === 'success' ? '活动' : '普通' }}</i>
              <i v-if="item.pinned">置顶</i>
              <i :class="item.published ? 'online' : 'offline'">{{ item.published ? '已发布' : '草稿' }}</i>
            </div>
            <strong>{{ item.title }}</strong>
            <p>{{ item.content }}</p>
            <small>更新：{{ new Date(item.updatedAt).toLocaleString() }}</small>
          </div>
          <div class="record-actions">
            <button type="button" @click="edit(item)">编辑</button>
            <button type="button" @click="togglePublished(item)">{{ item.published ? '下线' : '发布' }}</button>
            <button type="button" class="danger" @click="remove(item)">删除</button>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.announcement-admin { display: grid; grid-template-columns: minmax(360px,.8fr) minmax(0,1.25fr); gap: 16px; }
.editor-card,.list-card { border: 1px solid #e7e9ef; border-radius: 15px; background: #fff; padding: 18px; box-shadow: 0 6px 18px rgba(30,36,52,.03); }
header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
header span { color: #7b70ca; font-size: 9px; font-weight: 800; letter-spacing: .13em; }
header h2 { margin: 4px 0 0; color: #262a38; font-size: 16px; }
header p { margin: 5px 0 0; color: #8a909c; font-size: 10.5px; }
.form-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; margin-top: 16px; }
.form-grid .wide { grid-column: 1 / -1; }
label { display: grid; gap: 5px; color: #6c7380; font-size: 10.5px; font-weight: 700; }
input,textarea,select { width: 100%; box-sizing: border-box; border: 1px solid #dfe2e8; border-radius: 8px; outline: none; background: #fff; padding: 8px 9px; color: #343845; font-size: 11px; }
input,select { min-height: 36px; } textarea { resize: vertical; }
.checks { display: flex; align-items: end; gap: 14px; padding-bottom: 8px; }
.checks label { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.checks input { width: 14px; min-height: auto; height: 14px; }
button { min-height: 33px; border: 1px solid #dfe2e8; border-radius: 8px; background: #fff; padding: 0 11px; color: #444957; font-size: 10.5px; font-weight: 700; cursor: pointer; }
button.primary { margin-top: 12px; border-color: #272a3a; background: #272a3a; color: #fff; }
button.danger { border-color: #efc4be; color: #ac4037; }
button:disabled { opacity: .55; cursor: not-allowed; }
.message { margin: 10px 0 0; border-radius: 8px; padding: 8px 9px; font-size: 10.5px; }.message.success{background:#eff8f3;color:#28704f}.message.error{background:#fff1ef;color:#a93e35}
.announcement-list { display: grid; margin-top: 12px; }
.announcement-list article { display: grid; grid-template-columns: 1fr auto; gap: 14px; padding: 14px 0; border-top: 1px solid #eef0f3; }
.announcement-list article:first-child { border-top: 0; }
.record-main { min-width: 0; }.record-main>strong{display:block;margin-top:7px;color:#2e3240;font-size:12.5px}.record-main p{margin:5px 0;color:#727987;font-size:10.5px;line-height:1.5;white-space:pre-wrap}.record-main small{color:#a0a5ae;font-size:9.5px}
.record-tags { display: flex; gap: 5px; flex-wrap: wrap; }.record-tags i{border-radius:999px;background:#f1f2f6;padding:3px 7px;color:#6f7580;font-size:9px;font-style:normal}.record-tags i.warning{background:#fff5df;color:#9a681e}.record-tags i.success,.record-tags i.online{background:#eaf7ef;color:#2b7954}.record-tags i.offline{background:#f2f3f5;color:#888d96}
.record-actions { display: flex; align-items: start; gap: 6px; }
.empty { padding: 40px 10px; text-align: center; color: #999eaa; font-size: 11px; }
@media(max-width:1050px){.announcement-admin{grid-template-columns:1fr}}@media(max-width:650px){.form-grid{grid-template-columns:1fr}.form-grid .wide{grid-column:auto}.announcement-list article{grid-template-columns:1fr}.record-actions{justify-content:flex-start}}
</style>

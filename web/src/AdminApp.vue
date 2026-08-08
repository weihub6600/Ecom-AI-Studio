<script setup lang="ts">
import RegistrationSettingsPanel from "./components/RegistrationSettingsPanel.vue";
import InvitationSettingsPanel from "./components/InvitationSettingsPanel.vue";
import { computed, onMounted, ref } from "vue";
import { ApiError, apiRequest, jsonRequest } from "./api/client";
import type {
  AdminAuditRecord,
  AdminModelSetting,
  AdminUserSummary,
  AuthUser,
  CreditRecord,
  DashboardData,
  LoginRecord,
  Pagination,
  RechargeCard,
  UsageRecord
} from "./types";
import { formatDate, formatDuration, formatPoints } from "./utils/format";
import ApiProviderManager from "./components/ApiProviderManager.vue";
import AdminAnnouncementManager from "./components/AdminAnnouncementManager.vue";
import AdminGalleryManager from "./components/AdminGalleryManager.vue";
import AdminStoragePackageManager from "./components/AdminStoragePackageManager.vue";
import AdminUserAccountTools from "./components/AdminUserAccountTools.vue";
import AdminTaskManager from "./components/AdminTaskManager.vue";

type Section = "dashboard" | "tasks" | "announcements" | "gallery" | "storage" | "users" | "cards" | "models" | "audit" | "providers";
type DetailTab = "usage" | "credits" | "logins";

const currentUser = ref<AuthUser | null>(null);
const booting = ref(true);
const denied = ref(false);
const activeSection = ref<Section>("dashboard");
const loading = ref(false);
const errorMessage = ref("");
const successMessage = ref("");

const dashboard = ref<DashboardData | null>(null);

const users = ref<AdminUserSummary[]>([]);
const usersPagination = ref<Pagination>(emptyPagination());
const userSearch = ref("");
const userStatus = ref("");
const selectedUser = ref<AdminUserSummary | null>(null);
const usernameDraft = ref("");
const creditAmount = ref("10");
const creditNote = ref("");
const detailTab = ref<DetailTab>("usage");
const detailRecords = ref<Array<UsageRecord | CreditRecord | LoginRecord>>([]);
const detailPagination = ref<Pagination>(emptyPagination());
const detailLoading = ref(false);

const cards = ref<RechargeCard[]>([]);
const cardsPagination = ref<Pagination>(emptyPagination());
const cardSearch = ref("");
const cardStatus = ref("");
const cardPoints = ref("10");
const cardQuantity = ref(1);
const generatedCards = ref<RechargeCard[]>([]);

const modelSettings = ref<AdminModelSetting[]>([]);
const modelDrafts = ref<Record<string, { enabled: boolean; points: string }>>({});
const savingModelKey = ref("");

const auditRecords = ref<AdminAuditRecord[]>([]);
const auditPagination = ref<Pagination>(emptyPagination());
const auditSearch = ref("");
const auditAction = ref("");

const sections: Array<{ id: Section; label: string; hint: string }> = [
  { id: "dashboard", label: "数据总览", hint: "运营与系统状态" },
  { id: "tasks", label: "任务运维", hint: "健康、异常与恢复" },
  { id: "announcements", label: "公告管理", hint: "首页通知与发布" },
  { id: "gallery", label: "灵感广场", hint: "投稿审核与精选" },
  { id: "storage", label: "存储权益", hint: "额度、期限与方案" },
  { id: "users", label: "用户管理", hint: "审核、积分与记录" },
  { id: "cards", label: "卡密管理", hint: "生成、查询与删除" },
  { id: "models", label: "模型与价格", hint: "启停和按张计费" },
  { id: "providers", label: "API 服务商", hint: "新增服务商和模型参数" },
  { id: "audit", label: "操作审计", hint: "站长操作追踪" }
];

const maxDailyUsage = computed(() => Math.max(1, ...(dashboard.value?.daily.map((item) => item.usageCount) || [1])));
const selectedUserIsSelf = computed(() => selectedUser.value?.id === currentUser.value?.id);

onMounted(bootstrap);

async function bootstrap() {
  booting.value = true;
  try {
    const data = await apiRequest<{ user: AuthUser }>("/api/auth/me");
    if (data.user.role !== "admin") {
      denied.value = true;
      return;
    }
    currentUser.value = data.user;
    await Promise.all([loadDashboard(), loadUsers(1)]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      window.location.href = "/";
      return;
    }
    denied.value = true;
    errorMessage.value = messageOf(error, "无法读取站长账号");
  } finally {
    booting.value = false;
  }
}

async function changeSection(section: Section) {
  activeSection.value = section;
  clearMessages();
  if (section === "dashboard") await loadDashboard();
  if (section === "users" && users.value.length === 0) await loadUsers(1);
  if (section === "cards") await loadCards(1);
  if (section === "models") await loadModels();
  if (section === "audit") await loadAudit(1);
}

async function loadDashboard() {
  await runLoading(async () => {
    dashboard.value = await apiRequest<DashboardData>("/api/admin/dashboard");
  }, "读取数据总览失败");
}

async function loadUsers(page = usersPagination.value.page || 1) {
  await runLoading(async () => {
    const query = queryString({ page, pageSize: 20, search: userSearch.value, status: userStatus.value });
    const data = await apiRequest<{ users: AdminUserSummary[]; pagination: Pagination }>(`/api/admin/users?${query}`);
    users.value = data.users;
    usersPagination.value = data.pagination;
    if (selectedUser.value) {
      selectedUser.value = users.value.find((item) => item.id === selectedUser.value?.id) || selectedUser.value;
    }
  }, "读取用户列表失败");
}

async function selectUser(user: AdminUserSummary) {
  selectedUser.value = user;
  usernameDraft.value = user.username;
  detailTab.value = "usage";
  await loadUserDetails(1);
}

async function loadUserDetails(page = 1) {
  if (!selectedUser.value) return;
  detailLoading.value = true;
  errorMessage.value = "";
  try {
    const endpoint = detailTab.value === "usage" ? "usage" : detailTab.value === "credits" ? "credits" : "logins";
    const data = await apiRequest<{ records: Array<UsageRecord | CreditRecord | LoginRecord>; pagination: Pagination }>(
      `/api/admin/users/${encodeURIComponent(selectedUser.value.id)}/${endpoint}?${queryString({ page, pageSize: 20 })}`
    );
    detailRecords.value = data.records;
    detailPagination.value = data.pagination;
  } catch (error) {
    handleApiError(error, "读取用户详情失败");
  } finally {
    detailLoading.value = false;
  }
}

async function switchDetailTab(tab: DetailTab) {
  detailTab.value = tab;
  await loadUserDetails(1);
}

async function saveUsername() {
  if (!selectedUser.value) return;
  const username = usernameDraft.value.trim();
  if (!/^[A-Za-z0-9_\u4e00-\u9fff]{2,32}$/u.test(username)) {
    errorMessage.value = "用户名需为 2–32 位中文、字母、数字或下划线";
    return;
  }
  await updateUser({ username });
}

async function setUserStatus(status: AdminUserSummary["status"]) {
  if (!selectedUser.value) return;
  const label = status === "active" ? "启用" : status === "disabled" ? "封禁" : status === "rejected" ? "拒绝" : "退回待审核";
  if (!window.confirm(`确定${label}用户“${selectedUser.value.username}”吗？`)) return;
  await updateUser({ status });
}

async function updateUser(payload: { username?: string; status?: AdminUserSummary["status"] }) {
  if (!selectedUser.value) return;
  await runLoading(async () => {
    const data = await apiRequest<{ user: AdminUserSummary }>(
      `/api/admin/users/${encodeURIComponent(selectedUser.value!.id)}`,
      jsonRequest(payload, "PATCH")
    );
    selectedUser.value = { ...selectedUser.value!, ...data.user };
    const index = users.value.findIndex((item) => item.id === data.user.id);
    if (index >= 0) users.value[index] = { ...users.value[index]!, ...data.user };
    usernameDraft.value = data.user.username;
    successMessage.value = "用户资料已更新";
  }, "更新用户失败");
}

function handleAdminUserToolsUpdated(user: AdminUserSummary) {
  selectedUser.value = selectedUser.value
    ? { ...selectedUser.value, ...user }
    : user;
  const index = users.value.findIndex((item) => item.id === user.id);
  if (index >= 0) users.value[index] = { ...users.value[index]!, ...user };
}

async function adjustCredits(direction: 1 | -1) {
  if (!selectedUser.value) return;
  const amount = Number(creditAmount.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    errorMessage.value = "请输入大于 0 的积分数值";
    return;
  }
  const signed = amount * direction;
  const verb = direction > 0 ? "增加" : "扣减";
  if (!window.confirm(`确定为“${selectedUser.value.username}”${verb} ${formatPoints(amount)} 积分吗？`)) return;
  await runLoading(async () => {
    const data = await apiRequest<{ user: AdminUserSummary }>(
      `/api/admin/users/${encodeURIComponent(selectedUser.value!.id)}/credits`,
      jsonRequest({ amount: signed, note: creditNote.value.trim() || `站长${verb}积分` })
    );
    selectedUser.value = { ...selectedUser.value!, ...data.user };
    const index = users.value.findIndex((item) => item.id === data.user.id);
    if (index >= 0) users.value[index] = { ...users.value[index]!, ...data.user };
    successMessage.value = `${verb}积分成功，当前余额 ${formatPoints(data.user.credits)}`;
    await loadUserDetails(detailTab.value === "credits" ? 1 : detailPagination.value.page);
  }, `${verb}积分失败`);
}

async function forceLogout() {
  if (!selectedUser.value || selectedUserIsSelf.value) return;
  if (!window.confirm(`确定强制退出“${selectedUser.value.username}”的全部设备吗？`)) return;
  await runLoading(async () => {
    await apiRequest(`/api/admin/users/${encodeURIComponent(selectedUser.value!.id)}/logout`, { method: "POST" });
    successMessage.value = "该用户的全部登录会话已失效";
  }, "强制退出失败");
}

async function loadCards(page = cardsPagination.value.page || 1) {
  await runLoading(async () => {
    const data = await apiRequest<{ cards: RechargeCard[]; pagination: Pagination }>(
      `/api/admin/cards?${queryString({ page, pageSize: 24, search: cardSearch.value, status: cardStatus.value })}`
    );
    cards.value = data.cards;
    cardsPagination.value = data.pagination;
  }, "读取卡密列表失败");
}

async function generateCards() {
  const points = Number(cardPoints.value);
  if (!Number.isFinite(points) || points <= 0) {
    errorMessage.value = "卡密积分面额必须大于 0";
    return;
  }
  if (!Number.isInteger(cardQuantity.value) || cardQuantity.value < 1 || cardQuantity.value > 200) {
    errorMessage.value = "单次生成数量需为 1–200 张";
    return;
  }
  await runLoading(async () => {
    const data = await apiRequest<{ cards: RechargeCard[] }>("/api/admin/cards", jsonRequest({ points, quantity: cardQuantity.value }));
    generatedCards.value = data.cards;
    successMessage.value = `已生成 ${data.cards.length} 张卡密，完整卡密只显示本次，请立即复制或下载。`;
    await loadCards(1);
  }, "生成卡密失败");
}

async function deleteCard(card: RechargeCard) {
  if (card.status !== "unused" || !window.confirm(`确定删除卡密 ${card.codePreview} 吗？`)) return;
  await runLoading(async () => {
    await apiRequest(`/api/admin/cards/${encodeURIComponent(card.id)}`, { method: "DELETE" });
    successMessage.value = "未使用卡密已删除";
    await loadCards(cardsPagination.value.page);
  }, "删除卡密失败");
}

async function copyGeneratedCards() {
  const text = generatedCards.value.map((item) => `${item.code}\t${formatPoints(item.points)}积分`).join("\n");
  if (!text) return;
  await navigator.clipboard.writeText(text);
  successMessage.value = "完整卡密已复制到剪贴板";
}

function downloadGeneratedCards() {
  const rows = generatedCards.value.map((item) => `${item.code}\t${formatPoints(item.points)}积分`).join("\r\n");
  if (!rows) return;
  const blob = new Blob([`卡密\t积分面额\r\n${rows}\r\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `BJR卡密_${Date.now()}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadModels() {
  await runLoading(async () => {
    const data = await apiRequest<{ models: AdminModelSetting[] }>("/api/admin/models");
    modelSettings.value = data.models;
    modelDrafts.value = Object.fromEntries(data.models.map((item) => [modelKey(item), { enabled: item.enabled, points: String(item.points) }]));
  }, "读取模型设置失败");
}

async function saveModel(model: AdminModelSetting) {
  const key = modelKey(model);
  const draft = modelDrafts.value[key];
  if (!draft) return;
  const points = Number(draft.points);
  if (!Number.isFinite(points) || points < 0) {
    errorMessage.value = "积分价格必须为大于或等于 0 的数字";
    return;
  }
  savingModelKey.value = key;
  clearMessages();
  try {
    const data = await apiRequest<{ model: AdminModelSetting }>(
      `/api/admin/models/${encodeURIComponent(model.provider)}/${encodeURIComponent(model.model)}`,
      jsonRequest({ enabled: draft.enabled, points }, "PATCH")
    );
    const index = modelSettings.value.findIndex((item) => modelKey(item) === key);
    if (index >= 0) modelSettings.value[index] = data.model;
    modelDrafts.value[key] = { enabled: data.model.enabled, points: String(data.model.points) };
    successMessage.value = `${data.model.name} 设置已保存`;
  } catch (error) {
    handleApiError(error, "保存模型设置失败");
  } finally {
    savingModelKey.value = "";
  }
}

async function loadAudit(page = auditPagination.value.page || 1) {
  await runLoading(async () => {
    const data = await apiRequest<{ records: AdminAuditRecord[]; pagination: Pagination }>(
      `/api/admin/audit?${queryString({ page, pageSize: 30, search: auditSearch.value, action: auditAction.value })}`
    );
    auditRecords.value = data.records;
    auditPagination.value = data.pagination;
  }, "读取操作审计失败");
}

async function logout() {
  try { await apiRequest("/api/auth/logout", { method: "POST" }); }
  finally { window.location.href = "/"; }
}

async function runLoading(task: () => Promise<void>, fallback: string) {
  loading.value = true;
  clearMessages();
  try { await task(); }
  catch (error) { handleApiError(error, fallback); }
  finally { loading.value = false; }
}

function handleApiError(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 401) {
    window.location.href = "/";
    return;
  }
  if (error instanceof ApiError && error.status === 403) denied.value = true;
  errorMessage.value = messageOf(error, fallback);
}
function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function clearMessages() { errorMessage.value = ""; successMessage.value = ""; }
function emptyPagination(): Pagination { return { page: 1, pageSize: 20, total: 0, totalPages: 1 }; }
function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}
function modelKey(model: Pick<AdminModelSetting, "provider" | "model">) { return `${model.provider}:${model.model}`; }
function modelDraft(model: AdminModelSetting) { return modelDrafts.value[modelKey(model)] || (modelDrafts.value[modelKey(model)] = { enabled: model.enabled, points: String(model.points) }); }
function statusLabel(status: AdminUserSummary["status"]) { return status === "pending" ? "待审核" : status === "active" ? "已启用" : status === "disabled" ? "已封禁" : "已拒绝"; }

function loginClientLabel(userAgent?: string) {
  if (!userAgent) return "未记录设备";

  const browser =
    /Edg\//.test(userAgent)
      ? "Edge"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "浏览器";

  const system =
    /Windows/i.test(userAgent)
      ? "Windows"
      : /Macintosh|Mac OS X/i.test(userAgent)
        ? "macOS"
        : /Android/i.test(userAgent)
          ? "Android"
          : /iPhone|iPad/i.test(userAgent)
            ? "iOS/iPadOS"
            : /Linux/i.test(userAgent)
              ? "Linux"
              : "未知系统";

  return `${browser} · ${system}`;
}

function usageStatusLabel(status: UsageRecord["status"]) { return status === "success" ? "成功" : status === "submitted" ? "处理中" : "失败"; }
function creditTitle(record: CreditRecord) {
  if (record.note?.startsWith("存储权益兑换：")) return "存储权益兑换";
  if (record.note === "新用户注册赠送") return "新用户注册赠送";
  return record.type === "generation_charge" ? "AI 生图扣费" : record.type === "generation_refund" ? "生成退款" : record.type === "card_recharge" ? "卡密充值" : record.amount >= 0 ? "站长增加积分" : "站长扣减积分";
}
function auditLabel(action: string) {
  const labels: Record<string, string> = { "user.update": "更新用户", "user.force_logout": "强制退出", "credit.adjust": "调整积分", "card.generate": "生成卡密", "card.delete": "删除卡密", "model.update": "模型设置", "gallery.review": "作品审核", "storage.settings": "存储策略", "storage.package.create": "创建存储方案", "storage.package.update": "更新存储方案", "storage.package.delete": "删除存储方案" };
  return labels[action] || action;
}
</script>

<template>
  <div v-if="booting" class="admin-v10-gate"><div class="admin-v10-loader"></div><strong>正在进入站长后台…</strong></div>
  <div v-else-if="denied" class="admin-v10-gate denied">
    <strong>无权访问站长后台</strong><p>{{ errorMessage || '请使用站长账号登录。' }}</p><a href="/">返回创作工作台</a>
  </div>

  <div v-else class="admin-v10-shell">
    <aside class="admin-v10-sidebar">
      <a class="admin-v10-brand" href="/"><span>Z</span><div><strong>ZHE AI</strong><small>ADMIN CONSOLE</small></div></a>
      <nav>
        <button v-for="item in sections" :key="item.id" type="button" :class="{ active: activeSection === item.id }" @click="changeSection(item.id)">
          <span>{{ item.label.slice(0, 1) }}</span><div><strong>{{ item.label }}</strong><small>{{ item.hint }}</small></div>
        </button>
      </nav>
      <div class="admin-v10-sidebar-bottom">
        <a href="/">返回创作工作台</a>
        <button type="button" @click="logout">退出登录</button>
      </div>
    </aside>

    <main class="admin-v10-main">
      <header class="admin-v10-topbar">
        <div><span>V13.7 · 云端后台</span><h1>{{ sections.find(item => item.id === activeSection)?.label }}</h1></div>
        <div class="admin-v10-account"><span>{{ currentUser?.username.slice(0, 1).toUpperCase() }}</span><div><strong>{{ currentUser?.username }}</strong><small>站长账号</small></div></div>
      </header>

      <div v-if="successMessage" class="admin-v10-message success">{{ successMessage }}<button @click="successMessage = ''">×</button></div>
      <div v-if="errorMessage" class="admin-v10-message error">{{ errorMessage }}<button @click="errorMessage = ''">×</button></div>

      <section v-if="activeSection === 'dashboard'" class="admin-v10-section">
        <div v-if="!dashboard" class="admin-v10-empty">正在读取数据…</div>
        <template v-else>
          <div class="admin-v10-metrics">
            <article><span>总用户</span><strong>{{ dashboard.users.total }}</strong><small>待审核 {{ dashboard.users.pending }}</small></article>
            <article><span>今日生图任务</span><strong>{{ dashboard.today.usage }}</strong><small>成功 {{ dashboard.today.success }} · 失败 {{ dashboard.today.failed }}</small></article>
            <article><span>今日生成图片</span><strong>{{ dashboard.today.images }}</strong><small>平均耗时 {{ formatDuration(dashboard.today.averageDurationMs) }}</small></article>
            <article><span>今日消费积分</span><strong>{{ formatPoints(dashboard.today.spentPoints) }}</strong><small>充值 {{ formatPoints(dashboard.today.rechargedPoints) }}</small></article>
            <article><span>云端历史</span><strong>{{ dashboard.storage.histories }}</strong><small>保存图片 {{ dashboard.storage.images }}</small></article>
          </div>
          <div class="admin-v10-dashboard-grid">
            <article class="admin-v10-card chart-card">
              <div class="admin-v10-card-title"><div><strong>最近 7 天调用趋势</strong><span>按生图任务统计</span></div><button @click="loadDashboard">刷新</button></div>
              <div class="admin-v10-bars">
                <div v-for="item in dashboard.daily" :key="item.label"><span><i :style="{ height: `${Math.max(5, item.usageCount / maxDailyUsage * 100)}%` }"></i></span><strong>{{ item.usageCount }}</strong><small>{{ item.label }}</small></div>
              </div>
            </article>
            <article class="admin-v10-card">
              <div class="admin-v10-card-title"><div><strong>近 30 天模型使用</strong><span>调用次数与图片数量</span></div></div>
              <div class="admin-v10-rank-list">
                <div v-for="(item, index) in dashboard.models" :key="`${item.provider}-${item.model}`"><b>{{ index + 1 }}</b><span><strong>{{ item.model }}</strong><small>{{ item.provider }}</small></span><em>{{ item.usageCount }} 次 · {{ item.imageCount }} 张</em></div>
                <p v-if="!dashboard.models.length">暂无调用数据</p>
              </div>
            </article>
          </div>
        </template>
      </section>

      <section v-else-if="activeSection === 'tasks'" class="admin-v10-section">
        <AdminTaskManager />
      </section>

      <section v-else-if="activeSection === 'announcements'" class="admin-v10-section">
        <AdminAnnouncementManager />
      </section>

      <section v-else-if="activeSection === 'gallery'" class="admin-v10-section">
        <AdminGalleryManager />
      </section>

      <section v-else-if="activeSection === 'storage'" class="admin-v10-section">
        <AdminStoragePackageManager />
      </section>

      <section v-else-if="activeSection === 'users'" class="admin-v10-section">
        <RegistrationSettingsPanel />
        <InvitationSettingsPanel />
        <div class="admin-v10-toolbar">
          <input v-model="userSearch" type="search" placeholder="搜索用户名或昵称" @keyup.enter="loadUsers(1)" />
          <select v-model="userStatus"><option value="">全部状态</option><option value="pending">待审核</option><option value="active">已启用</option><option value="disabled">已封禁</option><option value="rejected">已拒绝</option></select>
          <button @click="loadUsers(1)">查询</button><span>共 {{ usersPagination.total }} 位用户</span>
        </div>
        <div class="admin-v10-user-layout">
          <div class="admin-v10-card admin-v10-table-card">
            <table><thead><tr><th>用户</th><th>状态</th><th>积分</th><th>调用</th><th>最近登录</th></tr></thead>
              <tbody><tr v-for="user in users" :key="user.id" :class="{ selected: selectedUser?.id === user.id }" @click="selectUser(user)">
                <td><div class="admin-v10-user-cell"><span>{{ user.username.slice(0,1).toUpperCase() }}</span><div><strong>{{ user.nickname || user.username }}</strong><small>{{ user.nickname ? `账号 ${user.username}` : (user.role === 'admin' ? '站长' : formatDate(user.createdAt)) }}</small></div></div></td>
                <td><i class="status-chip" :class="user.status">{{ statusLabel(user.status) }}</i></td><td>{{ user.role === 'admin' ? '不限' : formatPoints(user.credits) }}</td><td>{{ user.usageCount }}</td><td>{{ formatDate(user.lastLoginAt) }}</td>
              </tr></tbody></table>
            <div v-if="!users.length" class="admin-v10-empty">没有匹配用户</div>
            <div class="admin-v10-pagination"><button :disabled="usersPagination.page <= 1" @click="loadUsers(usersPagination.page - 1)">上一页</button><span>{{ usersPagination.page }} / {{ usersPagination.totalPages }}</span><button :disabled="usersPagination.page >= usersPagination.totalPages" @click="loadUsers(usersPagination.page + 1)">下一页</button></div>
          </div>

          <aside class="admin-v10-card admin-v10-user-detail">
            <div v-if="!selectedUser" class="admin-v10-empty tall">点击左侧用户查看详情</div>
            <template v-else>
              <div class="admin-v10-profile"><span>{{ selectedUser.username.slice(0,1).toUpperCase() }}</span><div><h2>{{ selectedUser.username }}</h2><p>注册 {{ formatDate(selectedUser.createdAt) }}</p></div><i class="status-chip" :class="selectedUser.status">{{ statusLabel(selectedUser.status) }}</i></div>
              <div class="admin-v10-balance"><span>当前积分</span><strong>{{ selectedUser.role === 'admin' ? '不限' : formatPoints(selectedUser.credits) }}</strong><small>登录 {{ selectedUser.loginCount }} 次 · 生图 {{ selectedUser.usageCount }} 次</small></div>
              <AdminUserAccountTools :user="selectedUser" @user-updated="handleAdminUserToolsUpdated" />
              <div class="admin-v10-form-block"><label>修改用户名</label><div><input v-model="usernameDraft" maxlength="32" /><button @click="saveUsername">保存</button></div></div>
              <div v-if="selectedUser.role !== 'admin'" class="admin-v10-form-block"><label>积分调整</label><div><input v-model="creditAmount" type="number" min="0.01" step="0.01" /><input v-model="creditNote" placeholder="备注" /></div><div class="action-row"><button class="positive" @click="adjustCredits(1)">增加积分</button><button class="danger" @click="adjustCredits(-1)">扣减积分</button></div></div>
              <div v-if="selectedUser.role !== 'admin'" class="action-row status-actions"><button v-if="selectedUser.status !== 'active'" class="positive" @click="setUserStatus('active')">启用账号</button><button v-if="selectedUser.status === 'pending'" @click="setUserStatus('rejected')">拒绝申请</button><button v-if="selectedUser.status === 'active'" class="danger" @click="setUserStatus('disabled')">封禁账号</button><button v-if="selectedUser.status === 'rejected'" @click="setUserStatus('pending')">退回待审核</button><button v-if="!selectedUserIsSelf" @click="forceLogout">强制退出</button></div>
              <div class="admin-v10-tabs"><button :class="{active:detailTab==='usage'}" @click="switchDetailTab('usage')">AI 使用</button><button :class="{active:detailTab==='credits'}" @click="switchDetailTab('credits')">积分明细</button><button :class="{active:detailTab==='logins'}" @click="switchDetailTab('logins')">登录记录</button></div>
              <div v-if="detailLoading" class="admin-v10-empty">读取中…</div>
              <div v-else class="admin-v10-records">
                <article v-for="record in detailRecords" :key="record.id">
                  <template v-if="detailTab === 'usage'"><div><strong>{{ (record as UsageRecord).model }}</strong><i :class="(record as UsageRecord).status">{{ usageStatusLabel((record as UsageRecord).status) }}</i></div><p>{{ (record as UsageRecord).provider }} · {{ (record as UsageRecord).imageCount }} 张 · {{ (record as UsageRecord).size }}</p><small>{{ formatDate(record.createdAt) }} · 积分 {{ formatPoints((record as UsageRecord).pointsCost) }}</small></template>
                  <template v-else-if="detailTab === 'credits'"><div><strong>{{ creditTitle(record as CreditRecord) }}</strong><em :class="(record as CreditRecord).amount >= 0 ? 'plus' : 'minus'">{{ (record as CreditRecord).amount >= 0 ? '+' : '' }}{{ formatPoints((record as CreditRecord).amount) }}</em></div><p>{{ (record as CreditRecord).note || '积分变动' }}</p><small>{{ formatDate(record.createdAt) }} · 余额 {{ formatPoints((record as CreditRecord).balanceAfter) }}</small></template>
                  <template v-else><div><strong>{{ (record as LoginRecord).success ? '登录成功' : '登录失败' }}</strong><i :class="(record as LoginRecord).success ? 'success' : 'failed'">{{ (record as LoginRecord).success ? '成功' : '失败' }}</i></div><p>{{ (record as LoginRecord).clientIp || '未记录 IP' }} · {{ (record as LoginRecord).reason || '账号验证通过' }}</p><small :title="(record as LoginRecord).userAgent || '未记录 User-Agent'">{{ formatDate(record.createdAt) }} · {{ loginClientLabel((record as LoginRecord).userAgent) }}</small></template>
                </article>
                <div v-if="!detailRecords.length" class="admin-v10-empty">暂无记录</div>
              </div>
              <div class="admin-v10-pagination compact"><button :disabled="detailPagination.page <= 1" @click="loadUserDetails(detailPagination.page - 1)">上一页</button><span>{{ detailPagination.page }} / {{ detailPagination.totalPages }}</span><button :disabled="detailPagination.page >= detailPagination.totalPages" @click="loadUserDetails(detailPagination.page + 1)">下一页</button></div>
            </template>
          </aside>
        </div>
      </section>

      <section v-else-if="activeSection === 'cards'" class="admin-v10-section">
        <div class="admin-v10-card card-generator"><div><span>RECHARGE CARDS</span><h2>批量生成充值卡密</h2><p>完整卡密只在生成后显示一次。</p></div><div><label>积分面额<input v-model="cardPoints" type="number" min="0.01" step="0.01" /></label><label>生成数量<input v-model.number="cardQuantity" type="number" min="1" max="200" /></label><button @click="generateCards">生成卡密</button></div></div>
        <div v-if="generatedCards.length" class="admin-v10-card generated-box"><div class="admin-v10-card-title"><div><strong>本次完整卡密</strong><span>请立即保存</span></div><div><button @click="copyGeneratedCards">复制全部</button><button @click="downloadGeneratedCards">下载 TXT</button></div></div><div><code v-for="card in generatedCards" :key="card.id">{{ card.code }} <b>{{ formatPoints(card.points) }}积分</b></code></div></div>
        <div class="admin-v10-toolbar"><input v-model="cardSearch" type="search" placeholder="搜索卡密、创建人或充值用户" @keyup.enter="loadCards(1)" /><select v-model="cardStatus"><option value="">全部状态</option><option value="unused">未使用</option><option value="redeemed">已充值</option></select><button @click="loadCards(1)">查询</button><span>共 {{ cardsPagination.total }} 张</span></div>
        <div class="admin-v10-card card-grid"><article v-for="card in cards" :key="card.id"><div><code>{{ card.codePreview }}</code><i :class="card.status">{{ card.status === 'unused' ? '未使用' : '已充值' }}</i></div><strong>{{ formatPoints(card.points) }} 积分</strong><p>生成：{{ formatDate(card.createdAt) }} · {{ card.createdBy }}</p><small v-if="card.redeemedAt">充值：{{ formatDate(card.redeemedAt) }} · {{ card.redeemedByUsername }}</small><button v-if="card.status === 'unused'" class="danger-text" @click="deleteCard(card)">删除未使用卡密</button></article><div v-if="!cards.length" class="admin-v10-empty">暂无卡密</div></div>
        <div class="admin-v10-pagination"><button :disabled="cardsPagination.page <= 1" @click="loadCards(cardsPagination.page - 1)">上一页</button><span>{{ cardsPagination.page }} / {{ cardsPagination.totalPages }}</span><button :disabled="cardsPagination.page >= cardsPagination.totalPages" @click="loadCards(cardsPagination.page + 1)">下一页</button></div>
      </section>

      <section v-else-if="activeSection === 'models'" class="admin-v10-section">
        <div class="admin-v10-section-head"><div><h2>模型启停与按张价格</h2><p>保存后立即影响前台模型列表和下一次生图扣费。</p></div><button @click="loadModels">刷新</button></div>
        <div class="model-setting-grid"><article v-for="model in modelSettings" :key="modelKey(model)" class="admin-v10-card"><div class="model-setting-title"><span>{{ model.providerName.slice(0,1) }}</span><div><strong>{{ model.providerName }} · {{ model.name }}</strong><small>{{ model.model }}</small></div><i :class="model.configured ? 'ready' : 'offline'">{{ model.configured ? 'API 已配置' : '缺少 API Key' }}</i></div><p>{{ model.description }}</p><div class="model-setting-meta"><span>最多 {{ model.maxOutputImages }} 张</span><span>{{ model.asynchronous ? '异步任务' : '同步任务' }}</span></div><div class="model-setting-form"><label><input v-model="modelDraft(model).enabled" type="checkbox" />允许前台使用</label><label>单张积分<input v-model="modelDraft(model).points" type="number" min="0" step="0.01" /></label></div><button class="save-model" :disabled="savingModelKey === modelKey(model)" @click="saveModel(model)">{{ savingModelKey === modelKey(model) ? '保存中…' : '保存设置' }}</button></article></div>
      </section>

            <section
        v-else-if="activeSection === 'providers'"
        class="admin-v10-section"
      >
        <ApiProviderManager />
      </section>

<section v-else class="admin-v10-section">
        <div class="admin-v10-toolbar"><input v-model="auditSearch" type="search" placeholder="搜索站长、对象或操作内容" @keyup.enter="loadAudit(1)" /><select v-model="auditAction"><option value="">全部操作</option><option value="user.update">更新用户</option><option value="user.force_logout">强制退出</option><option value="credit.adjust">调整积分</option><option value="card.generate">生成卡密</option><option value="card.delete">删除卡密</option><option value="model.update">模型设置</option></select><button @click="loadAudit(1)">查询</button><span>共 {{ auditPagination.total }} 条</span></div>
        <div class="admin-v10-card audit-list"><article v-for="record in auditRecords" :key="record.id"><div class="audit-icon">{{ auditLabel(record.action).slice(0,1) }}</div><div><div><strong>{{ auditLabel(record.action) }}</strong><i>{{ record.actorUsername }}</i></div><p>{{ record.summary }}</p><small>{{ formatDate(record.createdAt) }} · {{ record.clientIp || '未记录 IP' }}<template v-if="record.targetId"> · {{ record.targetId }}</template></small></div></article><div v-if="!auditRecords.length" class="admin-v10-empty">暂无审计记录</div></div>
        <div class="admin-v10-pagination"><button :disabled="auditPagination.page <= 1" @click="loadAudit(auditPagination.page - 1)">上一页</button><span>{{ auditPagination.page }} / {{ auditPagination.totalPages }}</span><button :disabled="auditPagination.page >= auditPagination.totalPages" @click="loadAudit(auditPagination.page + 1)">下一页</button></div>
      </section>

      <div v-if="loading" class="admin-v10-loading-bar"></div>
    </main>
  </div>
</template>

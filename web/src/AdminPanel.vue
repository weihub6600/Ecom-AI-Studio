<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface AdminUserSummary {
  id: string;
  username: string;
  role: "admin" | "user";
  status: "pending" | "active" | "disabled" | "rejected";
  createdAt: string;
  approvedAt?: string;
  lastLoginAt?: string;
  credits: number;
  loginCount: number;
  usageCount: number;
  lastLoginIp?: string;
}

interface LoginRecord {
  id: string;
  username: string;
  success: boolean;
  reason?: string;
  createdAt: string;
  clientIp?: string;
  userAgent?: string;
}

interface UsageRecord {
  id: string;
  createdAt: string;
  provider: string;
  model: string;
  operation: "text-to-image" | "image-edit";
  size: string;
  prompt?: string;
  imageCount: number;
  status: "success" | "submitted" | "failed";
  durationMs?: number;
  pointsCost?: number;
  pointsRefunded?: boolean;
  error?: string;
}

interface CreditRecord {
  id: string;
  createdAt: string;
  type: "generation_charge" | "generation_refund" | "card_recharge" | "admin_adjustment";
  amount: number;
  balanceAfter: number;
  note?: string;
}

interface RechargeCard {
  id: string;
  codePreview: string;
  code?: string;
  points: number;
  createdAt: string;
  createdBy: string;
  redeemedAt?: string;
  redeemedByUsername?: string;
  status: "unused" | "redeemed";
}

const props = defineProps<{ currentUserId: string }>();
const emit = defineEmits<{
  close: [];
  userUpdated: [user: AdminUserSummary];
}>();

const mainTab = ref<"users" | "cards">("users");
const users = ref<AdminUserSummary[]>([]);
const loading = ref(true);
const errorMessage = ref("");
const successMessage = ref("");
const searchText = ref("");
const selectedUserId = ref<string | null>(null);
const detailTab = ref<"usage" | "logins" | "credits">("usage");
const usageRecords = ref<UsageRecord[]>([]);
const loginRecords = ref<LoginRecord[]>([]);
const creditRecords = ref<CreditRecord[]>([]);
const detailLoading = ref(false);
const actionLoadingId = ref<string | null>(null);
const draftNames = ref<Record<string, string>>({});
const adjustmentPoints = ref("10");
const adjustmentNote = ref("");

const cards = ref<RechargeCard[]>([]);
const cardLoading = ref(false);
const cardPoints = ref("10");
const cardQuantity = ref(1);
const generatedCards = ref<RechargeCard[]>([]);
const deletingCardId = ref<string | null>(null);

const filteredUsers = computed(() => {
  const keyword = searchText.value.trim().toLocaleLowerCase("zh-CN");
  const ordered = [...users.value].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
  return keyword ? ordered.filter((user) => user.username.toLocaleLowerCase("zh-CN").includes(keyword)) : ordered;
});

const selectedUser = computed(() => users.value.find((item) => item.id === selectedUserId.value) || null);
const pendingCount = computed(() => users.value.filter((item) => item.status === "pending").length);
const activeCount = computed(() => users.value.filter((item) => item.status === "active").length);
const disabledCount = computed(() => users.value.filter((item) => item.status === "disabled").length);
const totalUsageCount = computed(() => users.value.reduce((sum, item) => sum + item.usageCount, 0));
const unusedCardCount = computed(() => cards.value.filter((item) => item.status === "unused").length);

onMounted(async () => {
  await Promise.all([loadUsers(), loadCards()]);
});

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "操作失败");
  return data;
}

async function loadUsers() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const data = await api<{ users: AdminUserSummary[] }>("/api/admin/users");
    users.value = data.users || [];
    for (const user of users.value) draftNames.value[user.id] = user.username;
    if (!selectedUserId.value && users.value.length) {
      const first = users.value.find((item) => item.status === "pending") || users.value[0];
      if (first) await selectUser(first);
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取用户列表失败";
  } finally {
    loading.value = false;
  }
}

async function selectUser(user: AdminUserSummary) {
  selectedUserId.value = user.id;
  draftNames.value[user.id] = user.username;
  await loadDetails(user.id);
}

async function loadDetails(userId: string) {
  detailLoading.value = true;
  errorMessage.value = "";
  try {
    const [usage, logins, credits] = await Promise.all([
      api<{ records: UsageRecord[] }>(`/api/admin/users/${encodeURIComponent(userId)}/usage?limit=300`),
      api<{ records: LoginRecord[] }>(`/api/admin/users/${encodeURIComponent(userId)}/logins?limit=300`),
      api<{ records: CreditRecord[] }>(`/api/admin/users/${encodeURIComponent(userId)}/credits?limit=500`)
    ]);
    usageRecords.value = usage.records || [];
    loginRecords.value = logins.records || [];
    creditRecords.value = credits.records || [];
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取用户记录失败";
  } finally {
    detailLoading.value = false;
  }
}

async function updateUser(user: AdminUserSummary, payload: { username?: string; status?: AdminUserSummary["status"] }) {
  actionLoadingId.value = user.id;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const data = await api<{ user: AdminUserSummary }>(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    applyUpdatedUser(data.user);
    draftNames.value[user.id] = data.user.username;
    if (user.id === props.currentUserId) emit("userUpdated", data.user);
    successMessage.value = "用户资料已更新";
    await loadDetails(user.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "更新用户失败";
  } finally {
    actionLoadingId.value = null;
  }
}

function applyUpdatedUser(user: AdminUserSummary) {
  const index = users.value.findIndex((item) => item.id === user.id);
  if (index >= 0) users.value[index] = { ...users.value[index]!, ...user };
}

async function saveUsername(user: AdminUserSummary) {
  const username = (draftNames.value[user.id] || "").trim();
  if (!/^[A-Za-z0-9_\u4e00-\u9fff]{2,32}$/u.test(username)) {
    errorMessage.value = "用户名需为 2–32 位中文、字母、数字或下划线";
    return;
  }
  if (username === user.username) return;
  await updateUser(user, { username });
}

async function adjustCredits(user: AdminUserSummary, direction: 1 | -1) {
  const numeric = Number(adjustmentPoints.value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    errorMessage.value = "请输入大于 0 的积分数值";
    return;
  }
  const verb = direction > 0 ? "增加" : "扣减";
  if (!window.confirm(`确定为“${user.username}”${verb} ${formatPoints(numeric)} 积分吗？`)) return;
  actionLoadingId.value = user.id;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const data = await api<{ user: AdminUserSummary }>(`/api/admin/users/${encodeURIComponent(user.id)}/credits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: numeric * direction, note: adjustmentNote.value.trim() || `站长${verb}积分` })
    });
    applyUpdatedUser(data.user);
    if (user.id === props.currentUserId) emit("userUpdated", data.user);
    successMessage.value = `${verb}积分成功，当前余额 ${formatPoints(data.user.credits)}`;
    await loadDetails(user.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "调整积分失败";
  } finally {
    actionLoadingId.value = null;
  }
}

async function forceLogout(user: AdminUserSummary) {
  if (!window.confirm(`确定强制退出用户“${user.username}”的全部登录设备吗？`)) return;
  actionLoadingId.value = user.id;
  try {
    await api(`/api/admin/users/${encodeURIComponent(user.id)}/logout`, { method: "POST" });
    successMessage.value = "该用户的全部登录会话已失效";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "强制退出失败";
  } finally {
    actionLoadingId.value = null;
  }
}

async function loadCards() {
  cardLoading.value = true;
  try {
    const data = await api<{ cards: RechargeCard[] }>("/api/admin/cards?limit=500");
    cards.value = data.cards || [];
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取卡密列表失败";
  } finally {
    cardLoading.value = false;
  }
}

async function generateCards() {
  const points = Number(cardPoints.value);
  if (!Number.isFinite(points) || points <= 0) {
    errorMessage.value = "卡密积分面额必须大于 0";
    return;
  }
  cardLoading.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const data = await api<{ cards: RechargeCard[] }>("/api/admin/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points, quantity: cardQuantity.value })
    });
    generatedCards.value = data.cards || [];
    successMessage.value = `已生成 ${generatedCards.value.length} 张卡密。完整卡密只在本次生成结果中显示，请立即复制或下载。`;
    await loadCards();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "生成卡密失败";
  } finally {
    cardLoading.value = false;
  }
}

async function deleteCard(card: RechargeCard) {
  if (card.status !== "unused") return;

  const confirmed = window.confirm(
    `确定删除未使用卡密 ${card.codePreview} 吗？删除后不可恢复。`
  );

  if (!confirmed) return;

  deletingCardId.value = card.id;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    await api(
      `/api/admin/cards/${encodeURIComponent(card.id)}`,
      { method: "DELETE" }
    );

    cards.value = cards.value.filter(
      (item) => item.id !== card.id
    );

    generatedCards.value = generatedCards.value.filter(
      (item) => item.id !== card.id
    );

    successMessage.value = "未使用卡密已删除";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "删除卡密失败";
  } finally {
    deletingCardId.value = null;
  }
}

async function copyGeneratedCards() {  const text = generatedCards.value.map((item) => `${item.code}\t${formatPoints(item.points)}积分`).join("\n");
  if (!text) return;
  await navigator.clipboard.writeText(text);
  successMessage.value = "完整卡密已复制到剪贴板";
}

function downloadGeneratedCards() {
  const text = generatedCards.value.map((item) => `${item.code}\t${formatPoints(item.points)}积分`).join("\r\n");
  if (!text) return;
  const blob = new Blob([`卡密\t积分面额\r\n${text}\r\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `BJR卡密_${formatFileTime(new Date())}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function statusLabel(status: AdminUserSummary["status"]): string {
  if (status === "pending") return "待审核";
  if (status === "active") return "已启用";
  if (status === "disabled") return "已封禁";
  return "已拒绝";
}

function usageStatusLabel(status: UsageRecord["status"]): string {
  if (status === "success") return "成功";
  if (status === "submitted") return "处理中";
  return "失败";
}

function creditTitle(record: CreditRecord): string {
  if (record.type === "generation_charge") return "AI 生图扣费";
  if (record.type === "generation_refund") return "生成失败退款";
  if (record.type === "card_recharge") return "卡密充值";
  return record.amount >= 0 ? "站长增加积分" : "站长扣减积分";
}

function formatPoints(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(value?: number): string {
  return typeof value === "number" ? `${(value / 1000).toFixed(1)} 秒` : "—";
}

function formatFileTime(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}
</script>

<template>
  <div class="admin-overlay" @click.self="emit('close')">
    <section class="admin-dialog" role="dialog" aria-modal="true" aria-label="站长管理后台">
      <header class="admin-header">
        <div>
          <span class="admin-eyebrow">BJR AI ADMIN</span>
          <h2>站长管理后台</h2>
          <p>审核用户、管理积分和卡密，并查看 AI 使用及登录记录。</p>
        </div>
        <button type="button" class="admin-close" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <div class="admin-stats">
        <div><span>待审核</span><strong>{{ pendingCount }}</strong></div>
        <div><span>有效账号</span><strong>{{ activeCount }}</strong></div>
        <div><span>已封禁</span><strong>{{ disabledCount }}</strong></div>
        <div><span>生图调用</span><strong>{{ totalUsageCount }}</strong></div>
        <div><span>未使用卡密</span><strong>{{ unusedCardCount }}</strong></div>
      </div>

      <div class="admin-main-tabs">
        <button type="button" :class="{ active: mainTab === 'users' }" @click="mainTab = 'users'">用户管理</button>
        <button type="button" :class="{ active: mainTab === 'cards' }" @click="mainTab = 'cards'">卡密管理</button>
      </div>

      <div v-if="successMessage" class="admin-message success">{{ successMessage }}</div>
      <div v-if="errorMessage" class="admin-message error">{{ errorMessage }}<button type="button" @click="errorMessage = ''">关闭</button></div>

      <div v-if="mainTab === 'users'" class="admin-layout">
        <aside class="admin-users-panel">
          <div class="admin-list-heading"><div><strong>注册用户</strong><span>{{ filteredUsers.length }} 人</span></div><button type="button" @click="loadUsers">刷新</button></div>
          <input v-model="searchText" class="admin-search" type="search" placeholder="搜索用户名" />
          <div v-if="loading" class="admin-loading">正在读取用户数据…</div>
          <div v-else class="admin-user-list">
            <button v-for="user in filteredUsers" :key="user.id" type="button" class="admin-user-item" :class="{ active: selectedUserId === user.id, pending: user.status === 'pending' }" @click="selectUser(user)">
              <span class="admin-user-avatar">{{ user.username.slice(0, 1).toUpperCase() }}</span>
              <span class="admin-user-copy"><strong>{{ user.username }}</strong><small>{{ user.role === 'admin' ? '站长 · 不限积分' : `${formatPoints(user.credits)} 积分 · ${user.usageCount} 次使用` }}</small></span>
              <span class="admin-status" :class="user.status">{{ statusLabel(user.status) }}</span>
            </button>
            <div v-if="!filteredUsers.length" class="admin-empty">没有匹配的用户</div>
          </div>
        </aside>

        <main class="admin-detail-panel">
          <template v-if="selectedUser">
            <div class="admin-profile">
              <div><span class="admin-user-avatar large">{{ selectedUser.username.slice(0, 1).toUpperCase() }}</span><div><div class="admin-profile-title"><h3>{{ selectedUser.username }}</h3><span v-if="selectedUser.role === 'admin'" class="admin-role">站长</span><span class="admin-status" :class="selectedUser.status">{{ statusLabel(selectedUser.status) }}</span></div><p>注册于 {{ formatDate(selectedUser.createdAt) }} · 最近登录 {{ formatDate(selectedUser.lastLoginAt) }}</p></div></div>
              <button v-if="selectedUser.id !== currentUserId" type="button" class="admin-outline-button" @click="forceLogout(selectedUser)">强制退出</button>
            </div>

            <div class="admin-management-grid">
              <div class="admin-management-card">
                <label>注册用户名（仅站长可修改）</label>
                <div class="admin-inline-form"><input v-model="draftNames[selectedUser.id]" minlength="2" maxlength="32" placeholder="2–32 位中文、字母、数字或下划线" /><button type="button" :disabled="actionLoadingId === selectedUser.id" @click="saveUsername(selectedUser)">保存新用户名</button></div>
                <small>用户本人没有修改用户名的入口；修改后必须使用新用户名登录。</small>
              </div>

              <div class="admin-management-card credit-card">
                <div class="admin-balance-line"><span>当前积分</span><strong>{{ selectedUser.role === 'admin' ? '不限' : formatPoints(selectedUser.credits) }}</strong></div>
                <div class="admin-inline-form"><input v-model="adjustmentPoints" type="number" min="0.01" step="0.01" placeholder="积分数" /><input v-model="adjustmentNote" placeholder="调整备注（可选）" /></div>
                <div class="admin-credit-actions"><button type="button" class="approve" @click="adjustCredits(selectedUser, 1)">增加积分</button><button type="button" class="disable" @click="adjustCredits(selectedUser, -1)">扣减积分</button></div>
              </div>
            </div>

            <div v-if="selectedUser.role !== 'admin'" class="admin-review-actions">
              <button v-if="selectedUser.status !== 'active'" type="button" class="approve" @click="updateUser(selectedUser, { status: 'active' })">{{ selectedUser.status === 'disabled' ? '恢复账号' : '审核通过并启用' }}</button>
              <button v-if="selectedUser.status === 'pending'" type="button" class="reject" @click="updateUser(selectedUser, { status: 'rejected' })">拒绝申请</button>
              <button v-if="selectedUser.status === 'active'" type="button" class="disable" @click="updateUser(selectedUser, { status: 'disabled' })">封禁账号</button>
              <button v-if="selectedUser.status === 'rejected'" type="button" class="pending" @click="updateUser(selectedUser, { status: 'pending' })">退回待审核</button>
            </div>

            <div class="admin-record-tabs">
              <button type="button" :class="{ active: detailTab === 'usage' }" @click="detailTab = 'usage'">AI 使用 <span>{{ usageRecords.length }}</span></button>
              <button type="button" :class="{ active: detailTab === 'credits' }" @click="detailTab = 'credits'">积分明细 <span>{{ creditRecords.length }}</span></button>
              <button type="button" :class="{ active: detailTab === 'logins' }" @click="detailTab = 'logins'">登录记录 <span>{{ loginRecords.length }}</span></button>
            </div>

            <div v-if="detailLoading" class="admin-loading detail">正在读取详细记录…</div>
            <div v-else-if="detailTab === 'usage'" class="admin-record-list">
              <article v-for="record in usageRecords" :key="record.id" class="admin-record-card"><div class="admin-record-top"><strong>{{ record.model }}</strong><span class="admin-usage-status" :class="record.status">{{ usageStatusLabel(record.status) }}</span></div><p>{{ record.provider }} · {{ record.operation === 'image-edit' ? '参考图生成' : '文生图' }} · {{ record.size }} · {{ record.imageCount }} 张</p><blockquote v-if="record.prompt">{{ record.prompt }}</blockquote><div><span>{{ formatDate(record.createdAt) }}</span><span>耗时 {{ formatDuration(record.durationMs) }}</span><span v-if="record.pointsCost !== undefined">积分 {{ formatPoints(record.pointsCost) }}{{ record.pointsRefunded ? '（已退还）' : '' }}</span></div><small v-if="record.error">{{ record.error }}</small></article>
              <div v-if="!usageRecords.length" class="admin-empty large">该用户暂无 AI 使用记录</div>
            </div>
            <div v-else-if="detailTab === 'credits'" class="admin-record-list">
              <article v-for="record in creditRecords" :key="record.id" class="admin-record-card"><div class="admin-record-top"><strong>{{ creditTitle(record) }}</strong><span :class="record.amount >= 0 ? 'admin-credit-plus' : 'admin-credit-minus'">{{ record.amount >= 0 ? '+' : '' }}{{ formatPoints(record.amount) }}</span></div><p>{{ record.note || '积分变动' }}</p><div><span>{{ formatDate(record.createdAt) }}</span><span>变动后余额 {{ formatPoints(record.balanceAfter) }}</span></div></article>
              <div v-if="!creditRecords.length" class="admin-empty large">该用户暂无积分明细</div>
            </div>
            <div v-else class="admin-record-list">
              <article v-for="record in loginRecords" :key="record.id" class="admin-record-card login"><div class="admin-record-top"><strong>{{ record.success ? '登录成功' : '登录失败' }}</strong><span class="admin-login-status" :class="record.success ? 'success' : 'failed'">{{ record.success ? '成功' : '失败' }}</span></div><p>{{ record.clientIp || '未记录 IP' }} · {{ record.reason || '账号密码验证通过' }}</p><div><span>{{ formatDate(record.createdAt) }}</span></div><small v-if="record.userAgent">{{ record.userAgent }}</small></article>
              <div v-if="!loginRecords.length" class="admin-empty large">该用户暂无登录记录</div>
            </div>
          </template>
          <div v-else class="admin-empty large">请从左侧选择一个用户</div>
        </main>
      </div>

      <div v-else class="admin-card-workspace">
        <section class="admin-card-generator">
          <div><span class="admin-section-eyebrow">RECHARGE CARDS</span><h3>生成积分卡密</h3><p>积分面额和数量均可自定义。完整卡密只在生成时显示一次。</p></div>
          <div class="admin-card-form"><label>积分面额<input v-model="cardPoints" type="number" min="0.01" step="0.01" /></label><label>生成数量<input v-model.number="cardQuantity" type="number" min="1" max="200" step="1" /></label><button type="button" :disabled="cardLoading" @click="generateCards">{{ cardLoading ? '处理中…' : '生成卡密' }}</button></div>
        </section>

        <section v-if="generatedCards.length" class="admin-generated-cards">
          <div class="admin-card-list-heading"><div><strong>本次完整卡密</strong><span>离开页面后服务器只显示脱敏卡号</span></div><div><button type="button" @click="copyGeneratedCards">复制全部</button><button type="button" @click="downloadGeneratedCards">下载 TXT</button></div></div>
          <div class="admin-generated-grid"><article v-for="card in generatedCards" :key="card.id"><code>{{ card.code }}</code><strong>{{ formatPoints(card.points) }} 积分</strong></article></div>
        </section>

        <section class="admin-card-history">
          <div class="admin-card-list-heading"><div><strong>卡密记录</strong><span>{{ cards.length }} 张，未使用 {{ unusedCardCount }} 张</span></div><button type="button" @click="loadCards">刷新</button></div>
          <div v-if="cardLoading" class="admin-loading">正在读取卡密…</div>
          <div v-else class="admin-card-table">
            <article
              v-for="card in cards"
              :key="card.id"
            >
              <div>
                <code>{{ card.codePreview }}</code>
                <span :class="card.status">
                  {{
                    card.status === 'unused'
                      ? '未使用'
                      : '已充值'
                  }}
                </span>
              </div>

              <strong>
                {{ formatPoints(card.points) }} 积分
              </strong>

              <p>
                生成：{{ formatDate(card.createdAt) }}
                · {{ card.createdBy }}
              </p>

              <small v-if="card.redeemedAt">
                充值：{{ formatDate(card.redeemedAt) }}
                · {{ card.redeemedByUsername }}
              </small>

              <button
                v-if="card.status === 'unused'"
                type="button"
                class="admin-card-delete"
                :disabled="deletingCardId === card.id"
                @click="deleteCard(card)"
              >
                {{
                  deletingCardId === card.id
                    ? '删除中…'
                    : '删除未使用卡密'
                }}
              </button>
            </article>

            <div
              v-if="!cards.length"
              class="admin-empty large"
            >
              暂无卡密记录
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style src="./admin.css"></style>

<style scoped>
.admin-card-delete {
  margin-top: 10px;
  width: 100%;
  border: 1px solid #f0b6b6;
  background: #fff5f5;
  color: #b23b3b;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 750;
}

.admin-card-delete:hover {
  border-color: #df7777;
  background: #fff0f0;
}

.admin-card-delete:disabled {
  opacity: 0.55;
}
</style>

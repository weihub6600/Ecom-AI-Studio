<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface AccountUser {
  id: string;
  username: string;
  role: "admin" | "user";
  status: "pending" | "active" | "disabled" | "rejected";
  createdAt: string;
  approvedAt?: string;
  lastLoginAt?: string;
  credits: number;
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
  provider?: string;
  model?: string;
}

interface PriceItem {
  provider: string;
  model: string;
  name: string;
  points: number;
}

const props = defineProps<{ user: AccountUser }>();
const emit = defineEmits<{
  close: [];
  balanceUpdated: [credits: number];
}>();

const account = ref<AccountUser>({ ...props.user });
const prices = ref<PriceItem[]>([]);
const usageRecords = ref<UsageRecord[]>([]);
const creditRecords = ref<CreditRecord[]>([]);
const activeTab = ref<"usage" | "credits">("usage");
const loading = ref(true);
const redeeming = ref(false);
const cardCode = ref("");
const errorMessage = ref("");
const successMessage = ref("");

const successfulUsageCount = computed(() => usageRecords.value.filter((item) => item.status !== "failed").length);
const totalSpent = computed(() => creditRecords.value
  .filter((item) => item.type === "generation_charge")
  .reduce((sum, item) => sum + Math.abs(item.amount), 0));

onMounted(loadAccountData);

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "操作失败");
  return data;
}

async function loadAccountData() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [summary, usage, credits] = await Promise.all([
      api<{ user: AccountUser; prices: PriceItem[] }>("/api/account/summary"),
      api<{ records: UsageRecord[] }>("/api/account/usage?limit=300"),
      api<{ records: CreditRecord[] }>("/api/account/credits?limit=500")
    ]);
    account.value = summary.user;
    prices.value = summary.prices || [];
    usageRecords.value = usage.records || [];
    creditRecords.value = credits.records || [];
    emit("balanceUpdated", account.value.credits);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取个人账户数据失败";
  } finally {
    loading.value = false;
  }
}

async function redeemCard() {
  const code = cardCode.value.trim();
  if (!code) {
    errorMessage.value = "请输入充值卡密";
    return;
  }
  redeeming.value = true;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const result = await api<{ user: AccountUser }>("/api/account/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    account.value = result.user;
    cardCode.value = "";
    successMessage.value = `充值成功，当前积分 ${formatPoints(account.value.credits)}`;
    emit("balanceUpdated", account.value.credits);
    await loadAccountData();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "卡密充值失败";
  } finally {
    redeeming.value = false;
  }
}

function usageStatusLabel(status: UsageRecord["status"]): string {
  if (status === "success") return "成功";
  if (status === "submitted") return "处理中";
  return "失败";
}

function transactionTitle(record: CreditRecord): string {
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
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(value?: number): string {
  if (typeof value !== "number") return "—";
  return `${(value / 1000).toFixed(1)} 秒`;
}
</script>

<template>
  <div class="user-center-overlay" @click.self="emit('close')">
    <section class="user-center-dialog" role="dialog" aria-modal="true" aria-label="用户后台">
      <header class="user-center-header">
        <div>
          <span class="user-center-eyebrow">BJR AI ACCOUNT</span>
          <h2>我的后台</h2>
          <p>查看 AI 生图记录、积分消费明细，并使用卡密充值。</p>
        </div>
        <button type="button" class="user-center-close" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <div class="user-center-summary">
        <div class="user-center-profile">
          <span>{{ account.username.slice(0, 1).toUpperCase() }}</span>
          <div>
            <strong>{{ account.username }}</strong>
            <small>用户名只能由站长修改 · 注册于 {{ formatDate(account.createdAt) }}</small>
          </div>
        </div>
        <div class="user-center-balance">
          <span>积分余额</span>
          <strong>{{ account.role === 'admin' ? '不限' : formatPoints(account.credits) }}</strong>
          <small>{{ account.role === 'admin' ? '站长测试账号不扣积分' : `累计生图 ${successfulUsageCount} 次` }}</small>
        </div>
        <div class="user-center-balance secondary">
          <span>累计消费</span>
          <strong>{{ account.role === 'admin' ? '—' : formatPoints(totalSpent) }}</strong>
          <small>积分明细以服务器记录为准</small>
        </div>
      </div>

      <div v-if="account.role !== 'admin'" class="user-center-recharge">
        <div>
          <strong>卡密充值</strong>
          <span>输入站长发放的卡密，充值成功后立即到账。</span>
        </div>
        <form @submit.prevent="redeemCard">
          <input v-model="cardCode" type="text" maxlength="80" placeholder="BJR-XXXX-XXXX-XXXX-XXXX" autocomplete="off" />
          <button type="submit" :disabled="redeeming">{{ redeeming ? '充值中…' : '立即充值' }}</button>
        </form>
      </div>

      <div v-if="successMessage" class="user-center-message success">{{ successMessage }}</div>
      <div v-if="errorMessage" class="user-center-message error">{{ errorMessage }}</div>

      <div class="user-center-price-list">
        <article v-for="item in prices" :key="`${item.provider}-${item.model}`">
          <span>{{ item.name }}</span>
          <strong>{{ formatPoints(item.points) }} 积分/次</strong>
        </article>
      </div>

      <div class="user-center-tabs">
        <button type="button" :class="{ active: activeTab === 'usage' }" @click="activeTab = 'usage'">AI 生图记录 <span>{{ usageRecords.length }}</span></button>
        <button type="button" :class="{ active: activeTab === 'credits' }" @click="activeTab = 'credits'">积分明细 <span>{{ creditRecords.length }}</span></button>
        <button type="button" class="refresh" @click="loadAccountData">刷新</button>
      </div>

      <div v-if="loading" class="user-center-empty">正在读取账户数据…</div>

      <div v-else-if="activeTab === 'usage'" class="user-center-records">
        <article v-for="record in usageRecords" :key="record.id" class="user-center-record">
          <div>
            <strong>{{ record.model }}</strong>
            <span class="usage-state" :class="record.status">{{ usageStatusLabel(record.status) }}</span>
          </div>
          <p>{{ record.provider }} · {{ record.operation === 'image-edit' ? '参考图生成' : '文生图' }} · {{ record.size }} · {{ record.imageCount }} 张</p>
          <blockquote v-if="record.prompt">{{ record.prompt }}</blockquote>
          <footer>
            <span>{{ formatDate(record.createdAt) }}</span>
            <span>耗时 {{ formatDuration(record.durationMs) }}</span>
            <span v-if="record.pointsCost !== undefined">积分 {{ formatPoints(record.pointsCost) }}{{ record.pointsRefunded ? '（已退还）' : '' }}</span>
          </footer>
          <small v-if="record.error">{{ record.error }}</small>
        </article>
        <div v-if="!usageRecords.length" class="user-center-empty">暂无 AI 生图记录</div>
      </div>

      <div v-else class="user-center-records">
        <article v-for="record in creditRecords" :key="record.id" class="user-center-record credit">
          <div>
            <strong>{{ transactionTitle(record) }}</strong>
            <span :class="record.amount >= 0 ? 'credit-plus' : 'credit-minus'">{{ record.amount >= 0 ? '+' : '' }}{{ formatPoints(record.amount) }}</span>
          </div>
          <p>{{ record.note || '积分变动' }}</p>
          <footer><span>{{ formatDate(record.createdAt) }}</span><span>变动后余额 {{ formatPoints(record.balanceAfter) }}</span></footer>
        </article>
        <div v-if="!creditRecords.length" class="user-center-empty">暂无积分明细</div>
      </div>
    </section>
  </div>
</template>

<style src="./user-panel.css"></style>

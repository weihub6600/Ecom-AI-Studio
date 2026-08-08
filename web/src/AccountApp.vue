<script setup lang="ts">
import {
  computed,
  onMounted,
  ref
} from "vue";
import {
  ApiError,
  apiRequest
} from "./api/client";
import AccountProfileSecurity from "./components/AccountProfileSecurity.vue";
import WorkLibrary from "./components/WorkLibrary.vue";
import GallerySubmissionCenter from "./components/GallerySubmissionCenter.vue";
import StorageRightsPanel from "./components/StorageRightsPanel.vue";
import AccountMessageCenter from "./components/AccountMessageCenter.vue";
import BatchStudio from "./components/BatchStudio.vue";
import AccountHistory from "./components/AccountHistory.vue";
import InvitationRewardsPanel from "./components/InvitationRewardsPanel.vue";
import type {
  AuthUser,
  CreditRecord,
  PriceItem,
  UsageRecord
} from "./types";
import {
  formatDate,
  formatPoints
} from "./utils/format";

type AccountSection =
  | "library"
  | "gallery"
  | "storage"
  | "messages"
  | "profile"
  | "history"
  | "batch"
  | "usage"
  | "invites"
  | "credits";

const user =
  ref<AuthUser | null>(null);

const prices =
  ref<PriceItem[]>([]);

const usage =
  ref<UsageRecord[]>([]);

const credits =
  ref<CreditRecord[]>([]);

const loading =
  ref(true);

const errorMessage =
  ref("");

const redeemCode =
  ref("");

const redeeming =
  ref(false);

const redeemMessage =
  ref("");

const redeemError =
  ref("");

const sections:
  Array<{
    id: AccountSection;
    label: string;
    hint: string;
  }> = [
    {
      id: "library",
      label: "作品库",
      hint: "收藏、分类与回收站"
    },
    {
      id: "gallery",
      label: "灵感广场",
      hint: "投稿与公开展示"
    },
    {
      id: "storage",
      label: "存储权益",
      hint: "数量、期限与兑换"
    },
    {
      id: "messages",
      label: "消息中心",
      hint: "通知、提醒与运营消息"
    },
    {
      id: "profile",
      label: "账号设置",
      hint: "昵称与密码安全"
    },
    {
      id: "history",
      label: "生成历史",
      hint: "查看全部生成记录"
    },
    {
      id: "batch",
      label: "批量工作台",
      hint: "模板与服务端批次"
    },
    {
      id: "usage",
      label: "使用记录",
      hint: "调用结果与模型"
    },
    {
      id: "invites",
      label: "邀请奖励",
      hint: "邀请链接与奖励记录"
    },
    {
      id: "credits",
      label: "积分明细",
      hint: "卡密兑换与交易流水"
    }
  ];

const activeSection =
  ref<AccountSection>(
    readInitialSection()
  );

const displayCredits =
  computed(() =>
    user.value?.role === "admin"
      ? "不限"
      : formatPoints(
          user.value?.credits || 0
        )
  );

onMounted(bootstrap);

async function bootstrap() {
  loading.value = true;

  try {
    const current =
      await apiRequest<{
        user: AuthUser;
      }>(
        "/api/auth/me"
      );

    user.value =
      current.user;

    const [
      summary,
      usageResult,
      creditResult
    ] =
      await Promise.all([
        apiRequest<{
          user: AuthUser;
          prices: PriceItem[];
        }>(
          "/api/account/summary"
        ),
        apiRequest<{
          records: UsageRecord[];
        }>(
          "/api/account/usage?limit=300"
        ),
        apiRequest<{
          records: CreditRecord[];
        }>(
          "/api/account/credits?limit=500"
        )
      ]);

    user.value =
      summary.user;

    prices.value =
      summary.prices || [];

    usage.value =
      usageResult.records || [];

    credits.value =
      creditResult.records || [];
  }
  catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401
    ) {
      window.location.href =
        "/";
      return;
    }

    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取用户后台失败";
  }
  finally {
    loading.value = false;
  }
}

function changeSection(
  section: AccountSection
) {
  activeSection.value =
    section;

  const url =
    new URL(
      window.location.href
    );

  url.searchParams.set(
    "tab",
    section
  );

  window.history.replaceState(
    {},
    "",
    url
  );
}

function updateBalance(
  value: number
) {
  if (!user.value) return;

  user.value = {
    ...user.value,
    credits: value
  };
}

async function redeemCard() {
  const code = redeemCode.value.trim();

  redeemMessage.value = "";
  redeemError.value = "";

  if (!code) {
    redeemError.value = "请输入卡密";
    return;
  }

  redeeming.value = true;

  try {
    const result = await apiRequest<{
      user: AuthUser;
      transaction: CreditRecord;
    }>("/api/account/redeem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ code })
    });

    user.value = result.user;
    credits.value = [
      result.transaction,
      ...credits.value.filter(
        (item) => item.id !== result.transaction.id
      )
    ];

    redeemCode.value = "";
    redeemMessage.value =
      `兑换成功，已到账 ${formatPoints(result.transaction.amount)} 积分`;
  } catch (error) {
    redeemError.value =
      error instanceof Error
        ? error.message
        : "卡密兑换失败";
  } finally {
    redeeming.value = false;
  }
}


function handleProfileUpdated(nextUser: AuthUser) {
  user.value = nextUser;
}

async function logout() {
  try {
    await apiRequest(
      "/api/auth/logout",
      {
        method: "POST"
      }
    );
  }
  finally {
    window.location.href =
      "/";
  }
}

function readInitialSection():
  AccountSection {
  const value =
    new URLSearchParams(
      window.location.search
    ).get("tab");

  return sections.some(
    (item) =>
      item.id === value
  )
    ? value as AccountSection
    : "library";
}

function usageLabel(
  status:
    UsageRecord["status"]
): string {
  if (status === "success") {
    return "成功";
  }

  if (status === "submitted") {
    return "处理中";
  }

  return "失败";
}

function creditTitle(
  record: CreditRecord
): string {
  if (
    record.note?.startsWith(
      "存储权益兑换："
    )
  ) {
    return "存储权益兑换";
  }

  if (record.note === "新用户注册赠送") {
    return "新用户注册赠送";
  }

  if (
    record.type ===
      "generation_charge"
  ) {
    return "AI 生图扣费";
  }

  if (
    record.type ===
      "generation_refund"
  ) {
    return "生成退款";
  }

  if (
    record.type ===
      "card_recharge"
  ) {
    return "卡密充值";
  }

  if (record.note?.startsWith("邀请奖励")) {
    return "邀请奖励";
  }

  if (record.note?.startsWith("受邀新人奖励")) {
    return "受邀新人奖励";
  }

  return record.amount >= 0
    ? "站长增加积分"
    : "站长扣减积分";
}
</script>

<template>
  <div v-if="loading" class="account-gate">
    <div class="account-loader"></div>
    <strong>正在进入用户后台…</strong>
  </div>

  <div v-else-if="!user" class="account-gate">
    <strong>无法进入用户后台</strong>
    <p>{{ errorMessage || '请先登录。' }}</p>
    <a href="/">返回创作工作台</a>
  </div>

  <div v-else class="account-shell">
    <aside class="account-sidebar">
      <a class="account-brand" href="/">
        <span>Z</span>
        <div>
          <strong>ZHE AI</strong>
          <small>USER CONSOLE</small>
        </div>
      </a>

      <div class="account-profile">
        <span>{{ user.username.slice(0, 1).toUpperCase() }}</span>
        <div>
          <strong>{{ user.nickname || user.username }}</strong>
          <small>{{ user.nickname ? `账号 ${user.username}` : (user.role === 'admin' ? '站长账号' : '普通用户') }}</small>
        </div>
      </div>

      <nav>
        <button
          v-for="item in sections"
          :key="item.id"
          type="button"
          :class="{ active: activeSection === item.id }"
          @click="changeSection(item.id)"
        >
          <span>{{ item.label.slice(0, 1) }}</span>
          <div>
            <strong>{{ item.label }}</strong>
            <small>{{ item.hint }}</small>
          </div>
        </button>
      </nav>

      <div class="account-sidebar-bottom">
        <a v-if="user.role === 'admin'" href="/admin">进入站长后台</a>
        <a href="/">返回创作工作台</a>
        <button type="button" @click="logout">退出登录</button>
      </div>
    </aside>

    <main class="account-main">
      <header class="account-topbar">
        <div>
          <span>V13.5 · ACCOUNT CENTER</span>
          <h1>{{ sections.find(item => item.id === activeSection)?.label }}</h1>
        </div>

        <div class="account-balance">
          <span>当前积分</span>
          <strong>{{ displayCredits }}</strong>
        </div>
      </header>

      <p v-if="errorMessage" class="account-message error">{{ errorMessage }}</p>

      <section v-if="activeSection === 'library'" class="account-content">
        <WorkLibrary :user-id="user.id" />
      </section>

      <section v-else-if="activeSection === 'gallery'" class="account-content">
        <GallerySubmissionCenter />
      </section>

      <section v-else-if="activeSection === 'storage'" class="account-content">
        <StorageRightsPanel
          :user="user"
          @balance-updated="updateBalance"
        />
      </section>

      <section v-else-if="activeSection === 'messages'" class="account-content">
        <AccountMessageCenter />
      </section>

      <section v-else-if="activeSection === 'profile'" class="account-content">
        <AccountProfileSecurity :user="user" @user-updated="handleProfileUpdated" />
      </section>

      <section v-else-if="activeSection === 'history'" class="account-content">
        <AccountHistory />
      </section>

      <section v-else-if="activeSection === 'batch'" class="account-content">
        <BatchStudio
          :user="user"
          @balance-updated="updateBalance"
        />
      </section>

      <section v-else-if="activeSection === 'invites'" class="account-content">
        <InvitationRewardsPanel />
      </section>

      <section v-else-if="activeSection === 'usage'" class="account-content">
        <header class="account-section-heading">
          <div>
            <span>API USAGE</span>
            <h2>AI 使用记录</h2>
            <p>查看模型调用、状态和消耗。</p>
          </div>
        </header>

        <div class="account-table-card">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>模型</th>
                <th>状态</th>
                <th>图片</th>
                <th>积分</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in usage" :key="record.id">
                <td>{{ formatDate(record.createdAt) }}</td>
                <td>{{ record.model }}</td>
                <td><i :class="record.status">{{ usageLabel(record.status) }}</i></td>
                <td>{{ record.imageCount }}</td>
                <td>{{ formatPoints(record.pointsCost || 0) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="usage.length === 0" class="account-empty">暂无使用记录</div>
        </div>
      </section>

      <section v-else class="account-content">
        <header class="account-section-heading">
          <div>
            <span>CREDIT LEDGER</span>
            <h2>积分明细</h2>
            <p>当前余额 {{ displayCredits }}，可用模型价格 {{ prices.length }} 项。</p>
          </div>
        </header>

        <div v-if="user.role !== 'admin'" class="account-redeem-card">
          <div class="account-redeem-copy">
            <span>REDEEM CODE</span>
            <h3>卡密兑换积分</h3>
            <p>输入站长发放的卡密，兑换成功后积分立即到账。</p>
          </div>

          <form @submit.prevent="redeemCard">
            <input
              v-model="redeemCode"
              type="text"
              maxlength="128"
              autocomplete="off"
              spellcheck="false"
              placeholder="请输入卡密"
              :disabled="redeeming"
            />
            <button
              type="submit"
              :disabled="redeeming || !redeemCode.trim()"
            >
              {{ redeeming ? '兑换中…' : '立即兑换' }}
            </button>
          </form>

          <p v-if="redeemMessage" class="account-redeem-result success">
            {{ redeemMessage }}
          </p>
          <p v-if="redeemError" class="account-redeem-result error">
            {{ redeemError }}
          </p>
        </div>

        <div class="account-credit-grid">
          <article v-for="record in credits" :key="record.id">
            <div>
              <strong>{{ creditTitle(record) }}</strong>
              <span>{{ formatDate(record.createdAt) }}</span>
            </div>
            <b :class="{ plus: record.amount >= 0 }">
              {{ record.amount >= 0 ? '+' : '' }}{{ formatPoints(record.amount) }}
            </b>
            <p>{{ record.note || record.model || '积分流水' }}</p>
            <small>余额 {{ formatPoints(record.balanceAfter) }}</small>
          </article>
        </div>
        <div v-if="credits.length === 0" class="account-empty">暂无积分流水</div>
      </section>
    </main>
  </div>
</template>

<style src="./account-page.css"></style>
<style src="./work-library.css"></style>
<style src="./batch-studio.css"></style>

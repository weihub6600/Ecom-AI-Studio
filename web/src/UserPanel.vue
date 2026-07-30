<script setup lang="ts">
import {
  computed,
  onMounted,
  ref
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "./api/client";
import WorkLibrary from "./components/WorkLibrary.vue";
import BatchStudio from "./components/BatchStudio.vue";
import type {
  AdminModelTaskHealth,
  AdminTaskPagination,
  AdminTaskRecord,
  AdminTaskStatusFilter,
  AdminTaskSummary,
  AuthUser,
  CreditRecord,
  PriceItem,
  TaskRecoveryStats,
  UsageRecord
} from "./types";
import {
  formatDate,
  formatDuration,
  formatPoints,
  providerDisplayName
} from "./utils/format";

const props =
  defineProps<{
    user: AuthUser
  }>();

const emit = defineEmits<{
  close: [];
  balanceUpdated:
    [credits: number];
}>();

const account =
  ref<AuthUser>({
    ...props.user
  });

const prices =
  ref<PriceItem[]>([]);

const usageRecords =
  ref<UsageRecord[]>([]);

const creditRecords =
  ref<CreditRecord[]>([]);

const activeTab =
  ref<
    | "library"
    | "batch"
    | "usage"
    | "credits"
    | "tasks"
  >("library");

const loading = ref(true);
const redeeming = ref(false);
const cardCode = ref("");
const errorMessage = ref("");
const successMessage = ref("");

const adminTasks =
  ref<AdminTaskRecord[]>([]);

const adminTaskSummary =
  ref<AdminTaskSummary>({
    total: 0,
    active: 0,
    stale: 0,
    success24h: 0,
    failed24h: 0,
    refundedPoints24h: 0,
    averageDurationMs24h: 0
  });

const adminTaskPagination =
  ref<AdminTaskPagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1
  });

const adminModelHealth =
  ref<AdminModelTaskHealth[]>([]);

const adminTaskStatus =
  ref<AdminTaskStatusFilter>(
    "all"
  );

const adminTaskProvider =
  ref("all");

const adminTaskSearch =
  ref("");

const adminStaleOnly =
  ref(false);

const adminTaskLoading =
  ref(false);

const adminTaskAction =
  ref<string | null>(null);

const successfulUsageCount =
  computed(() =>
    usageRecords.value.filter(
      (item) =>
        item.status !== "failed"
    ).length
  );

const totalSpent =
  computed(() =>
    creditRecords.value
      .filter(
        (item) =>
          item.type ===
          "generation_charge"
      )
      .reduce(
        (sum, item) =>
          sum +
          Math.abs(item.amount),
        0
      )
  );

const isAdmin =
  computed(() =>
    account.value.role ===
    "admin"
  );

onMounted(async () => {
  await loadAccountData();

  if (isAdmin.value) {
    await loadAdminTaskData(
      true
    );
  }
});

async function loadAccountData() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const [
      summary,
      usage,
      credits
    ] = await Promise.all([
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

    account.value =
      summary.user;

    prices.value =
      summary.prices || [];

    usageRecords.value =
      usage.records || [];

    creditRecords.value =
      credits.records || [];

    emit(
      "balanceUpdated",
      account.value.credits
    );
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取个人账户数据失败";
  } finally {
    loading.value = false;
  }
}

async function redeemCard() {
  const code =
    cardCode.value.trim();

  if (!code) {
    errorMessage.value =
      "请输入充值卡密";
    return;
  }

  redeeming.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const result =
      await apiRequest<{
        user: AuthUser
      }>(
        "/api/account/redeem",
        jsonRequest({ code })
      );

    account.value =
      result.user;

    cardCode.value = "";

    successMessage.value =
      `充值成功，当前积分 ${formatPoints(account.value.credits)}`;

    emit(
      "balanceUpdated",
      account.value.credits
    );

    await loadAccountData();
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "卡密充值失败";
  } finally {
    redeeming.value = false;
  }
}

async function openAdminTasks() {
  activeTab.value = "tasks";

  if (
    adminTasks.value.length === 0
  ) {
    await loadAdminTaskData(
      true
    );
  }
}

async function loadAdminTaskData(
  resetPage = false
) {
  if (!isAdmin.value) return;

  if (resetPage) {
    adminTaskPagination.value = {
      ...adminTaskPagination.value,
      page: 1
    };
  }

  adminTaskLoading.value = true;
  errorMessage.value = "";

  try {
    const params =
      new URLSearchParams({
        page:
          String(
            adminTaskPagination
              .value.page
          ),
        pageSize:
          String(
            adminTaskPagination
              .value.pageSize
          ),
        status:
          adminTaskStatus.value
      });

    if (
      adminTaskProvider.value !==
      "all"
    ) {
      params.set(
        "provider",
        adminTaskProvider.value
      );
    }

    const search =
      adminTaskSearch.value
        .trim();

    if (search) {
      params.set(
        "search",
        search
      );
    }

    if (
      adminStaleOnly.value
    ) {
      params.set(
        "staleOnly",
        "true"
      );
    }

    const [tasks, health] =
      await Promise.all([
        apiRequest<{
          tasks:
            AdminTaskRecord[];
          pagination:
            AdminTaskPagination;
          summary:
            AdminTaskSummary;
        }>(
          `/api/admin/tasks?${params.toString()}`
        ),
        apiRequest<{
          summary:
            AdminTaskSummary;
          models:
            AdminModelTaskHealth[];
        }>(
          "/api/admin/tasks/health"
        )
      ]);

    adminTasks.value =
      tasks.tasks || [];

    adminTaskPagination.value =
      tasks.pagination;

    adminTaskSummary.value =
      health.summary ||
      tasks.summary;

    adminModelHealth.value =
      health.models || [];
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取任务管理数据失败";
  } finally {
    adminTaskLoading.value =
      false;
  }
}

async function runTaskRecovery() {
  if (!isAdmin.value) return;

  adminTaskAction.value =
    "recovery";

  errorMessage.value = "";
  successMessage.value = "";

  try {
    const result =
      await apiRequest<{
        success: boolean;
        stats:
          TaskRecoveryStats;
      }>(
        "/api/admin/tasks/recover",
        {
          method: "POST"
        }
      );

    successMessage.value =
      [
        "恢复扫描完成",
        `扫描 ${result.stats.scanned}`,
        `更新 ${result.stats.progressed}`,
        `完成 ${result.stats.completed}`,
        `失败 ${result.stats.failed}`,
        `异常 ${result.stats.errors}`
      ].join(" · ");

    await loadAdminTaskData(
      false
    );
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "运行任务恢复失败";
  } finally {
    adminTaskAction.value =
      null;
  }
}

async function failAndRefundTask(
  task: AdminTaskRecord
) {
  if (
    task.status !== "queued" &&
    task.status !== "running" &&
    task.status !== "failed"
  ) {
    return;
  }

  const confirmed =
    window.confirm(
      [
        `确定终止任务 ${task.id} 吗？`,
        "系统会将任务标记失败，并按现有积分流水执行幂等退款。",
        "已经保存生成结果的任务不会允许这样处理。"
      ].join("\n")
    );

  if (!confirmed) return;

  const reason =
    window.prompt(
      "请输入操作原因",
      "站长确认该任务无法继续恢复"
    );

  if (reason === null) return;

  adminTaskAction.value =
    task.id;

  errorMessage.value = "";
  successMessage.value = "";

  try {
    const result =
      await apiRequest<{
        success: boolean;
        task:
          AdminTaskRecord;
        refundedPoints: number;
      }>(
        `/api/admin/tasks/${encodeURIComponent(task.id)}/fail-refund`,
        jsonRequest({
          reason:
            reason.trim()
        })
      );

    successMessage.value =
      result.refundedPoints > 0
        ? `任务已终止，退回 ${formatPoints(result.refundedPoints)} 积分`
        : "任务已终止，没有发现可退积分";

    await loadAdminTaskData(
      false
    );
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "终止任务失败";
  } finally {
    adminTaskAction.value =
      null;
  }
}

async function changeAdminTaskPage(
  page: number
) {
  if (
    page < 1 ||
    page >
      adminTaskPagination
        .value.totalPages
  ) {
    return;
  }

  adminTaskPagination.value = {
    ...adminTaskPagination.value,
    page
  };

  await loadAdminTaskData(
    false
  );
}

async function refreshActiveTab() {
  if (
    activeTab.value === "library"
  ) {
    return;
  }

  if (
    activeTab.value === "tasks"
  ) {
    await loadAdminTaskData(
      false
    );
    return;
  }

  await loadAccountData();
}

function handleBatchBalanceUpdated(
  credits: number
) {
  account.value = {
    ...account.value,
    credits
  };

  emit(
    "balanceUpdated",
    credits
  );
}

function usageStatusLabel(
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

function transactionTitle(
  record: CreditRecord
): string {
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
    return "生成失败退款";
  }

  if (
    record.type ===
    "card_recharge"
  ) {
    return "卡密充值";
  }

  return record.amount >= 0
    ? "站长增加积分"
    : "站长扣减积分";
}

function adminTaskStatusLabel(
  task: AdminTaskRecord
): string {
  if (task.status === "queued") {
    return "排队";
  }

  if (task.status === "running") {
    return task.stale
      ? "运行中 · 疑似卡住"
      : "运行中";
  }

  if (task.status === "success") {
    return "成功";
  }

  if (task.status === "failed") {
    return task.refundedPoints > 0
      ? "失败 · 已退款"
      : "失败";
  }

  return "已取消";
}

function formatAdminDuration(
  value: number
): string {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return "—";
  }

  const seconds =
    Math.round(value / 1000);

  if (seconds < 60) {
    return `${seconds} 秒`;
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  const remainder =
    seconds % 60;

  if (minutes < 60) {
    return `${minutes} 分 ${remainder} 秒`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  return `${hours} 小时 ${minutes % 60} 分`;
}

function providerName(
  provider: string
): string {
  if (
    provider === "lingke" ||
    provider === "grsai" ||
    provider === "nanobanana"
  ) {
    return providerDisplayName(
      provider
    );
  }

  return provider;
}
</script>

<template>
  <div
    class="user-center-overlay"
    @click.self="emit('close')"
  >
    <section
      class="user-center-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="用户后台"
    >
      <header
        class="user-center-header"
      >
        <div>
          <span
            class="user-center-eyebrow"
          >
            BJR AI ACCOUNT
          </span>

          <h2>
            {{
              isAdmin
                ? "站长后台"
                : "我的后台"
            }}
          </h2>

          <p>
            {{
              isAdmin
                ? "管理批量生产、作品资产、任务运行状态、模型健康和异常退款。"
                : "批量生成商品图、整理作品资产、查看积分明细并使用卡密充值。"
            }}
          </p>
        </div>

        <button
          type="button"
          class="user-center-close"
          aria-label="关闭"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div
        class="user-center-summary"
      >
        <div
          class="user-center-profile"
        >
          <span>
            {{
              account.username
                .slice(0, 1)
                .toUpperCase()
            }}
          </span>

          <div>
            <strong>
              {{ account.username }}
            </strong>

            <small>
              {{
                isAdmin
                  ? "站长账号 · 任务操作会写入审计记录"
                  : `用户名只能由站长修改 · 注册于 ${formatDate(account.createdAt)}`
              }}
            </small>
          </div>
        </div>

        <div
          class="user-center-balance"
        >
          <span>积分余额</span>

          <strong>
            {{
              isAdmin
                ? "不限"
                : formatPoints(
                    account.credits
                  )
            }}
          </strong>

          <small>
            {{
              isAdmin
                ? "站长测试账号不扣积分"
                : `累计生图 ${successfulUsageCount} 次`
            }}
          </small>
        </div>

        <div
          class="user-center-balance secondary"
        >
          <span>
            {{
              isAdmin
                ? "运行中任务"
                : "累计消费"
            }}
          </span>

          <strong>
            {{
              isAdmin
                ? adminTaskSummary.active
                : formatPoints(
                    totalSpent
                  )
            }}
          </strong>

          <small>
            {{
              isAdmin
                ? `疑似卡住 ${adminTaskSummary.stale} 个`
                : "积分明细以服务器记录为准"
            }}
          </small>
        </div>
      </div>

      <div
        v-if="!isAdmin"
        class="user-center-recharge"
      >
        <div>
          <strong>
            卡密充值
          </strong>

          <span>
            输入站长发放的卡密，充值成功后立即到账。
          </span>
        </div>

        <form
          @submit.prevent="
            redeemCard
          "
        >
          <input
            v-model="cardCode"
            type="text"
            maxlength="80"
            placeholder="BJR-XXXX-XXXX-XXXX-XXXX"
            autocomplete="off"
          />

          <button
            type="submit"
            :disabled="redeeming"
          >
            {{
              redeeming
                ? "充值中…"
                : "立即充值"
            }}
          </button>
        </form>
      </div>

      <div
        v-if="successMessage"
        class="user-center-message success"
      >
        {{ successMessage }}
      </div>

      <div
        v-if="errorMessage"
        class="user-center-message error"
      >
        {{ errorMessage }}
      </div>

      <div
        class="user-center-price-list"
      >
        <article
          v-for="item in prices"
          :key="
            `${item.provider}-${item.model}`
          "
        >
          <span>{{ item.name }}</span>

          <strong>
            {{
              formatPoints(
                item.points
              )
            }}
            积分/张
          </strong>
        </article>
      </div>

      <div
        class="user-center-tabs"
      >
        <button
          type="button"
          :class="{
            active:
              activeTab ===
              'library'
          }"
          @click="
            activeTab = 'library'
          "
        >
          作品库

          <span>
            云端
          </span>
        </button>

        <button
          type="button"
          :class="{
            active:
              activeTab ===
              'batch'
          }"
          @click="
            activeTab = 'batch'
          "
        >
          批量工作台

          <span>
            CSV/XLSX
          </span>
        </button>

        <button
          type="button"
          :class="{
            active:
              activeTab ===
              'usage'
          }"
          @click="
            activeTab = 'usage'
          "
        >
          AI 生图记录

          <span>
            {{ usageRecords.length }}
          </span>
        </button>

        <button
          type="button"
          :class="{
            active:
              activeTab ===
              'credits'
          }"
          @click="
            activeTab = 'credits'
          "
        >
          积分明细

          <span>
            {{ creditRecords.length }}
          </span>
        </button>

        <button
          v-if="isAdmin"
          type="button"
          :class="{
            active:
              activeTab ===
              'tasks'
          }"
          @click="openAdminTasks"
        >
          任务管理

          <span>
            {{ adminTaskSummary.total }}
          </span>
        </button>

        <button
          v-if="
          activeTab !== 'library' &&
          activeTab !== 'batch'
        "
          type="button"
          class="refresh"
          :disabled="
            adminTaskLoading
          "
          @click="
            refreshActiveTab
          "
        >
          刷新
        </button>
      </div>

      <BatchStudio
        v-show="
          activeTab === 'batch'
        "
        :user="account"
        @balance-updated="
          handleBatchBalanceUpdated
        "
      />

      <div
        v-if="
          loading &&
          activeTab !== 'tasks' &&
          activeTab !== 'library' &&
          activeTab !== 'batch'
        "
        class="user-center-empty"
      >
        正在读取账户数据…
      </div>

      <WorkLibrary
        v-else-if="
          activeTab === 'library'
        "
        :user-id="account.id"
      />

      <div
        v-else-if="
          activeTab === 'usage'
        "
        class="user-center-records"
      >
        <article
          v-for="record in usageRecords"
          :key="record.id"
          class="user-center-record"
        >
          <div>
            <strong>
              {{ record.model }}
            </strong>

            <span
              class="usage-state"
              :class="record.status"
            >
              {{
                usageStatusLabel(
                  record.status
                )
              }}
            </span>
          </div>

          <p>
            {{ record.provider }}
            ·
            {{
              record.operation ===
                "image-edit"
                ? "参考图生成"
                : "文生图"
            }}
            · {{ record.size }}
            · {{ record.imageCount }}
            张
          </p>

          <blockquote
            v-if="record.prompt"
          >
            {{ record.prompt }}
          </blockquote>

          <footer>
            <span>
              {{
                formatDate(
                  record.createdAt
                )
              }}
            </span>

            <span>
              耗时
              {{
                formatDuration(
                  record.durationMs
                )
              }}
            </span>

            <span
              v-if="
                record.pointsCost !==
                undefined
              "
            >
              积分
              {{
                formatPoints(
                  record.pointsCost
                )
              }}
              {{
                record.pointsRefunded
                  ? "（已退还）"
                  : ""
              }}
            </span>
          </footer>

          <small
            v-if="record.error"
          >
            {{ record.error }}
          </small>
        </article>

        <div
          v-if="
            !usageRecords.length
          "
          class="user-center-empty"
        >
          暂无 AI 生图记录
        </div>
      </div>

      <div
        v-else-if="
          activeTab === 'credits'
        "
        class="user-center-records"
      >
        <article
          v-for="record in creditRecords"
          :key="record.id"
          class="user-center-record credit"
        >
          <div>
            <strong>
              {{
                transactionTitle(
                  record
                )
              }}
            </strong>

            <span
              :class="
                record.amount >= 0
                  ? 'credit-plus'
                  : 'credit-minus'
              "
            >
              {{
                record.amount >= 0
                  ? "+"
                  : ""
              }}
              {{
                formatPoints(
                  record.amount
                )
              }}
            </span>
          </div>

          <p>
            {{
              record.note ||
              "积分变动"
            }}
          </p>

          <footer>
            <span>
              {{
                formatDate(
                  record.createdAt
                )
              }}
            </span>

            <span>
              变动后余额
              {{
                formatPoints(
                  record.balanceAfter
                )
              }}
            </span>
          </footer>
        </article>

        <div
          v-if="
            !creditRecords.length
          "
          class="user-center-empty"
        >
          暂无积分明细
        </div>
      </div>

      <div
        v-else-if="
          activeTab === 'tasks'
        "
        class="admin-task-console"
      >
        <div
          class="admin-task-summary"
        >
          <article>
            <span>全部任务</span>
            <strong>
              {{ adminTaskSummary.total }}
            </strong>
          </article>

          <article>
            <span>当前运行</span>
            <strong>
              {{ adminTaskSummary.active }}
            </strong>
          </article>

          <article
            :class="{
              warning:
                adminTaskSummary.stale >
                0
            }"
          >
            <span>疑似卡住</span>
            <strong>
              {{ adminTaskSummary.stale }}
            </strong>
          </article>

          <article>
            <span>24h 成功</span>
            <strong>
              {{
                adminTaskSummary
                  .success24h
              }}
            </strong>
          </article>

          <article>
            <span>24h 失败</span>
            <strong>
              {{
                adminTaskSummary
                  .failed24h
              }}
            </strong>
          </article>

          <article>
            <span>24h 退款积分</span>
            <strong>
              {{
                formatPoints(
                  adminTaskSummary
                    .refundedPoints24h
                )
              }}
            </strong>
          </article>
        </div>

        <div
          class="admin-task-toolbar"
        >
          <select
            v-model="
              adminTaskStatus
            "
            @change="
              loadAdminTaskData(true)
            "
          >
            <option value="all">
              全部状态
            </option>

            <option value="active">
              进行中
            </option>

            <option value="queued">
              排队
            </option>

            <option value="running">
              运行中
            </option>

            <option value="success">
              成功
            </option>

            <option value="failed">
              失败
            </option>
          </select>

          <select
            v-model="
              adminTaskProvider
            "
            @change="
              loadAdminTaskData(true)
            "
          >
            <option value="all">
              全部服务商
            </option>

            <option value="grsai">
              GRSAI
            </option>

            <option value="nanobanana">
              Nano Banana
            </option>

            <option value="lingke">
              百嘉瑞AI
            </option>
          </select>

          <label
            class="admin-stale-toggle"
          >
            <input
              v-model="
                adminStaleOnly
              "
              type="checkbox"
              @change="
                loadAdminTaskData(true)
              "
            />
            仅疑似卡住
          </label>

          <form
            class="admin-task-search"
            @submit.prevent="
              loadAdminTaskData(true)
            "
          >
            <input
              v-model="
                adminTaskSearch
              "
              type="search"
              placeholder="用户名、提示词、模型或任务 ID"
            />

            <button
              type="submit"
            >
              搜索
            </button>
          </form>

          <button
            type="button"
            class="admin-recovery-button"
            :disabled="
              adminTaskAction !==
              null
            "
            @click="
              runTaskRecovery
            "
          >
            {{
              adminTaskAction ===
                "recovery"
                ? "扫描中…"
                : "立即恢复扫描"
            }}
          </button>
        </div>

        <div
          v-if="adminTaskLoading"
          class="user-center-empty"
        >
          正在读取任务数据…
        </div>

        <div
          v-else
          class="admin-task-list"
        >
          <article
            v-for="task in adminTasks"
            :key="task.id"
            class="admin-task-card"
            :class="{
              stale: task.stale,
              failed:
                task.status ===
                'failed'
            }"
          >
            <header>
              <div>
                <strong>
                  {{ task.username }}
                  ·
                  {{ task.model }}
                </strong>

                <span>
                  {{
                    providerName(
                      task.provider
                    )
                  }}
                  ·
                  {{
                    task.operation ===
                      "image-edit"
                      ? "参考图生成"
                      : "文生图"
                  }}
                  · {{ task.size }}
                </span>
              </div>

              <span
                class="admin-task-state"
                :class="task.status"
              >
                {{
                  adminTaskStatusLabel(
                    task
                  )
                }}
              </span>
            </header>

            <p
              class="admin-task-prompt"
            >
              {{
                task.prompt ||
                "未保存提示词"
              }}
            </p>

            <div
              class="admin-task-progress"
            >
              <span
                :style="{
                  width:
                    `${task.progress}%`
                }"
              ></span>
            </div>

            <div
              class="admin-task-meta"
            >
              <span>
                阶段 {{ task.stage }}
              </span>

              <span>
                进度 {{ task.progress }}%
              </span>

              <span>
                数量
                {{
                  task.actualImageCount
                }}
                /
                {{
                  task.requestedImageCount
                }}
              </span>

              <span>
                耗时
                {{
                  formatAdminDuration(
                    task.durationMs
                  )
                }}
              </span>

              <span>
                创建
                {{
                  formatDate(
                    task.createdAt
                  )
                }}
              </span>
            </div>

            <div
              class="admin-task-identifiers"
            >
              <code>
                任务：{{ task.id }}
              </code>

              <code
                v-if="
                  task.providerTaskId
                "
              >
                服务商：
                {{
                  task.providerTaskId
                }}
              </code>

              <code
                v-if="task.historyId"
              >
                历史：
                {{ task.historyId }}
              </code>
            </div>

            <footer>
              <span>
                预扣
                {{
                  formatPoints(
                    task.reservedPoints
                  )
                }}
                · 实扣
                {{
                  formatPoints(
                    task.actualPoints
                  )
                }}
                · 退款
                {{
                  formatPoints(
                    task.refundedPoints
                  )
                }}
              </span>

              <button
                v-if="
                  task.status ===
                    'queued' ||
                  task.status ===
                    'running' ||
                  task.status ===
                    'failed'
                "
                type="button"
                class="admin-fail-button"
                :disabled="
                  adminTaskAction ===
                  task.id
                "
                @click="
                  failAndRefundTask(
                    task
                  )
                "
              >
                {{
                  adminTaskAction ===
                    task.id
                    ? "处理中…"
                    : "失败并退款"
                }}
              </button>
            </footer>

            <small
              v-if="
                task.errorMessage
              "
            >
              {{
                task.errorCode
                  ? `${task.errorCode}：`
                  : ""
              }}
              {{ task.errorMessage }}
            </small>
          </article>

          <div
            v-if="
              !adminTasks.length
            "
            class="user-center-empty"
          >
            当前条件下没有任务
          </div>
        </div>

        <div
          v-if="
            adminTaskPagination
              .totalPages > 1
          "
          class="admin-task-pagination"
        >
          <button
            type="button"
            :disabled="
              adminTaskPagination
                .page <= 1
            "
            @click="
              changeAdminTaskPage(
                adminTaskPagination
                  .page - 1
              )
            "
          >
            上一页
          </button>

          <span>
            第
            {{
              adminTaskPagination.page
            }}
            /
            {{
              adminTaskPagination
                .totalPages
            }}
            页 · 共
            {{
              adminTaskPagination.total
            }}
            条
          </span>

          <button
            type="button"
            :disabled="
              adminTaskPagination
                .page >=
              adminTaskPagination
                .totalPages
            "
            @click="
              changeAdminTaskPage(
                adminTaskPagination
                  .page + 1
              )
            "
          >
            下一页
          </button>
        </div>

        <section
          class="admin-model-health"
        >
          <header>
            <div>
              <strong>
                模型健康度
              </strong>

              <span>
                最近 30 天任务统计
              </span>
            </div>

            <span>
              24h 平均耗时
              {{
                formatAdminDuration(
                  adminTaskSummary
                    .averageDurationMs24h
                )
              }}
            </span>
          </header>

          <div
            class="admin-model-table"
          >
            <div
              class="admin-model-row heading"
            >
              <span>服务商 / 模型</span>
              <span>总任务</span>
              <span>运行中</span>
              <span>成功率</span>
              <span>平均耗时</span>
            </div>

            <div
              v-for="model in adminModelHealth"
              :key="
                `${model.provider}-${model.model}`
              "
              class="admin-model-row"
            >
              <span>
                <strong>
                  {{
                    providerName(
                      model.provider
                    )
                  }}
                </strong>
                <small>
                  {{ model.model }}
                </small>
              </span>

              <span>
                {{ model.total }}
              </span>

              <span>
                {{ model.active }}
              </span>

              <span>
                {{
                  model.successRate
                }}%
              </span>

              <span>
                {{
                  formatAdminDuration(
                    model.averageDurationMs
                  )
                }}
              </span>
            </div>

            <div
              v-if="
                !adminModelHealth.length
              "
              class="user-center-empty"
            >
              暂无模型任务统计
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style src="./user-panel.css"></style>

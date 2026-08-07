<script setup lang="ts">
import {
  computed,
  onMounted,
  ref
} from "vue";
import {
  ApiError,
  apiRequest,
  jsonRequest
} from "../api/client";
import {
  formatDate,
  formatDuration,
  formatPoints
} from "../utils/format";

type HealthLevel =
  | "ok"
  | "warning"
  | "critical";

type TaskStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

interface Health {
  status: HealthLevel;
  checkedAt: string;
  uptimeSeconds: number;
  nodeVersion: string;
  environment: string;
  mysql: {
    ok: boolean;
    latencyMs: number;
    users: number;
    activeSessions: number;
    pendingTasks: number;
  };
  storage: {
    fileCount: number;
    generatedBytes: number;
    diskFreeBytes: number;
    usedPercent: number;
  };
}

interface Task {
  id: string;
  username: string;
  provider: string;
  model: string;
  size: string;
  status: TaskStatus;
  stage: string;
  progress: number;
  requestedImageCount: number;
  actualImageCount: number;
  historyId?: string;
  reservedPoints: number;
  actualPoints: number;
  refundedPoints: number;
  createdAt: string;
  durationMs: number;
  stale: boolean;
  errorCode?: string;
}

interface Summary {
  total: number;
  active: number;
  stale: number;
  success24h: number;
  failed24h: number;
  refundedPoints24h: number;
  averageDurationMs24h: number;
}

interface ModelHealth {
  provider: string;
  model: string;
  success: number;
  failed: number;
  successRate: number;
  averageDurationMs: number;
  active: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const health =
  ref<Health | null>(null);

const tasks =
  ref<Task[]>([]);

const models =
  ref<ModelHealth[]>([]);

const summary =
  ref<Summary>({
    total: 0,
    active: 0,
    stale: 0,
    success24h: 0,
    failed24h: 0,
    refundedPoints24h: 0,
    averageDurationMs24h: 0
  });

const pagination =
  ref<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1
  });

const status = ref("all");
const provider = ref("");
const search = ref("");
const staleOnly = ref(false);
const loading = ref(false);
const message = ref("");
const errorMessage = ref("");

const systemStatusLabel =
  computed(() => {
    if (!health.value) {
      return "读取中";
    }

    return health.value.status === "ok"
      ? "运行正常"
      : health.value.status === "warning"
        ? "需要关注"
        : "系统异常";
  });

const successRate24h =
  computed(() => {
    const terminal =
      summary.value.success24h +
      summary.value.failed24h;

    if (terminal <= 0) {
      return 0;
    }

    return Number(
      (
        summary.value.success24h /
        terminal *
        100
      ).toFixed(1)
    );
  });

onMounted(
  () => void refreshAll()
);

async function refreshAll() {
  loading.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const [
      system,
      taskHealth
    ] = await Promise.all([
      apiRequest<Health>(
        "/api/admin/health"
      ),
      apiRequest<{
        summary: Summary;
        models: ModelHealth[];
      }>(
        "/api/admin/tasks/health"
      )
    ]);

    health.value = system;
    summary.value =
      taskHealth.summary;
    models.value =
      taskHealth.models;

    await loadTasks(1);
  }
  catch (error) {
    handleError(
      error,
      "读取任务运维数据失败"
    );
  }
  finally {
    loading.value = false;
  }
}

async function loadTasks(
  page = 1
) {
  const params =
    new URLSearchParams({
      page: String(page),
      pageSize: "20"
    });

  if (status.value !== "all") {
    params.set(
      "status",
      status.value
    );
  }

  if (provider.value.trim()) {
    params.set(
      "provider",
      provider.value.trim()
    );
  }

  if (search.value.trim()) {
    params.set(
      "search",
      search.value.trim()
    );
  }

  if (staleOnly.value) {
    params.set(
      "staleOnly",
      "true"
    );
  }

  const data =
    await apiRequest<{
      tasks: Task[];
      pagination: Pagination;
      summary: Summary;
    }>(
      `/api/admin/tasks?${params.toString()}`
    );

  tasks.value =
    data.tasks;

  pagination.value =
    data.pagination;

  summary.value =
    data.summary;
}

async function recover() {
  if (
    !window.confirm(
      "运行一次任务恢复扫描？系统会检查未完成任务并尝试恢复正常结算。"
    )
  ) {
    return;
  }

  loading.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    await apiRequest(
      "/api/admin/tasks/recover",
      {
        method: "POST"
      }
    );

    await refreshAll();

    message.value =
      "恢复扫描已完成";
  }
  catch (error) {
    handleError(
      error,
      "恢复扫描失败"
    );
  }
  finally {
    loading.value = false;
  }
}

async function failRefund(
  task: Task
) {
  if (
    !window.confirm(
      `确定终止 ${task.username} 的异常任务并退款？\n\n模型：${task.model}\n任务：${task.id}`
    )
  ) {
    return;
  }

  loading.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<{
        refundedPoints: number;
      }>(
        `/api/admin/tasks/${encodeURIComponent(task.id)}/fail-refund`,
        jsonRequest({
          reason:
            "站长在任务运维中心手动终止异常任务"
        })
      );

    await refreshAll();

    message.value =
      `任务已终止，退款 ${formatPoints(data.refundedPoints)} 积分`;
  }
  catch (error) {
    handleError(
      error,
      "终止并退款失败"
    );
  }
  finally {
    loading.value = false;
  }
}

function canRefund(
  task: Task
) {
  return (
    !task.historyId &&
    task.reservedPoints > task.refundedPoints &&
    (
      task.stale ||
      task.status === "failed"
    )
  );
}

function taskStatusLabel(
  taskStatus: TaskStatus
) {
  const labels:
    Record<TaskStatus, string> = {
      queued: "排队中",
      running: "生成中",
      success: "成功",
      failed: "失败",
      cancelled: "已取消"
    };

  return labels[taskStatus];
}

function statusTone(
  taskStatus: TaskStatus
) {
  return {
    success:
      taskStatus === "success",
    danger:
      taskStatus === "failed",
    active:
      taskStatus === "running" ||
      taskStatus === "queued",
    muted:
      taskStatus === "cancelled"
  };
}

function stageLabel(task: Task) {
  if (task.status === "failed") {
    if (task.refundedPoints > 0) return "失败 · 已自动退款";
    if (task.reservedPoints <= 0) return "失败 · 无需退款";
    return "失败 · 请核对退款";
  }
  const labels: Record<string, string> = {
    queued: "等待处理",
    submitting: "正在提交模型",
    processing: "模型处理中",
    settling: "正在结算积分",
    completed: "已完成",
    refunded: "已退款",
    failed: "失败"
  };
  return labels[task.stage] || task.stage;
}

function errorCodeLabel(code?: string) {
  if (!code) return "";
  const labels: Record<string, string> = {
    PROVIDER_ERROR: "服务商接口错误",
    PROVIDER_TASK_FAILED: "服务商任务失败",
    ADMIN_FAILED_REFUND: "站长手动终止退款",
    TASK_RECOVERY_TIMEOUT: "任务恢复超时",
    ASYNC_RECOVERY_EXPIRED: "异步任务恢复超时",
    UNSUPPORTED_PROVIDER: "不支持的服务商",
    INTERNAL_ERROR: "系统内部错误",
    TASK_QUERY_ERROR: "任务状态查询失败",
    PROXY_ERROR: "服务商网络错误",
    REQUEST_TIMEOUT: "请求超时"
  };
  return labels[code] || "异常：" + code.split("_").join(" ");
}

function progressWidth(
  task: Task
) {
  return `${Math.max(
    0,
    Math.min(
      100,
      Number(task.progress) || 0
    )
  )}%`;
}

function bytes(
  value: number
) {
  if (!value) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB"
  ];

  let number = value;
  let index = 0;

  while (
    number >= 1024 &&
    index < units.length - 1
  ) {
    number /= 1024;
    index += 1;
  }

  return `${number.toFixed(
    index ? 1 : 0
  )} ${units[index]}`;
}

function handleError(
  error: unknown,
  fallback: string
) {
  if (
    error instanceof ApiError &&
    error.status === 401
  ) {
    window.location.href = "/";
    return;
  }

  errorMessage.value =
    error instanceof Error
      ? error.message
      : fallback;
}
</script>

<template>
  <div class="task-ops-v2">
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">
          GENERATION OPERATIONS
        </div>
        <h2>任务运维中心</h2>
        <p>
          集中查看系统健康、生成任务状态、模型质量与异常任务恢复。
        </p>
      </div>

      <div class="hero-actions">
        <button
          type="button"
          class="soft-button"
          :disabled="loading"
          @click="refreshAll"
        >
          刷新数据
        </button>

        <button
          type="button"
          class="primary-button"
          :disabled="loading"
          @click="recover"
        >
          运行恢复扫描
        </button>
      </div>
    </section>

    <div
      v-if="message"
      class="notice success"
    >
      {{ message }}
    </div>

    <div
      v-if="errorMessage"
      class="notice error"
    >
      {{ errorMessage }}
    </div>

    <section class="metric-grid">
      <article class="metric-card featured">
        <div class="metric-head">
          <span>系统状态</span>
          <i
            class="health-dot"
            :class="health?.status || 'loading'"
          />
        </div>
        <strong>
          {{ systemStatusLabel }}
        </strong>
        <small>
          {{ health ? formatDate(health.checkedAt) : "正在读取" }}
        </small>
      </article>

      <article class="metric-card">
        <span>MySQL 延迟</span>
        <strong>
          {{ health?.mysql.ok
            ? `${health.mysql.latencyMs} ms`
            : "异常" }}
        </strong>
        <small>
          {{ health?.mysql.activeSessions || 0 }}
          个活跃会话
        </small>
      </article>

      <article class="metric-card">
        <span>磁盘占用</span>
        <strong>
          {{ health?.storage.usedPercent ?? 0 }}%
        </strong>
        <small>
          剩余
          {{ bytes(
            health?.storage.diskFreeBytes || 0
          ) }}
        </small>
      </article>

      <article class="metric-card">
        <span>活跃任务</span>
        <strong>
          {{ summary.active }}
        </strong>
        <small>
          卡住 {{ summary.stale }}
        </small>
      </article>

      <article class="metric-card">
        <span>24h 成功率</span>
        <strong>
          {{ successRate24h }}%
        </strong>
        <small>
          {{ summary.success24h }} 成功 ·
          {{ summary.failed24h }} 失败
        </small>
      </article>

      <article class="metric-card">
        <span>24h 已退款</span>
        <strong>
          {{ formatPoints(
            summary.refundedPoints24h
          ) }}
        </strong>
        <small>
          平均耗时
          {{ formatDuration(
            summary.averageDurationMs24h
          ) }}
        </small>
      </article>
    </section>

    <section class="overview-grid">
      <article class="panel model-panel">
        <header class="panel-head">
          <div>
            <h3>近 30 天模型质量</h3>
            <p>
              成功率、平均耗时和当前活跃任务
            </p>
          </div>
          <span class="panel-badge">
            {{ models.length }} 个模型
          </span>
        </header>

        <div
          v-if="models.length"
          class="model-list"
        >
          <div
            v-for="item in models"
            :key="
              `${item.provider}:${item.model}`
            "
            class="model-row"
          >
            <div class="model-name">
              <strong>
                {{ item.model }}
              </strong>
              <span>
                {{ item.provider }}
              </span>
            </div>

            <div class="model-stat">
              <span>成功率</span>
              <strong>
                {{ item.successRate }}%
              </strong>
              <small>
                {{ item.success }} 成功 ·
                {{ item.failed }} 失败
              </small>
            </div>

            <div class="model-stat">
              <span>平均耗时</span>
              <strong>
                {{ formatDuration(
                  item.averageDurationMs
                ) }}
              </strong>
              <small>
                {{ item.active }} 个活跃
              </small>
            </div>
          </div>
        </div>

        <div
          v-else
          class="empty-state compact"
        >
          暂无近 30 天模型调用数据
        </div>
      </article>

      <article class="panel server-panel">
        <header class="panel-head">
          <div>
            <h3>服务器诊断</h3>
            <p>仅站长账号可见</p>
          </div>
        </header>

        <dl
          v-if="health"
          class="server-list"
        >
          <div>
            <dt>Node</dt>
            <dd>{{ health.nodeVersion }}</dd>
          </div>
          <div>
            <dt>运行环境</dt>
            <dd>{{ health.environment }}</dd>
          </div>
          <div>
            <dt>运行时间</dt>
            <dd>
              {{ formatDuration(
                health.uptimeSeconds * 1000
              ) }}
            </dd>
          </div>
          <div>
            <dt>用户总数</dt>
            <dd>{{ health.mysql.users }}</dd>
          </div>
          <div>
            <dt>待处理记录</dt>
            <dd>
              {{ health.mysql.pendingTasks }}
            </dd>
          </div>
          <div>
            <dt>生成文件</dt>
            <dd>
              {{ health.storage.fileCount }}
              个 ·
              {{ bytes(
                health.storage.generatedBytes
              ) }}
            </dd>
          </div>
        </dl>
      </article>
    </section>

    <section class="panel task-panel">
      <header class="task-panel-head">
        <div>
          <h3>生成任务</h3>
          <p>
            共 {{ pagination.total }} 条记录
          </p>
        </div>
      </header>

      <div class="filter-bar">
        <label class="field compact-field">
          <span>状态</span>
          <select v-model="status">
            <option value="all">
              全部状态
            </option>
            <option value="active">
              活跃任务
            </option>
            <option value="queued">
              排队中
            </option>
            <option value="running">
              生成中
            </option>
            <option value="success">
              成功
            </option>
            <option value="failed">
              失败
            </option>
            <option value="cancelled">
              已取消
            </option>
          </select>
        </label>

        <label class="field provider-field">
          <span>服务商</span>
          <input
            v-model="provider"
            type="search"
            placeholder="全部服务商"
            @keyup.enter="loadTasks(1)"
          />
        </label>

        <label class="field search-field">
          <span>搜索任务</span>
          <input
            v-model="search"
            type="search"
            placeholder="用户名 / 模型 / Prompt / 任务 ID"
            @keyup.enter="loadTasks(1)"
          />
        </label>

        <label class="stale-check">
          <input
            v-model="staleOnly"
            type="checkbox"
          />
          <span>只看卡住任务</span>
        </label>

        <button
          type="button"
          class="query-button"
          :disabled="loading"
          @click="loadTasks(1)"
        >
          查询
        </button>
      </div>

      <div class="table-shell">
        <table class="task-table">
          <thead>
            <tr>
              <th>用户 / 时间</th>
              <th>模型</th>
              <th>状态</th>
              <th>进度</th>
              <th>图片</th>
              <th>积分</th>
              <th>耗时</th>
              <th class="action-column">
                操作
              </th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="task in tasks"
              :key="task.id"
              :class="{
                stale: task.stale
              }"
            >
              <td>
                <div class="cell-main">
                  {{ task.username }}
                </div>
                <div class="cell-sub">
                  {{ formatDate(
                    task.createdAt
                  ) }}
                </div>
              </td>

              <td>
                <div class="cell-main model-cell">
                  {{ task.model }}
                </div>
                <div class="cell-sub">
                  {{ task.provider }} ·
                  {{ task.size }}
                </div>
              </td>

              <td>
                <span
                  class="status-pill"
                  :class="
                    statusTone(
                      task.status
                    )
                  "
                >
                  {{ taskStatusLabel(
                    task.status
                  ) }}
                </span>
                <div
                  v-if="task.stale"
                  class="stale-label"
                >
                  已卡住
                </div>
                <div
                  v-else
                  class="cell-sub"
                >
                  {{ stageLabel(task) }}
                </div>
              </td>

              <td>
                <div class="progress-value">
                  {{ task.progress }}%
                </div>
                <div class="progress-track">
                  <i
                    :style="{
                      width:
                        progressWidth(task)
                    }"
                  />
                </div>
              </td>

              <td>
                <div class="cell-main">
                  {{ task.actualImageCount }}
                  /
                  {{ task.requestedImageCount }}
                </div>
                <div class="cell-sub">
                  张图片
                </div>
              </td>

              <td>
                <div class="cell-main">
                  {{ formatPoints(
                    task.actualPoints
                  ) }}
                </div>
                <div class="cell-sub">
                  预留
                  {{ formatPoints(
                    task.reservedPoints
                  ) }}
                </div>
              </td>

              <td>
                <div class="cell-main">
                  {{ formatDuration(
                    task.durationMs
                  ) }}
                </div>
                <div
                  v-if="task.errorCode"
                  class="error-code"
                >
                  {{ errorCodeLabel(task.errorCode) }}
                </div>
              </td>

              <td class="action-column">
                <button
                  v-if="canRefund(task)"
                  type="button"
                  class="danger-button"
                  :disabled="loading"
                  @click="failRefund(task)"
                >
                  终止并退款
                </button>

                <span
                  v-else
                  class="no-action"
                >
                  —
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <div
          v-if="!tasks.length"
          class="empty-state"
        >
          没有符合当前条件的任务
        </div>
      </div>

      <footer class="pagination">
        <button
          type="button"
          :disabled="
            pagination.page <= 1 ||
            loading
          "
          @click="
            loadTasks(
              pagination.page - 1
            )
          "
        >
          上一页
        </button>

        <span>
          第 {{ pagination.page }}
          / {{ pagination.totalPages }} 页
        </span>

        <button
          type="button"
          :disabled="
            pagination.page >=
              pagination.totalPages ||
            loading
          "
          @click="
            loadTasks(
              pagination.page + 1
            )
          "
        >
          下一页
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.task-ops-v2 {
  display: grid;
  gap: 18px;
  width: 100%;
}

.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 4px 0 2px;
}

.hero-copy {
  min-width: 0;
}

.eyebrow {
  margin-bottom: 6px;
  color: #7666df;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .14em;
}

.hero h2 {
  margin: 0;
  color: #191c2a;
  font-size: 25px;
  line-height: 1.25;
}

.hero p {
  margin: 7px 0 0;
  color: #7a8190;
  font-size: 13px;
}

.hero-actions {
  display: flex;
  gap: 10px;
  flex: 0 0 auto;
}

.soft-button,
.primary-button,
.query-button,
.danger-button,
.pagination button {
  min-height: 36px;
  border-radius: 9px;
  padding: 0 14px;
  border: 1px solid #dfe2ea;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}

.soft-button,
.pagination button {
  background: #fff;
  color: #3c4251;
}

.primary-button,
.query-button {
  border-color: #202334;
  background: #202334;
  color: #fff;
}

.danger-button {
  border-color: #f0bbb5;
  background: #fff5f4;
  color: #b42318;
}

button:disabled {
  cursor: not-allowed;
  opacity: .55;
}

.notice {
  margin: 0;
  border-radius: 10px;
  padding: 11px 14px;
  font-size: 13px;
  font-weight: 600;
}

.notice.success {
  background: #effaf3;
  color: #197249;
}

.notice.error {
  background: #fff3f1;
  color: #b42318;
}

.metric-grid {
  display: grid;
  grid-template-columns:
    repeat(6, minmax(0, 1fr));
  gap: 12px;
}

.metric-card {
  min-width: 0;
  min-height: 105px;
  border: 1px solid #e8eaf0;
  border-radius: 15px;
  background: #fff;
  padding: 15px 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  box-shadow:
    0 5px 16px rgba(28, 35, 52, .025);
}

.metric-card > span,
.metric-head > span {
  color: #7b8291;
  font-size: 12px;
  font-weight: 600;
}

.metric-card > strong {
  margin-top: 8px;
  color: #202332;
  font-size: 21px;
  line-height: 1.1;
}

.metric-card > small {
  margin-top: 7px;
  overflow: hidden;
  color: #8b919d;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-card.featured {
  background:
    linear-gradient(
      145deg,
      #ffffff 0%,
      #f7f5ff 100%
    );
}

.metric-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.health-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c3c7cf;
  box-shadow:
    0 0 0 4px rgba(195, 199, 207, .15);
}

.health-dot.ok {
  background: #2a9d62;
  box-shadow:
    0 0 0 4px rgba(42, 157, 98, .12);
}

.health-dot.warning {
  background: #d58b24;
  box-shadow:
    0 0 0 4px rgba(213, 139, 36, .12);
}

.health-dot.critical {
  background: #d6493e;
  box-shadow:
    0 0 0 4px rgba(214, 73, 62, .12);
}

.overview-grid {
  display: grid;
  grid-template-columns:
    minmax(0, 1.55fr)
    minmax(310px, .75fr);
  gap: 14px;
}

.panel {
  min-width: 0;
  border: 1px solid #e7e9ef;
  border-radius: 16px;
  background: #fff;
  box-shadow:
    0 6px 18px rgba(28, 35, 52, .025);
}

.model-panel,
.server-panel {
  padding: 17px 18px;
}

.panel-head,
.task-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.panel-head h3,
.task-panel-head h3 {
  margin: 0;
  color: #262a37;
  font-size: 15px;
}

.panel-head p,
.task-panel-head p {
  margin: 4px 0 0;
  color: #9297a3;
  font-size: 11px;
}

.panel-badge {
  border-radius: 999px;
  background: #f5f4fb;
  padding: 5px 9px;
  color: #7166b8;
  font-size: 11px;
  font-weight: 700;
}

.model-list {
  margin-top: 13px;
}

.model-row {
  display: grid;
  grid-template-columns:
    minmax(210px, 1.5fr)
    minmax(150px, .8fr)
    minmax(150px, .8fr);
  gap: 20px;
  align-items: center;
  padding: 13px 2px;
  border-top: 1px solid #eff0f4;
}

.model-row:first-child {
  border-top: 0;
}

.model-name,
.model-stat {
  min-width: 0;
}

.model-name strong,
.model-stat strong {
  display: block;
  overflow: hidden;
  color: #272b39;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-name span,
.model-stat span,
.model-stat small {
  display: block;
  margin-top: 4px;
  color: #9197a3;
  font-size: 11px;
}

.model-stat > span {
  margin: 0 0 4px;
  color: #858b99;
}

.server-list {
  margin: 12px 0 0;
}

.server-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 39px;
  border-top: 1px solid #eff0f4;
}

.server-list dt {
  color: #777e8d;
  font-size: 12px;
}

.server-list dd {
  margin: 0;
  max-width: 65%;
  overflow: hidden;
  color: #282c39;
  font-size: 12px;
  font-weight: 700;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-panel {
  overflow: hidden;
}

.task-panel-head {
  padding: 17px 18px 0;
}

.filter-bar {
  display: grid;
  grid-template-columns:
    150px
    minmax(150px, .7fr)
    minmax(260px, 1.4fr)
    auto
    auto;
  gap: 10px;
  align-items: end;
  padding: 14px 18px 16px;
}

.field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.field > span {
  color: #858b99;
  font-size: 11px;
  font-weight: 650;
}

.field input,
.field select {
  width: 100%;
  height: 37px;
  box-sizing: border-box;
  border: 1px solid #dfe2e8;
  border-radius: 9px;
  outline: none;
  background: #fff;
  padding: 0 10px;
  color: #333846;
  font-size: 12px;
}

.field input:focus,
.field select:focus {
  border-color: #8e84d9;
  box-shadow:
    0 0 0 3px rgba(142, 132, 217, .1);
}

.stale-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 37px;
  padding: 0 2px;
  color: #626977;
  font-size: 12px;
  white-space: nowrap;
}

.stale-check input {
  width: 14px;
  height: 14px;
  margin: 0;
}

.table-shell {
  overflow-x: auto;
  border-top: 1px solid #eceef2;
}

.task-table {
  width: 100%;
  min-width: 1120px;
  border-collapse: collapse;
  table-layout: fixed;
}

.task-table th {
  height: 42px;
  padding: 0 14px;
  background: #fafafd;
  color: #747b89;
  font-size: 11px;
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
}

.task-table th:nth-child(1) {
  width: 150px;
}

.task-table th:nth-child(2) {
  width: 205px;
}

.task-table th:nth-child(3) {
  width: 115px;
}

.task-table th:nth-child(4) {
  width: 130px;
}

.task-table th:nth-child(5) {
  width: 90px;
}

.task-table th:nth-child(6) {
  width: 110px;
}

.task-table th:nth-child(7) {
  width: 105px;
}

.task-table th:nth-child(8) {
  width: 120px;
}

.task-table td {
  height: 66px;
  box-sizing: border-box;
  border-top: 1px solid #eff0f3;
  padding: 10px 14px;
  vertical-align: middle;
}

.task-table tbody tr {
  transition:
    background-color .15s ease;
}

.task-table tbody tr:hover {
  background: #fafaff;
}

.task-table tbody tr.stale {
  background: #fffaf2;
}

.cell-main,
.progress-value {
  overflow: hidden;
  color: #2b2f3c;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-sub {
  margin-top: 4px;
  overflow: hidden;
  color: #9298a4;
  font-size: 10.5px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-cell {
  max-width: 190px;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 0 9px;
  background: #f2f3f5;
  color: #666d7a;
  font-size: 10.5px;
  font-weight: 750;
}

.status-pill.success {
  background: #eef8f2;
  color: #26835a;
}

.status-pill.danger {
  background: #fff1ef;
  color: #ba3b31;
}

.status-pill.active {
  background: #eef4ff;
  color: #4267a9;
}

.status-pill.muted {
  background: #f2f3f5;
  color: #777d88;
}

.stale-label {
  margin-top: 4px;
  color: #b66b13;
  font-size: 10.5px;
  font-weight: 700;
}

.progress-track {
  width: 100%;
  height: 5px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: #eceef3;
}

.progress-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background:
    linear-gradient(
      90deg,
      #8174dd,
      #6e8ee8
    );
}

.error-code {
  margin-top: 4px;
  overflow: hidden;
  color: #b94b42;
  font-size: 9.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-column {
  text-align: right !important;
}

.danger-button {
  min-height: 30px;
  padding: 0 10px;
  font-size: 10.5px;
}

.no-action {
  color: #b3b7c0;
}

.empty-state {
  padding: 44px 20px;
  color: #969ba6;
  font-size: 12px;
  text-align: center;
}

.empty-state.compact {
  padding: 32px 12px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border-top: 1px solid #eff0f3;
  padding: 14px 18px;
  color: #747b88;
  font-size: 11px;
}

.pagination button {
  min-height: 32px;
  padding: 0 12px;
  font-size: 11px;
}

@media (
  max-width: 1280px
) {
  .metric-grid {
    grid-template-columns:
      repeat(3, minmax(0, 1fr));
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }

  .filter-bar {
    grid-template-columns:
      150px
      1fr
      1.4fr;
  }

  .stale-check,
  .query-button {
    align-self: center;
  }
}

@media (
  max-width: 760px
) {
  .hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .metric-grid {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

  .model-row {
    grid-template-columns: 1fr;
    gap: 9px;
  }

  .filter-bar {
    grid-template-columns: 1fr;
  }

  .stale-check {
    height: auto;
  }
}
</style>

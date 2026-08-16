<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  ref
} from "vue";
import PlatformShell from "../components/PlatformShell.vue";
import {
  ApiError,
  apiRequest
} from "../api/client";
import type {
  GenerationTask,
  GenerationTaskPagination,
  GenerationTaskStatusFilter,
  GenerationTaskSummary
} from "../types";
import {
  formatDate,
  formatPoints
} from "../utils/format";

const records = ref<GenerationTask[]>([]);
const pagination = ref<GenerationTaskPagination>({
  page: 1,
  pageSize: 30,
  total: 0,
  totalPages: 1
});
const summary = ref<GenerationTaskSummary>({
  total: 0,
  active: 0,
  success: 0,
  failed: 0,
  cancelled: 0
});
const status = ref<GenerationTaskStatusFilter>("all");
const search = ref("");
const ready = ref(false);
const authenticated = ref(true);
const loading = ref(false);
const errorMessage = ref("");
let timer: number | undefined;

const filters = computed(() => [
  { value: "all" as const, label: "全部", count: summary.value.total },
  { value: "active" as const, label: "处理中", count: summary.value.active },
  { value: "success" as const, label: "已完成", count: summary.value.success },
  { value: "failed" as const, label: "失败", count: summary.value.failed }
]);

onMounted(async () => {
  await loadTasks();
  timer = window.setInterval(() => {
    if (summary.value.active > 0 && !loading.value) void loadTasks(false);
  }, 4000);
});

onUnmounted(() => {
  if (timer) window.clearInterval(timer);
});

async function loadTasks(resetPage = true) {
  if (resetPage) pagination.value.page = 1;
  loading.value = true;
  errorMessage.value = "";
  try {
    const params = new URLSearchParams({
      page: String(pagination.value.page),
      pageSize: String(pagination.value.pageSize),
      status: status.value
    });
    if (search.value.trim()) params.set("search", search.value.trim());

    const result = await apiRequest<{
      tasks: GenerationTask[];
      pagination: GenerationTaskPagination;
      summary: GenerationTaskSummary;
    }>(`/api/account/tasks?${params.toString()}`);

    records.value = result.tasks || [];
    pagination.value = result.pagination;
    summary.value = result.summary;
    authenticated.value = true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      authenticated.value = false;
      records.value = [];
    } else {
      errorMessage.value = error instanceof Error ? error.message : "读取任务失败";
    }
  } finally {
    ready.value = true;
    loading.value = false;
  }
}

function changeStatus(value: GenerationTaskStatusFilter) {
  status.value = value;
  void loadTasks(true);
}

function statusLabel(task: GenerationTask): string {
  if (task.status === "queued") return "排队中";
  if (task.status === "running") return task.providerProgress || "生成中";
  if (task.status === "success") return "已完成";
  if (task.status === "failed") return task.refundedPoints > 0 ? "失败 · 已退款" : "失败";
  return "已取消";
}

function modelLabel(value: string): string {
  return value.replace(/^grsai-/i, "").replace(/^nanobanana-/i, "").replace(/^gpt-/i, "");
}
</script>

<template>
  <PlatformShell
    title="任务中心"
    subtitle="生成状态 · 进度 · 结果 · 失败与退款"
  >
    <section v-if="ready && authenticated" class="v15-tasks-page">
      <div class="v15-task-summary">
        <article><span>全部任务</span><strong>{{ summary.total }}</strong></article>
        <article><span>处理中</span><strong>{{ summary.active }}</strong></article>
        <article><span>已完成</span><strong>{{ summary.success }}</strong></article>
        <article><span>失败</span><strong>{{ summary.failed }}</strong></article>
      </div>

      <div class="v15-task-toolbar">
        <nav>
          <button
            v-for="item in filters"
            :key="item.value"
            type="button"
            :class="{ active: status === item.value }"
            @click="changeStatus(item.value)"
          >
            {{ item.label }} <span>{{ item.count }}</span>
          </button>
        </nav>
        <form @submit.prevent="loadTasks(true)">
          <input v-model="search" type="search" placeholder="搜索提示词、模型或任务" />
          <button type="submit">搜索</button>
          <button type="button" :disabled="loading" @click="loadTasks(false)">刷新</button>
        </form>
      </div>

      <p v-if="errorMessage" class="v15-task-error">{{ errorMessage }}</p>

      <div v-if="records.length" class="v15-task-list">
        <article v-for="task in records" :key="task.id" class="v15-task-card">
          <div class="v15-task-thumb">
            <img v-if="task.thumbnailUrl" :src="task.thumbnailUrl" alt="任务参考图" />
            <span v-else>{{ task.operation === 'image-edit' ? '图' : 'AI' }}</span>
          </div>
          <div class="v15-task-main">
            <div class="v15-task-head">
              <div>
                <strong>{{ modelLabel(task.model) }}</strong>
                <span :class="`state-${task.status}`">{{ statusLabel(task) }}</span>
              </div>
              <small>{{ formatDate(task.createdAt) }}</small>
            </div>
            <p>{{ task.prompt || '未记录提示词' }}</p>
            <div class="v15-task-progress">
              <span :style="{ width: `${Math.max(0, Math.min(100, task.progress || 0))}%` }"></span>
            </div>
            <div class="v15-task-meta">
              <span>{{ task.size }}</span>
              <span>{{ task.actualImageCount || task.requestedImageCount }} 张</span>
              <span v-if="typeof task.actualPoints === 'number'">{{ formatPoints(task.actualPoints) }} 积分</span>
              <span v-if="task.refundedPoints > 0">退回 {{ formatPoints(task.refundedPoints) }}</span>
              <span v-if="task.errorMessage" class="error">{{ task.errorMessage }}</span>
            </div>
          </div>
          <a v-if="task.historyId" class="v15-task-action" href="/library">查看作品</a>
        </article>
      </div>

      <div v-else-if="!loading" class="v15-task-empty">
        <span>任</span>
        <h2>这里暂时没有任务</h2>
        <p>开始一次 AI 创作后，任务进度会出现在这里。</p>
        <a href="/workspace">开始创作</a>
      </div>

      <div v-if="loading" class="v15-page-loading">正在读取任务...</div>
    </section>

    <section v-else-if="ready" class="v15-login-required">
      <span>任</span>
      <h2>登录后查看任务中心</h2>
      <p>任务进度、积分结算与生成结果均与账号关联。</p>
      <a href="/workspace">前往登录</a>
    </section>

    <section v-else class="v15-page-loading">正在加载任务中心...</section>
  </PlatformShell>
</template>

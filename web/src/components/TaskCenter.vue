<script setup lang="ts">
import {
  computed,
  ref,
  watch
} from "vue";
import type {
  GenerationTask,
  GenerationTaskPagination,
  GenerationTaskQueryState,
  GenerationTaskStatusFilter,
  GenerationTaskSummary,
  ProviderId,
  ServerHistoryRecord
} from "../types";
import {
  providerDisplayName
} from "../utils/format";

const props = defineProps<{
  records: GenerationTask[];
  histories: ServerHistoryRecord[];
  authenticated: boolean;
  pagination:
    GenerationTaskPagination;
  summary:
    GenerationTaskSummary;
  query:
    GenerationTaskQueryState;
}>();

const emit = defineEmits<{
  retry:
    [record: GenerationTask];
  view:
    [record: GenerationTask];
  refresh: [];
  queryChange:
    [query: GenerationTaskQueryState];
  pageChange:
    [page: number];
}>();

const searchText =
  ref(props.query.search);

const expandedTaskId =
  ref<string | null>(null);

const providerOptions:
  ProviderId[] = [
    "grsai",
    "nanobanana",
    "lingke"
  ];

watch(
  () => props.query.search,
  (value) => {
    searchText.value = value;
  }
);

const statusOptions:
  Array<{
    value:
      GenerationTaskStatusFilter;
    label: string;
    count: () => number;
  }> = [
    {
      value: "all",
      label: "全部",
      count: () =>
        props.summary.total
    },
    {
      value: "active",
      label: "进行中",
      count: () =>
        props.summary.active
    },
    {
      value: "success",
      label: "已完成",
      count: () =>
        props.summary.success
    },
    {
      value: "failed",
      label: "失败",
      count: () =>
        props.summary.failed
    }
  ];

const visiblePages =
  computed(() => {
    const total =
      props.pagination
        .totalPages;

    const current =
      props.pagination.page;

    const start =
      Math.max(
        1,
        Math.min(
          current - 2,
          total - 4
        )
      );

    const end =
      Math.min(
        total,
        start + 4
      );

    const pages: number[] = [];

    for (
      let page = start;
      page <= end;
      page += 1
    ) {
      pages.push(page);
    }

    return pages;
  });

function updateQuery(
  patch:
    Partial<
      GenerationTaskQueryState
    >
) {
  emit(
    "queryChange",
    {
      ...props.query,
      ...patch,
      page: 1
    }
  );
}

function setStatus(
  status:
    GenerationTaskStatusFilter
) {
  updateQuery({ status });
}

function setProvider(
  provider:
    "all" | ProviderId
) {
  updateQuery({ provider });
}

function submitSearch() {
  updateQuery({
    search:
      searchText.value.trim()
  });
}

function clearSearch() {
  searchText.value = "";
  updateQuery({
    search: ""
  });
}

function matchingHistory(
  record: GenerationTask
): ServerHistoryRecord | undefined {
  if (record.historyId) {
    const exact =
      props.histories.find(
        (item) =>
          item.id ===
          record.historyId
      );

    if (exact) return exact;
  }

  return props.histories.find(
    (item) =>
      item.model ===
        record.model &&
      item.prompt ===
        (record.prompt || "") &&
      Math.abs(
        new Date(
          item.createdAt
        ).getTime() -
        new Date(
          record.createdAt
        ).getTime()
      ) <
        10 * 60 * 1000
  );
}

function thumbnail(
  record: GenerationTask
): string | undefined {
  return (
    record.thumbnailUrl ||
    matchingHistory(record)
      ?.images[0]?.url
  );
}

function canView(
  record: GenerationTask
): boolean {
  return Boolean(
    record.historyId ||
    matchingHistory(record)
  );
}

function statusText(
  record: GenerationTask
): string {
  if (
    record.status === "success"
  ) {
    return "已完成";
  }

  if (
    record.status === "failed"
  ) {
    return record.refundedPoints > 0
      ? "失败 · 已退款"
      : "失败";
  }

  if (
    record.status === "cancelled"
  ) {
    return "已取消";
  }

  if (
    record.status === "queued"
  ) {
    return "排队中";
  }

  return "生成中";
}

function stageText(
  record: GenerationTask
): string {
  if (record.providerProgress) {
    return record.providerProgress;
  }

  const labels:
    Record<string, string> = {
      queued:
        "任务已创建",
      reserving:
        "正在预扣积分",
      preparing:
        "正在准备商品素材",
      submitting:
        "正在提交模型",
      processing:
        "AI 正在生成画面",
      downloading:
        "正在下载生成图片",
      saving:
        "正在保存生成结果",
      settling:
        "正在结算积分",
      completed:
        "生成完成",
      failed:
        "生成失败",
      refunded:
        "生成失败，积分已退回"
    };

  return (
    labels[record.stage] ||
    record.errorMessage ||
    "正在处理"
  );
}

function displayPoints(
  record: GenerationTask
): number {
  if (
    record.status === "queued" ||
    record.status === "running"
  ) {
    return (
      record.reservedPoints ||
      0
    );
  }

  return (
    record.actualPoints ||
    0
  );
}

function formatTime(
  value: string | undefined
): string {
  if (!value) return "—";

  return new Intl.DateTimeFormat(
    "zh-CN",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }
  ).format(
    new Date(value)
  );
}

function toggleDetails(
  taskId: string
) {
  expandedTaskId.value =
    expandedTaskId.value ===
      taskId
      ? null
      : taskId;
}

async function copyTaskId(
  taskId: string
) {
  try {
    await navigator.clipboard
      .writeText(taskId);
  } catch {
    window.prompt(
      "复制任务 ID",
      taskId
    );
  }
}
</script>

<template>
  <section
    id="task-center"
    class="task-center panel-card"
  >
    <div class="task-center-head">
      <div>
        <p class="section-kicker">
          TASK CENTER
        </p>
        <h2>生成任务</h2>
        <p>
          MySQL 持久化记录，可按状态和服务商筛选。
        </p>
      </div>

      <div class="task-center-actions">
        <span
          v-if="summary.active"
          class="active-task-badge"
        >
          {{ summary.active }}
          个进行中
        </span>

        <button
          type="button"
          class="task-refresh"
          :disabled="!authenticated"
          @click="emit('refresh')"
        >
          刷新
        </button>
      </div>
    </div>

    <div
      v-if="!authenticated"
      class="task-empty"
    >
      登录后查看生成任务。
    </div>

    <template v-else>
      <div class="task-summary-grid">
        <button
          v-for="option in statusOptions"
          :key="option.value"
          type="button"
          class="task-summary-card"
          :class="{
            active:
              query.status ===
              option.value
          }"
          @click="
            setStatus(option.value)
          "
        >
          <span>
            {{ option.label }}
          </span>
          <strong>
            {{ option.count() }}
          </strong>
        </button>
      </div>

      <div class="task-toolbar">
        <form
          class="task-search"
          @submit.prevent="
            submitSearch
          "
        >
          <input
            v-model="searchText"
            type="search"
            placeholder="搜索提示词、模型、任务 ID"
          />

          <button
            v-if="searchText"
            type="button"
            class="task-search-clear"
            @click="clearSearch"
          >
            清除
          </button>

          <button
            type="submit"
            class="task-search-submit"
          >
            搜索
          </button>
        </form>

        <div
          class="task-provider-filter"
          aria-label="服务商筛选"
        >
          <button
            type="button"
            :class="{
              active:
                query.provider ===
                'all'
            }"
            @click="
              setProvider('all')
            "
          >
            全部厂商
          </button>

          <button
            v-for="provider in providerOptions"
            :key="provider"
            type="button"
            :class="{
              active:
                query.provider ===
                provider
            }"
            @click="
              setProvider(provider)
            "
          >
            {{
              providerDisplayName(
                provider
              )
            }}
          </button>
        </div>
      </div>

      <div
        v-if="!records.length"
        class="task-empty"
      >
        当前筛选条件下没有任务。
      </div>

      <div
        v-else
        class="task-list"
      >
        <article
          v-for="record in records"
          :key="record.id"
          class="task-card"
          :class="
            'is-' +
            record.status
          "
        >
          <div class="task-thumb">
            <img
              v-if="thumbnail(record)"
              :src="thumbnail(record)"
              alt="商品缩略图"
            />

            <div
              v-else
              class="task-thumb-placeholder"
            >
              AI
            </div>
          </div>

          <div class="task-main">
            <div class="task-title-row">
              <div>
                <strong>
                  {{ record.model }}
                </strong>

                <span>
                  {{
                    providerDisplayName(
                      record.provider ===
                        "lingke" ||
                      record.provider ===
                        "grsai" ||
                      record.provider ===
                        "nanobanana"
                        ? record.provider
                        : undefined
                    )
                  }}
                  ·
                  {{
                    formatTime(
                      record.createdAt
                    )
                  }}
                  ·
                  {{ record.size }}
                </span>
              </div>

              <span class="task-status">
                {{ statusText(record) }}
              </span>
            </div>

            <p class="task-prompt">
              {{
                record.prompt ||
                "未填写提示词"
              }}
            </p>

            <div
              class="task-progress-line"
            >
              <span>
                {{ stageText(record) }}
              </span>

              <strong>
                {{ record.progress }}%
              </strong>
            </div>

            <div
              class="task-progress-track"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="
                record.progress
              "
            >
              <span
                :style="{
                  width:
                    record.progress +
                    '%'
                }"
              ></span>
            </div>

            <div class="task-footer">
              <span>
                {{
                  record.status ===
                    "queued" ||
                  record.status ===
                    "running"
                    ? "已预扣"
                    : "实际消耗"
                }}

                <strong>
                  {{
                    displayPoints(
                      record
                    )
                  }}
                </strong>
                积分

                <em
                  v-if="
                    record.refundedPoints >
                    0
                  "
                >
                  · 已退回
                  {{
                    record.refundedPoints
                  }}
                  积分
                </em>
              </span>

              <div>
                <button
                  type="button"
                  class="task-detail-button"
                  @click="
                    toggleDetails(
                      record.id
                    )
                  "
                >
                  {{
                    expandedTaskId ===
                      record.id
                      ? "收起详情"
                      : "任务详情"
                  }}
                </button>

                <button
                  type="button"
                  class="task-secondary"
                  @click="
                    emit(
                      'retry',
                      record
                    )
                  "
                >
                  重新生成
                </button>

                <button
                  type="button"
                  class="task-primary"
                  :disabled="
                    !canView(record)
                  "
                  @click="
                    emit(
                      'view',
                      record
                    )
                  "
                >
                  查看结果
                </button>
              </div>
            </div>

            <div
              v-if="
                expandedTaskId ===
                record.id
              "
              class="task-details"
            >
              <dl>
                <div>
                  <dt>任务 ID</dt>
                  <dd>
                    <code>
                      {{ record.id }}
                    </code>
                    <button
                      type="button"
                      @click="
                        copyTaskId(
                          record.id
                        )
                      "
                    >
                      复制
                    </button>
                  </dd>
                </div>

                <div>
                  <dt>生成方式</dt>
                  <dd>
                    {{
                      record.operation ===
                        "image-edit"
                        ? "参考图生成"
                        : "文生图"
                    }}
                  </dd>
                </div>

                <div>
                  <dt>请求数量</dt>
                  <dd>
                    {{
                      record
                        .requestedImageCount
                    }}
                    张
                  </dd>
                </div>

                <div>
                  <dt>实际数量</dt>
                  <dd>
                    {{
                      record
                        .actualImageCount
                    }}
                    张
                  </dd>
                </div>

                <div>
                  <dt>开始时间</dt>
                  <dd>
                    {{
                      formatTime(
                        record.startedAt
                      )
                    }}
                  </dd>
                </div>

                <div>
                  <dt>完成时间</dt>
                  <dd>
                    {{
                      formatTime(
                        record.completedAt
                      )
                    }}
                  </dd>
                </div>

                <div>
                  <dt>服务商任务 ID</dt>
                  <dd>
                    {{
                      record
                        .providerTaskId ||
                      "—"
                    }}
                  </dd>
                </div>

                <div>
                  <dt>历史记录 ID</dt>
                  <dd>
                    {{
                      record.historyId ||
                      "—"
                    }}
                  </dd>
                </div>
              </dl>
            </div>

            <p
              v-if="
                record.errorMessage
              "
              class="task-error"
            >
              {{
                record.errorCode
                  ? record.errorCode +
                    "："
                  : ""
              }}
              {{ record.errorMessage }}
            </p>
          </div>
        </article>
      </div>

      <div
        v-if="
          pagination.totalPages > 1
        "
        class="task-pagination"
      >
        <button
          type="button"
          :disabled="
            pagination.page <= 1
          "
          @click="
            emit(
              'pageChange',
              pagination.page - 1
            )
          "
        >
          上一页
        </button>

        <button
          v-for="page in visiblePages"
          :key="page"
          type="button"
          :class="{
            active:
              page ===
              pagination.page
          }"
          @click="
            emit(
              'pageChange',
              page
            )
          "
        >
          {{ page }}
        </button>

        <button
          type="button"
          :disabled="
            pagination.page >=
            pagination.totalPages
          "
          @click="
            emit(
              'pageChange',
              pagination.page + 1
            )
          "
        >
          下一页
        </button>

        <span>
          共
          {{ pagination.total }}
          条
        </span>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ServerHistoryRecord, UsageRecord } from "../types";

const props = defineProps<{
  records: UsageRecord[];
  histories: ServerHistoryRecord[];
  authenticated: boolean;
}>();

const emit = defineEmits<{
  retry: [record: UsageRecord];
  view: [record: UsageRecord];
  refresh: [];
}>();

const activeCount = computed(() => props.records.filter((record) => record.status === "submitted").length);

function matchingHistory(record: UsageRecord): ServerHistoryRecord | undefined {
  return props.histories.find((item) =>
    item.model === record.model &&
    item.prompt === (record.prompt || "") &&
    Math.abs(new Date(item.createdAt).getTime() - new Date(record.createdAt).getTime()) < 10 * 60 * 1000
  );
}

function thumbnail(record: UsageRecord): string | undefined {
  return matchingHistory(record)?.images[0]?.url;
}

function canView(record: UsageRecord): boolean {
  return Boolean(matchingHistory(record));
}

function statusText(record: UsageRecord): string {
  if (record.status === "success") return "已完成";
  if (record.status === "failed") return record.pointsRefunded ? "失败 · 已退款" : "失败";
  return "生成中";
}

function stageText(record: UsageRecord): string {
  if (record.status === "success") return "生成完成";
  if (record.status === "failed") return record.pointsRefunded ? "生成失败，积分已退回" : (record.error || "生成失败");
  return record.requestId ? "AI 正在生成画面" : "任务已提交";
}

function progress(record: UsageRecord): number {
  if (record.status === "success" || record.status === "failed") return 100;
  return record.requestId ? 68 : 35;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
</script>

<template>
  <section class="task-center panel-card">
    <div class="task-center-head">
      <div>
        <p class="section-kicker">TASK CENTER</p>
        <h2>生成任务</h2>
        <p>任务记录保存在 MySQL，刷新页面后仍可恢复。</p>
      </div>
      <div class="task-center-actions">
        <span v-if="activeCount" class="active-task-badge">{{ activeCount }} 个进行中</span>
        <button type="button" class="task-refresh" :disabled="!authenticated" @click="emit('refresh')">刷新</button>
      </div>
    </div>

    <div v-if="!authenticated" class="task-empty">登录后查看生成任务。</div>
    <div v-else-if="!records.length" class="task-empty">还没有生成任务。</div>

    <div v-else class="task-list">
      <article v-for="record in records" :key="record.id" class="task-card" :class="'is-' + record.status">
        <div class="task-thumb">
          <img v-if="thumbnail(record)" :src="thumbnail(record)" alt="商品缩略图" />
          <div v-else class="task-thumb-placeholder">AI</div>
        </div>

        <div class="task-main">
          <div class="task-title-row">
            <div>
              <strong>{{ record.model }}</strong>
              <span>{{ formatTime(record.createdAt) }} · {{ record.size }}</span>
            </div>
            <span class="task-status">{{ statusText(record) }}</span>
          </div>

          <p class="task-prompt">{{ record.prompt || "未填写提示词" }}</p>

          <div class="task-progress-line">
            <span>{{ stageText(record) }}</span>
            <strong>{{ progress(record) }}%</strong>
          </div>
          <div class="task-progress-track">
            <span :style="{ width: progress(record) + '%' }"></span>
          </div>

          <div class="task-footer">
            <span>
              {{ record.status === "submitted" ? "已预扣" : "实际消耗" }}
              <strong>{{ record.pointsCost ?? 0 }}</strong> 积分
              <em v-if="record.pointsRefunded"> · 已退款</em>
            </span>
            <div>
              <button type="button" class="task-secondary" @click="emit('retry', record)">重新生成</button>
              <button type="button" class="task-primary" :disabled="!canView(record)" @click="emit('view', record)">查看结果</button>
            </div>
          </div>

          <p v-if="record.error" class="task-error">{{ record.error }}</p>
        </div>
      </article>
    </div>
  </section>
</template>

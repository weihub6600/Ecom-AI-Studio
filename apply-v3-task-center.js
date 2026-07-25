#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();
const backupDir = path.join(root, ".v3-task-center-backup");
const touched = [
  "web/src/App.vue",
  "web/src/style.css",
  "web/src/components/TaskCenter.vue"
];

function p(rel) { return path.join(root, rel); }
function read(rel) {
  const f = p(rel);
  if (!fs.existsSync(f)) throw new Error(`缺少文件：${rel}`);
  return fs.readFileSync(f, "utf8");
}
function write(rel, content) {
  const f = p(rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content.replace(/\r?\n/g, "\n"), "utf8");
}
function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`无法定位修改位置：${label}`);
  return text.replace(from, to);
}
function backup() {
  fs.rmSync(backupDir, { recursive: true, force: true });
  for (const rel of touched) {
    const src = p(rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
function rollback() {
  if (!fs.existsSync(backupDir)) throw new Error("没有找到 V3 备份");
  for (const rel of touched) {
    const src = path.join(backupDir, rel);
    const dst = p(rel);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    } else if (fs.existsSync(dst)) {
      fs.rmSync(dst, { force: true });
    }
  }
}
function build() {
  const win = process.platform === "win32";
  const command = win ? (process.env.ComSpec || "cmd.exe") : "npm";
  const args = win ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];
  const r = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe", shell: false });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) console.error(r.error.message);
  console.log(`npm run build 退出代码：${r.status}`);
  return r.status === 0;
}

const component = `<script setup lang="ts">
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
`;

function patchApp() {
  let s = read("web/src/App.vue");

  if (!s.includes('import TaskCenter from "./components/TaskCenter.vue";')) {
    s = replaceOnce(
      s,
      'import HistoryPanel from "./components/HistoryPanel.vue";',
      'import HistoryPanel from "./components/HistoryPanel.vue";\nimport TaskCenter from "./components/TaskCenter.vue";',
      "导入 TaskCenter"
    );
  }

  if (!s.includes("  UsageRecord,")) {
    s = replaceOnce(
      s,
      "  UploadImage\n} from \"./types\";",
      "  UploadImage,\n  UsageRecord\n} from \"./types\";",
      "导入 UsageRecord"
    );
  }

  if (!s.includes("const taskRecords = ref<UsageRecord[]>([]);")) {
    s = replaceOnce(
      s,
      "const userPanelOpen = ref(false);",
      "const userPanelOpen = ref(false);\nconst taskRecords = ref<UsageRecord[]>([]);\nlet taskRefreshTimer: number | undefined;",
      "任务状态变量"
    );
  }

  s = replaceOnce(
    s,
    "  if (authUser.value) await loadHistory(true);\n});",
    "  if (authUser.value) {\n    await Promise.all([loadHistory(true), loadTasks()]);\n    startTaskRefresh();\n  }\n});",
    "启动时读取任务"
  );

  s = replaceOnce(
    s,
    "  await loadHistory(true);\n}",
    "  await Promise.all([loadHistory(true), loadTasks()]);\n  startTaskRefresh();\n}",
    "登录后读取任务"
  );

  if (!s.includes("taskRecords.value = [];")) {
    s = replaceOnce(
      s,
      "    historyRecords.value = [];\n    activeHistoryId.value = null;",
      "    historyRecords.value = [];\n    taskRecords.value = [];\n    stopTaskRefresh();\n    activeHistoryId.value = null;",
      "退出时清理任务"
    );
  }

  if (!s.includes("async function loadTasks()")) {
    const funcs = `async function loadTasks() {
  if (!authUser.value) {
    taskRecords.value = [];
    return;
  }
  try {
    const data = await apiRequest<{ records: UsageRecord[] }>("/api/account/usage?limit=50");
    taskRecords.value = data.records || [];
    if (taskRecords.value.some((record) => record.status === "submitted")) startTaskRefresh();
    else stopTaskRefresh();
  } catch (error) {
    handleProtectedApiError(error, "读取生成任务失败");
  }
}

function startTaskRefresh() {
  if (taskRefreshTimer || !authUser.value) return;
  taskRefreshTimer = window.setInterval(() => {
    if (!document.hidden) void loadTasks();
  }, 3000);
}

function stopTaskRefresh() {
  if (!taskRefreshTimer) return;
  window.clearInterval(taskRefreshTimer);
  taskRefreshTimer = undefined;
}

async function retryUsageTask(record: UsageRecord) {
  const model = models.value.find((item) => item.id === record.model);
  if (model) {
    selectedProviderId.value = model.provider;
    await nextTick();
    selectedModelId.value = model.id;
  }
  generationMode.value = record.operation;
  prompt.value = record.prompt || prompt.value;
  outputSize.value = record.size;
  count.value = Math.max(1, record.imageCount || 1);
  window.requestAnimationFrame(() =>
    document.querySelector(".generation-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    })
  );
}

async function viewUsageTask(record: UsageRecord) {
  let history = historyRecords.value.find((item) =>
    item.model === record.model &&
    item.prompt === (record.prompt || "") &&
    Math.abs(new Date(item.createdAt).getTime() - new Date(record.createdAt).getTime()) < 10 * 60 * 1000
  );
  if (!history) {
    await loadHistory(false);
    history = historyRecords.value.find((item) =>
      item.model === record.model &&
      item.prompt === (record.prompt || "") &&
      Math.abs(new Date(item.createdAt).getTime() - new Date(record.createdAt).getTime()) < 10 * 60 * 1000
    );
  }
  if (history) await restoreHistory(history);
}

`;
    s = replaceOnce(s, "async function loadHistory(restoreLatest = false) {", funcs + "async function loadHistory(restoreLatest = false) {", "任务函数");
  }

  s = replaceOnce(
    s,
    "    if (typeof response.credits === \"number\") handleBalanceUpdated(response.credits);\n\n    let result = response.result;",
    "    if (typeof response.credits === \"number\") handleBalanceUpdated(response.credits);\n    await loadTasks();\n\n    let result = response.result;",
    "提交后刷新任务"
  );

  s = replaceOnce(
    s,
    "  } finally {\n    loading.value = false;\n    pollingProgress.value = \"\";\n  }\n}",
    "  } finally {\n    loading.value = false;\n    pollingProgress.value = \"\";\n    await loadTasks();\n  }\n}",
    "结束后刷新任务"
  );

  if (!s.includes("<TaskCenter")) {
    s = replaceOnce(
      s,
      "          <HistoryPanel",
      `          <TaskCenter
            :records="taskRecords"
            :histories="historyRecords"
            :authenticated="isAuthenticated"
            @retry="retryUsageTask"
            @view="viewUsageTask"
            @refresh="loadTasks"
          />
          <HistoryPanel`,
      "插入任务中心"
    );
  }

  write("web/src/App.vue", s);
}

function patchStyle() {
  let s = read("web/src/style.css");
  if (s.includes(".task-center-head")) return;
  s += `

/* V3 MySQL 持久化任务中心 */
.task-center { margin-top:18px; padding:22px; }
.task-center-head { display:flex; justify-content:space-between; gap:16px; margin-bottom:16px; }
.task-center-head h2 { margin:2px 0 4px; font-size:20px; }
.task-center-head p { margin:0; color:var(--text-muted, #6b7280); }
.task-center-actions { display:flex; align-items:center; gap:10px; }
.active-task-badge { padding:6px 10px; border-radius:999px; background:var(--accent-soft, #eef2ff); color:var(--accent, #4f46e5); font-size:12px; font-weight:700; }
.task-refresh,.task-secondary,.task-primary { border:0; border-radius:10px; padding:9px 13px; cursor:pointer; font:inherit; font-weight:700; }
.task-refresh,.task-secondary { background:var(--surface-subtle, #f3f4f6); color:var(--text, #111827); }
.task-primary { background:var(--accent, #4f46e5); color:#fff; }
.task-primary:disabled,.task-refresh:disabled { opacity:.45; cursor:not-allowed; }
.task-empty { padding:28px 12px; text-align:center; color:var(--text-muted, #6b7280); border:1px dashed var(--border, #d1d5db); border-radius:14px; }
.task-list { display:grid; gap:12px; }
.task-card { display:grid; grid-template-columns:86px minmax(0,1fr); gap:14px; padding:14px; border:1px solid var(--border, #e5e7eb); border-radius:16px; background:var(--surface, #fff); }
.task-card.is-submitted { border-color:color-mix(in srgb, var(--accent, #4f46e5) 38%, var(--border, #e5e7eb)); }
.task-card.is-failed { border-color:color-mix(in srgb, #ef4444 38%, var(--border, #e5e7eb)); }
.task-thumb { width:86px; height:86px; overflow:hidden; border-radius:13px; background:var(--surface-subtle, #f3f4f6); }
.task-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.task-thumb-placeholder { width:100%; height:100%; display:grid; place-items:center; color:var(--text-muted, #6b7280); font-size:24px; font-weight:800; }
.task-main { min-width:0; }
.task-title-row { display:flex; justify-content:space-between; gap:12px; }
.task-title-row strong { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.task-title-row span,.task-status { color:var(--text-muted, #6b7280); font-size:12px; }
.task-status { flex:none; font-weight:800; }
.task-prompt { margin:8px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text-muted, #6b7280); font-size:13px; }
.task-progress-line { display:flex; justify-content:space-between; margin-top:8px; font-size:13px; }
.task-progress-track { height:7px; margin-top:7px; overflow:hidden; border-radius:999px; background:var(--surface-subtle, #eef0f4); }
.task-progress-track span { display:block; height:100%; border-radius:inherit; background:var(--accent, #4f46e5); transition:width .35s ease; }
.task-footer { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:12px; font-size:13px; }
.task-footer>div { display:flex; gap:8px; }
.task-footer em { color:#16a34a; font-style:normal; }
.task-error { margin:10px 0 0; color:#dc2626; font-size:12px; }
@media (max-width:720px) {
  .task-center-head,.task-footer { flex-direction:column; align-items:stretch; }
  .task-card { grid-template-columns:64px minmax(0,1fr); }
  .task-thumb { width:64px; height:64px; }
  .task-footer>div { width:100%; }
  .task-footer button { flex:1; }
}
`;
  write("web/src/style.css", s);
}

function apply() {
  console.log(`项目目录：${root}`);
  backup();
  write("web/src/components/TaskCenter.vue", component);
  patchApp();
  patchStyle();

  if (process.argv.includes("--skip-build")) {
    console.log("已跳过构建检查。");
    return;
  }

  console.log("正在执行 npm run build ...");
  if (!build()) {
    if (!process.argv.includes("--keep-on-build-failure")) {
      console.log("构建失败，正在自动回滚...");
      rollback();
      throw new Error("补丁未保留：构建失败后已自动回滚。");
    }
    throw new Error("构建失败，但已保留修改。");
  }
  console.log("V3 任务中心补丁安装成功。");
}

try {
  if (process.argv.includes("--rollback")) {
    rollback();
    console.log("V3 补丁已回滚。");
  } else {
    apply();
  }
} catch (error) {
  console.error("\n补丁执行失败：");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

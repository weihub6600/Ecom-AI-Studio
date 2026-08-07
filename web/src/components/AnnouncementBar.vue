<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiRequest } from "../api/client";

interface Announcement {
  id: string;
  title: string;
  content: string;
  kind: "info" | "warning" | "success";
  pinned: boolean;
  updatedAt: string;
}

const announcements = ref<Announcement[]>([]);
const dismissed = ref(new Set<string>());

const visible = computed(() =>
  announcements.value.filter(
    (item) => !dismissed.value.has(dismissKey(item))
  )
);

onMounted(async () => {
  try {
    const data = await apiRequest<{ announcements: Announcement[] }>(
      "/api/announcements/active"
    );
    announcements.value = data.announcements || [];
    dismissed.value = readDismissed();
  } catch {
    announcements.value = [];
  }
});

function dismiss(item: Announcement) {
  const next = new Set(dismissed.value);
  next.add(dismissKey(item));
  dismissed.value = next;
  try {
    sessionStorage.setItem(
      "ecom-ai-studio:dismissed-announcements",
      JSON.stringify([...next])
    );
  } catch {
    // 浏览器禁用 sessionStorage 时，只在当前页面隐藏。
  }
}

function dismissKey(item: Announcement) {
  return `${item.id}:${item.updatedAt}`;
}

function readDismissed(): Set<string> {
  try {
    const value = JSON.parse(
      sessionStorage.getItem("ecom-ai-studio:dismissed-announcements") || "[]"
    );
    return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}
</script>

<template>
  <div v-if="visible.length" class="announcement-stack" aria-label="站点公告">
    <article
      v-for="item in visible"
      :key="item.id"
      class="announcement-bar"
      :class="item.kind"
    >
      <span class="announcement-icon">{{ item.pinned ? '置' : '公' }}</span>
      <div>
        <strong>{{ item.title }}</strong>
        <p>{{ item.content }}</p>
      </div>
      <button type="button" aria-label="关闭公告" @click="dismiss(item)">×</button>
    </article>
  </div>
</template>

<style scoped>
.announcement-stack {
  display: grid;
  gap: 7px;
  width: min(1420px, calc(100% - 32px));
  margin: 12px auto 0;
}
.announcement-bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  border: 1px solid #dfe5f1;
  border-radius: 12px;
  background: #f8faff;
  padding: 8px 11px;
  box-shadow: 0 4px 14px rgba(34, 43, 65, .035);
}
.announcement-bar.warning { background: #fff9ee; border-color: #f2dfb7; }
.announcement-bar.success { background: #f1faf5; border-color: #cde8d8; }
.announcement-icon {
  display: inline-grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border-radius: 8px;
  background: #6d66c8;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
}
.warning .announcement-icon { background: #c48629; }
.success .announcement-icon { background: #2c8a5b; }
.announcement-bar div { min-width: 0; }
.announcement-bar strong { color: #272b38; font-size: 12px; }
.announcement-bar p {
  margin: 2px 0 0;
  color: #697181;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
}
.announcement-bar button {
  border: 0;
  background: transparent;
  color: #9197a3;
  font-size: 20px;
  cursor: pointer;
}
@media (max-width: 720px) {
  .announcement-stack { width: calc(100% - 20px); }
  .announcement-bar { align-items: start; }
}
</style>

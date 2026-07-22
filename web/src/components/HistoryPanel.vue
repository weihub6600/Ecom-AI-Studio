<script setup lang="ts">
import { computed, ref } from "vue";
import type { ServerHistoryRecord } from "../types";
import { formatDate, formatSizeTitle, providerDisplayName } from "../utils/format";

const props = defineProps<{
  records: ServerHistoryRecord[];
  activeHistoryId: string | null;
  authenticated: boolean;
  favorites: Set<string>;
  filterMode: "all" | "favorites";
}>();

const emit = defineEmits<{
  restore: [record: ServerHistoryRecord];
  reGenerate: [record: ServerHistoryRecord];
  remove: [record: ServerHistoryRecord];
  clear: [];
  showResult: [];
  toggleFavorite: [id: string];
  "update:filterMode": [value: "all" | "favorites"];
}>();

const searchQuery = ref("");

const filteredRecords = computed(() => {
  let list = props.records;
  // 收藏筛选
  if (props.filterMode === "favorites") {
    list = list.filter((r) => props.favorites.has(r.id));
  }
  // 关键词搜索
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase();
    list = list.filter(
      (r) =>
        (r.prompt || "").toLowerCase().includes(q) ||
        (r.mode || r.operation || "").toLowerCase().includes(q) ||
        (r.modelName || r.model || "").toLowerCase().includes(q) ||
        (r.size || "").toLowerCase().includes(q)
    );
  }
  return list;
});
</script>

<template>
  <section id="history-panel" class="history-panel panel">
    <div class="history-heading">
      <div>
        <span class="step-number">03</span>
        <div>
          <h2>生成历史</h2>
          <p>最近 20 条来自 MySQL，可在不同设备登录后继续查看</p>
        </div>
      </div>

      <div class="history-heading-actions">
        <button
          type="button"
          class="section-jump-button"
          aria-controls="result-panel"
          @click="emit('showResult')"
        >
          返回结果
        </button>
        <button
          v-if="props.records.length"
          type="button"
          class="history-clear"
          @click="emit('clear')"
        >
          清空列表
        </button>
      </div>
    </div>

    <!-- 搜索与筛选栏 -->
    <div class="history-toolbar" v-if="props.records.length">
      <div class="history-search">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索 prompt、模式、规格..."
          class="history-search-input"
        />
        <button v-if="searchQuery" type="button" class="search-clear" @click="searchQuery = ''">✕</button>
        <button type="button" class="search-btn" title="搜索">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
      </div>
      <div class="history-filter-btns">
        <button
          type="button"
          :class="{ active: props.filterMode === 'all' }"
          @click="emit('update:filterMode', 'all')"
        >全部</button>
        <button
          type="button"
          :class="{ active: props.filterMode === 'favorites' }"
          @click="emit('update:filterMode', 'favorites')"
        >⭐ 收藏</button>
      </div>
    </div>

    <div v-if="filteredRecords.length" class="history-grid">
      <article
        v-for="record in filteredRecords"
        :key="record.id"
        class="history-card"
        :class="{ active: props.activeHistoryId === record.id }"
      >
        <button type="button" class="history-thumb" @click="emit('restore', record)">
          <img v-if="record.images[0]" :src="record.images[0].url" :alt="record.prompt" />
          <span v-if="record.images.length > 1">{{ record.images.length }} 张</span>
        </button>

        <div class="history-copy">
          <div class="history-meta">
            <strong>{{ providerDisplayName(record.provider, record.providerName) }} · {{ record.model }}</strong>
            <span>{{ formatDate(record.createdAt) }}</span>
          </div>
          <p>{{ record.prompt }}</p>
          <small>
            {{ record.operation === "image-edit" ? "参考图生成" : "文生图" }}
            · {{ formatSizeTitle(record.size) }}
          </small>
        </div>

        <div class="history-actions">
          <button type="button" @click="emit('restore', record)">恢复</button>
          <button type="button" class="regenerate" @click="emit('reGenerate', record)">再次生成</button>
          <button type="button" class="favorite" @click="emit('toggleFavorite', record.id)">
            {{ props.favorites.has(record.id) ? "★ 已收藏" : "☆ 收藏" }}
          </button>
          <button type="button" class="danger" @click="emit('remove', record)">从本机移除</button>
        </div>
      </article>
    </div>

    <div v-else class="history-empty">
      {{
        searchQuery
          ? `未找到与"${searchQuery}"匹配的历史记录`
          : props.filterMode === "favorites"
            ? "暂无收藏记录，点击历史卡片中的 ☆ 收藏 即可标记"
            : props.authenticated
              ? "当前账号还没有历史。下一次生成成功后会在本机保留最近 20 条，同时完整归档到 MySQL。"
              : "登录后可使用 AI 生图，并查看当前账号在本机保存的最近历史。"
      }}
    </div>
  </section>
</template>

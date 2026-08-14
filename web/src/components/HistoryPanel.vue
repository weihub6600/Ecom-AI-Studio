<script setup lang="ts">
import type { ServerHistoryRecord } from "../types";
import { formatDate, formatSizeTitle, providerDisplayName } from "../utils/format";

const props = defineProps<{
  records: ServerHistoryRecord[];
  activeHistoryId: string | null;
  authenticated: boolean;
  favorites: Set<string>;
}>();

const emit = defineEmits<{
  restore: [record: ServerHistoryRecord];
  adjust: [record: ServerHistoryRecord];
  remove: [record: ServerHistoryRecord];
  clear: [];
  showResult: [];
  toggleFavorite: [id: string];
}>();

</script>

<template>
  <section id="history-panel" class="history-panel panel">
<div class="history-heading">
  <div>
    <span class="step-number">03</span>
    <div>
      <h2>生成历史</h2>
      <p>首页仅展示最近 3 条，更多记录请进入用户后台查看</p>
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
  </div>
</div>



    <div v-if="props.records.length" class="history-grid">
      <article
        v-for="record in props.records"
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
          <button type="button" class="regenerate" @click="emit('adjust', record)">再次调整</button>
          <button type="button" class="favorite" @click="emit('toggleFavorite', record.id)">
            {{ props.favorites.has(record.id) ? "★ 已收藏" : "☆ 收藏" }}
          </button>
          <button type="button" class="danger" @click="emit('remove', record)">从本机移除</button>
        </div>
      </article>
    </div>

    <div v-else class="history-empty">
  {{
    props.authenticated
      ? "当前账号还没有生成历史。"
      : "登录后可查看生成历史。"
  }}
</div>
  </section>
</template>

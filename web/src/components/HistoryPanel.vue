<script setup lang="ts">
// V14_3_1_3_1_HISTORY_DISPLAY_MODEL_NAME
// V14_3_1_3_HISTORY_MODEL_ONLY
import type { ModelCapability, ServerHistoryRecord } from "../types";
import { formatDate, formatSizeTitle } from "../utils/format";

const props = defineProps<{
  records: ServerHistoryRecord[];
  models: ModelCapability[];
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



function historyModelDisplayName(
  record: ServerHistoryRecord
): string {
  const recordProvider =
    String(record.provider || "")
      .trim()
      .toLowerCase();

  const recordModel =
    String(record.model || "")
      .trim();

  const recordModelLower =
    recordModel.toLowerCase();

  const sameProvider =
    props.models.filter(
      (model) =>
        String(model.provider || "")
          .trim()
          .toLowerCase() ===
        recordProvider
    );

  const exact =
    sameProvider.find(
      (model) =>
        String(model.id || "")
          .trim()
          .toLowerCase() ===
        recordModelLower
    );

  if (exact?.name?.trim()) {
    return exact.name.trim();
  }

  const compatible =
    sameProvider.find(
      (model) => {
        const modelId =
          String(model.id || "")
            .trim()
            .toLowerCase();

        if (
          !modelId ||
          !recordModelLower
        ) {
          return false;
        }

        return (
          modelId.endsWith(
            `-${recordModelLower}`
          ) ||
          recordModelLower.endsWith(
            `-${modelId}`
          )
        );
      }
    );

  if (
    compatible?.name?.trim()
  ) {
    return compatible.name.trim();
  }

  return recordModel;
}

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
            <strong>{{ historyModelDisplayName(record) }}</strong>
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

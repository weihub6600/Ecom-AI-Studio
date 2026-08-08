<script setup lang="ts">
import {
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";
import {
  apiRequest
} from "../api/client";
import type {
  ServerHistoryRecord
} from "../types";
import {
  formatDate
} from "../utils/format";

const records =
  ref<ServerHistoryRecord[]>([]);

const loading =
  ref(true);

const errorMessage =
  ref("");

const previewUrl =
  ref("");

const previewPrompt =
  ref("");

const previewModel =
  ref("");

const previewDate =
  ref("");

onMounted(() => {
  window.addEventListener(
    "keydown",
    handleKeydown
  );
  void loadHistory();
});

onBeforeUnmount(() => {
  window.removeEventListener(
    "keydown",
    handleKeydown
  );
});

async function loadHistory() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<{
        history:
          ServerHistoryRecord[];
      }>(
        "/api/history?limit=20"
      );

    records.value =
      data.history || [];
  }
  catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取生成历史失败";
  }
  finally {
    loading.value = false;
  }
}

async function removeRecord(
  record:
    ServerHistoryRecord
) {
  if (
    !window.confirm(
      "确定删除这条生成历史及服务器原图吗？删除后无法恢复。"
    )
  ) {
    return;
  }

  await apiRequest(
    `/api/history/${encodeURIComponent(record.id)}`,
    {
      method: "DELETE"
    }
  );

  records.value =
    records.value.filter(
      (item) =>
        item.id !== record.id
    );

  if (
    previewUrl.value &&
    record.images.some(
      (image) =>
        image.url === previewUrl.value
    )
  ) {
    closePreview();
  }
}

function displayModel(
  record: ServerHistoryRecord
): string {
  let model =
    String(record.model || "").trim();

  const provider =
    String(record.provider || "").trim();

  if (
    provider &&
    model.toLowerCase().startsWith(
      provider.toLowerCase() + "-"
    )
  ) {
    model =
      model.slice(
        provider.length + 1
      );
  }

  if (
    model.toLowerCase().startsWith(
      "gpt-"
    )
  ) {
    model = model.slice(4);
  }

  return model || "AI 模型";
}

function openPreview(
  record: ServerHistoryRecord,
  url: string
) {
  previewUrl.value = url;
  previewPrompt.value =
    record.prompt || "未填写提示词";
  previewModel.value =
    displayModel(record);
  previewDate.value =
    formatDate(record.createdAt);
}

function closePreview() {
  previewUrl.value = "";
  previewPrompt.value = "";
  previewModel.value = "";
  previewDate.value = "";
}

function handleKeydown(
  event: KeyboardEvent
) {
  if (
    event.key === "Escape" &&
    previewUrl.value
  ) {
    closePreview();
  }
}
</script>

<template>
  <section class="account-history">
    <header class="account-section-heading">
      <div>
        <span>GENERATION HISTORY</span>
        <h2>全部生成历史</h2>
        <p>使用小缩略图快速浏览；点击图片可完整预览，按 ESC 即可关闭。</p>
      </div>
      <button type="button" @click="loadHistory">刷新</button>
    </header>

    <p v-if="errorMessage" class="account-message error">{{ errorMessage }}</p>
    <div v-if="loading" class="account-empty">正在读取生成历史…</div>
    <div v-else-if="records.length === 0" class="account-empty">暂时没有生成历史</div>

    <div v-else class="account-history-grid account-history-grid-v4">
      <article
        v-for="record in records"
        :key="record.id"
        class="account-history-card account-history-card-v4"
      >
        <button
          class="account-history-preview account-history-preview-v4"
          type="button"
          :disabled="!record.images[0]"
          @click="record.images[0] && openPreview(record, record.images[0].url)"
        >
          <img
            v-if="record.images[0]"
            :src="record.images[0].url"
            :alt="record.prompt"
            loading="lazy"
          />
          <span v-else>无图片</span>
          <i v-if="record.images.length > 1">{{ record.images.length }} 张</i>
        </button>

        <div class="account-history-body account-history-body-v4">
          <div class="account-history-meta">
            <strong>{{ displayModel(record) }}</strong>
            <span>{{ formatDate(record.createdAt) }}</span>
          </div>

          <p>{{ record.prompt || "未填写提示词" }}</p>

          <div class="account-history-foot">
            <span>{{ record.size }}</span>
            <span>{{ record.images.length }} 张</span>
            <button type="button" @click="removeRecord(record)">移除</button>
          </div>
        </div>
      </article>
    </div>

    <div
      v-if="previewUrl"
      class="history-preview-overlay"
      @click.self="closePreview"
    >
      <section class="history-preview-dialog">
        <button
          class="history-preview-close"
          type="button"
          aria-label="关闭预览"
          @click="closePreview"
        >
          ×
        </button>

        <div class="history-preview-image">
          <img
            :src="previewUrl"
            :alt="previewPrompt"
          />
        </div>

        <aside>
          <span>GENERATED IMAGE</span>
          <h3>{{ previewModel }}</h3>
          <small>{{ previewDate }}</small>
          <div>
            <b>PROMPT</b>
            <p>{{ previewPrompt }}</p>
          </div>
          <em>按 ESC 关闭预览</em>
        </aside>
      </section>
    </div>
  </section>
</template>

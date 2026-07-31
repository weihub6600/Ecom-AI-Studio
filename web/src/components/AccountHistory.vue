<script setup lang="ts">
import {
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
  formatDate,
  providerDisplayName
} from "../utils/format";

const records =
  ref<ServerHistoryRecord[]>([]);

const loading =
  ref(true);

const errorMessage =
  ref("");

onMounted(loadHistory);

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
}
</script>

<template>
  <section class="account-history">
    <header class="account-section-heading">
      <div>
        <span>GENERATION HISTORY</span>
        <h2>全部生成历史</h2>
        <p>每个账号最多保存 20 张图片，最长保存 7 天；超过限制的旧图片会自动删除。</p>
      </div>
      <button type="button" @click="loadHistory">刷新</button>
    </header>

    <p v-if="errorMessage" class="account-message error">{{ errorMessage }}</p>
    <div v-if="loading" class="account-empty">正在读取生成历史…</div>
    <div v-else-if="records.length === 0" class="account-empty">暂时没有生成历史</div>

    <div v-else class="account-history-grid">
      <article v-for="record in records" :key="record.id" class="account-history-card">
        <a
          class="account-history-preview"
          :href="record.images[0]?.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img v-if="record.images[0]" :src="record.images[0].url" :alt="record.prompt" loading="lazy" />
          <span v-else>无图片</span>
        </a>

        <div class="account-history-body">
          <div class="account-history-meta">
            <strong>{{ providerDisplayName(record.provider, record.providerName) }}</strong>
            <span>{{ formatDate(record.createdAt) }}</span>
          </div>
          <h3>{{ record.model }}</h3>
          <p>{{ record.prompt }}</p>
          <div class="account-history-foot">
            <span>{{ record.size }}</span>
            <span>{{ record.images.length }} 张</span>
            <button type="button" @click="removeRecord(record)">移除记录</button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

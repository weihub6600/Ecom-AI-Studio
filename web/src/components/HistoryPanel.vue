<script setup lang="ts">
import type { ServerHistoryRecord } from "../types";
import { formatDate, formatSizeTitle, providerDisplayName } from "../utils/format";

const props = defineProps<{
  records: ServerHistoryRecord[];
  activeHistoryId: string | null;
  authenticated: boolean;
}>();
const emit = defineEmits<{
  restore: [record: ServerHistoryRecord];
  remove: [record: ServerHistoryRecord];
  clear: [];
}>();
</script>

<template>
  <section class="history-panel panel">
    <div class="history-heading"><div><span class="step-number">03</span><div><h2>生成历史</h2><p>最近 20 条来自 MySQL，可在不同设备登录后继续查看</p></div></div><button v-if="props.records.length" type="button" class="history-clear" @click="emit('clear')">清空列表</button></div>
    <div v-if="props.records.length" class="history-grid">
      <article v-for="record in props.records" :key="record.id" class="history-card" :class="{ active: props.activeHistoryId === record.id }">
        <button type="button" class="history-thumb" @click="emit('restore', record)"><img v-if="record.images[0]" :src="record.images[0].url" :alt="record.prompt" /><span v-if="record.images.length > 1">{{ record.images.length }} 张</span></button>
        <div class="history-copy"><div class="history-meta"><strong>{{ providerDisplayName(record.provider, record.providerName) }} · {{ record.model }}</strong><span>{{ formatDate(record.createdAt) }}</span></div><p>{{ record.prompt }}</p><small>{{ record.operation === 'image-edit' ? '参考图生成' : '文生图' }} · {{ formatSizeTitle(record.size) }}</small></div>
        <div class="history-actions"><button type="button" @click="emit('restore', record)">恢复</button><button type="button" class="danger" @click="emit('remove', record)">从本机移除</button></div>
      </article>
    </div>
    <div v-else class="history-empty">{{ props.authenticated ? '当前账号还没有历史。下一次生成成功后会在本机保留最近 20 条，同时完整归档到 MySQL。' : '登录后可使用 AI 生图，并查看当前账号在本机保存的最近历史。' }}</div>
  </section>
</template>

<script setup lang="ts">
import type {
  AdminSiteMessage,
  Pagination
} from "../../types";

import {
  formatDate
} from "../../utils/format";

import {
  kindLabel,
  readRate,
  targetLabel
} from "./presentation";

const props = defineProps<{
  messages: AdminSiteMessage[];
  pagination: Pagination;
  totalDelivered: number;
  totalRead: number;
  averageReadRate: number;
  expandedMessageId: string;
}>();

const emit = defineEmits<{
  toggle: [messageId: string];
  pageChange: [page: number];
  remove: [message: AdminSiteMessage];
}>();

function toggleMessage(
  item: AdminSiteMessage
) {
  emit(
    "toggle",
    props.expandedMessageId === item.id
      ? ""
      : item.id
  );
}
</script>

<template>
  <section class="delivery-history">
    <header class="workspace-head">
      <div>
        <span>DELIVERY ANALYTICS</span>
        <h3>触达记录</h3>
        <p>
          查看每次发送的对象、送达量和阅读率。
        </p>
      </div>

      <div class="history-metrics">
        <span>
          当前页送达
          <strong>
            {{ props.totalDelivered }}
          </strong>
        </span>

        <span>
          当前页已读
          <strong>
            {{ props.totalRead }}
          </strong>
        </span>

        <span>
          已读率
          <strong>
            {{ props.averageReadRate }}%
          </strong>
        </span>
      </div>
    </header>

    <div
      v-if="props.messages.length"
      class="delivery-list"
    >
      <article
        v-for="item in props.messages"
        :key="item.id"
        :class="{
          expanded:
            props.expandedMessageId ===
            item.id
        }"
      >
        <button
          type="button"
          class="delivery-main"
          @click="toggleMessage(item)"
        >
          <i :class="item.kind">
            {{
              kindLabel(
                item.kind
              )
            }}
          </i>

          <div class="delivery-copy">
            <strong>
              {{ item.title }}
            </strong>

            <small>
              {{ targetLabel(item) }}
              ·
              {{
                formatDate(
                  item.createdAt
                )
              }}
            </small>
          </div>

          <div class="delivery-rate">
            <b>
              {{ readRate(item) }}%
            </b>

            <span>
              {{ item.readCount }}
              /
              {{ item.deliveredCount }}
              已读
            </span>
          </div>

          <span class="delivery-chevron">
            {{
              props.expandedMessageId ===
                item.id
                ? '−'
                : '+'
            }}
          </span>
        </button>

        <div class="delivery-progress">
          <span
            :style="{
              width:
                `${readRate(item)}%`
            }"
          ></span>
        </div>

        <div
          v-if="
            props.expandedMessageId ===
            item.id
          "
          class="delivery-detail"
        >
          <p>
            {{ item.content }}
          </p>

          <div>
            <span>
              送达
              <strong>
                {{ item.deliveredCount }}
              </strong>
            </span>

            <span>
              已读
              <strong>
                {{ item.readCount }}
              </strong>
            </span>

            <button
              type="button"
              @click.stop="
                emit('remove', item)
              "
            >
              删除消息
            </button>
          </div>
        </div>
      </article>
    </div>

    <div
      v-else
      class="ops-empty"
    >
      <span>◇</span>
      <strong>暂无触达记录</strong>

      <p>
        发送第一条站内消息后，这里会开始累计阅读数据。
      </p>
    </div>

    <div class="ops-pagination">
      <button
        type="button"
        :disabled="
          props.pagination.page <= 1
        "
        @click="
          emit(
            'pageChange',
            props.pagination.page - 1
          )
        "
      >
        ← 上一页
      </button>

      <span>
        第 {{ props.pagination.page }}
        /
        {{ props.pagination.totalPages }} 页
      </span>

      <button
        type="button"
        :disabled="
          props.pagination.page >=
          props.pagination.totalPages
        "
        @click="
          emit(
            'pageChange',
            props.pagination.page + 1
          )
        "
      >
        下一页 →
      </button>
    </div>
  </section>
</template>

<style scoped>
.delivery-history {
  padding: 20px;
  border: 1px solid #e1e2ea;
  border-radius: 19px;
  background: #fff;
  box-shadow:
    0 12px 34px rgba(46, 48, 74, .045);
}

.workspace-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.workspace-head > div > span {
  color: #6d5bd5;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .15em;
}

.workspace-head h3 {
  margin: 4px 0 0;
  color: #303347;
  font-size: 18px;
}

.workspace-head p {
  max-width: 650px;
  margin: 5px 0 0;
  color: #8a8d9d;
  font-size: 9px;
  line-height: 1.6;
}

.history-metrics {
  display: flex;
  gap: 7px;
}

.history-metrics > span {
  padding: 7px 9px;
  border: 1px solid #e2e3ea;
  border-radius: 9px;
  background: #fafbfe;
  color: #8b8e9f;
  font-size: 7px;
}

.history-metrics strong {
  margin-left: 4px;
  color: #5746bf;
  font-size: 10px;
}

.delivery-list {
  display: grid;
  gap: 7px;
  margin-top: 14px;
}

.delivery-list > article {
  overflow: hidden;
  border: 1px solid #e3e4eb;
  border-radius: 12px;
  background: #fff;
}

.delivery-main {
  display: grid;
  grid-template-columns:
    78px
    minmax(0, 1fr)
    90px
    24px;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 61px;
  padding: 9px 11px;
  border: 0;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.delivery-main:hover {
  background: #faf9ff;
}

.delivery-main > i {
  justify-self: start;
  padding: 5px 8px;
  border-radius: 999px;
  background: #eef0f5;
  color: #676b7e;
  font-size: 7px;
  font-style: normal;
  font-weight: 850;
}

.delivery-main > i.success {
  background: #e9f8ef;
  color: #2e7751;
}

.delivery-main > i.warning {
  background: #fff4dd;
  color: #a66d13;
}

.delivery-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.delivery-copy strong {
  overflow: hidden;
  color: #3b3e52;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delivery-copy small {
  color: #9699a8;
  font-size: 7px;
}

.delivery-rate {
  display: grid;
  justify-items: end;
}

.delivery-rate b {
  color: #5544bd;
  font-size: 12px;
}

.delivery-rate span {
  margin-top: 2px;
  color: #999cac;
  font-size: 7px;
}

.delivery-chevron {
  color: #8d90a0;
  font-size: 13px;
}

.delivery-progress {
  height: 3px;
  background: #efeff4;
}

.delivery-progress span {
  display: block;
  height: 100%;
  background:
    linear-gradient(
      90deg,
      #6755d4,
      #7897f7
    );
}

.delivery-detail {
  padding: 12px;
  border-top: 1px solid #ececf1;
  background: #fafbfe;
}

.delivery-detail > p {
  margin: 0;
  color: #666a7d;
  font-size: 9px;
  line-height: 1.75;
  white-space: pre-wrap;
}

.delivery-detail > div {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 10px;
}

.delivery-detail > div > span {
  color: #9093a3;
  font-size: 7px;
}

.delivery-detail strong {
  color: #4e5062;
  font-size: 9px;
}

.delivery-detail button {
  margin-left: auto;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid #eccfd2;
  border-radius: 7px;
  background: #fff;
  color: #ab4d58;
  font-size: 7px;
  font-weight: 800;
}

.ops-empty {
  display: grid;
  justify-items: center;
  padding: 40px;
  color: #8e91a1;
  text-align: center;
}

.ops-empty > span {
  color: #6d5bd4;
  font-size: 21px;
}

.ops-empty strong {
  margin-top: 7px;
  color: #55586b;
  font-size: 11px;
}

.ops-empty p {
  margin: 4px 0 0;
  font-size: 8px;
}

.ops-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 13px;
}

.ops-pagination button {
  min-height: 31px;
  padding: 0 10px;
  border: 1px solid #e0e1e9;
  border-radius: 8px;
  background: #fff;
  color: #6253c8;
  font-size: 8px;
  font-weight: 800;
}

.ops-pagination button:disabled {
  opacity: .35;
}

.ops-pagination span {
  color: #8f92a2;
  font-size: 8px;
}

@media (max-width: 820px) {
  .history-metrics {
    display: none;
  }
}
</style>

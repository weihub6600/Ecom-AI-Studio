<script setup lang="ts">
import {
  computed,
  onMounted,
  ref
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";
import type {
  SiteMessage,
  SiteMessageKind
} from "../types";
import {
  formatDate
} from "../utils/format";

type Filter =
  | "all"
  | "unread"
  | SiteMessageKind;

const messages =
  ref<SiteMessage[]>([]);

const total =
  ref(0);

const unread =
  ref(0);

const loading =
  ref(true);

const errorMessage =
  ref("");

const selected =
  ref<SiteMessage | null>(
    null
  );

const filter =
  ref<Filter>("all");

const search =
  ref("");

const filteredMessages =
  computed(() => {
    const keyword =
      search.value
        .trim()
        .toLowerCase();

    return messages.value.filter(
      (item) => {
        const matchesFilter =
          filter.value === "all"
            ? true
            : filter.value ===
                "unread"
              ? !item.read
              : item.kind ===
                filter.value;

        if (!matchesFilter) {
          return false;
        }

        if (!keyword) {
          return true;
        }

        return (
          item.title
            .toLowerCase()
            .includes(keyword) ||
          item.content
            .toLowerCase()
            .includes(keyword)
        );
      }
    );
  });

const unreadMessages =
  computed(() =>
    messages.value.filter(
      (item) =>
        !item.read
    )
  );

const selectedIndex =
  computed(() => {
    if (!selected.value) {
      return -1;
    }

    return filteredMessages.value
      .findIndex(
        (item) =>
          item.id ===
          selected.value?.id
      );
  });

onMounted(loadMessages);

async function loadMessages() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<{
        messages:
          SiteMessage[];
        summary: {
          total: number;
          unread: number;
        };
      }>(
        "/api/account/messages?limit=100"
      );

    messages.value =
      data.messages || [];

    total.value =
      data.summary?.total || 0;

    unread.value =
      data.summary?.unread || 0;

    if (
      selected.value
    ) {
      selected.value =
        messages.value.find(
          (item) =>
            item.id ===
            selected.value?.id
        ) || null;
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取消息中心失败";
  } finally {
    loading.value = false;
  }
}

async function openMessage(
  item:
    SiteMessage
) {
  selected.value = item;

  if (item.read) {
    return;
  }

  try {
    const data =
      await apiRequest<{
        message:
          SiteMessage;
      }>(
        `/api/account/messages/${encodeURIComponent(item.id)}/read`,
        jsonRequest(
          {},
          "PATCH"
        )
      );

    replaceMessage(
      data.message
    );

    unread.value =
      Math.max(
        0,
        unread.value - 1
      );

    selected.value =
      data.message;
  } catch {
    // 阅读本身不应该因为回执失败而被阻塞。
  }
}

async function markAllRead() {
  if (
    unread.value < 1
  ) {
    return;
  }

  try {
    await apiRequest(
      "/api/account/messages/read-all",
      jsonRequest({})
    );

    const now =
      new Date()
        .toISOString();

    messages.value =
      messages.value.map(
        (item) => ({
          ...item,
          read: true,
          readAt:
            item.readAt ||
            now
        })
      );

    if (selected.value) {
      selected.value = {
        ...selected.value,
        read: true,
        readAt:
          selected.value
            .readAt ||
          now
      };
    }

    unread.value = 0;
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "全部标记已读失败";
  }
}

async function openNextUnread() {
  const next =
    unreadMessages.value.find(
      (item) =>
        item.id !==
        selected.value?.id
    );

  if (next) {
    await openMessage(next);
  }
}

async function moveSelection(
  direction: -1 | 1
) {
  if (
    filteredMessages.value
      .length < 1
  ) {
    return;
  }

  const current =
    selectedIndex.value;

  let nextIndex =
    current < 0
      ? 0
      : current + direction;

  nextIndex =
    Math.min(
      filteredMessages.value
        .length - 1,
      Math.max(
        0,
        nextIndex
      )
    );

  const next =
    filteredMessages.value[
      nextIndex
    ];

  if (next) {
    await openMessage(next);
  }
}

function replaceMessage(
  next:
    SiteMessage
) {
  const index =
    messages.value
      .findIndex(
        (item) =>
          item.id === next.id
      );

  if (index >= 0) {
    messages.value[index] =
      next;
  }
}

function kindLabel(
  kind:
    SiteMessage["kind"]
) {
  if (
    kind === "success"
  ) {
    return "好消息";
  }

  if (
    kind === "warning"
  ) {
    return "重要提醒";
  }

  return "站内通知";
}

function iconFor(
  kind:
    SiteMessage["kind"]
) {
  if (
    kind === "warning"
  ) {
    return "!";
  }

  if (
    kind === "success"
  ) {
    return "✓";
  }

  return "i";
}
</script>

<template>
  <div class="message-center-v2">
    <header class="message-hero-v2">
      <div class="message-hero-copy">
        <div class="message-kicker">
          <span></span>
          MESSAGE CENTER
          <b v-if="unread > 0">
            {{ unread }} NEW
          </b>
        </div>

        <h2>消息中心</h2>

        <p>
          重要提醒、功能更新和运营通知都集中在这里。
          新消息会同时在创作工作台显示红点和浮层提醒。
        </p>
      </div>

      <div class="message-hero-actions">
        <article>
          <span>全部消息</span>
          <strong>{{ total }}</strong>
          <small>历史收件箱</small>
        </article>

        <article
          class="unread"
          :class="{
            active: unread > 0
          }"
        >
          <span>未读消息</span>
          <strong>{{ unread }}</strong>
          <small>
            {{
              unread > 0
                ? '需要处理'
                : '全部已读'
            }}
          </small>
        </article>

        <button
          type="button"
          :disabled="unread < 1"
          @click="markAllRead"
        >
          <span>✓</span>
          全部标为已读
        </button>
      </div>
    </header>

    <div
      v-if="errorMessage"
      class="message-error-v2"
    >
      {{ errorMessage }}
    </div>

    <div
      v-if="loading"
      class="message-loading-v2"
    >
      <span></span>
      正在同步消息…
    </div>

    <div
      v-else-if="
        messages.length === 0
      "
      class="message-empty-v2"
    >
      <span>◇</span>
      <strong>收件箱还是空的</strong>
      <p>
        站长发送的新消息会第一时间出现在这里。
      </p>
    </div>

    <div
      v-else
      class="message-workspace-v2"
    >
      <section class="message-inbox-v2">
        <header class="inbox-toolbar-v2">
          <div class="message-search-v2">
            <span>⌕</span>
            <input
              v-model="search"
              type="search"
              placeholder="搜索标题或消息内容"
            />
          </div>

          <button
            type="button"
            @click="loadMessages"
          >
            ↻
          </button>
        </header>

        <nav class="message-filters-v2">
          <button
            type="button"
            :class="{
              active:
                filter === 'all'
            }"
            @click="
              filter = 'all'
            "
          >
            全部
            <b>{{ total }}</b>
          </button>

          <button
            type="button"
            :class="{
              active:
                filter === 'unread'
            }"
            @click="
              filter = 'unread'
            "
          >
            未读
            <b>{{ unread }}</b>
          </button>

          <button
            type="button"
            :class="{
              active:
                filter === 'warning'
            }"
            @click="
              filter = 'warning'
            "
          >
            提醒
          </button>

          <button
            type="button"
            :class="{
              active:
                filter === 'success'
            }"
            @click="
              filter = 'success'
            "
          >
            好消息
          </button>
        </nav>

        <div class="message-list-v2">
          <button
            v-for="item in filteredMessages"
            :key="item.id"
            type="button"
            :class="{
              unread:
                !item.read,
              active:
                selected?.id ===
                item.id
            }"
            @click="
              openMessage(item)
            "
          >
            <span
              class="message-kind-icon"
              :class="item.kind"
            >
              {{
                iconFor(
                  item.kind
                )
              }}
            </span>

            <div class="message-row-copy">
              <div>
                <strong>
                  {{ item.title }}
                </strong>

                <span
                  v-if="!item.read"
                  class="new-pill"
                >
                  NEW
                </span>
              </div>

              <p>
                {{ item.content }}
              </p>

              <footer>
                <i
                  :class="item.kind"
                >
                  {{
                    kindLabel(
                      item.kind
                    )
                  }}
                </i>

                <time>
                  {{
                    formatDate(
                      item.createdAt
                    )
                  }}
                </time>
              </footer>
            </div>

            <span class="row-arrow">
              ›
            </span>
          </button>

          <div
            v-if="
              filteredMessages.length ===
              0
            "
            class="filter-empty-v2"
          >
            当前筛选条件下没有消息
          </div>
        </div>
      </section>

      <aside
        v-if="selected"
        class="message-reader-v2"
      >
        <header class="reader-top-v2">
          <div>
            <i
              :class="
                selected.kind
              "
            >
              {{
                kindLabel(
                  selected.kind
                )
              }}
            </i>

            <span>
              {{
                selected.read
                  ? '已读'
                  : '未读'
              }}
            </span>
          </div>

          <time>
            {{
              formatDate(
                selected.createdAt
              )
            }}
          </time>
        </header>

        <div class="reader-title-v2">
          <span>ZHE AI MESSAGE</span>

          <h3>
            {{ selected.title }}
          </h3>

          <p>
            {{
              selected.kind ===
                'warning'
                ? '这是一条重要提醒，请留意消息内容。'
                : selected.kind ===
                    'success'
                  ? '这里有一条新的好消息。'
                  : '来自 ZHE AI 的站内通知。'
            }}
          </p>
        </div>

        <div class="reader-body-v2">
          {{ selected.content }}
        </div>

        <footer class="reader-actions-v2">
          <div>
            <span
              v-if="
                selected.readAt
              "
            >
              阅读时间
              {{
                formatDate(
                  selected.readAt
                )
              }}
            </span>
          </div>

          <div>
            <button
              type="button"
              :disabled="
                selectedIndex <= 0
              "
              @click="
                moveSelection(-1)
              "
            >
              ← 上一条
            </button>

            <button
              type="button"
              :disabled="
                selectedIndex < 0 ||
                selectedIndex >=
                  filteredMessages.length -
                  1
              "
              @click="
                moveSelection(1)
              "
            >
              下一条 →
            </button>
          </div>
        </footer>

        <button
          v-if="
            unreadMessages.length > 0
          "
          type="button"
          class="next-unread-v2"
          @click="
            openNextUnread
          "
        >
          继续处理下一条未读
          <span>
            {{ unreadMessages.length }}
            条待处理
          </span>
        </button>
      </aside>

      <aside
        v-else
        class="message-reader-v2 empty"
      >
        <div class="reader-empty-icon">
          <span></span>
          <i></i>
        </div>

        <strong>
          选择一条消息开始阅读
        </strong>

        <p>
          未读消息打开后会自动标记为已读，
          阅读状态会同步回站长后台。
        </p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.message-center-v2{display:grid;gap:15px}.message-hero-v2{position:relative;overflow:hidden;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:27px 29px;border:1px solid #ddd9f4;border-radius:21px;background:linear-gradient(125deg,#fff 0%,#f8f7ff 58%,#eff0ff 100%);box-shadow:0 16px 42px rgba(55,49,94,.06)}.message-hero-v2:after{content:"";position:absolute;right:-70px;top:-100px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(103,84,212,.16),rgba(103,84,212,0) 68%);pointer-events:none}.message-hero-copy{position:relative;z-index:1;max-width:680px}.message-kicker{display:flex;align-items:center;gap:8px;color:#6b59d4;font-size:9px;font-weight:900;letter-spacing:.15em}.message-kicker>span{width:7px;height:7px;border-radius:50%;background:#6a58d6;box-shadow:0 0 0 5px rgba(106,88,214,.11)}.message-kicker b{padding:4px 7px;border-radius:999px;background:#ffeff1;color:#b64d59;font-size:7px;letter-spacing:.04em}.message-hero-v2 h2{margin:9px 0 7px;color:#292c40;font-size:27px;letter-spacing:-.035em}.message-hero-v2 p{margin:0;color:#74788a;font-size:11px;line-height:1.8}.message-hero-actions{position:relative;z-index:1;display:flex;gap:8px}.message-hero-actions article{min-width:105px;padding:12px 13px;border:1px solid #e0e1ea;border-radius:13px;background:rgba(255,255,255,.9)}.message-hero-actions article.active{border-color:#e7bec4;background:#fff5f6}.message-hero-actions article>span{display:block;color:#8d90a1;font-size:7px}.message-hero-actions article>strong{display:block;margin-top:4px;color:#414457;font-size:21px}.message-hero-actions article.unread.active>strong{color:#b44a57}.message-hero-actions article>small{display:block;margin-top:3px;color:#a0a3b1;font-size:7px}.message-hero-actions>button{min-width:118px;border:0;border-radius:13px;background:#6553d0;color:#fff;font-size:8px;font-weight:900;cursor:pointer;box-shadow:0 9px 22px rgba(92,74,198,.2)}.message-hero-actions>button span{display:block;margin-bottom:3px;font-size:14px}.message-hero-actions>button:disabled{background:#eaebf0;color:#aaaebb;box-shadow:none}.message-error-v2{padding:11px 13px;border:1px solid #f0cbce;border-radius:10px;background:#fff2f3;color:#a94b56;font-size:9px}.message-loading-v2,.message-empty-v2{display:grid;justify-items:center;align-content:center;min-height:360px;border:1px dashed #d9dbe6;border-radius:17px;background:#fff;color:#858899;text-align:center}.message-loading-v2{display:flex;align-items:center;justify-content:center;gap:10px;font-size:9px}.message-loading-v2>span{width:18px;height:18px;border:2px solid #dedaf5;border-top-color:#6654d4;border-radius:50%;animation:msg-spin .8s linear infinite}@keyframes msg-spin{to{transform:rotate(360deg)}}.message-empty-v2>span{color:#6c5ad2;font-size:26px}.message-empty-v2 strong{margin-top:8px;color:#55586b;font-size:12px}.message-empty-v2 p{margin:4px 0 0;color:#9699a9;font-size:8px}.message-workspace-v2{display:grid;grid-template-columns:minmax(310px,.72fr) minmax(480px,1.28fr);gap:12px;align-items:start}.message-inbox-v2,.message-reader-v2{border:1px solid #e1e2ea;border-radius:18px;background:#fff;box-shadow:0 12px 34px rgba(46,48,74,.045)}.message-inbox-v2{overflow:hidden}.inbox-toolbar-v2{display:grid;grid-template-columns:minmax(0,1fr) 36px;gap:7px;padding:12px;border-bottom:1px solid #ececf1}.message-search-v2{position:relative}.message-search-v2>span{position:absolute;left:11px;top:9px;color:#8e91a1;font-size:13px}.message-search-v2 input{width:100%;height:36px;padding:0 10px 0 32px;border:1px solid #e0e1e9;border-radius:9px;background:#fafbfe;color:#3d4053;font:inherit;font-size:9px;outline:none}.message-search-v2 input:focus{border-color:#8374df;box-shadow:0 0 0 3px rgba(112,94,210,.08)}.inbox-toolbar-v2>button{border:1px solid #e0e1e9;border-radius:9px;background:#fff;color:#6655d4;font-size:14px}.message-filters-v2{display:flex;gap:5px;padding:9px 12px;border-bottom:1px solid #ececf1;overflow:auto}.message-filters-v2 button{display:flex;align-items:center;gap:5px;min-height:28px;padding:0 8px;border:1px solid transparent;border-radius:999px;background:#f3f4f8;color:#777a8d;font-size:7px;font-weight:800;white-space:nowrap}.message-filters-v2 button b{display:grid;place-items:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#fff;color:#676a7c;font-size:7px}.message-filters-v2 button.active{border-color:#c8c0ef;background:#eeebff;color:#5c4bc4}.message-list-v2{max-height:600px;overflow:auto;padding:7px}.message-list-v2>button{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr) 18px;align-items:start;gap:9px;width:100%;min-height:92px;padding:11px;border:1px solid transparent;border-radius:12px;background:#fff;color:inherit;text-align:left;cursor:pointer;transition:.15s ease}.message-list-v2>button:hover{background:#faf9ff}.message-list-v2>button.active{border-color:#c8c0ee;background:#f6f4ff}.message-list-v2>button.unread{background:#fbfaff}.message-list-v2>button.unread:before{content:"";position:absolute;left:0;top:17px;bottom:17px;width:3px;border-radius:999px;background:#6a58d6}.message-kind-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#eef0f5;color:#696c7f;font-size:10px;font-weight:900}.message-kind-icon.success{background:#e9f8ef;color:#2d7650}.message-kind-icon.warning{background:#fff1e5;color:#a96522}.message-row-copy{display:grid;gap:5px;min-width:0}.message-row-copy>div{display:flex;align-items:center;gap:6px}.message-row-copy strong{overflow:hidden;color:#383b50;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.new-pill{padding:3px 5px;border-radius:999px;background:#ffedf0;color:#b84e5a;font-size:6px;font-weight:900}.message-row-copy p{display:-webkit-box;overflow:hidden;margin:0;color:#808496;font-size:8px;line-height:1.55;-webkit-box-orient:vertical;-webkit-line-clamp:2}.message-row-copy footer{display:flex;align-items:center;justify-content:space-between;gap:8px}.message-row-copy footer i{padding:3px 6px;border-radius:999px;background:#f1f2f6;color:#7c7f91;font-size:6px;font-style:normal;font-weight:800}.message-row-copy footer i.success{background:#edf8f1;color:#347555}.message-row-copy footer i.warning{background:#fff4e8;color:#9c652b}.message-row-copy time{color:#a1a4b2;font-size:7px}.row-arrow{align-self:center;color:#a2a5b2;font-size:18px}.filter-empty-v2{padding:36px 10px;color:#9497a7;text-align:center;font-size:8px}.message-reader-v2{position:sticky;top:14px;min-height:520px;padding:22px}.reader-top-v2{display:flex;align-items:center;justify-content:space-between;gap:10px}.reader-top-v2>div{display:flex;align-items:center;gap:7px}.reader-top-v2 i{padding:5px 8px;border-radius:999px;background:#eef0f5;color:#676b7e;font-size:7px;font-style:normal;font-weight:850}.reader-top-v2 i.success{background:#e9f8ef;color:#2d7650}.reader-top-v2 i.warning{background:#fff1e5;color:#a96522}.reader-top-v2 span{color:#8f92a2;font-size:7px}.reader-top-v2 time{color:#989baa;font-size:7px}.reader-title-v2{padding:25px 0 18px}.reader-title-v2>span{color:#6b59d4;font-size:7px;font-weight:900;letter-spacing:.15em}.reader-title-v2 h3{margin:8px 0 7px;color:#2f3246;font-size:22px;letter-spacing:-.03em}.reader-title-v2 p{margin:0;color:#8c8f9f;font-size:8px}.reader-body-v2{min-height:220px;padding:18px;border:1px solid #e4e1f6;border-radius:14px;background:linear-gradient(145deg,#fbfaff,#f6f7ff);color:#5e6275;font-size:11px;line-height:1.9;white-space:pre-wrap}.reader-actions-v2{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:13px}.reader-actions-v2>div:first-child span{color:#9295a5;font-size:7px}.reader-actions-v2>div:last-child{display:flex;gap:6px}.reader-actions-v2 button{min-height:31px;padding:0 9px;border:1px solid #e0e1e9;border-radius:8px;background:#fff;color:#6656c8;font-size:7px;font-weight:800}.reader-actions-v2 button:disabled{opacity:.35}.next-unread-v2{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:41px;margin-top:12px;padding:0 12px;border:0;border-radius:10px;background:#37394e;color:#fff;font-size:8px;font-weight:850}.next-unread-v2 span{color:#c9cbe0;font-size:7px}.message-reader-v2.empty{display:grid;justify-items:center;align-content:center;text-align:center}.reader-empty-icon{position:relative;width:62px;height:54px}.reader-empty-icon>span{position:absolute;left:7px;right:7px;top:8px;height:35px;border:2px solid #cfc9f0;border-radius:12px;background:#f7f5ff}.reader-empty-icon>i{position:absolute;left:25px;bottom:0;width:13px;height:13px;border-radius:50%;background:#6856d5;box-shadow:0 0 0 6px rgba(104,86,213,.1)}.message-reader-v2.empty>strong{margin-top:10px;color:#54576a;font-size:12px}.message-reader-v2.empty>p{max-width:330px;margin:6px 0 0;color:#979aaa;font-size:8px;line-height:1.7}@media(max-width:1050px){.message-hero-v2{align-items:flex-start;flex-direction:column}.message-hero-actions{width:100%}.message-hero-actions article,.message-hero-actions>button{flex:1}.message-workspace-v2{grid-template-columns:1fr}.message-reader-v2{position:static}}@media(max-width:700px){.message-hero-actions{display:grid;grid-template-columns:1fr 1fr}.message-hero-actions>button{grid-column:1/-1;min-height:44px}}
</style>

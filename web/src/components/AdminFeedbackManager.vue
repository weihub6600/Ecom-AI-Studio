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
import {
  formatDate
} from "../utils/format";

type FeedbackStatus =
  | "open"
  | "processing"
  | "replied"
  | "closed";

type FeedbackType =
  | "suggestion"
  | "bug"
  | "question"
  | "other";

interface FeedbackSummary {
  id: string;
  userId: string;
  username: string;
  nickname?: string;
  type: FeedbackType;
  title: string;
  content: string;
  status: FeedbackStatus;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  lastRepliedAt?: string;
}

interface FeedbackReply {
  id: string;
  authorRole:
    | "user"
    | "admin";
  authorName: string;
  content: string;
  createdAt: string;
}

interface FeedbackDetail
  extends FeedbackSummary {
  replies: FeedbackReply[];
}

const loading =
  ref(true);

const detailLoading =
  ref(false);

const saving =
  ref(false);

const search =
  ref("");

const status =
  ref("");

const records =
  ref<FeedbackSummary[]>([]);

const selected =
  ref<FeedbackDetail | null>(
    null
  );

const replyDraft =
  ref("");

const errorMessage =
  ref("");

const successMessage =
  ref("");

const openCount =
  computed(() =>
    records.value.filter(
      (item) =>
        item.status === "open"
    ).length
  );

const processingCount =
  computed(() =>
    records.value.filter(
      (item) =>
        item.status ===
          "processing"
    ).length
  );

onMounted(loadFeedback);

async function loadFeedback() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const params =
      new URLSearchParams({
        limit: "300"
      });

    if (status.value) {
      params.set(
        "status",
        status.value
      );
    }

    if (search.value.trim()) {
      params.set(
        "search",
        search.value.trim()
      );
    }

    const data =
      await apiRequest<{
        feedback:
          FeedbackSummary[];
      }>(
        `/api/admin/feedback?${params.toString()}`
      );

    records.value =
      data.feedback || [];

    if (
      selected.value &&
      !records.value.some(
        (item) =>
          item.id ===
          selected.value?.id
      )
    ) {
      selected.value = null;
    }
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "读取用户反馈失败"
      );
  }
  finally {
    loading.value = false;
  }
}

async function openFeedback(
  id: string
) {
  detailLoading.value =
    true;
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<{
        feedback:
          FeedbackDetail;
      }>(
        `/api/admin/feedback/${encodeURIComponent(id)}`
      );

    selected.value =
      data.feedback;
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "读取反馈详情失败"
      );
  }
  finally {
    detailLoading.value =
      false;
  }
}

async function replyFeedback() {
  if (
    !selected.value ||
    !replyDraft.value.trim()
  ) {
    return;
  }

  saving.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const data =
      await apiRequest<{
        feedback:
          FeedbackDetail;
      }>(
        `/api/admin/feedback/${encodeURIComponent(selected.value.id)}/replies`,
        jsonRequest({
          content:
            replyDraft.value.trim()
        })
      );

    selected.value =
      data.feedback;

    replyDraft.value = "";

    successMessage.value =
      "回复已发送给用户";

    await loadFeedback();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "回复反馈失败"
      );
  }
  finally {
    saving.value = false;
  }
}

async function updateStatus(
  nextStatus:
    FeedbackStatus
) {
  if (
    !selected.value ||
    selected.value.status ===
      nextStatus
  ) {
    return;
  }

  saving.value = true;
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<{
        feedback:
          FeedbackDetail;
      }>(
        `/api/admin/feedback/${encodeURIComponent(selected.value.id)}`,
        jsonRequest({
          status:
            nextStatus
        }, "PATCH")
      );

    selected.value =
      data.feedback;

    successMessage.value =
      `反馈状态已更新为${statusLabel(nextStatus)}`;

    await loadFeedback();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "更新反馈状态失败"
      );
  }
  finally {
    saving.value = false;
  }
}

function statusLabel(
  value: FeedbackStatus
): string {
  if (
    value === "processing"
  ) {
    return "处理中";
  }

  if (
    value === "replied"
  ) {
    return "已回复";
  }

  if (
    value === "closed"
  ) {
    return "已关闭";
  }

  return "待处理";
}

function typeLabel(
  value: FeedbackType
): string {
  if (value === "bug") {
    return "问题反馈";
  }

  if (
    value === "question"
  ) {
    return "使用咨询";
  }

  if (value === "other") {
    return "其他";
  }

  return "功能建议";
}

function messageOf(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error
    ? error.message
    : fallback;
}
</script>

<template>
  <div class="admin-feedback">
    <section class="admin-feedback-hero">
      <div>
        <span>FEEDBACK OPERATIONS</span>
        <h2>用户反馈</h2>
        <p>
          集中查看用户建议、问题与咨询，回复会实时同步到用户后台。
        </p>
      </div>

      <div class="admin-feedback-metrics">
        <article>
          <span>待处理</span>
          <strong>
            {{ openCount }}
          </strong>
        </article>
        <article>
          <span>处理中</span>
          <strong>
            {{ processingCount }}
          </strong>
        </article>
        <article>
          <span>当前列表</span>
          <strong>
            {{ records.length }}
          </strong>
        </article>
      </div>
    </section>

    <p
      v-if="successMessage"
      class="admin-feedback-message success"
    >
      {{ successMessage }}
    </p>

    <p
      v-if="errorMessage"
      class="admin-feedback-message error"
    >
      {{ errorMessage }}
    </p>

    <section class="admin-feedback-toolbar">
      <input
        v-model="search"
        type="search"
        placeholder="搜索用户名、昵称、标题或反馈内容"
        @keyup.enter="loadFeedback"
      />

      <select
        v-model="status"
        @change="loadFeedback"
      >
        <option value="">
          全部状态
        </option>
        <option value="open">
          待处理
        </option>
        <option value="processing">
          处理中
        </option>
        <option value="replied">
          已回复
        </option>
        <option value="closed">
          已关闭
        </option>
      </select>

      <button
        type="button"
        @click="loadFeedback"
      >
        查询
      </button>
    </section>

    <section class="admin-feedback-workspace">
      <aside class="admin-feedback-list">
        <div
          v-if="loading"
          class="admin-feedback-empty"
        >
          正在读取用户反馈…
        </div>

        <div
          v-else-if="
            records.length === 0
          "
          class="admin-feedback-empty"
        >
          没有匹配的反馈
        </div>

        <button
          v-for="item in records"
          v-else
          :key="item.id"
          type="button"
          :class="{
            active:
              selected?.id ===
              item.id
          }"
          @click="
            openFeedback(
              item.id
            )
          "
        >
          <div>
            <span>
              {{
                item.nickname ||
                item.username
              }}
            </span>
            <i
              :class="
                item.status
              "
            >
              {{
                statusLabel(
                  item.status
                )
              }}
            </i>
          </div>

          <strong>
            {{ item.title }}
          </strong>

          <p>
            {{ item.content }}
          </p>

          <small>
            {{
              typeLabel(
                item.type
              )
            }}
            ·
            {{
              formatDate(
                item.updatedAt
              )
            }}
            ·
            {{ item.replyCount }}
            条回复
          </small>
        </button>
      </aside>

      <section class="admin-feedback-detail">
        <div
          v-if="detailLoading"
          class="admin-feedback-empty tall"
        >
          正在读取反馈详情…
        </div>

        <div
          v-else-if="!selected"
          class="admin-feedback-empty tall"
        >
          从左侧选择一条反馈开始处理
        </div>

        <template v-else>
          <header>
            <div>
              <span>
                {{
                  typeLabel(
                    selected.type
                  )
                }}
              </span>

              <h3>
                {{ selected.title }}
              </h3>

              <small>
                用户：
                {{
                  selected.nickname ||
                  selected.username
                }}
                · @{{ selected.username }}
                ·
                {{
                  formatDate(
                    selected.createdAt
                  )
                }}
              </small>
            </div>

            <i
              :class="
                selected.status
              "
            >
              {{
                statusLabel(
                  selected.status
                )
              }}
            </i>
          </header>

          <article class="admin-feedback-origin">
            <strong>用户原始反馈</strong>
            <p>
              {{ selected.content }}
            </p>
          </article>

          <div class="admin-feedback-thread">
            <article
              v-for="reply in selected.replies"
              :key="reply.id"
              :class="reply.authorRole"
            >
              <div>
                <strong>
                  {{
                    reply.authorRole ===
                      "admin"
                      ? "站长回复"
                      : "用户补充"
                  }}
                </strong>
                <span>
                  {{
                    reply.authorName
                  }}
                  ·
                  {{
                    formatDate(
                      reply.createdAt
                    )
                  }}
                </span>
              </div>

              <p>
                {{ reply.content }}
              </p>
            </article>

            <div
              v-if="
                selected.replies
                  .length === 0
              "
              class="admin-feedback-thread-empty"
            >
              暂无往来回复
            </div>
          </div>

          <section class="admin-feedback-actions">
            <div>
              <button
                type="button"
                :disabled="saving"
                :class="{
                  active:
                    selected.status ===
                    'processing'
                }"
                @click="
                  updateStatus(
                    'processing'
                  )
                "
              >
                标记处理中
              </button>

              <button
                type="button"
                :disabled="saving"
                :class="{
                  active:
                    selected.status ===
                    'closed'
                }"
                @click="
                  updateStatus(
                    'closed'
                  )
                "
              >
                关闭反馈
              </button>
            </div>

            <textarea
              v-model="replyDraft"
              maxlength="3000"
              placeholder="输入给用户的回复。发送后状态自动变为“已回复”。"
            ></textarea>

            <footer>
              <span>
                {{ replyDraft.length }}/3000
              </span>

              <button
                type="button"
                class="primary"
                :disabled="
                  saving ||
                  !replyDraft.trim()
                "
                @click="replyFeedback"
              >
                {{
                  saving
                    ? "正在处理…"
                    : "回复用户"
                }}
              </button>
            </footer>
          </section>
        </template>
      </section>
    </section>
  </div>
</template>

<style scoped>
.admin-feedback{
  display:grid;
  gap:12px;
}
.admin-feedback-hero{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:20px;
  padding:18px 20px;
  border:1px solid #e1e2eb;
  border-radius:16px;
  background:
    radial-gradient(circle at 90% 10%,rgba(106,84,209,.12),transparent 34%),
    #fff;
}
.admin-feedback-hero>div:first-child>span{
  color:#6b57d4;
  font-size:9px;
  font-weight:900;
  letter-spacing:.16em;
}
.admin-feedback-hero h2{
  margin:5px 0 3px;
  font-size:21px;
}
.admin-feedback-hero p{
  margin:0;
  color:#888c9a;
  font-size:10px;
}
.admin-feedback-metrics{
  display:flex;
  gap:8px;
}
.admin-feedback-metrics article{
  display:grid;
  min-width:74px;
  padding:8px 10px;
  border:1px solid #e3e1ef;
  border-radius:11px;
  background:#faf9fe;
}
.admin-feedback-metrics span{
  color:#9699a6;
  font-size:8.5px;
}
.admin-feedback-metrics strong{
  color:#5f4fc0;
  font-size:18px;
}
.admin-feedback-message{
  margin:0;
  padding:9px 11px;
  border-radius:9px;
  font-size:10px;
}
.admin-feedback-message.success{
  background:#eaf8f0;
  color:#28734e;
}
.admin-feedback-message.error{
  background:#fff0f0;
  color:#9a3e48;
}
.admin-feedback-toolbar{
  display:grid;
  grid-template-columns:minmax(0,1fr) 150px auto;
  gap:8px;
  padding:9px;
  border:1px solid #e1e2ea;
  border-radius:12px;
  background:#fff;
}
.admin-feedback-toolbar input,
.admin-feedback-toolbar select{
  min-height:36px;
  padding:0 10px;
  border:1px solid #dcdee7;
  border-radius:8px;
  background:#fff;
  color:#4b4f5e;
  font:inherit;
  outline:none;
}
.admin-feedback-toolbar button{
  padding:0 14px;
  border:0;
  border-radius:8px;
  background:#6553cf;
  color:#fff;
  font-weight:800;
}
.admin-feedback-workspace{
  display:grid;
  grid-template-columns:340px minmax(0,1fr);
  gap:12px;
  min-height:560px;
}
.admin-feedback-list,
.admin-feedback-detail{
  overflow:hidden;
  border:1px solid #e0e2ea;
  border-radius:14px;
  background:#fff;
}
.admin-feedback-list>button{
  display:grid;
  width:100%;
  gap:5px;
  padding:12px 13px;
  border:0;
  border-top:1px solid #eef0f4;
  background:#fff;
  color:#484c5b;
  text-align:left;
  cursor:pointer;
}
.admin-feedback-list>button:first-of-type{
  border-top:0;
}
.admin-feedback-list>button:hover,
.admin-feedback-list>button.active{
  background:#f7f5ff;
}
.admin-feedback-list>button>div{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
}
.admin-feedback-list>button>div span{
  color:#74798a;
  font-size:9px;
}
.admin-feedback-list i,
.admin-feedback-detail>header>i{
  padding:3px 6px;
  border-radius:999px;
  background:#f0f0f4;
  color:#737789;
  font-size:8px;
  font-style:normal;
}
.admin-feedback-list i.open,
.admin-feedback-detail>header>i.open{
  background:#f0edff;
  color:#5d4bb9;
}
.admin-feedback-list i.processing,
.admin-feedback-detail>header>i.processing{
  background:#fff4dc;
  color:#946516;
}
.admin-feedback-list i.replied,
.admin-feedback-detail>header>i.replied{
  background:#e9f8f0;
  color:#28734e;
}
.admin-feedback-list strong{
  font-size:11px;
}
.admin-feedback-list p{
  display:-webkit-box;
  overflow:hidden;
  margin:0;
  color:#848897;
  font-size:9px;
  line-height:1.45;
  -webkit-box-orient:vertical;
  -webkit-line-clamp:2;
}
.admin-feedback-list small{
  color:#a0a3ae;
  font-size:8px;
}
.admin-feedback-detail{
  padding:15px;
}
.admin-feedback-detail>header{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:15px;
  padding-bottom:12px;
  border-bottom:1px solid #eceef3;
}
.admin-feedback-detail>header span{
  color:#6b57d4;
  font-size:9px;
  font-weight:800;
}
.admin-feedback-detail h3{
  margin:4px 0;
  font-size:18px;
}
.admin-feedback-detail>header small{
  color:#999daa;
  font-size:9px;
}
.admin-feedback-origin{
  margin-top:11px;
  padding:11px 12px;
  border-radius:10px;
  background:#f7f7fa;
}
.admin-feedback-origin strong{
  font-size:10px;
}
.admin-feedback-origin p,
.admin-feedback-thread p{
  margin:5px 0 0;
  color:#5f6372;
  font-size:10px;
  line-height:1.65;
  white-space:pre-wrap;
}
.admin-feedback-thread{
  display:grid;
  gap:7px;
  margin-top:9px;
}
.admin-feedback-thread article{
  padding:10px 11px;
  border:1px solid #e6e7ed;
  border-radius:9px;
}
.admin-feedback-thread article.admin{
  border-color:#ddd7f6;
  background:#faf8ff;
}
.admin-feedback-thread article>div{
  display:flex;
  justify-content:space-between;
  gap:10px;
}
.admin-feedback-thread article strong{
  color:#5f4cc1;
  font-size:10px;
}
.admin-feedback-thread article span{
  color:#a0a3ae;
  font-size:8.5px;
}
.admin-feedback-thread-empty,
.admin-feedback-empty{
  padding:30px 12px;
  color:#9b9eaa;
  font-size:10px;
  text-align:center;
}
.admin-feedback-empty.tall{
  min-height:420px;
  display:grid;
  place-items:center;
}
.admin-feedback-actions{
  display:grid;
  gap:8px;
  margin-top:12px;
  padding-top:12px;
  border-top:1px solid #eceef3;
}
.admin-feedback-actions>div{
  display:flex;
  gap:6px;
}
.admin-feedback-actions button{
  min-height:32px;
  padding:0 10px;
  border:1px solid #dedfe8;
  border-radius:8px;
  background:#fff;
  color:#6f7383;
  font:inherit;
  font-size:9.5px;
  font-weight:750;
}
.admin-feedback-actions button.active{
  border-color:#cfc7f2;
  background:#f3f0ff;
  color:#5b49ba;
}
.admin-feedback-actions textarea{
  min-height:90px;
  padding:9px 10px;
  border:1px solid #dcdee7;
  border-radius:9px;
  color:#454958;
  font:inherit;
  resize:vertical;
  outline:none;
}
.admin-feedback-actions footer{
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.admin-feedback-actions footer span{
  color:#a0a3ae;
  font-size:8.5px;
}
.admin-feedback-actions button.primary{
  border:0;
  background:#6553cf;
  color:#fff;
}
.admin-feedback-actions button:disabled{
  cursor:not-allowed;
  opacity:.5;
}
@media(max-width:1050px){
  .admin-feedback-workspace{
    grid-template-columns:1fr;
  }
}
@media(max-width:700px){
  .admin-feedback-hero{
    display:grid;
  }
  .admin-feedback-toolbar{
    grid-template-columns:1fr;
  }
}
</style>

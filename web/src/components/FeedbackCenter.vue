<script setup lang="ts">
import { platformConfirm } from "../services/platform-feedback";
import {
  computed,
  onMounted,
  reactive,
  ref
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";
import {
  formatDate
} from "../utils/format";

type FeedbackType =
  | "suggestion"
  | "bug"
  | "question"
  | "other";

type FeedbackStatus =
  | "open"
  | "processing"
  | "replied"
  | "closed";

interface FeedbackSummary {
  id: string;
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

const sending =
  ref(false);

const detailLoading =
  ref(false);

const errorMessage =
  ref("");

const successMessage =
  ref("");

const records =
  ref<FeedbackSummary[]>([]);

const selected =
  ref<FeedbackDetail | null>(
    null
  );

const replyDraft =
  ref("");

const form =
  reactive({
    type:
      "suggestion" as
        FeedbackType,
    title: "",
    content: ""
  });

const openCount =
  computed(() =>
    records.value.filter(
      (item) =>
        item.status !==
          "closed"
    ).length
  );

onMounted(loadFeedback);

async function loadFeedback() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<{
        feedback:
          FeedbackSummary[];
      }>(
        "/api/account/feedback"
      );

    records.value =
      data.feedback || [];

    if (
      selected.value
    ) {
      const stillExists =
        records.value.some(
          (item) =>
            item.id ===
            selected.value?.id
        );

      if (stillExists) {
        await openFeedback(
          selected.value.id
        );
      }
      else {
        selected.value =
          null;
      }
    }
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "读取反馈记录失败"
      );
  }
  finally {
    loading.value = false;
  }
}

async function createFeedback() {
  if (
    !form.title.trim() ||
    !form.content.trim()
  ) {
    errorMessage.value =
      "请填写反馈标题和详细内容";
    return;
  }

  sending.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const data =
      await apiRequest<{
        feedback:
          FeedbackDetail;
      }>(
        "/api/account/feedback",
        jsonRequest({
          type:
            form.type,
          title:
            form.title.trim(),
          content:
            form.content.trim()
        })
      );

    selected.value =
      data.feedback;

    form.type =
      "suggestion";
    form.title = "";
    form.content = "";

    successMessage.value =
      "反馈已提交，站长回复后会保留在这里。";

    await loadFeedback();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "提交反馈失败"
      );
  }
  finally {
    sending.value = false;
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
        `/api/account/feedback/${encodeURIComponent(id)}`
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

async function sendFollowUp() {
  if (
    !selected.value ||
    !replyDraft.value.trim()
  ) {
    return;
  }

  sending.value = true;
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<{
        feedback:
          FeedbackDetail;
      }>(
        `/api/account/feedback/${encodeURIComponent(selected.value.id)}/replies`,
        jsonRequest({
          content:
            replyDraft.value.trim()
        })
      );

    selected.value =
      data.feedback;

    replyDraft.value = "";

    successMessage.value =
      "补充内容已发送";

    await loadFeedback();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "发送补充内容失败"
      );
  }
  finally {
    sending.value = false;
  }
}

async function closeFeedback() {
  if (
    !selected.value ||
    selected.value.status ===
      "closed"
  ) {
    return;
  }

  if (
    !await platformConfirm(
      "确定关闭这条反馈吗？关闭后不能继续补充。"
    )
  ) {
    return;
  }

  sending.value = true;

  try {
    const data =
      await apiRequest<{
        feedback:
          FeedbackDetail;
      }>(
        `/api/account/feedback/${encodeURIComponent(selected.value.id)}/close`,
        {
          method: "POST"
        }
      );

    selected.value =
      data.feedback;

    await loadFeedback();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "关闭反馈失败"
      );
  }
  finally {
    sending.value = false;
  }
}

function typeLabel(
  type: FeedbackType
): string {
  if (type === "bug") {
    return "问题反馈";
  }

  if (
    type === "question"
  ) {
    return "使用咨询";
  }

  if (type === "other") {
    return "其他";
  }

  return "建议";
}

function statusLabel(
  status: FeedbackStatus
): string {
  if (
    status === "processing"
  ) {
    return "处理中";
  }

  if (
    status === "replied"
  ) {
    return "已回复";
  }

  if (
    status === "closed"
  ) {
    return "已关闭";
  }

  return "待处理";
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
  <div class="feedback-center">
    <section class="feedback-hero">
      <div>
        <span>USER FEEDBACK</span>
        <h2>用户反馈</h2>
        <p>
          提交建议、问题或使用咨询。站长的处理进度与回复都会保留在这里。
        </p>
      </div>

      <div>
        <small>进行中</small>
        <strong>
          {{ openCount }}
        </strong>
      </div>
    </section>

    <p
      v-if="successMessage"
      class="feedback-message success"
    >
      {{ successMessage }}
    </p>

    <p
      v-if="errorMessage"
      class="feedback-message error"
    >
      {{ errorMessage }}
    </p>

    <section class="feedback-create-card">
      <header>
        <div>
          <span>NEW FEEDBACK</span>
          <h3>告诉我们哪里可以做得更好</h3>
        </div>
      </header>

      <div class="feedback-create-grid">
        <label>
          <span>类型</span>
          <select
            v-model="form.type"
          >
            <option value="suggestion">
              功能建议
            </option>
            <option value="bug">
              问题反馈
            </option>
            <option value="question">
              使用咨询
            </option>
            <option value="other">
              其他
            </option>
          </select>
        </label>

        <label>
          <span>标题</span>
          <input
            v-model="form.title"
            maxlength="80"
            placeholder="一句话说明你的反馈"
          />
        </label>
      </div>

      <label class="feedback-content-field">
        <span>详细内容</span>
        <textarea
          v-model="form.content"
          maxlength="3000"
          placeholder="尽量说明发生了什么、你的期望是什么，以及相关操作步骤。"
        ></textarea>
      </label>

      <div class="feedback-create-actions">
        <small>
          {{
            form.content.length
          }}/3000
        </small>

        <button
          type="button"
          :disabled="sending"
          @click="createFeedback"
        >
          {{
            sending
              ? "正在提交…"
              : "提交反馈"
          }}
        </button>
      </div>
    </section>

    <section class="feedback-workspace">
      <aside class="feedback-list">
        <header>
          <strong>我的反馈</strong>
          <button
            type="button"
            @click="loadFeedback"
          >
            刷新
          </button>
        </header>

        <div
          v-if="loading"
          class="feedback-empty"
        >
          正在读取…
        </div>

        <div
          v-else-if="
            records.length === 0
          "
          class="feedback-empty"
        >
          暂无反馈记录
        </div>

        <button
          v-for="item in records"
          v-else
          :key="item.id"
          type="button"
          class="feedback-list-item"
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
                typeLabel(
                  item.type
                )
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

      <section class="feedback-detail">
        <div
          v-if="detailLoading"
          class="feedback-empty"
        >
          正在读取反馈详情…
        </div>

        <div
          v-else-if="!selected"
          class="feedback-empty detail"
        >
          选择左侧反馈查看处理记录与站长回复
        </div>

        <template v-else>
          <header class="feedback-detail-head">
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

          <article class="feedback-origin">
            <strong>我的反馈</strong>
            <p>
              {{ selected.content }}
            </p>
          </article>

          <div class="feedback-thread">
            <article
              v-for="reply in selected.replies"
              :key="reply.id"
              :class="reply.authorRole"
            >
              <header>
                <strong>
                  {{
                    reply.authorRole ===
                      "admin"
                      ? "站长回复"
                      : "我的补充"
                  }}
                </strong>
                <span>
                  {{
                    formatDate(
                      reply.createdAt
                    )
                  }}
                </span>
              </header>

              <p>
                {{ reply.content }}
              </p>
            </article>

            <div
              v-if="
                selected.replies
                  .length === 0
              "
              class="feedback-thread-empty"
            >
              站长暂未回复，我们会在这里同步处理进展。
            </div>
          </div>

          <div
            v-if="
              selected.status !==
              'closed'
            "
            class="feedback-follow-up"
          >
            <textarea
              v-model="replyDraft"
              maxlength="3000"
              placeholder="需要补充信息？可以继续留言。"
            ></textarea>

            <div>
              <button
                type="button"
                class="ghost"
                :disabled="sending"
                @click="closeFeedback"
              >
                关闭反馈
              </button>

              <button
                type="button"
                :disabled="
                  sending ||
                  !replyDraft.trim()
                "
                @click="sendFollowUp"
              >
                发送补充
              </button>
            </div>
          </div>
        </template>
      </section>
    </section>
  </div>
</template>

<style scoped>
.feedback-center{
  display:grid;
  gap:14px;
}
.feedback-hero{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:20px;
  padding:20px 22px;
  border:1px solid #e0e1eb;
  border-radius:18px;
  background:
    radial-gradient(circle at 88% 15%,rgba(107,86,220,.12),transparent 30%),
    #fff;
}
.feedback-hero>div:first-child span,
.feedback-create-card header span{
  color:#6b57d4;
  font-size:9px;
  font-weight:900;
  letter-spacing:.14em;
}
.feedback-hero h2{
  margin:5px 0 4px;
  font-size:22px;
}
.feedback-hero p{
  margin:0;
  color:#858999;
  font-size:11px;
}
.feedback-hero>div:last-child{
  display:grid;
  min-width:92px;
  place-items:center;
  padding:10px 13px;
  border:1px solid #dfdbf4;
  border-radius:13px;
  background:#f8f6ff;
}
.feedback-hero>div:last-child small{
  color:#9395a4;
}
.feedback-hero>div:last-child strong{
  margin-top:2px;
  color:#5f4ec3;
  font-size:23px;
}
.feedback-message{
  margin:0;
  padding:10px 12px;
  border-radius:10px;
  font-size:11px;
}
.feedback-message.success{
  background:#eaf8f0;
  color:#28734e;
}
.feedback-message.error{
  background:#fff0f0;
  color:#9a3e48;
}
.feedback-create-card{
  padding:17px 18px;
  border:1px solid #e1e2eb;
  border-radius:16px;
  background:#fff;
}
.feedback-create-card h3{
  margin:4px 0 0;
  font-size:17px;
}
.feedback-create-grid{
  display:grid;
  grid-template-columns:180px minmax(0,1fr);
  gap:10px;
  margin-top:13px;
}
.feedback-create-card label{
  display:grid;
  gap:5px;
}
.feedback-create-card label>span{
  color:#777b8b;
  font-size:10px;
  font-weight:700;
}
.feedback-create-card input,
.feedback-create-card select,
.feedback-create-card textarea,
.feedback-follow-up textarea{
  box-sizing:border-box;
  width:100%;
  border:1px solid #dcdfe8;
  border-radius:9px;
  background:#fff;
  color:#3d4150;
  font:inherit;
  outline:none;
}
.feedback-create-card input,
.feedback-create-card select{
  min-height:38px;
  padding:0 10px;
}
.feedback-content-field{
  margin-top:10px;
}
.feedback-create-card textarea{
  min-height:96px;
  padding:10px;
  resize:vertical;
}
.feedback-create-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:10px;
  margin-top:9px;
}
.feedback-create-actions small{
  color:#9a9dab;
}
.feedback-create-actions button,
.feedback-follow-up button,
.feedback-list>header button{
  min-height:34px;
  padding:0 12px;
  border:0;
  border-radius:8px;
  background:#6553cf;
  color:#fff;
  font:inherit;
  font-size:10px;
  font-weight:800;
  cursor:pointer;
}
.feedback-workspace{
  display:grid;
  grid-template-columns:330px minmax(0,1fr);
  gap:12px;
  min-height:430px;
}
.feedback-list,
.feedback-detail{
  overflow:hidden;
  border:1px solid #e1e2ea;
  border-radius:15px;
  background:#fff;
}
.feedback-list>header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:12px 13px;
  border-bottom:1px solid #eceef3;
}
.feedback-list>header button{
  min-height:29px;
  background:#f2f0fb;
  color:#5e4fc0;
}
.feedback-list-item{
  display:grid;
  width:100%;
  gap:5px;
  padding:12px 13px;
  border:0;
  border-top:1px solid #eff0f4;
  background:#fff;
  color:#4a4e5e;
  text-align:left;
  cursor:pointer;
}
.feedback-list-item:first-of-type{
  border-top:0;
}
.feedback-list-item:hover,
.feedback-list-item.active{
  background:#f7f5ff;
}
.feedback-list-item>div{
  display:flex;
  justify-content:space-between;
  gap:8px;
}
.feedback-list-item>div span{
  color:#7463ce;
  font-size:9px;
  font-weight:800;
}
.feedback-list-item i,
.feedback-detail-head i{
  padding:3px 6px;
  border-radius:999px;
  background:#f0f0f4;
  color:#75798a;
  font-size:8px;
  font-style:normal;
}
.feedback-list-item i.replied,
.feedback-detail-head i.replied{
  background:#e8f7ef;
  color:#28734e;
}
.feedback-list-item i.processing,
.feedback-detail-head i.processing{
  background:#fff4dc;
  color:#9b6a18;
}
.feedback-list-item i.open,
.feedback-detail-head i.open{
  background:#f0edff;
  color:#5d4bb9;
}
.feedback-list-item strong{
  font-size:11px;
}
.feedback-list-item p{
  display:-webkit-box;
  overflow:hidden;
  margin:0;
  color:#818594;
  font-size:9px;
  line-height:1.45;
  -webkit-box-orient:vertical;
  -webkit-line-clamp:2;
}
.feedback-list-item small{
  color:#a1a4af;
  font-size:8.5px;
}
.feedback-detail{
  padding:16px;
}
.feedback-detail-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:14px;
  padding-bottom:12px;
  border-bottom:1px solid #eceef3;
}
.feedback-detail-head span{
  color:#6a57d2;
  font-size:9px;
  font-weight:800;
}
.feedback-detail-head h3{
  margin:4px 0;
  font-size:18px;
}
.feedback-detail-head small{
  color:#9b9eaa;
}
.feedback-origin{
  margin-top:12px;
  padding:12px;
  border-radius:10px;
  background:#f7f7fa;
}
.feedback-origin strong{
  font-size:10px;
}
.feedback-origin p,
.feedback-thread article p{
  margin:5px 0 0;
  color:#5e6272;
  font-size:10px;
  line-height:1.65;
  white-space:pre-wrap;
}
.feedback-thread{
  display:grid;
  gap:8px;
  margin-top:10px;
}
.feedback-thread article{
  padding:11px 12px;
  border:1px solid #e6e7ed;
  border-radius:10px;
}
.feedback-thread article.admin{
  border-color:#ddd7f7;
  background:#faf8ff;
}
.feedback-thread article header{
  display:flex;
  justify-content:space-between;
  gap:10px;
}
.feedback-thread article header strong{
  color:#5f4cc1;
  font-size:10px;
}
.feedback-thread article header span{
  color:#a1a4ae;
  font-size:8.5px;
}
.feedback-thread-empty,
.feedback-empty{
  padding:28px 12px;
  color:#9a9daa;
  font-size:10px;
  text-align:center;
}
.feedback-empty.detail{
  min-height:320px;
  display:grid;
  place-items:center;
}
.feedback-follow-up{
  display:grid;
  gap:8px;
  margin-top:12px;
  padding-top:12px;
  border-top:1px solid #eceef3;
}
.feedback-follow-up textarea{
  min-height:80px;
  padding:9px;
  resize:vertical;
}
.feedback-follow-up>div{
  display:flex;
  justify-content:flex-end;
  gap:7px;
}
.feedback-follow-up button.ghost{
  border:1px solid #e0e1e8;
  background:#fff;
  color:#777b8c;
}
.feedback-follow-up button:disabled,
.feedback-create-actions button:disabled{
  cursor:not-allowed;
  opacity:.5;
}
@media(max-width:900px){
  .feedback-workspace{
    grid-template-columns:1fr;
  }
}
@media(max-width:620px){
  .feedback-hero{
    display:grid;
  }
  .feedback-create-grid{
    grid-template-columns:1fr;
  }
}
</style>

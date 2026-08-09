<script setup lang="ts">
import {
  computed,
  onMounted,
  ref
} from "vue";
import {
  Bell,
  Clock3,
  Gift,
  Info,
  Megaphone,
  Rocket,
  Sparkles,
  TriangleAlert
} from "@lucide/vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";

type AnnouncementKind =
  | "info"
  | "warning"
  | "success";

type AnnouncementDisplayMode =
  | "topbar"
  | "popup";

type AnnouncementMotion =
  | "none"
  | "shimmer"
  | "pulse"
  | "gradient";

type AnnouncementIcon =
  | "megaphone"
  | "gift"
  | "sparkles"
  | "bell"
  | "info"
  | "warning"
  | "rocket"
  | "clock";

interface Announcement {
  id: string;
  title: string;
  content: string;
  kind: AnnouncementKind;
  displayMode:
    AnnouncementDisplayMode;
  icon: AnnouncementIcon;
  motion: AnnouncementMotion;
  linkUrl?: string;
  linkText?: string;
  countdownEnabled: boolean;
  pinned: boolean;
  published: boolean;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
}

const records =
  ref<Announcement[]>([]);

const loading =
  ref(false);

const saving =
  ref(false);

const editingId =
  ref("");

const title =
  ref("");

const content =
  ref("");

const kind =
  ref<AnnouncementKind>(
    "info"
  );

const displayMode =
  ref<AnnouncementDisplayMode>(
    "topbar"
  );

const icon =
  ref<AnnouncementIcon>(
    "megaphone"
  );

const motion =
  ref<AnnouncementMotion>(
    "none"
  );

const linkUrl =
  ref("");

const linkText =
  ref("");

const countdownEnabled =
  ref(false);

const pinned =
  ref(false);

const published =
  ref(true);

const startsAt =
  ref("");

const endsAt =
  ref("");

const message =
  ref("");

const errorMessage =
  ref("");

const previewTitle =
  computed(() =>
    title.value.trim() ||
    "新用户登录即送免费额度"
  );

const previewContent =
  computed(() =>
    content.value.trim() ||
    "在这里预览公告正文、倒计时、跳转按钮和动态效果。"
  );

onMounted(load);

async function load() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const data =
      await apiRequest<{
        announcements:
          Announcement[];
      }>(
        "/api/admin/announcements"
      );

    records.value =
      data.announcements || [];
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "读取公告失败"
      );
  }
  finally {
    loading.value = false;
  }
}

function edit(
  item: Announcement
) {
  editingId.value =
    item.id;

  title.value =
    item.title;

  content.value =
    item.content;

  kind.value =
    item.kind;

  displayMode.value =
    item.displayMode;

  icon.value =
    item.icon;

  motion.value =
    item.motion;

  linkUrl.value =
    item.linkUrl || "";

  linkText.value =
    item.linkText || "";

  countdownEnabled.value =
    item.countdownEnabled;

  pinned.value =
    item.pinned;

  published.value =
    item.published;

  startsAt.value =
    toLocalInput(
      item.startsAt
    );

  endsAt.value =
    toLocalInput(
      item.endsAt
    );

  message.value = "";
  errorMessage.value = "";
}

function resetForm() {
  editingId.value = "";
  title.value = "";
  content.value = "";
  kind.value = "info";
  displayMode.value =
    "topbar";
  icon.value =
    "megaphone";
  motion.value = "none";
  linkUrl.value = "";
  linkText.value = "";
  countdownEnabled.value =
    false;
  pinned.value = false;
  published.value = true;
  startsAt.value = "";
  endsAt.value = "";
}

async function save() {
  if (
    !title.value.trim() ||
    !content.value.trim()
  ) {
    errorMessage.value =
      "请填写公告标题和内容";

    return;
  }

  if (
    countdownEnabled.value &&
    !endsAt.value
  ) {
    errorMessage.value =
      "开启倒计时后必须设置结束展示时间";

    return;
  }

  saving.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const payload = {
      title:
        title.value.trim(),
      content:
        content.value.trim(),
      kind:
        kind.value,
      displayMode:
        displayMode.value,
      icon:
        icon.value,
      motion:
        motion.value,
      linkUrl:
        linkUrl.value.trim() ||
        null,
      linkText:
        linkText.value.trim() ||
        null,
      countdownEnabled:
        countdownEnabled.value,
      pinned:
        pinned.value,
      published:
        published.value,
      startsAt:
        startsAt.value
          ? new Date(
              startsAt.value
            ).toISOString()
          : null,
      endsAt:
        endsAt.value
          ? new Date(
              endsAt.value
            ).toISOString()
          : null
    };

    if (editingId.value) {
      await apiRequest(
        `/api/admin/announcements/${encodeURIComponent(editingId.value)}`,
        jsonRequest(
          payload,
          "PATCH"
        )
      );

      message.value =
        "公告已更新";
    }
    else {
      await apiRequest(
        "/api/admin/announcements",
        jsonRequest(
          payload
        )
      );

      message.value =
        "公告已创建";
    }

    resetForm();
    await load();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "保存公告失败"
      );
  }
  finally {
    saving.value = false;
  }
}

async function togglePublished(
  item: Announcement
) {
  try {
    await apiRequest(
      `/api/admin/announcements/${encodeURIComponent(item.id)}`,
      jsonRequest({
        published:
          !item.published
      }, "PATCH")
    );

    await load();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "更新公告状态失败"
      );
  }
}

async function remove(
  item: Announcement
) {
  if (
    !window.confirm(
      `确定删除公告“${item.title}”吗？`
    )
  ) {
    return;
  }

  try {
    await apiRequest(
      `/api/admin/announcements/${encodeURIComponent(item.id)}`,
      {
        method:
          "DELETE"
      }
    );

    if (
      editingId.value ===
      item.id
    ) {
      resetForm();
    }

    await load();
  }
  catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "删除公告失败"
      );
  }
}

function iconComponent(
  value: AnnouncementIcon
) {
  if (value === "gift") {
    return Gift;
  }

  if (
    value === "sparkles"
  ) {
    return Sparkles;
  }

  if (value === "bell") {
    return Bell;
  }

  if (value === "info") {
    return Info;
  }

  if (
    value === "warning"
  ) {
    return TriangleAlert;
  }

  if (value === "rocket") {
    return Rocket;
  }

  if (value === "clock") {
    return Clock3;
  }

  return Megaphone;
}

function displayModeLabel(
  value:
    AnnouncementDisplayMode
): string {
  return value === "popup"
    ? "首页弹窗"
    : "顶部消息";
}

function motionLabel(
  value:
    AnnouncementMotion
): string {
  if (
    value === "shimmer"
  ) {
    return "流光";
  }

  if (
    value === "pulse"
  ) {
    return "呼吸";
  }

  if (
    value === "gradient"
  ) {
    return "动态渐变";
  }

  return "静态";
}

function toLocalInput(
  value?: string
): string {
  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  const offset =
    date.getTimezoneOffset() *
    60_000;

  return new Date(
    date.getTime() -
      offset
  )
    .toISOString()
    .slice(
      0,
      16
    );
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
  <div class="announcement-admin-v3">
    <section class="announcement-editor-card">
      <header class="announcement-section-head">
        <div>
          <span>ANNOUNCEMENT STUDIO</span>
          <h2>
            {{
              editingId
                ? "编辑公告"
                : "发布新公告"
            }}
          </h2>
          <p>
            选择展示方式并配置内容、样式与交互，右侧可实时预览。
          </p>
        </div>

        <button
          v-if="editingId"
          type="button"
          class="soft"
          @click="resetForm"
        >
          取消编辑
        </button>
      </header>

      <div class="announcement-mode-switch">
        <button
          type="button"
          :class="{
            active:
              displayMode ===
              'topbar'
          }"
          @click="
            displayMode =
              'topbar'
          "
        >
          <div class="mode-icon">
            <Megaphone
              :size="17"
              :stroke-width="2.2"
            />
          </div>

          <span>
            <strong>顶部消息</strong>
            <small>轻量、不打断用户操作</small>
          </span>
        </button>

        <button
          type="button"
          :class="{
            active:
              displayMode ===
              'popup'
          }"
          @click="
            displayMode =
              'popup'
          "
        >
          <div class="mode-icon">
            <Sparkles
              :size="17"
              :stroke-width="2.2"
            />
          </div>

          <span>
            <strong>首页弹窗</strong>
            <small>适合活动与重要提醒</small>
          </span>
        </button>
      </div>

      <div class="announcement-form-grid">
        <label class="wide">
          <span>标题</span>
          <input
            v-model="title"
            maxlength="80"
            placeholder="例如：新用户登录即送免费额度"
          />
        </label>

        <label class="wide">
          <span>内容</span>
          <textarea
            v-model="content"
            maxlength="1200"
            rows="4"
            placeholder="请输入公告正文"
          ></textarea>
        </label>

        <label>
          <span>消息类型</span>
          <select v-model="kind">
            <option value="info">
              普通
            </option>
            <option value="warning">
              重要提醒
            </option>
            <option value="success">
              活动 / 成功
            </option>
          </select>
        </label>

        <label>
          <span>图标</span>
          <select v-model="icon">
            <option value="megaphone">
              喇叭
            </option>
            <option value="gift">
              礼物
            </option>
            <option value="sparkles">
              闪光
            </option>
            <option value="bell">
              铃铛
            </option>
            <option value="info">
              信息
            </option>
            <option value="warning">
              警告
            </option>
            <option value="rocket">
              火箭
            </option>
            <option value="clock">
              时钟
            </option>
          </select>
        </label>

        <label>
          <span>动态效果</span>
          <select v-model="motion">
            <option value="none">
              静态
            </option>
            <option value="shimmer">
              流光
            </option>
            <option value="pulse">
              呼吸
            </option>
            <option value="gradient">
              动态渐变
            </option>
          </select>
        </label>

        <label>
          <span>按钮文案</span>
          <input
            v-model="linkText"
            maxlength="40"
            placeholder="例如：立即查看"
          />
        </label>

        <label class="wide">
          <span>跳转链接</span>
          <input
            v-model="linkUrl"
            maxlength="800"
            placeholder="/account?tab=invites 或 https://..."
          />
        </label>

        <label>
          <span>开始展示</span>
          <input
            v-model="startsAt"
            type="datetime-local"
          />
        </label>

        <label>
          <span>结束展示</span>
          <input
            v-model="endsAt"
            type="datetime-local"
          />
        </label>
      </div>

      <div class="announcement-options">
        <label>
          <input
            v-model="published"
            type="checkbox"
          />
          <span>立即发布</span>
        </label>

        <label>
          <input
            v-model="pinned"
            type="checkbox"
          />
          <span>置顶优先</span>
        </label>

        <label>
          <input
            v-model="countdownEnabled"
            type="checkbox"
          />
          <span>显示倒计时</span>
        </label>
      </div>

      <p
        v-if="message"
        class="announcement-message success"
      >
        {{ message }}
      </p>

      <p
        v-if="errorMessage"
        class="announcement-message error"
      >
        {{ errorMessage }}
      </p>

      <button
        type="button"
        class="announcement-primary"
        :disabled="saving"
        @click="save"
      >
        {{
          saving
            ? "保存中…"
            : editingId
              ? "保存修改"
              : "发布公告"
        }}
      </button>
    </section>

    <aside class="announcement-side-column">
      <section class="announcement-preview-card">
        <header>
          <div>
            <span>LIVE PREVIEW</span>
            <strong>实时预览</strong>
          </div>

          <small>
            {{
              displayModeLabel(
                displayMode
              )
            }}
            ·
            {{
              motionLabel(
                motion
              )
            }}
          </small>
        </header>

        <div
          v-if="
            displayMode ===
            'topbar'
          "
          class="preview-stage topbar-stage"
        >
          <div
            class="preview-topbar"
            :class="[
              kind,
              `motion-${motion}`
            ]"
          >
            <b
              v-if="
                countdownEnabled
              "
            >
              01:23:45
            </b>

            <i>
              <component
                :is="
                  iconComponent(
                    icon
                  )
                "
                :size="15"
                :stroke-width="2.2"
              />
            </i>

            <strong>
              {{ previewTitle }}
            </strong>

            <em
              v-if="
                linkUrl ||
                linkText
              "
            >
              {{
                linkText ||
                "查看详情"
              }}
              →
            </em>
          </div>
        </div>

        <div
          v-else
          class="preview-stage popup-stage"
        >
          <div
            class="preview-popup"
            :class="[
              kind,
              `motion-${motion}`
            ]"
          >
            <div class="preview-popup-head">
              <i>
                <component
                  :is="
                    iconComponent(
                      icon
                    )
                  "
                  :size="18"
                  :stroke-width="2.2"
                />
              </i>

              <div>
                <span>站点公告</span>
                <strong>
                  {{ previewTitle }}
                </strong>
              </div>
            </div>

            <div class="preview-popup-content">
              {{ previewContent }}
            </div>

            <div class="preview-popup-meta">
              <b
                v-if="
                  countdownEnabled
                "
              >
                剩余 01:23:45
              </b>

              <em
                v-if="
                  linkUrl ||
                  linkText
                "
              >
                {{
                  linkText ||
                  "查看详情"
                }}
                →
              </em>
            </div>
          </div>
        </div>
      </section>

      <section class="announcement-list-card">
        <header class="announcement-section-head">
          <div>
            <span>PUBLISHED / DRAFT</span>
            <h2>公告列表</h2>
          </div>

          <button
            type="button"
            class="soft"
            :disabled="loading"
            @click="load"
          >
            刷新
          </button>
        </header>

        <div
          v-if="loading"
          class="announcement-empty"
        >
          正在读取…
        </div>

        <div
          v-else-if="
            !records.length
          "
          class="announcement-empty"
        >
          暂无公告
        </div>

        <div
          v-else
          class="announcement-record-list"
        >
          <article
            v-for="item in records"
            :key="item.id"
          >
            <div class="announcement-record-main">
              <div class="announcement-record-tags">
                <i>
                  {{
                    displayModeLabel(
                      item.displayMode
                    )
                  }}
                </i>

                <i
                  :class="
                    item.kind
                  "
                >
                  {{
                    item.kind ===
                      "warning"
                      ? "提醒"
                      : item.kind ===
                          "success"
                        ? "活动"
                        : "普通"
                  }}
                </i>

                <i
                  v-if="
                    item.countdownEnabled
                  "
                >
                  倒计时
                </i>

                <i
                  v-if="
                    item.motion !==
                    'none'
                  "
                >
                  {{
                    motionLabel(
                      item.motion
                    )
                  }}
                </i>

                <i
                  v-if="item.pinned"
                >
                  置顶
                </i>

                <i
                  :class="
                    item.published
                      ? 'online'
                      : 'offline'
                  "
                >
                  {{
                    item.published
                      ? "已发布"
                      : "草稿"
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
                更新：
                {{
                  new Date(
                    item.updatedAt
                  ).toLocaleString()
                }}
              </small>
            </div>

            <div class="announcement-record-actions">
              <button
                type="button"
                @click="edit(item)"
              >
                编辑
              </button>

              <button
                type="button"
                @click="
                  togglePublished(
                    item
                  )
                "
              >
                {{
                  item.published
                    ? "下线"
                    : "发布"
                }}
              </button>

              <button
                type="button"
                class="danger"
                @click="remove(item)"
              >
                删除
              </button>
            </div>
          </article>
        </div>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.announcement-admin-v3{
  display:grid;
  grid-template-columns:minmax(520px,1.05fr) minmax(420px,.95fr);
  gap:18px;
  align-items:start;
}

.announcement-editor-card,
.announcement-preview-card,
.announcement-list-card{
  min-width:0;
  border:1px solid #e3e4ec;
  border-radius:18px;
  background:#fff;
  box-shadow:
    0 12px 34px rgba(31,36,54,.045);
}

.announcement-editor-card{
  padding:22px;
}

.announcement-side-column{
  display:grid;
  gap:14px;
  min-width:0;
}

.announcement-preview-card,
.announcement-list-card{
  padding:18px;
}

.announcement-section-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:14px;
}

.announcement-section-head span,
.announcement-preview-card header span{
  color:#6a56d3;
  font-size:10px;
  font-weight:900;
  letter-spacing:.14em;
}

.announcement-section-head h2{
  margin:5px 0 0;
  color:#2d3140;
  font-size:20px;
  letter-spacing:-.015em;
}

.announcement-section-head p{
  margin:7px 0 0;
  color:#858a98;
  font-size:12px;
  line-height:1.6;
}

button.soft{
  min-height:36px;
  padding:0 13px;
  border:1px solid #dfe1e8;
  border-radius:10px;
  background:#fff;
  color:#666b7a;
  font:inherit;
  font-size:11px;
  font-weight:800;
  cursor:pointer;
}

.announcement-mode-switch{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  margin-top:18px;
}

.announcement-mode-switch button{
  display:flex;
  align-items:center;
  gap:11px;
  min-height:72px;
  padding:12px 14px;
  border:1px solid #e0e1e8;
  border-radius:14px;
  background:#fafafa;
  color:#707585;
  text-align:left;
  cursor:pointer;
  transition:.18s ease;
}

.announcement-mode-switch button:hover{
  border-color:#cbc5ea;
  background:#fbfaff;
}

.announcement-mode-switch button.active{
  border-color:#9f93e6;
  background:linear-gradient(135deg,#f8f5ff,#fbfaff);
  color:#5947b8;
  box-shadow:
    0 0 0 3px rgba(101,82,207,.07),
    0 8px 22px rgba(101,82,207,.08);
}

.mode-icon{
  display:grid;
  place-items:center;
  flex:0 0 38px;
  width:38px;
  height:38px;
  border-radius:11px;
  background:#f0eef7;
  color:#6a5aaf;
}

.announcement-mode-switch button.active .mode-icon{
  background:linear-gradient(135deg,#6753d1,#8770ef);
  color:#fff;
  box-shadow:0 7px 18px rgba(101,82,207,.20);
}

.announcement-mode-switch button>span{
  display:grid;
  gap:2px;
}

.announcement-mode-switch strong{
  font-size:13px;
}

.announcement-mode-switch small{
  color:#969aa7;
  font-size:10px;
}

.announcement-form-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
  margin-top:16px;
}

.announcement-form-grid .wide{
  grid-column:1 / -1;
}

.announcement-form-grid label{
  display:grid;
  gap:7px;
}

.announcement-form-grid label>span{
  color:#676c7b;
  font-size:11px;
  font-weight:800;
}

.announcement-form-grid input,
.announcement-form-grid textarea,
.announcement-form-grid select{
  width:100%;
  box-sizing:border-box;
  border:1px solid #dcdfe7;
  border-radius:10px;
  background:#fff;
  color:#3d4251;
  font:inherit;
  font-size:12px;
  outline:none;
  transition:
    border-color .15s ease,
    box-shadow .15s ease;
}

.announcement-form-grid input:focus,
.announcement-form-grid textarea:focus,
.announcement-form-grid select:focus{
  border-color:#a69be7;
  box-shadow:0 0 0 3px rgba(101,82,207,.07);
}

.announcement-form-grid input,
.announcement-form-grid select{
  min-height:42px;
  padding:0 11px;
}

.announcement-form-grid textarea{
  min-height:116px;
  padding:11px 12px;
  line-height:1.6;
  resize:vertical;
}

.announcement-options{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin-top:14px;
  padding:12px 13px;
  border:1px solid #e7e8ee;
  border-radius:12px;
  background:#fafafd;
}

.announcement-options label{
  display:flex;
  align-items:center;
  gap:7px;
  padding:6px 9px;
  border-radius:8px;
  color:#666b7a;
  font-size:11px;
  font-weight:750;
}

.announcement-options label:hover{
  background:#f2f0fb;
}

.announcement-options input{
  width:14px;
  height:14px;
}

.announcement-message{
  margin:12px 0 0;
  padding:10px 11px;
  border-radius:9px;
  font-size:11px;
}

.announcement-message.success{
  background:#eaf8f0;
  color:#28734e;
}

.announcement-message.error{
  background:#fff0f0;
  color:#9a3e48;
}

.announcement-primary{
  min-height:42px;
  margin-top:14px;
  padding:0 18px;
  border:0;
  border-radius:10px;
  background:linear-gradient(135deg,#6552cf,#755ddd);
  color:#fff;
  font:inherit;
  font-size:12px;
  font-weight:850;
  cursor:pointer;
  box-shadow:0 8px 20px rgba(101,82,207,.18);
}

.announcement-preview-card>header{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:10px;
}

.announcement-preview-card>header>div{
  display:grid;
  gap:3px;
}

.announcement-preview-card header strong{
  color:#333746;
  font-size:16px;
}

.announcement-preview-card>header small{
  color:#969aa7;
  font-size:10px;
}

.preview-stage{
  display:grid;
  place-items:center;
  margin-top:12px;
  border:1px solid #e6e7ed;
  border-radius:14px;
  overflow:hidden;
}

.topbar-stage{
  min-height:102px;
  padding:16px;
  background:#f7f7fa;
}

.preview-topbar{
  position:relative;
  display:flex;
  align-items:center;
  gap:8px;
  width:100%;
  min-height:46px;
  box-sizing:border-box;
  padding:7px 9px;
  overflow:hidden;
  border:1px solid #dddff0;
  border-radius:10px;
  background:#fff;
}

.preview-topbar>b{
  flex:0 0 auto;
  padding:5px 7px;
  border-radius:7px;
  background:#f5f2ff;
  color:#5f4bc5;
  font-size:9px;
  font-variant-numeric:tabular-nums;
}

.preview-topbar>i{
  display:grid;
  place-items:center;
  flex:0 0 29px;
  width:29px;
  height:29px;
  border-radius:8px;
  background:#eeeaff;
  color:#6653cf;
  font-style:normal;
}

.preview-topbar>strong{
  overflow:hidden;
  color:#343846;
  font-size:10px;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.preview-topbar>em{
  flex:0 0 auto;
  color:#6553cf;
  font-size:9px;
  font-style:normal;
  font-weight:800;
  white-space:nowrap;
}

.popup-stage{
  min-height:270px;
  padding:22px;
  background:rgba(34,37,53,.16);
}

.preview-popup{
  position:relative;
  width:min(360px,92%);
  box-sizing:border-box;
  padding:17px;
  overflow:hidden;
  border:1px solid #ddd9ee;
  border-radius:16px;
  background:#fff;
  box-shadow:0 18px 46px rgba(35,35,57,.16);
}

.preview-popup-head{
  display:grid;
  grid-template-columns:auto minmax(0,1fr);
  align-items:center;
  gap:10px;
}

.preview-popup-head>i{
  display:grid;
  place-items:center;
  width:38px;
  height:38px;
  border-radius:11px;
  background:linear-gradient(135deg,#6552d0,#8670ee);
  color:#fff;
  font-style:normal;
}

.preview-popup-head>div{
  display:grid;
  gap:2px;
  min-width:0;
}

.preview-popup-head span{
  color:#6a58d1;
  font-size:7.5px;
  font-weight:900;
  letter-spacing:.12em;
}

.preview-popup-head strong{
  overflow:hidden;
  color:#353946;
  font-size:12px;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.preview-popup p{
  margin:10px 0 0;
  color:#777b89;
  font-size:9.5px;
  line-height:1.55;
  text-align:left;
}

.preview-popup>b{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-top:10px;
  padding:8px 9px;
  border-radius:9px;
  background:#f6f3ff;
  color:#8a8e9d;
  font-size:8px;
  font-weight:700;
}

.preview-popup>b strong{
  color:#5f4bc4;
  font-size:11px;
}

.preview-popup>em{
  display:flex;
  justify-content:space-between;
  margin-top:9px;
  padding:8px 10px;
  border-radius:8px;
  background:#6553cf;
  color:#fff;
  font-size:8.5px;
  font-style:normal;
  font-weight:850;
}

.preview-topbar.warning>i{
  background:#fff1d8;
  color:#b47724;
}

.preview-topbar.success>i{
  background:#e8f7ef;
  color:#2d8659;
}

.preview-popup.warning .preview-popup-head>i{
  background:linear-gradient(135deg,#d18c31,#edb057);
}

.preview-popup.success .preview-popup-head>i{
  background:linear-gradient(135deg,#2d885a,#4db67b);
}

.motion-gradient{
  background:
    linear-gradient(135deg,#fff,#f5f1ff,#f8fbff,#fff);
  background-size:240% 240%;
  animation:preview-gradient 5s ease infinite;
}

.motion-shimmer::after{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  background:
    linear-gradient(
      105deg,
      transparent 0%,
      transparent 37%,
      rgba(255,255,255,.82) 49%,
      transparent 61%,
      transparent 100%
    );
  background-size:220% 100%;
  animation:preview-shimmer 2.8s linear infinite;
}

.motion-pulse>i,
.motion-pulse .preview-popup-head>i{
  animation:preview-pulse 1.7s ease-in-out infinite;
}

.announcement-record-list{
  display:grid;
  margin-top:12px;
}

.announcement-record-list article{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  gap:12px;
  padding:15px 0;
  border-top:1px solid #edf0f3;
}

.announcement-record-list article:first-child{
  border-top:0;
}

.announcement-record-main{
  min-width:0;
}

.announcement-record-tags{
  display:flex;
  flex-wrap:wrap;
  gap:5px;
}

.announcement-record-tags i{
  padding:4px 7px;
  border-radius:999px;
  background:#f0f1f5;
  color:#707582;
  font-size:9px;
  font-style:normal;
}

.announcement-record-tags i.warning{
  background:#fff4de;
  color:#9a681e;
}

.announcement-record-tags i.success,
.announcement-record-tags i.online{
  background:#e9f7ef;
  color:#2c7954;
}

.announcement-record-tags i.offline{
  background:#f0f1f4;
  color:#8d919b;
}

.announcement-record-main>strong{
  display:block;
  margin-top:8px;
  color:#323643;
  font-size:12px;
}

.announcement-record-main p{
  margin:6px 0;
  color:#7a7f8e;
  font-size:10.5px;
  line-height:1.55;
  white-space:pre-wrap;
}

.announcement-record-main small{
  color:#9da1ad;
  font-size:9.5px;
}

.announcement-record-actions{
  display:flex;
  align-items:flex-start;
  gap:6px;
}

.announcement-record-actions button{
  min-height:32px;
  padding:0 10px;
  border:1px solid #dfe1e8;
  border-radius:8px;
  background:#fff;
  color:#656a79;
  font:inherit;
  font-size:9.5px;
  font-weight:800;
  cursor:pointer;
}

.announcement-record-actions button.danger{
  border-color:#f0c8c5;
  color:#a7473e;
}

.announcement-empty{
  padding:48px 12px;
  color:#999daa;
  font-size:11px;
  text-align:center;
}

@keyframes preview-pulse{
  0%,100%{transform:scale(1)}
  50%{transform:scale(1.08)}
}

@keyframes preview-gradient{
  0%{background-position:0% 50%}
  50%{background-position:100% 50%}
  100%{background-position:0% 50%}
}

@keyframes preview-shimmer{
  0%{background-position:120% 0}
  100%{background-position:-120% 0}
}

@media(max-width:1180px){
  .announcement-admin-v3{
    grid-template-columns:1fr;
  }
}

@media(max-width:700px){
  .announcement-form-grid{
    grid-template-columns:1fr;
  }

  .announcement-form-grid .wide{
    grid-column:auto;
  }

  .announcement-mode-switch{
    grid-template-columns:1fr;
  }

  .announcement-record-list article{
    grid-template-columns:1fr;
  }
}

/* Hotfix5：预览与线上新样式保持同一信息层级 */
.preview-topbar{
  min-height:40px;
  border:0;
  border-radius:9px;
  background:linear-gradient(90deg,#7c62e7,#6172e5);
  color:#fff;
}
.preview-topbar.warning{
  background:linear-gradient(90deg,#ff9a2f,#ff5f86);
}
.preview-topbar.success{
  background:linear-gradient(90deg,#31b176,#4d83d6);
}
.preview-topbar>b{
  background:rgba(255,255,255,.16);
  color:#fff;
}
.preview-topbar>i{
  background:rgba(255,255,255,.17);
  color:#fff;
}
.preview-topbar>strong{
  color:#fff;
}
.preview-topbar>em{
  color:#fff;
}
.preview-popup{
  padding:15px;
}
.preview-popup-head{
  margin-bottom:9px;
}
.preview-popup-content{
  padding:10px 11px;
  border:1px solid #ececf2;
  border-radius:9px;
  background:#f8f8fb;
  color:#565b6b;
  font-size:9.5px;
  line-height:1.6;
  text-align:left;
}
.preview-popup-meta{
  display:flex;
  align-items:center;
  gap:7px;
  margin-top:8px;
}
.preview-popup-meta b,
.preview-popup-meta em{
  margin:0;
  padding:5px 7px;
  border-radius:7px;
  font-size:8px;
  font-style:normal;
}
.preview-popup-meta b{
  background:#faf9fe;
  color:#6858bc;
  border:1px solid #e4e0f4;
}
.preview-popup-meta em{
  background:transparent;
  color:#6553bf;
  font-weight:800;
}

/* Hotfix6：后台预览同步线上更高识别样式 */
.preview-topbar{
  min-height:46px;
  padding:7px 10px;
  border:0;
  border-radius:10px;
  background:
    radial-gradient(circle at 15% -30%,rgba(255,255,255,.18),transparent 38%),
    linear-gradient(92deg,#7258e6,#536fe8);
  box-shadow:0 6px 16px rgba(82,68,181,.12);
}
.preview-topbar.warning{
  background:
    radial-gradient(circle at 15% -30%,rgba(255,255,255,.20),transparent 38%),
    linear-gradient(92deg,#ffa32f,#ff6f6f,#fa5e8c);
}
.preview-topbar.success{
  background:
    radial-gradient(circle at 15% -30%,rgba(255,255,255,.18),transparent 38%),
    linear-gradient(92deg,#22b679,#3e9cc5,#557fe0);
}
.preview-topbar>b{
  padding:6px 8px;
  border:1px solid rgba(255,255,255,.42);
  background:rgba(255,255,255,.14);
  color:#fff;
  font-size:9px;
}
.preview-topbar>i{
  width:30px;
  height:30px;
  background:rgba(255,255,255,.17);
  color:#fff;
}
.preview-topbar>strong{
  color:#fff;
  font-size:10.5px;
  font-weight:900;
}
.preview-topbar>em{
  padding:5px 8px;
  border-radius:7px;
  background:#fff;
  color:#5744b2;
  font-size:8.5px;
  font-weight:900;
}
.popup-stage{
  min-height:310px;
}
.preview-popup{
  width:min(390px,94%);
  padding:18px;
  border-radius:17px;
}
.preview-popup-head>i{
  width:42px;
  height:42px;
}
.preview-popup-head strong{
  font-size:13px;
}
.preview-popup-content{
  margin-top:11px;
  padding:12px 13px;
  font-size:10.5px;
  line-height:1.65;
}
.preview-popup-meta{
  margin-top:10px;
}



/* BATCH8_PHASE3_HOTFIX7_V2_PREVIEW_MOTION */

.preview-topbar.motion-shimmer::after{
  inset:0;
  width:auto;
  height:auto;
  left:auto;
  border-radius:10px;
  transform:none;
  background:
    linear-gradient(
      110deg,
      transparent 0%,
      transparent 33%,
      rgba(255,255,255,.08) 41%,
      rgba(255,255,255,.48) 49%,
      rgba(255,255,255,.08) 57%,
      transparent 66%,
      transparent 100%
    );
  background-size:235% 100%;
  animation:
    preview-fullwidth-shimmer-v2
    2.7s linear infinite;
}

.preview-topbar.motion-gradient{
  background-size:300% 300%;
  animation:
    preview-fullwidth-gradient-v2
    4.8s ease infinite;
}

.preview-topbar.motion-pulse{
  animation:
    preview-fullwidth-pulse-v2
    1.75s ease-in-out infinite;
}

.preview-popup.motion-shimmer::after{
  background:
    linear-gradient(
      108deg,
      transparent 0%,
      transparent 35%,
      rgba(255,255,255,.72) 49%,
      rgba(126,102,224,.09) 56%,
      transparent 66%
    );
  background-size:235% 100%;
  animation:
    preview-popup-shimmer-v2
    2.8s linear infinite;
}

.preview-popup.motion-gradient{
  background:
    linear-gradient(
      135deg,
      #fff,
      #f5f0ff,
      #eef6ff,
      #fff4f8,
      #fff
    );
  background-size:300% 300%;
  animation:
    preview-popup-gradient-v2
    4.8s ease infinite;
}

.preview-popup.motion-pulse{
  animation:
    preview-popup-card-pulse-v2
    1.85s ease-in-out infinite;
}

@keyframes preview-fullwidth-shimmer-v2{
  0%{
    background-position:125% 0;
  }
  100%{
    background-position:-125% 0;
  }
}

@keyframes preview-fullwidth-gradient-v2{
  0%{
    background-position:0% 50%;
  }
  50%{
    background-position:100% 50%;
  }
  100%{
    background-position:0% 50%;
  }
}

@keyframes preview-fullwidth-pulse-v2{
  0%,
  100%{
    filter:brightness(1);
  }
  50%{
    filter:
      brightness(1.14)
      saturate(1.06);
  }
}

@keyframes preview-popup-shimmer-v2{
  0%{
    background-position:125% 0;
  }
  100%{
    background-position:-125% 0;
  }
}

@keyframes preview-popup-gradient-v2{
  0%{
    background-position:0% 45%;
  }
  50%{
    background-position:100% 55%;
  }
  100%{
    background-position:0% 45%;
  }
}

@keyframes preview-popup-card-pulse-v2{
  0%,
  100%{
    transform:scale(1);
    box-shadow:
      0 18px 46px
      rgba(35,35,57,.16);
  }
  50%{
    transform:scale(1.01);
    box-shadow:
      0 22px 56px
      rgba(79,61,166,.24);
  }
}



/* BATCH8_PHASE3_HOTFIX8_PREVIEW_SHIMMER */

.preview-topbar.motion-shimmer::after{
  content:"";
  position:absolute;
  z-index:2;
  top:0;
  bottom:0;
  left:-34%;
  right:auto;
  width:30%;
  height:auto;
  border-radius:0;
  transform:skewX(-18deg);
  pointer-events:none;
  background:
    linear-gradient(
      90deg,
      rgba(255,255,255,0) 0%,
      rgba(255,255,255,.08) 20%,
      rgba(255,255,255,.50) 50%,
      rgba(255,255,255,.08) 80%,
      rgba(255,255,255,0) 100%
    );
  animation:
    preview-shimmer-sweep-hotfix8
    2.4s cubic-bezier(.42,0,.58,1)
    infinite;
}

@keyframes preview-shimmer-sweep-hotfix8{
  0%{
    left:-34%;
    opacity:0;
  }
  10%{
    opacity:.95;
  }
  72%{
    opacity:.95;
  }
  88%{
    opacity:0;
  }
  100%{
    left:112%;
    opacity:0;
  }
}

</style>

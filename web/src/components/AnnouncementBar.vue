<script setup lang="ts">
// V14_4_2_TOPBAR_DIRECT_CLOSE
import {
  computed,
  onMounted,
  onUnmounted,
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
  TriangleAlert,
  X
} from "@lucide/vue";
import {
  apiRequest
} from "../api/client";
import AnnouncementRichText from "./AnnouncementRichText.vue";

// V14_3_1_2_ANNOUNCEMENT_RICH_TEXT

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
  updatedAt: string;
  endsAt?: string;
}

const announcements =
  ref<Announcement[]>([]);

const sessionDismissed =
  ref(
    new Set<string>()
  );

const todayDismissed =
  ref(
    new Set<string>()
  );

const closeMenuId =
  ref("");

const now =
  ref(Date.now());

let timer:
  number |
  undefined;

const visible =
  computed(() =>
    announcements.value.filter(
      (item) =>
        isStillActive(item) &&
        !sessionDismissed.value.has(
          dismissKey(item)
        ) &&
        !todayDismissed.value.has(
          dismissKey(item)
        )
    )
  );

const topbarItem =
  computed(() =>
    visible.value.find(
      (item) =>
        item.displayMode ===
          "topbar"
    )
  );

const popupItem =
  computed(() =>
    visible.value.find(
      (item) =>
        item.displayMode ===
          "popup"
    )
  );

onMounted(async () => {
  readDismissed();

  timer =
    window.setInterval(
      () => {
        now.value =
          Date.now();
      },
      1000
    );

  try {
    const data =
      await apiRequest<{
        announcements:
          Announcement[];
      }>(
        "/api/announcements/active"
      );

    announcements.value =
      data.announcements ||
      [];
  }
  catch {
    announcements.value =
      [];
  }
});

onUnmounted(() => {
  if (
    timer !== undefined
  ) {
    window.clearInterval(
      timer
    );
  }
});

function iconComponent(
  icon: AnnouncementIcon
) {
  if (icon === "gift") {
    return Gift;
  }

  if (
    icon === "sparkles"
  ) {
    return Sparkles;
  }

  if (icon === "bell") {
    return Bell;
  }

  if (icon === "info") {
    return Info;
  }

  if (
    icon === "warning"
  ) {
    return TriangleAlert;
  }

  if (icon === "rocket") {
    return Rocket;
  }

  if (icon === "clock") {
    return Clock3;
  }

  return Megaphone;
}

function dismissThisSession(
  item: Announcement
) {
  const key =
    dismissKey(item);

  const next =
    new Set(
      sessionDismissed.value
    );

  next.add(key);

  sessionDismissed.value =
    next;

  closeMenuId.value = "";

  try {
    window.sessionStorage
      .setItem(
        "ecom-ai-studio:announcement-dismiss-session",
        JSON.stringify(
          [...next]
        )
      );
  }
  catch {
    // 仅保留当前页面状态。
  }
}

function dismissToday(
  item: Announcement
) {
  const key =
    dismissKey(item);

  const next =
    new Set(
      todayDismissed.value
    );

  next.add(key);

  todayDismissed.value =
    next;

  closeMenuId.value = "";

  try {
    window.localStorage
      .setItem(
        todayStorageKey(),
        JSON.stringify(
          [...next]
        )
      );
  }
  catch {
    // 仅保留当前页面状态。
  }
}

function readDismissed() {
  try {
    const sessionValue =
      JSON.parse(
        window.sessionStorage
          .getItem(
            "ecom-ai-studio:announcement-dismiss-session"
          ) ||
        "[]"
      );

    sessionDismissed.value =
      new Set(
        Array.isArray(
          sessionValue
        )
          ? sessionValue.filter(
              (item) =>
                typeof item ===
                  "string"
            )
          : []
      );
  }
  catch {
    sessionDismissed.value =
      new Set();
  }

  try {
    const todayValue =
      JSON.parse(
        window.localStorage
          .getItem(
            todayStorageKey()
          ) ||
        "[]"
      );

    todayDismissed.value =
      new Set(
        Array.isArray(
          todayValue
        )
          ? todayValue.filter(
              (item) =>
                typeof item ===
                  "string"
            )
          : []
      );
  }
  catch {
    todayDismissed.value =
      new Set();
  }
}

function dismissKey(
  item: Announcement
): string {
  return [
    item.id,
    item.updatedAt
  ].join(":");
}

function todayStorageKey():
  string {
  const date =
    new Date();

  const day = [
    date.getFullYear(),
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    ),
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    )
  ].join("-");

  return (
    "ecom-ai-studio:announcement-dismiss-today:" +
    day
  );
}

function isStillActive(
  item: Announcement
): boolean {
  if (!item.endsAt) {
    return true;
  }

  const end =
    new Date(
      item.endsAt
    ).getTime();

  return (
    Number.isFinite(end) &&
    end > now.value
  );
}

function countdownText(
  item: Announcement
): string {
  if (
    !item.countdownEnabled ||
    !item.endsAt
  ) {
    return "";
  }

  const diff =
    Math.max(
      0,
      new Date(
        item.endsAt
      ).getTime() -
      now.value
    );

  const totalSeconds =
    Math.floor(
      diff / 1000
    );

  const days =
    Math.floor(
      totalSeconds /
      86400
    );

  const hours =
    Math.floor(
      (
        totalSeconds %
        86400
      ) /
      3600
    );

  const minutes =
    Math.floor(
      (
        totalSeconds %
        3600
      ) /
      60
    );

  const seconds =
    totalSeconds % 60;

  if (days > 0) {
    return (
      `${days}天 ` +
      `${pad(hours)}:` +
      `${pad(minutes)}:` +
      `${pad(seconds)}`
    );
  }

  return (
    `${pad(hours)}:` +
    `${pad(minutes)}:` +
    `${pad(seconds)}`
  );
}

function pad(
  value: number
): string {
  return String(value)
    .padStart(
      2,
      "0"
    );
}

function openLink(
  item: Announcement
) {
  if (!item.linkUrl) {
    return;
  }

  if (
    item.linkUrl
      .startsWith("/")
  ) {
    window.location.href =
      item.linkUrl;

    return;
  }

  window.open(
    item.linkUrl,
    "_blank",
    "noopener,noreferrer"
  );
}

</script>

<template>
  <div
    v-if="topbarItem"
    class="announcement-topbar-wrap"
    :class="[
      topbarItem.kind,
      `motion-${topbarItem.motion}`
    ]"
  >
    <article class="announcement-topbar">
      <div class="announcement-topbar-left">
        <div
          v-if="
            topbarItem.countdownEnabled &&
            topbarItem.endsAt
          "
          class="announcement-countdown compact"
        >
          <Clock3
            :size="12"
            :stroke-width="2.2"
          />
          <b>
            {{
              countdownText(
                topbarItem
              )
            }}
          </b>
        </div>

        <div class="announcement-topbar-icon">
          <component
            :is="
              iconComponent(
                topbarItem.icon
              )
            "
            :size="14"
            :stroke-width="2.2"
          />
        </div>

        <strong class="announcement-topbar-title">
          {{ topbarItem.title }}
        </strong>

        <button
          v-if="topbarItem.linkUrl"
          type="button"
          class="announcement-link-button"
          @click="
            openLink(
              topbarItem
            )
          "
        >
          {{
            topbarItem.linkText ||
            "查看详情"
          }}
          <span>→</span>
        </button>
      </div>

      <div class="announcement-close-wrap">
        <button
          type="button"
          class="announcement-close-button"
          aria-label="关闭公告"
          @click="
            dismissThisSession(
              topbarItem
            )
          "
        >
          <X
            :size="14"
            :stroke-width="2.2"
          />
        </button>
      </div>
    </article>
  </div>

  <div
    v-if="popupItem"
    class="announcement-popup-backdrop"
    role="presentation"
  >
    <article
      class="announcement-popup"
      :class="[
        popupItem.kind,
        `motion-${popupItem.motion}`
      ]"
      role="dialog"
      aria-modal="true"
      aria-label="站点公告"
    >
      <div class="announcement-popup-accent"></div>

      <header class="announcement-popup-head">
        <div class="announcement-popup-icon">
          <component
            :is="
              iconComponent(
                popupItem.icon
              )
            "
            :size="22"
            :stroke-width="2.1"
          />
        </div>

        <div class="announcement-popup-headcopy">
          <span class="announcement-popup-label">
            {{
              popupItem.kind ===
                "warning"
                ? "重要提醒"
                : popupItem.kind ===
                    "success"
                  ? "活动公告"
                  : "站点公告"
            }}
          </span>

          <h2>
            {{ popupItem.title }}
          </h2>
        </div>
      </header>

      <section
        class="announcement-popup-content"
        tabindex="0"
        aria-label="公告正文，可滚动查看完整内容"
      >
        <AnnouncementRichText
          :content="popupItem.content"
        />
      </section>

      <div
        v-if="
          (
            popupItem.countdownEnabled &&
            popupItem.endsAt
          ) ||
          popupItem.linkUrl
        "
        class="announcement-popup-meta"
      >
        <div
          v-if="
            popupItem.countdownEnabled &&
            popupItem.endsAt
          "
          class="announcement-popup-countdown"
        >
          <Clock3
            :size="13"
            :stroke-width="2"
          />
          <span>剩余</span>
          <strong>
            {{
              countdownText(
                popupItem
              )
            }}
          </strong>
        </div>

        <button
          v-if="popupItem.linkUrl"
          type="button"
          class="announcement-popup-link"
          @click="
            openLink(
              popupItem
            )
          "
        >
          {{
            popupItem.linkText ||
            "查看详情"
          }}
          <span>→</span>
        </button>
      </div>

      <footer class="announcement-popup-footer">
        <button
          type="button"
          class="secondary"
          @click="
            dismissThisSession(
              popupItem
            )
          "
        >
          本次不提醒
        </button>

        <button
          type="button"
          class="primary"
          @click="
            dismissToday(
              popupItem
            )
          "
        >
          今日不再提醒
        </button>
      </footer>
    </article>
  </div>
</template>

<style scoped>
/* Hotfix6 — 顶部运营横幅：更接近参考站点的高识别促销条 */
.announcement-topbar-wrap{
  position:relative;
  z-index:12;
  width:100%;
  overflow:hidden;
  border-bottom:1px solid rgba(255,255,255,.26);
  background:
    radial-gradient(circle at 18% -50%,rgba(255,255,255,.18),transparent 42%),
    linear-gradient(92deg,#7258e6 0%,#6659e8 36%,#536fe8 72%,#4b7be8 100%);
  color:#fff;
  box-shadow:0 4px 16px rgba(75,69,159,.10);
}

.announcement-topbar-wrap.warning{
  background:
    radial-gradient(circle at 18% -50%,rgba(255,255,255,.22),transparent 42%),
    linear-gradient(92deg,#ffa32f 0%,#ff8851 37%,#ff6f6f 70%,#fa5e8c 100%);
}

.announcement-topbar-wrap.success{
  background:
    radial-gradient(circle at 18% -50%,rgba(255,255,255,.18),transparent 42%),
    linear-gradient(92deg,#22b679 0%,#2eb59f 42%,#3e9cc5 73%,#557fe0 100%);
}

.announcement-topbar-wrap::before,
.announcement-topbar-wrap::after{
  content:"";
  position:absolute;
  pointer-events:none;
  border-radius:999px;
  filter:blur(.1px);
}

.announcement-topbar-wrap::before{
  top:-18px;
  left:9%;
  width:90px;
  height:42px;
  background:rgba(255,255,255,.08);
  transform:rotate(-12deg);
}

.announcement-topbar-wrap::after{
  right:16%;
  bottom:-22px;
  width:120px;
  height:48px;
  background:rgba(255,255,255,.055);
  transform:rotate(8deg);
}

.announcement-topbar-wrap.motion-gradient{
  background-size:240% 240%;
  animation:announcement-gradient 6s ease infinite;
}

.announcement-topbar-wrap.motion-shimmer{
  background-size:100% 100%;
}

.announcement-topbar-wrap.motion-shimmer .announcement-topbar::after{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  background:
    linear-gradient(
      112deg,
      transparent 0%,
      transparent 36%,
      rgba(255,255,255,.06) 43%,
      rgba(255,255,255,.36) 50%,
      rgba(255,255,255,.06) 57%,
      transparent 64%,
      transparent 100%
    );
  background-size:230% 100%;
  animation:announcement-shimmer-bar 3s linear infinite;
}

.announcement-topbar-wrap.motion-pulse{
  animation:announcement-strip-pulse 2s ease-in-out infinite;
}

.announcement-topbar{
  position:relative;
  z-index:2;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  width:min(1500px,calc(100% - 34px));
  min-height:46px;
  margin:0 auto;
  padding:0 2px;
}

.announcement-topbar-left{
  position:relative;
  z-index:2;
  display:flex;
  align-items:center;
  min-width:0;
  gap:9px;
}

.announcement-countdown.compact{
  display:inline-flex;
  align-items:center;
  gap:5px;
  height:30px;
  box-sizing:border-box;
  padding:0 9px;
  border:1px solid rgba(255,255,255,.64);
  border-radius:8px;
  background:rgba(255,255,255,.16);
  color:#fff;
  font-size:10px;
  font-variant-numeric:tabular-nums;
  font-weight:800;
  white-space:nowrap;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12);
  backdrop-filter:blur(7px);
}

.announcement-countdown.compact b{
  color:#fff;
  font-size:10.5px;
  font-weight:900;
  letter-spacing:.045em;
  text-shadow:0 1px 3px rgba(30,25,80,.18);
}

.announcement-topbar-icon{
  display:grid;
  place-items:center;
  flex:0 0 29px;
  width:29px;
  height:29px;
  border:1px solid rgba(255,255,255,.22);
  border-radius:8px;
  background:rgba(255,255,255,.18);
  color:#fff;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.12),
    0 4px 12px rgba(35,30,90,.08);
}

.announcement-topbar-title{
  overflow:hidden;
  max-width:760px;
  color:#fff;
  font-size:12.5px;
  font-weight:900;
  line-height:1.1;
  letter-spacing:.005em;
  text-overflow:ellipsis;
  text-shadow:0 1px 3px rgba(25,22,74,.20);
  white-space:nowrap;
}

.announcement-link-button{
  display:inline-flex;
  align-items:center;
  gap:4px;
  min-height:29px;
  padding:0 10px;
  border:1px solid rgba(255,255,255,.72);
  border-radius:8px;
  background:#fff;
  color:#5541ae;
  font:inherit;
  font-size:10px;
  font-weight:900;
  cursor:pointer;
  white-space:nowrap;
  box-shadow:
    0 4px 13px rgba(37,27,92,.14),
    inset 0 1px 0 rgba(255,255,255,.9);
  transition:
    transform .15s ease,
    box-shadow .15s ease;
}

.announcement-topbar-wrap.warning .announcement-link-button{
  color:#a44328;
}

.announcement-topbar-wrap.success .announcement-link-button{
  color:#236d55;
}

.announcement-link-button:hover{
  transform:translateY(-1px);
  box-shadow:0 6px 16px rgba(37,27,92,.18);
}

.announcement-link-button span{
  font-size:11px;
  transition:transform .15s ease;
}

.announcement-link-button:hover span{
  transform:translateX(2px);
}

.announcement-close-wrap{
  position:relative;
  z-index:3;
  flex:0 0 auto;
}

.announcement-close-button{
  display:grid;
  place-items:center;
  width:29px;
  height:29px;
  padding:0;
  border:0;
  border-radius:8px;
  background:transparent;
  color:rgba(255,255,255,.86);
  cursor:pointer;
}

.announcement-close-button:hover{
  background:rgba(255,255,255,.14);
  color:#fff;
}

.announcement-close-menu{
  position:absolute;
  z-index:90;
  top:35px;
  right:0;
  display:grid;
  width:130px;
  padding:5px;
  border:1px solid #e0e2e9;
  border-radius:10px;
  background:#fff;
  box-shadow:0 14px 34px rgba(34,37,53,.14);
}

.announcement-close-menu button{
  min-height:32px;
  padding:0 9px;
  border:0;
  border-radius:7px;
  background:transparent;
  color:#616675;
  font:inherit;
  font-size:10px;
  text-align:left;
  cursor:pointer;
}

.announcement-close-menu button:hover{
  background:#f5f3fc;
  color:#5947b7;
}

/* 首页弹窗整体放大：正文优先，辅助信息退居其次 */
.announcement-popup-backdrop{
  position:fixed;
  z-index:120;
  inset:0;
  display:grid;
  place-items:center;
  padding:24px;
  background:rgba(24,27,38,.40);
  backdrop-filter:blur(10px);
}

.announcement-popup{
  position:relative;
  width:min(660px,calc(100vw - 40px));
  box-sizing:border-box;
  overflow:hidden;
  padding:0;
  border:1px solid rgba(221,217,237,.97);
  border-radius:24px;
  background:
    radial-gradient(circle at 92% 4%,rgba(109,86,213,.065),transparent 28%),
    linear-gradient(180deg,#fff 0%,#fbfbfe 100%);
  box-shadow:
    0 38px 100px rgba(31,31,52,.29),
    0 5px 18px rgba(31,31,52,.09);
}

.announcement-popup-accent{
  height:5px;
  background:linear-gradient(90deg,#6b57d7,#9a83f6,#6b57d7);
}

.announcement-popup.warning .announcement-popup-accent{
  background:linear-gradient(90deg,#e2a343,#f0bd68,#df9140);
}

.announcement-popup.success .announcement-popup-accent{
  background:linear-gradient(90deg,#2f8a5d,#54bd83,#2f8a5d);
}

.announcement-popup-head{
  display:grid;
  grid-template-columns:auto minmax(0,1fr);
  align-items:center;
  gap:16px;
  padding:30px 34px 17px;
}

.announcement-popup-icon{
  display:grid;
  place-items:center;
  width:54px;
  height:54px;
  border-radius:16px;
  background:linear-gradient(135deg,#6551cf,#8b73ef);
  color:#fff;
  box-shadow:0 12px 28px rgba(101,81,207,.20);
}

.announcement-popup.warning .announcement-popup-icon{
  background:linear-gradient(135deg,#d89437,#ebb15a);
}

.announcement-popup.success .announcement-popup-icon{
  background:linear-gradient(135deg,#2d885a,#4db67b);
}

.announcement-popup-headcopy{
  min-width:0;
  text-align:left;
}

.announcement-popup-label{
  display:block;
  margin-bottom:5px;
  color:#7161b8;
  font-size:10.5px;
  font-weight:900;
  letter-spacing:.07em;
}

.announcement-popup.warning .announcement-popup-label{
  color:#a86e24;
}

.announcement-popup.success .announcement-popup-label{
  color:#2e8057;
}

.announcement-popup h2{
  margin:0;
  color:#2b2f3d;
  font-size:29px;
  font-weight:900;
  line-height:1.22;
  letter-spacing:-.025em;
}

.announcement-popup-content{
  margin:0 34px;
  padding:21px 22px;
  border:1px solid #e9eaf0;
  border-radius:15px;
  background:#f8f8fb;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9);
}

.announcement-popup-content p{
  margin:0;
  color:#484e5e;
  font-size:15px;
  font-weight:550;
  line-height:1.85;
  text-align:left;
  white-space:pre-wrap;
}

.announcement-popup-meta{
  display:flex;
  align-items:center;
  gap:9px;
  min-height:35px;
  margin:15px 34px 0;
}

.announcement-popup-countdown{
  display:inline-flex;
  align-items:center;
  gap:6px;
  height:31px;
  box-sizing:border-box;
  padding:0 10px;
  border:1px solid #e2def2;
  border-radius:9px;
  background:#faf9fe;
  color:#878b99;
  font-size:9.5px;
}

.announcement-popup-countdown strong{
  color:#6654bd;
  font-size:10.5px;
  font-variant-numeric:tabular-nums;
}

.announcement-popup-link{
  display:inline-flex;
  align-items:center;
  gap:4px;
  min-height:31px;
  padding:0 10px;
  border:0;
  border-radius:9px;
  background:transparent;
  color:#5d4bb7;
  font:inherit;
  font-size:10.5px;
  font-weight:850;
  cursor:pointer;
}

.announcement-popup-link:hover{
  background:#f2f0fa;
}

.announcement-popup-footer{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:11px;
  margin-top:22px;
  padding:18px 34px 30px;
  border-top:1px solid #eceef3;
}

.announcement-popup-footer button{
  min-height:46px;
  border-radius:11px;
  font:inherit;
  font-size:12px;
  font-weight:850;
  cursor:pointer;
}

.announcement-popup-footer .secondary{
  border:1px solid #daddE6;
  background:#fff;
  color:#555b6b;
}

.announcement-popup-footer .primary{
  border:1px solid #cbc4ef;
  background:#eeeafd;
  color:#5644b3;
}

.announcement-popup-footer .secondary:hover{
  background:#f8f8fa;
}

.announcement-popup-footer .primary:hover{
  background:#e5e0fa;
  border-color:#bdb4e8;
}

.announcement-popup.motion-gradient{
  background:
    linear-gradient(
      135deg,
      #fff,
      #f8f4ff,
      #f2f8ff,
      #fff
    );
  background-size:260% 260%;
  animation:announcement-gradient 5.5s ease infinite;
}

.announcement-popup.motion-shimmer::after{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  background:
    linear-gradient(
      105deg,
      transparent 0%,
      transparent 39%,
      rgba(255,255,255,.70) 49%,
      transparent 59%,
      transparent 100%
    );
  background-size:230% 100%;
  animation:announcement-shimmer-bar 3.2s linear infinite;
}

.announcement-popup.motion-pulse .announcement-popup-icon{
  animation:announcement-popup-pulse 1.9s ease-in-out infinite;
}

@keyframes announcement-shimmer-bar{
  0%{background-position:120% 0}
  100%{background-position:-120% 0}
}

@keyframes announcement-strip-pulse{
  0%,100%{
    filter:brightness(1);
    box-shadow:0 4px 16px rgba(75,69,159,.10);
  }
  50%{
    filter:brightness(1.09);
    box-shadow:0 6px 20px rgba(75,69,159,.16);
  }
}

@keyframes announcement-popup-pulse{
  0%,100%{
    transform:scale(1);
    box-shadow:0 12px 28px rgba(101,81,207,.20);
  }
  50%{
    transform:scale(1.06);
    box-shadow:0 16px 34px rgba(101,81,207,.28);
  }
}

@keyframes announcement-gradient{
  0%{background-position:0% 50%}
  50%{background-position:100% 50%}
  100%{background-position:0% 50%}
}

@media(max-width:840px){
  .announcement-topbar{
    min-height:50px;
  }

  .announcement-topbar-left{
    flex-wrap:wrap;
    padding:5px 0;
  }

  .announcement-topbar-title{
    max-width:56vw;
  }
}

@media(max-width:640px){
  .announcement-topbar{
    width:calc(100% - 18px);
  }

  .announcement-countdown.compact{
    order:3;
  }

  .announcement-topbar-title{
    max-width:45vw;
    font-size:11.5px;
  }

  .announcement-popup{
    width:min(660px,calc(100vw - 24px));
  }

  .announcement-popup-head{
    padding:24px 20px 14px;
  }

  .announcement-popup h2{
    font-size:24px;
  }

  .announcement-popup-content{
    margin:0 20px;
    padding:17px;
  }

  .announcement-popup-content p{
    font-size:13.5px;
  }

  .announcement-popup-meta{
    margin:13px 20px 0;
    flex-wrap:wrap;
  }

  .announcement-popup-footer{
    grid-template-columns:1fr;
    padding:15px 20px 22px;
  }
}


/* BATCH8_PHASE3_HOTFIX7_V2_MOTION_CLOSE */

/* 顶部公告：动态作用整个通栏 */
.announcement-topbar-wrap.motion-shimmer::after{
  content:"";
  position:absolute;
  z-index:1;
  inset:0;
  width:auto;
  height:auto;
  right:auto;
  bottom:auto;
  border-radius:0;
  transform:none;
  filter:none;
  pointer-events:none;
  background:
    linear-gradient(
      112deg,
      transparent 0%,
      transparent 31%,
      rgba(255,255,255,.04) 39%,
      rgba(255,255,255,.34) 48%,
      rgba(255,255,255,.10) 54%,
      transparent 64%,
      transparent 100%
    );
  background-size:240% 100%;
  animation:
    announcement-fullwidth-shimmer-v2
    2.7s linear infinite;
}

.announcement-topbar-wrap.motion-shimmer
.announcement-topbar::after{
  display:none;
}

.announcement-topbar-wrap.motion-gradient{
  background-size:300% 300%;
  animation:
    announcement-fullwidth-gradient-v2
    4.8s ease infinite;
}

.announcement-topbar-wrap.motion-pulse{
  animation:
    announcement-fullwidth-pulse-v2
    1.75s ease-in-out infinite;
}

/* 首页弹窗：整卡动态加强 */
.announcement-popup.motion-shimmer::after{
  z-index:3;
  background:
    linear-gradient(
      108deg,
      transparent 0%,
      transparent 34%,
      rgba(255,255,255,.08) 41%,
      rgba(255,255,255,.76) 49%,
      rgba(132,108,232,.10) 55%,
      transparent 65%,
      transparent 100%
    );
  background-size:235% 100%;
  animation:
    announcement-popup-shimmer-v2
    2.8s linear infinite;
}

.announcement-popup.motion-gradient{
  background:
    linear-gradient(
      135deg,
      #ffffff 0%,
      #f5f0ff 24%,
      #eef6ff 48%,
      #fff4f8 72%,
      #ffffff 100%
    );
  background-size:320% 320%;
  animation:
    announcement-popup-gradient-v2
    4.8s ease infinite;
}

.announcement-popup.motion-pulse{
  animation:
    announcement-popup-card-pulse-v2
    1.85s ease-in-out infinite;
}

.announcement-popup.motion-pulse
.announcement-popup-icon{
  animation:
    announcement-popup-icon-pulse-v2
    1.85s ease-in-out infinite;
}

/* 顶部公告关闭按钮：玻璃拟态小胶囊，更显眼但不抢主内容 */
.announcement-close-wrap{
  position:relative;
  z-index:4;
  flex:0 0 auto;
  padding-left:8px;
}

.announcement-close-wrap::before{
  content:"";
  position:absolute;
  left:0;
  top:50%;
  width:1px;
  height:20px;
  transform:translateY(-50%);
  background:rgba(255,255,255,.24);
}

.announcement-close-button{
  position:relative;
  display:grid;
  place-items:center;
  width:34px;
  height:30px;
  padding:0;
  border:1px solid rgba(255,255,255,.42);
  border-radius:10px;
  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,.20),
      rgba(255,255,255,.10)
    );
  color:#fff;
  cursor:pointer;
  box-shadow:
    inset 0 1px 0
    rgba(255,255,255,.24),
    0 4px 14px
    rgba(30,24,86,.12);
  backdrop-filter:blur(10px);
  transition:
    transform .16s ease,
    background .16s ease,
    border-color .16s ease,
    box-shadow .16s ease;
}

.announcement-close-button::after{
  content:"关闭";
  position:absolute;
  right:42px;
  top:50%;
  transform:
    translateY(-50%)
    translateX(4px);
  padding:5px 7px;
  border:1px solid
    rgba(255,255,255,.22);
  border-radius:7px;
  background:
    rgba(33,29,75,.72);
  color:#fff;
  font-size:9px;
  font-weight:800;
  white-space:nowrap;
  box-shadow:
    0 6px 18px
    rgba(26,22,70,.18);
  opacity:0;
  pointer-events:none;
  transition:
    opacity .15s ease,
    transform .15s ease;
}

.announcement-close-button:hover{
  transform:translateY(-1px);
  border-color:
    rgba(255,255,255,.70);
  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,.29),
      rgba(255,255,255,.16)
    );
  box-shadow:
    inset 0 1px 0
    rgba(255,255,255,.32),
    0 7px 18px
    rgba(30,24,86,.18);
}

.announcement-close-button:hover::after{
  opacity:1;
  transform:
    translateY(-50%)
    translateX(0);
}

.announcement-close-button:active{
  transform:
    translateY(0)
    scale(.96);
}

.announcement-close-button svg{
  filter:
    drop-shadow(
      0 1px 2px
      rgba(24,20,66,.22)
    );
  transition:
    transform .18s ease;
}

.announcement-close-button:hover svg{
  transform:rotate(90deg);
}

.announcement-close-menu{
  top:37px;
  right:0;
  width:142px;
  padding:6px;
  border:1px solid
    rgba(222,224,235,.96);
  border-radius:12px;
  background:
    rgba(255,255,255,.97);
  box-shadow:
    0 16px 38px
    rgba(31,34,51,.17);
  backdrop-filter:blur(14px);
}

.announcement-close-menu button{
  min-height:34px;
  padding:0 10px;
  border-radius:8px;
  color:#5b6070;
  font-size:10px;
  font-weight:750;
}

.announcement-close-menu button:hover{
  background:#f3f0fc;
  color:#5643b5;
}

@keyframes announcement-fullwidth-shimmer-v2{
  0%{
    background-position:125% 0;
  }
  100%{
    background-position:-125% 0;
  }
}

@keyframes announcement-fullwidth-gradient-v2{
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

@keyframes announcement-fullwidth-pulse-v2{
  0%,
  100%{
    filter:brightness(1);
    box-shadow:
      0 4px 16px
      rgba(75,69,159,.10);
  }
  50%{
    filter:
      brightness(1.14)
      saturate(1.06);
    box-shadow:
      0 7px 24px
      rgba(75,69,159,.20);
  }
}

@keyframes announcement-popup-shimmer-v2{
  0%{
    background-position:125% 0;
  }
  100%{
    background-position:-125% 0;
  }
}

@keyframes announcement-popup-gradient-v2{
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

@keyframes announcement-popup-card-pulse-v2{
  0%,
  100%{
    transform:scale(1);
    box-shadow:
      0 38px 100px
      rgba(31,31,52,.29),
      0 5px 18px
      rgba(31,31,52,.09);
  }
  50%{
    transform:scale(1.008);
    box-shadow:
      0 43px 112px
      rgba(64,49,137,.34),
      0 7px 24px
      rgba(101,81,207,.16);
  }
}

@keyframes announcement-popup-icon-pulse-v2{
  0%,
  100%{
    transform:scale(1);
  }
  50%{
    transform:scale(1.075);
  }
}



/* BATCH8_PHASE3_HOTFIX8_SHIMMER_SWEEP */

/*
 * Hotfix8:
 * Hotfix7-v2 中 shimmer 层先写 inset:0，
 * 后面又写 right:auto / bottom:auto / width:auto / height:auto，
 * 导致空 pseudo-element 实际可视面积塌缩，流光几乎看不到。
 *
 * 这里改成“真实光带从整条通栏左侧扫到右侧”，
 * 不再依赖 background-position。
 */
.announcement-topbar-wrap.motion-shimmer::after{
  content:"";
  position:absolute;
  z-index:1;
  top:0;
  bottom:0;
  left:-34%;
  right:auto;
  width:30%;
  height:auto;
  border-radius:0;
  transform:skewX(-18deg);
  filter:none;
  pointer-events:none;
  opacity:1;
  background:
    linear-gradient(
      90deg,
      rgba(255,255,255,0) 0%,
      rgba(255,255,255,.05) 18%,
      rgba(255,255,255,.22) 38%,
      rgba(255,255,255,.70) 50%,
      rgba(255,255,255,.22) 62%,
      rgba(255,255,255,.05) 82%,
      rgba(255,255,255,0) 100%
    );
  box-shadow:
    0 0 24px
    rgba(255,255,255,.08);
  animation:
    announcement-shimmer-sweep-hotfix8
    2.4s cubic-bezier(.42,0,.58,1)
    infinite;
}

.announcement-topbar-wrap.motion-shimmer
.announcement-topbar::after{
  display:none !important;
}

@keyframes announcement-shimmer-sweep-hotfix8{
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


<style scoped>
/* V14_3_1_2_POPUP_RICH_STYLE */
.announcement-popup-content :deep(.announcement-rich-text){color:#484e5e;font-size:15px;font-weight:550;line-height:1.85;text-align:left}
.announcement-popup-content :deep(.announcement-rich-text h3),.announcement-popup-content :deep(.announcement-rich-text h4),.announcement-popup-content :deep(.announcement-rich-text h5){color:#343949}
.announcement-popup-content :deep(.announcement-rich-text a){color:#6654bd}
</style>


<style scoped>
/* V14_4_1_ANNOUNCEMENT_SCROLL_OPTIMIZATION */
.announcement-popup{
  display:flex;
  flex-direction:column;
  max-height:calc(100vh - 48px);
  max-height:calc(100dvh - 48px);
}

.announcement-popup-accent,
.announcement-popup-head,
.announcement-popup-meta,
.announcement-popup-footer{
  flex:0 0 auto;
}

.announcement-popup-content{
  flex:1 1 auto;
  min-height:0;
  max-height:min(310px,38vh);
  max-height:min(310px,38dvh);
  overflow-y:auto;
  overflow-x:hidden;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
  scrollbar-width:thin;
  scrollbar-color:#c9c3e5 transparent;
}

.announcement-popup-content::-webkit-scrollbar{
  width:6px;
}

.announcement-popup-content::-webkit-scrollbar-track{
  background:transparent;
}

.announcement-popup-content::-webkit-scrollbar-thumb{
  border-radius:999px;
  background:#c9c3e5;
}

.announcement-popup-content::-webkit-scrollbar-thumb:hover{
  background:#aaa1d7;
}

.announcement-popup-content:focus{
  outline:none;
}

.announcement-popup-content:focus-visible{
  border-color:#cbc4ed;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.9),
    0 0 0 3px rgba(105,84,190,.08);
}

@media(max-width:640px){
  .announcement-popup{
    max-height:calc(100vh - 24px);
    max-height:calc(100dvh - 24px);
  }

  .announcement-popup-content{
    max-height:min(260px,36vh);
    max-height:min(260px,36dvh);
  }
}
</style>


<style scoped>
/* V14_4_1_1_ANNOUNCEMENT_EMPTY_META_FIX */
.announcement-popup-content + .announcement-popup-footer{
  margin-top:14px;
}
</style>

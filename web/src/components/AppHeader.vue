<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  watch
} from "vue";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Shield,
  Sparkles
} from "@lucide/vue";
import type {
  AuthUser,
  SiteMessage
} from "../types";
import {
  apiRequest
} from "../api/client";
import {
  formatDate,
  formatPoints
} from "../utils/format";

const props = defineProps<{
  authReady: boolean;
  user: AuthUser | null;
}>();

const emit = defineEmits<{
  login: [];
  register: [];
  openUser: [];
  openAdmin: [];
  logout: [];
}>();

const recentMessages =
  ref<SiteMessage[]>([]);

const unreadCount =
  ref(0);

const messageMenuOpen =
  ref(false);

const accountMenuOpen =
  ref(false);

const toastVisible =
  ref(false);

let pollTimer:
  number |
  undefined;

let lastUnreadCount = 0;

const unreadMessages =
  computed(() =>
    recentMessages.value.filter(
      (item) => !item.read
    )
  );

const latestUnread =
  computed(() =>
    unreadMessages.value[0]
  );

const accountLabel =
  computed(() =>
    props.user?.nickname ||
    props.user?.username ||
    ""
  );

watch(
  () => props.user?.id,
  async (userId) => {
    stopPolling();
    recentMessages.value = [];
    unreadCount.value = 0;
    lastUnreadCount = 0;
    toastVisible.value = false;
    messageMenuOpen.value = false;
    accountMenuOpen.value = false;

    if (userId) {
      await refreshMessages(true);
      startPolling();
    }
  }
);

onMounted(() => {
  window.addEventListener(
    "focus",
    handleWindowFocus
  );

  window.addEventListener(
    "keydown",
    handleGlobalKeydown
  );

  document.addEventListener(
    "click",
    closeMenus
  );

  if (props.user) {
    void refreshMessages(true);
    startPolling();
  }
});

onUnmounted(() => {
  stopPolling();

  window.removeEventListener(
    "focus",
    handleWindowFocus
  );

  window.removeEventListener(
    "keydown",
    handleGlobalKeydown
  );

  document.removeEventListener(
    "click",
    closeMenus
  );
});

async function refreshMessages(
  announce = false
) {
  if (!props.user) return;

  try {
    const data =
      await apiRequest<{
        messages: SiteMessage[];
        summary: {
          total: number;
          unread: number;
        };
      }>(
        "/api/account/messages?limit=8"
      );

    recentMessages.value =
      data.messages || [];

    const nextUnread =
      data.summary?.unread || 0;

    if (
      nextUnread > 0 &&
      (
        announce ||
        nextUnread >
          lastUnreadCount
      )
    ) {
      toastVisible.value = true;
    }

    unreadCount.value =
      nextUnread;

    lastUnreadCount =
      nextUnread;
  } catch {
    // 消息提醒失败不影响创作工作台。
  }
}

function startPolling() {
  stopPolling();

  pollTimer =
    window.setInterval(
      () => {
        void refreshMessages();
      },
      45_000
    );
}

function stopPolling() {
  if (
    pollTimer !== undefined
  ) {
    window.clearInterval(
      pollTimer
    );

    pollTimer = undefined;
  }
}

function handleWindowFocus() {
  if (props.user) {
    void refreshMessages();
  }
}

function handleGlobalKeydown(
  event: KeyboardEvent
) {
  if (event.key === "Escape") {
    closeMenus();
  }
}

function closeMenus() {
  messageMenuOpen.value = false;
  accountMenuOpen.value = false;
}

function toggleMessageMenu() {
  messageMenuOpen.value =
    !messageMenuOpen.value;

  accountMenuOpen.value = false;

  if (messageMenuOpen.value) {
    toastVisible.value = false;
    void refreshMessages();
  }
}

function toggleAccountMenu() {
  accountMenuOpen.value =
    !accountMenuOpen.value;

  messageMenuOpen.value = false;
}

function openMessageCenter() {
  toastVisible.value = false;
  closeMenus();

  window.location.href =
    "/account?tab=messages";
}

function openUserPage() {
  closeMenus();
  emit("openUser");
}

function openAdminPage() {
  closeMenus();
  emit("openAdmin");
}

function openGallery() {
  closeMenus();
  window.location.href = "/gallery";
}

function open517Zhe() {
  closeMenus();

  window.open(
    "https://517zhe.com/",
    "_blank",
    "noopener,noreferrer"
  );
}

function logout() {
  closeMenus();
  emit("logout");
}

function kindLabel(
  kind:
    SiteMessage["kind"]
) {
  if (
    kind === "warning"
  ) {
    return "重要提醒";
  }

  if (
    kind === "success"
  ) {
    return "好消息";
  }

  return "站内通知";
}
</script>

<template>
  <header class="topbar">
    <a
      class="brand"
      href="#"
      aria-label="ZHE AI Studio 首页"
    >
      <span class="brand-mark">
        <span></span>
        <span></span>
      </span>

      <span>
        <strong>ZHE AI</strong>
        <small>STUDIO</small>
      </span>
    </a>

    <div class="topbar-center">
      <span class="live-dot"></span>
      ZHE AI 双引擎电商视觉工作台
    </div>

    <div class="topbar-actions header-v32-actions">
      <template v-if="props.authReady">
        <template v-if="props.user">
          <div
            class="header-v32-popover-wrap"
            @click.stop
          >
            <button
              type="button"
              class="header-v32-icon-trigger"
              :class="{
                active:
                  messageMenuOpen
              }"
              aria-label="站内消息"
              title="站内消息"
              @click="toggleMessageMenu"
            >
              <Bell
                :size="19"
                :stroke-width="1.8"
                aria-hidden="true"
              />

              <span
                v-if="unreadCount > 0"
                class="header-v32-unread"
              >
                {{
                  unreadCount > 9
                    ? "9+"
                    : unreadCount
                }}
              </span>
            </button>

            <transition name="header-v32-menu">
              <section
                v-if="messageMenuOpen"
                class="header-v32-message-menu"
              >
                <header>
                  <div>
                    <strong>消息中心</strong>
                    <small>
                      {{
                        unreadCount > 0
                          ? `${unreadCount} 条未读消息`
                          : "暂无未读消息"
                      }}
                    </small>
                  </div>

                  <button
                    type="button"
                    @click="openMessageCenter"
                  >
                    查看全部
                  </button>
                </header>

                <div
                  v-if="
                    unreadMessages.length
                  "
                  class="header-v32-message-list"
                >
                  <button
                    v-for="item in unreadMessages.slice(0, 3)"
                    :key="item.id"
                    type="button"
                    @click="openMessageCenter"
                  >
                    <span
                      class="header-v32-message-icon"
                      :class="item.kind"
                    >
                      <MessageSquareText
                        v-if="item.kind === 'info'"
                        :size="17"
                        :stroke-width="1.8"
                      />

                      <Sparkles
                        v-else-if="item.kind === 'success'"
                        :size="17"
                        :stroke-width="1.8"
                      />

                      <Bell
                        v-else
                        :size="17"
                        :stroke-width="1.8"
                      />
                    </span>

                    <div>
                      <div class="header-v32-message-title">
                        <strong>
                          {{ item.title }}
                        </strong>

                        <span>
                          {{
                            kindLabel(
                              item.kind
                            )
                          }}
                        </span>
                      </div>

                      <p>
                        {{ item.content }}
                      </p>

                      <time>
                        {{
                          formatDate(
                            item.createdAt
                          )
                        }}
                      </time>
                    </div>
                  </button>
                </div>

                <div
                  v-else
                  class="header-v32-message-empty"
                >
                  <span>
                    <Check
                      :size="20"
                      :stroke-width="1.9"
                    />
                  </span>

                  <strong>
                    消息已全部读完
                  </strong>

                  <p>
                    新消息会在这里第一时间提醒你。
                  </p>
                </div>
              </section>
            </transition>
          </div>

          <button
            type="button"
            class="header-v32-gallery-trigger"
            title="灵感广场"
            @click="openGallery"
          >
            <Sparkles
              :size="17"
              :stroke-width="1.8"
              aria-hidden="true"
            />

            <span>灵感广场</span>
          </button>

          <div
            class="header-v32-popover-wrap"
            @click.stop
          >
            <button
              type="button"
              class="header-v32-account-trigger"
              :class="{
                active:
                  accountMenuOpen
              }"
              aria-label="账户菜单"
              @click="toggleAccountMenu"
            >
              <span class="header-v32-avatar">
                {{
                  props.user.username
                    .slice(0, 1)
                    .toUpperCase()
                }}
              </span>

              <span class="header-v32-account-name">
                {{ accountLabel }}
              </span>

              <ChevronDown
                :size="15"
                :stroke-width="1.9"
                class="header-v32-chevron"
                aria-hidden="true"
              />
            </button>

            <transition name="header-v32-menu">
              <section
                v-if="accountMenuOpen"
                class="header-v32-account-menu"
              >
                <header>
                  <span class="header-v32-profile-avatar">
                    {{
                      props.user.username
                        .slice(0, 1)
                        .toUpperCase()
                    }}
                  </span>

                  <div>
                    <strong>
                      {{ accountLabel }}
                    </strong>

                    <small>
                      {{ props.user.username }}
                      <span>·</span>
                      {{
                        props.user.role ===
                          "admin"
                          ? "站长账号"
                          : `${formatPoints(props.user.credits)} 积分`
                      }}
                    </small>
                  </div>
                </header>

                <nav class="header-v32-primary-menu">
                  <button
                    type="button"
                    @click="openUserPage"
                  >
                    <LayoutDashboard
                      :size="18"
                      :stroke-width="1.75"
                    />

                    <span>
                      <strong>我的后台</strong>
                      <small>
                        作品、消息与账号设置
                      </small>
                    </span>

                    <ArrowRight
                      :size="15"
                      :stroke-width="1.7"
                      class="header-v32-item-arrow"
                    />
                  </button>

                  <button
                    v-if="
                      props.user.role ===
                      'admin'
                    "
                    type="button"
                    @click="openAdminPage"
                  >
                    <Shield
                      :size="18"
                      :stroke-width="1.75"
                    />

                    <span>
                      <strong>站长后台</strong>
                      <small>
                        用户、运营与系统管理
                      </small>
                    </span>

                    <ArrowRight
                      :size="15"
                      :stroke-width="1.7"
                      class="header-v32-item-arrow"
                    />
                  </button>
                </nav>

                <div class="header-v32-secondary-menu">
                  <button
                    type="button"
                    @click="open517Zhe"
                  >
                    <ExternalLink
                      :size="17"
                      :stroke-width="1.75"
                    />

                    <span>517ZHE</span>
                  </button>

                  <button
                    type="button"
                    class="danger"
                    @click="logout"
                  >
                    <LogOut
                      :size="17"
                      :stroke-width="1.75"
                    />

                    <span>退出登录</span>
                  </button>
                </div>
              </section>
            </transition>
          </div>
        </template>

        <template v-else>
          <button
            type="button"
            class="auth-top-button ghost"
            @click="emit('login')"
          >
            登录
          </button>

          <button
            type="button"
            class="auth-top-button primary"
            @click="emit('register')"
          >
            注册
          </button>
        </template>
      </template>

      <transition name="header-v32-toast">
        <aside
          v-if="
            props.user &&
            unreadCount > 0 &&
            toastVisible
          "
          class="header-v32-toast"
        >
          <button
            type="button"
            class="header-v32-toast-close"
            aria-label="关闭提醒"
            @click="
              toastVisible = false
            "
          >
            ×
          </button>

          <span class="header-v32-toast-icon">
            <Bell
              :size="18"
              :stroke-width="1.8"
            />
          </span>

          <div>
            <small>NEW MESSAGE</small>

            <strong>
              {{
                latestUnread?.title ||
                "你有新的站内消息"
              }}
            </strong>

            <p>
              {{
                latestUnread?.content ||
                `当前共有 ${unreadCount} 条未读消息`
              }}
            </p>
          </div>

          <button
            type="button"
            class="header-v32-toast-action"
            @click="openMessageCenter"
          >
            查看
            <ArrowRight
              :size="14"
              :stroke-width="1.8"
            />
          </button>
        </aside>
      </transition>
    </div>
  </header>
</template>

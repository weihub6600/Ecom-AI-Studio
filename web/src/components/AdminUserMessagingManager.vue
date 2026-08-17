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
import type {
  AdminAudienceUser,
  AdminSiteMessage,
  Pagination,
  UserGroup
} from "../types";
import {
  formatDate
} from "../utils/format";
import {
  statusLabel
} from "./admin-user-messaging/presentation";
import AdminUserGroupEditor from "./admin-user-messaging/AdminUserGroupEditor.vue";
import AdminMessageDeliveryHistory from "./admin-user-messaging/AdminMessageDeliveryHistory.vue";
import AdminMessagePreview from "./admin-user-messaging/AdminMessagePreview.vue";

type Tab =
  | "segments"
  | "messages";

const tab =
  ref<Tab>("segments");

const groups =
  ref<UserGroup[]>([]);

const users =
  ref<AdminAudienceUser[]>([]);

const usersPagination =
  ref<Pagination>({
    page: 1,
    pageSize: 30,
    total: 0,
    totalPages: 1
  });

const messages =
  ref<AdminSiteMessage[]>([]);

const messagesPagination =
  ref<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1
  });

const loading =
  ref(true);

const saving =
  ref(false);

const message =
  ref("");

const errorMessage =
  ref("");

const userSearch =
  ref("");

const userStatus =
  ref("");

const targetGroupSearch = ref("");
const targetUserSearch = ref("");
const targetUsers = ref<AdminAudienceUser[]>([]);
const targetUserLoading = ref(false);

const targetGroupOpen =
  ref(false);

const targetUserOpen =
  ref(false);

let targetUserSearchTimer:
  ReturnType<typeof setTimeout> |
  undefined;

const activeGroupFilter =
  ref("all");

const selectedUserIds =
  ref<string[]>([]);

const bulkGroupId =
  ref("");

const createPanelOpen =
  ref(false);

const editingGroupId =
  ref("");

const expandedMessageId =
  ref("");

const groupDraft =
  reactive({
    name: "",
    description: "",
    sortOrder: 100
  });

const messageDraft =
  reactive({
    title: "",
    content: "",
    kind: "info" as
      | "info"
      | "success"
      | "warning",
    targetType: "all" as
      | "all"
      | "group"
      | "user",
    targetGroupId: "",
    targetUserId: ""
  });

const targetGroups = computed(() => {
  const keyword = targetGroupSearch.value.trim().toLowerCase();
  if (!keyword) return groups.value;
  return groups.value.filter((item) => (item.name + " " + (item.description || "")).toLowerCase().includes(keyword));
});

const filteredUsers =
  computed(() => {
    if (
      activeGroupFilter.value ===
      "all"
    ) {
      return users.value;
    }

    return users.value.filter(
      (item) =>
        item.groupIds.includes(
          activeGroupFilter.value
        )
    );
  });

const allVisibleSelected =
  computed(() =>
    filteredUsers.value.length > 0 &&
    filteredUsers.value.every(
      (item) =>
        selectedUserIds.value
          .includes(item.id)
    )
  );

const activeUsers =
  computed(() =>
    users.value.filter(
      (item) =>
        item.status ===
        "active"
    ).length
  );

const groupedUsers =
  computed(() =>
    users.value.filter(
      (item) =>
        item.groupIds.length > 0
    ).length
  );

const totalDelivered =
  computed(() =>
    messages.value.reduce(
      (sum, item) =>
        sum +
        item.deliveredCount,
      0
    )
  );

const totalRead =
  computed(() =>
    messages.value.reduce(
      (sum, item) =>
        sum +
        item.readCount,
      0
    )
  );

const averageReadRate =
  computed(() => {
    if (
      totalDelivered.value < 1
    ) {
      return 0;
    }

    return Math.round(
      totalRead.value /
      totalDelivered.value *
      100
    );
  });

const estimatedAudience =
  computed(() => {
    if (
      messageDraft.targetType ===
      "all"
    ) {
      return activeUsers.value;
    }

    if (
      messageDraft.targetType ===
      "group"
    ) {
      return groups.value.find(
        (item) =>
          item.id ===
          messageDraft.targetGroupId
      )?.memberCount || 0;
    }

    return messageDraft.targetUserId
      ? 1
      : 0;
  });

onMounted(loadAll);

async function loadAll() {
  loading.value = true;
  clearMessages();

  try {
    await Promise.all([
      loadGroups(),
      loadUsers(1),
      loadMessages(1)
    ]);
  } catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "读取用户运营数据失败"
      );
  } finally {
    loading.value = false;
  }
}

async function loadGroups() {
  const data =
    await apiRequest<{
      groups: UserGroup[];
    }>(
      "/api/admin/audience/groups"
    );

  groups.value =
    data.groups || [];

  if (
    activeGroupFilter.value !==
      "all" &&
    !groups.value.some(
      (item) =>
        item.id ===
        activeGroupFilter.value
    )
  ) {
    activeGroupFilter.value =
      "all";
  }
}

async function loadUsers(
  page =
    usersPagination.value
      .page || 1
) {
  const params =
    new URLSearchParams({
      page: String(page),
      pageSize: "30"
    });

  if (
    userSearch.value.trim()
  ) {
    params.set(
      "search",
      userSearch.value.trim()
    );
  }

  if (userStatus.value) {
    params.set(
      "status",
      userStatus.value
    );
  }

  const data =
    await apiRequest<{
      users:
        AdminAudienceUser[];
      pagination: Pagination;
    }>(
      `/api/admin/audience/users?${params.toString()}`
    );

  users.value =
    data.users || [];

  usersPagination.value =
    data.pagination;

  selectedUserIds.value =
    selectedUserIds.value.filter(
      (id) =>
        users.value.some(
          (item) =>
            item.id === id
        )
    );
}

async function loadMessages(
  page =
    messagesPagination.value
      .page || 1
) {
  const data =
    await apiRequest<{
      messages:
        AdminSiteMessage[];
      pagination: Pagination;
    }>(
      `/api/admin/messages?page=${page}&pageSize=20`
    );

  messages.value =
    data.messages || [];

  messagesPagination.value =
    data.pagination;
}

function openCreateGroup() {
  editingGroupId.value = "";

  Object.assign(
    groupDraft,
    {
      name: "",
      description: "",
      sortOrder: 100
    }
  );

  createPanelOpen.value = true;
}

function startEditGroup(
  group: UserGroup
) {
  editingGroupId.value =
    group.id;

  Object.assign(
    groupDraft,
    {
      name:
        group.name,
      description:
        group.description || "",
      sortOrder:
        group.sortOrder
    }
  );

  createPanelOpen.value = true;
}

function closeGroupEditor() {
  createPanelOpen.value = false;
  editingGroupId.value = "";
}

async function saveGroup() {
  if (
    !groupDraft.name.trim()
  ) {
    errorMessage.value =
      "请填写分组名称";
    return;
  }

  saving.value = true;
  clearMessages();

  try {
    if (
      editingGroupId.value
    ) {
      await apiRequest(
        `/api/admin/audience/groups/${encodeURIComponent(editingGroupId.value)}`,
        jsonRequest(
          {
            ...groupDraft,
            name:
              groupDraft.name
                .trim(),
            description:
              groupDraft
                .description
                .trim()
          },
          "PATCH"
        )
      );

      message.value =
        "用户分组已更新";
    } else {
      await apiRequest(
        "/api/admin/audience/groups",
        jsonRequest({
          ...groupDraft,
          name:
            groupDraft.name
              .trim(),
          description:
            groupDraft
              .description
              .trim()
        })
      );

      message.value =
        "用户分组已创建";
    }

    closeGroupEditor();

    await Promise.all([
      loadGroups(),
      loadUsers(
        usersPagination.value.page
      )
    ]);
  } catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "保存用户分组失败"
      );
  } finally {
    saving.value = false;
  }
}

async function removeGroup(
  group: UserGroup
) {
  if (
    !await platformConfirm(
      `删除分组“${group.name}”吗？用户账号不会删除，历史消息也会保留。`
    )
  ) {
    return;
  }

  clearMessages();

  try {
    await apiRequest(
      `/api/admin/audience/groups/${encodeURIComponent(group.id)}`,
      {
        method: "DELETE"
      }
    );

    message.value =
      "用户分组已删除";

    await Promise.all([
      loadGroups(),
      loadUsers(
        usersPagination.value.page
      )
    ]);
  } catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "删除用户分组失败"
      );
  }
}

function setGroupFilter(
  groupId: string
) {
  activeGroupFilter.value =
    groupId;

  selectedUserIds.value = [];
}

function hasGroup(
  user:
    AdminAudienceUser,
  groupId: string
): boolean {
  return user.groupIds
    .includes(groupId);
}

function toggleGroup(
  user:
    AdminAudienceUser,
  groupId: string
) {
  if (
    hasGroup(
      user,
      groupId
    )
  ) {
    user.groupIds =
      user.groupIds.filter(
        (id) =>
          id !== groupId
      );
  } else {
    user.groupIds = [
      ...user.groupIds,
      groupId
    ];
  }
}

function toggleUserSelection(
  userId: string
) {
  if (
    selectedUserIds.value
      .includes(userId)
  ) {
    selectedUserIds.value =
      selectedUserIds.value
        .filter(
          (id) =>
            id !== userId
        );
  } else {
    selectedUserIds.value = [
      ...selectedUserIds.value,
      userId
    ];
  }
}

function toggleAllVisible() {
  const ids =
    filteredUsers.value.map(
      (item) => item.id
    );

  if (
    allVisibleSelected.value
  ) {
    selectedUserIds.value =
      selectedUserIds.value.filter(
        (id) =>
          !ids.includes(id)
      );
  } else {
    selectedUserIds.value = [
      ...new Set([
        ...selectedUserIds.value,
        ...ids
      ])
    ];
  }
}

async function saveUserGroups(
  user:
    AdminAudienceUser,
  quiet = false
) {
  const data =
    await apiRequest<{
      user:
        AdminAudienceUser;
    }>(
      `/api/admin/audience/users/${encodeURIComponent(user.id)}/groups`,
      jsonRequest(
        {
          groupIds:
            user.groupIds
        },
        "PUT"
      )
    );

  const index =
    users.value
      .findIndex(
        (item) =>
          item.id ===
          user.id
      );

  if (index >= 0) {
    users.value[index] =
      data.user;
  }

  if (!quiet) {
    message.value =
      `已保存 ${user.nickname || user.username} 的用户分组`;
  }

  return data.user;
}

async function saveOneUserGroups(
  user:
    AdminAudienceUser
) {
  clearMessages();

  try {
    await saveUserGroups(
      user
    );

    await loadGroups();
  } catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "保存用户分组失败"
      );

    await loadUsers(
      usersPagination.value.page
    );
  }
}

async function bulkAddGroup() {
  if (
    selectedUserIds.value
      .length < 1
  ) {
    errorMessage.value =
      "请先选择用户";
    return;
  }

  if (!bulkGroupId.value) {
    errorMessage.value =
      "请选择要批量加入的分组";
    return;
  }

  const group =
    groups.value.find(
      (item) =>
        item.id ===
        bulkGroupId.value
    );

  if (!group) return;

  if (
    !await platformConfirm(
      `将 ${selectedUserIds.value.length} 位用户加入“${group.name}”吗？`
    )
  ) {
    return;
  }

  saving.value = true;
  clearMessages();

  try {
    const targets =
      users.value.filter(
        (item) =>
          selectedUserIds.value
            .includes(item.id)
      );

    for (
      const user of targets
    ) {
      if (
        !user.groupIds.includes(
          group.id
        )
      ) {
        user.groupIds = [
          ...user.groupIds,
          group.id
        ];
      }

      await saveUserGroups(
        user,
        true
      );
    }

    message.value =
      `已将 ${targets.length} 位用户加入“${group.name}”`;

    selectedUserIds.value = [];
    bulkGroupId.value = "";

    await loadGroups();
  } catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "批量归组失败"
      );

    await loadUsers(
      usersPagination.value.page
    );
  } finally {
    saving.value = false;
  }
}

async function searchTargetUsers() {
  targetUserLoading.value = true;
  try {
    const params = new URLSearchParams({ page: "1", pageSize: "50", status: "active" });
    if (targetUserSearch.value.trim()) params.set("search", targetUserSearch.value.trim());
    const data = await apiRequest<{ users: AdminAudienceUser[] }>(`/api/admin/audience/users?${params.toString()}`);
    targetUsers.value = data.users || [];
  } catch (error) {
    errorMessage.value = messageOf(error, "搜索目标用户失败");
  } finally { targetUserLoading.value = false; }
}

function chooseTargetGroup(
  group: UserGroup
) {
  messageDraft.targetGroupId =
    group.id;

  targetGroupSearch.value =
    group.name;

  targetGroupOpen.value =
    false;
}

function chooseTargetUser(
  user: AdminAudienceUser
) {
  messageDraft.targetUserId =
    user.id;

  targetUserSearch.value =
    user.nickname
      ? `${user.nickname} · @${user.username}`
      : `@${user.username}`;

  targetUserOpen.value =
    false;
}

function openTargetGroupCombo() {
  targetGroupOpen.value = true;
}

function openTargetUserCombo() {
  targetUserOpen.value = true;

  if (
    targetUsers.value.length === 0
  ) {
    void searchTargetUsers();
  }
}

function scheduleTargetGroupFilter() {
  messageDraft.targetGroupId = "";
  targetGroupOpen.value = true;
}

function scheduleTargetUserSearch() {
  messageDraft.targetUserId = "";
  targetUserOpen.value = true;

  if (targetUserSearchTimer) {
    clearTimeout(
      targetUserSearchTimer
    );
  }

  targetUserSearchTimer =
    setTimeout(
      () => {
        void searchTargetUsers();
      },
      260
    );
}

function closeTargetGroupCombo() {
  window.setTimeout(
    () => {
      targetGroupOpen.value = false;
    },
    120
  );
}

function closeTargetUserCombo() {
  window.setTimeout(
    () => {
      targetUserOpen.value = false;
    },
    120
  );
}

function chooseTargetType(
  targetType:
    "all" |
    "group" |
    "user"
) {
  messageDraft.targetType =
    targetType;

  messageDraft.targetGroupId =
    "";

  messageDraft.targetUserId =
    "";
  targetGroupSearch.value = "";
  targetUserSearch.value = "";
  if (targetType === "user") void searchTargetUsers();
}

async function sendMessage() {
  if (
    !messageDraft.title.trim() ||
    !messageDraft.content.trim()
  ) {
    errorMessage.value =
      "请填写消息标题和内容";
    return;
  }

  if (
    messageDraft.targetType ===
      "group" &&
    !messageDraft
      .targetGroupId
  ) {
    errorMessage.value =
      "请选择目标用户分组";
    return;
  }

  if (
    messageDraft.targetType ===
      "user" &&
    !messageDraft
      .targetUserId
  ) {
    errorMessage.value =
      "请选择目标用户";
    return;
  }

  const targetDescription =
    messageDraft
      .targetType === "all"
      ? "全部已启用用户"
      : messageDraft
          .targetType ===
          "group"
        ? groups.value.find(
            (item) =>
              item.id ===
              messageDraft
                .targetGroupId
          )?.name ||
          "所选分组"
        : users.value.find(
            (item) =>
              item.id ===
              messageDraft
                .targetUserId
          )?.nickname ||
          users.value.find(
            (item) =>
              item.id ===
              messageDraft
                .targetUserId
          )?.username ||
          "所选用户";

  if (
    !await platformConfirm(
      `确定向“${targetDescription}”发送站内消息吗？`
    )
  ) {
    return;
  }

  saving.value = true;
  clearMessages();

  try {
    const data =
      await apiRequest<{
        message:
          AdminSiteMessage;
      }>(
        "/api/admin/messages",
        jsonRequest({
          ...messageDraft,
          title:
            messageDraft.title
              .trim(),
          content:
            messageDraft
              .content
              .trim(),
          targetGroupId:
            messageDraft
              .targetGroupId ||
            undefined,
          targetUserId:
            messageDraft
              .targetUserId ||
            undefined
        })
      );

    message.value =
      `消息已送达 ${data.message.deliveredCount} 位用户`;

    Object.assign(
      messageDraft,
      {
        title: "",
        content: "",
        kind: "info",
        targetType: "all",
        targetGroupId: "",
        targetUserId: ""
      }
    );

    await loadMessages(1);
  } catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "发送站内消息失败"
      );
  } finally {
    saving.value = false;
  }
}

async function removeMessage(
  item:
    AdminSiteMessage
) {
  if (
    !await platformConfirm(
      `删除站内消息“${item.title}”吗？用户收件箱中的该条消息也会同步移除。`
    )
  ) {
    return;
  }

  clearMessages();

  try {
    await apiRequest(
      `/api/admin/messages/${encodeURIComponent(item.id)}`,
      {
        method: "DELETE"
      }
    );

    message.value =
      "站内消息已删除";

    await loadMessages(
      messagesPagination.value.page
    );
  } catch (error) {
    errorMessage.value =
      messageOf(
        error,
        "删除站内消息失败"
      );
  }
}

function clearMessages() {
  message.value = "";
  errorMessage.value = "";
}

function messageOf(
  error: unknown,
  fallback: string
) {
  return error instanceof Error
    ? error.message
    : fallback;
}
</script>

<template>
  <div class="ops-shell">
    <header class="ops-hero">
      <div class="ops-hero-copy">
        <div class="ops-kicker">
          <span class="ops-live-dot"></span>
          USER OPERATIONS
          <b>消息通道在线</b>
        </div>

        <h2>用户运营中心</h2>

        <p>
          把用户分层、触达和阅读反馈放到同一条运营链路里。
          先组织用户，再精准发送，而不是把消息当成一张普通表单。
        </p>
      </div>

      <div class="ops-metrics">
        <article>
          <span>用户分组</span>
          <strong>{{ groups.length }}</strong>
          <small>可复用受众层</small>
        </article>

        <article>
          <span>当前页已分组</span>
          <strong>{{ groupedUsers }}</strong>
          <small>共 {{ users.length }} 位</small>
        </article>

        <article>
          <span>消息已读率</span>
          <strong>{{ averageReadRate }}%</strong>
          <small>
            {{ totalRead }} / {{ totalDelivered }}
          </small>
        </article>
      </div>
    </header>

    <nav class="ops-tabs">
      <button
        type="button"
        :class="{ active: tab === 'segments' }"
        @click="tab = 'segments'"
      >
        <span>01</span>
        <div>
          <strong>用户分层</strong>
          <small>标签、筛选与批量归组</small>
        </div>
        <i>SEGMENT</i>
      </button>

      <button
        type="button"
        :class="{ active: tab === 'messages' }"
        @click="tab = 'messages'"
      >
        <span>02</span>
        <div>
          <strong>消息触达</strong>
          <small>定向发送与阅读反馈</small>
        </div>
        <i>REACH</i>
      </button>
    </nav>

    <div
      v-if="message || errorMessage"
      class="ops-feedback"
      :class="{
        error: Boolean(errorMessage)
      }"
    >
      <span>
        {{ errorMessage || message }}
      </span>

      <button
        type="button"
        @click="clearMessages"
      >
        ×
      </button>
    </div>

    <div
      v-if="loading"
      class="ops-loading"
    >
      <span></span>
      正在载入用户运营数据…
    </div>

    <template
      v-else-if="tab === 'segments'"
    >
      <section class="segment-strip">
        <div class="segment-strip-head">
          <div>
            <span>AUDIENCE SEGMENTS</span>
            <h3>用户分组</h3>
          </div>

          <button
            type="button"
            class="ops-primary"
            @click="openCreateGroup"
          >
            ＋ 新建分组
          </button>
        </div>

        <div class="segment-cards">
          <button
            type="button"
            class="segment-card all"
            :class="{
              active:
                activeGroupFilter ===
                'all'
            }"
            @click="
              setGroupFilter('all')
            "
          >
            <span>ALL USERS</span>
            <strong>全部用户</strong>
            <b>
              {{ usersPagination.total }}
            </b>
            <small>查看当前筛选结果</small>
          </button>

          <article
            v-for="group in targetGroups"
            :key="group.id"
            class="segment-card"
            :class="{
              active:
                activeGroupFilter ===
                group.id
            }"
          >
            <button
              type="button"
              class="segment-card-main"
              @click="
                setGroupFilter(group.id)
              "
            >
              <span>SEGMENT</span>
              <strong>
                {{ group.name }}
              </strong>
              <b>
                {{ group.memberCount }}
              </b>
              <small>
                {{
                  group.description ||
                  '暂无分组说明'
                }}
              </small>
            </button>

            <footer>
              <button
                type="button"
                @click="
                  startEditGroup(group)
                "
              >
                编辑
              </button>

              <button
                type="button"
                class="danger"
                @click="
                  removeGroup(group)
                "
              >
                删除
              </button>
            </footer>
          </article>
        </div>
      </section>

      <section class="member-workspace">
        <header class="workspace-head">
          <div>
            <span>MEMBERSHIP WORKSPACE</span>
            <h3>用户归组工作台</h3>
            <p>
              点击分组卡片可快速过滤；支持逐个调整，也支持勾选后批量加入分组。
            </p>
          </div>

          <div class="workspace-stat">
            <span>当前结果</span>
            <strong>
              {{ filteredUsers.length }}
            </strong>
          </div>
        </header>

        <div class="member-toolbar">
          <div class="member-search">
            <span>⌕</span>
            <input
              v-model="userSearch"
              type="search"
              placeholder="搜索用户名或昵称"
              @keyup.enter="
                loadUsers(1)
              "
            />
          </div>

          <select
            v-model="userStatus"
          >
            <option value="">
              全部状态
            </option>
            <option value="active">
              已启用
            </option>
            <option value="pending">
              待审核
            </option>
            <option value="disabled">
              已封禁
            </option>
            <option value="rejected">
              已拒绝
            </option>
          </select>

          <button
            type="button"
            class="toolbar-search"
            @click="loadUsers(1)"
          >
            查询
          </button>
        </div>

        <div
          v-if="
            selectedUserIds.length > 0
          "
          class="bulk-bar"
        >
          <div>
            <span>
              已选择
              <strong>
                {{ selectedUserIds.length }}
              </strong>
              位用户
            </span>

            <button
              type="button"
              @click="
                selectedUserIds = []
              "
            >
              取消选择
            </button>
          </div>

          <div>
            <select
              v-model="bulkGroupId"
            >
              <option value="">
                选择目标分组
              </option>

              <option
                v-for="group in groups"
                :key="group.id"
                :value="group.id"
              >
                {{ group.name }}
              </option>
            </select>

            <button
              type="button"
              class="ops-primary"
              :disabled="saving"
              @click="bulkAddGroup"
            >
              批量加入分组
            </button>
          </div>
        </div>

        <div class="member-table">
          <div class="member-table-head">
            <label class="select-box">
              <input
                type="checkbox"
                :checked="
                  allVisibleSelected
                "
                @change="
                  toggleAllVisible
                "
              />
              <span></span>
            </label>

            <span>用户</span>
            <span>状态</span>
            <span>所属分组</span>
            <span>最近登录</span>
            <span>操作</span>
          </div>

          <article
            v-for="user in filteredUsers"
            :key="user.id"
            class="member-row"
            :class="{
              selected:
                selectedUserIds
                  .includes(user.id)
            }"
          >
            <label class="select-box">
              <input
                type="checkbox"
                :checked="
                  selectedUserIds
                    .includes(user.id)
                "
                @change="
                  toggleUserSelection(
                    user.id
                  )
                "
              />
              <span></span>
            </label>

            <div class="member-user">
              <b>
                {{
                  (
                    user.nickname ||
                    user.username
                  )
                    .slice(0, 1)
                    .toUpperCase()
                }}
              </b>

              <div>
                <strong>
                  {{
                    user.nickname ||
                    user.username
                  }}
                </strong>

                <small>
                  {{ user.username }}
                </small>
              </div>
            </div>

            <i
              class="member-status"
              :class="user.status"
            >
              {{ statusLabel(user.status) }}
            </i>

            <div class="group-chip-list">
              <label
                v-for="group in groups"
                :key="group.id"
                :class="{
                  active:
                    hasGroup(
                      user,
                      group.id
                    )
                }"
              >
                <input
                  type="checkbox"
                  :checked="
                    hasGroup(
                      user,
                      group.id
                    )
                  "
                  @change="
                    toggleGroup(
                      user,
                      group.id
                    )
                  "
                />
                <span>
                  {{ group.name }}
                </span>
              </label>

              <em
                v-if="groups.length === 0"
              >
                暂无分组
              </em>
            </div>

            <time>
              {{
                user.lastLoginAt
                  ? formatDate(
                      user.lastLoginAt
                    )
                  : '从未登录'
              }}
            </time>

            <button
              type="button"
              class="row-save"
              :disabled="
                groups.length === 0
              "
              @click="
                saveOneUserGroups(
                  user
                )
              "
            >
              保存
            </button>
          </article>

          <div
            v-if="
              filteredUsers.length ===
              0
            "
            class="ops-empty"
          >
            <span>◎</span>
            <strong>没有匹配用户</strong>
            <p>
              可以调整搜索条件或切换用户分组。
            </p>
          </div>
        </div>

        <div class="ops-pagination">
          <button
            type="button"
            :disabled="
              usersPagination.page <= 1
            "
            @click="
              loadUsers(
                usersPagination.page - 1
              )
            "
          >
            ← 上一页
          </button>

          <span>
            第 {{ usersPagination.page }}
            / {{ usersPagination.totalPages }} 页
          </span>

          <button
            type="button"
            :disabled="
              usersPagination.page >=
              usersPagination.totalPages
            "
            @click="
              loadUsers(
                usersPagination.page + 1
              )
            "
          >
            下一页 →
          </button>
        </div>
      </section>

      <AdminUserGroupEditor
        v-if="createPanelOpen"
        :editing="Boolean(editingGroupId)"
        :saving="saving"
        :draft="groupDraft"
        @close="closeGroupEditor"
        @submit="saveGroup"
      />
    </template>

    <template v-else>
      <section class="reach-layout">
        <div class="reach-compose">
          <header class="workspace-head">
            <div>
              <span>MESSAGE COMPOSER</span>
              <h3>创建一次精准触达</h3>
              <p>
                先选受众，再写消息。右侧实时预览用户实际看到的内容。
              </p>
            </div>

            <div class="workspace-stat">
              <span>预计触达</span>
              <strong>
                {{ estimatedAudience }}
              </strong>
            </div>
          </header>

          <div class="audience-picker">
            <button
              type="button"
              :class="{
                active:
                  messageDraft
                    .targetType ===
                  'all'
              }"
              @click="
                chooseTargetType('all')
              "
            >
              <span>◉</span>
              <div>
                <strong>全部用户</strong>
                <small>所有已启用普通用户</small>
              </div>
            </button>

            <button
              type="button"
              :class="{
                active:
                  messageDraft
                    .targetType ===
                  'group'
              }"
              @click="
                chooseTargetType(
                  'group'
                )
              "
            >
              <span>⌘</span>
              <div>
                <strong>指定分组</strong>
                <small>按用户分层精准触达</small>
              </div>
            </button>

            <button
              type="button"
              :class="{
                active:
                  messageDraft
                    .targetType ===
                  'user'
              }"
              @click="
                chooseTargetType(
                  'user'
                )
              "
            >
              <span>◎</span>
              <div>
                <strong>单个用户</strong>
                <small>一对一发送消息</small>
              </div>
            </button>
          </div>

          <div
            v-if="
              messageDraft.targetType ===
              'group'
            "
            class="target-select-card"
          >
                        <label class="target-combo-field">
              <span>目标分组</span>

              <div
                class="target-combobox"
                :class="{
                  open:
                    targetGroupOpen
                }"
              >
                <input
                  v-model="targetGroupSearch"
                  type="search"
                  placeholder="搜索并选择分组"
                  autocomplete="off"
                  @focus="openTargetGroupCombo"
                  @input="scheduleTargetGroupFilter"
                  @blur="closeTargetGroupCombo"
                />

                <button
                  type="button"
                  class="target-combobox-toggle"
                  aria-label="展开分组"
                  @mousedown.prevent
                  @click="
                    targetGroupOpen =
                      !targetGroupOpen
                  "
                >
                  <span>⌄</span>
                </button>

                <div
                  v-if="targetGroupOpen"
                  class="target-combobox-menu"
                >
                  <button
                    v-for="group in targetGroups"
                    :key="group.id"
                    type="button"
                    :class="{
                      selected:
                        messageDraft
                          .targetGroupId ===
                        group.id
                    }"
                    @mousedown.prevent
                    @click="
                      chooseTargetGroup(
                        group
                      )
                    "
                  >
                    <span class="target-combo-main">
                      <strong>
                        {{ group.name }}
                      </strong>
                      <small>
                        {{ group.memberCount }} 人
                        <template
                          v-if="
                            group.description
                          "
                        >
                          ·
                          {{
                            group.description
                          }}
                        </template>
                      </small>
                    </span>
                  </button>

                  <div
                    v-if="
                      targetGroups.length ===
                      0
                    "
                    class="target-combobox-empty"
                  >
                    没有匹配的分组
                  </div>
                </div>
              </div>
            </label>
          </div>

          <div
            v-if="
              messageDraft.targetType ===
              'user'
            "
            class="target-select-card"
          >
                        <label class="target-combo-field">
              <span>目标用户</span>

              <div
                class="target-combobox"
                :class="{
                  open:
                    targetUserOpen
                }"
              >
                <input
                  v-model="targetUserSearch"
                  type="search"
                  placeholder="搜索用户名或昵称并选择"
                  autocomplete="off"
                  @focus="openTargetUserCombo"
                  @input="scheduleTargetUserSearch"
                  @keyup.enter="
                    searchTargetUsers
                  "
                  @blur="closeTargetUserCombo"
                />

                <button
                  type="button"
                  class="target-combobox-toggle"
                  aria-label="展开用户"
                  @mousedown.prevent
                  @click="
                    targetUserOpen =
                      !targetUserOpen
                  "
                >
                  <span>⌄</span>
                </button>

                <div
                  v-if="targetUserOpen"
                  class="target-combobox-menu"
                >
                  <div
                    v-if="
                      targetUserLoading
                    "
                    class="target-combobox-empty"
                  >
                    正在搜索用户…
                  </div>

                  <template v-else>
                    <button
                      v-for="user in targetUsers"
                      :key="user.id"
                      type="button"
                      :class="{
                        selected:
                          messageDraft
                            .targetUserId ===
                          user.id
                      }"
                      @mousedown.prevent
                      @click="
                        chooseTargetUser(
                          user
                        )
                      "
                    >
                      <i class="target-combo-avatar">
                        {{
                          (
                            user.nickname ||
                            user.username
                          )
                            .slice(0, 1)
                        }}
                      </i>

                      <span class="target-combo-main">
                        <strong>
                          {{
                            user.nickname ||
                            user.username
                          }}
                        </strong>
                        <small>
                          @{{ user.username }}
                        </small>
                      </span>
                    </button>

                    <div
                      v-if="
                        targetUsers.length ===
                        0
                      "
                      class="target-combobox-empty"
                    >
                      没有匹配的用户
                    </div>
                  </template>
                </div>
              </div>
            </label>

            <small>
              如果没有找到用户，可先回到“用户分层”搜索。
            </small>
          </div>

          <div class="message-fields">
            <label class="message-title-field">
              <span>消息标题</span>
              <input
                v-model="
                  messageDraft.title
                "
                maxlength="80"
                placeholder="一句话告诉用户发生了什么"
              />
              <small>
                {{ messageDraft.title.length }} / 80
              </small>
            </label>

            <label>
              <span>消息级别</span>
              <select
                v-model="
                  messageDraft.kind
                "
              >
                <option value="info">
                  普通通知
                </option>
                <option value="success">
                  好消息
                </option>
                <option value="warning">
                  重要提醒
                </option>
              </select>
            </label>

            <label class="message-body-field">
              <span>消息正文</span>
              <textarea
                v-model="
                  messageDraft.content
                "
                maxlength="2000"
                rows="8"
                placeholder="输入完整消息内容。建议说明发生了什么、用户需要做什么，以及是否有时间要求。"
              ></textarea>
              <small>
                {{ messageDraft.content.length }} / 2000
              </small>
            </label>
          </div>

          <button
            type="button"
            class="send-cta"
            :disabled="saving"
            @click="sendMessage"
          >
            <span>发送站内消息</span>
            <small>
              预计触达
              {{ estimatedAudience }}
              位用户
            </small>
          </button>
        </div>

        <AdminMessagePreview
          :kind="messageDraft.kind"
          :title="messageDraft.title"
          :content="messageDraft.content"
        />

      </section>

      <AdminMessageDeliveryHistory
        :messages="messages"
        :pagination="messagesPagination"
        :total-delivered="totalDelivered"
        :total-read="totalRead"
        :average-read-rate="averageReadRate"
        :expanded-message-id="expandedMessageId"
        @toggle="expandedMessageId = $event"
        @page-change="loadMessages"
        @remove="removeMessage"
      />

    </template>
  </div>
</template>

<style scoped>
.ops-shell{display:grid;gap:16px}.ops-hero{position:relative;overflow:hidden;display:flex;align-items:flex-end;justify-content:space-between;gap:28px;padding:28px 30px;border:1px solid #ddd9f4;border-radius:22px;background:linear-gradient(125deg,#ffffff 0%,#f8f7ff 54%,#eff0ff 100%);box-shadow:0 16px 40px rgba(57,49,104,.06)}.ops-hero:after{content:"";position:absolute;right:-60px;top:-90px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(108,88,218,.15),rgba(108,88,218,0) 68%);pointer-events:none}.ops-hero-copy{position:relative;z-index:1;max-width:720px}.ops-kicker{display:flex;align-items:center;gap:8px;color:#6654d4;font-size:9px;font-weight:900;letter-spacing:.16em}.ops-kicker b{padding:4px 8px;border-radius:999px;background:#e9f8ef;color:#27734d;font-size:8px;letter-spacing:0}.ops-live-dot{width:7px;height:7px;border-radius:50%;background:#39b779;box-shadow:0 0 0 5px rgba(57,183,121,.11)}.ops-hero h2{margin:9px 0 8px;color:#272a3e;font-size:28px;letter-spacing:-.04em}.ops-hero p{max-width:670px;margin:0;color:#73778a;font-size:12px;line-height:1.8}.ops-metrics{position:relative;z-index:1;display:grid;grid-template-columns:repeat(3,minmax(118px,1fr));gap:9px}.ops-metrics article{min-width:118px;padding:14px;border:1px solid rgba(216,217,232,.9);border-radius:14px;background:rgba(255,255,255,.86);backdrop-filter:blur(12px)}.ops-metrics span{display:block;color:#8b8e9f;font-size:8px;font-weight:750}.ops-metrics strong{display:block;margin-top:5px;color:#42369f;font-size:22px}.ops-metrics small{display:block;margin-top:4px;color:#9b9dac;font-size:8px}.ops-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.ops-tabs button{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:11px;padding:12px 14px;border:1px solid #e0e1ea;border-radius:14px;background:#fff;color:#676a7d;text-align:left;cursor:pointer;transition:.18s ease}.ops-tabs button:hover{transform:translateY(-1px);border-color:#c8c2ee;box-shadow:0 10px 24px rgba(55,52,89,.05)}.ops-tabs button>span{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:#f0eff8;color:#6c5ad2;font-size:9px;font-weight:900}.ops-tabs button div{display:grid;gap:2px}.ops-tabs strong{font-size:11px}.ops-tabs small{color:#9799a9;font-size:8px}.ops-tabs i{color:#bbbcca;font-size:7px;font-style:normal;font-weight:900;letter-spacing:.14em}.ops-tabs button.active{border-color:#bdb4ee;background:linear-gradient(135deg,#f8f6ff,#f1efff);box-shadow:0 0 0 2px rgba(103,84,212,.07)}.ops-tabs button.active>span{background:linear-gradient(135deg,#7766e4,#5c4bc7);color:#fff;box-shadow:0 8px 18px rgba(94,76,201,.22)}.ops-feedback{position:relative;padding:11px 42px 11px 14px;border:1px solid #bfe6ce;border-radius:11px;background:#eefaf3;color:#2d7350;font-size:10px}.ops-feedback.error{border-color:#f0cbce;background:#fff2f3;color:#a94a56}.ops-feedback button{position:absolute;right:10px;top:3px;border:0;background:transparent;color:inherit;font-size:20px}.ops-loading{display:flex;align-items:center;justify-content:center;gap:10px;min-height:260px;border:1px dashed #d9dbe6;border-radius:17px;background:#fff;color:#858899;font-size:10px}.ops-loading span{width:17px;height:17px;border:2px solid #dedaf5;border-top-color:#6654d4;border-radius:50%;animation:ops-spin .8s linear infinite}@keyframes ops-spin{to{transform:rotate(360deg)}}.segment-strip,.member-workspace,.reach-compose{border:1px solid #e1e2ea;border-radius:19px;background:#fff;box-shadow:0 12px 34px rgba(46,48,74,.045)}.segment-strip{padding:19px}.segment-strip-head,.workspace-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}.segment-strip-head>div>span,.workspace-head>div>span{color:#6d5bd5;font-size:8px;font-weight:900;letter-spacing:.15em}.segment-strip-head h3,.workspace-head h3{margin:4px 0 0;color:#303347;font-size:18px}.workspace-head p{max-width:650px;margin:5px 0 0;color:#8a8d9d;font-size:9px;line-height:1.6}.ops-primary{min-height:36px;padding:0 12px;border:0;border-radius:10px;background:linear-gradient(135deg,#6b58d7,#7867e7);color:#fff;font-size:9px;font-weight:900;box-shadow:0 8px 18px rgba(102,84,210,.18);cursor:pointer}.ops-primary:disabled{opacity:.45}.segment-cards{display:flex;gap:9px;overflow:auto;margin-top:14px;padding:2px 1px 4px}.segment-card{position:relative;flex:0 0 210px;min-height:112px;padding:0;border:1px solid #e2e3ec;border-radius:14px;background:#fafbfe;text-align:left;transition:.18s ease}.segment-card:hover,.segment-card.active{border-color:#c2b9ee;background:#f7f5ff;box-shadow:0 8px 20px rgba(70,58,137,.07)}.segment-card.all{display:grid;align-content:center;padding:14px;cursor:pointer}.segment-card-main{display:grid;width:100%;min-height:80px;padding:13px 13px 7px;border:0;background:transparent;text-align:left;cursor:pointer}.segment-card span{color:#8273d9;font-size:7px;font-weight:900;letter-spacing:.12em}.segment-card strong{margin-top:4px;color:#3b3e52;font-size:11px}.segment-card b{position:absolute;right:13px;top:12px;color:#6653cf;font-size:21px}.segment-card small{overflow:hidden;margin-top:5px;color:#9093a3;font-size:8px;text-overflow:ellipsis;white-space:nowrap}.segment-card footer{display:flex;gap:4px;padding:0 9px 9px}.segment-card footer button{min-height:25px;padding:0 7px;border:1px solid #e2e3eb;border-radius:7px;background:#fff;color:#777a8c;font-size:7px;font-weight:800}.segment-card footer button.danger{color:#b34d58}.member-workspace{padding:20px}.workspace-stat{min-width:88px;padding:9px 11px;border:1px solid #e1e2eb;border-radius:11px;background:#fafbfe}.workspace-stat span{display:block;color:#9699a9;font-size:7px}.workspace-stat strong{display:block;margin-top:3px;color:#5746bf;font-size:18px}.member-toolbar{display:grid;grid-template-columns:minmax(250px,1fr) 140px auto;gap:8px;margin-top:15px}.member-search{position:relative}.member-search>span{position:absolute;left:12px;top:10px;color:#85889a;font-size:13px}.member-search input,.member-toolbar select,.bulk-bar select,.target-select-card select,.message-fields input,.message-fields select,.message-fields textarea{width:100%;border:1px solid #dfe1e9;border-radius:10px;background:#fff;color:#34374b;font:inherit;font-size:10px;outline:none}.member-search input{height:39px;padding:0 12px 0 34px}.member-toolbar select,.bulk-bar select,.target-select-card select,.message-fields input,.message-fields select{height:39px;padding:0 10px}.member-toolbar select:focus,.member-search input:focus,.bulk-bar select:focus,.target-select-card select:focus,.message-fields input:focus,.message-fields select:focus,.message-fields textarea:focus{border-color:#8374df;box-shadow:0 0 0 3px rgba(112,94,210,.08)}.toolbar-search{min-height:39px;padding:0 13px;border:0;border-radius:10px;background:#393b50;color:#fff;font-size:9px;font-weight:850}.bulk-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;padding:9px 11px;border:1px solid #d8d3f3;border-radius:11px;background:linear-gradient(135deg,#f7f5ff,#f3f5ff)}.bulk-bar>div{display:flex;align-items:center;gap:8px}.bulk-bar span{color:#6f7284;font-size:9px}.bulk-bar span strong{color:#5c49c7}.bulk-bar>div:first-child button{border:0;background:transparent;color:#8a8d9d;font-size:8px}.bulk-bar select{width:170px;height:34px}.member-table{overflow:hidden;margin-top:11px;border:1px solid #e4e5ec;border-radius:13px}.member-table-head,.member-row{display:grid;grid-template-columns:34px minmax(180px,.75fr) 80px minmax(320px,1.5fr) 145px 58px;align-items:center;gap:10px}.member-table-head{min-height:38px;padding:0 11px;background:#f7f8fb;color:#8c8f9f;font-size:8px;font-weight:850}.member-row{min-height:63px;padding:8px 11px;border-top:1px solid #ececf1;background:#fff;transition:.15s ease}.member-row:hover{background:#faf9ff}.member-row.selected{background:#f6f4ff}.select-box{position:relative;display:grid;place-items:center;width:24px;height:24px;cursor:pointer}.select-box input{position:absolute;opacity:0}.select-box span{width:15px;height:15px;border:1px solid #ccd0dc;border-radius:5px;background:#fff}.select-box input:checked+span{border-color:#6856d4;background:#6856d4;box-shadow:inset 0 0 0 3px #fff}.member-user{display:flex;align-items:center;gap:8px;min-width:0}.member-user>b{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;border-radius:10px;background:linear-gradient(145deg,#ece9ff,#e5e8ff);color:#6553ca;font-size:10px}.member-user>div{display:grid;gap:2px;min-width:0}.member-user strong{overflow:hidden;color:#393c50;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.member-user small{color:#9699a8;font-size:8px}.member-status{justify-self:start;padding:4px 7px;border-radius:999px;font-size:7px;font-style:normal;font-weight:850}.member-status.active{background:#eaf8ef;color:#28724d}.member-status.pending{background:#fff5df;color:#986716}.member-status.disabled{background:#fff0f0;color:#a13f3f}.member-status.rejected{background:#efeff4;color:#757687}.group-chip-list{display:flex;flex-wrap:wrap;gap:4px}.group-chip-list label{position:relative;cursor:pointer}.group-chip-list input{position:absolute;opacity:0}.group-chip-list span{display:inline-flex;min-height:25px;align-items:center;padding:0 8px;border:1px solid #dfe1e9;border-radius:999px;background:#fff;color:#777b8d;font-size:7px;font-weight:800}.group-chip-list label.active span{border-color:#bdb4ec;background:#efecff;color:#5e4ec5}.group-chip-list em{color:#a0a3b1;font-size:8px;font-style:normal}.member-row time{color:#9295a5;font-size:8px}.row-save{min-height:30px;border:1px solid #dcd9f0;border-radius:8px;background:#f6f4ff;color:#5e4ec2;font-size:8px;font-weight:850}.ops-pagination{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:13px}.ops-pagination button{min-height:31px;padding:0 10px;border:1px solid #e0e1e9;border-radius:8px;background:#fff;color:#6253c8;font-size:8px;font-weight:800}.ops-pagination button:disabled{opacity:.35}.ops-pagination span{color:#8f92a2;font-size:8px}.ops-empty{display:grid;justify-items:center;padding:40px;color:#8e91a1;text-align:center}.ops-empty>span{color:#6d5bd4;font-size:21px}.ops-empty strong{margin-top:7px;color:#55586b;font-size:11px}.ops-empty p{margin:4px 0 0;font-size:8px}.reach-layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(330px,.6fr);gap:13px;align-items:start}.reach-compose{padding:20px}.audience-picker{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:15px}.audience-picker button{display:grid;grid-template-columns:34px minmax(0,1fr);align-items:center;gap:8px;min-height:62px;padding:9px;border:1px solid #e1e2ea;border-radius:12px;background:#fafbfe;color:#666a7c;text-align:left;cursor:pointer}.audience-picker button>span{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:#efeff6;color:#6c5ad2;font-size:11px}.audience-picker button div{display:grid;gap:2px}.audience-picker strong{font-size:9px}.audience-picker small{color:#979aa9;font-size:7px}.audience-picker button.active{border-color:#bdb4ed;background:#f4f1ff;box-shadow:0 0 0 2px rgba(103,84,212,.06)}.audience-picker button.active>span{background:#6856d5;color:#fff}.target-select-card{margin-top:9px;padding:10px;border:1px solid #e2e3eb;border-radius:11px;background:#fafbfe}.target-select-card label{display:grid;grid-template-columns:80px minmax(0,1fr);align-items:center;gap:9px}.target-select-card label>span{color:#6e7183;font-size:8px;font-weight:850}.target-select-card small{display:block;margin-top:6px;color:#999cac;font-size:7px}.message-fields{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(150px,.55fr);gap:9px;margin-top:12px}.message-fields label{position:relative;display:grid;gap:6px}.message-fields label>span{color:#696c7f;font-size:9px;font-weight:850}.message-fields label>small{position:absolute;right:7px;top:4px;color:#a2a5b3;font-size:7px}.message-body-field{grid-column:1/-1}.message-fields textarea{min-height:150px;padding:11px;resize:vertical;line-height:1.7}.send-cta{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:48px;margin-top:10px;padding:0 15px;border:0;border-radius:12px;background:linear-gradient(135deg,#6552d0,#775fe5 58%,#7194f5);color:#fff;box-shadow:0 12px 28px rgba(93,74,198,.2);cursor:pointer}.send-cta>span{font-size:10px;font-weight:900}.send-cta small{font-size:8px;opacity:.82}.send-cta:disabled{opacity:.5}@media(max-width:1180px){.ops-hero{align-items:flex-start;flex-direction:column}.ops-metrics{width:100%}.member-table-head,.member-row{grid-template-columns:30px minmax(160px,.8fr) 75px minmax(230px,1.3fr) 120px 52px}.reach-layout{grid-template-columns:1fr}}@media(max-width:820px){.ops-metrics{grid-template-columns:1fr}.ops-tabs{grid-template-columns:1fr}.member-toolbar{grid-template-columns:1fr}.member-table{overflow:auto}.member-table-head,.member-row{min-width:900px}.audience-picker{grid-template-columns:1fr}.message-fields{grid-template-columns:1fr}.message-title-field,.message-body-field{grid-column:1}}
</style>

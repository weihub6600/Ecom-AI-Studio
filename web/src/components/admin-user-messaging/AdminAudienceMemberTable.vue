<script setup lang="ts">
import type {
  AdminAudienceUser,
  Pagination,
  UserGroup
} from "../../types";
import {
  formatDate
} from "../../utils/format";
import {
  statusLabel
} from "./presentation";

const props = defineProps<{
  users: AdminAudienceUser[];
  groups: UserGroup[];
  selectedUserIds: string[];
  allVisibleSelected: boolean;
  pagination: Pagination;
}>();

const emit = defineEmits<{
  toggleAll: [];
  toggleUser: [
    userId: string
  ];
  toggleGroup: [
    user: AdminAudienceUser,
    groupId: string
  ];
  save: [
    user: AdminAudienceUser
  ];
  pageChange: [
    page: number
  ];
}>();

function hasGroup(
  user: AdminAudienceUser,
  groupId: string
): boolean {
  return user.groupIds.includes(
    groupId
  );
}

function toggleAllVisible() {
  emit(
    "toggleAll"
  );
}

function toggleUserSelection(
  userId: string
) {
  emit(
    "toggleUser",
    userId
  );
}

function toggleGroup(
  user: AdminAudienceUser,
  groupId: string
) {
  emit(
    "toggleGroup",
    user,
    groupId
  );
}

function saveOneUserGroups(
  user: AdminAudienceUser
) {
  emit(
    "save",
    user
  );
}

function loadUsers(
  page: number
) {
  emit(
    "pageChange",
    page
  );
}
</script>

<template>
<div class="member-table">
  <div class="member-table-head">
    <label class="select-box">
      <input
        type="checkbox"
        :checked="
          props.allVisibleSelected
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
    v-for="user in props.users"
    :key="user.id"
    class="member-row"
    :class="{
      selected:
        props.selectedUserIds
          .includes(user.id)
    }"
  >
    <label class="select-box">
      <input
        type="checkbox"
        :checked="
          props.selectedUserIds
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
        v-for="group in props.groups"
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
        v-if="props.groups.length === 0"
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
        props.groups.length === 0
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
      props.users.length ===
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
      props.pagination.page <= 1
    "
    @click="
      loadUsers(
        props.pagination.page - 1
      )
    "
  >
    ← 上一页
  </button>

  <span>
    第 {{ props.pagination.page }}
    / {{ props.pagination.totalPages }} 页
  </span>

  <button
    type="button"
    :disabled="
      props.pagination.page >=
      props.pagination.totalPages
    "
    @click="
      loadUsers(
        props.pagination.page + 1
      )
    "
  >
    下一页 →
  </button>
</div>
</template>

<style scoped>
.member-table {
  overflow: hidden;
  margin-top: 11px;
  border: 1px solid #e4e5ec;
  border-radius: 13px;
}

.member-table-head,
.member-row {
  display: grid;
  grid-template-columns:
    34px
    minmax(180px, .75fr)
    80px
    minmax(320px, 1.5fr)
    145px
    58px;
  align-items: center;
  gap: 10px;
}

.member-table-head {
  min-height: 38px;
  padding: 0 11px;
  background: #f7f8fb;
  color: #8c8f9f;
  font-size: 8px;
  font-weight: 850;
}

.member-row {
  min-height: 63px;
  padding: 8px 11px;
  border-top: 1px solid #ececf1;
  background: #fff;
  transition: .15s ease;
}

.member-row:hover {
  background: #faf9ff;
}

.member-row.selected {
  background: #f6f4ff;
}

.select-box {
  position: relative;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  cursor: pointer;
}

.select-box input {
  position: absolute;
  opacity: 0;
}

.select-box span {
  width: 15px;
  height: 15px;
  border: 1px solid #ccd0dc;
  border-radius: 5px;
  background: #fff;
}

.select-box input:checked + span {
  border-color: #6856d4;
  background: #6856d4;
  box-shadow:
    inset 0 0 0 3px #fff;
}

.member-user {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.member-user > b {
  display: grid;
  place-items: center;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background:
    linear-gradient(
      145deg,
      #ece9ff,
      #e5e8ff
    );
  color: #6553ca;
  font-size: 10px;
}

.member-user > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.member-user strong {
  overflow: hidden;
  color: #393c50;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-user small {
  color: #9699a8;
  font-size: 8px;
}

.member-status {
  justify-self: start;
  padding: 4px 7px;
  border-radius: 999px;
  font-size: 7px;
  font-style: normal;
  font-weight: 850;
}

.member-status.active {
  background: #eaf8ef;
  color: #28724d;
}

.member-status.pending {
  background: #fff5df;
  color: #986716;
}

.member-status.disabled {
  background: #fff0f0;
  color: #a13f3f;
}

.member-status.rejected {
  background: #efeff4;
  color: #757687;
}

.group-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.group-chip-list label {
  position: relative;
  cursor: pointer;
}

.group-chip-list input {
  position: absolute;
  opacity: 0;
}

.group-chip-list span {
  display: inline-flex;
  min-height: 25px;
  align-items: center;
  padding: 0 8px;
  border: 1px solid #dfe1e9;
  border-radius: 999px;
  background: #fff;
  color: #777b8d;
  font-size: 7px;
  font-weight: 800;
}

.group-chip-list label.active span {
  border-color: #bdb4ec;
  background: #efecff;
  color: #5e4ec5;
}

.group-chip-list em {
  color: #a0a3b1;
  font-size: 8px;
  font-style: normal;
}

.member-row time {
  color: #9295a5;
  font-size: 8px;
}

.row-save {
  min-height: 30px;
  border: 1px solid #dcd9f0;
  border-radius: 8px;
  background: #f6f4ff;
  color: #5e4ec2;
  font-size: 8px;
  font-weight: 850;
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

@media (max-width: 1180px) {
  .member-table-head,
  .member-row {
    grid-template-columns:
      30px
      minmax(160px, .8fr)
      75px
      minmax(230px, 1.3fr)
      120px
      52px;
  }
}

@media (max-width: 820px) {
  .member-table {
    overflow: auto;
  }

  .member-table-head,
  .member-row {
    min-width: 900px;
  }
}
</style>

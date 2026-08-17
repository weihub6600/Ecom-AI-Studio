<script setup lang="ts">
import type {
  UserGroup
} from "../../types";

const props = defineProps<{
  userSearch: string;
  userStatus: string;
  selectedCount: number;
  bulkGroupId: string;
  groups: UserGroup[];
  saving: boolean;
}>();

const emit = defineEmits<{
  "update:userSearch": [
    value: string
  ];
  "update:userStatus": [
    value: string
  ];
  "update:bulkGroupId": [
    value: string
  ];
  search: [];
  clearSelection: [];
  bulkAdd: [];
}>();

function updateUserSearch(
  event: Event
) {
  emit(
    "update:userSearch",
    (
      event.target as
        HTMLInputElement
    ).value
  );
}

function updateUserStatus(
  event: Event
) {
  emit(
    "update:userStatus",
    (
      event.target as
        HTMLSelectElement
    ).value
  );
}

function updateBulkGroupId(
  event: Event
) {
  emit(
    "update:bulkGroupId",
    (
      event.target as
        HTMLSelectElement
    ).value
  );
}

function searchUsers() {
  emit("search");
}

function clearSelection() {
  emit("clearSelection");
}

function bulkAddGroup() {
  emit("bulkAdd");
}
</script>

<template>
<div class="member-toolbar">
  <div class="member-search">
    <span>⌕</span>
    <input
      :value="props.userSearch"
      @input="updateUserSearch"
      type="search"
      placeholder="搜索用户名或昵称"
      @keyup.enter="
        searchUsers()
      "
    />
  </div>

  <select
    :value="props.userStatus"
    @change="updateUserStatus"
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
    @click="searchUsers()"
  >
    查询
  </button>
</div>

<div
  v-if="
    props.selectedCount > 0
  "
  class="bulk-bar"
>
  <div>
    <span>
      已选择
      <strong>
        {{ props.selectedCount }}
      </strong>
      位用户
    </span>

    <button
      type="button"
      @click="
        clearSelection()
      "
    >
      取消选择
    </button>
  </div>

  <div>
    <select
      :value="props.bulkGroupId"
      @change="updateBulkGroupId"
    >
      <option value="">
        选择目标分组
      </option>

      <option
        v-for="group in props.groups"
        :key="group.id"
        :value="group.id"
      >
        {{ group.name }}
      </option>
    </select>

    <button
      type="button"
      class="ops-primary"
      :disabled="props.saving"
      @click="bulkAddGroup"
    >
      批量加入分组
    </button>
  </div>
</div>
</template>

<style scoped>
.member-toolbar {
  display: grid;
  grid-template-columns:
    minmax(250px, 1fr)
    140px
    auto;
  gap: 8px;
  margin-top: 15px;
}

.member-search {
  position: relative;
}

.member-search > span {
  position: absolute;
  left: 12px;
  top: 10px;
  color: #85889a;
  font-size: 13px;
}

.member-search input,
.member-toolbar select,
.bulk-bar select {
  width: 100%;
  border: 1px solid #dfe1e9;
  border-radius: 10px;
  background: #fff;
  color: #34374b;
  font: inherit;
  font-size: 10px;
  outline: none;
}

.member-search input {
  height: 39px;
  padding: 0 12px 0 34px;
}

.member-toolbar select {
  height: 39px;
  padding: 0 10px;
}

.member-toolbar select:focus,
.member-search input:focus,
.bulk-bar select:focus {
  border-color: #8374df;
  box-shadow:
    0 0 0 3px
    rgba(112, 94, 210, .08);
}

.toolbar-search {
  min-height: 39px;
  padding: 0 13px;
  border: 0;
  border-radius: 10px;
  background: #393b50;
  color: #fff;
  font-size: 9px;
  font-weight: 850;
}

.bulk-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  padding: 9px 11px;
  border: 1px solid #d8d3f3;
  border-radius: 11px;
  background:
    linear-gradient(
      135deg,
      #f7f5ff,
      #f3f5ff
    );
}

.bulk-bar > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bulk-bar span {
  color: #6f7284;
  font-size: 9px;
}

.bulk-bar span strong {
  color: #5c49c7;
}

.bulk-bar > div:first-child button {
  border: 0;
  background: transparent;
  color: #8a8d9d;
  font-size: 8px;
}

.bulk-bar select {
  width: 170px;
  height: 34px;
  padding: 0 10px;
}

.ops-primary {
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background:
    linear-gradient(
      135deg,
      #6b58d7,
      #7867e7
    );
  color: #fff;
  font-size: 9px;
  font-weight: 900;
  box-shadow:
    0 8px 18px
    rgba(102, 84, 210, .18);
  cursor: pointer;
}

.ops-primary:disabled {
  opacity: .45;
}

@media (max-width: 820px) {
  .member-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>

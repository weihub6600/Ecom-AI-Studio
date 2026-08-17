<script setup lang="ts">
import type {
  UserGroup
} from "../../types";

const props = defineProps<{
  groups: UserGroup[];
  activeGroupFilter: string;
  totalUsers: number;
}>();

const emit = defineEmits<{
  create: [];
  select: [groupId: string];
  edit: [group: UserGroup];
  remove: [group: UserGroup];
}>();

function openCreateGroup() {
  emit("create");
}

function setGroupFilter(
  groupId: string
) {
  emit(
    "select",
    groupId
  );
}

function startEditGroup(
  group: UserGroup
) {
  emit(
    "edit",
    group
  );
}

function removeGroup(
  group: UserGroup
) {
  emit(
    "remove",
    group
  );
}
</script>

<template>
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
          props.activeGroupFilter ===
          'all'
      }"
      @click="
        setGroupFilter('all')
      "
    >
      <span>ALL USERS</span>
      <strong>全部用户</strong>
      <b>
        {{ props.totalUsers }}
      </b>
      <small>查看当前筛选结果</small>
    </button>

    <article
      v-for="group in props.groups"
      :key="group.id"
      class="segment-card"
      :class="{
        active:
          props.activeGroupFilter ===
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
</template>

<style scoped>
.segment-strip {
  padding: 19px;
  border: 1px solid #e1e2ea;
  border-radius: 19px;
  background: #fff;
  box-shadow:
    0 12px 34px
    rgba(46, 48, 74, .045);
}

.segment-strip-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.segment-strip-head > div > span {
  color: #6d5bd5;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .15em;
}

.segment-strip-head h3 {
  margin: 4px 0 0;
  color: #303347;
  font-size: 18px;
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

.segment-cards {
  display: flex;
  gap: 9px;
  overflow: auto;
  margin-top: 14px;
  padding: 2px 1px 4px;
}

.segment-card {
  position: relative;
  flex: 0 0 210px;
  min-height: 112px;
  padding: 0;
  border: 1px solid #e2e3ec;
  border-radius: 14px;
  background: #fafbfe;
  text-align: left;
  transition: .18s ease;
}

.segment-card:hover,
.segment-card.active {
  border-color: #c2b9ee;
  background: #f7f5ff;
  box-shadow:
    0 8px 20px
    rgba(70, 58, 137, .07);
}

.segment-card.all {
  display: grid;
  align-content: center;
  padding: 14px;
  cursor: pointer;
}

.segment-card-main {
  display: grid;
  width: 100%;
  min-height: 80px;
  padding: 13px 13px 7px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.segment-card span {
  color: #8273d9;
  font-size: 7px;
  font-weight: 900;
  letter-spacing: .12em;
}

.segment-card strong {
  margin-top: 4px;
  color: #3b3e52;
  font-size: 11px;
}

.segment-card b {
  position: absolute;
  right: 13px;
  top: 12px;
  color: #6653cf;
  font-size: 21px;
}

.segment-card small {
  overflow: hidden;
  margin-top: 5px;
  color: #9093a3;
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.segment-card footer {
  display: flex;
  gap: 4px;
  padding: 0 9px 9px;
}

.segment-card footer button {
  min-height: 25px;
  padding: 0 7px;
  border: 1px solid #e2e3eb;
  border-radius: 7px;
  background: #fff;
  color: #777a8c;
  font-size: 7px;
  font-weight: 800;
}

.segment-card footer button.danger {
  color: #b34d58;
}
</style>

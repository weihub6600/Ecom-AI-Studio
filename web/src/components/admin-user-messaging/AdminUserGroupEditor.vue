<script setup lang="ts">
interface GroupDraft {
  name: string;
  description: string;
  sortOrder: number;
}

const props = defineProps<{
  editing: boolean;
  saving: boolean;
  draft: GroupDraft;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
}>();

// The parent owns one stable reactive draft object.
// Keep a local reference so v-model preserves the
// existing nested mutation behavior.
const draft = props.draft;
</script>

<template>
  <div
    class="ops-modal-backdrop"
    @click.self="emit('close')"
  >
    <form
      class="group-modal"
      @submit.prevent="emit('submit')"
    >
      <header>
        <div>
          <span>SEGMENT EDITOR</span>

          <h3>
            {{
              props.editing
                ? '编辑用户分组'
                : '创建用户分组'
            }}
          </h3>
        </div>

        <button
          type="button"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <label>
        <span>分组名称</span>

        <input
          v-model="draft.name"
          maxlength="60"
          autofocus
          placeholder="例如：核心用户、设计团队"
        />
      </label>

      <label>
        <span>内部说明</span>

        <textarea
          v-model="draft.description"
          maxlength="300"
          rows="4"
          placeholder="说明这个分组的用途、运营策略或用户特征"
        ></textarea>
      </label>

      <label>
        <span>排序权重</span>

        <input
          v-model.number="draft.sortOrder"
          type="number"
          min="0"
          max="9999"
        />
      </label>

      <footer>
        <button
          type="button"
          @click="emit('close')"
        >
          取消
        </button>

        <button
          type="submit"
          class="ops-primary"
          :disabled="props.saving"
        >
          {{
            props.saving
              ? '保存中…'
              : props.editing
                ? '保存修改'
                : '创建分组'
          }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.ops-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--v15-z-modal);
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(24, 24, 40, .38);
  backdrop-filter: blur(6px);
}

.group-modal {
  width: min(460px, 100%);
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, .7);
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(30, 28, 57, .2);
}

.group-modal header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.group-modal header span {
  color: #6d5bd5;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .15em;
}

.group-modal h3 {
  margin: 5px 0 0;
  color: #303347;
  font-size: 19px;
}

.group-modal header button {
  border: 0;
  background: transparent;
  color: #8e91a1;
  font-size: 23px;
}

.group-modal label {
  display: grid;
  gap: 6px;
  margin-top: 11px;
}

.group-modal label > span {
  color: #696c7f;
  font-size: 9px;
  font-weight: 850;
}

.group-modal input,
.group-modal textarea {
  width: 100%;
  border: 1px solid #dfe1e9;
  border-radius: 10px;
  background: #fff;
  color: #34374b;
  font: inherit;
  font-size: 10px;
  outline: none;
}

.group-modal input {
  height: 39px;
  padding: 0 10px;
}

.group-modal textarea {
  padding: 10px;
  resize: vertical;
  line-height: 1.6;
}

.group-modal input:focus,
.group-modal textarea:focus {
  border-color: #8374df;
  box-shadow: 0 0 0 3px rgba(112, 94, 210, .08);
}

.group-modal footer {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid #ececf1;
}

.group-modal footer > button:not(.ops-primary) {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid #e0e1e9;
  border-radius: 9px;
  background: #fff;
  color: #727688;
  font-size: 9px;
  font-weight: 800;
}

.ops-primary {
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: linear-gradient(
    135deg,
    #6b58d7,
    #7867e7
  );
  color: #fff;
  font-size: 9px;
  font-weight: 900;
  box-shadow:
    0 8px 18px rgba(102, 84, 210, .18);
  cursor: pointer;
}

.ops-primary:disabled {
  opacity: .45;
}
</style>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import PlatformModal from "./PlatformModal.vue";
import type { ServerHistoryRecord } from "../types";
import { formatSizeTitle, providerDisplayName } from "../utils/format";

const props = defineProps<{
  record: ServerHistoryRecord;
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [prompt: string];
}>();

const adjustmentPrompt = ref("");
const promptInput = ref<HTMLTextAreaElement | null>(null);

const sourceCount = computed(() => props.record.sourceImages?.length || 0);
const resultCount = computed(() => props.record.images?.length || 0);

watch(
  () => props.record.id,
  async () => {
    adjustmentPrompt.value = "";
    await nextTick();
    promptInput.value?.focus();
  },
  { immediate: true }
);

function submit() {
  const value = adjustmentPrompt.value.trim();
  if (value.length < 2 || props.busy) return;
  emit("confirm", value);
}
</script>

<template>
  <PlatformModal
    layer="critical"
    padding="24px"
    mobile-padding="12px"
    background="rgba(24, 23, 42, .48)"
    blur="10px"
    close-event="mousedown"
    @close="emit('close')"
  >
<section class="refine-dialog" role="dialog" aria-modal="true" aria-label="再次调整图片">
        <header class="refine-head">
          <div>
            <span>二次创作</span>
            <h3>再次调整</h3>
            <p>基于原始素材和当前生成结果，输入这一次需要修改的内容。</p>
          </div>
          <button type="button" class="refine-close" :disabled="props.busy" @click="emit('close')">×</button>
        </header>

        <div class="refine-context">
          <div>
            <span>模型</span>
            <strong>{{ providerDisplayName(props.record.provider, props.record.providerName) }} · {{ props.record.model }}</strong>
          </div>
          <div>
            <span>尺寸</span>
            <strong>{{ formatSizeTitle(props.record.size) }}</strong>
          </div>
          <div>
            <span>参考素材</span>
            <strong>原始 {{ sourceCount }} 张 + 当前结果 {{ resultCount }} 张</strong>
          </div>
        </div>

        <div v-if="sourceCount === 0" class="refine-warning">
          这是一条旧历史记录，当时尚未保存原始参考素材；本次会仅基于当前生成结果继续调整。
        </div>

        <div class="refine-original-prompt">
          <span>上一次提示词</span>
          <p>{{ props.record.prompt }}</p>
        </div>

        <label class="refine-prompt-field">
          <span>这次要怎么调整？</span>
          <textarea
            ref="promptInput"
            v-model="adjustmentPrompt"
            maxlength="5000"
            rows="5"
            placeholder="例如：保持产品、包装和 Logo 不变，把背景改成浅色厨房场景，光线更自然，产品位置向左移动一些。"
            @keydown.ctrl.enter.prevent="submit"
            @keydown.meta.enter.prevent="submit"
          ></textarea>
          <small>{{ adjustmentPrompt.length }}/5000 · Ctrl/Cmd + Enter 可直接开始</small>
        </label>

        <footer class="refine-actions">
          <button type="button" class="secondary" :disabled="props.busy" @click="emit('close')">取消</button>
          <button
            type="button"
            class="primary"
            :disabled="props.busy || adjustmentPrompt.trim().length < 2"
            @click="submit"
          >
            {{ props.busy ? "正在载入参考素材…" : "开始二次生成" }}
          </button>
        </footer>
      </section>
  </PlatformModal>
</template>

<style scoped>
.refine-dialog {
  width: min(680px, 100%);
  max-height: min(86dvh, 760px);
  overflow: auto;
  border: 1px solid rgba(226, 227, 238, .96);
  border-radius: 22px;
  background: rgba(255, 255, 255, .98);
  box-shadow: 0 28px 90px rgba(35, 32, 79, .24);
  padding: 24px;
}

.refine-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid #ececf3;
}

.refine-head span {
  display: block;
  margin-bottom: 5px;
  color: #6658d3;
  font-size: 11px;
  font-weight: 850;
  letter-spacing: .14em;
}

.refine-head h3 {
  margin: 0;
  color: #242638;
  font-size: 23px;
}

.refine-head p {
  margin: 7px 0 0;
  color: #7b7e91;
  font-size: 13px;
  line-height: 1.6;
}

.refine-close {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 1px solid #e5e5ed;
  border-radius: 10px;
  background: #fafafd;
  color: #77798c;
  font-size: 22px;
  line-height: 1;
}

.refine-context {
  display: grid;
  grid-template-columns: 1.3fr .8fr 1fr;
  gap: 10px;
  margin-top: 18px;
}

.refine-context > div {
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid #e9e9f1;
  border-radius: 12px;
  background: #fafafd;
}

.refine-context span,
.refine-original-prompt > span,
.refine-prompt-field > span {
  display: block;
  color: #9294a4;
  font-size: 11px;
  font-weight: 700;
}

.refine-context strong {
  display: block;
  margin-top: 5px;
  overflow: hidden;
  color: #37394a;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refine-warning {
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px solid #f1dfb5;
  border-radius: 10px;
  background: #fffaf0;
  color: #886528;
  font-size: 12px;
  line-height: 1.55;
}

.refine-original-prompt {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f6f5fb;
}

.refine-original-prompt p {
  margin: 7px 0 0;
  color: #5f6275;
  font-size: 12px;
  line-height: 1.6;
  max-height: 58px;
  overflow: auto;
}

.refine-prompt-field {
  display: block;
  margin-top: 17px;
}

.refine-prompt-field textarea {
  width: 100%;
  min-height: 132px;
  margin-top: 8px;
  padding: 13px 14px;
  resize: vertical;
  border: 1px solid #dedfea;
  border-radius: 13px;
  outline: none;
  background: #fff;
  color: #2c2e40;
  font: inherit;
  line-height: 1.6;
}

.refine-prompt-field textarea:focus {
  border-color: #8e82e8;
  box-shadow: 0 0 0 3px rgba(108, 92, 231, .1);
}

.refine-prompt-field small {
  display: block;
  margin-top: 6px;
  color: #9b9dac;
  font-size: 10px;
  text-align: right;
}

.refine-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.refine-actions button {
  min-height: 42px;
  padding: 0 18px;
  border-radius: 11px;
  font-weight: 750;
}

.refine-actions .secondary {
  border: 1px solid #dedfea;
  background: #fff;
  color: #66697d;
}

.refine-actions .primary {
  border: 0;
  background: linear-gradient(100deg, #695ae0, #8170f3);
  color: #fff;
  box-shadow: 0 10px 24px rgba(91, 75, 205, .2);
}

.refine-actions button:disabled {
  cursor: not-allowed;
  opacity: .55;
}

@media (max-width: 640px) {
    .refine-dialog { padding: 18px; border-radius: 17px; }
  .refine-context { grid-template-columns: 1fr; }
  .refine-actions { display: grid; grid-template-columns: 1fr 1fr; }
}
</style>

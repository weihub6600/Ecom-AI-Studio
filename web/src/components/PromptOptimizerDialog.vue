<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { apiRequest, jsonRequest } from "../api/client";

type OptimizeMode = "standard" | "ecommerce" | "concise";

const props = defineProps<{
  open: boolean;
  prompt: string;
  generationMode: "text-to-image" | "image-edit";
  provider: string;
  model: string;
  modelName?: string;
  size: string;
}>();

const emit = defineEmits<{
  close: [];
  apply: [prompt: string];
}>();

const mode = ref<OptimizeMode>("ecommerce");
const loading = ref(false);
const errorMessage = ref("");
const optimizedPrompt = ref("");

const modes: Array<{ id: OptimizeMode; label: string; hint: string }> = [
  { id: "standard", label: "标准优化", hint: "补全画面表达，尽量保持原意" },
  { id: "ecommerce", label: "电商增强", hint: "强化商品主体、构图、灯光与商业质感" },
  { id: "concise", label: "精简优化", hint: "去重并提升指令清晰度" }
];

const canOptimize = computed(() => props.prompt.trim().length >= 2 && !loading.value);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    mode.value = "ecommerce";
    optimizedPrompt.value = "";
    errorMessage.value = "";
  }
);

async function optimize() {
  if (!canOptimize.value) return;
  loading.value = true;
  errorMessage.value = "";

  try {
    const data = await apiRequest<{ optimizedPrompt: string }>(
      "/api/prompt/optimize",
      jsonRequest({
        prompt: props.prompt.trim(),
        mode: mode.value,
        generationMode: props.generationMode,
        provider: props.provider,
        model: props.model,
        modelName: props.modelName || "",
        size: props.size
      })
    );
    optimizedPrompt.value = data.optimizedPrompt.trim();
  } catch (error) {
    errorMessage.value = error instanceof Error
      ? error.message
      : "AI 提示词优化失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}

function applyResult() {
  const value = optimizedPrompt.value.trim();
  if (value) emit("apply", value);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="optimizer-mask" @click.self="emit('close')">
      <section class="optimizer-dialog" role="dialog" aria-modal="true">
        <header>
          <div>
            <span>AI PROMPT OPTIMIZER</span>
            <h3>AI 智能优化提示词</h3>
            <p>保留原始需求，补全更适合图片模型执行的画面指令。</p>
          </div>
          <button type="button" class="close" @click="emit('close')">×</button>
        </header>

        <div class="mode-grid">
          <button
            v-for="item in modes"
            :key="item.id"
            type="button"
            :class="{ active: mode === item.id }"
            @click="mode = item.id"
          >
            <strong>{{ item.label }}</strong>
            <span>{{ item.hint }}</span>
          </button>
        </div>

        <div class="compare-grid">
          <article>
            <div class="label"><strong>原始提示词</strong><span>{{ props.prompt.length }} 字符</span></div>
            <div class="text">{{ props.prompt }}</div>
          </article>

          <article class="result">
            <div class="label">
              <strong>AI 优化结果</strong>
              <span v-if="optimizedPrompt">{{ optimizedPrompt.length }} 字符</span>
            </div>
            <div v-if="optimizedPrompt" class="text">{{ optimizedPrompt }}</div>
            <div v-else class="empty">✦<small>选择优化方式后点击“开始优化”</small></div>
          </article>
        </div>

        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

        <footer>
          <button type="button" class="soft" @click="emit('close')">取消</button>
          <button type="button" class="secondary" :disabled="!canOptimize" @click="optimize">
            {{ loading ? "正在优化..." : optimizedPrompt ? "再次优化" : "开始优化" }}
          </button>
          <button type="button" class="primary" :disabled="!optimizedPrompt" @click="applyResult">
            使用优化结果
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.optimizer-mask{position:fixed;inset:0;z-index:2600;display:grid;place-items:center;padding:24px;background:rgba(23,25,35,.42);backdrop-filter:blur(8px)}
.optimizer-dialog{width:min(880px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;border:1px solid #dedfe7;border-radius:22px;background:#fff;box-shadow:0 28px 80px rgba(24,28,45,.2)}
.optimizer-dialog>header{display:flex;justify-content:space-between;gap:18px;padding:24px 26px 18px;border-bottom:1px solid #ececf2}
.optimizer-dialog>header>div{display:grid;gap:5px}
.optimizer-dialog header span{color:#6a56d3;font-size:10px;font-weight:900;letter-spacing:.14em}
.optimizer-dialog h3{margin:0;color:#2f3443;font-size:22px}
.optimizer-dialog p{margin:0;color:#8a8f9e;font-size:13px;line-height:1.65}
.close{width:34px;height:34px;border:1px solid #e1e2e9;border-radius:10px;background:#f8f8fb;color:#747987;font-size:21px;cursor:pointer}
.mode-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:18px 26px 0}
.mode-grid button{display:grid;gap:4px;padding:13px 14px;border:1px solid #e2e3ea;border-radius:13px;background:#fafafe;text-align:left;cursor:pointer}
.mode-grid button.active{border-color:#a99bea;background:#f4f1ff;box-shadow:0 0 0 2px rgba(106,86,211,.08)}
.mode-grid strong{color:#3b4050;font-size:13px}.mode-grid span{color:#9296a3;font-size:11px;line-height:1.55}
.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:18px 26px}
.compare-grid article{border:1px solid #e6e7ee;border-radius:15px;background:#fafafe;overflow:hidden}.compare-grid article.result{background:#f8f7ff}
.label{display:flex;justify-content:space-between;gap:12px;padding:11px 14px;border-bottom:1px solid #e8e8ef}.label strong{color:#454a59;font-size:12px}.label span{color:#9b9fab;font-size:10px}
.text{min-height:220px;padding:15px;color:#454a58;font-size:13px;line-height:1.78;white-space:pre-wrap;overflow-wrap:anywhere}
.empty{min-height:220px;display:grid;place-items:center;align-content:center;gap:8px;color:#7865d4;font-size:28px}.empty small{color:#999daa;font-size:11px}
.error{margin:0 26px 4px!important;padding:10px 12px;border:1px solid #ffd1d1;border-radius:10px;background:#fff5f5;color:#c14949!important;font-size:12px!important}
.optimizer-dialog>footer{display:flex;justify-content:flex-end;gap:9px;padding:16px 26px 22px;border-top:1px solid #eeeef3}
.optimizer-dialog>footer button{min-height:38px;padding:0 16px;border-radius:10px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}
.optimizer-dialog>footer button:disabled{opacity:.46;cursor:not-allowed}.soft{border:1px solid #e0e1e8;background:#fff;color:#686e7b}
.secondary{border:1px solid #cfc8ef;background:#f6f3ff;color:#6250bc}.primary{border:1px solid #6654bd;background:#6654bd;color:#fff}
@media(max-width:760px){.optimizer-mask{padding:12px}.mode-grid,.compare-grid{grid-template-columns:1fr}}
</style>

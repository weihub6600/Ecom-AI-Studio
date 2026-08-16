<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiRequest, jsonRequest } from "../api/client";
import type { GalleryEligibleWork, GalleryItem } from "../types";
import { formatDate } from "../utils/format";

const submissions = ref<GalleryItem[]>([]);
const eligibleWorks = ref<GalleryEligibleWork[]>([]);
const loading = ref(true);
const submitting = ref(false);
const message = ref("");
const errorMessage = ref("");
const selected = ref<GalleryEligibleWork | null>(null);
const title = ref("");
const description = ref("");
const showPrompt = ref(false);

const counts = computed(() => ({
  pending: submissions.value.filter((item) => item.status === "pending").length,
  approved: submissions.value.filter((item) => item.status === "approved").length,
  featured: submissions.value.filter((item) => item.status === "approved" && item.featured).length
}));

onMounted(loadAll);

async function loadAll() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [submissionData, eligibleData] = await Promise.all([
      apiRequest<{ submissions: GalleryItem[] }>("/api/account/gallery/submissions"),
      apiRequest<{ works: GalleryEligibleWork[] }>("/api/account/gallery/eligible")
    ]);
    submissions.value = submissionData.submissions || [];
    eligibleWorks.value = eligibleData.works || [];
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取作品投稿失败";
  } finally {
    loading.value = false;
  }
}

function displayModel(modelValue: string, providerValue = "") {
  let model = modelValue.trim();
  const provider = providerValue.trim();

  if (
    provider &&
    model.toLowerCase().startsWith(provider.toLowerCase() + "-")
  ) {
    model = model.slice(provider.length + 1);
  }

  if (model.toLowerCase().startsWith("gpt-")) {
    model = model.slice(4);
  }

  return model || "AI 模型";
}

function displayTitle(item: GalleryItem) {
  const titleValue = item.title.trim();
  const legacyDefault = `${item.model} 创作`;
  return titleValue === legacyDefault ? "AI 创作" : titleValue;
}

function openSubmit(work: GalleryEligibleWork) {
  selected.value = work;
  title.value = "";
  description.value = "";
  showPrompt.value = false;
  message.value = "";
  errorMessage.value = "";
}

async function submit() {
  if (!selected.value || submitting.value) return;

  if (title.value.trim().length < 2) {
    errorMessage.value = "作品标题至少填写 2 个字符";
    return;
  }

  submitting.value = true;
  errorMessage.value = "";

  try {
    await apiRequest(
      "/api/account/gallery/submissions",
      jsonRequest({
        historyId: selected.value.historyId,
        imageId: selected.value.imageId,
        title: title.value.trim(),
        description: description.value.trim(),
        showPrompt: showPrompt.value
      })
    );

    selected.value = null;
    message.value = "投稿成功，站长审核通过后会出现在灵感广场。";
    await loadAll();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "提交作品失败";
  } finally {
    submitting.value = false;
  }
}

async function handleSubmissionAction(item: GalleryItem) {
  const withdrawable = item.status === "pending" || item.status === "approved";
  const actionText = withdrawable ? "撤回" : "删除";
  const confirmText = withdrawable
    ? `确定撤回“${displayTitle(item)}”吗？`
    : `确定永久删除这条投稿记录“${displayTitle(item)}”吗？`;

  if (!window.confirm(confirmText)) return;

  errorMessage.value = "";

  try {
    await apiRequest(
      `/api/account/gallery/submissions/${encodeURIComponent(item.id)}`,
      { method: "DELETE" }
    );

    message.value = withdrawable
      ? "投稿已撤回；如果不再需要这条记录，可以再次点击删除。"
      : "投稿记录已删除。";

    await loadAll();
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : `${actionText}投稿失败`;
  }
}

function statusLabel(item: GalleryItem) {
  if (item.status === "pending") return "审核中";
  if (item.status === "approved") return item.featured ? "已通过 · 精选" : "已通过";
  if (item.status === "rejected") return "未通过";
  return "已撤回";
}
</script>

<template>
  <div class="submission-center">
    <header class="submission-hero">
      <div>
        <span>INSPIRATION SUBMISSION</span>
        <h2>灵感广场投稿</h2>
        <p>
          从你的生成作品中选择一张投稿。审核通过后会公开展示，
          昵称作为创作者名称；提示词是否公开由你决定。
        </p>
      </div>
      <a href="/gallery" target="_blank">打开灵感广场 ↗</a>
    </header>

    <div class="submission-metrics">
      <article><span>审核中</span><strong>{{ counts.pending }}</strong></article>
      <article><span>已通过</span><strong>{{ counts.approved }}</strong></article>
      <article><span>站长精选</span><strong>{{ counts.featured }}</strong></article>
      <article><span>可投稿图片</span><strong>{{ eligibleWorks.length }}</strong></article>
    </div>

    <p v-if="message" class="submission-message success">{{ message }}</p>
    <p v-if="errorMessage" class="submission-message error">{{ errorMessage }}</p>

    <div v-if="loading" class="submission-empty">正在读取作品…</div>

    <div v-else class="submission-workspace">
      <section class="submission-section submission-pane">
        <div class="submission-heading">
          <div>
            <span>MY SUBMISSIONS</span>
            <h3>我的投稿</h3>
          </div>
          <button type="button" @click="loadAll">刷新</button>
        </div>

        <div v-if="submissions.length" class="submission-list">
          <article v-for="item in submissions" :key="item.id">
            <img :src="item.imageUrl" :alt="displayTitle(item)" loading="lazy" />
            <div class="submission-copy">
              <div>
                <span class="submission-status" :class="item.status">
                  {{ statusLabel(item) }}
                </span>
                <small>{{ formatDate(item.submittedAt) }}</small>
              </div>

              <h4>{{ displayTitle(item) }}</h4>
              <p>{{ item.description || displayModel(item.model, item.provider) }}</p>

              <small v-if="item.rejectionReason" class="submission-reason">
                原因：{{ item.rejectionReason }}
              </small>

              <button
                type="button"
                :class="{ danger: true, delete: item.status === 'rejected' || item.status === 'withdrawn' }"
                @click="handleSubmissionAction(item)"
              >
                {{
                  item.status === 'pending' || item.status === 'approved'
                    ? '撤回投稿'
                    : '删除记录'
                }}
              </button>
            </div>
          </article>
        </div>

        <div v-else class="submission-empty compact">
          还没有投稿记录。
        </div>
      </section>

      <section class="submission-section eligible-pane">
        <div class="submission-heading">
          <div>
            <span>READY TO SHARE</span>
            <h3>选择作品投稿</h3>
          </div>
          <small>尚未投稿的云端图片</small>
        </div>

        <div v-if="eligibleWorks.length" class="eligible-grid">
          <button
            v-for="work in eligibleWorks"
            :key="work.imageId"
            type="button"
            @click="openSubmit(work)"
          >
            <img :src="work.imageUrl" :alt="displayModel(work.model, work.provider)" loading="lazy" />
            <span>
              <strong>{{ displayModel(work.model, work.provider) }}</strong>
              <small>{{ formatDate(work.createdAt) }}</small>
            </span>
          </button>
        </div>

        <div v-else class="submission-empty compact">
          暂无可投稿图片。生成新作品后会自动出现在这里。
        </div>
      </section>
    </div>

    <div v-if="selected" class="submission-modal" @click.self="selected = null">
      <form @submit.prevent="submit">
        <button class="submission-close" type="button" @click="selected = null">×</button>

        <div class="submission-preview">
          <img :src="selected.imageUrl" :alt="displayModel(selected.model, selected.provider)" />
        </div>

        <div class="submission-form">
          <span>SUBMIT TO INSPIRATION</span>
          <h3>提交到灵感广场</h3>

          <label>
            作品标题
            <input
              v-model="title"
              maxlength="80"
              placeholder="例如：夏日饮品海报、产品主图、创意人像"
            />
          </label>

          <label>
            简短介绍
            <textarea
              v-model="description"
              maxlength="500"
              rows="4"
              placeholder="介绍一下作品思路、用途或亮点（可选）"
            ></textarea>
          </label>

          <label class="submission-check">
            <input v-model="showPrompt" type="checkbox" />
            <span>
              <strong>公开提示词</strong>
              <small>勾选后，访客可在作品详情中查看本次提示词。</small>
            </span>
          </label>

          <div class="submission-model-note">
            <span>生成模型</span>
            <strong>{{ displayModel(selected.model, selected.provider) }}</strong>
          </div>

          <button type="submit" class="primary" :disabled="submitting">
            {{ submitting ? "提交中…" : "提交审核" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.submission-center{display:grid;gap:20px}.submission-hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;padding:28px;border:1px solid #dedaf5;border-radius:20px;background:linear-gradient(135deg,#fff,#f7f5ff)}.submission-hero span,.submission-heading span,.submission-form>span{color:#715fd8;font-size:10px;font-weight:900;letter-spacing:.14em}.submission-hero h2{margin:8px 0;color:#292c40;font-size:24px}.submission-hero p{max-width:760px;margin:0;color:#73788b;font-size:13px;line-height:1.75}.submission-hero a{display:inline-flex;align-items:center;flex:0 0 auto;min-height:40px;padding:0 14px;border:1px solid #ded9fb;border-radius:11px;background:#fff;color:#5e50c5;text-decoration:none;font-size:12px;font-weight:800}.submission-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.submission-metrics article{padding:18px;border:1px solid #e1e3ec;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(54,56,89,.035)}.submission-metrics span{display:block;color:#85899b;font-size:11px}.submission-metrics strong{display:block;margin-top:8px;color:#34374b;font-size:26px}.submission-message{margin:0;padding:12px 14px;border-radius:11px;font-size:12px}.submission-message.success{background:#edf9f2;color:#327353}.submission-message.error{background:#fff1f2;color:#ae4c58}.submission-workspace{display:grid;grid-template-columns:minmax(0,1.16fr) minmax(380px,.84fr);gap:16px;align-items:start}.submission-section{min-width:0;padding:22px;border:1px solid #e1e3ec;border-radius:18px;background:#fff;box-shadow:0 9px 26px rgba(48,51,80,.035)}.submission-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:15px}.submission-heading h3{margin:5px 0 0;color:#303347;font-size:19px}.submission-heading>small{color:#8b8fa1;font-size:10px}.submission-heading button{min-height:34px;padding:0 12px;border:1px solid #e0e2ea;border-radius:9px;background:#fafbfe;color:#686c7e;font-size:10px;font-weight:800;cursor:pointer}.submission-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;max-height:610px;overflow:auto;padding-right:3px}.submission-list article{display:grid;grid-template-columns:88px minmax(0,1fr);gap:11px;padding:9px;border:1px solid #eceef3;border-radius:13px;background:#fafbfe}.submission-list img{width:88px;height:82px;object-fit:contain;border-radius:9px;background:#f1f2f6}.submission-copy>div{display:flex;align-items:center;justify-content:space-between;gap:8px}.submission-copy h4{overflow:hidden;margin:8px 0 3px;color:#35384b;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.submission-copy p{overflow:hidden;margin:0;color:#818598;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.submission-copy small{color:#9599aa;font-size:8px}.submission-status{padding:4px 7px;border-radius:999px;font-size:8px;font-weight:900;background:#f0f1f5}.submission-status.pending{color:#a66d13;background:#fff4dc}.submission-status.approved{color:#26714d;background:#eaf8ef}.submission-status.rejected{color:#ad4d58;background:#fff0f2}.submission-status.withdrawn{color:#777c8f;background:#eef0f5}.submission-reason{display:block;margin-top:5px;color:#c25a63!important}.submission-copy .danger{margin-top:7px;padding:0;border:0;background:transparent;color:#ca6670;font-size:9px;font-weight:800;cursor:pointer}.submission-copy .danger.delete{color:#a94853}.eligible-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;max-height:610px;overflow:auto;padding-right:3px}.eligible-grid button{overflow:hidden;padding:0;border:1px solid #e5e7ef;border-radius:13px;background:#fff;color:inherit;text-align:left;cursor:pointer;transition:.18s ease}.eligible-grid button:hover{transform:translateY(-2px);border-color:#bbb3ee;box-shadow:0 9px 20px rgba(76,65,145,.08)}.eligible-grid img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;padding:5px;background:#f3f4f8}.eligible-grid button>span{display:grid;gap:3px;padding:9px}.eligible-grid strong{overflow:hidden;color:#3a3d50;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.eligible-grid small{color:#9699aa;font-size:8px}.submission-empty{padding:36px 12px;color:#85899c;text-align:center}.submission-empty.compact{padding:52px 12px}.submission-modal{position:fixed;inset:0;z-index:var(--v15-z-modal);display:grid;place-items:center;padding:24px;background:rgba(31,33,48,.66);backdrop-filter:blur(12px)}.submission-modal form{position:relative;display:grid;grid-template-columns:minmax(320px,.95fr) minmax(360px,1.05fr);width:min(920px,94vw);max-height:88vh;overflow:auto;border:1px solid rgba(255,255,255,.7);border-radius:20px;background:#fff;box-shadow:0 30px 90px rgba(22,24,48,.32)}.submission-close{position:absolute;top:13px;right:13px;z-index:2;width:36px;height:36px;border:1px solid #e0e2e9;border-radius:50%;background:#fff;color:#73778a;font-size:22px;cursor:pointer}.submission-preview{display:flex;align-items:center;justify-content:center;min-height:420px;padding:13px;background:#f1f2f6}.submission-preview img{width:100%;height:100%;max-height:70vh;object-fit:contain}.submission-form{display:grid;align-content:start;gap:16px;padding:34px}.submission-form h3{margin:-7px 0 4px;color:#292c40;font-size:24px}.submission-form label{display:grid;gap:7px;color:#666b7e;font-size:12px}.submission-form input,.submission-form textarea{width:100%;border:1px solid #dfe1e9;border-radius:10px;outline:0;background:#fff;color:#333649;padding:11px 12px;font:inherit;font-size:12px}.submission-form input:focus,.submission-form textarea:focus{border-color:#8272df;box-shadow:0 0 0 3px rgba(113,95,216,.1)}.submission-check{grid-template-columns:auto 1fr!important;align-items:start}.submission-check input{width:auto;margin-top:3px}.submission-check span{display:grid;gap:3px}.submission-check strong{color:#373a4d;font-size:12px}.submission-check small{color:#85899b;font-size:10px}.submission-model-note{display:flex;justify-content:space-between;gap:12px;padding:11px 12px;border-radius:10px;background:#f6f7fb;color:#888c9e;font-size:10px}.submission-model-note strong{color:#55596c}.submission-form .primary{min-height:44px;border:0;border-radius:11px;background:linear-gradient(135deg,#6d5ae0,#7d9bff);color:#fff;font-weight:900;cursor:pointer}.submission-form .primary:disabled{opacity:.5;cursor:default}@media(max-width:1180px){.submission-workspace{grid-template-columns:1fr}.submission-list{grid-template-columns:repeat(2,minmax(0,1fr))}.eligible-grid{grid-template-columns:repeat(5,minmax(0,1fr))}}@media(max-width:760px){.submission-hero{align-items:flex-start;flex-direction:column}.submission-metrics{grid-template-columns:1fr 1fr}.submission-list{grid-template-columns:1fr}.eligible-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.submission-modal form{grid-template-columns:1fr}.submission-preview{min-height:260px}}
</style>

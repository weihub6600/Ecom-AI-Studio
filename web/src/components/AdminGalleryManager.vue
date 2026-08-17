<script setup lang="ts">
import { platformConfirm } from "../services/platform-feedback";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { apiRequest, jsonRequest } from "../api/client";
import type { GalleryAdminSummary, GalleryItem, Pagination } from "../types";
import { formatDate } from "../utils/format";

type FilterStatus = "" | "pending" | "approved" | "rejected" | "withdrawn";

const items = ref<GalleryItem[]>([]);
const pagination = ref<Pagination>({ page: 1, pageSize: 30, total: 0, totalPages: 1 });
const summary = ref<GalleryAdminSummary>({
  pending: 0,
  approved: 0,
  rejected: 0,
  withdrawn: 0,
  featured: 0
});
const status = ref<FilterStatus>("pending");
const search = ref("");
const loading = ref(false);
const message = ref("");
const errorMessage = ref("");
const previewItem = ref<GalleryItem | null>(null);

const quickFilters: Array<{ value: FilterStatus; label: string }> = [
  { value: "", label: "全部" },
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
  { value: "withdrawn", label: "已撤回" }
];

onMounted(() => {
  window.addEventListener("keydown", handlePreviewKeydown);
  void load(1);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handlePreviewKeydown);
});

function handlePreviewKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && previewItem.value) {
    previewItem.value = null;
  }
}

function setStatus(next: FilterStatus) {
  status.value = next;
  void load(1);
}

function displayModel(item: GalleryItem): string {
  let model = item.model.trim();
  const provider = item.provider.trim();

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

function displayTitle(item: GalleryItem): string {
  const title = item.title.trim();
  return title === `${item.model} 创作`
    ? "AI 创作"
    : title;
}

function filterCount(value: FilterStatus): number {
  if (value === "pending") return summary.value.pending;
  if (value === "approved") return summary.value.approved;
  if (value === "rejected") return summary.value.rejected;
  if (value === "withdrawn") return summary.value.withdrawn;

  return (
    summary.value.pending +
    summary.value.approved +
    summary.value.rejected +
    summary.value.withdrawn
  );
}

async function load(page = 1) {
  loading.value = true;
  errorMessage.value = "";

  try {
    const params = new URLSearchParams({ page: String(page), pageSize: "30" });
    if (status.value) params.set("status", status.value);
    if (search.value.trim()) params.set("search", search.value.trim());

    const data = await apiRequest<{
      items: GalleryItem[];
      pagination: Pagination;
      summary: GalleryAdminSummary;
    }>(`/api/admin/gallery?${params.toString()}`);

    items.value = data.items || [];
    pagination.value = data.pagination;
    summary.value = data.summary;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取投稿审核失败";
  } finally {
    loading.value = false;
  }
}

async function approve(item: GalleryItem) {
  if (!await platformConfirm(`通过“${displayTitle(item)}”并公开展示吗？`)) return;
  await update(item, { status: "approved" }, "作品已通过审核");
}

async function reject(item: GalleryItem) {
  const reason = window.prompt(
    `拒绝“${displayTitle(item)}”的原因：`,
    item.rejectionReason || "作品暂不符合公开展示标准"
  );

  if (!reason?.trim()) return;

  await update(
    item,
    { status: "rejected", rejectionReason: reason.trim() },
    "作品已拒绝"
  );
}

async function toggleFeatured(item: GalleryItem) {
  await update(
    item,
    { featured: !item.featured },
    item.featured ? "已取消精选" : "已设为精选"
  );
}

async function deleteSubmission(item: GalleryItem) {
  if (
    item.status !== "rejected" &&
    item.status !== "withdrawn"
  ) {
    return;
  }

  if (
    !await platformConfirm(
      `永久删除投稿记录“${displayTitle(item)}”吗？原始生成作品不会被删除。`
    )
  ) {
    return;
  }

  errorMessage.value = "";

  try {
    await apiRequest(
      `/api/admin/gallery/${encodeURIComponent(item.id)}`,
      {
        method: "DELETE"
      }
    );

    message.value = "投稿记录已永久删除。";
    await load(pagination.value.page);
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "删除投稿记录失败";
  }
}

async function update(
  item: GalleryItem,
  payload: Record<string, unknown>,
  successText: string
) {
  errorMessage.value = "";

  try {
    await apiRequest(
      `/api/admin/gallery/${encodeURIComponent(item.id)}`,
      jsonRequest(payload, "PATCH")
    );

    message.value = successText;
    await load(pagination.value.page);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存审核结果失败";
  }
}
</script>

<template>
  <div class="admin-gallery">
    <header class="admin-gallery-hero">
      <div>
        <span>INSPIRATION CURATION</span>
        <h2>灵感广场审核</h2>
        <p>快速筛选投稿状态、预览原图和提示词，再完成审核与精选操作。</p>
      </div>
      <a href="/gallery" target="_blank">进入灵感广场 ↗</a>
    </header>

    <div class="admin-gallery-summary">
      <button
        v-for="filter in quickFilters"
        :key="filter.value || 'all'"
        type="button"
        :class="{ active: status === filter.value }"
        @click="setStatus(filter.value)"
      >
        <span>{{ filter.label }}</span>
        <strong>{{ filterCount(filter.value) }}</strong>
      </button>

      <article>
        <span>站长精选</span>
        <strong>{{ summary.featured }}</strong>
      </article>
    </div>

    <div class="admin-gallery-toolbar">
      <label>
        <span>⌕</span>
        <input
          v-model="search"
          type="search"
          maxlength="120"
          placeholder="搜索标题、用户或模型"
          @keyup.enter="load(1)"
        />
      </label>
      <button type="button" @click="load(1)">搜索</button>
      <button
        v-if="search"
        type="button"
        class="ghost"
        @click="search = ''; load(1)"
      >
        清空
      </button>
      <small>当前 {{ pagination.total }} 条</small>
    </div>

    <p v-if="message" class="admin-gallery-message success">{{ message }}</p>
    <p v-if="errorMessage" class="admin-gallery-message error">{{ errorMessage }}</p>

    <div v-if="loading" class="admin-gallery-empty">正在读取投稿…</div>

    <div v-else-if="items.length" class="admin-gallery-grid">
      <article v-for="item in items" :key="item.id">
        <button
          class="admin-gallery-image"
          type="button"
          @click="previewItem = item"
        >
          <img :src="item.imageUrl" :alt="displayTitle(item)" loading="lazy" />
          <span v-if="item.featured">精选</span>
          <i>查看大图</i>
        </button>

        <div class="admin-gallery-copy">
          <div class="admin-gallery-status-row">
            <i :class="item.status">
              {{
                item.status === "pending"
                  ? "待审核"
                  : item.status === "approved"
                    ? "已通过"
                    : item.status === "rejected"
                      ? "已拒绝"
                      : "已撤回"
              }}
            </i>
            <small>{{ formatDate(item.submittedAt) }}</small>
          </div>

          <h3>{{ displayTitle(item) }}</h3>
          <p>{{ item.description || "暂无作品介绍" }}</p>

          <div class="admin-gallery-user">
            <span>{{ item.creatorName.slice(0, 1).toUpperCase() }}</span>
            <div>
              <strong>{{ item.creatorName }}</strong>
              <small>{{ item.username }} · {{ displayModel(item) }}</small>
            </div>
          </div>

          <details v-if="item.prompt">
            <summary>查看提示词</summary>
            <p>{{ item.prompt }}</p>
          </details>

          <p v-if="item.rejectionReason" class="admin-gallery-reason">
            拒绝原因：{{ item.rejectionReason }}
          </p>

          <div class="admin-gallery-actions">
            <button
              v-if="item.status === 'pending'"
              class="positive"
              @click="approve(item)"
            >
              通过并公开
            </button>
            <button
              v-if="item.status === 'pending'"
              class="danger"
              @click="reject(item)"
            >
              拒绝
            </button>
            <button
              v-if="item.status === 'approved'"
              @click="toggleFeatured(item)"
            >
              {{ item.featured ? "取消精选" : "设为精选" }}
            </button>

            <button
              v-if="item.status === 'rejected' || item.status === 'withdrawn'"
              class="danger"
              @click="deleteSubmission(item)"
            >
              删除记录
            </button>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="admin-gallery-empty">
      当前状态下没有投稿。
    </div>

    <div v-if="pagination.totalPages > 1" class="admin-gallery-pagination">
      <button :disabled="pagination.page <= 1" @click="load(pagination.page - 1)">上一页</button>
      <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
      <button :disabled="pagination.page >= pagination.totalPages" @click="load(pagination.page + 1)">下一页</button>
    </div>

    <div
      v-if="previewItem"
      class="admin-gallery-preview"
      @click.self="previewItem = null"
    >
      <section>
        <button
          class="admin-gallery-preview-close"
          type="button"
          @click="previewItem = null"
        >×</button>

        <div class="admin-gallery-preview-image">
          <img :src="previewItem.imageUrl" :alt="displayTitle(previewItem)" />
        </div>

        <aside>
          <span>INSPIRATION REVIEW</span>
          <h3>{{ displayTitle(previewItem) }}</h3>

          <div class="admin-gallery-preview-user">
            <strong>{{ previewItem.creatorName }}</strong>
            <small>{{ previewItem.username }} · {{ displayModel(previewItem) }}</small>
          </div>

          <p v-if="previewItem.description">{{ previewItem.description }}</p>

          <div v-if="previewItem.prompt" class="admin-gallery-preview-prompt">
            <b>PROMPT</b>
            <p>{{ previewItem.prompt }}</p>
          </div>

          <em>按 ESC 关闭预览</em>
        </aside>
      </section>
    </div>
  </div>
</template>

<style scoped>
.admin-gallery{display:grid;gap:18px}.admin-gallery-hero{display:flex;justify-content:space-between;align-items:flex-end;gap:22px;padding:26px;border:1px solid #dedaf5;border-radius:20px;background:linear-gradient(135deg,#fff,#f6f4ff)}.admin-gallery-hero span{color:#6f5fd7;font-size:10px;font-weight:900;letter-spacing:.14em}.admin-gallery-hero h2{margin:7px 0;color:#292c40;font-size:24px}.admin-gallery-hero p{margin:0;color:#73788b;font-size:13px;line-height:1.7}.admin-gallery-hero a{display:inline-flex;align-items:center;min-height:39px;padding:0 14px;border:1px solid #dedaf5;border-radius:10px;background:#fff;color:#5e50c5;text-decoration:none;font-size:12px;font-weight:800}.admin-gallery-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.admin-gallery-summary button,.admin-gallery-summary article{display:flex;align-items:center;justify-content:space-between;min-height:72px;padding:14px 16px;border:1px solid #e0e3ec;border-radius:14px;background:#fff;color:#626679}.admin-gallery-summary button{cursor:pointer;transition:.18s ease}.admin-gallery-summary button:hover{border-color:#beb7ef;transform:translateY(-1px)}.admin-gallery-summary button.active{border-color:#7565da;background:#f2efff;color:#5848bd;box-shadow:0 0 0 2px rgba(117,101,218,.08)}.admin-gallery-summary span{font-size:11px;font-weight:800}.admin-gallery-summary strong{color:#383b50;font-size:23px}.admin-gallery-summary button.active strong{color:#5d4bc7}.admin-gallery-toolbar{display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #e1e3ec;border-radius:13px;background:#fff}.admin-gallery-toolbar label{display:flex;align-items:center;gap:8px;flex:1;max-width:520px;min-height:40px;padding:0 12px;border:1px solid #e0e2ea;border-radius:10px;background:#fafbfe}.admin-gallery-toolbar label>span{color:#9498a9}.admin-gallery-toolbar input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:#35384b;font-size:12px}.admin-gallery-toolbar button{min-height:40px;padding:0 14px;border:0;border-radius:10px;background:#6253d0;color:#fff;font-size:11px;font-weight:850;cursor:pointer}.admin-gallery-toolbar button.ghost{border:1px solid #e1e3ec;background:#fff;color:#717588}.admin-gallery-toolbar small{margin-left:auto;color:#8c90a1;font-size:10px}.admin-gallery-message{margin:0;padding:11px 13px;border-radius:10px;font-size:11px}.admin-gallery-message.success{background:#edf9f2;color:#327353}.admin-gallery-message.error{background:#fff1f2;color:#ae4c58}.admin-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,270px));justify-content:start;gap:14px}.admin-gallery-grid>article{overflow:hidden;border:1px solid #e1e3ec;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(49,52,82,.045)}.admin-gallery-image{position:relative;display:block;width:100%;aspect-ratio:4/3;padding:8px;border:0;background:#f2f3f7;cursor:zoom-in}.admin-gallery-image img{width:100%;height:100%;object-fit:contain;border-radius:9px}.admin-gallery-image>span{position:absolute;top:11px;left:11px;padding:5px 8px;border-radius:999px;background:#eeeaff;color:#5c4ec2;font-size:8px;font-weight:900}.admin-gallery-image>i{position:absolute;right:11px;bottom:11px;padding:5px 7px;border-radius:8px;background:rgba(34,36,52,.72);color:#fff;font-size:8px;font-style:normal;opacity:0;transition:.18s ease}.admin-gallery-image:hover>i{opacity:1}.admin-gallery-copy{padding:15px}.admin-gallery-status-row{display:flex;justify-content:space-between;align-items:center;gap:8px}.admin-gallery-status-row>i{padding:5px 8px;border-radius:999px;background:#f0f1f5;font-size:8px;font-style:normal;font-weight:850}.admin-gallery-status-row>i.pending{color:#a66d13;background:#fff4dc}.admin-gallery-status-row>i.approved{color:#26714d;background:#eaf8ef}.admin-gallery-status-row>i.rejected{color:#ad4d58;background:#fff0f2}.admin-gallery-status-row small{color:#9599aa;font-size:8px}.admin-gallery-copy h3{overflow:hidden;margin:11px 0 5px;color:#323548;font-size:14px;text-overflow:ellipsis;white-space:nowrap}.admin-gallery-copy>p{display:-webkit-box;overflow:hidden;min-height:36px;margin:0;color:#7e8295;font-size:10.5px;line-height:1.65;-webkit-box-orient:vertical;-webkit-line-clamp:2}.admin-gallery-user{display:flex;gap:9px;align-items:center;margin:13px 0;padding-top:11px;border-top:1px solid #eceef3}.admin-gallery-user>span{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:#eeeaff;color:#6557ca;font-size:10px;font-weight:900}.admin-gallery-user div{display:grid;gap:2px;min-width:0}.admin-gallery-user strong{font-size:11px}.admin-gallery-user small{overflow:hidden;color:#8c90a1;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.admin-gallery-copy details{margin:10px 0}.admin-gallery-copy summary{color:#5f51c2;font-size:11.5px;font-weight:800;cursor:pointer}.admin-gallery-copy details p{margin:8px 0 0;padding:10px;border:1px solid #e7e3fb;border-radius:9px;background:#f8f7ff;color:#5e6275;font-size:11px;line-height:1.7;white-space:pre-wrap}.admin-gallery-reason{color:#bd5962!important}.admin-gallery-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:13px}.admin-gallery-actions button{min-height:34px;padding:0 11px;border:1px solid #e0e2ea;border-radius:9px;background:#f7f8fb;color:#65697b;font-size:10px;font-weight:800;cursor:pointer}.admin-gallery-actions .positive{border-color:#bfe3cd;background:#eef9f2;color:#2e7651}.admin-gallery-actions .danger{border-color:#f0cbd0;background:#fff3f4;color:#a94853}.admin-gallery-empty{padding:54px 15px;border:1px dashed #d9dce8;border-radius:15px;background:#fff;color:#85899b;text-align:center}.admin-gallery-pagination{display:flex;justify-content:center;align-items:center;gap:10px}.admin-gallery-pagination button{min-height:34px;padding:0 11px;border:1px solid #e0e2ea;border-radius:9px;background:#fff;color:#666a7c}.admin-gallery-pagination button:disabled{opacity:.35}.admin-gallery-pagination span{color:#85899b;font-size:10px}.admin-gallery-preview{position:fixed;inset:0;z-index:var(--v15-z-modal-raised);display:grid;place-items:center;padding:34px;background:rgba(31,33,48,.64);backdrop-filter:blur(10px)}.admin-gallery-preview>section{position:relative;display:grid;grid-template-columns:minmax(0,700px) minmax(310px,380px);width:min(1100px,94vw);max-height:82vh;overflow:hidden;border-radius:20px;background:#fff;box-shadow:0 30px 90px rgba(22,24,46,.3)}.admin-gallery-preview-image{display:flex;align-items:center;justify-content:center;min-height:460px;padding:12px;background:#f1f2f6}.admin-gallery-preview-image img{width:100%;height:100%;max-height:78vh;object-fit:contain}.admin-gallery-preview aside{overflow:auto;padding:31px 28px;border-left:1px solid #e7e8ef}.admin-gallery-preview aside>span{color:#6d5bd4;font-size:9px;font-weight:900;letter-spacing:.14em}.admin-gallery-preview aside h3{margin:8px 0 14px;color:#292c40;font-size:24px}.admin-gallery-preview-user{display:grid;gap:3px;padding-bottom:17px;border-bottom:1px solid #eceef3}.admin-gallery-preview-user strong{font-size:13px}.admin-gallery-preview-user small{color:#8c90a1;font-size:10px}.admin-gallery-preview aside>p{color:#686c7f;font-size:12px;line-height:1.7}.admin-gallery-preview-prompt{margin-top:18px;padding:15px;border:1px solid #dfdbf8;border-radius:12px;background:#f8f7ff}.admin-gallery-preview-prompt b{color:#6957d0;font-size:9px;letter-spacing:.12em}.admin-gallery-preview-prompt p{margin:8px 0 0;color:#5f6375;font-size:12px;line-height:1.75;white-space:pre-wrap}.admin-gallery-preview aside>em{display:block;margin-top:18px;color:#a2a5b5;font-size:9px;font-style:normal}.admin-gallery-preview-close{position:absolute;top:13px;right:13px;z-index:4;width:38px;height:38px;border:1px solid #e0e2e9;border-radius:50%;background:#fff;color:#777b8e;font-size:22px;cursor:pointer}@media(max-width:1000px){.admin-gallery-summary{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:840px){.admin-gallery-preview{padding:16px}.admin-gallery-preview>section{display:block;overflow:auto;max-height:92vh}.admin-gallery-preview-image{min-height:0;height:54vh}.admin-gallery-preview aside{border-left:0;border-top:1px solid #e7e8ef}}@media(max-width:650px){.admin-gallery-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.admin-gallery-toolbar{align-items:stretch;flex-direction:column}.admin-gallery-toolbar label{max-width:none}.admin-gallery-toolbar small{margin-left:0}}
</style>

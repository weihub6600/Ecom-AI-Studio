<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";
import {
  apiRequest
} from "./api/client";
import type {
  GalleryItem,
  GallerySummary,
  Pagination
} from "./types";
import {
  formatDate
} from "./utils/format";

const items = ref<GalleryItem[]>([]);
const pagination = ref<Pagination>({
  page: 1,
  pageSize: 24,
  total: 0,
  totalPages: 1
});
const summary = ref<GallerySummary>({
  total: 0,
  creators: 0,
  featured: 0,
  providers: []
});
const search = ref("");
const provider = ref("");
const sort = ref<"featured" | "newest">("featured");
const featuredOnly = ref(false);
const loading = ref(true);
const errorMessage = ref("");
const lightbox = ref<GalleryItem | null>(null);

const pageLabel = computed(() =>
  pagination.value.totalPages <= 1
    ? `${pagination.value.total} 件公开作品`
    : `第 ${pagination.value.page} / ${pagination.value.totalPages} 页 · 共 ${pagination.value.total} 件`
);

function displayTitle(item: GalleryItem): string {
  const title = item.title.trim();
  const legacyDefault = `${item.model} 创作`;
  return title === legacyDefault
    ? "AI 创作"
    : title;
}

function displayModel(item: GalleryItem): string {
  let model = item.model.trim();

  const provider = item.provider.trim();
  if (
    provider &&
    model.toLowerCase().startsWith(
      provider.toLowerCase() + "-"
    )
  ) {
    model = model.slice(provider.length + 1);
  }

  if (model.toLowerCase().startsWith("gpt-")) {
    model = model.slice(4);
  }

  return model || "AI 模型";
}

function handleGalleryKeydown(event: KeyboardEvent) {
  if (
    event.key === "Escape" &&
    lightbox.value
  ) {
    lightbox.value = null;
  }
}

onMounted(() => {
  window.addEventListener(
    "keydown",
    handleGalleryKeydown
  );
  void loadGallery(1);
});

onBeforeUnmount(() => {
  window.removeEventListener(
    "keydown",
    handleGalleryKeydown
  );
});

async function loadGallery(page = 1) {
  loading.value = true;
  errorMessage.value = "";
  try {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "24",
      sort: sort.value
    });
    if (search.value.trim()) params.set("search", search.value.trim());
    if (provider.value) params.set("provider", provider.value);
    if (featuredOnly.value) params.set("featured", "true");

    const data = await apiRequest<{
      items: GalleryItem[];
      pagination: Pagination;
      summary: GallerySummary;
    }>(`/api/gallery?${params.toString()}`);

    items.value = data.items || [];
    pagination.value = data.pagination;
    summary.value = data.summary;
    window.scrollTo({
      top: 0,
      behavior: page === 1 ? "auto" : "smooth"
    });
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取灵感广场失败";
  } finally {
    loading.value = false;
  }
}

function clearFilters() {
  search.value = "";
  provider.value = "";
  sort.value = "featured";
  featuredOnly.value = false;
  void loadGallery(1);
}
</script>

<template>
  <div class="gallery-page">
    <header class="gallery-nav">
      <a class="gallery-brand" href="/">
        <span>Z</span>
        <div>
          <strong>ZHE AI</strong>
          <small>CREATIVE GALLERY</small>
        </div>
      </a>

      <nav>
        <a href="/">创作工作台</a>
        <a href="/account?tab=gallery">我的投稿</a>
      </nav>
    </header>

    <main>
      <section class="gallery-hero">
        <div class="gallery-hero-copy">
          <span class="gallery-eyebrow">ZHE INSPIRATION · CURATED WORKS</span>
          <h1>
            把灵感做成作品，
            <em>让好作品被看见。</em>
          </h1>
          <p>
            这里展示由 ZHE AI 用户创作并通过站长审核的真实作品。
            精选作品优先展示，创作者可自行决定是否公开提示词。
          </p>
          <div class="gallery-hero-actions">
            <a class="primary" href="/account?tab=gallery">投稿我的作品</a>
            <button type="button" @click="featuredOnly = !featuredOnly; loadGallery(1)">
              {{ featuredOnly ? '查看全部作品' : '只看精选' }}
            </button>
          </div>
        </div>

        <div class="gallery-stats">
          <article>
            <span>PUBLIC WORKS</span>
            <strong>{{ summary.total }}</strong>
            <small>公开作品</small>
          </article>
          <article>
            <span>CREATORS</span>
            <strong>{{ summary.creators }}</strong>
            <small>创作者</small>
          </article>
          <article>
            <span>FEATURED</span>
            <strong>{{ summary.featured }}</strong>
            <small>站长精选</small>
          </article>
        </div>
      </section>

      <section class="gallery-toolbar">
        <form @submit.prevent="loadGallery(1)">
          <label class="gallery-search">
            <span>⌕</span>
            <input
              v-model="search"
              type="search"
              maxlength="120"
              placeholder="搜索作品、作者或模型"
            />
          </label>

          <select v-model="provider" @change="loadGallery(1)">
            <option value="">全部服务商</option>
            <option
              v-for="item in summary.providers"
              :key="item"
              :value="item"
            >
              {{ item }}
            </option>
          </select>

          <select v-model="sort" @change="loadGallery(1)">
            <option value="featured">精选优先</option>
            <option value="newest">最新发布</option>
          </select>

          <button type="submit">筛选</button>
          <button
            v-if="search || provider || featuredOnly || sort !== 'featured'"
            type="button"
            class="ghost"
            @click="clearFilters"
          >
            清空
          </button>
        </form>

        <span>{{ pageLabel }}</span>
      </section>

      <p v-if="errorMessage" class="gallery-error">{{ errorMessage }}</p>

      <section class="gallery-section-head">
        <div>
          <span>INSPIRATION WORKS</span>
          <h2>社区作品</h2>
        </div>
      </section>

      <section v-if="loading" class="gallery-loading">
        <div v-for="index in 8" :key="index"></div>
      </section>

      <section v-else-if="items.length" class="gallery-masonry">
        <article
          v-for="item in items"
          :key="item.id"
          class="gallery-card"
          @click="lightbox = item"
        >
          <div class="gallery-image">
            <img :src="item.imageUrl" :alt="item.title" loading="lazy" />
            <span v-if="item.featured" class="featured-badge">精选</span>
            <div class="gallery-image-meta">
              <span>{{ displayModel(item) }}</span>
            </div>
          </div>

          <div class="gallery-card-copy">
            <h2>{{ displayTitle(item) }}</h2>
            <div class="gallery-author">
              <span>{{ item.creatorName.slice(0, 1).toUpperCase() }}</span>
              <div>
                <strong>{{ item.creatorName }}</strong>
                <small>{{ displayModel(item) }} · {{ formatDate(item.reviewedAt || item.submittedAt) }}</small>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section v-else class="gallery-empty">
        <span>✦</span>
        <h2>暂时没有匹配作品</h2>
        <p>换个筛选条件，或者成为第一个投稿的人。</p>
        <button type="button" @click="clearFilters">查看全部</button>
      </section>

      <nav v-if="pagination.totalPages > 1" class="gallery-pagination">
        <button
          :disabled="pagination.page <= 1"
          @click="loadGallery(pagination.page - 1)"
        >
          上一页
        </button>
        <span>{{ pagination.page }} / {{ pagination.totalPages }}</span>
        <button
          :disabled="pagination.page >= pagination.totalPages"
          @click="loadGallery(pagination.page + 1)"
        >
          下一页
        </button>
      </nav>
    </main>

    <div
      v-if="lightbox"
      class="gallery-lightbox"
      @click.self="lightbox = null"
    >
      <button class="gallery-lightbox-close" @click="lightbox = null">×</button>

      <div class="gallery-lightbox-image">
        <img :src="lightbox.imageUrl" :alt="lightbox.title" />
      </div>

      <aside>
        <span v-if="lightbox.featured" class="gallery-lightbox-featured">ZHE 精选</span>
        <h2>{{ displayTitle(lightbox) }}</h2>
        <p v-if="lightbox.description">{{ lightbox.description }}</p>

        <div class="gallery-lightbox-author">
          <span>{{ lightbox.creatorName.slice(0, 1).toUpperCase() }}</span>
          <div>
            <strong>{{ lightbox.creatorName }}</strong>
            <small>{{ displayModel(lightbox) }}</small>
          </div>
        </div>

        <div v-if="lightbox.showPrompt && lightbox.prompt" class="gallery-prompt">
          <span>PROMPT</span>
          <p>{{ lightbox.prompt }}</p>
        </div>

        <small class="gallery-lightbox-date">
          发布于 {{ formatDate(lightbox.reviewedAt || lightbox.submittedAt) }}
        </small>
      </aside>
    </div>
  </div>
</template>

<style src="./gallery-page.css"></style>

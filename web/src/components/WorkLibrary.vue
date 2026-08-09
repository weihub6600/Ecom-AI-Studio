<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";
import {
  formatDate,
  formatDuration
} from "../utils/format";

interface LibraryImage {
  id: string;
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

interface LibraryFolder {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

interface LibraryTag {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
}

interface LibraryItem {
  id: string;
  generationTaskId?: string;
  provider: string;
  providerName: string;
  model: string;
  prompt: string;
  operation:
    | "text-to-image"
    | "image-edit";
  size: string;
  durationMs?: number;
  cost?: number;
  createdAt: string;
  favorite: boolean;
  note?: string;
  trashedAt?: string;
  folder?: {
    id: string;
    name: string;
  };
  tags: LibraryTag[];
  images: LibraryImage[];
}

interface LibrarySummary {
  total: number;
  favorite: number;
  trash: number;
  unfiled: number;
}

interface LibraryPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface UnifiedExportSource {
  id: string;
  createdAt: string;
  provider: string;
  model: string;
  prompt: string;
  operation: "text-to-image" | "image-edit";
  size: string;
  durationMs?: number;
  cost?: number;
  images: Array<{
    url: string;
    width?: number;
    height?: number;
    mimeType?: string;
  }>;
}

type UnifiedExportScope =
  | "single"
  | "selected"
  | "all";

interface UnifiedExportRecord {
  id: string;
  createdAt: string;
  model: string;
  prompt: string;
  operation: "text-to-image" | "image-edit";
  size: string;
  durationMs?: number;
  cost?: number;
  images: Array<{
    file: string;
    width?: number;
    height?: number;
    mimeType?: string;
  }>;
}

const props = defineProps<{
  userId: string
}>();

const items = ref<LibraryItem[]>([]);
const folders = ref<LibraryFolder[]>([]);
const tags = ref<LibraryTag[]>([]);
const summary = ref<LibrarySummary>({
  total: 0,
  favorite: 0,
  trash: 0,
  unfiled: 0
});
const pagination = ref<LibraryPagination>({
  page: 1,
  pageSize: 18,
  total: 0,
  totalPages: 1
});

const search = ref("");
const folderId = ref("all");
const tagId = ref("all");
const provider = ref("all");
const favoriteOnly = ref(false);
const trashMode = ref(false);
const sort = ref<
  | "newest"
  | "oldest"
  | "updated"
  | "favorite"
>("newest");

const selectedIds = ref<Set<string>>(
  new Set()
);
const batchFolderId = ref("");
const batchTagId = ref("");
const loading = ref(false);
const actionLoading = ref(false);
const errorMessage = ref("");
const successMessage = ref("");
const exportProgress = ref(0);
const exportStatus = ref("");
const exportError = ref("");
const exporting = ref(false);
const exportedName = ref("");
const detailItem = ref<LibraryItem | null>(
  null
);
const detailNote = ref("");
const detailFolderId = ref("");
const detailTagIds = ref<Set<string>>(
  new Set()
);

const allSelected = computed(() =>
  items.value.length > 0 &&
  items.value.every((item) =>
    selectedIds.value.has(item.id)
  )
);

const selectedCount = computed(() =>
  selectedIds.value.size
);

onMounted(async () => {
  window.addEventListener(
    "keydown",
    handleLibraryKeydown
  );
  await migrateLocalFavorites();
  await loadLibrary(true);
});

onBeforeUnmount(() => {
  window.removeEventListener(
    "keydown",
    handleLibraryKeydown
  );
});

async function loadLibrary(
  resetPage = false
) {
  if (resetPage) {
    pagination.value = {
      ...pagination.value,
      page: 1
    };
  }

  loading.value = true;
  errorMessage.value = "";

  try {
    const params = new URLSearchParams({
      page: String(pagination.value.page),
      pageSize: String(
        pagination.value.pageSize
      ),
      sort: sort.value
    });

    const normalizedSearch =
      search.value.trim();

    if (normalizedSearch) {
      params.set("search", normalizedSearch);
    }

    if (folderId.value !== "all") {
      params.set("folderId", folderId.value);
    }

    if (tagId.value !== "all") {
      params.set("tagId", tagId.value);
    }

    if (provider.value !== "all") {
      params.set("provider", provider.value);
    }

    if (favoriteOnly.value) {
      params.set("favorite", "true");
    }

    if (trashMode.value) {
      params.set("trash", "true");
    }

    const [listResult, metaResult] =
      await Promise.all([
        apiRequest<{
          items: LibraryItem[];
          pagination: LibraryPagination;
        }>(
          `/api/library?${params.toString()}`
        ),
        apiRequest<{
          folders: LibraryFolder[];
          tags: LibraryTag[];
          summary: LibrarySummary;
        }>("/api/library/meta")
      ]);

    items.value = listResult.items || [];
    pagination.value =
      listResult.pagination;
    folders.value =
      metaResult.folders || [];
    tags.value = metaResult.tags || [];
    summary.value = metaResult.summary;

    selectedIds.value = new Set(
      [...selectedIds.value].filter((id) =>
        items.value.some((item) =>
          item.id === id
        )
      )
    );
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取作品库失败";
  } finally {
    loading.value = false;
  }
}

async function migrateLocalFavorites() {
  const migrationKey =
    `ecom-ai-studio:library-favorites-migrated:${props.userId}`;

  if (
    localStorage.getItem(migrationKey) ===
    "1"
  ) {
    return;
  }

  try {
    const raw = localStorage.getItem(
      "ecom-ai-studio:favorites"
    );

    const parsed = raw
      ? JSON.parse(raw)
      : [];

    const historyIds = Array.isArray(parsed)
      ? parsed.filter(
          (
            item
          ): item is string =>
            typeof item === "string"
        )
      : [];

    for (
      let index = 0;
      index < historyIds.length;
      index += 100
    ) {
      await apiRequest(
        "/api/library/batch",
        jsonRequest({
          historyIds:
            historyIds.slice(
              index,
              index + 100
            ),
          action: "favorite"
        })
      );
    }

    localStorage.setItem(
      migrationKey,
      "1"
    );
  } catch {
    // Keep the migration retryable on the next open.
  }
}

function toggleSelection(id: string) {
  const next = new Set(selectedIds.value);

  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  selectedIds.value = next;
}

function toggleSelectAll() {
  selectedIds.value = allSelected.value
    ? new Set()
    : new Set(
        items.value.map((item) =>
          item.id
        )
      );
}

async function toggleFavorite(
  item: LibraryItem
) {
  actionLoading.value = true;
  errorMessage.value = "";

  try {
    const result =
      await apiRequest<{
        item: LibraryItem
      }>(
        `/api/library/items/${encodeURIComponent(item.id)}`,
        jsonRequest({
          favorite: !item.favorite
        }, "PATCH")
      );

    replaceItem(result.item);
    syncLegacyFavorite(
      item.id,
      result.item.favorite
    );
    await refreshMeta();
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "更新收藏失败";
  } finally {
    actionLoading.value = false;
  }
}

async function createFolder() {
  const name = window.prompt(
    "新建文件夹名称"
  );

  if (!name?.trim()) return;

  await runAction(
    async () => {
      await apiRequest(
        "/api/library/folders",
        jsonRequest({
          name: name.trim()
        })
      );

      successMessage.value =
        "文件夹已创建";
      await loadLibrary(false);
    },
    "创建文件夹失败"
  );
}

async function renameFolder(
  folder: LibraryFolder
) {
  const name = window.prompt(
    "重命名文件夹",
    folder.name
  );

  if (
    !name?.trim() ||
    name.trim() === folder.name
  ) {
    return;
  }

  await runAction(
    async () => {
      await apiRequest(
        `/api/library/folders/${encodeURIComponent(folder.id)}`,
        jsonRequest({
          name: name.trim()
        }, "PATCH")
      );

      successMessage.value =
        "文件夹已重命名";
      await loadLibrary(false);
    },
    "重命名文件夹失败"
  );
}

async function deleteFolder(
  folder: LibraryFolder
) {
  if (
    !window.confirm(
      `删除文件夹“${folder.name}”？文件夹中的作品会回到未分类。`
    )
  ) {
    return;
  }

  await runAction(
    async () => {
      await apiRequest(
        `/api/library/folders/${encodeURIComponent(folder.id)}`,
        {
          method: "DELETE"
        }
      );

      if (folderId.value === folder.id) {
        folderId.value = "all";
      }

      successMessage.value =
        "文件夹已删除";
      await loadLibrary(true);
    },
    "删除文件夹失败"
  );
}

async function createTag() {
  const name = window.prompt(
    "新建标签名称"
  );

  if (!name?.trim()) return;

  await runAction(
    async () => {
      await apiRequest(
        "/api/library/tags",
        jsonRequest({
          name: name.trim()
        })
      );

      successMessage.value =
        "标签已创建";
      await loadLibrary(false);
    },
    "创建标签失败"
  );
}

async function deleteTag(tag: LibraryTag) {
  if (
    !window.confirm(
      `删除标签“${tag.name}”？作品本身不会被删除。`
    )
  ) {
    return;
  }

  await runAction(
    async () => {
      await apiRequest(
        `/api/library/tags/${encodeURIComponent(tag.id)}`,
        {
          method: "DELETE"
        }
      );

      if (tagId.value === tag.id) {
        tagId.value = "all";
      }

      successMessage.value =
        "标签已删除";
      await loadLibrary(true);
    },
    "删除标签失败"
  );
}

function openDetail(item: LibraryItem) {
  detailItem.value = item;
  detailNote.value = item.note || "";
  detailFolderId.value =
    item.folder?.id || "";
  detailTagIds.value = new Set(
    item.tags.map((tag) => tag.id)
  );
}

function toggleDetailTag(tagIdValue: string) {
  const next = new Set(
    detailTagIds.value
  );

  if (next.has(tagIdValue)) {
    next.delete(tagIdValue);
  } else {
    next.add(tagIdValue);
  }

  detailTagIds.value = next;
}

async function saveDetail() {
  if (!detailItem.value) return;

  const currentId =
    detailItem.value.id;

  await runAction(
    async () => {
      const result =
        await apiRequest<{
          item: LibraryItem
        }>(
          `/api/library/items/${encodeURIComponent(currentId)}`,
          jsonRequest({
            note:
              detailNote.value.trim() ||
              null,
            folderId:
              detailFolderId.value ||
              null,
            tagIds:
              [...detailTagIds.value]
          }, "PATCH")
        );

      replaceItem(result.item);
      detailItem.value = result.item;
      successMessage.value =
        "作品信息已保存";
      await refreshMeta();
    },
    "保存作品信息失败"
  );
}

async function trashItem(item: LibraryItem) {
  const action = item.trashedAt
    ? "restore"
    : "trash";

  await batchAction(
    action,
    [item.id]
  );
}

async function batchAction(
  action:
    | "favorite"
    | "unfavorite"
    | "move"
    | "add-tags"
    | "remove-tags"
    | "replace-tags"
    | "trash"
    | "restore",
  explicitIds?: string[]
) {
  const historyIds = explicitIds ||
    [...selectedIds.value];

  if (historyIds.length === 0) {
    errorMessage.value =
      "请先选择作品";
    return;
  }

  const payload: Record<string, unknown> = {
    historyIds,
    action
  };

  if (action === "move") {
    payload.folderId =
      batchFolderId.value || null;
  }

  if (
    action === "add-tags" ||
    action === "remove-tags" ||
    action === "replace-tags"
  ) {
    if (!batchTagId.value) {
      errorMessage.value =
        "请先选择标签";
      return;
    }

    payload.tagIds = [
      batchTagId.value
    ];
  }

  await runAction(
    async () => {
      const result =
        await apiRequest<{
          success: boolean;
          changed: number;
        }>(
          "/api/library/batch",
          jsonRequest(payload)
        );

      successMessage.value =
        `已整理 ${result.changed} 个作品`;
      selectedIds.value = new Set();
      await loadLibrary(false);
    },
    "批量整理作品失败"
  );
}

async function emptyTrash() {
  if (
    !window.confirm(
      "确定清空回收站吗？作品将不再出现在作品库中，服务器原图文件仍保留。"
    )
  ) {
    return;
  }

  await runAction(
    async () => {
      const result =
        await apiRequest<{
          success: boolean;
          deleted: number;
        }>(
          "/api/library/trash",
          {
            method: "DELETE"
          }
        );

      successMessage.value =
        `已清理 ${result.deleted} 个作品`;
      selectedIds.value = new Set();
      await loadLibrary(true);
    },
    "清空回收站失败"
  );
}

async function changePage(page: number) {
  if (
    page < 1 ||
    page > pagination.value.totalPages
  ) {
    return;
  }

  pagination.value = {
    ...pagination.value,
    page
  };

  await loadLibrary(false);
}

async function refreshMeta() {
  const result =
    await apiRequest<{
      folders: LibraryFolder[];
      tags: LibraryTag[];
      summary: LibrarySummary;
    }>("/api/library/meta");

  folders.value = result.folders || [];
  tags.value = result.tags || [];
  summary.value = result.summary;
}

function replaceItem(item: LibraryItem) {
  items.value = items.value.map(
    (current) =>
      current.id === item.id
        ? item
        : current
  );
}

function syncLegacyFavorite(
  historyId: string,
  favorite: boolean
) {
  try {
    const key =
      "ecom-ai-studio:favorites";

    const raw = localStorage.getItem(key);
    const parsed = raw
      ? JSON.parse(raw)
      : [];

    const values = new Set<string>(
      Array.isArray(parsed)
        ? parsed.filter(
            (
              item
            ): item is string =>
              typeof item ===
              "string"
          )
        : []
    );

    if (favorite) {
      values.add(historyId);
    } else {
      values.delete(historyId);
    }

    localStorage.setItem(
      key,
      JSON.stringify([...values])
    );
  } catch {
    // MySQL remains the source of truth.
  }
}

async function runAction(
  action: () => Promise<void>,
  fallbackMessage: string
) {
  actionLoading.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    await action();
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : fallbackMessage;
  } finally {
    actionLoading.value = false;
  }
}

async function exportSingleWork(
  item: LibraryItem
) {
  await exportWorks(
    [item],
    "single"
  );
}

async function exportSelectedWorks() {
  const selected =
    items.value.filter(
      (item) =>
        selectedIds.value.has(
          item.id
        )
    );

  if (!selected.length) {
    errorMessage.value =
      "请先选择要导出的作品";
    return;
  }

  await exportWorks(
    selected,
    "selected"
  );
}

async function exportAllWorks() {
  if (exporting.value) return;

  exporting.value = true;
  exportProgress.value = 0;
  exportStatus.value =
    "正在读取账号全部作品…";
  exportError.value = "";
  exportedName.value = "";

  try {
    const data =
      await apiRequest<{
        history:
          UnifiedExportSource[];
        total: number;
      }>(
        "/api/history/export-manifest"
      );

    if (!data.history?.length) {
      exportStatus.value =
        "暂无可导出的作品";
      return;
    }

    await buildWorksZip(
      data.history,
      "all"
    );
  } catch (error) {
    exportError.value =
      error instanceof Error
        ? error.message
        : "导出全部作品失败";
    exportStatus.value =
      "导出失败";
  } finally {
    exporting.value = false;
  }
}

async function exportWorks(
  sources:
    UnifiedExportSource[],
  scope:
    UnifiedExportScope
) {
  if (
    exporting.value ||
    !sources.length
  ) {
    return;
  }

  exporting.value = true;
  exportProgress.value = 0;
  exportStatus.value =
    "正在准备导出文件…";
  exportError.value = "";
  exportedName.value = "";

  try {
    await buildWorksZip(
      sources,
      scope
    );
  } catch (error) {
    exportError.value =
      error instanceof Error
        ? error.message
        : "导出作品失败";
    exportStatus.value =
      "导出失败";
  } finally {
    exporting.value = false;
  }
}

async function buildWorksZip(
  sources:
    UnifiedExportSource[],
  scope:
    UnifiedExportScope
) {
  const { default: JSZip } =
    await import("jszip");

  const zip =
    new JSZip();

  const exported:
    UnifiedExportRecord[] = [];

  const failures:
    string[] = [];

  const totalImages =
    sources.reduce(
      (
        total,
        source
      ) =>
        total +
        source.images.length,
      0
    );

  let handledImages = 0;

  for (const source of sources) {
    const images:
      UnifiedExportRecord["images"] =
        [];

    for (
      let imageIndex = 0;
      imageIndex <
        source.images.length;
      imageIndex += 1
    ) {
      const image =
        source.images[
          imageIndex
        ];

      if (!image) continue;

      const extension =
        workImageExtension(
          image.mimeType,
          image.url
        );

      const file =
        `图片/${String(handledImages + 1).padStart(3, "0")}_${workExportTime(source.createdAt)}_${safeWorkFileSegment(workExportModel(source), "AI模型", 30)}.${extension}`;

      exportStatus.value =
        `正在下载图片 ${handledImages + 1} / ${Math.max(totalImages, 1)}`;

      try {
        const response =
          await fetch(
            image.url,
            {
              credentials:
                "same-origin"
            }
          );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          );
        }

        const blob =
          await response.blob();

        zip.file(
          file,
          blob
        );

        images.push({
          file,
          width:
            image.width,
          height:
            image.height,
          mimeType:
            image.mimeType ||
            blob.type ||
            undefined
        });
      } catch (error) {
        failures.push(
          [
            source.id,
            image.url,
            error instanceof Error
              ? error.message
              : "图片下载失败"
          ].join("\t")
        );
      } finally {
        handledImages += 1;

        exportProgress.value =
          totalImages > 0
            ? Math.min(
                82,
                Math.round(
                  (
                    handledImages /
                    totalImages
                  ) * 82
                )
              )
            : 82;
      }
    }

    exported.push({
      id:
        source.id,
      createdAt:
        source.createdAt,
      model:
        workExportModel(
          source
        ),
      prompt:
        source.prompt,
      operation:
        source.operation,
      size:
        source.size,
      durationMs:
        source.durationMs,
      cost:
        source.cost,
      images
    });
  }

  exportStatus.value =
    "正在生成表格与数据文件…";

  zip.file(
    "生成记录.csv",
    "\uFEFF" +
      workExportCsv(
        exported
      )
  );

  zip.file(
    "生成记录.json",
    JSON.stringify(
      {
        导出时间:
          new Date()
            .toISOString(),
        记录数:
          exported.length,
        图片数:
          exported.reduce(
            (
              total,
              record
            ) =>
              total +
              record.images.length,
            0
          ),
        数据:
          exported
      },
      null,
      2
    )
  );

  zip.file(
    "导出说明.txt",
    [
      "ZHE AI Studio · 作品库导出",
      "",
      `作品记录：${exported.length}`,
      `图片数量：${totalImages}`,
      `失败图片：${failures.length}`,
      "",
      "文件说明：",
      "1. 图片：全部导出图片集中保存。",
      "2. 生成记录.csv：可直接用 Excel / WPS 打开。",
      "3. 生成记录.json：结构化生成数据。",
      "4. 导出失败图片.txt：仅在个别图片失败时出现。"
    ].join("\r\n")
  );

  if (failures.length) {
    zip.file(
      "导出失败图片.txt",
      [
        "以下图片未能写入压缩包：",
        "",
        ...failures
      ].join("\r\n")
    );
  }

  exportProgress.value = 84;
  exportStatus.value =
    "正在压缩作品包…";

  const blob =
    await zip.generateAsync(
      {
        type: "blob",
        compression:
          "DEFLATE",
        compressionOptions: {
          level: 6
        }
      },
      (metadata) => {
        exportProgress.value =
          Math.max(
            84,
            Math.min(
              99,
              84 +
                Math.round(
                  metadata.percent *
                    0.15
                )
            )
          );
      }
    );

  const fileName =
    workZipName(
      scope,
      sources.length
    );

  downloadWorkBlob(
    blob,
    fileName
  );

  exportProgress.value = 100;
  exportedName.value =
    fileName;
  exportStatus.value =
    failures.length
      ? `导出完成，${failures.length} 张图片失败`
      : `导出完成：${sources.length} 条记录，${totalImages} 张图片`;
}

function workExportModel(
  source:
    UnifiedExportSource
): string {
  let model =
    String(
      source.model || ""
    ).trim();

  const provider =
    String(
      source.provider || ""
    ).trim();

  if (
    provider &&
    model
      .toLowerCase()
      .startsWith(
        provider.toLowerCase() +
          "-"
      )
  ) {
    model =
      model.slice(
        provider.length + 1
      );
  }

  return model || "AI模型";
}

function workExportCsv(
  records:
    UnifiedExportRecord[]
): string {
  const rows = [
    [
      "记录ID",
      "生成时间",
      "模型",
      "生成类型",
      "尺寸",
      "耗时(ms)",
      "成本",
      "图片数",
      "图片文件",
      "提示词"
    ],
    ...records.map(
      (record) => [
        record.id,
        record.createdAt,
        record.model,
        record.operation ===
          "image-edit"
          ? "图片编辑"
          : "文生图",
        record.size,
        record.durationMs ??
          "",
        record.cost ??
          "",
        record.images.length,
        record.images
          .map(
            (image) =>
              image.file
          )
          .join(" | "),
        record.prompt
      ]
    )
  ];

  return rows
    .map(
      (row) =>
        row
          .map(workCsvCell)
          .join(",")
    )
    .join("\r\n");
}

function workCsvCell(
  value: unknown
): string {
  const text =
    String(
      value ?? ""
    );

  return /[",\r\n]/.test(
    text
  )
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function workImageExtension(
  mimeType:
    string |
    undefined,
  url: string
): string {
  const mime =
    String(
      mimeType || ""
    ).toLowerCase();

  if (mime.includes("png")) {
    return "png";
  }

  if (mime.includes("webp")) {
    return "webp";
  }

  if (mime.includes("gif")) {
    return "gif";
  }

  if (mime.includes("avif")) {
    return "avif";
  }

  if (
    mime.includes("jpeg") ||
    mime.includes("jpg")
  ) {
    return "jpg";
  }

  try {
    const pathname =
      new URL(
        url,
        window.location.origin
      ).pathname;

    const match =
      pathname.match(
        /\.([a-zA-Z0-9]{2,5})$/
      );

    const extension =
      match?.[1]
        ?.toLowerCase();

    if (
      extension &&
      [
        "jpg",
        "jpeg",
        "png",
        "webp",
        "gif",
        "avif"
      ].includes(
        extension
      )
    ) {
      return extension ===
        "jpeg"
        ? "jpg"
        : extension;
    }
  } catch {
    // 保持默认 jpg。
  }

  return "jpg";
}

function safeWorkFileSegment(
  value: string,
  fallback: string,
  maxLength = 40
): string {
  const normalized =
    String(
      value || ""
    )
      .trim()
      .replace(
        /[<>:"/\\|?*\u0000-\u001F]/g,
        "_"
      )
      .replace(
        /\s+/g,
        "_"
      )
      .replace(
        /_+/g,
        "_"
      )
      .replace(
        /^[._\s]+|[._\s]+$/g,
        ""
      );

  return (
    normalized ||
    fallback
  ).slice(
    0,
    maxLength
  );
}

function workExportTime(
  createdAt: string
): string {
  const date =
    new Date(
      createdAt
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "未知时间";
  }

  return [
    [
      date.getFullYear(),
      workPad(
        date.getMonth() + 1
      ),
      workPad(
        date.getDate()
      )
    ].join("-"),
    [
      workPad(
        date.getHours()
      ),
      workPad(
        date.getMinutes()
      ),
      workPad(
        date.getSeconds()
      )
    ].join("")
  ].join("_");
}

function workZipName(
  scope:
    UnifiedExportScope,
  count: number
): string {
  const scopeName =
    scope === "single"
      ? "单个作品"
      : scope === "selected"
        ? "选中作品"
        : "全部作品";

  return `ZHE_AI_作品库_${scopeName}_${count}条_${workExportTime(new Date().toISOString())}.zip`;
}

function workPad(
  value: number
): string {
  return String(
    value
  ).padStart(
    2,
    "0"
  );
}

function downloadWorkBlob(
  blob: Blob,
  fileName: string
) {
  const url =
    URL.createObjectURL(
      blob
    );

  const anchor =
    document.createElement(
      "a"
    );

  anchor.href = url;
  anchor.download =
    fileName;
  anchor.style.display =
    "none";

  document.body.appendChild(
    anchor
  );

  anchor.click();
  anchor.remove();

  window.setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    1000
  );
}

function displayModel(item: LibraryItem): string {
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

  if (
    model.toLowerCase().startsWith("gpt-")
  ) {
    model = model.slice(4);
  }

  return model || "AI 模型";
}

function handleLibraryKeydown(
  event: KeyboardEvent
) {
  if (
    event.key === "Escape" &&
    detailItem.value
  ) {
    detailItem.value = null;
  }
}

function openImage(url: string) {
  window.open(
    url,
    "_blank",
    "noopener,noreferrer"
  );
}
</script>

<template>
  <section class="work-library">
    <header class="work-library-header">
      <div>
        <span>ECOMMERCE ASSET LIBRARY</span>
        <h3>正式作品库</h3>
        <p>
          收藏、文件夹、标签和备注均保存到 MySQL，可跨设备同步。
        </p>
      </div>

      <div class="work-library-header-actions">
        <button
          type="button"
          @click="createFolder"
        >
          新建文件夹
        </button>
        <button
          type="button"
          @click="createTag"
        >
          新建标签
        </button>
        <button
          type="button"
          class="work-library-export-main"
          :disabled="exporting"
          @click="exportAllWorks"
        >
          {{ exporting ? "导出中…" : "导出全部" }}
        </button>
        <button
          type="button"
          :disabled="loading"
          @click="loadLibrary(false)"
        >
          刷新
        </button>
      </div>
    </header>

    <div class="work-library-summary">
      <button
        type="button"
        :class="{ active: !favoriteOnly && !trashMode && folderId === 'all' }"
        @click="favoriteOnly = false; trashMode = false; folderId = 'all'; loadLibrary(true)"
      >
        <span>全部作品</span>
        <strong>{{ summary.total }}</strong>
      </button>

      <button
        type="button"
        :class="{ active: favoriteOnly }"
        @click="favoriteOnly = true; trashMode = false; loadLibrary(true)"
      >
        <span>已收藏</span>
        <strong>{{ summary.favorite }}</strong>
      </button>

      <button
        type="button"
        :class="{ active: folderId === 'unfiled' }"
        @click="folderId = 'unfiled'; favoriteOnly = false; trashMode = false; loadLibrary(true)"
      >
        <span>未分类</span>
        <strong>{{ summary.unfiled }}</strong>
      </button>

      <button
        type="button"
        :class="{ active: trashMode }"
        @click="trashMode = true; favoriteOnly = false; loadLibrary(true)"
      >
        <span>回收站</span>
        <strong>{{ summary.trash }}</strong>
      </button>
    </div>

    <div
      v-if="successMessage"
      class="work-library-message success"
    >
      {{ successMessage }}
    </div>

    <div
      v-if="errorMessage"
      class="work-library-message error"
    >
      {{ errorMessage }}
    </div>

    <div
      v-if="exporting || exportStatus || exportError"
      class="work-library-export-progress"
      :class="{
        done:
          exportProgress === 100 &&
          !exportError,
        error: !!exportError
      }"
    >
      <div>
        <strong>
          {{
            exportError
              ? "导出失败"
              : exportProgress === 100
                ? "导出完成"
                : "正在导出作品"
          }}
        </strong>
        <span>{{ exportProgress }}%</span>
      </div>
      <i>
        <b
          :style="{
            width: `${exportProgress}%`
          }"
        ></b>
      </i>
      <p>{{ exportError || exportStatus }}</p>
      <small v-if="exportedName">
        {{ exportedName }}
      </small>
    </div>

    <div class="work-library-toolbar">
      <form
        class="work-library-search"
        @submit.prevent="loadLibrary(true)"
      >
        <input
          v-model="search"
          type="search"
          placeholder="搜索提示词、模型、备注、文件夹或标签"
        />
        <button type="submit">
          搜索
        </button>
      </form>

      <select
        v-model="folderId"
        @change="loadLibrary(true)"
      >
        <option value="all">
          全部文件夹
        </option>
        <option value="unfiled">
          未分类
        </option>
        <option
          v-for="folder in folders"
          :key="folder.id"
          :value="folder.id"
        >
          {{ folder.name }}（{{ folder.itemCount }}）
        </option>
      </select>

      <select
        v-model="tagId"
        @change="loadLibrary(true)"
      >
        <option value="all">
          全部标签
        </option>
        <option
          v-for="tag in tags"
          :key="tag.id"
          :value="tag.id"
        >
          {{ tag.name }}（{{ tag.itemCount }}）
        </option>
      </select>

      <select
        v-model="provider"
        @change="loadLibrary(true)"
      >
        <option value="all">
          全部服务商
        </option>
        <option value="grsai">
          GRSAI
        </option>
        <option value="nanobanana">
          Nano Banana
        </option>
        <option value="lingke">
          百嘉瑞 AI
        </option>
      </select>

      <select
        v-model="sort"
        @change="loadLibrary(true)"
      >
        <option value="newest">
          最新生成
        </option>
        <option value="oldest">
          最早生成
        </option>
        <option value="updated">
          最近整理
        </option>
        <option value="favorite">
          收藏优先
        </option>
      </select>
    </div>

    <div class="work-library-category-manager">
      <div>
        <strong>文件夹</strong>
        <span
          v-if="!folders.length"
        >
          暂无文件夹
        </span>
        <button
          v-for="folder in folders"
          :key="folder.id"
          type="button"
          @click="folderId = folder.id; trashMode = false; loadLibrary(true)"
          @dblclick="renameFolder(folder)"
        >
          {{ folder.name }}
          <small>{{ folder.itemCount }}</small>
          <i
            role="button"
            tabindex="0"
            @click.stop="deleteFolder(folder)"
          >×</i>
        </button>
      </div>

      <div>
        <strong>标签</strong>
        <span
          v-if="!tags.length"
        >
          暂无标签
        </span>
        <button
          v-for="tag in tags"
          :key="tag.id"
          type="button"
          @click="tagId = tag.id; loadLibrary(true)"
        >
          #{{ tag.name }}
          <small>{{ tag.itemCount }}</small>
          <i
            role="button"
            tabindex="0"
            @click.stop="deleteTag(tag)"
          >×</i>
        </button>
      </div>
    </div>

    <div
      v-if="selectedCount > 0"
      class="work-library-batch"
    >
      <strong>
        已选择 {{ selectedCount }} 项
      </strong>

      <button
        type="button"
        class="work-library-batch-export"
        :disabled="exporting"
        @click="exportSelectedWorks"
      >
        导出选中
      </button>

      <button
        type="button"
        @click="batchAction('favorite')"
      >
        收藏
      </button>
      <button
        type="button"
        @click="batchAction('unfavorite')"
      >
        取消收藏
      </button>

      <select v-model="batchFolderId">
        <option value="">
          移到未分类
        </option>
        <option
          v-for="folder in folders"
          :key="folder.id"
          :value="folder.id"
        >
          {{ folder.name }}
        </option>
      </select>
      <button
        type="button"
        @click="batchAction('move')"
      >
        移动
      </button>

      <select v-model="batchTagId">
        <option value="">
          选择标签
        </option>
        <option
          v-for="tag in tags"
          :key="tag.id"
          :value="tag.id"
        >
          {{ tag.name }}
        </option>
      </select>
      <button
        type="button"
        @click="batchAction('add-tags')"
      >
        加标签
      </button>
      <button
        type="button"
        @click="batchAction('remove-tags')"
      >
        移除标签
      </button>

      <button
        type="button"
        class="danger"
        @click="batchAction(trashMode ? 'restore' : 'trash')"
      >
        {{ trashMode ? "恢复" : "移入回收站" }}
      </button>
    </div>

    <div class="work-library-select-row">
      <label>
        <input
          type="checkbox"
          :checked="allSelected"
          @change="toggleSelectAll"
        />
        选择本页全部
      </label>

      <button
        v-if="trashMode && summary.trash > 0"
        type="button"
        class="danger-link"
        @click="emptyTrash"
      >
        清空回收站
      </button>
    </div>

    <div
      v-if="loading"
      class="work-library-empty"
    >
      正在读取作品库…
    </div>

    <div
      v-else-if="!items.length"
      class="work-library-empty"
    >
      当前筛选条件下没有作品。
    </div>

    <div
      v-else
      class="work-library-grid"
    >
      <article
        v-for="item in items"
        :key="item.id"
        class="work-library-card"
        :class="{
          selected: selectedIds.has(item.id),
          trashed: Boolean(item.trashedAt)
        }"
      >
        <div class="work-library-card-image">
          <img
            v-if="item.images[0]"
            :src="item.images[0].url"
            alt="作品预览"
            @click="openDetail(item)"
          />
          <div v-else>
            暂无预览
          </div>

          <label>
            <input
              type="checkbox"
              :checked="selectedIds.has(item.id)"
              @change="toggleSelection(item.id)"
            />
          </label>

          <button
            type="button"
            class="favorite"
            :class="{ active: item.favorite }"
            :disabled="actionLoading"
            @click="toggleFavorite(item)"
          >
            {{ item.favorite ? "★" : "☆" }}
          </button>

          <span
            v-if="item.images.length > 1"
          >
            {{ item.images.length }} 张
          </span>
        </div>

        <div class="work-library-card-body">
          <header>
            <strong>{{ displayModel(item) }}</strong>
          </header>

          <p>
            {{ item.prompt || "未填写提示词" }}
          </p>

          <div class="work-library-card-tags">
            <span
              v-if="item.folder"
              class="folder"
            >
              {{ item.folder.name }}
            </span>
            <span
              v-for="tag in item.tags"
              :key="tag.id"
            >
              #{{ tag.name }}
            </span>
          </div>

          <blockquote v-if="item.note">
            {{ item.note }}
          </blockquote>

          <footer>
            <span>{{ formatDate(item.createdAt) }}</span>
            <span>{{ item.size }}</span>
            <span>{{ formatDuration(item.durationMs) }}</span>
          </footer>

          <div class="work-library-card-actions">
            <button
              type="button"
              class="work-library-card-export"
              :disabled="exporting"
              @click="exportSingleWork(item)"
            >
              导出
            </button>
            <button
              type="button"
              @click="openDetail(item)"
            >
              详情与整理
            </button>
            <button
              v-if="item.images[0]"
              type="button"
              @click="openImage(item.images[0].url)"
            >
              打开原图
            </button>
            <button
              type="button"
              :class="{ danger: !item.trashedAt }"
              @click="trashItem(item)"
            >
              {{ item.trashedAt ? "恢复" : "删除" }}
            </button>
          </div>
        </div>
      </article>
    </div>

    <div
      v-if="pagination.totalPages > 1"
      class="work-library-pagination"
    >
      <button
        type="button"
        :disabled="pagination.page <= 1"
        @click="changePage(pagination.page - 1)"
      >
        上一页
      </button>
      <span>
        第 {{ pagination.page }} / {{ pagination.totalPages }} 页 · 共 {{ pagination.total }} 项
      </span>
      <button
        type="button"
        :disabled="pagination.page >= pagination.totalPages"
        @click="changePage(pagination.page + 1)"
      >
        下一页
      </button>
    </div>

    <div
      v-if="detailItem"
      class="work-detail-overlay"
      @click.self="detailItem = null"
    >
      <section class="work-detail-dialog">
        <header>
          <div>
            <span>作品详情</span>
            <h4>{{ displayModel(detailItem) }}</h4>
          </div>
          <button
            type="button"
            @click="detailItem = null"
          >
            ×
          </button>
        </header>

        <div class="work-detail-images">
          <button
            v-for="image in detailItem.images"
            :key="image.id"
            type="button"
            @click="openImage(image.url)"
          >
            <img
              :src="image.url"
              alt="作品原图"
            />
          </button>
        </div>

        <div class="work-detail-content">
          <label>
            <span>文件夹</span>
            <select v-model="detailFolderId">
              <option value="">
                未分类
              </option>
              <option
                v-for="folder in folders"
                :key="folder.id"
                :value="folder.id"
              >
                {{ folder.name }}
              </option>
            </select>
          </label>

          <label>
            <span>备注</span>
            <textarea
              v-model="detailNote"
              maxlength="1000"
              rows="4"
              placeholder="记录商品、平台、活动或设计要求"
            ></textarea>
          </label>

          <fieldset>
            <legend>标签</legend>
            <label
              v-for="tag in tags"
              :key="tag.id"
            >
              <input
                type="checkbox"
                :checked="detailTagIds.has(tag.id)"
                @change="toggleDetailTag(tag.id)"
              />
              #{{ tag.name }}
            </label>
            <span v-if="!tags.length">
              还没有标签，可先在作品库顶部创建。
            </span>
          </fieldset>

          <dl>
            <div>
              <dt>生成方式</dt>
              <dd>
                {{ detailItem.operation === "image-edit" ? "参考图生成" : "文生图" }}
              </dd>
            </div>
            <div>
              <dt>服务商</dt>
              <dd>{{ displayModel(detailItem) }}</dd>
            </div>
            <div>
              <dt>尺寸</dt>
              <dd>{{ detailItem.size }}</dd>
            </div>
            <div>
              <dt>生成时间</dt>
              <dd>{{ formatDate(detailItem.createdAt) }}</dd>
            </div>
            <div>
              <dt>任务 ID</dt>
              <dd>{{ detailItem.generationTaskId || "—" }}</dd>
            </div>
            <div>
              <dt>作品 ID</dt>
              <dd>{{ detailItem.id }}</dd>
            </div>
          </dl>

          <blockquote>
            {{ detailItem.prompt }}
          </blockquote>
        </div>

        <footer>
          <button
            type="button"
            @click="detailItem = null"
          >
            取消
          </button>
          <button
            type="button"
            class="primary"
            :disabled="actionLoading"
            @click="saveDetail"
          >
            {{ actionLoading ? "保存中…" : "保存整理信息" }}
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style src="../work-library.css"></style>

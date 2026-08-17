<script setup lang="ts">
import { platformConfirm } from "../services/platform-feedback";
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  watch
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";
import type {
  AuthUser,
  ModelCapability,
  ProviderId
} from "../types";
import type {
  BatchQueueState,
  BatchRow,
  BatchTemplateColumnKey,
  BatchTemplateRecord,
  PersistedBatchState,
  ServerBatchJob
} from "./batch-studio/types";
import {
  readSpreadsheet
} from "./batch-studio/spreadsheet";
import {
  clampInteger,
  createId,
  csvEscape,
  downloadBlob,
  extensionFromMime,
  safeFileName
} from "./batch-studio/file-utils";
import {
  formatPoints
} from "../utils/format";
import BatchTemplateManager from "./BatchTemplateManager.vue";

const providerOptions: ProviderId[] = [
  "grsai",
  "nanobanana",
  "lingke"
];

const props = defineProps<{
  user: AuthUser
}>();

const emit = defineEmits<{
  balanceUpdated: [credits: number]
}>();

const models = ref<ModelCapability[]>([]);
const rows = ref<BatchRow[]>([]);
const batchName = ref(createDefaultBatchName());
const batchFolderId = ref<string | undefined>(undefined);
const defaultProvider = ref<ProviderId>("grsai");
const defaultModel = ref("");
const defaultSize = ref("1024x1024");
const defaultCount = ref(1);
const queueState = ref<BatchQueueState>("idle");
const currentCredits = ref(props.user.credits);
const loadingModels = ref(true);
const importing = ref(false);
const exporting = ref(false);
const queueBusy = ref(false);
const errorMessage = ref("");
const successMessage = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const restoring = ref(true);
const serverBatches = ref<ServerBatchJob[]>([]);
const activeServerBatch = ref<ServerBatchJob | null>(null);
const activeBatchId = ref<string | null>(null);
const serverLoading = ref(false);
const allBatchScope = ref(false);
const activeTemplate =
  ref<BatchTemplateRecord | null>(
    null
  );
let serverPollTimer: number | undefined;
let saveTimer: number | undefined;

const configuredModels = computed(() =>
  models.value.filter((model) =>
    model.configured
  )
);

const defaultProviderModels = computed(() =>
  configuredModels.value.filter(
    (model) =>
      model.provider ===
      defaultProvider.value
  )
);

const selectedDefaultModel = computed(() =>
  defaultProviderModels.value.find(
    (model) =>
      model.id === defaultModel.value
  ) || defaultProviderModels.value[0]
);

const readyCount = computed(() =>
  rows.value.filter((row) =>
    row.status === "ready"
  ).length
);

const runningCount = computed(() =>
  rows.value.filter((row) =>
    row.status === "running"
  ).length
);

const successCount = computed(() =>
  rows.value.filter((row) =>
    row.status === "success"
  ).length
);

const failedCount = computed(() =>
  rows.value.filter((row) =>
    row.status === "failed"
  ).length
);

const completedCount = computed(() =>
  successCount.value + failedCount.value
);

const progressPercent = computed(() =>
  rows.value.length > 0
    ? Math.round(
        completedCount.value /
        rows.value.length *
        100
      )
    : 0
);

const estimatedPoints = computed(() =>
  rows.value.reduce(
    (sum, row) => {
      if (
        row.status === "success"
      ) {
        return sum;
      }

      const model = findRowModel(row);

      return sum +
        (model?.creditCost || 0) *
        Math.max(1, row.count || 1);
    },
    0
  )
);

const insufficientCredits = computed(() =>
  props.user.role !== "admin" &&
  estimatedPoints.value >
    currentCredits.value
);

const canStart = computed(() =>
  !queueBusy.value &&
  readyCount.value > 0 &&
  !insufficientCredits.value
);

const canPause = computed(() =>
  Boolean(
    activeServerBatch.value &&
    (
      activeServerBatch.value.status ===
        "running" ||
      activeServerBatch.value.status ===
        "queued"
    )
  )
);

const canResume = computed(() =>
  !queueBusy.value &&
  queueState.value === "paused" &&
  readyCount.value > 0
);

const hasExportableResults = computed(() =>
  rows.value.some(
    (row) =>
      row.status === "success" &&
      row.images.length > 0
  )
);

const viewingServerBatch = computed(() =>
  Boolean(activeBatchId.value)
);

const firstEditableRow = computed(() =>
  rows.value.find(
    (row) =>
      row.status !== "running" &&
      row.status !== "success"
  )
);

const templateSeedPrompt = computed(() =>
  firstEditableRow.value?.prompt ||
  "{{商品名}}，高级简约电商主图，主体居中，保持包装文字和 Logo 不变"
);

const templateSeedNegativePrompt = computed(() =>
  firstEditableRow.value
    ?.negativePrompt || ""
);

const templateSeedReferenceImageUrl = computed(() =>
  firstEditableRow.value
    ?.referenceImageUrl || ""
);


watch(
  selectedDefaultModel,
  (model) => {
    if (!model) return;

    if (
      defaultModel.value !== model.id
    ) {
      defaultModel.value = model.id;
    }

    if (
      !model.sizes.includes(
        defaultSize.value
      )
    ) {
      defaultSize.value =
        model.sizes[0] || "auto";
    }

    defaultCount.value = Math.min(
      Math.max(1, defaultCount.value),
      model.maxOutputImages
    );
  },
  { immediate: true }
);

watch(
  [
    rows,
    batchName,
    batchFolderId,
    defaultProvider,
    defaultModel,
    defaultSize,
    defaultCount,
    queueState
  ],
  schedulePersist,
  { deep: true }
);

onMounted(async () => {
  restoreState();

  try {
    const result =
      await apiRequest<{
        models: ModelCapability[]
      }>("/api/models");

    models.value =
      result.models || [];

    normalizeDefaults();
    validateAll();
    await loadServerBatches();
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取批量工作台数据失败";
  } finally {
    loadingModels.value = false;
    restoring.value = false;
  }

  serverPollTimer =
    window.setInterval(
      () => void refreshServerState(),
      3_000
    );

  window.addEventListener(
    "beforeunload",
    handleBeforeUnload
  );
});

onUnmounted(() => {
  window.removeEventListener(
    "beforeunload",
    handleBeforeUnload
  );

  if (serverPollTimer) {
    window.clearInterval(
      serverPollTimer
    );
  }

  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }

  persistState();
});

function storageKey(): string {
  return `ecom-ai-studio:batch-studio:${props.user.id}`;
}

function createDefaultBatchName(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0")
  ].join("");

  return `批量商品图-${date}-${time}`;
}

function createRow(
  input: Partial<BatchRow> = {}
): BatchRow {
  return {
    id: createId(),
    productName:
      input.productName || "",
    prompt:
      input.prompt || "",
    negativePrompt:
      input.negativePrompt || "",
    provider:
      input.provider ||
      defaultProvider.value,
    model:
      input.model ||
      defaultModel.value,
    size:
      input.size ||
      defaultSize.value,
    count:
      clampInteger(
        input.count,
        defaultCount.value,
        1,
        4
      ),
    referenceImageUrl:
      input.referenceImageUrl || "",
    status:
      input.status || "draft",
    validationErrors:
      Array.isArray(
        input.validationErrors
      )
        ? input.validationErrors
        : [],
    progress:
      input.progress || "",
    error:
      input.error,
    warning:
      input.warning,
    historyId:
      input.historyId,
    taskId:
      input.taskId,
    images:
      Array.isArray(input.images)
        ? input.images
        : [],
    pointsCost:
      input.pointsCost
  };
}

function addBlankRow() {
  const row = createRow();
  rows.value.push(row);
  validateRow(row);
}

function removeRow(rowId: string) {
  if (queueBusy.value) return;

  rows.value = rows.value.filter(
    (row) => row.id !== rowId
  );

  if (rows.value.length === 0) {
    queueState.value = "idle";
  }
}

async function clearQueue() {
  if (queueBusy.value) return;

  if (activeBatchId.value) {
    newDraft();
    return;
  }

  if (
    rows.value.length > 0 &&
    !await platformConfirm(
      "确定清空当前草稿吗？"
    )
  ) {
    return;
  }

  resetDraft();
}

function resetDraft() {
  rows.value = [];
  activeBatchId.value = null;
  activeServerBatch.value = null;
  batchFolderId.value = undefined;
  batchName.value =
    createDefaultBatchName();
  queueState.value = "idle";
  queueBusy.value = false;
  errorMessage.value = "";
  successMessage.value = "";
  persistState();
}

function newDraft() {
  resetDraft();
}

function normalizeDefaults() {
  const firstConfigured =
    configuredModels.value[0];

  if (!firstConfigured) return;

  const providerAvailable =
    configuredModels.value.some(
      (model) =>
        model.provider ===
        defaultProvider.value
    );

  if (!providerAvailable) {
    defaultProvider.value =
      firstConfigured.provider;
  }

  const providerModels =
    configuredModels.value.filter(
      (model) =>
        model.provider ===
        defaultProvider.value
    );

  const selected =
    providerModels.find(
      (model) =>
        model.id ===
        defaultModel.value
    ) || providerModels[0];

  if (!selected) return;

  defaultModel.value = selected.id;

  if (
    !selected.sizes.includes(
      defaultSize.value
    )
  ) {
    defaultSize.value =
      selected.sizes[0] || "auto";
  }

  defaultCount.value = Math.min(
    Math.max(1, defaultCount.value),
    selected.maxOutputImages
  );
}

function applyDefaultsToPending() {
  for (const row of rows.value) {
    if (
      row.status === "running" ||
      row.status === "success"
    ) {
      continue;
    }

    row.provider =
      defaultProvider.value;
    row.model =
      defaultModel.value;
    row.size =
      defaultSize.value;
    row.count =
      defaultCount.value;
    validateRow(row);
  }

  successMessage.value =
    "已将默认模型参数应用到未完成任务";
}

function rowModels(
  row: BatchRow
): ModelCapability[] {
  return configuredModels.value.filter(
    (model) =>
      model.provider === row.provider
  );
}

function findRowModel(
  row: BatchRow
): ModelCapability | undefined {
  return configuredModels.value.find(
    (model) =>
      model.provider === row.provider &&
      model.id === row.model
  );
}

function onRowProviderChanged(
  row: BatchRow
) {
  const first = rowModels(row)[0];

  row.model = first?.id || "";
  row.size =
    first?.sizes[0] || "auto";
  row.count = Math.min(
    Math.max(1, row.count),
    first?.maxOutputImages || 1
  );

  validateRow(row);
}

function onRowModelChanged(
  row: BatchRow
) {
  const model = findRowModel(row);

  if (model) {
    if (
      !model.sizes.includes(row.size)
    ) {
      row.size =
        model.sizes[0] || "auto";
    }

    row.count = Math.min(
      Math.max(1, row.count),
      model.maxOutputImages
    );
  }

  validateRow(row);
}

function validateAll(): boolean {
  let valid = true;

  for (const row of rows.value) {
    if (!validateRow(row)) {
      valid = false;
    }
  }

  if (rows.value.length === 0) {
    errorMessage.value =
      "请先导入商品表格或添加任务";
    return false;
  }

  if (!valid) {
    errorMessage.value =
      "部分任务存在参数问题，请根据红色提示修正";
    return false;
  }

  if (insufficientCredits.value) {
    errorMessage.value =
      `预计需要 ${formatPoints(estimatedPoints.value)} 积分，当前只有 ${formatPoints(currentCredits.value)} 积分`;
    return false;
  }

  errorMessage.value = "";
  successMessage.value =
    `预检通过：${readyCount.value} 个任务可以提交`;
  return true;
}

function validateRow(
  row: BatchRow
): boolean {
  if (
    row.status === "running" ||
    row.status === "success"
  ) {
    return true;
  }

  const errors: string[] = [];
  const productName =
    row.productName.trim();
  const prompt = row.prompt.trim();
  const model = findRowModel(row);

  if (!productName) {
    errors.push("缺少商品名");
  }

  if (prompt.length < 2) {
    errors.push("提示词至少需要 2 个字符");
  }

  if (!row.provider) {
    errors.push("缺少服务商");
  }

  if (!model) {
    errors.push("模型不存在或未启用");
  } else {
    if (
      !model.sizes.includes(row.size)
    ) {
      errors.push("尺寸不受该模型支持");
    }

    if (
      !Number.isInteger(row.count) ||
      row.count < 1 ||
      row.count >
        model.maxOutputImages
    ) {
      errors.push(
        `数量必须为 1–${model.maxOutputImages}`
      );
    }

    if (
      row.referenceImageUrl.trim() &&
      !model.supportsReferenceImages
    ) {
      errors.push("该模型不支持参考图");
    }
  }

  row.validationErrors = errors;
  row.error = undefined;
  row.progress = "";
  row.status =
    errors.length === 0
      ? "ready"
      : "draft";

  return errors.length === 0;
}

async function handleImportFile(
  event: Event
) {
  const input =
    event.target as HTMLInputElement;
  const file = input.files?.[0];

  input.value = "";

  if (!file) return;

  importing.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const matrix =
      await readSpreadsheet(file);
    const importedRows =
      rowsFromMatrix(matrix);

    if (importedRows.length === 0) {
      throw new Error(
        "表格中没有可导入的商品任务"
      );
    }

    if (
      rows.value.length > 0 &&
      !await platformConfirm(
        `当前批次已有 ${rows.value.length} 条任务。确定用新表格替换吗？`
      )
    ) {
      return;
    }

    rows.value = importedRows;
    queueState.value = "idle";
    batchFolderId.value = undefined;
    validateAll();

    successMessage.value =
      `已导入 ${rows.value.length} 条商品任务`;
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "导入表格失败";
  } finally {
    importing.value = false;
  }
}

function rowsFromMatrix(
  matrix: string[][]
): BatchRow[] {
  const nonEmpty = matrix.filter(
    (row) =>
      row.some((value) =>
        String(value || "").trim()
      )
  );

  if (nonEmpty.length < 2) {
    return [];
  }

  const firstRow = nonEmpty[0];

  if (!firstRow) {
    return [];
  }

  const headers = firstRow.map(
    normalizeHeader
  );
  const output: BatchRow[] = [];

  for (
    const values of nonEmpty.slice(1, 201)
  ) {
    const record =
      new Map<string, string>();

    headers.forEach((header, index) => {
      if (header) {
        record.set(
          header,
          String(values[index] || "").trim()
        );
      }
    });

    const rawModel = valueForField(
      record,
      "model",
      ["模型", "model", "modelid"]
    );
    const rawProvider = valueForField(
      record,
      "provider",
      ["服务商", "provider", "厂商"]
    );
    const resolved = resolveModelSelection(
      rawProvider,
      rawModel
    );
    const rawCount = valueForField(
      record,
      "count",
      ["数量", "count", "张数", "imagecount"]
    );

    const row = createRow({
      productName: valueForField(
        record,
        "productName",
        [
          "商品名",
          "商品名称",
          "productname",
          "product",
          "name"
        ]
      ),
      prompt: valueForField(
        record,
        "prompt",
        ["提示词", "prompt", "提示语"]
      ),
      negativePrompt: valueForField(
        record,
        "negativePrompt",
        [
          "反向提示词",
          "negativeprompt",
          "negative"
        ]
      ),
      provider: resolved.provider,
      model: resolved.model,
      size: normalizeSize(
        valueForField(
          record,
          "size",
          ["尺寸", "size", "分辨率"]
        ) || defaultSize.value
      ),
      count: clampInteger(
        Number(rawCount),
        defaultCount.value,
        1,
        4
      ),
      referenceImageUrl: valueForField(
        record,
        "referenceImageUrl",
        [
          "参考图",
          "参考图url",
          "referenceimage",
          "referenceimageurl",
          "imageurl",
          "图片url"
        ]
      )
    });

    if (activeTemplate.value) {
      applyTemplateToRow(
        row,
        activeTemplate.value
      );
    } else {
      validateRow(row);
    }

    output.push(row);
  }

  return output;
}

function normalizeHeader(
  value: string
): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-\/\\]+/g, "");
}

function valueForField(
  record: Map<string, string>,
  field: BatchTemplateColumnKey,
  aliases: string[]
): string {
  const custom =
    activeTemplate.value
      ?.columnMapping[field]
      ?.trim();

  return valueByAliases(
    record,
    custom
      ? [custom, ...aliases]
      : aliases
  );
}

function valueByAliases(
  record: Map<string, string>,
  aliases: string[]
): string {
  for (const alias of aliases) {
    const value = record.get(
      normalizeHeader(alias)
    );

    if (value !== undefined) {
      return value;
    }
  }

  return "";
}

function resolveModelSelection(
  rawProvider: string,
  rawModel: string
): {
  provider: ProviderId;
  model: string;
} {
  const normalizedModel =
    rawModel.trim().toLowerCase();
  let provider =
    resolveProvider(rawProvider);

  if (!provider && normalizedModel) {
    const matching =
      configuredModels.value.find(
        (model) =>
          model.id.toLowerCase() ===
            normalizedModel ||
          model.name.toLowerCase() ===
            normalizedModel
      );

    provider = matching?.provider;
  }

  provider =
    provider || defaultProvider.value;

  const providerModels =
    configuredModels.value.filter(
      (model) =>
        model.provider === provider
    );
  const matching =
    providerModels.find(
      (model) =>
        model.id.toLowerCase() ===
          normalizedModel ||
        model.name.toLowerCase() ===
          normalizedModel
    );

  return {
    provider,
    model:
      matching?.id ||
      (provider ===
        defaultProvider.value
        ? defaultModel.value
        : providerModels[0]?.id || "")
  };
}

function resolveProvider(
  value: string
): ProviderId | undefined {
  const normalized =
    value.trim().toLowerCase();

  if (
    normalized === "grsai" ||
    normalized.includes("gpt")
  ) {
    return "grsai";
  }

  if (
    normalized === "nanobanana" ||
    normalized.includes("nano") ||
    normalized.includes("banana")
  ) {
    return "nanobanana";
  }

  if (
    normalized === "lingke" ||
    normalized.includes("百嘉瑞") ||
    normalized === "bjr"
  ) {
    return "lingke";
  }

  return undefined;
}

function normalizeSize(
  value: string
): string {
  return value
    .trim()
    .replace(/[×＊*]/g, "x")
    .replace(/\s+/g, "");
}

function templateHeader(
  field: BatchTemplateColumnKey,
  fallback: string
): string {
  return activeTemplate.value
    ?.columnMapping[field]
    ?.trim() ||
    fallback;
}

function applyTemplate(
  template: BatchTemplateRecord
) {
  activeTemplate.value =
    template;

  defaultProvider.value =
    template.provider as
      ProviderId;
  defaultModel.value =
    template.model;
  defaultSize.value =
    template.size;
  defaultCount.value =
    template.count;

  for (const row of rows.value) {
    if (
      row.status === "running" ||
      row.status === "success"
    ) {
      continue;
    }

    applyTemplateToRow(
      row,
      template
    );
  }

  successMessage.value =
    `已应用模板“${template.name}”`;
  errorMessage.value = "";
}

function applyTemplateToRow(
  row: BatchRow,
  template: BatchTemplateRecord
) {
  const originalPrompt =
    row.prompt;
  const originalNegative =
    row.negativePrompt;
  const originalReference =
    row.referenceImageUrl;

  row.provider =
    template.provider as
      ProviderId;
  row.model =
    template.model;
  row.size =
    template.size;
  row.count =
    template.count;

  row.prompt =
    renderTemplateText(
      template.promptTemplate,
      row,
      originalPrompt,
      originalReference
    );

  row.negativePrompt =
    template.negativePromptTemplate
      ? renderTemplateText(
          template
            .negativePromptTemplate,
          row,
          originalNegative,
          originalReference
        )
      : originalNegative;

  if (template.referenceImageUrl) {
    row.referenceImageUrl =
      renderTemplateText(
        template.referenceImageUrl,
        row,
        originalReference,
        originalReference
      );
  }

  validateRow(row);
}

function renderTemplateText(
  value: string,
  row: BatchRow,
  originalText: string,
  originalReference: string
): string {
  return value
    .replace(
      /\{\{\s*(商品名|product_name|productname)\s*\}\}/gi,
      row.productName ||
        "商品"
    )
    .replace(
      /\{\{\s*(原提示词|original_prompt|originalprompt)\s*\}\}/gi,
      originalText
    )
    .replace(
      /\{\{\s*(参考图URL|reference_image_url|referenceimageurl)\s*\}\}/gi,
      originalReference
    )
    .trim();
}

async function handleBatchCloned(
  batchId: string
) {
  await loadServerBatches();
  await selectServerBatch(
    batchId
  );

  successMessage.value =
    "批次副本已创建";
  errorMessage.value = "";
}

function downloadTemplate() {
  const exampleRow =
    createRow({
      productName: "示例商品",
      prompt:
        "高级简约电商主图，浅色摄影棚背景，主体居中，保持包装文字和Logo不变",
      negativePrompt:
        "模糊、变形、错误文字、裁切商品",
      referenceImageUrl: ""
    });

  if (activeTemplate.value) {
    applyTemplateToRow(
      exampleRow,
      activeTemplate.value
    );
  }

  const lines = [
    [
      templateHeader(
        "productName",
        "商品名"
      ),
      templateHeader(
        "prompt",
        "提示词"
      ),
      templateHeader(
        "negativePrompt",
        "反向提示词"
      ),
      templateHeader(
        "provider",
        "服务商"
      ),
      templateHeader(
        "model",
        "模型"
      ),
      templateHeader(
        "size",
        "尺寸"
      ),
      templateHeader(
        "count",
        "数量"
      ),
      templateHeader(
        "referenceImageUrl",
        "参考图URL"
      )
    ],
    [
      exampleRow.productName,
      exampleRow.prompt,
      exampleRow.negativePrompt,
      exampleRow.provider,
      exampleRow.model,
      exampleRow.size,
      String(exampleRow.count),
      exampleRow.referenceImageUrl
    ]
  ];
  const csv = lines
    .map((line) =>
      line.map(csvEscape).join(",")
    )
    .join("\r\n");
  downloadBlob(
    new Blob(
      ["\uFEFF", csv],
      {
        type:
          "text/csv;charset=utf-8"
      }
    ),
    "批量商品图导入模板.csv"
  );
}

async function runQueue() {
  if (queueBusy.value) return;

  if (activeBatchId.value) {
    await batchAction("start");
    return;
  }

  if (!validateAll()) return;

  if (insufficientCredits.value) {
    errorMessage.value =
      "当前积分不足以创建并启动全部任务";
    return;
  }

  queueBusy.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const created =
      await apiRequest<{
        batch: ServerBatchJob
      }>(
        "/api/batches",
        jsonRequest({
          name:
            batchName.value.trim() ||
            createDefaultBatchName(),
          rows:
            rows.value.map((row) => ({
              productName:
                row.productName,
              prompt:
                row.prompt,
              negativePrompt:
                row.negativePrompt,
              provider:
                row.provider,
              model:
                row.model,
              size:
                row.size,
              count:
                row.count,
              referenceImageUrl:
                row.referenceImageUrl
            }))
        })
      );

    activeBatchId.value =
      created.batch.id;
    activeServerBatch.value =
      created.batch;

    try {
      localStorage.removeItem(
        storageKey()
      );
    } catch {
      // Ignore local cleanup failure.
    }

    await batchAction("start");
    successMessage.value =
      "批次已交给服务端执行，关闭网页后仍会继续运行";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "创建服务端批次失败";
  } finally {
    queueBusy.value = Boolean(
      activeServerBatch.value &&
      (
        activeServerBatch.value.status === "queued" ||
        activeServerBatch.value.status === "running" ||
        activeServerBatch.value.status === "pausing"
      )
    );
  }
}

async function requestPause() {
  await batchAction("pause");
}

async function resumeQueue() {
  await batchAction("resume");
}

async function retryFailed() {
  await batchAction("retry");
}

async function batchAction(
  action:
    | "start"
    | "pause"
    | "resume"
    | "retry"
    | "cancel"
) {
  const batchId =
    activeBatchId.value;

  if (
    !batchId ||
    serverLoading.value
  ) {
    return;
  }

  serverLoading.value = true;
  errorMessage.value = "";

  try {
    const scope =
      allBatchScope.value &&
      props.user.role === "admin"
        ? "?scope=all"
        : "";

    const result =
      await apiRequest<{
        batch: ServerBatchJob
      }>(
        `/api/batches/${encodeURIComponent(batchId)}/${action}${scope}`,
        { method: "POST" }
      );

    applyServerBatch(
      result.batch
    );

    await loadServerBatches();
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "更新批次状态失败";
  } finally {
    serverLoading.value = false;
  }
}

async function exportResultsZip() {
  if (
    exporting.value ||
    !hasExportableResults.value
  ) {
    return;
  }

  exporting.value = true;
  errorMessage.value = "";

  try {
    const JSZip =
      (await import("jszip")).default;
    const zip = new JSZip();
    const manifest: string[][] = [[
      "序号",
      "商品名",
      "状态",
      "服务商",
      "模型",
      "尺寸",
      "数量",
      "作品ID",
      "任务ID",
      "积分",
      "错误或警告"
    ]];

    for (
      const [index, row] of
        rows.value.entries()
    ) {

      manifest.push([
        String(index + 1),
        row.productName,
        row.status,
        row.provider,
        row.model,
        row.size,
        String(row.images.length || row.count),
        row.historyId || "",
        row.taskId || "",
        row.pointsCost === undefined
          ? ""
          : String(row.pointsCost),
        row.error || row.warning || ""
      ]);

      if (
        row.status !== "success" ||
        row.images.length === 0
      ) {
        continue;
      }

      const folder = zip.folder(
        `${String(index + 1).padStart(3, "0")}-${safeFileName(row.productName)}`
      );

      for (
        const [imageIndex, image] of
          row.images.entries()
      ) {
        const response =
          await fetch(image.url);

        if (!response.ok) {
          continue;
        }

        const blob = await response.blob();
        const extension =
          extensionFromMime(
            blob.type ||
            image.mimeType ||
            "image/png"
          );

        folder?.file(
          `${safeFileName(row.productName)}-${String(imageIndex + 1).padStart(2, "0")}.${extension}`,
          blob
        );
      }
    }

    const manifestCsv = manifest
      .map((line) =>
        line.map(csvEscape).join(",")
      )
      .join("\r\n");

    zip.file(
      "批量任务结果.csv",
      `\uFEFF${manifestCsv}`
    );

    const content =
      await zip.generateAsync({
        type: "blob"
      });

    downloadBlob(
      content,
      `${safeFileName(batchName.value)}.zip`
    );
    successMessage.value =
      "批量结果 ZIP 已生成";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "批量导出失败";
  } finally {
    exporting.value = false;
  }
}

async function loadServerBatches() {
  if (serverLoading.value) return;

  serverLoading.value = true;

  try {
    const scope =
      allBatchScope.value &&
      props.user.role === "admin"
        ? "?scope=all"
        : "";

    const result =
      await apiRequest<{
        batches: ServerBatchJob[]
      }>(`/api/batches${scope}`);

    serverBatches.value =
      result.batches || [];

    if (
      activeBatchId.value &&
      !serverBatches.value.some(
        (batch) =>
          batch.id ===
          activeBatchId.value
      )
    ) {
      activeBatchId.value = null;
      activeServerBatch.value = null;
    }
  } finally {
    serverLoading.value = false;
  }
}

async function loadServerBatch(
  batchId: string
) {
  const scope =
    allBatchScope.value &&
    props.user.role === "admin"
      ? "?scope=all"
      : "";

  const result =
    await apiRequest<{
      batch: ServerBatchJob
    }>(
      `/api/batches/${encodeURIComponent(batchId)}${scope}`
    );

  applyServerBatch(
    result.batch
  );
}

async function selectServerBatch(
  batchId: string
) {
  errorMessage.value = "";
  activeBatchId.value = batchId;

  try {
    await loadServerBatch(batchId);
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取批次详情失败";
  }
}

async function refreshServerState() {
  try {
    await loadServerBatches();

    if (activeBatchId.value) {
      await loadServerBatch(
        activeBatchId.value
      );

      const account =
        await apiRequest<{
          user: AuthUser
        }>("/api/account/summary");

      updateCredits(
        account.user.credits
      );
    }
  } catch {
    // Keep the last usable state during transient network failures.
  }
}

async function toggleBatchScope() {
  allBatchScope.value =
    !allBatchScope.value;
  newDraft();
  await loadServerBatches();
}

function applyServerBatch(
  batch: ServerBatchJob
) {
  activeServerBatch.value = batch;
  activeBatchId.value = batch.id;
  batchName.value = batch.name;
  batchFolderId.value = batch.folderId;

  rows.value =
    (batch.items || []).map(
      (item) => ({
        id: item.id,
        productName:
          item.productName,
        prompt:
          item.prompt,
        negativePrompt:
          item.negativePrompt || "",
        provider:
          item.provider === "grsai" ||
          item.provider === "nanobanana" ||
          item.provider === "lingke"
            ? item.provider
            : "",
        model: item.model,
        size: item.size,
        count: item.count,
        referenceImageUrl:
          item.referenceImageUrl || "",
        status:
          item.status === "queued"
            ? "ready"
            : item.status,
        validationErrors: [],
        progress:
          item.progress || "",
        error: item.error,
        warning: item.warning,
        historyId:
          item.historyId,
        taskId:
          item.providerTaskId ||
          item.generationTaskId,
        images:
          item.images || [],
        pointsCost:
          item.pointsCost
      })
    );

  queueState.value =
    batch.status === "running"
      ? "running"
      : batch.status === "pausing"
        ? "pausing"
        : batch.status === "paused"
          ? "paused"
          : batch.status === "completed"
            ? "completed"
            : "idle";

  queueBusy.value =
    batch.status === "running" ||
    batch.status === "queued" ||
    batch.status === "pausing";
}


function updateCredits(
  value: number | undefined
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return;
  }

  currentCredits.value = value;
  emit("balanceUpdated", value);
}

function restoreState() {
  try {
    const raw = localStorage.getItem(
      storageKey()
    );

    if (!raw) {
      restoring.value = false;
      return;
    }

    const parsed =
      JSON.parse(raw) as
        Partial<PersistedBatchState>;

    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.rows)
    ) {
      restoring.value = false;
      return;
    }

    batchName.value =
      typeof parsed.batchName ===
        "string"
        ? parsed.batchName
        : createDefaultBatchName();
    batchFolderId.value =
      typeof parsed.folderId ===
        "string"
        ? parsed.folderId
        : undefined;
    defaultProvider.value =
      parsed.defaultProvider ===
        "lingke" ||
      parsed.defaultProvider ===
        "nanobanana" ||
      parsed.defaultProvider ===
        "grsai"
        ? parsed.defaultProvider
        : "grsai";
    defaultModel.value =
      typeof parsed.defaultModel ===
        "string"
        ? parsed.defaultModel
        : "";
    defaultSize.value =
      typeof parsed.defaultSize ===
        "string"
        ? parsed.defaultSize
        : "1024x1024";
    defaultCount.value =
      clampInteger(
        parsed.defaultCount,
        1,
        1,
        4
      );
    rows.value = parsed.rows
      .slice(0, 200)
      .map((item) => {
        const row = createRow(item);

        if (row.status === "running") {
          row.status = "failed";
          row.progress = "页面中断";
          row.error =
            "上次页面在任务处理中关闭，原任务可能仍在服务端运行。请先到任务中心核对，再决定是否重试。";
        }

        return row;
      });
    queueState.value =
      parsed.queueState ===
        "paused"
        ? "paused"
        : "idle";
  } catch {
    // Ignore damaged local state.
  } finally {
    restoring.value = false;
  }
}

function schedulePersist() {
  if (
    restoring.value ||
    activeBatchId.value
  ) return;

  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(
    persistState,
    120
  );
}

function persistState() {
  if (
    restoring.value ||
    activeBatchId.value
  ) return;

  const state: PersistedBatchState = {
    version: 1,
    batchName: batchName.value,
    folderId: batchFolderId.value,
    defaultProvider:
      defaultProvider.value,
    defaultModel:
      defaultModel.value,
    defaultSize:
      defaultSize.value,
    defaultCount:
      defaultCount.value,
    queueState:
      queueState.value,
    rows: rows.value,
    updatedAt:
      new Date().toISOString()
  };

  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify(state)
    );
  } catch {
    errorMessage.value =
      "浏览器无法保存批量队列状态，请勿关闭当前页面";
  }
}

function handleBeforeUnload(
  event: BeforeUnloadEvent
) {
  if (
    !queueBusy.value ||
    activeBatchId.value
  ) return;

  event.preventDefault();
  event.returnValue = "";
}

function providerLabel(
  provider: ProviderId
): string {
  if (provider === "grsai") {
    return "GPT";
  }

  if (provider === "nanobanana") {
    return "Nano Banana";
  }

  return "百嘉瑞AI";
}

function statusLabel(
  row: BatchRow
): string {
  if (row.status === "ready") {
    return "待提交";
  }

  if (row.status === "running") {
    return "处理中";
  }

  if (row.status === "success") {
    return "成功";
  }

  if (row.status === "failed") {
    return "失败";
  }

  return "待修正";
}
</script>

<template>
  <section class="batch-studio">
    <header class="batch-studio-header">
      <div>
        <span>BATCH PRODUCTION</span>
        <h3>批量商品图工作台</h3>
        <p>
          保存商品模板、模型参数与表格列映射，导入 CSV/XLSX 后由服务器断点续跑，结果归入同名作品库文件夹。
        </p>
      </div>

      <div class="batch-header-actions">
        <input
          ref="fileInput"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          @change="handleImportFile"
        />

        <button
          type="button"
          @click="downloadTemplate"
        >
          下载模板
        </button>

        <button
          type="button"
          class="primary"
          :disabled="importing || loadingModels || viewingServerBatch"
          @click="fileInput?.click()"
        >
          {{ importing ? "导入中…" : "导入 CSV/XLSX" }}
        </button>
      </div>
    </header>

    <BatchTemplateManager
      :models="configuredModels"
      :default-provider="defaultProvider"
      :default-model="defaultModel"
      :default-size="defaultSize"
      :default-count="defaultCount"
      :seed-prompt="templateSeedPrompt"
      :seed-negative-prompt="templateSeedNegativePrompt"
      :seed-reference-image-url="templateSeedReferenceImageUrl"
      :active-batch-id="activeBatchId || undefined"
      :active-batch-name="activeServerBatch?.name"
      :allow-batch-clone="!allBatchScope || activeServerBatch?.userId === user.id"
      :disabled="queueBusy"
      @apply-template="applyTemplate"
      @batch-cloned="handleBatchCloned"
    />

    <div
      v-if="successMessage"
      class="batch-message success"
    >
      {{ successMessage }}
    </div>

    <div
      v-if="errorMessage"
      class="batch-message error"
    >
      {{ errorMessage }}
    </div>

    <div class="batch-server-panel">
      <div class="batch-server-panel-head">
        <div>
          <strong>服务端批次</strong>
          <span>批次创建后由服务器执行，可关闭网页或换设备继续查看。</span>
        </div>

        <div>
          <button
            v-if="user.role === 'admin'"
            type="button"
            @click="toggleBatchScope"
          >
            {{ allBatchScope ? "查看我的批次" : "查看全站批次" }}
          </button>

          <button
            type="button"
            :disabled="serverLoading"
            @click="refreshServerState"
          >
            {{ serverLoading ? "刷新中…" : "刷新" }}
          </button>

          <button
            type="button"
            class="primary"
            @click="newDraft"
          >
            新建批次
          </button>
        </div>
      </div>

      <div
        v-if="serverBatches.length"
        class="batch-server-list"
      >
        <button
          v-for="batch in serverBatches"
          :key="batch.id"
          type="button"
          :class="{
            active: activeBatchId === batch.id
          }"
          @click="selectServerBatch(batch.id)"
        >
          <span>
            <strong>{{ batch.name }}</strong>
            <small v-if="allBatchScope">{{ batch.username }}</small>
          </span>
          <span>
            <b>{{ batch.progress }}%</b>
            <small>{{ batch.successItems }}/{{ batch.totalItems }} 成功</small>
          </span>
        </button>
      </div>

      <div
        v-else
        class="batch-server-empty"
      >
        暂无服务端批次。导入任务后点击“开始批量生成”即可创建。
      </div>
    </div>

    <div class="batch-summary-grid">
      <article>
        <span>任务总数</span>
        <strong>{{ rows.length }}</strong>
      </article>
      <article>
        <span>待提交</span>
        <strong>{{ readyCount }}</strong>
      </article>
      <article>
        <span>处理中</span>
        <strong>{{ runningCount }}</strong>
      </article>
      <article>
        <span>成功 / 失败</span>
        <strong>{{ successCount }} / {{ failedCount }}</strong>
      </article>
      <article>
        <span>预计剩余积分</span>
        <strong>{{ formatPoints(estimatedPoints) }}</strong>
      </article>
      <article>
        <span>当前积分</span>
        <strong>
          {{ user.role === "admin" ? "不限" : formatPoints(currentCredits) }}
        </strong>
      </article>
    </div>

    <div class="batch-progress-card">
      <div>
        <span>批次进度</span>
        <strong>{{ progressPercent }}%</strong>
      </div>
      <div class="batch-progress-track">
        <span :style="{ width: progressPercent + '%' }"></span>
      </div>
    </div>

    <div class="batch-settings">
      <label class="batch-name-field">
        <span>批次名称 / 作品库文件夹</span>
        <input
          v-model="batchName"
          type="text"
          maxlength="80"
          :disabled="queueBusy || viewingServerBatch"
        />
      </label>

      <label>
        <span>默认服务商</span>
        <select
          v-model="defaultProvider"
          :disabled="queueBusy || viewingServerBatch || loadingModels"
        >
          <option
            v-for="providerId in providerOptions"
            :key="providerId"
            :value="providerId"
          >
            {{ providerLabel(providerId) }}
          </option>
        </select>
      </label>

      <label>
        <span>默认模型</span>
        <select
          v-model="defaultModel"
          :disabled="queueBusy || viewingServerBatch || loadingModels"
        >
          <option
            v-for="model in defaultProviderModels"
            :key="model.id"
            :value="model.id"
          >
            {{ model.name }}
          </option>
        </select>
      </label>

      <label>
        <span>默认尺寸</span>
        <select
          v-model="defaultSize"
          :disabled="queueBusy || viewingServerBatch || !selectedDefaultModel"
        >
          <option
            v-for="size in selectedDefaultModel?.sizes || []"
            :key="size"
            :value="size"
          >
            {{ size }}
          </option>
        </select>
      </label>

      <label>
        <span>默认数量</span>
        <input
          v-model.number="defaultCount"
          type="number"
          min="1"
          :max="selectedDefaultModel?.maxOutputImages || 1"
          :disabled="queueBusy || viewingServerBatch"
        />
      </label>

      <button
        type="button"
        :disabled="queueBusy || viewingServerBatch || !rows.length"
        @click="applyDefaultsToPending"
      >
        应用到全部
      </button>
    </div>

    <div class="batch-toolbar">
      <div>
        <button
          type="button"
          :disabled="queueBusy || viewingServerBatch"
          @click="addBlankRow"
        >
          添加一行
        </button>

        <button
          type="button"
          :disabled="queueBusy || viewingServerBatch || !rows.length"
          @click="validateAll"
        >
          参数预检
        </button>

        <button
          type="button"
          class="primary"
          :disabled="!canStart"
          @click="runQueue"
        >
          {{ activeBatchId ? "启动服务端批次" : "创建并启动批次" }}
        </button>

        <button
          type="button"
          :disabled="!canPause"
          @click="requestPause"
        >
          暂停队列
        </button>

        <button
          type="button"
          class="primary"
          :disabled="!canResume"
          @click="resumeQueue"
        >
          继续队列
        </button>

        <button
          type="button"
          :disabled="queueBusy || failedCount === 0"
          @click="retryFailed"
        >
          重试失败项
        </button>

        <button
          v-if="activeBatchId"
          type="button"
          class="danger"
          :disabled="queueBusy"
          @click="batchAction('cancel')"
        >
          取消批次
        </button>
      </div>

      <div>
        <button
          type="button"
          :disabled="exporting || !hasExportableResults"
          @click="exportResultsZip"
        >
          {{ exporting ? "打包中…" : "导出结果 ZIP" }}
        </button>

        <button
          type="button"
          class="danger"
          :disabled="!activeBatchId && (queueBusy || !rows.length)"
          @click="clearQueue"
        >
          {{ activeBatchId ? "返回新草稿" : "清空草稿" }}
        </button>
      </div>
    </div>

    <div
      v-if="insufficientCredits"
      class="batch-credit-warning"
    >
      当前积分不足以覆盖全部待提交任务。可以减少任务数量、降低每行张数或充值后再开始。
    </div>

    <div
      v-if="!rows.length"
      class="batch-empty"
    >
      <strong>还没有批量任务</strong>
      <span>下载模板填写后导入，或者先手动添加一行。</span>
    </div>

    <div
      v-else
      class="batch-table-wrap"
    >
      <table class="batch-table">
        <thead>
          <tr>
            <th>#</th>
            <th>商品名</th>
            <th>提示词</th>
            <th>服务商 / 模型</th>
            <th>尺寸 / 数量</th>
            <th>参考图 URL</th>
            <th>状态</th>
            <th>结果</th>
            <th>操作</th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="row.id"
            :class="`is-${row.status}`"
          >
            <td>{{ index + 1 }}</td>

            <td>
              <input
                v-model="row.productName"
                type="text"
                maxlength="120"
                :disabled="viewingServerBatch || row.status === 'running' || row.status === 'success'"
                @change="validateRow(row)"
              />
            </td>

            <td>
              <textarea
                v-model="row.prompt"
                rows="3"
                maxlength="5000"
                :disabled="viewingServerBatch || row.status === 'running' || row.status === 'success'"
                @change="validateRow(row)"
              ></textarea>
              <input
                v-model="row.negativePrompt"
                type="text"
                maxlength="1000"
                placeholder="反向提示词（可选）"
                :disabled="viewingServerBatch || row.status === 'running' || row.status === 'success'"
              />
            </td>

            <td>
              <select
                v-model="row.provider"
                :disabled="viewingServerBatch || row.status === 'running' || row.status === 'success'"
                @change="onRowProviderChanged(row)"
              >
                <option
                  v-for="providerId in providerOptions"
                  :key="providerId"
                  :value="providerId"
                >
                  {{ providerLabel(providerId) }}
                </option>
              </select>

              <select
                v-model="row.model"
                :disabled="viewingServerBatch || row.status === 'running' || row.status === 'success'"
                @change="onRowModelChanged(row)"
              >
                <option
                  v-for="model in rowModels(row)"
                  :key="model.id"
                  :value="model.id"
                >
                  {{ model.name }}
                </option>
              </select>
            </td>

            <td>
              <select
                v-model="row.size"
                :disabled="viewingServerBatch || row.status === 'running' || row.status === 'success'"
                @change="validateRow(row)"
              >
                <option
                  v-for="size in findRowModel(row)?.sizes || []"
                  :key="size"
                  :value="size"
                >
                  {{ size }}
                </option>
              </select>

              <input
                v-model.number="row.count"
                type="number"
                min="1"
                :max="findRowModel(row)?.maxOutputImages || 1"
                :disabled="viewingServerBatch || row.status === 'running' || row.status === 'success'"
                @change="validateRow(row)"
              />
            </td>

            <td>
              <input
                v-model="row.referenceImageUrl"
                type="url"
                maxlength="2000"
                placeholder="https://...（可选）"
                :disabled="viewingServerBatch || row.status === 'running' || row.status === 'success'"
                @change="validateRow(row)"
              />
            </td>

            <td>
              <span
                class="batch-status"
                :class="row.status"
              >
                {{ statusLabel(row) }}
              </span>

              <small v-if="row.progress">
                {{ row.progress }}
              </small>

              <ul v-if="row.validationErrors.length">
                <li
                  v-for="message in row.validationErrors"
                  :key="message"
                >
                  {{ message }}
                </li>
              </ul>

              <small
                v-if="row.error"
                class="error"
              >
                {{ row.error }}
              </small>

              <small
                v-if="row.warning"
                class="warning"
              >
                {{ row.warning }}
              </small>
            </td>

            <td>
              <div
                v-if="row.images.length"
                class="batch-result-images"
              >
                <a
                  v-for="(image, imageIndex) in row.images.slice(0, 4)"
                  :key="image.url"
                  :href="image.url"
                  target="_blank"
                  rel="noopener"
                >
                  <img
                    :src="image.url"
                    :alt="`${row.productName}-${imageIndex + 1}`"
                  />
                </a>
              </div>

              <small v-if="row.historyId">
                作品 {{ row.historyId.slice(0, 8) }}…
              </small>
            </td>

            <td>
              <button
                type="button"
                class="danger ghost"
                :disabled="queueBusy || viewingServerBatch || row.status === 'running'"
                @click="removeRow(row.id)"
              >
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style src="../batch-studio.css"></style>

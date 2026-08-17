<script setup lang="ts">
import { platformConfirm } from "../services/platform-feedback";
import {
  computed,
  onMounted,
  ref,
  watch
} from "vue";
import {
  apiRequest,
  jsonRequest
} from "../api/client";
import type {
  ModelCapability,
  ProviderId
} from "../types";

interface BatchTemplateColumnMapping {
  productName?: string;
  prompt?: string;
  negativePrompt?: string;
  provider?: string;
  model?: string;
  size?: string;
  count?: string;
  referenceImageUrl?: string;
}

interface BatchTemplateRecord {
  id: string;
  userId: string;
  name: string;
  description?: string;
  provider: string;
  model: string;
  size: string;
  count: number;
  promptTemplate: string;
  negativePromptTemplate?: string;
  referenceImageUrl?: string;
  columnMapping: BatchTemplateColumnMapping;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

interface TemplateForm {
  name: string;
  description: string;
  provider: ProviderId;
  model: string;
  size: string;
  count: number;
  promptTemplate: string;
  negativePromptTemplate: string;
  referenceImageUrl: string;
  columnMapping: BatchTemplateColumnMapping;
}

const props = defineProps<{
  models: ModelCapability[];
  defaultProvider: ProviderId;
  defaultModel: string;
  defaultSize: string;
  defaultCount: number;
  seedPrompt: string;
  seedNegativePrompt: string;
  seedReferenceImageUrl: string;
  activeBatchId?: string;
  activeBatchName?: string;
  allowBatchClone?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  applyTemplate: [
    template: BatchTemplateRecord
  ];
  batchCloned: [
    batchId: string
  ];
}>();

const providerOptions:
  ProviderId[] = [
    "grsai",
    "nanobanana",
    "lingke"
  ];

const mappingFields:
  Array<{
    key:
      keyof BatchTemplateColumnMapping;
    label: string;
    placeholder: string;
  }> = [
    {
      key: "productName",
      label: "商品名列",
      placeholder: "商品名"
    },
    {
      key: "prompt",
      label: "提示词列",
      placeholder: "提示词"
    },
    {
      key: "negativePrompt",
      label: "反向提示词列",
      placeholder: "反向提示词"
    },
    {
      key: "provider",
      label: "服务商列",
      placeholder: "服务商"
    },
    {
      key: "model",
      label: "模型列",
      placeholder: "模型"
    },
    {
      key: "size",
      label: "尺寸列",
      placeholder: "尺寸"
    },
    {
      key: "count",
      label: "数量列",
      placeholder: "数量"
    },
    {
      key: "referenceImageUrl",
      label: "参考图列",
      placeholder: "参考图URL"
    }
  ];

const templates =
  ref<BatchTemplateRecord[]>([]);
const selectedId = ref("");
const form =
  ref<TemplateForm>(
    createDefaultForm()
  );
const cloneName = ref("");
const loading = ref(false);
const saving = ref(false);
const cloning = ref(false);
const errorMessage = ref("");
const successMessage = ref("");

const selectedTemplate =
  computed(() =>
    templates.value.find(
      (template) =>
        template.id ===
        selectedId.value
    )
  );

const providerModels =
  computed(() =>
    props.models.filter(
      (model) =>
        model.provider ===
        form.value.provider &&
        model.configured
    )
  );

const selectedModel =
  computed(() =>
    providerModels.value.find(
      (model) =>
        model.id ===
        form.value.model
    ) ||
    providerModels.value[0]
  );

watch(
  () => props.models,
  () => normalizeFormModel(),
  { deep: true }
);

watch(
  () => form.value.provider,
  () => normalizeFormModel()
);

watch(
  selectedModel,
  (model) => {
    if (!model) return;

    if (
      form.value.model !== model.id
    ) {
      form.value.model = model.id;
    }

    if (
      !model.sizes.includes(
        form.value.size
      )
    ) {
      form.value.size =
        model.sizes[0] || "auto";
    }

    form.value.count =
      Math.max(
        1,
        Math.min(
          form.value.count,
          model.maxOutputImages
        )
      );

    if (
      !model.supportsNegativePrompt
    ) {
      form.value
        .negativePromptTemplate = "";
    }

    if (
      !model.supportsReferenceImages
    ) {
      form.value
        .referenceImageUrl = "";
    }
  },
  { immediate: true }
);

onMounted(async () => {
  fillFromDefaults();
  await loadTemplates();
});

function createDefaultForm():
  TemplateForm {
  return {
    name: "",
    description: "",
    provider:
      props.defaultProvider ||
      "grsai",
    model:
      props.defaultModel || "",
    size:
      props.defaultSize ||
      "1024x1024",
    count:
      Math.max(
        1,
        props.defaultCount || 1
      ),
    promptTemplate:
      props.seedPrompt ||
      "{{商品名}}，高级简约电商主图，主体居中，保持包装文字和 Logo 不变",
    negativePromptTemplate:
      props.seedNegativePrompt || "",
    referenceImageUrl:
      props.seedReferenceImageUrl || "",
    columnMapping: {}
  };
}

function fillFromDefaults() {
  const currentName =
    form.value.name;
  const currentDescription =
    form.value.description;
  const currentMapping =
    form.value.columnMapping;

  form.value = {
    ...createDefaultForm(),
    name: currentName,
    description:
      currentDescription,
    columnMapping:
      currentMapping
  };

  normalizeFormModel();
}

function startNewTemplate() {
  selectedId.value = "";
  form.value =
    createDefaultForm();
  cloneName.value = "";
  errorMessage.value = "";
  successMessage.value = "";
  normalizeFormModel();
}

function normalizeFormModel() {
  const available =
    providerModels.value;

  if (
    !available.some(
      (model) =>
        model.id === form.value.model
    )
  ) {
    form.value.model =
      available[0]?.id || "";
  }
}

async function loadTemplates(
  preferredId?: string
) {
  loading.value = true;
  errorMessage.value = "";

  try {
    const result =
      await apiRequest<{
        templates:
          BatchTemplateRecord[];
      }>("/api/batch-templates");

    templates.value =
      result.templates || [];

    const nextId =
      preferredId ||
      selectedId.value;

    if (
      nextId &&
      templates.value.some(
        (template) =>
          template.id === nextId
      )
    ) {
      selectedId.value = nextId;
      selectTemplate();
    } else if (
      selectedId.value &&
      !templates.value.some(
        (template) =>
          template.id ===
          selectedId.value
      )
    ) {
      startNewTemplate();
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "读取商品模板失败";
  } finally {
    loading.value = false;
  }
}

function selectTemplate() {
  const template =
    selectedTemplate.value;

  if (!template) return;

  form.value = {
    name: template.name,
    description:
      template.description || "",
    provider:
      template.provider as
        ProviderId,
    model: template.model,
    size: template.size,
    count: template.count,
    promptTemplate:
      template.promptTemplate,
    negativePromptTemplate:
      template
        .negativePromptTemplate || "",
    referenceImageUrl:
      template.referenceImageUrl || "",
    columnMapping: {
      ...template.columnMapping
    }
  };

  normalizeFormModel();
  errorMessage.value = "";
  successMessage.value = "";
}

function formPayload() {
  return {
    name:
      form.value.name.trim(),
    description:
      form.value.description.trim() ||
      undefined,
    provider:
      form.value.provider,
    model:
      form.value.model,
    size:
      form.value.size,
    count:
      form.value.count,
    promptTemplate:
      form.value.promptTemplate.trim(),
    negativePromptTemplate:
      form.value
        .negativePromptTemplate
        .trim() || undefined,
    referenceImageUrl:
      form.value
        .referenceImageUrl
        .trim() || undefined,
    columnMapping: {
      ...form.value.columnMapping
    }
  };
}

async function saveNewTemplate() {
  if (saving.value) return;

  saving.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const result =
      await apiRequest<{
        template:
          BatchTemplateRecord;
      }>(
        "/api/batch-templates",
        jsonRequest(
          formPayload()
        )
      );

    selectedId.value =
      result.template.id;

    await loadTemplates(
      result.template.id
    );

    successMessage.value =
      "商品模板已保存到 MySQL";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "保存商品模板失败";
  } finally {
    saving.value = false;
  }
}

async function updateTemplate() {
  const template =
    selectedTemplate.value;

  if (
    !template ||
    saving.value
  ) {
    return;
  }

  saving.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const result =
      await apiRequest<{
        template:
          BatchTemplateRecord;
      }>(
        `/api/batch-templates/${encodeURIComponent(template.id)}`,
        jsonRequest(
          formPayload(),
          "PATCH"
        )
      );

    await loadTemplates(
      result.template.id
    );

    successMessage.value =
      "商品模板已更新";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "更新商品模板失败";
  } finally {
    saving.value = false;
  }
}

async function deleteTemplate() {
  const template =
    selectedTemplate.value;

  if (
    !template ||
    saving.value ||
    !await platformConfirm(
      `确定删除模板“${template.name}”吗？`
    )
  ) {
    return;
  }

  saving.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    await apiRequest<{
      success: boolean;
    }>(
      `/api/batch-templates/${encodeURIComponent(template.id)}`,
      {
        method: "DELETE"
      }
    );

    startNewTemplate();
    await loadTemplates();

    successMessage.value =
      "商品模板已删除";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "删除商品模板失败";
  } finally {
    saving.value = false;
  }
}

async function applySelectedTemplate() {
  const template =
    selectedTemplate.value;

  if (!template) {
    errorMessage.value =
      "请先选择已保存的模板";
    return;
  }

  errorMessage.value = "";
  successMessage.value = "";

  try {
    const result =
      await apiRequest<{
        template:
          BatchTemplateRecord;
      }>(
        `/api/batch-templates/${encodeURIComponent(template.id)}/use`,
        jsonRequest({})
      );

    emit(
      "applyTemplate",
      result.template
    );

    await loadTemplates(
      result.template.id
    );

    successMessage.value =
      "模板已应用到当前草稿";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "应用商品模板失败";
  }
}

async function cloneActiveBatch(
  start: boolean
) {
  if (
    !props.activeBatchId ||
    cloning.value
  ) {
    return;
  }

  if (
    start &&
    !await platformConfirm(
      "复制当前批次并立即重新生产全部商品吗？新批次会重新扣除积分。"
    )
  ) {
    return;
  }

  cloning.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const result =
      await apiRequest<{
        batch: {
          id: string;
          name: string;
        };
      }>(
        `/api/batches/${encodeURIComponent(props.activeBatchId)}/clone`,
        jsonRequest({
          name:
            cloneName.value.trim() ||
            `${props.activeBatchName || "批次"}-${start ? "重新生产" : "副本"}`,
          start
        })
      );

    emit(
      "batchCloned",
      result.batch.id
    );

    cloneName.value = "";
    successMessage.value =
      start
        ? "新批次已创建并开始生产"
        : "批次副本已创建";
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "复制批次失败";
  } finally {
    cloning.value = false;
  }
}

function setColumnMapping(
  key: keyof BatchTemplateColumnMapping,
  event: Event
) {
  const target =
    event.target as
      HTMLInputElement | null;

  if (!target) return;

  const value =
    target.value.trim();

  if (value) {
    form.value.columnMapping[key] =
      value;
  } else {
    delete form.value
      .columnMapping[key];
  }
}

function providerLabel(
  provider: ProviderId
): string {
  if (provider === "grsai") {
    return "GPT";
  }

  if (
    provider === "nanobanana"
  ) {
    return "Nano Banana";
  }

  return "百嘉瑞";
}
</script>

<template>
  <section class="batch-template-panel">
    <div class="batch-template-head">
      <div>
        <span>TEMPLATE PRESETS</span>
        <strong>商品模板与批次复用</strong>
        <small>
          模板、参数和 Excel 列映射保存到 MySQL，可跨设备复用。
        </small>
      </div>

      <div>
        <select
          v-model="selectedId"
          :disabled="loading || disabled"
          @change="selectTemplate"
        >
          <option value="">
            新建商品模板
          </option>
          <option
            v-for="template in templates"
            :key="template.id"
            :value="template.id"
          >
            {{ template.name }}
          </option>
        </select>

        <button
          type="button"
          :disabled="disabled"
          @click="startNewTemplate"
        >
          新建
        </button>

        <button
          type="button"
          :disabled="disabled"
          @click="fillFromDefaults"
        >
          从当前草稿填充
        </button>

        <button
          type="button"
          class="primary"
          :disabled="!selectedTemplate || disabled"
          @click="applySelectedTemplate"
        >
          应用模板
        </button>
      </div>
    </div>

    <div
      v-if="successMessage"
      class="batch-template-message success"
    >
      {{ successMessage }}
    </div>

    <div
      v-if="errorMessage"
      class="batch-template-message error"
    >
      {{ errorMessage }}
    </div>

    <div class="batch-template-form">
      <label>
        <span>模板名称</span>
        <input
          v-model="form.name"
          type="text"
          maxlength="120"
          placeholder="例如：天猫白底主图"
          :disabled="disabled"
        />
      </label>

      <label class="wide">
        <span>模板说明</span>
        <input
          v-model="form.description"
          type="text"
          maxlength="500"
          placeholder="适用平台、商品类型或使用说明"
          :disabled="disabled"
        />
      </label>

      <label>
        <span>服务商</span>
        <select
          v-model="form.provider"
          :disabled="disabled"
        >
          <option
            v-for="provider in providerOptions"
            :key="provider"
            :value="provider"
          >
            {{ providerLabel(provider) }}
          </option>
        </select>
      </label>

      <label>
        <span>模型</span>
        <select
          v-model="form.model"
          :disabled="disabled"
        >
          <option
            v-for="model in providerModels"
            :key="model.id"
            :value="model.id"
          >
            {{ model.name }}
          </option>
        </select>
      </label>

      <label>
        <span>尺寸</span>
        <select
          v-model="form.size"
          :disabled="disabled || !selectedModel"
        >
          <option
            v-for="size in selectedModel?.sizes || []"
            :key="size"
            :value="size"
          >
            {{ size }}
          </option>
        </select>
      </label>

      <label>
        <span>数量</span>
        <input
          v-model.number="form.count"
          type="number"
          min="1"
          :max="selectedModel?.maxOutputImages || 1"
          :disabled="disabled"
        />
      </label>

      <label class="prompt">
        <span>提示词模板</span>
        <textarea
          v-model="form.promptTemplate"
          rows="4"
          maxlength="5000"
          :disabled="disabled"
          placeholder="可使用 {{商品名}}、{{原提示词}}、{{参考图URL}}"
        ></textarea>
      </label>

      <label class="prompt">
        <span>反向提示词模板</span>
        <textarea
          v-model="form.negativePromptTemplate"
          rows="4"
          maxlength="2000"
          :disabled="disabled || !selectedModel?.supportsNegativePrompt"
        ></textarea>
      </label>

      <label class="wide">
        <span>默认参考图 URL</span>
        <input
          v-model="form.referenceImageUrl"
          type="url"
          maxlength="2000"
          placeholder="可使用 {{参考图URL}}，留空则保留表格中的参考图"
          :disabled="disabled || !selectedModel?.supportsReferenceImages"
        />
      </label>
    </div>

    <details class="batch-template-mapping">
      <summary>
        Excel / CSV 自定义列映射
      </summary>

      <p>
        填写你的表格表头名称。留空时继续识别系统内置的中英文列名。
      </p>

      <div>
        <label
          v-for="field in mappingFields"
          :key="field.key"
        >
          <span>{{ field.label }}</span>
          <input
            :value="form.columnMapping[field.key] || ''"
            type="text"
            maxlength="120"
            :placeholder="field.placeholder"
            :disabled="disabled"
            @input="setColumnMapping(field.key, $event)"
          />
        </label>
      </div>
    </details>

    <div class="batch-template-actions">
      <div>
        <button
          type="button"
          class="primary"
          :disabled="saving || disabled || !form.name.trim()"
          @click="saveNewTemplate"
        >
          {{ saving ? "保存中…" : "另存为新模板" }}
        </button>

        <button
          type="button"
          :disabled="saving || disabled || !selectedTemplate"
          @click="updateTemplate"
        >
          更新当前模板
        </button>

        <button
          type="button"
          class="danger"
          :disabled="saving || disabled || !selectedTemplate"
          @click="deleteTemplate"
        >
          删除模板
        </button>
      </div>

      <div
        v-if="activeBatchId && allowBatchClone !== false"
        class="batch-clone-actions"
      >
        <input
          v-model="cloneName"
          type="text"
          maxlength="120"
          :placeholder="`${activeBatchName || '当前批次'}-副本`"
          :disabled="cloning"
        />

        <button
          type="button"
          :disabled="cloning"
          @click="cloneActiveBatch(false)"
        >
          复制批次
        </button>

        <button
          type="button"
          class="primary"
          :disabled="cloning"
          @click="cloneActiveBatch(true)"
        >
          {{ cloning ? "处理中…" : "复制并重新生产" }}
        </button>
      </div>
    </div>
  </section>
</template>

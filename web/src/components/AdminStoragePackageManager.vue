<script setup lang="ts">
import { platformConfirm } from "../services/platform-feedback";
import { computed, onMounted, reactive, ref } from "vue";
import { apiRequest, jsonRequest } from "../api/client";
import type { StoragePackage, StorageSettings } from "../types";
import { formatPoints } from "../utils/format";

const settings = ref<StorageSettings | null>(null);
const packages = ref<StoragePackage[]>([]);
const loading = ref(true);
const savingSettings = ref(false);
const savingPackage = ref(false);
const editingId = ref("");
const message = ref("");
const errorMessage = ref("");

const settingsDraft = reactive({
  enforcementEnabled: false,
  baseImageLimit: 20,
  baseRetentionDays: 7,
  graceDays: 3
});

const packageDraft = reactive({
  name: "",
  description: "",
  imageLimitBonus: 20,
  retentionDaysBonus: 7,
  validDays: 30,
  pointsCost: 10,
  enabled: true,
  sortOrder: 100
});

const presets = [
  {
    name: "轻量扩容",
    description: "适合偶尔保留更多作品的轻度用户。",
    imageLimitBonus: 20,
    retentionDaysBonus: 7,
    validDays: 30,
    pointsCost: 10
  },
  {
    name: "标准扩容",
    description: "兼顾作品数量与保存期限的常用方案。",
    imageLimitBonus: 50,
    retentionDaysBonus: 30,
    validDays: 60,
    pointsCost: 25
  },
  {
    name: "长期创作",
    description: "适合高频创作者的长期保存方案。",
    imageLimitBonus: 100,
    retentionDaysBonus: 90,
    validDays: 120,
    pointsCost: 60
  }
];

const policySummary = computed(() =>
  settingsDraft.enforcementEnabled
    ? `当前自动策略：${settingsDraft.baseImageLimit} 张 / ${settingsDraft.baseRetentionDays} 天 / ${settingsDraft.graceDays} 天宽限`
    : "自动清理尚未启用，当前不会按数量或期限删除用户作品"
);

onMounted(load);

async function load() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const data = await apiRequest<{
      settings: StorageSettings;
      packages: StoragePackage[];
    }>("/api/admin/storage-packages");

    settings.value = data.settings;
    packages.value = data.packages || [];
    Object.assign(settingsDraft, data.settings);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取存储策略失败";
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  savingSettings.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    const data = await apiRequest<{ settings: StorageSettings }>(
      "/api/admin/storage-settings",
      jsonRequest(settingsDraft, "PATCH")
    );

    settings.value = data.settings;
    Object.assign(settingsDraft, data.settings);
    message.value = "存储策略已保存。";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存存储策略失败";
  } finally {
    savingSettings.value = false;
  }
}

function applyPreset(index: number) {
  const preset = presets[index];
  if (!preset) return;

  Object.assign(packageDraft, {
    ...preset,
    enabled: true,
    sortOrder: 100
  });

  editingId.value = "";
}

function editPackage(item: StoragePackage) {
  editingId.value = item.id;
  Object.assign(packageDraft, {
    name: item.name,
    description: item.description || "",
    imageLimitBonus: item.imageLimitBonus,
    retentionDaysBonus: item.retentionDaysBonus,
    validDays: item.validDays,
    pointsCost: item.pointsCost,
    enabled: item.enabled,
    sortOrder: item.sortOrder
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetPackageForm() {
  editingId.value = "";
  Object.assign(packageDraft, {
    name: "",
    description: "",
    imageLimitBonus: 20,
    retentionDaysBonus: 7,
    validDays: 30,
    pointsCost: 10,
    enabled: true,
    sortOrder: 100
  });
}

async function savePackage() {
  if (!packageDraft.name.trim()) {
    errorMessage.value = "请填写方案名称";
    return;
  }

  savingPackage.value = true;
  message.value = "";
  errorMessage.value = "";

  try {
    if (editingId.value) {
      await apiRequest(
        `/api/admin/storage-packages/${encodeURIComponent(editingId.value)}`,
        jsonRequest(packageDraft, "PATCH")
      );
      message.value = "存储方案已更新。";
    } else {
      await apiRequest(
        "/api/admin/storage-packages",
        jsonRequest(packageDraft)
      );
      message.value = "存储方案已创建。";
    }

    resetPackageForm();
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存存储方案失败";
  } finally {
    savingPackage.value = false;
  }
}

async function removePackage(item: StoragePackage) {
  if (!await platformConfirm(`删除存储方案“${item.name}”吗？已兑换权益不会受影响。`)) return;

  errorMessage.value = "";

  try {
    await apiRequest(
      `/api/admin/storage-packages/${encodeURIComponent(item.id)}`,
      { method: "DELETE" }
    );

    message.value = "存储方案已删除。";

    if (editingId.value === item.id) {
      resetPackageForm();
    }

    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "删除存储方案失败";
  }
}
</script>

<template>
  <div class="admin-storage-v5">
    <header class="storage-admin-hero">
      <div>
        <span>STORAGE CONTROL CENTER</span>
        <h2>存储权益控制台</h2>
        <p>
          在一个页面内完成基础额度、自动清理开关、积分兑换方案和现有套餐维护。
          灵感广场审核中/已公开的作品始终受到保护。
        </p>
      </div>

      <div class="policy-state" :class="{ on: settingsDraft.enforcementEnabled }">
        <i></i>
        <div>
          <strong>{{ settingsDraft.enforcementEnabled ? "自动策略运行中" : "自动策略未开启" }}</strong>
          <small>{{ policySummary }}</small>
        </div>
      </div>
    </header>

    <p v-if="message" class="admin-storage-message success">{{ message }}</p>
    <p v-if="errorMessage" class="admin-storage-message error">{{ errorMessage }}</p>

    <div v-if="loading" class="admin-storage-empty">正在读取配置…</div>

    <template v-else>
      <section class="policy-panel">
        <div class="panel-heading">
          <div>
            <span>BASE POLICY</span>
            <h3>基础存储策略</h3>
          </div>
          <button type="button" :disabled="savingSettings" @click="saveSettings">
            {{ savingSettings ? "保存中…" : "保存策略" }}
          </button>
        </div>

        <div class="policy-grid">
          <label class="policy-switch-card">
            <input v-model="settingsDraft.enforcementEnabled" type="checkbox" />
            <span class="switch-track"><i></i></span>
            <div>
              <strong>自动存储策略</strong>
              <small>
                {{
                  settingsDraft.enforcementEnabled
                    ? "开启后按有效权益执行数量与期限清理"
                    : "当前关闭，不会自动清理用户作品"
                }}
              </small>
            </div>
          </label>

          <label class="metric-field">
            <span>基础图片额度</span>
            <div><input v-model.number="settingsDraft.baseImageLimit" type="number" min="1" max="100000" /><b>张</b></div>
            <small>每个普通用户的基础云端图片数量</small>
          </label>

          <label class="metric-field">
            <span>基础保存期限</span>
            <div><input v-model.number="settingsDraft.baseRetentionDays" type="number" min="1" max="3650" /><b>天</b></div>
            <small>没有额外权益时的默认保存天数</small>
          </label>

          <label class="metric-field">
            <span>到期宽限期</span>
            <div><input v-model.number="settingsDraft.graceDays" type="number" min="0" max="90" /><b>天</b></div>
            <small>权益到期后给予用户的缓冲时间</small>
          </label>
        </div>
      </section>

      <section class="package-builder">
        <div class="panel-heading">
          <div>
            <span>PACKAGE BUILDER</span>
            <h3>{{ editingId ? "编辑兑换方案" : "创建兑换方案" }}</h3>
          </div>
          <button v-if="editingId" type="button" class="secondary" @click="resetPackageForm">
            取消编辑
          </button>
        </div>

        <div v-if="!editingId" class="preset-row">
          <span>快速模板</span>
          <button
            v-for="(preset, index) in presets"
            :key="preset.name"
            type="button"
            @click="applyPreset(index)"
          >
            <strong>{{ preset.name }}</strong>
            <small>+{{ preset.imageLimitBonus }} 张 · +{{ preset.retentionDaysBonus }} 天</small>
          </button>
        </div>

        <form @submit.prevent="savePackage">
          <div class="builder-main">
            <label class="field-card">
              <span>方案名称</span>
              <input v-model="packageDraft.name" maxlength="60" placeholder="例如：标准扩容包" />
            </label>

            <label class="field-card wide">
              <span>方案介绍</span>
              <input
                v-model="packageDraft.description"
                maxlength="300"
                placeholder="告诉用户这个方案适合什么场景"
              />
            </label>

            <label class="field-card accent">
              <span>增加图片数量</span>
              <div><input v-model.number="packageDraft.imageLimitBonus" type="number" min="0" max="100000" /><b>张</b></div>
            </label>

            <label class="field-card accent">
              <span>增加保存天数</span>
              <div><input v-model.number="packageDraft.retentionDaysBonus" type="number" min="0" max="3650" /><b>天</b></div>
            </label>

            <label class="field-card">
              <span>权益有效期</span>
              <div><input v-model.number="packageDraft.validDays" type="number" min="1" max="3650" /><b>天</b></div>
            </label>

            <label class="field-card">
              <span>兑换积分</span>
              <div><input v-model.number="packageDraft.pointsCost" type="number" min="0.01" step="0.01" /><b>积分</b></div>
            </label>

            <label class="field-card">
              <span>展示排序</span>
              <input v-model.number="packageDraft.sortOrder" type="number" min="0" max="9999" />
            </label>
          </div>

          <footer>
            <label class="publish-toggle">
              <input v-model="packageDraft.enabled" type="checkbox" />
              <span><i></i></span>
              <div>
                <strong>{{ packageDraft.enabled ? "立即上架" : "暂不上架" }}</strong>
                <small>关闭后普通用户不可兑换</small>
              </div>
            </label>

            <div class="package-preview">
              <span>方案预览</span>
              <strong>{{ packageDraft.name || "未命名方案" }}</strong>
              <small>
                +{{ packageDraft.imageLimitBonus }} 张 ·
                +{{ packageDraft.retentionDaysBonus }} 天 ·
                有效 {{ packageDraft.validDays }} 天 ·
                {{ formatPoints(packageDraft.pointsCost) }} 积分
              </small>
            </div>

            <button type="submit" class="primary" :disabled="savingPackage">
              {{ savingPackage ? "保存中…" : editingId ? "保存修改" : "创建方案" }}
            </button>
          </footer>
        </form>
      </section>

      <section class="package-library">
        <div class="panel-heading">
          <div>
            <span>PACKAGE LIBRARY</span>
            <h3>现有兑换方案</h3>
          </div>
          <small>{{ packages.length }} 个方案</small>
        </div>

        <div v-if="packages.length" class="package-grid">
          <article v-for="item in packages" :key="item.id" :class="{ off: !item.enabled }">
            <header>
              <i>{{ item.enabled ? "上架中" : "已下架" }}</i>
              <small>排序 {{ item.sortOrder }}</small>
            </header>

            <h4>{{ item.name }}</h4>
            <p>{{ item.description || "暂无介绍" }}</p>

            <div class="package-benefits">
              <span>+{{ item.imageLimitBonus }} 张</span>
              <span>+{{ item.retentionDaysBonus }} 天</span>
              <span>有效 {{ item.validDays }} 天</span>
            </div>

            <div class="package-price">
              <strong>{{ formatPoints(item.pointsCost) }}</strong>
              <small>积分</small>
            </div>

            <footer>
              <button type="button" @click="editPackage(item)">编辑方案</button>
              <button type="button" class="danger" @click="removePackage(item)">删除</button>
            </footer>
          </article>
        </div>

        <div v-else class="admin-storage-empty">
          <span>◇</span>
          <strong>还没有兑换方案</strong>
          <p>可以从上面的快速模板开始创建第一个存储权益方案。</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.admin-storage-v5{display:grid;gap:18px}.storage-admin-hero{display:flex;justify-content:space-between;align-items:flex-end;gap:26px;padding:28px;border:1px solid #ddd9f5;border-radius:20px;background:linear-gradient(135deg,#fff,#f5f4ff)}.storage-admin-hero>div:first-child{max-width:760px}.storage-admin-hero span,.panel-heading span{color:#6e5dd5;font-size:10px;font-weight:900;letter-spacing:.14em}.storage-admin-hero h2{margin:7px 0;color:#292c40;font-size:25px}.storage-admin-hero p{margin:0;color:#73788b;font-size:13px;line-height:1.75}.policy-state{display:flex;align-items:center;gap:11px;max-width:430px;padding:14px 16px;border:1px solid #efd7ad;border-radius:14px;background:#fff9ed}.policy-state>i{flex:0 0 auto;width:11px;height:11px;border-radius:50%;background:#e3a446;box-shadow:0 0 0 5px rgba(227,164,70,.12)}.policy-state.on{border-color:#bfe5ce;background:#effaf3}.policy-state.on>i{background:#45b878;box-shadow:0 0 0 5px rgba(69,184,120,.12)}.policy-state div{display:grid;gap:2px}.policy-state strong{color:#4a4e61;font-size:11px}.policy-state small{color:#85899b;font-size:9px;line-height:1.5}.admin-storage-message{margin:0;padding:12px 14px;border-radius:11px;font-size:11px}.admin-storage-message.success{background:#edf9f2;color:#327353}.admin-storage-message.error{background:#fff1f2;color:#ae4c58}.policy-panel,.package-builder,.package-library{padding:22px;border:1px solid #e0e3ec;border-radius:18px;background:#fff;box-shadow:0 9px 26px rgba(49,52,81,.035)}.panel-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px}.panel-heading h3{margin:5px 0 0;color:#313448;font-size:20px}.panel-heading>button,.panel-heading>small{flex:0 0 auto}.panel-heading>button{min-height:38px;padding:0 14px;border:0;border-radius:10px;background:#6554d4;color:#fff;font-size:11px;font-weight:850;cursor:pointer}.panel-heading>button.secondary{border:1px solid #e0e2ea;background:#fff;color:#696d80}.panel-heading>small{color:#8a8e9f;font-size:10px}.policy-grid{display:grid;grid-template-columns:1.35fr repeat(3,1fr);gap:11px}.policy-switch-card,.metric-field{min-height:122px;padding:16px;border:1px solid #e3e5ed;border-radius:14px;background:#fafbfe}.policy-switch-card{position:relative;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:14px;cursor:pointer}.policy-switch-card>input{position:absolute;opacity:0;pointer-events:none}.switch-track{position:relative;width:48px;height:28px;border-radius:999px;background:#d9dce6;transition:.2s ease}.switch-track i{position:absolute;top:4px;left:4px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 2px 7px rgba(38,41,62,.18);transition:.2s ease}.policy-switch-card>input:checked+.switch-track{background:#6b59db}.policy-switch-card>input:checked+.switch-track i{transform:translateX(20px)}.policy-switch-card div{display:grid;gap:4px}.policy-switch-card strong{color:#35384b;font-size:13px}.policy-switch-card small{color:#818598;font-size:10px;line-height:1.55}.metric-field{display:grid;align-content:start;gap:9px}.metric-field>span,.field-card>span{color:#6f7386;font-size:10px;font-weight:850}.metric-field>div,.field-card>div{display:flex;align-items:center;gap:8px}.metric-field input,.field-card input{width:100%;min-width:0;height:42px;padding:0 11px;border:1px solid #dfe1e9;border-radius:10px;background:#fff;color:#303347;font:inherit;font-size:13px;font-weight:800;outline:0}.metric-field input:focus,.field-card input:focus{border-color:#8273df;box-shadow:0 0 0 3px rgba(113,95,216,.1)}.metric-field b,.field-card b{flex:0 0 auto;color:#73778a;font-size:10px}.metric-field small{color:#9699aa;font-size:9px;line-height:1.45}.preset-row{display:flex;align-items:stretch;gap:8px;margin-bottom:15px;padding:10px;border:1px solid #e3e4ed;border-radius:13px;background:#f8f9fc}.preset-row>span{display:flex;align-items:center;padding:0 7px;color:#7f8395;font-size:10px;font-weight:800}.preset-row button{display:grid;gap:2px;min-width:150px;padding:9px 11px;border:1px solid #e0e2ea;border-radius:10px;background:#fff;color:#5d6174;text-align:left;cursor:pointer}.preset-row button:hover{border-color:#bfb8ef;background:#f7f5ff}.preset-row strong{font-size:10px}.preset-row small{color:#9498a8;font-size:8px}.builder-main{display:grid;grid-template-columns:1.1fr 1.4fr repeat(5,.72fr);gap:9px}.field-card{display:grid;align-content:start;gap:7px;padding:13px;border:1px solid #e3e5ed;border-radius:12px;background:#fafbfe}.field-card.wide{grid-column:auto}.field-card.accent{border-color:#ded8fb;background:#f8f6ff}.package-builder form>footer{display:grid;grid-template-columns:auto minmax(300px,1fr) auto;align-items:center;gap:13px;margin-top:13px;padding-top:13px;border-top:1px solid #eceef3}.publish-toggle{position:relative;display:flex;align-items:center;gap:10px;cursor:pointer}.publish-toggle>input{position:absolute;opacity:0}.publish-toggle>span{position:relative;width:42px;height:25px;border-radius:999px;background:#d9dce6}.publish-toggle>span i{position:absolute;top:4px;left:4px;width:17px;height:17px;border-radius:50%;background:#fff;transition:.2s ease}.publish-toggle>input:checked+span{background:#6a58d8}.publish-toggle>input:checked+span i{transform:translateX(17px)}.publish-toggle div{display:grid;gap:2px}.publish-toggle strong{font-size:10px}.publish-toggle small{color:#9296a7;font-size:8px}.package-preview{display:flex;align-items:center;gap:10px;min-width:0;padding:10px 12px;border-radius:10px;background:#f6f7fb}.package-preview>span{color:#8f93a4;font-size:9px}.package-preview strong{color:#3e4154;font-size:11px}.package-preview small{overflow:hidden;color:#7f8395;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.package-builder .primary{min-height:41px;padding:0 18px;border:0;border-radius:10px;background:linear-gradient(135deg,#6756d6,#7895f8);color:#fff;font-size:11px;font-weight:900;cursor:pointer}.package-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,280px));justify-content:start;gap:12px}.package-grid article{padding:17px;border:1px solid #e1e3ec;border-radius:15px;background:#fafbfe;transition:.18s ease}.package-grid article:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(54,51,103,.07)}.package-grid article.off{opacity:.58}.package-grid header{display:flex;justify-content:space-between;align-items:center}.package-grid header i{padding:4px 7px;border-radius:999px;background:#eaf8ef;color:#2f7651;font-size:8px;font-style:normal;font-weight:850}.package-grid article.off header i{background:#eef0f5;color:#74798b}.package-grid header small{color:#989bab;font-size:8px}.package-grid h4{margin:12px 0 5px;color:#36394d;font-size:15px}.package-grid p{min-height:36px;margin:0;color:#7e8295;font-size:10.5px;line-height:1.6}.package-benefits{display:flex;flex-wrap:wrap;gap:5px;margin:13px 0}.package-benefits span{padding:5px 7px;border-radius:8px;background:#eeeaff;color:#6051c5;font-size:9px;font-weight:800}.package-price{display:flex;align-items:baseline;gap:5px}.package-price strong{color:#34374b;font-size:23px}.package-price small{color:#8c90a1;font-size:9px}.package-grid footer{display:flex;gap:7px;margin-top:13px;padding-top:12px;border-top:1px solid #e9ebf1}.package-grid footer button{min-height:33px;padding:0 10px;border:1px solid #dfe1e9;border-radius:9px;background:#fff;color:#626679;font-size:9px;font-weight:800;cursor:pointer}.package-grid footer .danger{color:#ad4d58}.admin-storage-empty{display:grid;justify-items:center;padding:52px;color:#85899b;text-align:center}.admin-storage-empty>span{color:#7160d7;font-size:25px}.admin-storage-empty strong{margin-top:8px;color:#55596c;font-size:13px}.admin-storage-empty p{margin:5px 0 0;font-size:10px}@media(max-width:1250px){.policy-grid{grid-template-columns:1fr 1fr}.builder-main{grid-template-columns:repeat(3,1fr)}.field-card.wide{grid-column:span 2}}@media(max-width:820px){.storage-admin-hero{align-items:flex-start;flex-direction:column}.policy-grid,.builder-main{grid-template-columns:1fr 1fr}.field-card.wide{grid-column:span 2}.package-builder form>footer{grid-template-columns:1fr}.preset-row{overflow:auto}}@media(max-width:560px){.policy-grid,.builder-main{grid-template-columns:1fr}.field-card.wide{grid-column:auto}}
</style>

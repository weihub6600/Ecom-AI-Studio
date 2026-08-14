<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiRequest, jsonRequest } from "../api/client";

type AuthType = "bearer" | "header" | "query" | "none";

interface Settings {
  enabled: boolean;
  baseUrl: string;
  endpoint: string;
  model: string;
  apiKeyConfigured: boolean;
  authType: AuthType;
  authHeader: string;
  authScheme: string;
  authQueryName: string;
  timeoutMs: number;
  temperature: number;
  headers: Record<string, unknown>;
  requestTemplate: Record<string, unknown>;
  responseTextPath: string;
  systemPrompt: string;
}

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const message = ref("");
const errorMessage = ref("");
const apiKey = ref("");
const clearApiKey = ref(false);
const headersText = ref("{}");
const requestTemplateText = ref("{}");

const settings = ref<Settings>({
  enabled: false,
  baseUrl: "",
  endpoint: "/v1/chat/completions",
  model: "",
  apiKeyConfigured: false,
  authType: "bearer",
  authHeader: "Authorization",
  authScheme: "Bearer",
  authQueryName: "api_key",
  timeoutMs: 60000,
  temperature: 0.4,
  headers: {},
  requestTemplate: {},
  responseTextPath: "choices[0].message.content",
  systemPrompt: ""
});

const variables = [
  "{{model}}","{{system_prompt}}","{{user_prompt}}","{{temperature}}",
  "{{original_prompt}}","{{optimize_mode}}","{{generation_mode}}",
  "{{target_provider}}","{{target_model}}","{{size}}"
];

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const data = await apiRequest<{ settings: Settings }>("/api/admin/prompt-optimizer");
    setSettings(data.settings);
  } catch (error) {
    errorMessage.value = msg(error, "读取配置失败");
  } finally {
    loading.value = false;
  }
}

function setSettings(next: Settings) {
  settings.value = next;
  headersText.value = JSON.stringify(next.headers || {}, null, 2);
  requestTemplateText.value = JSON.stringify(next.requestTemplate || {}, null, 2);
}

async function save() {
  message.value = "";
  errorMessage.value = "";

  try {
    const headers = parseJson(headersText.value, "额外请求头");
    const requestTemplate = parseJson(requestTemplateText.value, "请求模板");
    saving.value = true;

    const data = await apiRequest<{ settings: Settings }>(
      "/api/admin/prompt-optimizer",
      jsonRequest({
        ...settings.value,
        apiKey: apiKey.value.trim() || undefined,
        clearApiKey: clearApiKey.value,
        headers,
        requestTemplate
      }, "PATCH")
    );

    setSettings(data.settings);
    apiKey.value = "";
    clearApiKey.value = false;
    message.value = "配置已保存";
  } catch (error) {
    errorMessage.value = msg(error, "保存失败");
  } finally {
    saving.value = false;
  }
}

async function testApi() {
  message.value = "";
  errorMessage.value = "";
  testing.value = true;

  try {
    const data = await apiRequest<{ preview: string; durationMs: number }>(
      "/api/admin/prompt-optimizer/test",
      jsonRequest({})
    );
    message.value = `测试成功 · ${data.durationMs}ms · ${data.preview.slice(0, 100)}`;
  } catch (error) {
    errorMessage.value = msg(error, "API 测试失败");
  } finally {
    testing.value = false;
  }
}

function parseJson(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value.trim() || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

function msg(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
</script>

<template>
  <div class="prompt-admin">
    <section class="hero">
      <div><span>AI ASSISTANT</span><h2>提示词智能优化</h2><p>接入自定义文本模型 API，为前台提供 Prompt 智能优化。</p></div>
      <label class="switch"><input v-model="settings.enabled" type="checkbox" /><b>{{ settings.enabled ? "已启用" : "已停用" }}</b></label>
    </section>

    <div v-if="loading" class="loading">正在读取配置...</div>

    <template v-else>
      <section class="card">
        <header><div><strong>API 连接</strong><small>兼容 OpenAI 协议，也可自定义请求模板</small></div><i :class="{ ready: settings.apiKeyConfigured || settings.authType === 'none' }">{{ settings.authType === "none" ? "无需 KEY" : settings.apiKeyConfigured ? "KEY 已配置" : "KEY 未配置" }}</i></header>
        <div class="grid">
          <label class="wide"><span>Base URL</span><input v-model="settings.baseUrl" placeholder="https://api.example.com" /></label>
          <label><span>Endpoint</span><input v-model="settings.endpoint" placeholder="/v1/chat/completions" /></label>
          <label><span>模型 ID</span><input v-model="settings.model" placeholder="your-text-model" /></label>
          <label><span>认证方式</span><select v-model="settings.authType"><option value="bearer">Bearer</option><option value="header">自定义 Header</option><option value="query">Query 参数</option><option value="none">无认证</option></select></label>
          <label v-if="settings.authType === 'bearer' || settings.authType === 'header'"><span>认证 Header</span><input v-model="settings.authHeader" /></label>
          <label v-if="settings.authType === 'bearer' || settings.authType === 'header'"><span>认证前缀</span><input v-model="settings.authScheme" placeholder="Bearer" /></label>
          <label v-if="settings.authType === 'query'"><span>Query Key</span><input v-model="settings.authQueryName" placeholder="api_key" /></label>
          <label><span>超时（ms）</span><input v-model.number="settings.timeoutMs" type="number" min="1000" max="180000" step="1000" /></label>
          <label><span>Temperature</span><input v-model.number="settings.temperature" type="number" min="0" max="2" step="0.1" /></label>
          <label v-if="settings.authType !== 'none'" class="wide"><span>API Key <small>留空保留现有 Key</small></span><input v-model="apiKey" type="password" autocomplete="new-password" /></label>
          <label v-if="settings.apiKeyConfigured && settings.authType !== 'none'" class="clear wide"><input v-model="clearApiKey" type="checkbox" /><span>清除当前 API Key</span></label>
        </div>
      </section>

      <section class="card">
        <header><div><strong>请求协议</strong><small>通过变量模板适配不同文本 API</small></div></header>
        <div class="protocol">
          <label><span>额外请求头 JSON</span><textarea v-model="headersText" rows="7" spellcheck="false"></textarea></label>
          <label><span>请求模板 JSON</span><textarea v-model="requestTemplateText" rows="14" spellcheck="false"></textarea></label>
        </div>
        <div class="vars"><span>可用变量</span><code v-for="item in variables" :key="item">{{ item }}</code></div>
        <label class="field"><span>响应文本路径</span><input v-model="settings.responseTextPath" /><small>如 choices[0].message.content、content[0].text、output_text</small></label>
      </section>

      <section class="card">
        <header><div><strong>系统优化指令</strong><small>控制 AI 的优化边界，不展示给普通用户</small></div></header>
        <label class="field"><textarea v-model="settings.systemPrompt" rows="11" maxlength="12000"></textarea></label>
      </section>

      <p class="note">首次接入请先保存，再测试连接。测试按钮使用已经保存的配置。</p>
      <p v-if="errorMessage" class="message error">{{ errorMessage }}</p>
      <p v-if="message" class="message success">{{ message }}</p>

      <footer class="actions">
        <button type="button" class="soft" :disabled="testing" @click="testApi">{{ testing ? "正在测试..." : "测试连接" }}</button>
        <button type="button" class="primary" :disabled="saving" @click="save">{{ saving ? "正在保存..." : "保存配置" }}</button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.prompt-admin{display:grid;gap:16px}.hero,.card{border:1px solid #e4e5ec;border-radius:18px;background:#fff}.hero{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:20px 22px}.hero>div{display:grid;gap:4px}.hero>div>span{color:#6a56d3;font-size:10px;font-weight:900;letter-spacing:.14em}.hero h2{margin:0;color:#333846;font-size:22px}.hero p{margin:0;color:#8c909d;font-size:12px}.switch{display:flex;align-items:center;gap:8px;color:#5f6472;font-size:12px}.card{padding:18px}.card>header{display:flex;justify-content:space-between;gap:12px;margin-bottom:15px}.card header div{display:grid;gap:3px}.card header strong{color:#3b4050;font-size:15px}.card header small{color:#999da9;font-size:10px}.card header i{padding:5px 8px;border-radius:999px;background:#f1f2f5;color:#8c909b;font-size:9px;font-style:normal}.card header i.ready{background:#eff9f1;color:#4f9360}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.grid label,.field,.protocol label{display:grid;gap:6px}.grid .wide{grid-column:1/-1}.grid span,.field>span,.protocol span{color:#5d6270;font-size:11px;font-weight:750}.grid small,.field small{color:#a0a4af;font-size:9px}.prompt-admin input,.prompt-admin select,.prompt-admin textarea{width:100%;box-sizing:border-box;border:1px solid #dfe1e8;border-radius:10px;background:#fbfbfd;color:#414654;font:inherit;font-size:12px;outline:none}.prompt-admin input,.prompt-admin select{min-height:38px;padding:0 10px}.prompt-admin textarea{padding:10px 11px;line-height:1.65;resize:vertical}.clear{display:flex!important;grid-template-columns:auto 1fr!important;align-items:center}.clear input{width:auto;min-height:0}.protocol{display:grid;grid-template-columns:minmax(240px,.72fr) minmax(0,1.28fr);gap:12px}.vars{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:12px 0}.vars span{color:#858a98;font-size:10px;font-weight:800}.vars code{padding:4px 6px;border-radius:6px;background:#f2f0fb;color:#6755bd;font-size:9px}.note{margin:0;color:#9397a4;font-size:10.5px}.message{margin:0;padding:10px 12px;border-radius:10px;font-size:11px}.message.error{border:1px solid #ffd4d4;background:#fff5f5;color:#bd4e4e}.message.success{border:1px solid #cfead4;background:#f2fbf4;color:#4d8c5a}.actions{display:flex;justify-content:flex-end;gap:9px}.actions button{min-height:38px;padding:0 15px;border-radius:10px;font:inherit;font-size:11px;font-weight:850;cursor:pointer}.soft{border:1px solid #dedfe7;background:#fff;color:#686d7b}.primary{border:1px solid #6654bd;background:#6654bd;color:#fff}.loading{padding:28px;border:1px solid #e4e5ec;border-radius:18px;background:#fff;color:#9094a0;text-align:center;font-size:12px}@media(max-width:760px){.hero{align-items:flex-start;flex-direction:column}.grid,.protocol{grid-template-columns:1fr}.grid .wide{grid-column:auto}}
</style>

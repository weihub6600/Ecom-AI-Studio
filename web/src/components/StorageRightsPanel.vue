<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiRequest, jsonRequest } from "../api/client";
import type { AuthUser, StorageAccountSummary, StoragePackage } from "../types";
import { formatDate, formatPoints } from "../utils/format";

const props = defineProps<{ user: AuthUser }>();
const emit = defineEmits<{ balanceUpdated: [value: number] }>();

const summary = ref<StorageAccountSummary | null>(null);
const loading = ref(true);
const redeemingId = ref("");
const message = ref("");
const errorMessage = ref("");

const usagePercent = computed(() => {
  if (!summary.value) return 0;
  const limit = Math.max(1, summary.value.effectiveImageLimit);
  return Math.min(100, summary.value.currentImageCount / limit * 100);
});

onMounted(load);

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    summary.value = await apiRequest<StorageAccountSummary>("/api/account/storage");
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取存储权益失败";
  } finally {
    loading.value = false;
  }
}

async function redeem(item: StoragePackage) {
  if (props.user.role === "admin") return;
  if (!window.confirm(`使用 ${formatPoints(item.pointsCost)} 积分兑换“${item.name}”吗？`)) return;

  redeemingId.value = item.id;
  message.value = "";
  errorMessage.value = "";
  try {
    const result = await apiRequest<{
      balance: number;
      summary: StorageAccountSummary;
    }>("/api/account/storage/redeem", jsonRequest({ packageId: item.id }));

    summary.value = result.summary;
    emit("balanceUpdated", result.balance);
    message.value = `“${item.name}”兑换成功，权益已经生效。`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "兑换存储权益失败";
  } finally {
    redeemingId.value = "";
  }
}
</script>

<template>
  <div class="storage-rights">
    <header class="storage-hero">
      <div>
        <span>SERVER STORAGE</span>
        <h2>服务器存储权益</h2>
        <p>
          用积分扩展云端作品保存数量与保存期限。权益可叠加，
          到期后还有站长设置的宽限期，灵感广场审核中/已公开的作品不参与自动清理。
        </p>
      </div>
      <div v-if="summary" class="storage-policy-chip" :class="{ on: summary.settings.enforcementEnabled }">
        {{ summary.settings.enforcementEnabled ? '存储策略运行中' : '存储策略暂停中' }}
      </div>
    </header>

    <p v-if="message" class="storage-message success">{{ message }}</p>
    <p v-if="errorMessage" class="storage-message error">{{ errorMessage }}</p>

    <div v-if="loading" class="storage-empty">正在读取存储权益…</div>

    <template v-else-if="summary">
      <section class="storage-overview">
        <article class="storage-usage-card">
          <div>
            <span>当前云端图片</span>
            <strong>{{ summary.currentImageCount }} / {{ summary.effectiveImageLimit }}</strong>
            <small>共 {{ summary.currentHistoryCount }} 条作品记录</small>
          </div>
          <div class="storage-progress">
            <i :style="{ width: `${usagePercent}%` }"></i>
          </div>
        </article>

        <article>
          <span>保存期限</span>
          <strong>{{ summary.effectiveRetentionDays }} 天</strong>
          <small>基础 {{ summary.settings.baseRetentionDays }} 天 + 权益 {{ summary.retentionDaysBonus }} 天</small>
        </article>

        <article>
          <span>数量加成</span>
          <strong>+{{ summary.imageLimitBonus }} 张</strong>
          <small>基础额度 {{ summary.settings.baseImageLimit }} 张</small>
        </article>

        <article>
          <span>到期宽限</span>
          <strong>{{ summary.settings.graceDays }} 天</strong>
          <small>权益到期后不会立刻收回</small>
        </article>
      </section>

      <section class="storage-section">
        <div class="storage-heading">
          <div>
            <span>STORAGE PACKAGES</span>
            <h3>积分兑换方案</h3>
          </div>
          <div
            v-if="!summary.settings.enforcementEnabled"
            class="storage-disabled-notice"
          >
            <span>!</span>
            <div>
              <strong>存储兑换暂未开放</strong>
              <small>站长尚未开启存储策略，当前方案仅供查看，暂不可兑换。</small>
            </div>
          </div>
        </div>

        <div v-if="summary.packages.length" class="storage-packages">
          <article v-for="item in summary.packages" :key="item.id">
            <span class="storage-package-valid">有效 {{ item.validDays }} 天</span>
            <h4>{{ item.name }}</h4>
            <p>{{ item.description || '扩展你的服务器作品保存权益。' }}</p>
            <div class="storage-package-benefits">
              <span v-if="item.imageLimitBonus">+{{ item.imageLimitBonus }} 张</span>
              <span v-if="item.retentionDaysBonus">+{{ item.retentionDaysBonus }} 天</span>
            </div>
            <div class="storage-package-footer">
              <strong>{{ formatPoints(item.pointsCost) }} <small>积分</small></strong>
              <button
                type="button"
                :disabled="
                  !summary.settings.enforcementEnabled ||
                  props.user.role === 'admin' ||
                  redeemingId === item.id
                "
                @click="redeem(item)"
              >
                {{
                  props.user.role === 'admin'
                    ? '站长无需兑换'
                    : redeemingId === item.id
                      ? '兑换中…'
                      : '立即兑换'
                }}
              </button>
            </div>
          </article>
        </div>
        <div v-else class="storage-empty">站长还没有发布可兑换的存储方案。</div>
      </section>

      <section class="storage-section">
        <div class="storage-heading">
          <div>
            <span>ACTIVE ENTITLEMENTS</span>
            <h3>我的有效权益</h3>
          </div>
        </div>

        <div v-if="summary.entitlements.length" class="storage-entitlements">
          <article v-for="item in summary.entitlements" :key="item.id">
            <div>
              <strong>{{ item.packageName }}</strong>
              <span v-if="item.inGrace">宽限期</span>
            </div>
            <p>
              <b v-if="item.imageLimitBonus">+{{ item.imageLimitBonus }} 张</b>
              <b v-if="item.retentionDaysBonus">+{{ item.retentionDaysBonus }} 天</b>
            </p>
            <small>
              {{ formatDate(item.purchasedAt) }} 兑换 ·
              {{ formatDate(item.expiresAt) }} 到期
            </small>
          </article>
        </div>
        <div v-else class="storage-empty">目前没有额外存储权益。</div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.storage-rights{display:grid;gap:20px}.storage-hero{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding:28px;border:1px solid rgba(255,255,255,.08);border-radius:22px;background:linear-gradient(135deg,rgba(126,168,255,.08),rgba(100,231,159,.06))}.storage-hero span,.storage-heading span{color:#87b0ff;font-size:10px;font-weight:800;letter-spacing:.14em}.storage-hero h2{margin:8px 0}.storage-hero p{max-width:760px;margin:0;color:#8992a5;line-height:1.7}.storage-policy-chip{flex:0 0 auto;padding:9px 11px;border-radius:999px;background:rgba(255,185,71,.08);color:#dfb871;font-size:10px;font-weight:800}.storage-policy-chip.on{background:rgba(79,211,131,.09);color:#91eab1}.storage-message{margin:0;padding:12px 14px;border-radius:11px;font-size:11px}.storage-message.success{background:rgba(71,205,123,.08);color:#95eab3}.storage-message.error{background:rgba(255,77,99,.08);color:#ffa6b1}.storage-overview{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:11px}.storage-overview article{padding:18px;border:1px solid rgba(255,255,255,.07);border-radius:16px;background:rgba(255,255,255,.025)}.storage-overview span{display:block;color:#7a8294;font-size:10px}.storage-overview strong{display:block;margin:8px 0 4px;font-size:22px}.storage-overview small{color:#737b8c;font-size:9px}.storage-usage-card{display:grid;gap:12px}.storage-progress{height:5px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.05)}.storage-progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#7ba5ff,#76e4a3)}.storage-section{padding:22px;border:1px solid rgba(255,255,255,.07);border-radius:19px;background:rgba(12,15,23,.48)}.storage-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:15px}.storage-heading h3{margin:5px 0 0}.storage-heading small{color:#8d7b62;font-size:10px}.storage-packages{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.storage-packages>article{position:relative;padding:19px;border:1px solid rgba(255,255,255,.07);border-radius:16px;background:linear-gradient(155deg,rgba(255,255,255,.035),rgba(255,255,255,.015))}.storage-package-valid{position:absolute;top:14px;right:14px;padding:5px 7px;border-radius:999px;background:rgba(255,255,255,.04);color:#7d8698!important;font-size:9px!important}.storage-packages h4{margin:0 0 8px;padding-right:80px;font-size:16px}.storage-packages p{min-height:38px;margin:0;color:#7f8798;font-size:11px;line-height:1.55}.storage-package-benefits{display:flex;gap:7px;margin:16px 0}.storage-package-benefits span{padding:6px 8px;border-radius:9px;background:rgba(122,166,255,.08);color:#9dbbff;font-size:10px}.storage-package-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:14px;border-top:1px solid rgba(255,255,255,.06)}.storage-package-footer strong{font-size:18px}.storage-package-footer small{font-size:9px;color:#737c8d}.storage-package-footer button{min-height:34px;padding:0 11px;border:0;border-radius:9px;background:linear-gradient(135deg,#92b3ff,#86edaf);color:#07110b;font-weight:800;cursor:pointer}.storage-package-footer button:disabled{opacity:.35;cursor:default}.storage-entitlements{display:grid;gap:9px}.storage-entitlements article{display:grid;grid-template-columns:1fr auto;gap:6px 12px;padding:13px 14px;border:1px solid rgba(255,255,255,.06);border-radius:12px;background:rgba(255,255,255,.02)}.storage-entitlements article>div{display:flex;align-items:center;gap:8px}.storage-entitlements article>div span{padding:4px 6px;border-radius:999px;background:rgba(255,184,76,.08);color:#d9ad69;font-size:8px}.storage-entitlements p{display:flex;gap:7px;margin:0}.storage-entitlements b{color:#9dbbff;font-size:10px}.storage-entitlements small{grid-column:1/-1;color:#737c8e;font-size:9px}.storage-empty{padding:40px 12px;color:#7b8395;text-align:center}@media(max-width:880px){.storage-overview{grid-template-columns:1fr 1fr}}@media(max-width:620px){.storage-hero{align-items:flex-start;flex-direction:column}.storage-overview{grid-template-columns:1fr}}

/* STORAGE_RIGHTS_V4_START */
.storage-rights{
  gap:20px
}
.storage-hero{
  padding:28px;
  border-color:#dedaf5;
  border-radius:20px;
  background:linear-gradient(135deg,#fff,#f5f7ff)
}
.storage-hero span{
  font-size:10px
}
.storage-hero h2{
  margin:8px 0;
  color:#292c40;
  font-size:24px
}
.storage-hero p{
  color:#73788b;
  font-size:13px;
  line-height:1.75
}
.storage-policy-chip{
  font-size:11px
}
.storage-overview article{
  padding:19px;
  border-color:#e1e3ec;
  background:#fff
}
.storage-overview span{
  font-size:11px
}
.storage-overview strong{
  color:#34374b;
  font-size:24px
}
.storage-overview small{
  color:#85899b;
  font-size:10px
}
.storage-section{
  padding:23px;
  border-color:#e1e3ec;
  background:#fff
}
.storage-heading h3{
  font-size:19px
}
.storage-heading small{
  font-size:10px
}
.storage-packages{
  grid-template-columns:repeat(auto-fill,minmax(230px,280px));
  justify-content:start
}
.storage-packages>article{
  padding:20px;
  border-color:#e1e3ec;
  background:#fafbfe
}
.storage-packages h4{
  font-size:16px
}
.storage-packages p{
  color:#74798c;
  font-size:11.5px
}
.storage-package-benefits span{
  font-size:10.5px
}
.storage-package-footer strong{
  font-size:20px
}
.storage-package-footer button{
  min-height:37px;
  font-size:11px
}
.storage-entitlements article{
  padding:15px;
  background:#fafbfe
}
.storage-entitlements strong{
  font-size:12px
}
.storage-entitlements small{
  font-size:10px
}
/* STORAGE_RIGHTS_V4_END */

.storage-disabled-notice{display:flex;align-items:center;gap:10px;max-width:430px;padding:10px 12px;border:1px solid #efd4a8;border-radius:12px;background:#fff8ea}.storage-disabled-notice>span{display:grid;place-items:center;flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:#f0ad45;color:#fff;font-size:14px;font-weight:900}.storage-disabled-notice>div{display:grid;gap:2px}.storage-disabled-notice strong{color:#80591e;font-size:11px}.storage-disabled-notice small{color:#9a7440!important;font-size:10px!important;line-height:1.5}
</style>

<script setup lang="ts">
import {
  ref
} from "vue";
import BuiltInProviderManager from "./BuiltInProviderManager.vue";
import CustomProviderManager from "./CustomProviderManager.vue";

const activeMode =
  ref<
    "builtin" |
    "custom"
  >("builtin");
</script>

<template>
  <div class="provider-v136-shell">
    <header class="provider-v136-hero">
      <div>
        <span>PROVIDER CONTROL CENTER</span>
        <h2>模型服务商与模型参数</h2>
        <p>
          已接入的专用服务商和后续新增的兼容服务商，
          都可以在这里编辑。
        </p>
      </div>

      <nav>
        <button
          type="button"
          :class="{ active: activeMode === 'builtin' }"
          @click="activeMode = 'builtin'"
        >
          已接入模型服务商
        </button>

        <button
          type="button"
          :class="{ active: activeMode === 'custom' }"
          @click="activeMode = 'custom'"
        >
          自定义模型服务商
        </button>
      </nav>
    </header>

    <BuiltInProviderManager
      v-if="activeMode === 'builtin'"
    />

    <div
      v-else
      class="provider-v136-custom"
    >
      <CustomProviderManager />
    </div>
  </div>
</template>

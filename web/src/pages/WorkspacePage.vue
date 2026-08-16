<script setup lang="ts">
import PlatformShell from "../components/PlatformShell.vue";
import GenerationWorkspace from "../App.vue";
</script>

<template>
  <PlatformShell
    title="AI 创作"
    subtitle="图片生成 · 参考图再创作 · AI 提示词优化"
  >
    <GenerationWorkspace embedded />
  </PlatformShell>
</template>

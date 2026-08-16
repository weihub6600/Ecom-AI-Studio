<script setup lang="ts">
import PlatformShell from "../components/PlatformShell.vue";
import GalleryApp from "../GalleryApp.vue";
</script>

<template>
  <PlatformShell
    title="灵感广场"
    subtitle="精选作品 · 创作案例 · 社区灵感"
  >
    <GalleryApp embedded />
  </PlatformShell>
</template>

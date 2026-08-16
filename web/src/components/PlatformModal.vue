<script setup lang="ts">
import {
  computed
} from "vue";

type PlatformModalLayer =
  | "modal"
  | "raised"
  | "lightbox"
  | "critical";

type PlatformModalCloseEvent =
  | "click"
  | "mousedown";

const props = withDefaults(
  defineProps<{
    open?: boolean;
    layer?: PlatformModalLayer;
    padding?: string;
    mobilePadding?: string;
    background?: string;
    blur?: string;
    closeOnBackdrop?: boolean;
    closeEvent?: PlatformModalCloseEvent;
  }>(),
  {
    open: true,
    layer: "modal",
    padding: "24px",
    mobilePadding: "",
    background: "rgba(24,24,40,.48)",
    blur: "10px",
    closeOnBackdrop: true,
    closeEvent: "click"
  }
);

const emit = defineEmits<{
  close: [];
}>();

const layerClass = computed(
  () =>
    `platform-modal-layer-${props.layer}`
);

const backdropStyle =
  computed<Record<string, string>>(
    () => ({
      "--platform-modal-padding":
        props.padding,
      "--platform-modal-mobile-padding":
        props.mobilePadding ||
        props.padding,
      background:
        props.background,
      backdropFilter:
        `blur(${props.blur})`,
      WebkitBackdropFilter:
        `blur(${props.blur})`
    })
  );

function handleBackdrop(
  event: MouseEvent
) {
  if (
    !props.closeOnBackdrop ||
    event.target !== event.currentTarget ||
    event.type !== props.closeEvent
  ) {
    return;
  }

  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="platform-modal-backdrop"
      :class="layerClass"
      :style="backdropStyle"
      @click="handleBackdrop"
      @mousedown="handleBackdrop"
    >
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.platform-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--v15-z-modal);
  display: grid;
  place-items: center;
  padding: var(--platform-modal-padding);
}

.platform-modal-layer-raised {
  z-index: var(--v15-z-modal-raised);
}

.platform-modal-layer-lightbox {
  z-index: var(--v15-z-lightbox);
}

.platform-modal-layer-critical {
  z-index: var(--v15-z-critical);
}

/* Preserve PromptOptimizer mobile backdrop spacing. */
@media (max-width: 760px) {
  .platform-modal-layer-raised {
    padding:
      var(--platform-modal-mobile-padding);
  }
}

/* Preserve RefineDialog mobile backdrop spacing. */
@media (max-width: 640px) {
  .platform-modal-layer-critical {
    padding:
      var(--platform-modal-mobile-padding);
  }
}
</style>

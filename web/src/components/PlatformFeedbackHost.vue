<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted
} from "vue";
import PlatformModal from "./PlatformModal.vue";
import {
  dismissPlatformToast,
  platformFeedbackState,
  settlePlatformConfirm,
  type PlatformToastTone
} from "../services/platform-feedback";

const confirmRequest =
  computed(
    () =>
      platformFeedbackState.confirm
  );

function confirmAction(): void {
  if (!confirmRequest.value) {
    return;
  }

  settlePlatformConfirm(true);
}

function cancelConfirm(): void {
  if (!confirmRequest.value) {
    return;
  }

  settlePlatformConfirm(false);
}

function handleKeydown(
  event: KeyboardEvent
): void {
  if (
    event.key === "Escape" &&
    confirmRequest.value
  ) {
    event.preventDefault();
    cancelConfirm();
  }
}

function toneMark(
  tone: PlatformToastTone
): string {
  switch (tone) {
    case "success":
      return "?";

    case "warning":
      return "!";

    case "error":
      return "?";

    default:
      return "i";
  }
}

onMounted(() => {
  window.addEventListener(
    "keydown",
    handleKeydown
  );
});

onUnmounted(() => {
  window.removeEventListener(
    "keydown",
    handleKeydown
  );
});
</script>

<template>
  <PlatformModal
    :open="Boolean(confirmRequest)"
    layer="critical"
    padding="18px"
    mobile-padding="12px"
    background="rgba(24, 23, 42, .48)"
    blur="10px"
    :close-on-backdrop="false"
  >
    <section
      v-if="confirmRequest"
      class="platform-confirm-card"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="platform-confirm-title"
      aria-describedby="platform-confirm-message"
    >
      <header>
        <span>CONFIRM</span>

        <h3 id="platform-confirm-title">
          {{ confirmRequest.title }}
        </h3>
      </header>

      <p id="platform-confirm-message">
        {{ confirmRequest.message }}
      </p>

      <footer>
        <button
          type="button"
          class="platform-confirm-cancel"
          @click="cancelConfirm"
        >
          {{ confirmRequest.cancelLabel }}
        </button>

        <button
          type="button"
          class="platform-confirm-primary"
          @click="confirmAction"
        >
          {{ confirmRequest.confirmLabel }}
        </button>
      </footer>
    </section>
  </PlatformModal>

  <Teleport to="body">
    <div
      class="platform-toast-stack"
      aria-live="polite"
      aria-relevant="additions removals"
    >
      <TransitionGroup
        name="platform-toast"
      >
        <article
          v-for="
            item in
            platformFeedbackState.toasts
          "
          :key="item.id"
          class="platform-toast-card"
          :class="
            `platform-toast-${item.tone}`
          "
        >
          <span
            class="platform-toast-mark"
            aria-hidden="true"
          >
            {{ toneMark(item.tone) }}
          </span>

          <div>
            <small>
              {{ item.title }}
            </small>

            <p>
              {{ item.message }}
            </p>
          </div>

          <button
            type="button"
            aria-label="????"
            @click="
              dismissPlatformToast(
                item.id
              )
            "
          >
            ?
          </button>
        </article>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.platform-confirm-card {
  width:
    min(
      460px,
      calc(100vw - 36px)
    );
  overflow: hidden;
  border:
    1px solid
    rgba(224, 225, 236, .98);
  border-radius: 20px;
  background:
    rgba(255, 255, 255, .99);
  box-shadow:
    0 28px 90px
    rgba(35, 32, 79, .24);
}

.platform-confirm-card header {
  padding:
    22px 24px 13px;
}

.platform-confirm-card header span {
  display: block;
  margin-bottom: 5px;
  color: #6658d3;
  font-size: 10px;
  font-weight: 850;
  letter-spacing: .14em;
}

.platform-confirm-card h3 {
  margin: 0;
  color: #282a3d;
  font-size: 20px;
}

.platform-confirm-card > p {
  margin: 0;
  padding:
    0 24px 22px;
  color: #686b7d;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-line;
}

.platform-confirm-card footer {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding:
    15px 20px 19px;
  border-top:
    1px solid #eeeef4;
  background: #fafafd;
}

.platform-confirm-card button {
  min-width: 88px;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.platform-confirm-cancel {
  border:
    1px solid #dedfe8;
  background: #fff;
  color: #696c7d;
}

.platform-confirm-primary {
  border:
    1px solid #6859d5;
  background: #6859d5;
  color: #fff;
  box-shadow:
    0 8px 20px
    rgba(104, 89, 213, .2);
}

.platform-toast-stack {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index:
    var(--v15-z-toast);
  display: grid;
  gap: 10px;
  width:
    min(
      370px,
      calc(100vw - 28px)
    );
  pointer-events: none;
}

.platform-toast-card {
  display: grid;
  grid-template-columns:
    34px
    minmax(0, 1fr)
    28px;
  align-items: center;
  gap: 10px;
  min-height: 66px;
  padding: 12px 10px 12px 12px;
  border:
    1px solid
    rgba(221, 222, 232, .96);
  border-radius: 13px;
  background:
    rgba(255, 255, 255, .985);
  box-shadow:
    0 18px 50px
    rgba(29, 31, 48, .14);
  backdrop-filter:
    blur(18px);
  pointer-events: auto;
}

.platform-toast-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: #f0eefb;
  color: #5f50bc;
  font-size: 14px;
  font-weight: 900;
}

.platform-toast-card > div {
  min-width: 0;
}

.platform-toast-card small {
  display: block;
  margin-bottom: 3px;
  color: #6255b6;
  font-size: 10px;
  font-weight: 800;
}

.platform-toast-card p {
  margin: 0;
  color: #626675;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.platform-toast-card > button {
  align-self: start;
  border: 0;
  background: transparent;
  color: #a1a4af;
  font-size: 17px;
  cursor: pointer;
}

.platform-toast-success
.platform-toast-mark {
  background: #edf8f2;
  color: #3f8b67;
}

.platform-toast-warning
.platform-toast-mark {
  background: #fff7e8;
  color: #a87321;
}

.platform-toast-error
.platform-toast-mark {
  background: #fff0f1;
  color: #b9505b;
}

.platform-toast-enter-active,
.platform-toast-leave-active {
  transition:
    opacity .18s ease,
    transform .18s ease;
}

.platform-toast-enter-from,
.platform-toast-leave-to {
  opacity: 0;
  transform:
    translateY(8px);
}

@media (max-width: 640px) {
  .platform-confirm-card {
    width: 100%;
  }

  .platform-confirm-card footer {
    display: grid;
    grid-template-columns:
      1fr 1fr;
  }

  .platform-toast-stack {
    right: 12px;
    bottom: 12px;
    width:
      calc(100vw - 24px);
  }
}
</style>

import {
  reactive
} from "vue";

export type PlatformToastTone =
  | "info"
  | "success"
  | "warning"
  | "error";

export interface PlatformConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface PlatformToastOptions {
  title?: string;
  tone?: PlatformToastTone;
  durationMs?: number;
}

export interface PlatformConfirmView {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface PlatformToastView {
  id: number;
  title: string;
  message: string;
  tone: PlatformToastTone;
}

interface ConfirmQueueItem
  extends PlatformConfirmView {
  resolve: (value: boolean) => void;
}

export const platformFeedbackState =
  reactive<{
    confirm:
      PlatformConfirmView |
      null;
    toasts:
      PlatformToastView[];
  }>({
    confirm: null,
    toasts: []
  });

const confirmQueue:
  ConfirmQueueItem[] = [];

let activeConfirm:
  ConfirmQueueItem |
  null = null;

let feedbackSerial = 0;

function nextId(): number {
  feedbackSerial += 1;
  return feedbackSerial;
}

function pumpConfirmQueue(): void {
  if (
    activeConfirm ||
    confirmQueue.length === 0
  ) {
    return;
  }

  activeConfirm =
    confirmQueue.shift() ||
    null;

  if (!activeConfirm) {
    return;
  }

  platformFeedbackState.confirm = {
    id: activeConfirm.id,
    title: activeConfirm.title,
    message: activeConfirm.message,
    confirmLabel:
      activeConfirm.confirmLabel,
    cancelLabel:
      activeConfirm.cancelLabel
  };
}

export function platformConfirm(
  message: string,
  options:
    PlatformConfirmOptions = {}
): Promise<boolean> {
  const normalized =
    String(message || "").trim();

  if (!normalized) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>(
    (resolve) => {
      confirmQueue.push({
        id: nextId(),
        title:
          options.title ||
          "?????",
        message: normalized,
        confirmLabel:
          options.confirmLabel ||
          "??",
        cancelLabel:
          options.cancelLabel ||
          "??",
        resolve
      });

      pumpConfirmQueue();
    }
  );
}

export function settlePlatformConfirm(
  value: boolean
): void {
  const current =
    activeConfirm;

  if (!current) {
    return;
  }

  activeConfirm = null;
  platformFeedbackState.confirm =
    null;

  current.resolve(value);

  Promise.resolve().then(
    pumpConfirmQueue
  );
}

function defaultToastTitle(
  tone: PlatformToastTone
): string {
  switch (tone) {
    case "success":
      return "????";

    case "warning":
      return "???";

    case "error":
      return "????";

    default:
      return "??";
  }
}

export function platformToast(
  message: string,
  options:
    PlatformToastOptions = {}
): number {
  const normalized =
    String(message || "").trim();

  if (!normalized) {
    return 0;
  }

  const tone =
    options.tone ||
    "info";

  const id =
    nextId();

  platformFeedbackState.toasts.push({
    id,
    title:
      options.title ||
      defaultToastTitle(tone),
    message: normalized,
    tone
  });

  if (
    platformFeedbackState
      .toasts.length > 4
  ) {
    platformFeedbackState
      .toasts.splice(
        0,
        platformFeedbackState
          .toasts.length - 4
      );
  }

  const durationMs =
    Math.max(
      1200,
      Math.min(
        15000,
        options.durationMs ??
          3600
      )
    );

  globalThis.setTimeout(
    () => {
      dismissPlatformToast(id);
    },
    durationMs
  );

  return id;
}

export function dismissPlatformToast(
  id: number
): void {
  const index =
    platformFeedbackState
      .toasts.findIndex(
        (item) =>
          item.id === id
      );

  if (index >= 0) {
    platformFeedbackState
      .toasts.splice(
        index,
        1
      );
  }
}

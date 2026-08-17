export function extensionFromMime(
  value: string
): string {
  const normalized =
    value.toLowerCase();

  if (normalized.includes("jpeg")) {
    return "jpg";
  }

  if (normalized.includes("webp")) {
    return "webp";
  }

  return "png";
}

export function safeFileName(
  value: string
): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);

  return normalized || "未命名商品";
}

export function csvEscape(
  value: string
): string {
  const normalized =
    String(value ?? "");

  return /[",\r\n]/.test(normalized)
    ? `"${normalized.replace(/"/g, '""')}"`
    : normalized;
}

export function downloadBlob(
  blob: Blob,
  fileName: string
) {
  const url =
    URL.createObjectURL(blob);
  const anchor =
    document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function clampInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const numeric = Number(value);

  if (!Number.isInteger(numeric)) {
    return fallback;
  }

  return Math.max(
    minimum,
    Math.min(maximum, numeric)
  );
}

export function createId(): string {
  return typeof crypto?.randomUUID ===
    "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

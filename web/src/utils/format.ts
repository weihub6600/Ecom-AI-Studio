import type { OutputSize, ProviderId } from "../types";

export function formatPoints(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

export function formatDuration(value?: number): string {
  return typeof value === "number" ? `${(value / 1000).toFixed(1)} 秒` : "—";
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function providerDisplayName(provider: ProviderId | string | undefined, providerName?: string): string {
  if (provider === "grsai") return "GPT";
  return providerName || "API";
}

export function displayProviderText(value: string): string {
  return value.replace(/GRSAI/g, "GPT");
}

export function formatSizeTitle(value: OutputSize): string {
  if (value === "auto") return "自适应";
  const separator = value.includes("x") ? "x" : value.includes(":") ? ":" : "";
  if (!separator) return value;
  const [rawWidth, rawHeight] = value.split(separator);
  const width = Number(rawWidth);
  const height = Number(rawHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return value;
  const divisor = greatestCommonDivisor(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  const orientation = width === height ? "正方形" : width > height ? "横版" : "竖版";
  return `${orientation} ${ratio}`;
}

export function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x || 1;
}

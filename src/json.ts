import { createHash } from "node:crypto";

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Serialize keys directly: JSON.stringify(object) reorders integer-like keys.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => compareText(a, b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("canonical JSON requires JSON values");
  return encoded;
}
export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
export function digest(value: unknown): string {
  return sha256(canonicalJson(value));
}

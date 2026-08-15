export function estimateTokens(text: string): number {
  const bytes = Buffer.byteLength(text, "utf8");
  return Math.max(1, Math.ceil(bytes / 3));
}

export interface BudgetItem {
  id: string;
  estimatedTokens: number;
  clipped: boolean;
}

export interface PackedResult {
  included: BudgetItem[];
  omitted: { id: string; reason: "token-budget" }[];
  totalTokens: number;
}

/**
 * Pack items in order under a hard token budget. `clipable` ids may be
 * truncated later by the caller; here they consume exactly their estimated
 * size and are always admitted unless the budget is already exhausted.
 */
export function packBudget(
  items: Array<{ id: string; estimatedTokens: number; clipable: boolean }>,
  budget: number,
): PackedResult {
  const included: BudgetItem[] = [];
  const omitted: { id: string; reason: "token-budget" }[] = [];
  let remaining = budget;

  for (const item of items) {
    if (item.clipable) {
      if (remaining <= 0) {
        omitted.push({ id: item.id, reason: "token-budget" });
        continue;
      }
      const consumed = Math.min(item.estimatedTokens, remaining);
      included.push({
        id: item.id,
        estimatedTokens: consumed,
        clipped: consumed < item.estimatedTokens,
      });
      remaining -= consumed;
    } else if (item.estimatedTokens <= remaining) {
      included.push({
        id: item.id,
        estimatedTokens: item.estimatedTokens,
        clipped: false,
      });
      remaining -= item.estimatedTokens;
    } else {
      omitted.push({ id: item.id, reason: "token-budget" });
    }
  }

  return {
    included,
    omitted,
    totalTokens: included.reduce((sum, item) => sum + item.estimatedTokens, 0),
  };
}

export function clipText(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return "";
  }
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }
  const marker = "\u2026[truncated]";
  const markerTokens = estimateTokens(marker);
  if (markerTokens >= maxTokens) {
    // Budget too small to carry the full marker; emit a short ellipsis that
    // still fits, or nothing.
    const ellipsis = "\u2026";
    return estimateTokens(ellipsis) <= maxTokens ? ellipsis : "";
  }
  const bodyTokens = maxTokens - markerTokens;
  const maxBytes = bodyTokens * 3;
  const buf = Buffer.from(text, "utf8");
  let end = Math.min(maxBytes, buf.length);
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  const body = buf.subarray(0, end).toString("utf8");
  return body + marker;
}

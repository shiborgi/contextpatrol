import type { CachedFacts, ContextReport, SourceDepth, SourceFile } from "./types.js";

const SIGNATURE_MAX_LINES = 16;
const SIGNATURE_MAX_BYTES = 1_600;

function fullSnippet(
  file: SourceFile,
  lines: string[],
  terms: string[],
): ContextReport["snippets"][number] {
  const match = lines.findIndex((line) =>
    terms.some((term) => line.toLowerCase().includes(term)),
  );
  const start = Math.max(0, (match < 0 ? 0 : match) - 12);
  const selected = lines.slice(start, start + 25);
  let text = selected.join("\n");
  if (Buffer.byteLength(text, "utf8") > 2_400)
    text = Buffer.from(text, "utf8").subarray(0, 2_400).toString("utf8");
  return {
    path: file.path,
    startLine: start + 1,
    endLine: start + selected.length,
    text,
    clipped: start > 0 || start + selected.length < lines.length,
  };
}

function signaturesSnippet(
  file: SourceFile,
  lines: string[],
  terms: string[],
  facts: CachedFacts | undefined,
): ContextReport["snippets"][number] {
  const matched = (facts?.symbols ?? []).filter((symbol) =>
    terms.some((term) => symbol.name.toLowerCase().includes(term)),
  );
  const picked = new Set<number>();
  for (const symbol of matched) {
    const header = symbol.startLine - 1;
    picked.add(header);
    let cursor = header - 1;
    while (cursor >= 0 && /^\s*(?:\/\/|#)/.test(lines[cursor] ?? "")) {
      picked.add(cursor);
      cursor -= 1;
    }
    if (picked.size >= SIGNATURE_MAX_LINES) break;
  }
  const ordered = [...picked]
    .sort((left, right) => left - right)
    .slice(0, SIGNATURE_MAX_LINES);
  const selected = (ordered.length > 0 ? ordered : [0]).map(
    (index) => lines[index] ?? "",
  );
  let text = selected.join("\n");
  if (Buffer.byteLength(text, "utf8") > SIGNATURE_MAX_BYTES)
    text = Buffer.from(text, "utf8").subarray(0, SIGNATURE_MAX_BYTES).toString("utf8");
  return {
    path: file.path,
    startLine: (ordered[0] ?? 0) + 1,
    endLine: (ordered[ordered.length - 1] ?? 0) + 1,
    text,
    clipped: selected.length < lines.length,
  };
}

export function snippet(
  file: SourceFile,
  terms: string[],
  sourceDepth?: SourceDepth,
  facts?: CachedFacts,
): ContextReport["snippets"][number] {
  if (sourceDepth === "listing")
    return { path: file.path, startLine: 1, endLine: 1, text: "", clipped: false };
  const lines = file.content.split("\n");
  if (sourceDepth === "signatures") return signaturesSnippet(file, lines, terms, facts);
  return fullSnippet(file, lines, terms);
}

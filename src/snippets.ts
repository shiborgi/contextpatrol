import type { ContextReport, SourceFile } from "./types.js";

export function snippet(
  file: SourceFile,
  terms: string[],
): ContextReport["snippets"][number] {
  const lines = file.content.split("\n");
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

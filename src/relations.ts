import path from "node:path";

export function resolveImport(
  from: string,
  specifier: string,
  files: Set<string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(from), specifier),
  );
  const candidates = [
    base,
    ...[
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      ".go",
      ".rs",
      ".java",
      ".cs",
      ".kt",
      ".php",
      ".rb",
      ".swift",
      ".c",
    ].map((extension) => `${base}${extension}`),
    ...[".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"].map(
      (extension) => `${base}/index${extension}`,
    ),
  ];
  return candidates.find((candidate) => files.has(candidate));
}

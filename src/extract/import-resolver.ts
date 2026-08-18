export interface ResolvedImport {
  external: boolean;
  path: string | null;
}

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export function resolveImport(
  specifier: string,
  sourcePath: string,
  eligiblePaths: readonly string[],
): ResolvedImport {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return { external: true, path: null };
  }

  const dir = sourcePath.includes("/")
    ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
    : "";
  const combined = dir === "" ? specifier : `${dir}/${specifier}`;
  const target = normalizePath(combined);
  if (target === null) {
    return { external: true, path: null };
  }

  const eligible = new Set(eligiblePaths);

  if (eligible.has(target)) {
    return { external: false, path: target };
  }
  for (const ext of EXTENSIONS) {
    if (eligible.has(`${target}${ext}`)) {
      return { external: false, path: `${target}${ext}` };
    }
  }
  for (const ext of EXTENSIONS) {
    if (eligible.has(`${target}/index${ext}`)) {
      return { external: false, path: `${target}/index${ext}` };
    }
  }
  return { external: false, path: null };
}

function normalizePath(path: string): string | null {
  const segments = path.split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") {
      continue;
    }
    if (seg === "..") {
      if (out.length === 0) {
        return null;
      }
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length > 0 ? out.join("/") : null;
}

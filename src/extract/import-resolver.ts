export interface ResolvedImport {
  external: boolean;
  path: string | null;
}

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

// NodeNext emits `.js` specifiers for TypeScript sources; map them one-to-one
// so a relative `.js` import resolves to the compiled `.ts` counterpart.
// Ordered longest-first so `.mjs` matches before `.js`.
const JS_TO_TS: Array<[string, string]> = [
  [".mjs", ".mts"],
  [".cjs", ".cts"],
  [".jsx", ".tsx"],
  [".js", ".ts"],
];

function tsCounterpart(target: string): string | null {
  for (const [js, ts] of JS_TO_TS) {
    if (target.endsWith(js)) {
      return `${target.slice(0, target.length - js.length)}${ts}`;
    }
  }
  return null;
}

/** Probe a normalized target against eligible paths: exact, .js→.ts remap,
 * extension append, then index. Returns the resolved path or null. */
function probe(target: string, eligible: Set<string>): string | null {
  if (eligible.has(target)) {
    return target;
  }
  const remapped = tsCounterpart(target);
  if (remapped !== null && eligible.has(remapped)) {
    return remapped;
  }
  for (const ext of EXTENSIONS) {
    if (eligible.has(`${target}${ext}`)) {
      return `${target}${ext}`;
    }
  }
  for (const ext of EXTENSIONS) {
    if (eligible.has(`${target}/index${ext}`)) {
      return `${target}/index${ext}`;
    }
  }
  return null;
}

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

  const resolved = probe(target, eligible);
  if (resolved !== null) {
    return { external: false, path: resolved };
  }

  // A bin/ shim imports the compiled output under dist/; map it back onto the
  // eligible source tree (dist/src/cli.js -> src/cli.ts).
  if (sourcePath.startsWith("bin/") && target.startsWith("dist/")) {
    const stripped = probe(target.slice(5), eligible);
    if (stripped !== null) {
      return { external: false, path: stripped };
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

import { resolveImport } from "../extract/import-resolver.js";
import { compareBytewise } from "../hash.js";
import type { FileFact, ImportFact, SymbolFact } from "../model.js";
import { isTestPath } from "../typescript-extractor.js";

export type EdgeKind =
  | "CONTAINS"
  | "IMPORTS"
  | "INHERITS"
  | "IMPLEMENTS"
  | "CALLS"
  | "TESTED_BY";
export type EdgeTier = "extracted" | "inferred";

export interface GraphEdge {
  kind: EdgeKind;
  from: string;
  to: string;
  confidence: number;
  tier: EdgeTier;
}

export interface GraphNode {
  id: string;
  kind: "file" | "symbol";
}

export interface CodeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolvedCallCensus: Array<{ callerQualifiedName: string; count: number }>;
}

interface BuildContext {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  census: Map<string, number>;
  fileSymbols: Map<string, Set<string>>;
  symbolsMap: Map<string, SymbolFact>;
  importMap: Map<string, ImportFact[]>;
  resolvedImports: Map<string, string>; // "filePath::specifier" -> resolved path
  externalImports: Map<string, Set<string>>; // filePath -> imported names that are external
}

function addEdge(
  ctx: BuildContext,
  kind: EdgeKind,
  from: string,
  to: string,
  confidence: number,
  tier: EdgeTier,
): void {
  const key = `${kind}::${from}::${to}`;
  if (!ctx.edges.has(key)) {
    ctx.edges.set(key, { kind, from, to, confidence, tier });
  }
}

function fileId(path: string): string {
  return `file:${path}`;
}

function symId(qname: string): string {
  return `sym:${qname}`;
}

export function buildCodeGraph(
  fileFacts: FileFact[],
  eligiblePaths: string[],
): CodeGraph {
  const ctx: BuildContext = {
    nodes: new Map(),
    edges: new Map(),
    census: new Map(),
    fileSymbols: new Map(),
    symbolsMap: new Map(),
    importMap: new Map(),
    resolvedImports: new Map(),
    externalImports: new Map(),
  };

  // --- Nodes & CONTAINS ---
  for (const file of fileFacts) {
    const fId = fileId(file.path);
    ctx.nodes.set(fId, { id: fId, kind: "file" });
    const symSet = new Set<string>();

    for (const sym of file.symbols) {
      const sId = symId(sym.qualifiedName);
      ctx.nodes.set(sId, { id: sId, kind: "symbol" });
      symSet.add(sym.name);
      ctx.symbolsMap.set(sym.qualifiedName, sym);
      addEdge(ctx, "CONTAINS", fId, sId, 1.0, "extracted");
    }

    ctx.fileSymbols.set(file.path, symSet);
    ctx.importMap.set(file.path, file.imports);
  }

  // --- IMPORTS ---
  for (const file of fileFacts) {
    for (const imp of file.imports) {
      const resolved = resolveImport(imp.moduleSpecifier, file.path, eligiblePaths);
      if (resolved.external) {
        if (imp.importedName) {
          let set = ctx.externalImports.get(file.path);
          if (!set) {
            set = new Set();
            ctx.externalImports.set(file.path, set);
          }
          set.add(imp.importedName);
        }
        continue;
      }
      if (resolved.path && ctx.nodes.has(fileId(resolved.path))) {
        addEdge(
          ctx,
          "IMPORTS",
          fileId(file.path),
          fileId(resolved.path),
          1.0,
          "extracted",
        );
        ctx.resolvedImports.set(`${file.path}::${imp.moduleSpecifier}`, resolved.path);
      }
    }
  }

  // --- INHERITS / IMPLEMENTS ---
  for (const file of fileFacts) {
    for (const sym of file.symbols) {
      const h = sym.heritage;
      for (const name of h.extends) {
        resolveHeritage(ctx, file, sym, name, "INHERITS", fileFacts);
      }
      for (const name of h.implements) {
        resolveHeritage(ctx, file, sym, name, "IMPLEMENTS", fileFacts);
      }
    }
  }

  // --- CALLS ---
  for (const file of fileFacts) {
    for (const call of file.calls) {
      const recv = call.receiver;
      const callerId = call.callerQualifiedName || fileId(file.path);
      const callerNodeId = call.callerQualifiedName
        ? symId(call.callerQualifiedName)
        : fileId(file.path);
      let resolved = false;

      if (recv === "identifier") {
        const calleeName = call.calleeText;
        // 1. Same-file lookup
        const sameFile = findSameFileSymbol(file, calleeName);
        if (sameFile) {
          addEdge(
            ctx,
            "CALLS",
            callerNodeId,
            symId(sameFile.qualifiedName),
            0.95,
            "extracted",
          );
          resolved = true;
        } else {
          // 2. Import-scoped
          const imported = findImportScopedSymbol(ctx, file, calleeName, fileFacts);
          if (imported) {
            addEdge(
              ctx,
              "CALLS",
              callerNodeId,
              symId(imported.qualifiedName),
              0.9,
              "extracted",
            );
            resolved = true;
          }
        }
      } else if (recv === "this") {
        const calleeName = call.calleeText.split(".").pop() ?? call.calleeText;
        const sibling = findThisSibling(file, call.callerQualifiedName, calleeName);
        if (sibling) {
          addEdge(
            ctx,
            "CALLS",
            callerNodeId,
            symId(sibling.qualifiedName),
            0.95,
            "extracted",
          );
          resolved = true;
        }
      } else if (recv === "property") {
        const parts = call.calleeText.split(".");
        const base = parts[0] ?? "";
        const prop = parts[1] ?? "";
        const imported = findImportScopedSymbol(ctx, file, base, fileFacts);
        if (imported) {
          // If the imported target is a symbol (like namespace import or a class/object), check its methods
          // Or if it was resolved to a file (default namespace), check that file's exports
          const targetFile = fileFacts.find((f) => f.path === imported.path);
          if (targetFile) {
            const sym = targetFile.symbols.find((s) => s.name === prop && s.exported);
            if (sym) {
              addEdge(
                ctx,
                "CALLS",
                callerNodeId,
                symId(sym.qualifiedName),
                0.9,
                "extracted",
              );
              resolved = true;
            }
          }
        }
      }

      if (!resolved) {
        // Skip the census for callees that are external imports (packages and
        // node: built-ins): an unresolved library call is not a gap in our
        // understanding of the repository.
        const externalNames = ctx.externalImports.get(file.path);
        const base = (
          recv === "property"
            ? (call.calleeText.split(".")[0] ?? call.calleeText)
            : call.calleeText
        ).trim();
        if (externalNames?.has(base)) {
          continue;
        }
        ctx.census.set(callerId, (ctx.census.get(callerId) ?? 0) + 1);
      }
    }
  }

  // --- TESTED_BY ---
  buildTestedBy(ctx, fileFacts);

  // --- Sort & Format ---
  const nodes = [...ctx.nodes.values()].sort((a, b) => compareBytewise(a.id, b.id));
  const edges = [...ctx.edges.values()].sort((a, b) =>
    compareBytewise(`${a.kind}::${a.from}::${a.to}`, `${b.kind}::${b.from}::${b.to}`),
  );
  const unresolvedCallCensus = [...ctx.census.entries()]
    .map(([callerQualifiedName, count]) => ({ callerQualifiedName, count }))
    .sort((a, b) => compareBytewise(a.callerQualifiedName, b.callerQualifiedName));

  return { nodes, edges, unresolvedCallCensus };
}

function findSameFileSymbol(file: FileFact, name: string): SymbolFact | null {
  return file.symbols.find((s) => s.name === name) ?? null;
}

function findImportScopedSymbol(
  ctx: BuildContext,
  file: FileFact,
  name: string,
  fileFacts: FileFact[],
): SymbolFact | null {
  const imp = file.imports.find((i) => i.importedName === name);
  if (!imp) return null;
  const resolvedPath = ctx.resolvedImports.get(`${file.path}::${imp.moduleSpecifier}`);
  if (!resolvedPath) return null;
  const targetFile = fileFacts.find((f) => f.path === resolvedPath);
  if (!targetFile) return null;

  // Find the matching exported symbol in target file
  return targetFile.symbols.find((s) => s.name === name && s.exported) ?? null;
}

function findThisSibling(
  file: FileFact,
  callerQName: string,
  calleeName: string,
): SymbolFact | null {
  if (!callerQName.includes("#")) return null;
  const parts = callerQName.split("#")[1]?.split(".") ?? [];
  if (parts.length < 2) return null; // not a method/constructor
  const className = parts[0]!;
  const siblingQName = `${file.path}#${className}.${calleeName}`;
  const constructorQName = `${file.path}#${className}.constructor`;

  if (calleeName === "constructor") {
    return file.symbols.find((s) => s.qualifiedName === constructorQName) ?? null;
  }
  return file.symbols.find((s) => s.qualifiedName === siblingQName) ?? null;
}

function resolveHeritage(
  ctx: BuildContext,
  file: FileFact,
  sym: SymbolFact,
  name: string,
  kind: "INHERITS" | "IMPLEMENTS",
  fileFacts: FileFact[],
): void {
  // 1. Same-file
  const sameFile = findSameFileSymbol(file, name);
  if (sameFile) {
    addEdge(
      ctx,
      kind,
      symId(sym.qualifiedName),
      symId(sameFile.qualifiedName),
      0.95,
      "extracted",
    );
    return;
  }
  // 2. Import-scoped
  const imported = findImportScopedSymbol(ctx, file, name, fileFacts);
  if (imported) {
    addEdge(
      ctx,
      kind,
      symId(sym.qualifiedName),
      symId(imported.qualifiedName),
      0.9,
      "extracted",
    );
  }
}

function buildTestedBy(ctx: BuildContext, fileFacts: FileFact[]): void {
  const fileNodes = new Set(
    [...ctx.nodes.keys()].filter((id) => id.startsWith("file:")),
  );

  for (const file of fileFacts) {
    if (!isTestPath(file.path)) continue;
    const testFileId = fileId(file.path);

    // Import-driven
    for (const edge of ctx.edges.values()) {
      if (
        edge.kind === "IMPORTS" &&
        edge.from === testFileId &&
        !isTestPath(edge.to.slice(5))
      ) {
        addEdge(ctx, "TESTED_BY", testFileId, edge.to, 0.8, "inferred");
      }
    }

    // Path fallback
    const hasImportDriven = [...ctx.edges.values()].some(
      (e) => e.kind === "TESTED_BY" && e.from === testFileId,
    );
    if (!hasImportDriven) {
      const candidates = pathCorrespondents(file.path);
      for (const cand of candidates) {
        const candId = fileId(cand);
        if (fileNodes.has(candId)) {
          addEdge(ctx, "TESTED_BY", testFileId, candId, 0.7, "inferred");
          break;
        }
      }
    }
  }
}

function pathCorrespondents(testPath: string): string[] {
  const result: string[] = [];
  const match = /^(.+)\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.exec(testPath);
  if (match) {
    const stem = match[1]!;
    for (const ext of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]) {
      result.push(`${stem}${ext}`);
    }
  }
  const dirMatch =
    /^((?:.+\/)?)(?:__tests__|test|tests)\/(.+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))$/i.exec(
      testPath,
    );
  if (dirMatch) {
    const stem = `${dirMatch[1]}${dirMatch[2]}`.replace(/\.(test|spec)\./i, ".");
    for (const ext of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]) {
      const base = stem.replace(/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, ext);
      result.push(base);
      result.push(`src/${base}`);
    }
  }
  return result;
}

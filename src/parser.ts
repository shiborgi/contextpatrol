import { createRequire } from "node:module";
import { Language, type Node, Parser } from "web-tree-sitter";
import { compareText } from "./json.js";
import { queryTerms } from "./ranking.js";
import type { CachedFacts, SourceFile } from "./types.js";

const require = createRequire(import.meta.url);
const LANGUAGE_ASSETS: Record<string, string> = {
  c: "tree-sitter-c.wasm",
  cs: "tree-sitter-c_sharp.wasm",
  go: "tree-sitter-go.wasm",
  java: "tree-sitter-java.wasm",
  js: "tree-sitter-javascript.wasm",
  jsx: "tree-sitter-javascript.wasm",
  mjs: "tree-sitter-javascript.wasm",
  php: "tree-sitter-php.wasm",
  py: "tree-sitter-python.wasm",
  rb: "tree-sitter-ruby.wasm",
  rs: "tree-sitter-rust.wasm",
  swift: "tree-sitter-swift.wasm",
  ts: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
};
const DECLARATIONS = new Set([
  "class_declaration",
  "class_definition",
  "class_specifier",
  "enum_declaration",
  "enum_specifier",
  "function_declaration",
  "function_definition",
  "function_item",
  "interface_declaration",
  "method_declaration",
  "method_definition",
  "struct_item",
  "trait_item",
  "type_alias_declaration",
  "type_declaration",
]);

let initialized: Promise<void> | undefined;
const languages = new Map<string, Language>();

function terms(value: string): string[] {
  return queryTerms(value);
}

function importSpecifiers(content: string): string[] {
  const patterns = [
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /\bfrom\s+([\w./-]+)\s+import\b/g,
    /\bimport\s+([\w./-]+)(?:\s|;|$)/gm,
    /\brequire(?:_relative)?\s*\(?\s*["']([^"']+)["']/g,
    /\buse\s+([\\\w./:-]+)\s*;/g,
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found].sort(compareText);
}

function nodeName(node: Node, content: string): string | undefined {
  const named = node.childForFieldName("name");
  if (named) return content.slice(named.startIndex, named.endIndex);
  for (const child of node.namedChildren) {
    if (
      ["identifier", "type_identifier", "property_identifier", "constant"].includes(
        child.type,
      )
    )
      return content.slice(child.startIndex, child.endIndex);
  }
  return undefined;
}

async function language(extension: string): Promise<Language | undefined> {
  const asset = LANGUAGE_ASSETS[extension];
  if (!asset) return undefined;
  if (!initialized) {
    initialized = Parser.init({
      locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    });
  }
  await initialized;
  const cached = languages.get(asset);
  if (cached) return cached;
  const loaded = await Language.load(
    require.resolve(`@repomix/tree-sitter-wasms/out/${asset}`),
  );
  languages.set(asset, loaded);
  return loaded;
}

export async function parseFile(file: SourceFile): Promise<CachedFacts> {
  const grammar = await language(file.language);
  const imports = importSpecifiers(file.content);
  const found: CachedFacts["symbols"] = [];
  if (grammar) {
    const parser = new Parser();
    try {
      parser.setLanguage(grammar);
      const tree = parser.parse(file.content);
      if (!tree)
        return {
          language: file.language,
          symbols: [],
          imports,
          terms: [...new Set([...terms(file.path), ...imports.flatMap(terms)])].sort(
            compareText,
          ),
        };
      const visit = (node: Node): void => {
        if (DECLARATIONS.has(node.type)) {
          const name = nodeName(node, file.content);
          if (name) {
            const text = file.content.slice(node.startIndex, node.endIndex);
            found.push({
              id: `sym:${file.path}#${name}:${node.startPosition.row + 1}`,
              path: file.path,
              name,
              kind: node.type,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              exported: /\b(?:export|public|pub)\b/.test(text.slice(0, 160)),
            });
          }
        }
        for (const child of node.namedChildren) visit(child);
      };
      visit(tree.rootNode);
      tree.delete();
    } finally {
      parser.delete();
    }
  }
  const identifiers = found.flatMap((symbol) => terms(symbol.name));
  return {
    language: file.language,
    symbols: found.sort((left, right) => compareText(left.id, right.id)),
    imports,
    terms: [
      ...new Set([...terms(file.path), ...identifiers, ...imports.flatMap(terms)]),
    ].sort(compareText),
  };
}

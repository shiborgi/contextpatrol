import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { Language, Parser } from "web-tree-sitter";
import { LIMITS } from "./contracts.js";
import { compareText } from "./json.js";
import type { Diagnostics, SourceFile } from "./source.js";

export interface ImportFact {
  specifier: string;
  line: number;
  members?: string[];
}
export interface Facts {
  imports: ImportFact[];
  signals: string[];
}
const require = createRequire(import.meta.url);
let pythonLanguage: Promise<Language> | undefined;
function python(): Promise<Language> {
  pythonLanguage ??= (async () => {
    await Parser.init({
      locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    });
    return Language.load(
      require.resolve("@repomix/tree-sitter-wasms/out/tree-sitter-python.wasm"),
    );
  })();
  return pythonLanguage;
}
export async function extract(
  file: SourceFile,
  diagnostics: Diagnostics,
): Promise<Facts> {
  const imports: ImportFact[] = [];
  const signals = new Set<string>();
  if (["typescript", "javascript", "python"].includes(file.language))
    signals.add(file.language);
  if (/\.(?:jsx|tsx)$/.test(file.path)) {
    signals.add(path.posix.extname(file.path).slice(1));
    signals.add("react");
  }
  const add = (specifier: string, line: number, members?: string[]) => {
    if (imports.length >= LIMITS.maxImports) {
      diagnostics.add(`Import limit reached: ${file.path}`, true);
      return;
    }
    if (members) imports.push({ specifier, line, members });
    else imports.push({ specifier, line });
  };
  if (["javascript", "typescript"].includes(file.language)) {
    try {
      const source = ts.createSourceFile(
        file.path,
        file.content,
        ts.ScriptTarget.Latest,
        true,
      );
      // Parse diagnostics are not part of the public compiler SourceFile interface.
      if (
        (source as ts.SourceFile & { parseDiagnostics?: unknown[] }).parseDiagnostics
          ?.length
      )
        diagnostics.add(`Syntax errors; imports may be incomplete: ${file.path}`, true);
      const pending: ts.Node[] = [source];
      while (pending.length) {
        const node = pending.pop();
        if (!node) break;
        const line =
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          add(node.moduleSpecifier.text, line);
        if (
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference) &&
          node.moduleReference.expression &&
          ts.isStringLiteral(node.moduleReference.expression)
        )
          add(node.moduleReference.expression.text, line);
        if (
          ts.isImportTypeNode(node) &&
          ts.isLiteralTypeNode(node.argument) &&
          ts.isStringLiteral(node.argument.literal)
        )
          add(node.argument.literal.text, line);
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        ) {
          const arg = node.arguments[0];
          if (
            arg &&
            (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
          )
            add(arg.text, line);
          else
            diagnostics.add(
              `Nonliteral import/require not resolved: ${file.path}:${line}`,
            );
        }
        ts.forEachChild(node, (child) => {
          pending.push(child);
        });
      }
    } catch {
      diagnostics.add(`JavaScript/TypeScript parse failed: ${file.path}`, true);
    }
  } else if (file.language === "python") {
    const grammar = await python();
    const parser = new Parser();
    try {
      parser.setLanguage(grammar);
      const tree = parser.parse(file.content);
      if (!tree) throw new Error("no syntax tree");
      try {
        if (tree.rootNode.hasError)
          diagnostics.add(
            `Syntax errors; imports may be incomplete: ${file.path}`,
            true,
          );
        const pending = [tree.rootNode];
        while (pending.length) {
          const node = pending.pop();
          if (!node) break;
          const names = node
            .childrenForFieldName("name")
            .map((child) =>
              child.type === "aliased_import"
                ? (child.childForFieldName("name")?.text ?? "")
                : child.text,
            )
            .filter(Boolean);
          if (node.type === "import_statement")
            for (const name of names) add(name, node.startPosition.row + 1);
          if (node.type === "import_from_statement") {
            const module = node.childForFieldName("module_name")?.text;
            if (module) add(module, node.startPosition.row + 1, names);
          }
          if (
            node.type === "call" &&
            /^(?:__import__|importlib\.import_module)$/.test(
              node.childForFieldName("function")?.text ?? "",
            )
          )
            diagnostics.add(
              `Dynamic Python import not resolved: ${file.path}:${node.startPosition.row + 1}`,
            );
          pending.push(...node.namedChildren);
        }
      } finally {
        tree.delete();
      }
    } finally {
      parser.delete();
    }
  }
  const packages = new Set(imports.map((item) => item.specifier));
  if (path.posix.basename(file.path) === "package.json") {
    try {
      const metadata: unknown = JSON.parse(file.content);
      if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
        for (const section of [
          "dependencies",
          "devDependencies",
          "peerDependencies",
          "optionalDependencies",
        ]) {
          const values = (metadata as Record<string, unknown>)[section];
          if (values && typeof values === "object" && !Array.isArray(values))
            for (const name of Object.keys(values)) packages.add(name);
        }
      }
    } catch {
      diagnostics.add(`Invalid package metadata: ${file.path}`);
    }
  }
  const base = path.posix.basename(file.path);
  if (
    /^(?:pyproject\.toml|requirements(?:[.-].*)?\.txt|setup\.py|Pipfile)$/.test(base)
  ) {
    signals.add("python");
    if (
      /(?:^|[\s"'])mcp(?:[\s"'=<>~[]|$)|(?:^|[\s"'])fastmcp(?:[\s"'=<>~[]|$)/im.test(
        file.content,
      )
    )
      signals.add("mcp");
  }
  if (/^next\.config\./.test(base)) signals.add("nextjs");
  if (
    /^(?:mcp\.json|\.mcp\.json)$/.test(base) ||
    /(?:McpServer|FastMCP|modelcontextprotocol|mcpServers)/.test(file.content)
  )
    signals.add("mcp");
  if (
    signals.has("python") &&
    /(?:^|[\s"'])fastapi(?:[\s"'=<>~[]|$)/im.test(file.content)
  )
    signals.add("fastapi");
  for (const pkg of packages) {
    if (/^react(?:$|\/|-dom$)/.test(pkg)) signals.add("react");
    if (/^next(?:$|\/)/.test(pkg)) {
      signals.add("nextjs");
      signals.add("react");
    }
    if (/^(?:@modelcontextprotocol\/|mcp(?:$|\.)|fastmcp(?:$|\.))/.test(pkg))
      signals.add("mcp");
    if (/^fastapi(?:$|\.)/.test(pkg)) signals.add("fastapi");
    if (pkg === "typescript") signals.add("typescript");
  }
  imports.sort((a, b) => compareText(a.specifier, b.specifier) || a.line - b.line);
  return { imports, signals: [...signals].sort(compareText) };
}

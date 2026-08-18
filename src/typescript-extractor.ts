import ts from "typescript";

import type {
  CallFact,
  ImportFact,
  RationaleFact,
  ReceiverKind,
  SymbolFact,
  SymbolKind,
} from "./model.js";

export interface ExtractionResult {
  symbols: SymbolFact[];
  imports: ImportFact[];
  calls: CallFact[];
  rationale: RationaleFact[];
}

const TEST_PATH_RE =
  /(?:^|\/)(?:__tests__|test|tests|__mocks__|__fixtures__)\/|\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;

const RATIONALE_RE = /\b(WHY|NOTE|HACK|TODO|FIXME)\b[:\s]*(.*)/i;

export function isTestPath(path: string): boolean {
  return TEST_PATH_RE.test(path);
}

export function extractSymbols(path: string, source: string): ExtractionResult {
  const isTs = /\.(ts|tsx|mts|cts)$/i.test(path);
  const isTsx = /\.(tsx|jsx)$/i.test(path);
  const scriptKind = isTs
    ? isTsx
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
    : isTsx
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.JS;

  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const { exportedNames, defaultExport } = collectExportedNames(sourceFile);

  const symbols: SymbolFact[] = [];
  const imports: ImportFact[] = [];
  const calls: CallFact[] = [];
  const rationale: RationaleFact[] = [];
  const callerStack: string[] = [];

  const lineOf = (pos: number): number =>
    sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

  const pushSymbol = (
    kind: SymbolKind,
    name: string,
    node: ts.Node,
    qualifiedName: string,
    exported: boolean,
    heritage: { extends: string[]; implements: string[] } = {
      extends: [],
      implements: [],
    },
  ): void => {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    const signature = firstLine(source.slice(start, end), 160);
    const sourceText = source.slice(start, end).trim();
    const jsdoc = leadingJsDoc(source, node.getFullStart());
    const isTest = isTestPath(path);
    symbols.push({
      kind,
      name,
      qualifiedName,
      path,
      signature,
      jsdoc,
      source: sourceText,
      range: { startLine: lineOf(start), endLine: lineOf(end) },
      exported,
      confidence: 1.0,
      isTest,
      heritage,
    });

    // Extract rationale markers from leading comments
    extractRationale(node, qualifiedName, source, lineOf, rationale);
  };

  const isExported = (node: ts.Node): boolean => {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return (modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  };

  const isReachable = (name: string): boolean =>
    exportedNames.has(name) || defaultExport === name;

  const heritageOf = (
    node: ts.ClassDeclaration | ts.InterfaceDeclaration,
  ): { extends: string[]; implements: string[] } => {
    const ext: string[] = [];
    const impl: string[] = [];
    for (const clause of node.heritageClauses ?? []) {
      for (const t of clause.types) {
        const name = t.expression.getText(sourceFile);
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          ext.push(name);
        } else {
          impl.push(name);
        }
      }
    }
    return { extends: ext, implements: impl };
  };

  const visit = (node: ts.Node): void => {
    // --- Import extraction ---
    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (!ts.isStringLiteral(specifier)) {
        ts.forEachChild(node, visit);
        return;
      }
      const moduleSpecifier = specifier.text;
      const clause = node.importClause;
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      const range = { startLine: lineOf(start), endLine: lineOf(end) };

      if (!clause) {
        imports.push({
          kind: "side-effect",
          importedName: null,
          moduleSpecifier,
          range,
        });
      } else {
        if (clause.name) {
          imports.push({
            kind: "default",
            importedName: clause.name.text,
            moduleSpecifier,
            range,
          });
        }
        if (clause.namedBindings) {
          if (ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              imports.push({
                kind: "named",
                importedName: el.name.text,
                moduleSpecifier,
                range,
              });
            }
          } else if (ts.isNamespaceImport(clause.namedBindings)) {
            imports.push({
              kind: "namespace",
              importedName: clause.namedBindings.name.text,
              moduleSpecifier,
              range,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
      return;
    }

    // --- Call extraction ---
    if (ts.isCallExpression(node)) {
      const caller =
        callerStack.length > 0 ? (callerStack[callerStack.length - 1] ?? "") : "";
      const calleeText = node.expression.getText(sourceFile).slice(0, 120);
      const recv = classifyReceiver(node.expression);
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      calls.push({
        callerQualifiedName: caller,
        calleeText,
        receiver: recv,
        range: { startLine: lineOf(start), endLine: lineOf(end) },
      });
    }

    // --- Symbol extraction with caller stack ---
    if (ts.isFunctionDeclaration(node) && node.name) {
      const qname = `${path}#${node.name.text}`;
      callerStack.push(qname);
      pushSymbol(
        "function",
        node.name.text,
        node,
        qname,
        isExported(node) || isReachable(node.name.text),
      );
      ts.forEachChild(node, visit);
      callerStack.pop();
      return;
    } else if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const classExported = isExported(node) || isReachable(className);
      pushSymbol(
        "class",
        className,
        node,
        `${path}#${className}`,
        classExported,
        heritageOf(node),
      );
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = nameText(member.name);
          const qname = `${path}#${className}.${methodName}`;
          callerStack.push(qname);
          pushSymbol("method", methodName, member, qname, classExported);
          ts.forEachChild(member, visit);
          callerStack.pop();
        } else if (ts.isConstructorDeclaration(member)) {
          const qname = `${path}#${className}.constructor`;
          callerStack.push(qname);
          pushSymbol("constructor", "constructor", member, qname, classExported);
          ts.forEachChild(member, visit);
          callerStack.pop();
        }
      }
      return;
    } else if (ts.isInterfaceDeclaration(node)) {
      pushSymbol(
        "interface",
        node.name.text,
        node,
        `${path}#${node.name.text}`,
        isExported(node) || isReachable(node.name.text),
        heritageOf(node),
      );
    } else if (ts.isTypeAliasDeclaration(node)) {
      pushSymbol(
        "type",
        node.name.text,
        node,
        `${path}#${node.name.text}`,
        isExported(node) || isReachable(node.name.text),
      );
    } else if (ts.isEnumDeclaration(node)) {
      pushSymbol(
        "enum",
        node.name.text,
        node,
        `${path}#${node.name.text}`,
        isExported(node) || isReachable(node.name.text),
      );
    } else if (ts.isVariableDeclaration(node)) {
      const init = node.initializer;
      const isCallable =
        init !== undefined &&
        (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
      if (isCallable && ts.isIdentifier(node.name)) {
        const qname = `${path}#${node.name.text}`;
        callerStack.push(qname);
        pushSymbol(
          "callable-variable",
          node.name.text,
          node,
          qname,
          isReachable(node.name.text),
        );
        ts.forEachChild(node, visit);
        callerStack.pop();
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { symbols, imports, calls, rationale };
}

function classifyReceiver(expr: ts.Expression): ReceiverKind {
  if (ts.isPropertyAccessExpression(expr)) {
    if (expr.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return "this";
    }
    return "property";
  }
  if (ts.isIdentifier(expr)) {
    return "identifier";
  }
  return "unresolved";
}

function extractRationale(
  node: ts.Node,
  qualifiedName: string,
  source: string,
  lineOf: (pos: number) => number,
  out: RationaleFact[],
): void {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart());
  if (!ranges || ranges.length === 0) return;
  for (const r of ranges) {
    const comment = source.slice(r.pos, r.end);
    const match = RATIONALE_RE.exec(comment);
    if (match) {
      const marker = match[1] as RationaleFact["marker"];
      const text = (match[2] ?? "").trim().slice(0, 300);
      out.push({
        marker,
        symbolQualifiedName: qualifiedName,
        text: text || marker,
        range: { startLine: lineOf(r.pos), endLine: lineOf(r.end) },
      });
    }
  }
}

function nameText(node: ts.Node): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) {
    return node.text;
  }
  return node.getText();
}

function firstLine(text: string, max: number): string {
  const trimmed = text.trim();
  const line = trimmed.split("\n", 1)[0] ?? trimmed;
  return line.length <= max ? line : `${line.slice(0, max)}\u2026`;
}

interface ExportInfo {
  exportedNames: Set<string>;
  defaultExport: string | null;
}

/**
 * Collect the module's export surface so reachability (exported) can be
 * computed for members that carry no export modifier of their own: methods,
 * constructors and callable variables. Covers export modifiers, named export
 * lists, default exports and CommonJS assignments (`module.exports` /
 * `exports.x`).
 */
function collectExportedNames(sourceFile: ts.SourceFile): ExportInfo {
  const exportedNames = new Set<string>();
  let defaultExport: string | null = null;

  const addName = (name: ts.Node | undefined): void => {
    if (name !== undefined && ts.isIdentifier(name)) {
      exportedNames.add(name.text);
    }
  };

  const hasExportModifier = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node)
      ? (ts.getModifiers(node) ?? []).some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword,
        )
      : false;

  const isExportsIdentifier = (node: ts.Node): boolean =>
    ts.isIdentifier(node) && node.text === "exports";

  const isModuleExports = (node: ts.Node): boolean =>
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "module" &&
    node.name.text === "exports";

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) {
      if (hasExportModifier(node)) {
        addName(node.name);
      }
    } else if (ts.isVariableStatement(node)) {
      if (hasExportModifier(node)) {
        for (const decl of node.declarationList.declarations) {
          addName(decl.name);
        }
      }
    } else if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      if (hasExportModifier(node)) {
        addName(node.name);
      }
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          exportedNames.add(element.name.text);
        }
      }
    } else if (ts.isExportAssignment(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression)) {
        defaultExport = expression.text;
      } else if (
        (ts.isClassExpression(expression) || ts.isFunctionExpression(expression)) &&
        expression.name !== undefined
      ) {
        defaultExport = expression.name.text;
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = node.left;
      const right = node.right;
      if (isModuleExports(left)) {
        // module.exports = <identifier | object-literal>
        if (ts.isIdentifier(right)) {
          defaultExport = right.text;
        } else if (ts.isObjectLiteralExpression(right)) {
          for (const prop of right.properties) {
            if (
              (ts.isShorthandPropertyAssignment(prop) ||
                ts.isPropertyAssignment(prop)) &&
              ts.isIdentifier(prop.name)
            ) {
              exportedNames.add(prop.name.text);
            }
          }
        }
      } else if (ts.isPropertyAccessExpression(left)) {
        // exports.foo = ...  |  module.exports.foo = ...
        if (isExportsIdentifier(left.expression) || isModuleExports(left.expression)) {
          exportedNames.add(left.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { exportedNames, defaultExport };
}

function leadingJsDoc(source: string, fullStart: number): string {
  const ranges = ts.getLeadingCommentRanges(source, fullStart);
  if (!ranges || ranges.length === 0) {
    return "";
  }
  const last = ranges[ranges.length - 1];
  if (last === undefined) {
    return "";
  }
  const comment = source.slice(last.pos, last.end);
  if (!comment.startsWith("/**")) {
    return "";
  }
  const body = comment
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");
  return body.slice(0, 200);
}

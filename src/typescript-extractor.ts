import ts from "typescript";

import type { SymbolFact, SymbolKind } from "./model.js";

export function extractSymbols(path: string, source: string): SymbolFact[] {
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

  const facts: SymbolFact[] = [];
  const lineOf = (pos: number): number =>
    sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

  const push = (
    kind: SymbolKind,
    name: string,
    node: ts.Node,
    qualifiedName: string,
    exported: boolean,
  ): void => {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    const signature = firstLine(source.slice(start, end), 160);
    const sourceText = source.slice(start, end).trim();
    const jsdoc = leadingJsDoc(source, node.getFullStart());
    facts.push({
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
    });
  };

  const isExported = (node: ts.Node): boolean => {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return (modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      push(
        "function",
        node.name.text,
        node,
        `${path}#${node.name.text}`,
        isExported(node),
      );
    } else if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      push("class", className, node, `${path}#${className}`, isExported(node));
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = nameText(member.name);
          push(
            "method",
            methodName,
            member,
            `${path}#${className}.${methodName}`,
            true,
          );
        } else if (ts.isConstructorDeclaration(member)) {
          push(
            "constructor",
            "constructor",
            member,
            `${path}#${className}.constructor`,
            true,
          );
        }
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      push(
        "interface",
        node.name.text,
        node,
        `${path}#${node.name.text}`,
        isExported(node),
      );
    } else if (ts.isTypeAliasDeclaration(node)) {
      push("type", node.name.text, node, `${path}#${node.name.text}`, isExported(node));
    } else if (ts.isEnumDeclaration(node)) {
      push("enum", node.name.text, node, `${path}#${node.name.text}`, isExported(node));
    } else if (ts.isVariableDeclaration(node)) {
      const init = node.initializer;
      const isCallable =
        init !== undefined &&
        (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
      if (isCallable && ts.isIdentifier(node.name)) {
        push(
          "callable-variable",
          node.name.text,
          node,
          `${path}#${node.name.text}`,
          false,
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return facts;
}

function nameText(name: ts.Node): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return name.getText();
}

function firstLine(text: string, max: number): string {
  const trimmed = text.trim();
  const line = trimmed.split("\n", 1)[0] ?? trimmed;
  return line.length <= max ? line : `${line.slice(0, max)}\u2026`;
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

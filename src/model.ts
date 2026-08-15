export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "constructor"
  | "interface"
  | "type"
  | "enum"
  | "callable-variable";

export interface SymbolFact {
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  path: string;
  signature: string;
  jsdoc: string;
  source: string;
  range: { startLine: number; endLine: number };
  exported: boolean;
  confidence: number;
}

export interface FileFact {
  path: string;
  language: "typescript" | "javascript" | "markdown" | "json" | "other";
  size: number;
  lines: number;
  digest: string;
  symbols: SymbolFact[];
}

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { digest } from "./json.js";
import type { CachedFacts } from "./types.js";

export type { CachedFacts } from "./types.js";

const PARSER_VERSION = "tree-sitter-v1";

function cachePath(root: string): string {
  const base = process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache");
  const directory = path.join(base, "contextpatrol");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.join(directory, `${digest(root).replace("sha256:", "")}.sqlite`);
}

export class IndexStore {
  readonly #db: DatabaseSync;

  constructor(root: string) {
    this.#db = new DatabaseSync(cachePath(root));
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA trusted_schema = OFF;
      CREATE TABLE IF NOT EXISTS file_facts (
        hash TEXT NOT NULL,
        parser_version TEXT NOT NULL,
        language TEXT NOT NULL,
        symbols_json TEXT NOT NULL,
        imports_json TEXT NOT NULL,
        terms_json TEXT NOT NULL,
        PRIMARY KEY (hash, parser_version)
      ) WITHOUT ROWID;
      CREATE VIRTUAL TABLE IF NOT EXISTS fact_search USING fts5(
        hash UNINDEXED,
        parser_version UNINDEXED,
        terms,
        tokenize = 'unicode61'
      );
    `);
  }

  get(hash: string): CachedFacts | undefined {
    const row = this.#db
      .prepare(
        `SELECT language, symbols_json, imports_json, terms_json
         FROM file_facts WHERE hash = ? AND parser_version = ?`,
      )
      .get(hash, PARSER_VERSION) as
      | {
          language: string;
          symbols_json: string;
          imports_json: string;
          terms_json: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      language: row.language,
      symbols: JSON.parse(row.symbols_json) as CachedFacts["symbols"],
      imports: JSON.parse(row.imports_json) as string[],
      terms: JSON.parse(row.terms_json) as string[],
    };
  }

  put(hash: string, facts: CachedFacts): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare(
          `INSERT OR REPLACE INTO file_facts
           (hash, parser_version, language, symbols_json, imports_json, terms_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          hash,
          PARSER_VERSION,
          facts.language,
          JSON.stringify(facts.symbols),
          JSON.stringify(facts.imports),
          JSON.stringify(facts.terms),
        );
      this.#db
        .prepare("DELETE FROM fact_search WHERE hash = ? AND parser_version = ?")
        .run(hash, PARSER_VERSION);
      this.#db
        .prepare(
          "INSERT INTO fact_search (hash, parser_version, terms) VALUES (?, ?, ?)",
        )
        .run(hash, PARSER_VERSION, facts.terms.join(" "));
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  search(queryTerms: string[]): Set<string> {
    if (queryTerms.length === 0) return new Set();
    const expression = queryTerms
      .slice(0, 24)
      .map((term) => `"${term}"`)
      .join(" OR ");
    const rows = this.#db
      .prepare(
        "SELECT hash FROM fact_search WHERE fact_search MATCH ? AND parser_version = ?",
      )
      .all(expression, PARSER_VERSION) as Array<{ hash: string }>;
    return new Set(rows.map((row) => row.hash));
  }

  close(): void {
    this.#db.close();
  }
}

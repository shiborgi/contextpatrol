import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { query } from "../src/index.js";

async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contextpatrol-go-rust-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return root;
}

test("Go imports and local package graph edges", async (t) => {
  const root = await fixture(t, {
    "go.mod": "module example.com/myproject\n\ngo 1.22\n",
    "main.go": `package main

import (
  "fmt"
  "example.com/myproject/pkg/util"
)

func main() {
  fmt.Println(util.Hello())
}
`,
    "pkg/util/util.go": `package util

func Hello() string {
  return "hello"
}
`,
    "pkg/consumer/consumer.go": `package consumer

import "github.com/foreign/util"
`,
  });

  const response = await query({
    protocolVersion: "1.0",
    root,
    task: "util hello",
    profile: "overview",
  });

  assert.ok(response.signals.includes("go"), "signals should include go");
  assert.ok(
    response.graph.edges.some(
      (e) =>
        e.from === "main.go" && e.to === "pkg/util/util.go" && e.kind === "imports",
    ),
    "should create imports edge from main.go to pkg/util/util.go",
  );
  assert.ok(
    !response.graph.edges.some(
      (e) => e.from === "pkg/consumer/consumer.go" && e.to === "pkg/util/util.go",
    ),
    "external Go imports must not be invented as local edges",
  );
});

test("Rust use declarations and mod item graph edges", async (t) => {
  const root = await fixture(t, {
    "Cargo.toml": '[package]\nname = "myrust"\nversion = "0.1.0"\n',
    "src/main.rs": `mod helper;
use crate::helper::greet;

fn main() {
  greet();
}
`,
    "src/helper.rs": `pub fn greet() {
  println!("hello");
}
`,
    "src/nested/mod.rs": "pub mod child;\npub mod sibling;\n",
    "src/nested/child.rs": "use super::sibling::value;\n",
    "src/nested/sibling.rs": "pub const value: u8 = 1;\n",
  });

  const response = await query({
    protocolVersion: "1.0",
    root,
    task: "greet helper",
    profile: "overview",
  });

  assert.ok(response.signals.includes("rust"), "signals should include rust");
  assert.ok(
    response.graph.edges.some(
      (e) =>
        e.from === "src/main.rs" && e.to === "src/helper.rs" && e.kind === "imports",
    ),
    "should create imports edge from src/main.rs to src/helper.rs",
  );
  assert.ok(
    response.graph.edges.some(
      (e) => e.from === "src/nested/child.rs" && e.to === "src/nested/sibling.rs",
    ),
    "super imports should resolve within the containing Rust module",
  );
});

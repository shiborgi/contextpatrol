import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";

const root = process.cwd();
const protocolDir = join(root, "protocol");
const fixturesDir = join(protocolDir, "fixtures");

const SCHEMA_BY_PREFIX = {
  "pack-request": "pack-request.schema.json",
  capsule: "capsule.schema.json",
  error: "error.schema.json",
  descriptor: "provider-descriptor.schema.json",
};

const ajv = new Ajv2020({ strict: true, allErrors: true });

function loadSchema(name) {
  const schema = JSON.parse(readFileSync(join(protocolDir, name), "utf8"));
  return ajv.compile(schema);
}

function prefixOf(filename) {
  for (const prefix of Object.keys(SCHEMA_BY_PREFIX)) {
    if (filename.startsWith(prefix)) {
      return prefix;
    }
  }
  return null;
}

const failures = [];
const schemas = new Map();

for (const [prefix, schemaFile] of Object.entries(SCHEMA_BY_PREFIX)) {
  schemas.set(prefix, loadSchema(schemaFile));
}

for (const group of ["valid", "invalid"]) {
  const dir = join(fixturesDir, group);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const prefix = prefixOf(file);
    if (!prefix) {
      continue;
    }
    const validate = schemas.get(prefix);
    const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const ok = validate(data);
    const expected = group === "valid";
    if (ok !== expected) {
      failures.push(
        `${group}/${file}: expected ${expected ? "valid" : "invalid"}, got ${ok ? "valid" : "invalid"}` +
          (ok ? "" : ` — ${JSON.stringify(validate.errors)}`),
      );
    }
  }
}

if (failures.length > 0) {
  console.error("schema fixture mismatch:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`check-schemas: ok (${schemas.size} schemas, fixtures consistent)`);

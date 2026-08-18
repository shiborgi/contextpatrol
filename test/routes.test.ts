import assert from "node:assert/strict";
import { test } from "node:test";

import { extractSymbols } from "../src/typescript-extractor.js";

test("extracts express-style routes with method, path and handler", () => {
  const src = [
    "app.get('/users', listUsers);",
    "app.post('/users', createUser);",
    "router.put('/users/:id', updateUser);",
    "server.delete('/users/:id', removeUser);",
  ].join("\n");
  const { routes } = extractSymbols("src/routes.ts", src);
  assert.equal(routes.length, 4);
  assert.deepEqual(routes[0], {
    method: "GET",
    path: "/users",
    handlerName: "listUsers",
    range: routes[0]?.range,
  });
  assert.equal(routes[1]?.method, "POST");
  assert.equal(routes[2]?.method, "PUT");
  assert.equal(routes[3]?.method, "DELETE");
});

test("extracts decorator-style routes", () => {
  const src = ["@Get('/health')", "async health() { return 'ok'; }"].join("\n");
  const { routes } = extractSymbols("src/health.controller.ts", src);
  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.method, "GET");
  assert.equal(routes[0]?.path, "/health");
});

test("ignores non-route calls and non-string paths", () => {
  const src = ["map.get(key);", "app.get(buildPath(), handler);"].join("\n");
  const { routes } = extractSymbols("src/x.ts", src);
  assert.equal(routes.length, 0);
});

test("route extraction is deterministic", () => {
  const src = "app.get('/a', h);\napp.post('/b', g);\n";
  const a = extractSymbols("src/r.ts", src);
  const b = extractSymbols("src/r.ts", src);
  assert.deepEqual(a.routes, b.routes);
});

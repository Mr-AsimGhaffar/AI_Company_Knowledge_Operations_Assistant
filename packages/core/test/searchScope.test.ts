import assert from "node:assert/strict";
import { test } from "node:test";
import { documentSearchScope } from "../src/search";

test("searches all ready documents visible to the role when no sources are selected", () => {
  const scope = documentSearchScope("EMPLOYEE");
  assert.match(scope.text, /d\.status = 'READY'/);
  assert.match(scope.text, /ANY \(d\.visibility\)/);
  assert.doesNotMatch(scope.text, /d\.id IN/);
  assert.deepEqual(scope.values, ["EMPLOYEE"]);
});

test("restricts search to selected document IDs and retains the role filter", () => {
  const ids = ["document-one", "document-two"];
  const scope = documentSearchScope("MANAGER", ids);
  assert.match(scope.text, /d\.status = 'READY'/);
  assert.match(scope.text, /ANY \(d\.visibility\)/);
  assert.match(scope.text, /d\.id IN \(\$2,\$3\)/);
  assert.deepEqual(scope.values, ["MANAGER", ...ids]);
});

test("an explicitly empty selection never falls back to all documents", () => {
  const scope = documentSearchScope("ADMIN", []);
  assert.match(scope.text, /AND FALSE/);
  assert.deepEqual(scope.values, ["ADMIN"]);
});

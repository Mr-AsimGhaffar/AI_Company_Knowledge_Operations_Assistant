import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL = "postgresql://localhost:5432/test";
process.env.GEMINI_API_KEY = "test-key";
const { Prisma, prisma } = await import("../src/db");
const { getGemini } = await import("../src/gemini");
const { searchDocs } = await import("../src/search");

test("applies the selected sources and role to both vector and text retrieval", async () => {
  const models = getGemini().models;
  const originalEmbed = models.embedContent;
  const originalQuery = prisma.$queryRaw;
  const queries: InstanceType<typeof Prisma.Sql>[] = [];
  models.embedContent = async () => ({ embeddings: [{ values: [1, 0] }] });
  prisma.$queryRaw = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    queries.push(Prisma.sql(strings, ...values));
    return [];
  };
  try {
    const results = await searchDocs("leave policy", "EMPLOYEE", 5, [
      "doc-one",
      "doc-two",
    ]);
    assert.deepEqual(results, []);
    assert.equal(queries.length, 2);
    for (const query of queries) {
      assert.match(query.text, /d\.status = 'READY'/);
      assert.match(query.text, /ANY \(d\.visibility\)/);
      assert.match(query.text, /d\.id IN/);
      assert.ok(query.values.includes("EMPLOYEE"));
      assert.ok(query.values.includes("doc-one"));
      assert.ok(query.values.includes("doc-two"));
    }
    assert.match(queries[0].text, /c\.embedding <=>/);
    assert.match(queries[1].text, /to_tsvector/);
    queries.length = 0;
    await searchDocs("leave policy", "EMPLOYEE");
    assert.equal(queries.length, 2);
    for (const query of queries) {
      assert.match(query.text, /ANY \(d\.visibility\)/);
      assert.doesNotMatch(query.text, /d\.id IN/);
    }
  } finally {
    models.embedContent = originalEmbed;
    prisma.$queryRaw = originalQuery;
  }
});

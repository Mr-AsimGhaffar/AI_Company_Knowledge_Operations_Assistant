import { Prisma, prisma, type Role } from "./db";
import { embedTexts, toVectorLiteral } from "./gemini";

export interface SearchHit {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

type Row = Omit<SearchHit, "score">;

const RRF_K = 60;

export function documentSearchScope(
  role: Role,
  documentIds?: string[],
): Prisma.Sql {
  const documentFilter =
    documentIds === undefined
      ? Prisma.empty
      : documentIds.length
        ? Prisma.sql`AND d.id IN (${Prisma.join(documentIds)})`
        : Prisma.sql`AND FALSE`;
  return Prisma.sql`d.status = 'READY' AND ${role}::"Role" = ANY (d.visibility) ${documentFilter}`;
}

/**
 * Hybrid retrieval: pgvector cosine similarity + Postgres full-text search,
 * merged with reciprocal rank fusion. The role filter runs inside SQL so
 * restricted text is never returned to the caller (or the LLM).
 */
export async function searchDocs(
  query: string,
  role: Role,
  limit = 5,
  documentIds?: string[],
): Promise<SearchHit[]> {
  const pool = 20;
  const [qEmbedding] = await embedTexts([query], "RETRIEVAL_QUERY");
  const vec = toVectorLiteral(qEmbedding);
  const scope = documentSearchScope(role, documentIds);

  const [vectorRows, textRows] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT c.id AS "chunkId", d.id AS "documentId", d.title, c.content, c.metadata
      FROM "Chunk" c
      JOIN "Document" d ON d.id = c."documentId"
      WHERE ${scope}
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vec}::vector
      LIMIT ${pool}`,
    prisma.$queryRaw<Row[]>`
      SELECT c.id AS "chunkId", d.id AS "documentId", d.title, c.content, c.metadata
      FROM "Chunk" c
      JOIN "Document" d ON d.id = c."documentId"
      WHERE ${scope}
        AND to_tsvector('english', c.content) @@ websearch_to_tsquery('english', ${query})
      ORDER BY ts_rank(to_tsvector('english', c.content), websearch_to_tsquery('english', ${query})) DESC
      LIMIT ${pool}`,
  ]);

  const merged = new Map<string, SearchHit>();
  for (const list of [vectorRows, textRows]) {
    list.forEach((row, rank) => {
      const add = 1 / (RRF_K + rank + 1);
      const existing = merged.get(row.chunkId);
      if (existing) existing.score += add;
      else merged.set(row.chunkId, { ...row, score: add });
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function describeLocation(metadata: Record<string, unknown>): string {
  if (metadata.page) return `page ${metadata.page}`;
  if (metadata.sheet)
    return `sheet "${metadata.sheet}"${metadata.rows ? `, rows ${metadata.rows}` : ""}`;
  return "";
}

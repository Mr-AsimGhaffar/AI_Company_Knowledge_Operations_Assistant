import { prisma } from "@workora/core";
import { hashPassword } from "./auth";
import { env } from "./env";

async function main() {
  // Idempotent indexes that Prisma cannot express.
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw ON "Chunk" USING hnsw (embedding vector_cosine_ops)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS chunk_content_fts ON "Chunk" USING gin (to_tsvector('english', content))`,
  );

  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists - nothing to do.`);
    return;
  }
  if (!env.SEED_ADMIN_PASSWORD || env.SEED_ADMIN_PASSWORD.length < 8) {
    throw new Error("Set SEED_ADMIN_PASSWORD (min 8 chars) in .env before seeding.");
  }
  await prisma.user.create({
    data: { email, name: env.SEED_ADMIN_NAME, role: "ADMIN", passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD) },
  });
  console.log(`Created admin ${email}. Change the password after first login (Settings).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

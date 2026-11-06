import { z } from "zod";

const schema = z.object({
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  NODE_ENV: z.string().default("development"),
  SEED_ADMIN_EMAIL: z.string().default("superadminasim@admin.com"),
  SEED_ADMIN_NAME: z.string().default("Super Admin"),
  SEED_ADMIN_PASSWORD: z.string().optional(),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === "production";

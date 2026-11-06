import { z } from "zod";

const optional = z.string().optional().default("");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  JIRA_SITE_URL: optional,
  JIRA_EMAIL: optional,
  JIRA_API_TOKEN: optional,
  JIRA_PROJECT_KEY: optional,
  SLACK_BOT_TOKEN: optional,
  SLACK_DEFAULT_CHANNEL_ID: optional,
  GITHUB_TOKEN: optional,
  GITHUB_REPOS: optional,
  MCP_DOCS_ROLE: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]).default("EMPLOYEE"),
});

export const config = schema.parse(process.env);

export const EMBEDDING_DIM = 768;

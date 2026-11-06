# Workora

Company knowledge & operations assistant: **RAG** over your PDFs/spreadsheets (Postgres + pgvector, Gemini) plus an **MCP server** that lets the agent work with Jira, Slack and GitHub. Write actions need human approval.

```
apps/web   Next.js + Tailwind UI (login, dashboard, chat, knowledge base, integrations, activity, users, settings)
apps/api   Express API: auth/RBAC, ingestion, chat (SSE) + Gemini agent loop, approvals, audit log
apps/mcp   MCP server (stdio) exposing docs_search, jira_*, slack_*, github_* tools
packages/core   Prisma schema, Gemini embeddings, hybrid search, integration clients, tool registry
```

## Setup

1. **Rename the project folder so it has no `&`** (e.g. `AI_Company_Knowledge_and_Operations_Assistant`). A `&` in the path breaks npm scripts on Windows.
2. `npm install`
3. Copy `.env.example` to `.env` (repo root) and fill in `JWT_SECRET`, `SEED_ADMIN_PASSWORD`, `GEMINI_API_KEY`, and the Jira/Slack/GitHub tokens when you have them. Copy `apps/web/.env.example` to `apps/web/.env.local`.
4. `npm run db:up` (Postgres + pgvector in Docker)
5. `npm run db:generate` then `npm run db:push`
6. `npm run db:seed` (creates the admin from `SEED_ADMIN_EMAIL`, plus search indexes)
7. `npm run dev` (API on :4000, web on :3000)

Without Jira/Slack/GitHub tokens those tools run in **mock mode**.

### Slack direct messages

The Slack write tool can send a direct message by recipient email or post to a channel. Add the `chat:write` and `users:read.email` bot token scopes to your Slack app, reinstall it to the workspace, and put the new bot token in `SLACK_BOT_TOKEN`. Use `slack-app-manifest.json` as a reference when creating or updating the app manifest. Messages still require approval before sending.

## Roles

| Role     | Can do                                                   |
| -------- | -------------------------------------------------------- |
| ADMIN    | Everything, including users and testing integrations     |
| MANAGER  | Upload/delete documents, approve or reject write actions |
| EMPLOYEE | Chat, read documents visible to them                     |

Each document has a visibility level; retrieval filters on it inside SQL, so restricted text never reaches Gemini.

## Using the MCP server from VS Code / Claude Desktop

Run `npm run dev:mcp` (stdio). `docs_search` results use the role in `MCP_DOCS_ROLE`.

## Notes

- Scanned (image-only) PDFs are not supported; there is no OCR yet.
- Uploaded files are indexed, and the original file is not stored.

export { config, EMBEDDING_DIM } from "./config";
export { prisma, Prisma } from "./db";
export type { Role, DocStatus, ToolStatus, User, Document, Chunk, Conversation, Message, ToolCallLog } from "./db";
export { getGemini, geminiConfigured, embedTexts, toVectorLiteral } from "./gemini";
export { searchDocs, describeLocation, type SearchHit } from "./search";
export { tools, writeToolNames, type ToolDef } from "./tools";
export { jiraTest, jiraConfigured } from "./integrations/jira";
export { slackTest, slackConfigured } from "./integrations/slack";
export { githubTest, githubConfigured, allowedRepos } from "./integrations/github";

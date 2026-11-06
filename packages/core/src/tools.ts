import { z } from "zod";
import type { Role } from "./db";
import { describeLocation, searchDocs } from "./search";
import { config } from "./config";
import {
  createIssue,
  searchIssues,
  updateIssueStatus,
} from "./integrations/jira";
import { postMessage } from "./integrations/slack";
import { getFile, listCommits, listPullRequests } from "./integrations/github";

export interface ToolDef {
  name: string;
  description: string;
  /** Write tools require human approval before they run. */
  write: boolean;
  shape: z.ZodRawShape;
  run: (args: any) => Promise<unknown>;
}

const repoDesc = "Repository as 'owner/name' or just the repo name";

export const tools: ToolDef[] = [
  {
    name: "docs_search",
    write: false,
    description:
      "Search the company's internal documents (PDF and spreadsheets) using hybrid semantic + keyword search. Returns the most relevant passages with their source.",
    shape: {
      query: z.string().min(2).describe("Natural language search query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Max passages to return"),
    },
    run: async (a: { query: string; limit?: number }) => {
      const hits = await searchDocs(
        a.query,
        config.MCP_DOCS_ROLE as Role,
        a.limit ?? 5,
      );
      return hits.map((h) => ({
        title: h.title,
        location: describeLocation(h.metadata),
        content: h.content,
        score: Number(h.score.toFixed(4)),
      }));
    },
  },
  {
    name: "jira_search_issues",
    write: false,
    description:
      "Search Jira issues in the default project by text or a JQL query.",
    shape: {
      text: z.string().optional().describe("Free text to search for"),
      jql: z.string().optional().describe("Optional raw JQL (overrides text)"),
      limit: z.number().int().min(1).max(25).default(10),
    },
    run: (a) => searchIssues(a),
  },
  {
    name: "jira_create_issue",
    write: true,
    description:
      "Create a Jira issue in the default project. Requires human approval.",
    shape: {
      summary: z.string().min(3).max(250),
      description: z
        .string()
        .optional()
        .describe("Detailed description, paragraphs separated by blank lines"),
      issueType: z.enum(["Task", "Bug", "Story", "Epic"]).default("Task"),
      priority: z
        .enum(["Highest", "High", "Medium", "Low", "Lowest"])
        .optional(),
    },
    run: (a) => createIssue(a),
  },
  {
    name: "jira_update_status",
    write: true,
    description:
      "Move a Jira issue to another status (e.g. 'In Progress', 'Done'). Requires human approval.",
    shape: {
      key: z
        .string()
        .regex(/^[A-Z][A-Z0-9]+-\d+$/)
        .describe("Issue key like AL-12"),
      status: z.string().min(2).describe("Target status name"),
    },
    run: (a) => updateIssueStatus(a),
  },
  {
    name: "slack_post_message",
    write: true,
    description:
      "Send a Slack direct message to a user by email, or post to a channel. Requires human approval.",
    shape: {
      text: z.string().min(1).max(3000),
      recipientEmail: z
        .string()
        .email()
        .optional()
        .describe("Email address of the Slack user to DM"),
      channel: z
        .string()
        .regex(/^[CGD][A-Z0-9]+$/)
        .optional()
        .describe(
          "Slack channel or conversation ID; omit for the default channel",
        ),
    },
    run: (a) => postMessage(a),
  },
  {
    name: "github_list_pull_requests",
    write: false,
    description: "List pull requests of an allowed GitHub repository.",
    shape: {
      repo: z.string().describe(repoDesc),
      state: z.enum(["open", "closed", "all"]).default("open"),
      limit: z.number().int().min(1).max(30).default(10),
    },
    run: (a) => listPullRequests(a),
  },
  {
    name: "github_list_commits",
    write: false,
    description:
      "List recent commits of an allowed GitHub repository, optionally for one file path.",
    shape: {
      repo: z.string().describe(repoDesc),
      path: z.string().optional(),
      limit: z.number().int().min(1).max(30).default(10),
    },
    run: (a) => listCommits(a),
  },
  {
    name: "github_get_file",
    write: false,
    description: "Read a file from an allowed GitHub repository.",
    shape: {
      repo: z.string().describe(repoDesc),
      path: z.string().describe("File path within the repo"),
      ref: z.string().optional().describe("Branch, tag or commit SHA"),
    },
    run: (a) => getFile(a),
  },
];

export const writeToolNames = new Set(
  tools.filter((t) => t.write).map((t) => t.name),
);

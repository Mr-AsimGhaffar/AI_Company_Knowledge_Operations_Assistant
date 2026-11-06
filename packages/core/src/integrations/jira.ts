import { config } from "../config";

const configured = () => Boolean(config.JIRA_SITE_URL && config.JIRA_EMAIL && config.JIRA_API_TOKEN);
export const jiraConfigured = configured;

const origin = () => new URL(config.JIRA_SITE_URL).origin;
const issueUrl = (key: string) => `${origin()}/browse/${key}`;

async function jira<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = Buffer.from(`${config.JIRA_EMAIL}:${config.JIRA_API_TOKEN}`).toString("base64");
  const res = await fetch(`${origin()}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const adf = (text: string) => ({
  type: "doc",
  version: 1,
  content: text
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
});

export async function jiraTest() {
  if (!configured()) return { configured: false, message: "Mock mode: set JIRA_* variables" };
  const me = await jira<{ displayName: string }>("/rest/api/3/myself");
  return { configured: true, message: `Connected as ${me.displayName}` };
}

export async function createIssue(a: {
  summary: string;
  description?: string;
  issueType?: string;
  priority?: string;
}) {
  if (!configured()) {
    return { mock: true, key: `${config.JIRA_PROJECT_KEY || "AL"}-MOCK`, url: "https://example.atlassian.net/browse/MOCK", summary: a.summary };
  }
  const fields: Record<string, unknown> = {
    project: { key: config.JIRA_PROJECT_KEY },
    summary: a.summary,
    issuetype: { name: a.issueType || "Task" },
  };
  if (a.description) fields.description = adf(a.description);
  if (a.priority) fields.priority = { name: a.priority };
  const res = await jira<{ key: string }>("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return { key: res.key, url: issueUrl(res.key), summary: a.summary };
}

export async function searchIssues(a: { text?: string; jql?: string; limit?: number }) {
  const limit = a.limit ?? 10;
  if (!configured()) {
    return { mock: true, issues: [{ key: "AL-1", summary: "Mock issue", status: "To Do" }] };
  }
  const escaped = (a.text ?? "").replace(/["\\]/g, " ");
  const jql =
    a.jql ||
    `project = "${config.JIRA_PROJECT_KEY}"${escaped ? ` AND text ~ "${escaped}"` : ""} ORDER BY created DESC`;
  const res = await jira<{
    issues: { key: string; fields: { summary: string; status?: { name: string }; assignee?: { displayName: string } | null; priority?: { name: string } } }[];
  }>("/rest/api/3/search/jql", {
    method: "POST",
    body: JSON.stringify({ jql, maxResults: limit, fields: ["summary", "status", "assignee", "priority"] }),
  });
  return {
    issues: res.issues.map((i) => ({
      key: i.key,
      url: issueUrl(i.key),
      summary: i.fields.summary,
      status: i.fields.status?.name,
      assignee: i.fields.assignee?.displayName ?? null,
      priority: i.fields.priority?.name,
    })),
  };
}

export async function updateIssueStatus(a: { key: string; status: string }) {
  if (!configured()) return { mock: true, key: a.key, status: a.status };
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(a.key)) throw new Error("Invalid Jira issue key");
  const { transitions } = await jira<{ transitions: { id: string; name: string; to: { name: string } }[] }>(
    `/rest/api/3/issue/${a.key}/transitions`,
  );
  const want = a.status.trim().toLowerCase();
  const t = transitions.find((x) => x.to.name.toLowerCase() === want || x.name.toLowerCase() === want);
  if (!t) {
    throw new Error(`No transition to "${a.status}". Available: ${transitions.map((x) => x.to.name).join(", ")}`);
  }
  await jira(`/rest/api/3/issue/${a.key}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: t.id } }),
  });
  return { key: a.key, status: t.to.name, url: issueUrl(a.key) };
}

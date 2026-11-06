import { config } from "../config";

export const githubConfigured = () => Boolean(config.GITHUB_TOKEN);

export const allowedRepos = (): string[] =>
  config.GITHUB_REPOS.split(",")
    .map((r) => r.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/$/, ""))
    .filter(Boolean);

function resolveRepo(input: string): string {
  const wanted = input.trim().replace(/^https?:\/\/github\.com\//i, "").toLowerCase();
  const match = allowedRepos().find((r) => r.toLowerCase() === wanted || r.split("/")[1]?.toLowerCase() === wanted);
  if (!match) throw new Error(`Repository not allowed. Allowed: ${allowedRepos().join(", ")}`);
  return match;
}

async function gh<T>(path: string, accept = "application/vnd.github+json"): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${config.GITHUB_TOKEN}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "workora",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (accept.includes("raw") ? await res.text() : await res.json()) as T;
}

export async function githubTest() {
  if (!githubConfigured()) return { configured: false, message: "Mock mode: set GITHUB_TOKEN" };
  const me = await gh<{ login: string }>("/user");
  return { configured: true, message: `Connected as ${me.login} (${allowedRepos().length} repos allowed)` };
}

export async function listPullRequests(a: { repo: string; state?: "open" | "closed" | "all"; limit?: number }) {
  const repo = resolveRepo(a.repo);
  if (!githubConfigured()) return { mock: true, repo, pullRequests: [] };
  const prs = await gh<
    { number: number; title: string; state: string; user: { login: string }; html_url: string; updated_at: string }[]
  >(`/repos/${repo}/pulls?state=${a.state ?? "open"}&per_page=${a.limit ?? 10}`);
  return {
    repo,
    pullRequests: prs.map((p) => ({ number: p.number, title: p.title, state: p.state, author: p.user.login, url: p.html_url, updatedAt: p.updated_at })),
  };
}

export async function listCommits(a: { repo: string; path?: string; limit?: number }) {
  const repo = resolveRepo(a.repo);
  if (!githubConfigured()) return { mock: true, repo, commits: [] };
  const q = new URLSearchParams({ per_page: String(a.limit ?? 10) });
  if (a.path) q.set("path", a.path);
  const commits = await gh<
    { sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } } }[]
  >(`/repos/${repo}/commits?${q}`);
  return {
    repo,
    commits: commits.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0],
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
    })),
  };
}

export async function getFile(a: { repo: string; path: string; ref?: string }) {
  const repo = resolveRepo(a.repo);
  if (!githubConfigured()) return { mock: true, repo, path: a.path, content: "" };
  const path = a.path.split("/").map(encodeURIComponent).join("/");
  const q = a.ref ? `?ref=${encodeURIComponent(a.ref)}` : "";
  const text = await gh<string>(`/repos/${repo}/contents/${path}${q}`, "application/vnd.github.raw+json");
  const MAX = 20000;
  return { repo, path: a.path, truncated: text.length > MAX, content: text.slice(0, MAX) };
}

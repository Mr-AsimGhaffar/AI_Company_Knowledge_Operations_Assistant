export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let refreshRequest: Promise<boolean> | null = null;

function refreshSession() {
  if (!refreshRequest) {
    refreshRequest = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

export async function fetchWithAuth(path: string, init: RequestInit = {}) {
  const request = () => fetch(path, { credentials: "same-origin", ...init });
  let res = await request();
  const endpoint = path.split("?")[0];
  if (
    res.status !== 401 ||
    endpoint === "/api/auth/login" ||
    endpoint === "/api/auth/logout" ||
    endpoint === "/api/auth/refresh"
  ) {
    return res;
  }

  if (await refreshSession()) {
    res = await request();
  }
  if (res.status === 401) {
    window.dispatchEvent(new Event("workora:unauthorized"));
  }
  return res;
}

export async function api<T = unknown>(path: string, init: Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetchWithAuth(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export type Role = "ADMIN" | "MANAGER" | "EMPLOYEE";
export type ToolStatus = "PENDING_APPROVAL" | "REJECTED" | "EXECUTED" | "FAILED";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Citation {
  ref: number;
  documentId: string;
  title: string;
  location: string;
}

export interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  isWrite?: boolean;
  error?: string;
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[] | null;
  toolCalls?: ToolCall[];
  streaming?: boolean;
}

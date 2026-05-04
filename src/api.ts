import type {
  AmbientSound,
  AuthUser,
  DashboardState,
  Settings,
  TaskPriority,
  ThemePreference
} from "./types";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

interface StateResponse {
  state: DashboardState;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    body,
    credentials: "include"
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed with ${response.status}`);
  }

  return data as T;
}

export const api = {
  me: () => request<{ user: AuthUser }>("/auth/me"),
  login: (body: { email: string; password: string }) =>
    request<{ user: AuthUser }>("/auth/login", { method: "POST", body }),
  register: (body: { name: string; email: string; password: string }) =>
    request<{ user: AuthUser }>("/auth/register", { method: "POST", body }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  state: () => request<StateResponse>("/state"),
  updateSettings: (
    body: Partial<
      Pick<
        Settings,
        | "focusMinutes"
        | "breakMinutes"
        | "dailyGoalMinutes"
        | "ambientVolume"
      >
    > & {
      theme?: ThemePreference;
      ambientSound?: AmbientSound;
    }
  ) => request<StateResponse>("/settings", { method: "PATCH", body }),
  createTask: (body: {
    title: string;
    priority?: TaskPriority;
    estimatedMinutes?: number;
  }) => request<StateResponse>("/tasks", { method: "POST", body }),
  updateTask: (
    id: string,
    body: Partial<{
      title: string;
      completed: boolean;
      priority: TaskPriority;
      estimatedMinutes: number;
    }>
  ) => request<StateResponse>(`/tasks/${id}`, { method: "PATCH", body }),
  deleteTask: (id: string) => request<StateResponse>(`/tasks/${id}`, { method: "DELETE" }),
  createNote: (body: { title?: string; body?: string; pinned?: boolean }) =>
    request<StateResponse>("/notes", { method: "POST", body }),
  updateNote: (
    id: string,
    body: Partial<{ title: string; body: string; pinned: boolean }>
  ) => request<StateResponse>(`/notes/${id}`, { method: "PATCH", body }),
  deleteNote: (id: string) => request<StateResponse>(`/notes/${id}`, { method: "DELETE" }),
  completeSession: (body: {
    durationMinutes: number;
    taskId?: string;
    intention?: string;
    startedAt?: string;
    completedAt?: string;
  }) => request<StateResponse>("/sessions", { method: "POST", body })
};

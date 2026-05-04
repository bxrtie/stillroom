export type ThemePreference = "system" | "light" | "dark";
export type AmbientSound = "rain" | "cafe" | "noise" | "waves";
export type TaskPriority = "low" | "normal" | "high";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface Settings {
  theme: ThemePreference;
  focusMinutes: number;
  breakMinutes: number;
  dailyGoalMinutes: number;
  ambientSound: AmbientSound;
  ambientVolume: number;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: TaskPriority;
  estimatedMinutes: number;
  createdAt: string;
  completedAt: string | null;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WeekStat {
  date: string;
  minutes: number;
}

export interface Signal {
  level: number;
  charge: number;
  nextLevelMinutes: number;
  dailyPath: boolean[];
  dailyPathLabels: string[];
  title: string;
}

export interface Stats {
  todayMinutes: number;
  dailyGoalMinutes: number;
  totalMinutes: number;
  totalSessions: number;
  streak: number;
  tasksCompletedToday: number;
  openTaskCount: number;
  week: WeekStat[];
}

export interface FocusSession {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  durationMinutes: number;
  intention: string;
  completedAt: string;
}

export interface DashboardState {
  user: AuthUser;
  settings: Settings;
  tasks: Task[];
  notes: Note[];
  stats: Stats;
  signal: Signal;
  sessions: FocusSession[];
}

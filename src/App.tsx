import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Check, Circle, Lock, LogOut, Moon, Pause, Play, Plus, Radio, Sun, Trash2, UserPlus } from "lucide-react";
import { api } from "./api";
import type { AuthUser, DashboardState, Note, Task, TaskPriority, ThemePreference } from "./types";
import "./styles.css";

type AuthMode = "login" | "register";
type TimerMode = "focus" | "break";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

function minutes(value: number) {
  if (value < 60) return `${value}m`;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function timerText(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function AuthScreen({ mode, setMode, onSubmit, error, loading }: {
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  onSubmit: (payload: { name: string; email: string; password: string }) => void;
  error: string | null;
  loading: boolean;
}) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(form);
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand"><span className="mark"><Radio size={20} /></span><div><h1>Stillroom</h1><p>Focus that leaves a signal.</p></div></div>
        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}><Lock size={16} />Sign in</button>
          <button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}><UserPlus size={16} />Create</button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && <label><span>Name</span><input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" required /></label>}
          <label><span>Email</span><input autoComplete="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" required /></label>
          <label><span>Password</span><input autoComplete={mode === "login" ? "current-password" : "new-password"} type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8 characters minimum" required /></label>
          {error && <p className="error">{error}</p>}
          <button className="primary wide" disabled={loading} type="submit">{loading ? "Working" : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
      </section>
    </main>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [state, setState] = useState<DashboardState | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [intention, setIntention] = useState("");
  const [timerMode, setTimerMode] = useState<TimerMode>("focus");
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [message, setMessage] = useState<string | null>(null);

  const settings = state?.settings;
  const activeTask = useMemo(() => {
    if (!state) return null;
    return state.tasks.find((task) => task.id === selectedTaskId && !task.completed) ?? state.tasks.find((task) => !task.completed) ?? null;
  }, [selectedTaskId, state]);

  const applyState = (next: DashboardState) => {
    setState(next);
    setSelectedTaskId((current) => next.tasks.find((task) => task.id === current && !task.completed)?.id ?? next.tasks.find((task) => !task.completed)?.id ?? null);
  };

  const loadState = async () => {
    const result = await api.state();
    applyState(result.state);
  };

  useEffect(() => {
    const boot = async () => {
      try {
        const result = await api.me();
        setUser(result.user);
        await loadState();
      } catch {
        setUser(null);
        setState(null);
      } finally {
        setBooting(false);
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    const preference: ThemePreference = state?.settings.theme ?? "system";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const resolved = preference === "system" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [state?.settings.theme]);

  useEffect(() => {
    if (!settings) return;
    setSecondsLeft((timerMode === "focus" ? settings.focusMinutes : settings.breakMinutes) * 60);
    setRunning(false);
  }, [settings?.focusMinutes, settings?.breakMinutes, timerMode]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (running && secondsLeft === 0) void completeSession();
  }, [running, secondsLeft]);

  const submitAuth = async (payload: { name: string; email: string; password: string }) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const result = authMode === "register" ? await api.register(payload) : await api.login({ email: payload.email, password: payload.password });
      setUser(result.user);
      await loadState();
    } catch (error) {
      setAuthError(errorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
    setState(null);
    setAuthMode("login");
  };

  const updateTheme = async (theme: ThemePreference) => {
    const result = await api.updateSettings({ theme });
    applyState(result.state);
  };

  const addTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    const result = await api.createTask({ title: taskTitle.trim(), priority, estimatedMinutes: settings?.focusMinutes });
    setTaskTitle("");
    setPriority("normal");
    applyState(result.state);
  };

  const updateTask = async (task: Task, patch: Partial<Task>) => {
    const result = await api.updateTask(task.id, patch);
    applyState(result.state);
  };

  const deleteTask = async (task: Task) => {
    const result = await api.deleteTask(task.id);
    applyState(result.state);
  };

  const createNote = async () => {
    const result = await api.createNote({ title: "Untitled", body: "" });
    applyState(result.state);
  };

  const updateLocalNote = (id: string, patch: Partial<Note>) => {
    setState((current) => current ? { ...current, notes: current.notes.map((note) => note.id === id ? { ...note, ...patch } : note) } : current);
  };

  const saveNote = async (note: Note) => {
    await api.updateNote(note.id, { title: note.title, body: note.body, pinned: note.pinned });
  };

  const deleteNote = async (note: Note) => {
    const result = await api.deleteNote(note.id);
    applyState(result.state);
  };

  const completeSession = async () => {
    if (!state || !settings) return;
    setRunning(false);
    if (timerMode === "break") {
      setTimerMode("focus");
      setMessage("Break finished");
      return;
    }
    const result = await api.completeSession({ durationMinutes: settings.focusMinutes, taskId: activeTask?.id, intention, completedAt: new Date().toISOString() });
    applyState(result.state);
    setTimerMode("break");
    setIntention("");
    setMessage("Signal charged");
  };

  if (booting) return <main className="auth-shell"><div className="brand"><span className="mark"><Radio size={20} /></span><h1>Stillroom</h1></div></main>;
  if (!user || !state || !settings) return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={submitAuth} error={authError} loading={authLoading} />;

  const totalSeconds = (timerMode === "focus" ? settings.focusMinutes : settings.breakMinutes) * 60;
  const progress = Math.max(0, Math.min(360, Math.round((1 - secondsLeft / totalSeconds) * 360)));
  const goalProgress = Math.min(100, Math.round((state.stats.todayMinutes / settings.dailyGoalMinutes) * 100));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="mark"><Radio size={20} /></span><div><h1>Stillroom</h1><p>{state.signal.title}</p></div></div>
        <div className="top-actions"><button title="Light" onClick={() => void updateTheme("light")}><Sun size={16} /></button><button title="Dark" onClick={() => void updateTheme("dark")}><Moon size={16} /></button><button onClick={() => void logout()}><LogOut size={16} />Sign out</button></div>
      </header>

      {message && <button className="toast" onClick={() => setMessage(null)}>{message}</button>}

      <section className="hero">
        <div><span>Level {state.signal.level}</span><h2>{activeTask?.title ?? `Set the signal, ${state.user.name}`}</h2><p>{intention || "Choose one reason, run one session, leave a visible trail."}</p></div>
        <div className={running ? "beacon-card live" : "beacon-card"}><div className="rings"><i /><i /><i /></div><div className="beacon" style={{ "--charge": `${state.signal.charge}%` } as CSSProperties}><Radio size={34} /><strong>{state.signal.charge}%</strong></div><div className="path">{state.signal.dailyPath.map((done, i) => <button className={done ? "done" : ""} title={state.signal.dailyPathLabels[i]} key={state.signal.dailyPathLabels[i]}>{i + 1}</button>)}</div></div>
      </section>

      <section className="grid">
        <section className="panel focus-panel">
          <div className="panel-head"><div><span>{timerMode}</span><h2>Focus timer</h2></div><div className="segmented small"><button className={timerMode === "focus" ? "active" : ""} onClick={() => setTimerMode("focus")}>Focus</button><button className={timerMode === "break" ? "active" : ""} onClick={() => setTimerMode("break")}>Break</button></div></div>
          <div className="timer" style={{ "--progress": `${progress}deg` } as CSSProperties}><div><span>{timerMode === "focus" ? "Signal" : "Reset"}</span><strong>{timerText(secondsLeft)}</strong><small>{activeTask?.title ?? "Free focus"}</small></div></div>
          <label className="field"><span>Session reason</span><input value={intention} onChange={(event) => setIntention(event.target.value)} placeholder="What should this session make easier?" maxLength={160} /></label>
          <div className="controls"><button className="primary" onClick={() => setRunning(!running)}>{running ? <Pause size={18} /> : <Play size={18} />}{running ? "Pause" : "Start"}</button><button onClick={() => { setRunning(false); setSecondsLeft(totalSeconds); }}>Reset</button><button title="Complete" onClick={() => void completeSession()}><Check size={18} /></button></div>
        </section>

        <section className="panel tasks-panel"><div className="panel-head"><div><span>{state.stats.openTaskCount} open</span><h2>Tasks</h2></div></div><form className="task-form" onSubmit={addTask}><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Add a task" /><select aria-label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select><button title="Add task"><Plus size={18} /></button></form><div className="list">{state.tasks.length === 0 && <div className="empty">No tasks yet.</div>}{state.tasks.map((task) => <div className={task.completed ? "task completed" : activeTask?.id === task.id ? "task selected" : "task"} key={task.id}><button title={task.completed ? "Mark open" : "Mark done"} onClick={() => void updateTask(task, { completed: !task.completed })}>{task.completed ? <Check size={15} /> : <Circle size={15} />}</button><button disabled={task.completed} onClick={() => setSelectedTaskId(task.id)}><strong>{task.title}</strong><span>{task.priority} / {task.estimatedMinutes}m</span></button><button title="Delete task" onClick={() => void deleteTask(task)}><Trash2 size={15} /></button></div>)}</div></section>

        <aside className="rail"><section className="panel"><div className="panel-head"><div><span>Today</span><h2>{goalProgress}% lit</h2></div></div><div className="metrics"><div className="metric"><span>Today</span><strong>{minutes(state.stats.todayMinutes)}</strong><small>{minutes(settings.dailyGoalMinutes)} target</small></div><div className="metric"><span>Streak</span><strong>{state.stats.streak}</strong><small>days</small></div><div className="metric"><span>Level</span><strong>{state.signal.level}</strong><small>{minutes(state.signal.nextLevelMinutes)} left</small></div><div className="metric"><span>Done</span><strong>{state.stats.tasksCompletedToday}</strong><small>{state.stats.openTaskCount} open</small></div></div></section><section className="panel"><div className="panel-head"><div><span>Sound</span><h2>Ambient</h2></div></div><div className="sound"><button>Rain</button><button>Cafe</button><button>Noise</button><button>Waves</button></div></section></aside>

        <section className="panel notes"><div className="panel-head"><div><span>Scratchpad</span><h2>Notes</h2></div><button title="New note" onClick={() => void createNote()}><Plus size={18} /></button></div><div className="notes-grid">{state.notes.length === 0 && <div className="empty">No notes yet.</div>}{state.notes.map((note) => <article className="note note-card" key={note.id}><div><button title={note.pinned ? "Unpin note" : "Pin note"} onClick={() => { updateLocalNote(note.id, { pinned: !note.pinned }); void saveNote({ ...note, pinned: !note.pinned }); }}>Pin</button><button title="Delete note" onClick={() => void deleteNote(note)}><Trash2 size={15} /></button></div><input className="note-title" aria-label="Note title" value={note.title} onChange={(event) => updateLocalNote(note.id, { title: event.target.value })} onBlur={(event) => void saveNote({ ...note, title: event.currentTarget.value })} /><textarea aria-label="Note body" value={note.body} onChange={(event) => updateLocalNote(note.id, { body: event.target.value })} onBlur={(event) => void saveNote({ ...note, body: event.currentTarget.value })} placeholder="Capture the thread" /></article>)}</div></section>

        <section className="panel trail"><div className="panel-head"><div><span>Trail</span><h2>Recent signals</h2></div></div>{state.sessions.length === 0 && <div className="empty">No signals yet.</div>}{state.sessions.map((session) => <article className="session" key={session.id}><div><strong>{session.intention || session.taskTitle || "Focused work"}</strong><span>{session.taskTitle ?? "Free focus"}</span></div><small>{minutes(session.durationMinutes)}</small></article>)}</section>
      </section>
    </main>
  );
}

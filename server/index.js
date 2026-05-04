import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 4174);
const SESSION_COOKIE = "stillroom_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Europe/Berlin";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "stillroom-development-secret-change-me";
const DATA_FILE = process.env.STILLROOM_DATA_FILE
  ? path.resolve(process.env.STILLROOM_DATA_FILE)
  : path.join(__dirname, "data", "store.json");
const DATA_DIR = path.dirname(DATA_FILE);

const DEFAULT_SETTINGS = {
  theme: "system",
  focusMinutes: 25,
  breakMinutes: 5,
  dailyGoalMinutes: 120,
  ambientSound: "rain",
  ambientVolume: 0.35
};

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    writeStore({
      users: [],
      tasks: [],
      notes: [],
      sessions: [],
      settings: []
    });
  }
}

function normalizeStore(store) {
  return {
    users: Array.isArray(store.users) ? store.users : [],
    tasks: Array.isArray(store.tasks) ? store.tasks : [],
    notes: Array.isArray(store.notes) ? store.notes : [],
    sessions: Array.isArray(store.sessions) ? store.sessions : [],
    settings: Array.isArray(store.settings) ? store.settings : []
  };
}

function readStore() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return normalizeStore(JSON.parse(raw || "{}"));
}

function writeStore(store) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(normalizeStore(store), null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

function transact(callback) {
  const store = readStore();
  const result = callback(store);
  writeStore(store);
  return result;
}

function jsonError(response, status, message) {
  return response.status(status).json({ error: message });
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}

function sanitizeText(value, fallback = "", maxLength = 2000) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+\n/g, "\n").trim();
  return normalized.slice(0, maxLength);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(number)));
}

function clampFloat(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

function verifyPassword(password, user) {
  const incoming = crypto.scryptSync(password, user.salt, 64);
  const stored = Buffer.from(user.passwordHash, "hex");

  return stored.length === incoming.length && crypto.timingSafeEqual(stored, incoming);
}

function hmac(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createSessionToken(userId) {
  const payload = {
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(8).toString("base64url")
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [body, signature] = token.split(".");
  const expected = hmac(body);
  const incoming = Buffer.from(signature || "");
  const stored = Buffer.from(expected);

  if (incoming.length !== stored.length || !crypto.timingSafeEqual(incoming, stored)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.userId || payload.expiresAt < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(response, userId) {
  response.cookie(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: SESSION_TTL_MS,
    path: "/"
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email
  };
}

function getUserSettings(store, userId) {
  let settings = store.settings.find((item) => item.userId === userId);

  if (!settings) {
    settings = { userId, ...DEFAULT_SETTINGS };
    store.settings.push(settings);
  }

  return settings;
}

function dateKey(input) {
  const date = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function computeStats(store, userId, settings) {
  const sessions = store.sessions.filter((session) => session.userId === userId);
  const tasks = store.tasks.filter((task) => task.userId === userId);
  const minutesByDay = new Map();

  for (const session of sessions) {
    const key = dateKey(session.completedAt);
    minutesByDay.set(key, (minutesByDay.get(key) || 0) + session.durationMinutes);
  }

  const now = Date.now();
  const today = dateKey(new Date(now));
  const week = [];

  for (let index = 6; index >= 0; index -= 1) {
    const key = dateKey(new Date(now - index * 24 * 60 * 60 * 1000));
    week.push({ date: key, minutes: minutesByDay.get(key) || 0 });
  }

  let streak = 0;
  const startOffset = (minutesByDay.get(today) || 0) > 0 ? 0 : 1;

  for (let index = startOffset; index < 370; index += 1) {
    const key = dateKey(new Date(now - index * 24 * 60 * 60 * 1000));
    if ((minutesByDay.get(key) || 0) <= 0) {
      break;
    }

    streak += 1;
  }

  return {
    todayMinutes: minutesByDay.get(today) || 0,
    dailyGoalMinutes: settings.dailyGoalMinutes,
    totalMinutes: sessions.reduce((sum, session) => sum + session.durationMinutes, 0),
    totalSessions: sessions.length,
    streak,
    tasksCompletedToday: tasks.filter((task) => task.completedAt && dateKey(task.completedAt) === today)
      .length,
    openTaskCount: tasks.filter((task) => !task.completed).length,
    week
  };
}

function computeSignal(stats, settings) {
  const level = Math.floor(stats.totalMinutes / 180) + 1;
  const minutesIntoLevel = stats.totalMinutes % 180;
  const charge = Math.min(100, Math.round((minutesIntoLevel / 180) * 100));
  const segmentSize = Math.max(1, Math.ceil(settings.dailyGoalMinutes / 6));
  const dailyPath = Array.from({ length: 6 }, (_item, index) => {
    return stats.todayMinutes >= Math.min(settings.dailyGoalMinutes, segmentSize * (index + 1));
  });

  return {
    level,
    charge,
    nextLevelMinutes: Math.max(0, 180 - minutesIntoLevel),
    dailyPath,
    dailyPathLabels: dailyPath.map((_item, index) => `${Math.min(settings.dailyGoalMinutes, segmentSize * (index + 1))}m`),
    title:
      level < 3
        ? "First light"
        : level < 7
          ? "Steady signal"
          : level < 12
            ? "Clear horizon"
            : "Long range"
  };
}

function buildState(store, userId) {
  const user = store.users.find((item) => item.id === userId);
  const settings = getUserSettings(store, userId);
  const stats = computeStats(store, userId, settings);
  const tasks = store.tasks
    .filter((task) => task.userId === userId)
    .sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .map(({ userId: _userId, ...task }) => task);
  const notes = store.notes
    .filter((note) => note.userId === userId)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }

      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .map(({ userId: _userId, ...note }) => note);
  const recentSessions = store.sessions
    .filter((session) => session.userId === userId)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, 8)
    .map((session) => {
      const task = store.tasks.find((item) => item.id === session.taskId);

      return {
        id: session.id,
        taskId: session.taskId || null,
        taskTitle: task?.title || null,
        durationMinutes: session.durationMinutes,
        intention: session.intention || "",
        completedAt: session.completedAt
      };
    });

  return {
    user: publicUser(user),
    settings: {
      theme: settings.theme,
      focusMinutes: settings.focusMinutes,
      breakMinutes: settings.breakMinutes,
      dailyGoalMinutes: settings.dailyGoalMinutes,
      ambientSound: settings.ambientSound,
      ambientVolume: settings.ambientVolume
    },
    tasks,
    notes,
    stats,
    signal: computeSignal(stats, settings),
    sessions: recentSessions
  };
}

function requireUser(request, response, next) {
  const payload = verifySessionToken(request.cookies[SESSION_COOKIE]);
  if (!payload) {
    return jsonError(response, 401, "Sign in required");
  }

  const store = readStore();
  const user = store.users.find((item) => item.id === payload.userId);

  if (!user) {
    response.clearCookie(SESSION_COOKIE, { path: "/" });
    return jsonError(response, 401, "Session expired");
  }

  request.user = user;
  next();
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/auth/register", (request, response) => {
  const name = sanitizeText(request.body.name, "", 80);
  const email = sanitizeText(request.body.email, "", 160).toLowerCase();
  const password = typeof request.body.password === "string" ? request.body.password : "";

  if (!name) {
    return jsonError(response, 400, "Name is required");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError(response, 400, "Enter a valid email");
  }

  if (password.length < 8) {
    return jsonError(response, 400, "Password must be at least 8 characters");
  }

  const user = transact((store) => {
    if (store.users.some((item) => item.email === email)) {
      return null;
    }

    const credentials = hashPassword(password);
    const createdUser = {
      id: uid("usr"),
      name,
      email,
      passwordHash: credentials.hash,
      salt: credentials.salt,
      createdAt: new Date().toISOString()
    };

    store.users.push(createdUser);
    store.settings.push({ userId: createdUser.id, ...DEFAULT_SETTINGS });
    return createdUser;
  });

  if (!user) {
    return jsonError(response, 409, "That email is already registered");
  }

  setSessionCookie(response, user.id);
  return response.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", (request, response) => {
  const email = sanitizeText(request.body.email, "", 160).toLowerCase();
  const password = typeof request.body.password === "string" ? request.body.password : "";
  const store = readStore();
  const user = store.users.find((item) => item.email === email);

  if (!user || !verifyPassword(password, user)) {
    return jsonError(response, 401, "Email or password is incorrect");
  }

  setSessionCookie(response, user.id);
  return response.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (_request, response) => {
  response.clearCookie(SESSION_COOKIE, { path: "/" });
  response.json({ ok: true });
});

app.get("/api/auth/me", requireUser, (request, response) => {
  response.json({ user: publicUser(request.user) });
});

app.get("/api/state", requireUser, (request, response) => {
  const store = readStore();
  response.json({ state: buildState(store, request.user.id) });
});

app.patch("/api/settings", requireUser, (request, response) => {
  const allowedThemes = new Set(["system", "light", "dark"]);
  const allowedSounds = new Set(["rain", "cafe", "noise", "waves"]);

  const state = transact((store) => {
    const settings = getUserSettings(store, request.user.id);

    if (allowedThemes.has(request.body.theme)) {
      settings.theme = request.body.theme;
    }

    if (allowedSounds.has(request.body.ambientSound)) {
      settings.ambientSound = request.body.ambientSound;
    }

    if (request.body.focusMinutes !== undefined) {
      settings.focusMinutes = clampNumber(request.body.focusMinutes, 5, 120, settings.focusMinutes);
    }

    if (request.body.breakMinutes !== undefined) {
      settings.breakMinutes = clampNumber(request.body.breakMinutes, 1, 45, settings.breakMinutes);
    }

    if (request.body.dailyGoalMinutes !== undefined) {
      settings.dailyGoalMinutes = clampNumber(
        request.body.dailyGoalMinutes,
        15,
        600,
        settings.dailyGoalMinutes
      );
    }

    if (request.body.ambientVolume !== undefined) {
      settings.ambientVolume = clampFloat(
        request.body.ambientVolume,
        0,
        1,
        settings.ambientVolume
      );
    }

    return buildState(store, request.user.id);
  });

  response.json({ state });
});

app.post("/api/tasks", requireUser, (request, response) => {
  const title = sanitizeText(request.body.title, "", 140);
  const allowedPriorities = new Set(["low", "normal", "high"]);

  if (!title) {
    return jsonError(response, 400, "Task title is required");
  }

  const state = transact((store) => {
    store.tasks.push({
      id: uid("tsk"),
      userId: request.user.id,
      title,
      completed: false,
      priority: allowedPriorities.has(request.body.priority) ? request.body.priority : "normal",
      estimatedMinutes: clampNumber(request.body.estimatedMinutes, 5, 240, 25),
      createdAt: new Date().toISOString(),
      completedAt: null
    });

    return buildState(store, request.user.id);
  });

  response.status(201).json({ state });
});

app.patch("/api/tasks/:id", requireUser, (request, response) => {
  const allowedPriorities = new Set(["low", "normal", "high"]);
  const state = transact((store) => {
    const task = store.tasks.find(
      (item) => item.id === request.params.id && item.userId === request.user.id
    );

    if (!task) {
      return null;
    }

    if (request.body.title !== undefined) {
      const title = sanitizeText(request.body.title, task.title, 140);
      if (title) {
        task.title = title;
      }
    }

    if (request.body.completed !== undefined) {
      task.completed = Boolean(request.body.completed);
      task.completedAt = task.completed ? new Date().toISOString() : null;
    }

    if (allowedPriorities.has(request.body.priority)) {
      task.priority = request.body.priority;
    }

    if (request.body.estimatedMinutes !== undefined) {
      task.estimatedMinutes = clampNumber(
        request.body.estimatedMinutes,
        5,
        240,
        task.estimatedMinutes
      );
    }

    return buildState(store, request.user.id);
  });

  if (!state) {
    return jsonError(response, 404, "Task not found");
  }

  response.json({ state });
});

app.delete("/api/tasks/:id", requireUser, (request, response) => {
  const state = transact((store) => {
    const before = store.tasks.length;
    store.tasks = store.tasks.filter(
      (task) => !(task.id === request.params.id && task.userId === request.user.id)
    );

    return before === store.tasks.length ? null : buildState(store, request.user.id);
  });

  if (!state) {
    return jsonError(response, 404, "Task not found");
  }

  response.json({ state });
});

app.post("/api/notes", requireUser, (request, response) => {
  const now = new Date().toISOString();
  const state = transact((store) => {
    store.notes.push({
      id: uid("nte"),
      userId: request.user.id,
      title: sanitizeText(request.body.title, "Untitled", 100) || "Untitled",
      body: sanitizeText(request.body.body, "", 8000),
      pinned: Boolean(request.body.pinned),
      createdAt: now,
      updatedAt: now
    });

    return buildState(store, request.user.id);
  });

  response.status(201).json({ state });
});

app.patch("/api/notes/:id", requireUser, (request, response) => {
  const state = transact((store) => {
    const note = store.notes.find(
      (item) => item.id === request.params.id && item.userId === request.user.id
    );

    if (!note) {
      return null;
    }

    if (request.body.title !== undefined) {
      note.title = sanitizeText(request.body.title, "Untitled", 100) || "Untitled";
    }

    if (request.body.body !== undefined) {
      note.body = sanitizeText(request.body.body, "", 8000);
    }

    if (request.body.pinned !== undefined) {
      note.pinned = Boolean(request.body.pinned);
    }

    note.updatedAt = new Date().toISOString();
    return buildState(store, request.user.id);
  });

  if (!state) {
    return jsonError(response, 404, "Note not found");
  }

  response.json({ state });
});

app.delete("/api/notes/:id", requireUser, (request, response) => {
  const state = transact((store) => {
    const before = store.notes.length;
    store.notes = store.notes.filter(
      (note) => !(note.id === request.params.id && note.userId === request.user.id)
    );

    return before === store.notes.length ? null : buildState(store, request.user.id);
  });

  if (!state) {
    return jsonError(response, 404, "Note not found");
  }

  response.json({ state });
});

app.post("/api/sessions", requireUser, (request, response) => {
  const durationMinutes = clampNumber(request.body.durationMinutes, 1, 300, 25);
  const intention = sanitizeText(request.body.intention, "", 160);
  const completedAt = request.body.completedAt ? new Date(request.body.completedAt) : new Date();
  const startedAt = request.body.startedAt ? new Date(request.body.startedAt) : null;

  if (Number.isNaN(completedAt.getTime()) || (startedAt && Number.isNaN(startedAt.getTime()))) {
    return jsonError(response, 400, "Session dates are invalid");
  }

  const state = transact((store) => {
    const task = request.body.taskId
      ? store.tasks.find(
          (item) => item.id === request.body.taskId && item.userId === request.user.id
        )
      : null;

    store.sessions.push({
      id: uid("ses"),
      userId: request.user.id,
      taskId: task?.id || null,
      durationMinutes,
      intention,
      startedAt: startedAt?.toISOString() || null,
      completedAt: completedAt.toISOString()
    });

    return buildState(store, request.user.id);
  });

  response.status(201).json({ state });
});

const distDir = path.join(__dirname, "..", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Stillroom API listening on http://localhost:${PORT}`);
});

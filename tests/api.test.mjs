import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { after, before, test } from "node:test";
import os from "node:os";
import path from "node:path";

const port = 4400 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stillroom-api-"));
const dataFile = path.join(tempDir, "store.json");
let server;
let cookie = "";

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError || new Error("Server did not start");
}

async function request(pathname, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (cookie) {
    headers.set("Cookie", cookie);
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const setCookie = response.headers.get("set-cookie");

  if (setCookie) {
    cookie = setCookie.split(";")[0];
  }

  const payload = await response.json();
  return { response, payload };
}

before(async () => {
  server = spawn(process.execPath, ["server/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_SECRET: "stillroom-api-test-secret",
      STILLROOM_DATA_FILE: dataFile
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await waitForServer();
});

after(() => {
  server?.kill("SIGTERM");
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("auth, focus data, and persistence endpoints work together", async () => {
  let result = await request("/api/state");
  assert.equal(result.response.status, 401);

  result = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Ada",
      email: "ada@example.local",
      password: "password123"
    }
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.user.email, "ada@example.local");
  assert.match(cookie, /^stillroom_session=/);

  result = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Ada Again",
      email: "ada@example.local",
      password: "password123"
    }
  });
  assert.equal(result.response.status, 409);

  result = await request("/api/settings", {
    method: "PATCH",
    body: {
      focusMinutes: 2,
      breakMinutes: 80,
      dailyGoalMinutes: 900,
      ambientVolume: 2,
      theme: "dark",
      ambientSound: "waves"
    }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.state.settings.focusMinutes, 5);
  assert.equal(result.payload.state.settings.breakMinutes, 45);
  assert.equal(result.payload.state.settings.dailyGoalMinutes, 600);
  assert.equal(result.payload.state.settings.ambientVolume, 1);
  assert.equal(result.payload.state.settings.theme, "dark");
  assert.equal(result.payload.state.settings.ambientSound, "waves");

  result = await request("/api/tasks", {
    method: "POST",
    body: {
      title: "Plan focused work",
      priority: "high",
      estimatedMinutes: 30
    }
  });
  assert.equal(result.response.status, 201);
  const task = result.payload.state.tasks[0];
  assert.equal(task.title, "Plan focused work");
  assert.equal(result.payload.state.stats.openTaskCount, 1);

  result = await request(`/api/tasks/${task.id}`, {
    method: "PATCH",
    body: { completed: true }
  });
  assert.equal(result.payload.state.tasks[0].completed, true);
  assert.equal(result.payload.state.stats.tasksCompletedToday, 1);

  result = await request("/api/notes", {
    method: "POST",
    body: {
      title: "Session notes",
      body: "Keep scope narrow.",
      pinned: true
    }
  });
  const note = result.payload.state.notes[0];
  assert.equal(note.pinned, true);

  result = await request(`/api/notes/${note.id}`, {
    method: "PATCH",
    body: {
      title: "Session notes",
      body: "Keep scope narrow. Ship the smallest useful version.",
      pinned: false
    }
  });
  assert.equal(result.payload.state.notes[0].pinned, false);
  assert.match(result.payload.state.notes[0].body, /smallest useful/);

  result = await request("/api/sessions", {
    method: "POST",
    body: {
      durationMinutes: 25,
      taskId: task.id,
      intention: "Move the outline forward",
      completedAt: new Date().toISOString()
    }
  });
  assert.equal(result.payload.state.stats.todayMinutes, 25);
  assert.equal(result.payload.state.stats.totalSessions, 1);
  assert.equal(result.payload.state.stats.streak, 1);
  assert.equal(result.payload.state.signal.level, 1);
  assert.equal(result.payload.state.signal.dailyPath.length, 6);
  assert.equal(typeof result.payload.state.signal.charge, "number");
  assert.equal(result.payload.state.sessions[0].intention, "Move the outline forward");

  result = await request("/api/auth/logout", { method: "POST" });
  assert.equal(result.response.status, 200);
  cookie = "";

  result = await request("/api/auth/me");
  assert.equal(result.response.status, 401);
});

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stillroom-e2e-"));
const dataFile = path.join(dataDir, "store.json");
const viteBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");

const children = [
  spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: "4274",
      SESSION_SECRET: "stillroom-e2e-secret",
      STILLROOM_DATA_FILE: dataFile
    },
    stdio: "inherit"
  }),
  spawn(viteBin, ["--host", "127.0.0.1", "--port", "5176"], {
    cwd: root,
    env: {
      ...process.env,
      API_PORT: "4274",
      WEB_PORT: "5176"
    },
    stdio: "inherit"
  })
];

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});

process.on("exit", shutdown);
setInterval(() => undefined, 1000);

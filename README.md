# Stillroom

Stillroom is a personal focus app built around a signal mechanic: every focus session charges a beacon, lights a daily path, and leaves a short trail of what the session was for.

## Features

- Email/password auth with signed HTTP-only cookies
- Persistent local JSON backend
- Focus and break timer
- Session intention tracking
- Beacon level, daily signal path, streaks, weekly stats, and recent session trail
- Tasks, notes, ambient generated audio, and theme preferences
- Light, dark, and system theme modes

## Stack

- React + Vite
- TypeScript
- Express
- Node test runner
- Playwright

## Run

```bash
npm install
npm run dev
```

App: `http://localhost:5173`

API: `http://localhost:4174`

## Test

```bash
npm run build
npm test
```

## Data

The development data file is stored at `server/data/store.json` and is ignored by git.

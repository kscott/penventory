import { createDbClient } from './client';

// The one real connection the running app actually uses — created once at
// server startup, when this module is first imported by a route. Never
// imported by a vitest test file (unlike client.ts's createDbClient, which
// every test calls directly against its own isolated temp path) — importing
// this module opens a real connection immediately, at whatever DATABASE_URL
// the process happens to have, which is only meaningful for the actual
// running server (dev, preview/e2e with an isolated DATABASE_URL, or prod).
export const { db, sqlite } = createDbClient();

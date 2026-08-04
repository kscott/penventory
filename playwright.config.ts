import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// Isolated per test run — e2e/contract tests hit a real running server
// (src/lib/server/db/instance.ts opens a real connection at startup), so
// DATABASE_URL must point somewhere disposable, never the real dev-default
// ./data/penventory.db.
const dbDir = mkdtempSync(join(tmpdir(), 'penventory-e2e-'));

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		env: { DATABASE_URL: `file:${join(dbDir, 'penventory.db')}` }
	},
	testMatch: '**/*.e2e.{ts,js}'
});

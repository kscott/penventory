import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

// Uses better-sqlite3's native backup() (SQLite's own online backup API,
// WAL-safe) rather than shelling out to the `sqlite3` CLI's `.backup`
// command — project-plan.md's Containerization section names the CLI form,
// but the runtime image deliberately strips npm/corepack/yarn (see the CI-
// hardening ADR) and never installs the sqlite3 CLI either, so shelling out
// would be a runtime dependency nothing in the Dockerfile actually
// guarantees. Same backup guarantee, no subprocess, no extra binary.
export async function backupDatabase(
	sqlite: Database.Database,
	backupDir: string
): Promise<string> {
	mkdirSync(backupDir, { recursive: true });
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupPath = join(backupDir, `backup-${timestamp}.db`);
	await sqlite.backup(backupPath);
	return backupPath;
}

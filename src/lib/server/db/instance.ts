import { createDbClient } from './client';

// Lazy on purpose — SvelteKit's build step statically analyzes every route
// module by importing it (to determine prerendering options), which runs
// any module-scope code during `vite build` itself, not at server start.
// An eager `createDbClient()` here broke the Docker build: it tried to open
// a connection at DATABASE_URL's default path before ./data/ existed in the
// build stage. Deferred to first real call instead, which only ever happens
// once the server is actually running and handling a request.
let client: ReturnType<typeof createDbClient> | undefined;

function getClient() {
	if (!client) client = createDbClient();
	return client;
}

export function getDb() {
	return getClient().db;
}

export function getSqlite() {
	return getClient().sqlite;
}

import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getDb } from '$lib/server/db/instance';
import { parseCatalogImport } from '$lib/server/services/fpc-import';
import {
	findOpenAttemptForContentType,
	listOpenAttempts
} from '$lib/server/services/import-review';
import { IMPORT_CONTENT_TYPES, isActiveImportContentType } from '$lib/shared/import-content-types';
import type { Actions, PageServerLoad } from './$types';

// One row per registry entry for the upload screen — available (no open attempt of that type
// yet), already-open (carries the existing attempt's id so the page can link straight into it
// instead of offering a dead-end upload), or coming-soon (inert).
export const load: PageServerLoad = () => {
	const db = getDb();
	const uploadTypes = IMPORT_CONTENT_TYPES.map((type) => ({
		key: type.key,
		label: type.label,
		status: type.status,
		openAttemptId:
			type.status === 'active' ? (findOpenAttemptForContentType(db, type.key)?.id ?? null) : null
	}));
	return { attempts: listOpenAttempts(db), uploadTypes };
};

export const actions: Actions = {
	upload: async ({ request }) => {
		const formData = await request.formData();
		const file = formData.get('file');
		const contentType = formData.get('contentType');

		if (!(file instanceof File)) return fail(400, { error: 'a file is required' });
		if (typeof contentType !== 'string' || !isActiveImportContentType(contentType)) {
			return fail(400, { error: 'select a valid content type' });
		}

		const db = getDb();
		// Defense-in-depth — the upload screen shouldn't ever offer this combination, since an
		// already-open type renders as a link, not a file input.
		if (findOpenAttemptForContentType(db, contentType)) {
			return fail(409, { error: `an open "${contentType}" attempt already exists` });
		}

		const csv = await file.text();
		let attemptId: number;
		try {
			({ attemptId } = parseCatalogImport(db, { csv, contentType }));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return fail(400, { error: `could not parse the uploaded CSV: ${message}` });
		}

		redirect(303, resolve('/import/[attemptId]', { attemptId: String(attemptId) }));
	}
};

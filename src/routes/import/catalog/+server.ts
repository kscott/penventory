import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/instance';
import { parseCatalogImport } from '$lib/server/services/fpc-import';
import { isActiveImportContentType } from '$lib/shared/import-content-types';
import type { RequestHandler } from './$types';

// Upload + parse only — no reimplementation of Phase 1's service logic, no
// review/decide (step 3) or commit (step 4) here. One file per upload, content
// type indicated explicitly by the caller — see
// docs/adr/2026-08-08-import-is-fpc-specific-for-now-generic-csv-is-future-state.md.
export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const file = formData.get('file');
	const contentType = formData.get('contentType');

	if (!(file instanceof File)) {
		return json({ error: 'a "file" field is required' }, { status: 400 });
	}
	if (typeof contentType !== 'string' || !isActiveImportContentType(contentType)) {
		return json(
			{ error: 'contentType must be one of the active import content types' },
			{
				status: 400
			}
		);
	}

	const csv = await file.text();

	let attemptId: number;
	try {
		({ attemptId } = parseCatalogImport(getDb(), { csv, contentType }));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: `could not parse the uploaded CSV: ${message}` }, { status: 400 });
	}

	return json({ attemptId }, { status: 201 });
};

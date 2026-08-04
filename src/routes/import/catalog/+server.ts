import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/instance';
import { parseCatalogImport } from '$lib/server/services/fpc-import';
import type { RequestHandler } from './$types';

// Upload + parse only — no reimplementation of Phase 1's service logic, no
// review/decide (step 3) or commit (step 4) here. Two named file fields
// rather than filename matching: the actual filename FPC gives its export
// is irrelevant, only which upload slot the browser puts each file in.
export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const pens = formData.get('pens');
	const inks = formData.get('inks');

	if (!(pens instanceof File) || !(inks instanceof File)) {
		return json({ error: 'both "pens" and "inks" CSV files are required' }, { status: 400 });
	}

	const pensCSV = await pens.text();
	const inksCSV = await inks.text();

	let attemptId: number;
	try {
		({ attemptId } = parseCatalogImport(getDb(), { pensCSV, inksCSV }));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: `could not parse the uploaded CSVs: ${message}` }, { status: 400 });
	}

	return json({ attemptId }, { status: 201 });
};

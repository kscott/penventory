import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/instance';
import {
	decideFlaggedItem,
	editFlaggedItem,
	getAttemptReview,
	ItemNotFoundError
} from '$lib/server/services/import-review';
import type { Actions, PageServerLoad } from './$types';

function parseAttemptId(param: string): number {
	const attemptId = Number(param);
	if (!Number.isInteger(attemptId)) error(404, 'not a valid import attempt id');
	return attemptId;
}

export const load: PageServerLoad = ({ params }) => {
	const attemptId = parseAttemptId(params.attemptId);
	const review = getAttemptReview(getDb(), attemptId);
	if (!review) error(404, `import attempt ${attemptId} not found`);
	return review;
};

// Raw CSV fields round-trip as `raw.<column name>` form fields — the set of
// columns varies by entity type (pen vs. ink), so this reconstructs
// row_data.raw from whatever `raw.*` fields the submitted form actually
// carried rather than a fixed field list.
function rawFromFormData(formData: FormData): Record<string, string> {
	const raw: Record<string, string> = {};
	for (const [key, value] of formData.entries()) {
		if (key.startsWith('raw.') && typeof value === 'string') {
			raw[key.slice('raw.'.length)] = value;
		}
	}
	return raw;
}

export const actions: Actions = {
	edit: async ({ request, params }) => {
		const attemptId = parseAttemptId(params.attemptId);
		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));
		if (!Number.isInteger(itemId)) return fail(400, { error: 'missing or invalid itemId' });

		try {
			editFlaggedItem(getDb(), attemptId, itemId, rawFromFormData(formData));
		} catch (err) {
			if (err instanceof ItemNotFoundError) return fail(404, { error: err.message });
			throw err;
		}
	},

	decide: async ({ request, params }) => {
		const attemptId = parseAttemptId(params.attemptId);
		const formData = await request.formData();
		const itemId = Number(formData.get('itemId'));
		if (!Number.isInteger(itemId)) return fail(400, { error: 'missing or invalid itemId' });
		const decision = formData.get('decision');
		if (decision !== 'import' && decision !== 'skip') {
			return fail(400, { error: 'decision must be "import" or "skip"' });
		}

		try {
			decideFlaggedItem(getDb(), attemptId, itemId, decision);
		} catch (err) {
			if (err instanceof ItemNotFoundError) return fail(404, { error: err.message });
			throw err;
		}
	}
};

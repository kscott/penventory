import { text } from '@sveltejs/kit';
import { registry } from '$lib/server/metrics';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const body = await registry.metrics();
	return text(body, {
		headers: { 'Content-Type': registry.contentType }
	});
};

import { json } from '@sveltejs/kit';
import { env } from 'node:process';
import { upstream } from '#lib/server/boatspark.js';
import { normalizeCurrent, normalizeHistory } from '#lib/server/normalize.js';
import { configuredTrmnlToken } from '#lib/server/trmnl-auth.js';
import { trmnlStore } from '#lib/server/trmnl-store.js';

export async function GET() {
	const request = configuredTrmnlToken(env.TRMNL_API_TOKEN) ? trmnlStore.begin() : null;
	const [current, history] = await Promise.all([
		upstream('current', normalizeCurrent),
		upstream('history', normalizeHistory)
	]);
	const response = { current, history, refreshedAt: Date.now() };
	if (request !== null) trmnlStore.record(request, response);
	return json(response, { headers: { 'Cache-Control': 'no-store' } });
}

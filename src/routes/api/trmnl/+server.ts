import { env } from 'node:process';
import { json } from '@sveltejs/kit';
import { upstream } from '#lib/server/boatspark.js';
import { normalizeCurrent, normalizeHistory } from '#lib/server/normalize.js';
import { authorizedTrmnl, configuredTrmnlToken } from '#lib/server/trmnl-auth.js';
import { trmnlStore } from '#lib/server/trmnl-store.js';
import { screenData } from '#lib/trmnl/data.js';
import type { RequestHandler } from './$types';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

export const GET: RequestHandler = async ({ request }) => {
	const token = env.TRMNL_API_TOKEN;
	if (!configuredTrmnlToken(token))
		return json({ error: 'TRMNL integration is not configured' }, { status: 503, headers });
	if (!authorizedTrmnl(request.headers.get('authorization'), token))
		return json(
			{ error: 'Unauthorized' },
			{ status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' } }
		);

	const id = trmnlStore.begin();
	const [current, history] = await Promise.all([
		upstream('current', normalizeCurrent, fetch, 7_000),
		upstream('history', normalizeHistory, fetch, 7_000)
	]);
	trmnlStore.record(id, { current, history, refreshedAt: Date.now() });
	const snapshot = trmnlStore.snapshot();
	return json(
		screenData(snapshot.response, snapshot.response.refreshedAt, {
			mode: 'live',
			loadedAt: snapshot.loadedAt,
			observations: snapshot.observations
		}),
		{ headers }
	);
};

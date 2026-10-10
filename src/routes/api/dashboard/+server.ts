import { json } from '@sveltejs/kit';
import { upstream } from '#lib/server/boatspark.js';
import { normalizeCurrent, normalizeHistory } from '#lib/server/normalize.js';

export async function GET() {
	const [current, history] = await Promise.all([
		upstream('current', normalizeCurrent),
		upstream('history', normalizeHistory)
	]);
	return json(
		{ current, history, refreshedAt: Date.now() },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
}

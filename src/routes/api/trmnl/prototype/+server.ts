import { json } from '@sveltejs/kit';
import { prototypeData, scenarioFrom } from '#lib/server/trmnl-prototype.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const scenario = scenarioFrom(url);
	if (!scenario) return json({ error: 'Unknown prototype scenario' }, { status: 400 });
	return json(prototypeData(scenario), { headers: { 'Cache-Control': 'no-store' } });
};

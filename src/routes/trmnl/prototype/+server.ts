import { Liquid } from 'liquidjs';
import template from '#lib/trmnl/screen.liquid?raw';
import { prototypeData, scenarioFrom } from '#lib/server/trmnl-prototype.js';
import type { RequestHandler } from './$types';

const liquid = new Liquid({ strictVariables: true, strictFilters: true });
const parsed = liquid.parse(template);

export const GET: RequestHandler = async ({ url }) => {
	const scenario = scenarioFrom(url);
	if (!scenario) return new Response('Unknown prototype scenario', { status: 400 });
	const markup = await liquid.render(parsed, prototypeData(scenario));
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=800"><title>Boat Spark TRMNL prototype</title><style>html,body{margin:0;padding:0;background:#fff;color:#000}</style></head><body>${markup}</body></html>`,
		{
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'no-store',
				'Content-Security-Policy':
					"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
			}
		}
	);
};

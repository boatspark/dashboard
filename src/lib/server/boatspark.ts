import { env } from 'node:process';
import type { Result } from '#lib/data.js';

export function configuredBase(value: string | undefined): string {
	if (!value) throw new Error('BOATSPARK_BASE_URL is not configured');
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('BOATSPARK_BASE_URL is invalid');
	}
	if (
		url.origin !== 'https://web.boatspark.com' ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!/^\/api\/shared\/boats\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
	)
		throw new Error('BOATSPARK_BASE_URL is invalid');
	return url.href.replace(/\/$/, '');
}

export async function upstream<T>(
	resource: 'current' | 'history',
	normalize: (value: unknown) => T,
	fetcher: typeof fetch = fetch
): Promise<Result<T>> {
	let base: string;
	try {
		base = configuredBase(env.BOATSPARK_BASE_URL);
	} catch {
		console.error('Boat Spark runtime configuration is missing or invalid');
		return { data: null, error: 'Dashboard data source is not configured correctly' };
	}
	try {
		const response = await fetcher(`${base}/${resource}`, {
			headers: { Accept: 'application/json' },
			redirect: 'error',
			signal: AbortSignal.timeout(15_000),
			cache: 'no-store'
		});
		if (!response.ok) {
			console.error(`Boat Spark ${resource} request failed (HTTP ${response.status})`);
			return {
				data: null,
				error: `${resource === 'current' ? 'Current' : 'History'} data request failed`
			};
		}
		return { data: normalize(await response.json()), error: null };
	} catch {
		console.error(`Boat Spark ${resource} data is unreachable or invalid`);
		return {
			data: null,
			error: `${resource === 'current' ? 'Current' : 'History'} data is unreachable or invalid`
		};
	}
}

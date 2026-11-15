import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedTrmnl, configuredTrmnlToken } from './trmnl-auth';

const testToken = 'x'.repeat(64);
const fakeBase = 'https://web.boatspark.com/api/shared/boats/synthetic-test';

function rawData(now: number, cycle = 12) {
	const at = (time: number) => new Date(time).toISOString();
	const gpio = (time: number, count: number) => ({
		published_at: at(time),
		stale: false,
		values: {
			battery1_voltage: 1389,
			battery2_voltage: 1230,
			shore_power_status: 1,
			bilge_pump_status: 0,
			bilge_pump_cycle: count
		}
	});
	const beacon = (name: string, time: number, temperature: number) => ({
		beacon_name: name,
		published_at: at(time),
		stale: false,
		values: { temperature }
	});
	const end = now - 60_000;
	const start = now - 48 * 3_600_000;
	const names = [
		['Galley', 1100],
		['Fridge', 450],
		['Engine', 1067]
	] as const;
	return {
		current: {
			gpio: gpio(end, cycle),
			beacons: names.map(([name, temperature]) => beacon(name, end, temperature))
		},
		history: {
			window_start: at(start),
			window_end: at(end),
			interval_minutes: 15,
			gpio: [gpio(start + 900_000, 10), gpio(end, cycle)],
			beacons: names.map(([name, temperature]) => ({
				beacon_name: name,
				readings: [beacon(name, start + 900_000, temperature), beacon(name, end, temperature)]
			}))
		}
	};
}

describe('TRMNL authorization', () => {
	it('requires a long printable configured token and compares bearer credentials exactly', () => {
		expect(configuredTrmnlToken(undefined)).toBe(false);
		expect(configuredTrmnlToken('short')).toBe(false);
		expect(configuredTrmnlToken(`${testToken}\n`)).toBe(false);
		expect(configuredTrmnlToken(testToken)).toBe(true);
		expect(authorizedTrmnl(null, testToken)).toBe(false);
		expect(authorizedTrmnl(`Basic ${testToken}`, testToken)).toBe(false);
		expect(authorizedTrmnl(`Bearer ${'y'.repeat(64)}`, testToken)).toBe(false);
		expect(authorizedTrmnl(`Bearer ${testToken}extra`, testToken)).toBe(false);
		expect(authorizedTrmnl(`bearer ${testToken}`, testToken)).toBe(true);
	});
});

describe('live TRMNL endpoint', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv('BOATSPARK_BASE_URL', fakeBase);
		vi.stubEnv('TRMNL_API_TOKEN', testToken);
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('fails closed without a configured token or valid authorization and never fetches upstream', async () => {
		const fetcher = vi.fn<typeof fetch>();
		vi.stubGlobal('fetch', fetcher);
		const { GET } = await import('../../routes/api/trmnl/+server');
		const request = (header?: string) =>
			GET({
				request: new Request('https://dashboard.test/api/trmnl', {
					headers: header ? { Authorization: header } : {}
				})
			} as Parameters<typeof GET>[0]);
		vi.stubEnv('TRMNL_API_TOKEN', '');
		expect((await request(`Bearer ${testToken}`)).status).toBe(503);
		vi.stubEnv('TRMNL_API_TOKEN', 'weak');
		expect((await request(`Bearer ${testToken}`)).status).toBe(503);
		vi.stubEnv('TRMNL_API_TOKEN', testToken);
		const missing = await request();
		expect(missing.status).toBe(401);
		expect(missing.headers.get('www-authenticate')).toBe('Bearer');
		expect(missing.headers.get('cache-control')).toBe('private, no-store');
		expect((await request(`Bearer ${'y'.repeat(64)}`)).status).toBe(401);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('normalizes real-shaped data, preserves the dashboard API, and retains stale data on failure', async () => {
		let raw = rawData(Date.now());
		let failing = false;
		const fetcher = vi.fn<typeof fetch>(async (input) => {
			if (failing) return new Response('unavailable', { status: 503 });
			return Response.json(String(input).endsWith('/current') ? raw.current : raw.history);
		});
		vi.stubGlobal('fetch', fetcher);
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		const { GET: dashboard } = await import('../../routes/api/dashboard/+server');
		const { GET: trmnl } = await import('../../routes/api/trmnl/+server');
		const request = () =>
			trmnl({
				request: new Request('https://dashboard.test/api/trmnl', {
					headers: { Authorization: `Bearer ${testToken}` }
				})
			} as Parameters<typeof trmnl>[0]);

		const dashboardData = await (await dashboard()).json();
		expect(dashboardData.current.data.battery1.value).toBe(13.89);
		expect(dashboardData.current.data.engine.value).toBeCloseTo(51.206);
		expect(dashboardData.current.error).toBeNull();
		expect(Object.keys(dashboardData).sort()).toEqual(['current', 'history', 'refreshedAt']);

		let response = await request();
		let data = await response.json();
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('vary')).toBe('Authorization');
		expect(data.screenLabel).toBe('BOAT MONITOR');
		expect(data.banner).toBe('BOAT DATA · PERIODIC SNAPSHOT');
		expect(
			data.batteries.map((tile: { value: string; status: string }) => [tile.value, tile.status])
		).toEqual([
			['13.89', 'GOOD'],
			['12.30', 'CAUTION']
		]);
		expect(data.temperatures[2].value).toBe('51.2');
		expect(data.statuses.map((tile: { value: string }) => tile.value)).toEqual(['ON', 'OFF']);
		expect(data.cycles.value).toBe('2');
		expect(JSON.stringify(data)).not.toContain(testToken);
		expect(JSON.stringify(data)).not.toContain(fakeBase);
		expect(timeout).toHaveBeenCalledWith(7_000);

		raw = rawData(Date.now() + 60_000, 13);
		await dashboard();
		failing = true;
		response = await request();
		data = await response.json();
		expect(response.status).toBe(200);
		expect(data.banner).toContain('CURRENT DATA STALE');
		expect(data.banner).toContain('HISTORY STALE');
		expect(data.batteries[0]).toMatchObject({ value: '13.89', status: 'STALE' });
		expect(data.batteries[0].chart.segments.length).toBeGreaterThan(0);
		expect(data.cycles.value).toBe('3');
	});

	it('returns an unavailable screen when upstream requests time out', async () => {
		const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
		const timeout = vi
			.spyOn(AbortSignal, 'timeout')
			.mockImplementation((milliseconds) =>
				originalTimeout(milliseconds === 7_000 ? 25 : milliseconds)
			);
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>(
				(_input, init) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => reject(new Error('timed out')), {
							once: true
						});
					})
			)
		);
		const { GET } = await import('../../routes/api/trmnl/+server');
		const response = await GET({
			request: new Request('https://dashboard.test/api/trmnl', {
				headers: { Authorization: `Bearer ${testToken}` }
			})
		} as Parameters<typeof GET>[0]);
		const data = await response.json();
		expect(timeout).toHaveBeenCalledWith(7_000);
		expect(response.status).toBe(200);
		expect(data.banner).toContain('CURRENT UNAVAILABLE');
		expect(data.banner).toContain('HISTORY UNAVAILABLE');
		expect(data.batteries[0].value).toBe('--');
	});

	it('honors upstream stale flags without changing otherwise valid values', async () => {
		const raw = rawData(Date.now());
		raw.current.gpio.stale = true;
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>(async (input) =>
				Response.json(String(input).endsWith('/current') ? raw.current : raw.history)
			)
		);
		const { GET } = await import('../../routes/api/trmnl/+server');
		const response = await GET({
			request: new Request('https://dashboard.test/api/trmnl', {
				headers: { Authorization: `Bearer ${testToken}` }
			})
		} as Parameters<typeof GET>[0]);
		const data = await response.json();
		expect(data.banner).toContain('STALE');
		expect(data.batteries[0]).toMatchObject({ value: '13.89', status: 'STALE', alert: true });
		expect(data.statuses[0]).toMatchObject({ value: 'ON', note: 'STALE', alert: true });
		expect(data.temperatures[0].status).toBe('');
	});
});

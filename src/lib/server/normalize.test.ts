import { describe, expect, it, vi, afterEach } from 'vitest';
import { normalizeCurrent, normalizeHistory } from './normalize';
import { configuredBase, upstream } from './boatspark';

const at = '2026-01-01T00:00:00Z';
const gpio = {
	published_at: at,
	stale: false,
	values: {
		battery1_voltage: 1389,
		battery2_voltage: 1382,
		shore_power_status: 1,
		bilge_pump_status: 0,
		bilge_pump_cycle: 12
	}
};
const beacon = {
	beacon_name: 'Engine',
	published_at: at,
	stale: false,
	values: { temperature: 1067 }
};

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('normalization', () => {
	it('converts hundredths of volts and Celsius and selects named beacons', () => {
		const data = normalizeCurrent({ gpio, beacons: [beacon] });
		expect(data.battery1.value).toBe(13.89);
		expect(data.engine.value).toBeCloseTo(51.206);
		expect(data.galley.value).toBeNull();
		expect(data.bilge.value).toBe(0);
		expect(data.cycles.value).toBe(12);
	});
	it('does not invent valid values or healthy status from invalid input', () => {
		const data = normalizeCurrent({
			gpio: {
				...gpio,
				values: { battery1_voltage: '1389', shore_power_status: 2, bilge_pump_cycle: -1 }
			},
			beacons: []
		});
		expect(data.battery1.value).toBeNull();
		expect(data.shore.value).toBeNull();
		expect(data.cycles.value).toBeNull();
		expect(
			normalizeCurrent({ gpio: { ...gpio, published_at: 'invalid' }, beacons: [] }).battery1.value
		).toBeNull();
		expect(normalizeCurrent({ gpio: { ...gpio, stale: true }, beacons: [] }).battery1.stale).toBe(
			true
		);
	});
	it('normalizes history and preserves null gaps without fixed counts', () => {
		const history = normalizeHistory({
			window_start: at,
			window_end: '2026-01-03T00:00:00Z',
			interval_minutes: 15,
			gpio: [gpio],
			beacons: [
				{
					beacon_name: 'Engine',
					readings: [beacon, { published_at: '2026-01-01T00:15:00Z', values: {} }]
				}
			]
		});
		expect(history.interval).toBe(900_000);
		expect(history.battery1).toHaveLength(1);
		expect(history.engine[1].value).toBeNull();
	});
	it('rejects invalid response structures', () => {
		expect(() => normalizeCurrent({})).toThrow('Invalid current');
		expect(() => normalizeHistory({})).toThrow('Invalid history');
	});
});

describe('private upstream requests', () => {
	it('restricts the configured base origin and path and forbids URL extras', () => {
		expect(configuredBase('https://web.boatspark.com/api/shared/boats/synthetic-test/')).toBe(
			'https://web.boatspark.com/api/shared/boats/synthetic-test'
		);
		for (const value of [
			undefined,
			'invalid',
			'http://web.boatspark.com/api/shared/boats/test',
			'https://evil.example/api/shared/boats/test',
			'https://web.boatspark.com/api/shared/boats/test/current',
			'https://web.boatspark.com/api/shared/boats/test?token=secret'
		]) {
			expect(() => configuredBase(value)).toThrow();
		}
	});
	it('redacts configuration and upstream failures', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubEnv('BOATSPARK_BASE_URL', '');
		expect((await upstream('current', normalizeCurrent)).error).toContain('configured');
		vi.stubEnv('BOATSPARK_BASE_URL', 'https://web.boatspark.com/api/shared/boats/synthetic-test');
		const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret upstream URL'));
		const result = await upstream('current', normalizeCurrent, fetcher);
		expect(result.data).toBeNull();
		expect(result.error).not.toContain('secret upstream URL');
		expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
		expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
	});
	it('returns normalized data and explicitly reports invalid JSON or HTTP failures', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubEnv('BOATSPARK_BASE_URL', 'https://web.boatspark.com/api/shared/boats/synthetic-test');
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json({ gpio, beacons: [beacon] }));
		expect((await upstream('current', normalizeCurrent, fetcher)).data?.battery1.value).toBe(13.89);
		fetcher.mockResolvedValue(new Response('unavailable', { status: 503 }));
		expect((await upstream('history', normalizeHistory, fetcher)).error).toContain('failed');
		fetcher.mockResolvedValue(Response.json({ invalid: true }));
		expect((await upstream('current', normalizeCurrent, fetcher)).error).toContain('invalid');
	});
});

import { describe, expect, it } from 'vitest';
import { Liquid } from 'liquidjs';
import template from './screen.liquid?raw';
import { chart, screenData } from './data';
import {
	prototypeData,
	prototypeResponse,
	scenarioFrom,
	scenarios
} from '#lib/server/trmnl-prototype.js';
import { HOUR } from '#lib/data.js';

const now = Date.parse('2026-11-15T20:00:00Z');

describe('TRMNL prototype presentation', () => {
	it('uses existing units, voltage thresholds, shared scales and observed-cycle calculation', () => {
		const data = prototypeData('low-voltage', now);
		expect(data.batteries.map((tile) => [tile.value, tile.status, tile.alert])).toEqual([
			['12.10', 'LOW', true],
			['12.50', 'CAUTION', true]
		]);
		expect(data.batteries[0].chart.note).toBe('Outside chart range');
		expect(data.statuses.map((tile) => [tile.value, tile.alert])).toEqual([
			['OFF', true],
			['ON', true]
		]);
		expect(data.temperatures.map((tile) => [tile.chart.top, tile.chart.bottom])).toEqual([
			['70', '30'],
			['70', '30'],
			['70', '30']
		]);
		expect(data.cycles).toEqual({ value: '8', note: 'Sampled counter', alert: false });
		expect(data.snapshot).toContain('PST');
	});

	it('retains stale fixture readings, labels them and stops history at the last measurement', () => {
		const data = prototypeData('stale', now);
		expect(data.banner).toBe('NO VALID MEASUREMENT FOR 12 HOURS');
		expect(data.batteries[0].value).not.toBe('--');
		expect(data.batteries[0].status).toBe('NO DATA 12H');
		expect(data.batteries[0].measured).toContain('11:00 PM PST');
		const history = prototypeResponse('stale', now).history.data!;
		expect(history.battery1.at(-1)!.at).toBeLessThanOrEqual(now - 13 * HOUR);
	});

	it('never turns unavailable readings or insufficient cycle history into healthy values or zero', () => {
		const unavailable = prototypeData('unavailable', now);
		expect(unavailable.statuses[0]).toMatchObject({
			value: '--',
			note: 'UNAVAILABLE',
			alert: true
		});
		expect(unavailable.temperatures[1]).toMatchObject({
			value: '--',
			status: 'UNAVAILABLE',
			alert: true
		});
		const missing = prototypeData('missing-history', now);
		expect(missing.temperatures[0].chart.note).toBe('No valid history');
		expect(missing.batteries[0].chart.segments).toHaveLength(2);
		expect(missing.temperatures[1].chart.segments).toHaveLength(2);
		expect(missing.cycles).toMatchObject({ value: '--', alert: true });
	});

	it('flags sampled-counter resets as incomplete without counting on/off transitions', () => {
		expect(prototypeData('counter-reset', now).cycles).toEqual({
			value: '7',
			note: 'INCOMPLETE COVERAGE',
			alert: true
		});
	});

	it('breaks lines at null readings and gaps, clips overflow, and ignores points outside the window', () => {
		const result = chart(
			[
				{ at: -1, value: 13 },
				{ at: 0, value: 10 },
				{ at: 1, value: 13 },
				{ at: 2, value: null },
				{ at: 3, value: 16 },
				{ at: 9, value: 12 },
				{ at: 10, value: 13 },
				{ at: 11, value: 12 }
			],
			0,
			10,
			1,
			[11, 15]
		);
		expect(result.segments).toEqual([
			'M32.0,65.0 L58.4,36.0',
			'M111.2,7.0 L111.2,7.0',
			'M269.6,50.5 L296.0,36.0'
		]);
		expect(result.note).toBe('Outside chart range');
	});

	it('renders every scenario using the actual upload template and escapes presentation text', async () => {
		const liquid = new Liquid({ strictVariables: true, strictFilters: true });
		for (const scenario of scenarios) {
			const markup = await liquid.parseAndRender(template, prototypeData(scenario, now));
			expect(markup).toContain('SYNTHETIC PROTOTYPE');
			expect(markup).not.toContain('{{');
			expect(markup.match(/class="boat-chart"/g)).toHaveLength(5);
		}
		const data = screenData(prototypeResponse('normal', now), now, {
			mode: 'prototype',
			scenario: '<script>bad()</script>'
		});
		const markup = await liquid.parseAndRender(template, data);
		expect(markup).toContain('&lt;script&gt;bad()&lt;/script&gt;');
		expect(markup).not.toContain('<script>');
	});

	it('renders real data without synthetic labels and distinguishes stale from missing history', async () => {
		const response = prototypeResponse('normal', now);
		const live = () => screenData(response, now, { mode: 'live', loadedAt: now, observations: [] });
		const data = live();
		expect(data.screenLabel).toBe('BOAT MONITOR');
		expect(data.banner).toBe('BOAT DATA · PERIODIC SNAPSHOT');
		expect(data.batteries[0].value).toBe('12.97');
		const markup = await new Liquid().parseAndRender(template, data);
		expect(markup).toContain('BOAT MONITOR');
		expect(markup).not.toContain('SYNTHETIC');
		expect(Buffer.byteLength(JSON.stringify(data))).toBeLessThan(100_000);
		response.history.error = 'History data request failed';
		expect(live().banner).toContain('HISTORY STALE');
		response.history.data = null;
		expect(live().banner).toContain('HISTORY UNAVAILABLE');
	});

	it('accepts only named scenarios', () => {
		expect(scenarioFrom(new URL('https://example.com'))).toBe('normal');
		expect(scenarioFrom(new URL('https://example.com?scenario=counter-reset'))).toBe(
			'counter-reset'
		);
		expect(scenarioFrom(new URL('https://example.com?scenario=anything'))).toBeNull();
	});
});

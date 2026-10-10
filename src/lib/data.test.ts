import { describe, expect, it } from 'vitest';
import {
	displayValue,
	emptyCurrent,
	freshness,
	HOUR,
	mergeCurrent,
	observedCycles,
	pacificTime,
	retainObservations,
	sortedPoints,
	temperatureBounds,
	voltageTone,
	type History
} from './data';

describe('current display', () => {
	it.each([
		[null, 'neutral'],
		[12.24, 'bad'],
		[12.25, 'amber'],
		[12.75, 'amber'],
		[12.76, 'good']
	])('colors voltage %s correctly', (value, tone) => {
		expect(voltageTone(value as number | null)).toBe(tone);
	});
	it('uses requested precision and explicit missing/status displays', () => {
		expect(displayValue('battery1', 13.8)).toBe('13.80');
		expect(displayValue('galley', 51.214)).toBe('51.2');
		expect(displayValue('bilge', 0)).toBe('Off');
		expect(displayValue('shore', 1)).toBe('On');
		expect(displayValue('fridge', null)).toBe('--');
	});
	it('retains last valid values on missing or older observations', () => {
		const prior = emptyCurrent();
		prior.battery1 = { value: 13.8, at: 2000, stale: false };
		expect(mergeCurrent(prior, emptyCurrent()).battery1).toEqual({
			value: 13.8,
			at: 2000,
			stale: true
		});
		const older = emptyCurrent();
		older.battery1 = { value: 12, at: 1000, stale: false };
		expect(mergeCurrent(prior, older).battery1.value).toBe(13.8);
	});
	it('marks stale data and warns at 12 hours, including initial absence', () => {
		const metric = { value: 13, at: 0, stale: false };
		expect(freshness(metric, HOUR, 0, false)).toBe('');
		expect(freshness(metric, HOUR, 0, true)).toBe('Stale');
		expect(freshness({ ...metric, stale: true }, HOUR, 0, false)).toBe('Stale');
		expect(freshness(metric, 12 * HOUR, 0, false)).toContain('12 hours');
		expect(freshness(emptyCurrent().galley, 12 * HOUR, 0, false)).toContain('12 hours');
	});
	it('uses Pacific timezone with daylight saving', () => {
		expect(pacificTime(Date.parse('2026-07-01T19:00:00Z'))).toContain('12:00 PM PDT');
		expect(pacificTime(Date.parse('2026-01-01T20:00:00Z'))).toContain('12:00 PM PST');
		expect(pacificTime(null)).toBe('--');
	});
});

describe('history and observed cycles', () => {
	const series = (values: (number | null)[]) =>
		values.map((value, index) => ({ at: index * 1000, value }));
	it('sorts and deduplicates current/history timestamps', () => {
		expect(
			sortedPoints([
				{ at: 2, value: 1 },
				{ at: 1, value: 0 },
				{ at: 2, value: 2 }
			])
		).toEqual([
			{ at: 1, value: 0 },
			{ at: 2, value: 2 }
		]);
	});
	it('sums increases rather than treating first counter as baseline zero', () => {
		expect(observedCycles(series([10, 12, 15]), 0, 2000, 1000)).toEqual({
			value: 5,
			incomplete: false
		});
	});
	it('counts observed post-reset cycles and marks resets incomplete', () => {
		expect(observedCycles(series([10, 12, 1, 3, 0, 2]), 0, 5000, 1000)).toEqual({
			value: 7,
			incomplete: true
		});
	});
	it('does not count a delta across an ambiguous rolling-window boundary', () => {
		expect(observedCycles(series([10, 12, 15]), 500, 2000, 1000)).toEqual({
			value: 3,
			incomplete: true
		});
	});
	it('reports insufficient observations as unavailable, not zero', () => {
		expect(observedCycles(series([10]), 0, 2000, 1000).value).toBeNull();
		expect(observedCycles(series([null, null]), 0, 2000, 1000).value).toBeNull();
	});
	it('flags missing readings and gaps while summing only observed counter changes', () => {
		expect(observedCycles(series([10, null, 15]), 0, 2000, 1000)).toEqual({
			value: 5,
			incomplete: true
		});
		expect(
			observedCycles(
				[
					{ at: 0, value: 10 },
					{ at: 4000, value: 12 }
				],
				0,
				4000,
				1000
			)
		).toEqual({ value: 2, incomplete: true });
	});
	it('cannot infer an invisible reset; only reports observed increase', () => {
		expect(observedCycles(series([10, 12]), 0, 1000, 1000).value).toBe(2);
	});
	it('keeps only one predecessor while expiring browser observations', () => {
		expect(retainObservations(series([1, 2, 3, 4]), 2500)).toEqual([
			{ at: 2000, value: 3 },
			{ at: 3000, value: 4 }
		]);
	});
	it('gives all temperature charts padded common bounds and handles constant or absent readings', () => {
		const history: History = {
			start: 0,
			end: 2000,
			interval: 1000,
			battery1: [],
			battery2: [],
			cycles: [],
			galley: series([50, 55]),
			fridge: series([40, null]),
			engine: series([60, 80])
		};
		expect(temperatureBounds(history, 0, 2000)).toEqual([35, 85]);
		expect(
			temperatureBounds({ ...history, galley: series([50]), fridge: [], engine: [] }, 0, 2000)
		).toEqual([45, 55]);
		expect(temperatureBounds(null, 0, 2000)).toBeNull();
		expect(temperatureBounds(history, 3000, 4000)).toBeNull();
	});
});

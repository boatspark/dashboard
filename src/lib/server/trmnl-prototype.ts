import {
	HOUR,
	WINDOW,
	type Current,
	type DashboardResponse,
	type History,
	type Metric,
	type Point
} from '#lib/data.js';
import { screenData } from '#lib/trmnl/data.js';

export const scenarios = [
	'normal',
	'low-voltage',
	'stale',
	'missing-history',
	'counter-reset',
	'unavailable'
] as const;
export type Scenario = (typeof scenarios)[number];

export function scenarioFrom(url: URL): Scenario | null {
	const value = url.searchParams.get('scenario') ?? 'normal';
	return scenarios.find((scenario) => scenario === value) ?? null;
}

export function prototypeResponse(scenario: Scenario, now: number): DashboardResponse {
	const end = now - 2 * 60_000;
	const start = now - WINDOW;
	const series = (value: (index: number) => number): Point[] =>
		Array.from({ length: 193 }, (_, index) => ({
			at: start + ((end - start) * index) / 192,
			value: value(index)
		}));
	const history: History = {
		start,
		end,
		interval: 900_000,
		battery1: series((i) => 13.35 + 0.4 * Math.sin(i / 17) - (i > 80 && i < 105 ? 0.9 : 0)),
		battery2: series((i) => 13.15 + 0.3 * Math.cos(i / 23)),
		galley: series((i) => 55 + 8 * Math.sin(i / 29)),
		fridge: series((i) => 39 + 3 * Math.sin(i / 7)),
		engine: series((i) => 58 + 6 * Math.cos(i / 31)),
		cycles: series((i) => 100 + Math.floor(i / 24))
	};
	const metric = (points: Point[], at = end): Metric => ({
		value: points.at(-1)?.value ?? null,
		at,
		stale: false
	});
	const current: Current = {
		battery1: metric(history.battery1),
		battery2: metric(history.battery2),
		galley: metric(history.galley, now - 5 * 60_000),
		fridge: metric(history.fridge, now - 5 * 60_000),
		engine: metric(history.engine, now - 5 * 60_000),
		shore: { value: 1, at: end, stale: false },
		bilge: { value: 0, at: end, stale: false },
		cycles: metric(history.cycles)
	};
	const response: DashboardResponse = {
		current: { data: current, error: null },
		history: { data: history, error: null },
		refreshedAt: now
	};
	if (scenario === 'low-voltage') {
		history.battery1 = series((i) => (i === 40 ? 10.8 : 13.1 - i / 192));
		history.battery2 = series((i) => 13 - (i / 192) * 0.5);
		current.battery1 = metric(history.battery1);
		current.battery2 = metric(history.battery2);
		current.shore.value = 0;
		current.bilge.value = 1;
	}
	if (scenario === 'stale') {
		for (const metric of Object.values(current)) {
			metric.stale = true;
			metric.at = now - 13 * HOUR;
		}
		for (const key of ['battery1', 'battery2', 'galley', 'fridge', 'engine', 'cycles'] as const) {
			history[key] = history[key].filter((point) => point.at <= now - 13 * HOUR);
			current[key].value = history[key].at(-1)?.value ?? null;
		}
		response.current.error = 'Synthetic refresh failure; retained readings';
	}
	if (scenario === 'missing-history') {
		history.battery1.splice(80, 12);
		history.fridge[40].value = null;
		history.galley = [];
		history.cycles = [];
		response.history.error = 'Synthetic partial history failure';
	}
	if (scenario === 'counter-reset') {
		history.cycles = series((i) => (i < 96 ? 100 + Math.floor(i / 24) : Math.floor((i - 96) / 24)));
		current.cycles = metric(history.cycles);
	}
	if (scenario === 'unavailable') {
		current.fridge = { value: null, at: null, stale: true };
		current.shore = { value: null, at: null, stale: true };
		history.fridge = [];
	}
	return response;
}

export function prototypeData(scenario: Scenario, now = Date.now()) {
	return screenData(prototypeResponse(scenario, now), now, scenario);
}

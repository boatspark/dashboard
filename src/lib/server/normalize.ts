import {
	emptyCurrent,
	sortedPoints,
	type Current,
	type History,
	type Metric,
	type Point
} from '#lib/data.js';

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function timestamp(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const at = Date.parse(value);
	return Number.isFinite(at) && at <= Date.now() + 60_000 ? at : null;
}

function number(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function converted(value: unknown, kind: 'voltage' | 'temperature' | 'status' | 'counter') {
	const raw = number(value);
	if (raw === null) return null;
	if (kind === 'status') return raw === 0 || raw === 1 ? raw : null;
	if (kind === 'counter') return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
	if (kind === 'voltage') return raw >= 0 ? raw / 100 : null;
	return (raw / 100) * (9 / 5) + 32;
}

function metric(source: unknown, key: string, kind: Parameters<typeof converted>[1]): Metric {
	const data = record(source);
	const at = timestamp(data.published_at);
	return {
		value: at === null ? null : converted(record(data.values)[key], kind),
		at,
		stale: data.stale !== false
	};
}

export function normalizeCurrent(input: unknown): Current {
	const data = record(input);
	if (!('gpio' in data) || !Array.isArray(data.beacons)) throw new Error('Invalid current data');
	const current = emptyCurrent();
	current.battery1 = metric(data.gpio, 'battery1_voltage', 'voltage');
	current.battery2 = metric(data.gpio, 'battery2_voltage', 'voltage');
	current.shore = metric(data.gpio, 'shore_power_status', 'status');
	current.bilge = metric(data.gpio, 'bilge_pump_status', 'status');
	current.cycles = metric(data.gpio, 'bilge_pump_cycle', 'counter');
	for (const [name, key] of [
		['Galley', 'galley'],
		['Fridge', 'fridge'],
		['Engine', 'engine']
	] as const) {
		const beacon = data.beacons.find((value) => record(value).beacon_name === name);
		current[key] = metric(beacon, 'temperature', 'temperature');
	}
	return current;
}

function readings(input: unknown, key: string, kind: Parameters<typeof converted>[1]): Point[] {
	if (!Array.isArray(input)) return [];
	const points: Point[] = [];
	for (const raw of input) {
		const data = record(raw);
		const at = timestamp(data.published_at);
		if (at !== null) points.push({ at, value: converted(record(data.values)[key], kind) });
	}
	return sortedPoints(points);
}

export function normalizeHistory(input: unknown): History {
	const data = record(input);
	const start = timestamp(data.window_start);
	const end = timestamp(data.window_end);
	const interval = number(data.interval_minutes);
	if (
		start === null ||
		end === null ||
		end <= start ||
		interval === null ||
		interval <= 0 ||
		!Array.isArray(data.gpio) ||
		!Array.isArray(data.beacons)
	)
		throw new Error('Invalid history data');
	const history: History = {
		start,
		end,
		interval: interval * 60_000,
		battery1: readings(data.gpio, 'battery1_voltage', 'voltage'),
		battery2: readings(data.gpio, 'battery2_voltage', 'voltage'),
		cycles: readings(data.gpio, 'bilge_pump_cycle', 'counter'),
		galley: [],
		fridge: [],
		engine: []
	};
	for (const [name, key] of [
		['Galley', 'galley'],
		['Fridge', 'fridge'],
		['Engine', 'engine']
	] as const) {
		const beacon = record(data.beacons.find((value) => record(value).beacon_name === name));
		history[key] = readings(beacon.readings, 'temperature', 'temperature');
	}
	return history;
}

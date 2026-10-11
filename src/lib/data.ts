export const HOUR = 60 * 60 * 1000;
export const WINDOW = 48 * HOUR;
export const POLL_INTERVAL = 60_000;
export const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const pacificHour = new Intl.DateTimeFormat('en-US', {
	timeZone: PACIFIC_TIME_ZONE,
	hour: 'numeric',
	hourCycle: 'h23'
});

export function isNightTime(at: number): boolean {
	const part = pacificHour.formatToParts(at).find((part) => part.type === 'hour');
	if (!part) throw new Error('Pacific hour could not be formatted');
	const hour = Number(part.value);
	return hour >= 22 || hour < 5;
}
export const temperatureKeys = ['galley', 'fridge', 'engine'] as const;
export const metricKeys = [
	'battery1',
	'battery2',
	'galley',
	'fridge',
	'engine',
	'shore',
	'bilge',
	'cycles'
] as const;
export type MetricKey = (typeof metricKeys)[number];
export type TemperatureKey = (typeof temperatureKeys)[number];
export type Metric = { value: number | null; at: number | null; stale: boolean };
export type Current = Record<MetricKey, Metric>;
export type Point = { at: number; value: number | null };
export type History = {
	start: number;
	end: number;
	interval: number;
	battery1: Point[];
	battery2: Point[];
	galley: Point[];
	fridge: Point[];
	engine: Point[];
	cycles: Point[];
};
export type Result<T> = { data: T | null; error: string | null };
export type DashboardResponse = {
	current: Result<Current>;
	history: Result<History>;
	refreshedAt: number;
};

export const unavailable = (): Metric => ({ value: null, at: null, stale: true });
export function emptyCurrent(): Current {
	return {
		battery1: unavailable(),
		battery2: unavailable(),
		galley: unavailable(),
		fridge: unavailable(),
		engine: unavailable(),
		shore: unavailable(),
		bilge: unavailable(),
		cycles: unavailable()
	};
}

export function voltageTone(value: number | null): string {
	return value === null ? 'neutral' : value > 12.75 ? 'good' : value >= 12.25 ? 'amber' : 'bad';
}

export function displayValue(key: MetricKey, value: number | null): string {
	if (value === null) return '--';
	if (key === 'shore' || key === 'bilge') return value === 1 ? 'On' : 'Off';
	if (key === 'battery1' || key === 'battery2') return value.toFixed(2);
	if (key === 'cycles') return String(value);
	return value.toFixed(1);
}

export function freshness(metric: Metric, now: number, loadedAt: number, failed: boolean): string {
	if (now - (metric.at ?? loadedAt) >= 12 * HOUR) return 'No valid measurement for 12 hours';
	if (metric.value === null) return 'Unavailable';
	if (failed || metric.stale) return 'Stale';
	return '';
}

export function mergeCurrent(previous: Current, next: Current): Current {
	const merged = { ...previous };
	for (const key of metricKeys) {
		const incoming = next[key];
		const prior = previous[key];
		merged[key] =
			incoming.value === null ||
			(prior.at !== null && incoming.at !== null && incoming.at < prior.at)
				? { ...prior, stale: true }
				: incoming;
	}
	return merged;
}

export function sortedPoints(points: Point[]): Point[] {
	return [...new Map(points.map((point) => [point.at, point])).values()].sort(
		(a, b) => a.at - b.at
	);
}

export function retainObservations(points: Point[], start: number): Point[] {
	const sorted = sortedPoints(points);
	const predecessor = sorted.filter((point) => point.at < start).at(-1);
	return [...(predecessor ? [predecessor] : []), ...sorted.filter((point) => point.at >= start)];
}

export function observedCycles(points: Point[], start: number, end: number, interval: number) {
	const ordered = sortedPoints(points).filter((point) => point.at <= end);
	const valid = ordered.filter(
		(point): point is Point & { value: number } =>
			point.value !== null && Number.isInteger(point.value) && point.value >= 0
	);
	const inWindow = valid.filter((point) => point.at >= start);
	if (inWindow.length < 2) return { value: null, incomplete: true };
	let total = 0;
	let incomplete =
		ordered.some((point) => point.value === null) ||
		inWindow[0].at > start ||
		end - inWindow[inWindow.length - 1].at > interval * 2;
	for (let i = 1; i < valid.length; i++) {
		const before = valid[i - 1];
		const after = valid[i];
		if (after.at < start) continue;
		if (before.at < start) {
			incomplete = true;
			continue;
		}
		if (after.at - before.at > interval * 2) incomplete = true;
		if (after.value < before.value) {
			total += after.value;
			incomplete = true;
		} else {
			total += after.value - before.value;
		}
	}
	return { value: total, incomplete };
}

export function temperatureBounds(history: History | null, start: number, end: number) {
	if (!history) return null;
	const values = temperatureKeys.flatMap((key) =>
		history[key].flatMap((point) =>
			point.at >= start && point.at <= end && point.value !== null ? [point.value] : []
		)
	);
	if (!values.length) return null;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const padding = Math.max(1, (max - min) * 0.08);
	return [Math.floor((min - padding) / 5) * 5, Math.ceil((max + padding) / 5) * 5] as const;
}

export function pacificTime(at: number | null, date = false): string {
	if (at === null) return '--';
	return new Intl.DateTimeFormat('en-US', {
		timeZone: PACIFIC_TIME_ZONE,
		...(date ? { month: 'short', day: 'numeric' } : {}),
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short'
	}).format(at);
}

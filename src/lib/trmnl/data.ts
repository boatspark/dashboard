import {
	displayValue,
	emptyCurrent,
	freshness,
	observedCycles,
	pacificTime,
	sortedPoints,
	temperatureBounds,
	voltageTone,
	WINDOW,
	type DashboardResponse,
	type Metric,
	type Point
} from '#lib/data.js';

export type Chart = {
	segments: string[];
	top: string;
	bottom: string;
	note: string;
};

export function chart(
	points: Point[],
	start: number,
	end: number,
	interval: number,
	bounds: readonly [number, number] | null
): Chart {
	if (!bounds) return { segments: [], top: '', bottom: '', note: 'No valid history' };
	const segments: string[] = [];
	let path = '';
	let previous: number | null = null;
	let overflow = false;
	for (const point of sortedPoints(points).filter(
		(point) => point.at >= start && point.at <= end
	)) {
		if (point.value === null) {
			if (path) segments.push(path);
			path = '';
			previous = null;
			continue;
		}
		if (previous !== null && point.at - previous > interval * 2) {
			if (path) segments.push(path);
			path = '';
		}
		overflow ||= point.value < bounds[0] || point.value > bounds[1];
		const value = Math.max(bounds[0], Math.min(bounds[1], point.value));
		const x = 32 + ((point.at - start) / (end - start)) * 264;
		const y = 65 - ((value - bounds[0]) / (bounds[1] - bounds[0])) * 58;
		path += `${path ? ' L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
		previous = point.at;
	}
	if (path) segments.push(path);
	return {
		segments,
		top: String(bounds[1]),
		bottom: String(bounds[0]),
		note: !segments.length
			? 'No valid history'
			: overflow
				? 'Outside chart range'
				: '48h · gaps are missing data'
	};
}

export function screenData(response: DashboardResponse, now: number, scenario: string) {
	const current = response.current.data ?? emptyCurrent();
	const history = response.history.data;
	const start = now - WINDOW;
	const interval = history?.interval ?? 900_000;
	const bounds = temperatureBounds(history, start, now);
	const status = (metric: Metric) => {
		const label = freshness(metric, now, now, !!response.current.error);
		return label === 'No valid measurement for 12 hours' ? 'NO DATA 12H' : label.toUpperCase();
	};
	const tile = (
		key: 'battery1' | 'battery2' | 'galley' | 'fridge' | 'engine',
		title: string,
		unit: string,
		limits: readonly [number, number] | null
	) => {
		const metric = current[key];
		const warning = status(metric);
		const battery = key === 'battery1' || key === 'battery2';
		const health = battery
			? ({ good: 'GOOD', amber: 'CAUTION', bad: 'LOW', neutral: 'UNKNOWN' }[
					voltageTone(metric.value)
				] ?? 'UNKNOWN')
			: '';
		return {
			title,
			value: displayValue(key, metric.value),
			unit,
			status: warning || health,
			alert: !!warning || (battery && health !== 'GOOD'),
			measured: pacificTime(metric.at),
			chart: chart(history?.[key] ?? [], start, now, interval, limits)
		};
	};
	const counter = current.cycles;
	const count = observedCycles(
		[
			...(history?.cycles ?? []),
			...(counter.at !== null && counter.value !== null
				? [{ at: counter.at, value: counter.value }]
				: [])
		],
		start,
		now,
		interval
	);
	const warnings = [
		response.current.error ? 'CURRENT DATA STALE' : '',
		response.history.error ? 'HISTORY UNAVAILABLE' : '',
		...Object.values(current).map(status)
	].filter(Boolean);
	const banner = warnings.includes('NO DATA 12H')
		? 'NO VALID MEASUREMENT FOR 12 HOURS'
		: warnings.length
			? [...new Set(warnings)].join(' · ')
			: 'SYNTHETIC DATA · NOT LIVE BOAT READINGS';
	return {
		scenario,
		banner,
		warning: warnings.length > 0,
		snapshot: pacificTime(response.refreshedAt, true),
		batteries: [
			tile('battery1', 'Battery 1', 'V', [11, 15]),
			tile('battery2', 'Battery 2', 'V', [11, 15])
		],
		temperatures: [
			tile('galley', 'Galley', '°F', bounds),
			tile('fridge', 'Fridge', '°F', bounds),
			tile('engine', 'Engine Bay', '°F', bounds)
		],
		statuses: (
			[
				['shore', 'Shore power', 1],
				['bilge', 'Bilge pump', 0]
			] as const
		).map(([key, title, good]) => ({
			title,
			value: displayValue(key, current[key].value).toUpperCase(),
			note: status(current[key]) || `Measured ${pacificTime(current[key].at)}`,
			alert: !!status(current[key]) || current[key].value !== good
		})),
		cycles: {
			value: count.value === null ? '--' : String(count.value),
			note: status(counter) || (count.incomplete ? 'INCOMPLETE COVERAGE' : 'Sampled counter'),
			alert: !!status(counter) || count.incomplete
		}
	};
}

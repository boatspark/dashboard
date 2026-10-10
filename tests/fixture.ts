import type { DashboardResponse } from '../src/lib/data';
export function fixture(now = Date.now()): DashboardResponse {
	const point = (value: number) => [
		{ at: now - 900_000, value },
		{ at: now, value }
	];
	const metric = (value: number) => ({ value, at: now, stale: false });
	return {
		refreshedAt: now,
		current: {
			error: null,
			data: {
				battery1: metric(13.89),
				battery2: metric(13.82),
				galley: metric(50.6),
				fridge: metric(40.1),
				engine: metric(51.2),
				shore: metric(1),
				bilge: metric(0),
				cycles: metric(12)
			}
		},
		history: {
			error: null,
			data: {
				start: now - 48 * 3_600_000,
				end: now,
				interval: 900_000,
				battery1: point(13.89),
				battery2: point(13.82),
				galley: point(50.6),
				fridge: point(40.1),
				engine: point(51.2),
				cycles: [
					{ at: now - 900_000, value: 10 },
					{ at: now, value: 12 }
				]
			}
		}
	};
}

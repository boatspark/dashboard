import {
	emptyCurrent,
	mergeCurrent,
	metricKeys,
	retainObservations,
	WINDOW,
	type Current,
	type DashboardResponse,
	type History,
	type Point
} from '#lib/data.js';

export function createTrmnlStore() {
	let sequence = 0;
	let latest = 0;
	let loadedAt: number | null = null;
	let current: Current = emptyCurrent();
	let history: History | null = null;
	let currentError: string | null = 'Current data unavailable';
	let historyError: string | null = 'History data unavailable';
	let observations: Point[] = [];

	function begin(now = Date.now()) {
		loadedAt ??= now;
		return ++sequence;
	}

	function record(id: number, response: DashboardResponse) {
		const newer = id >= latest;
		const incoming = response.current.data;
		const counter = incoming?.cycles;
		if (
			counter &&
			counter.at !== null &&
			counter.value !== null &&
			(newer || !observations.some((point) => point.at === counter.at))
		) {
			observations = retainObservations(
				[...observations, { at: counter.at, value: counter.value }],
				response.refreshedAt - WINDOW
			);
		}
		if (incoming) {
			if (newer) {
				current = mergeCurrent(current, incoming);
			} else {
				const merged = { ...current };
				for (const key of metricKeys) {
					const metric = incoming[key];
					const prior = current[key];
					if (
						metric.value !== null &&
						metric.at !== null &&
						(prior.at === null || metric.at > prior.at)
					)
						merged[key] = metric;
				}
				current = merged;
			}
		}
		const incomingHistory = response.history.data;
		const olderHistory = !!(history && incomingHistory && incomingHistory.end < history.end);
		if (
			incomingHistory &&
			(!history || incomingHistory.end > history.end || (newer && !olderHistory))
		)
			history = incomingHistory;
		if (newer) {
			latest = id;
			currentError = response.current.error;
			historyError =
				response.history.error ??
				(olderHistory ? 'History data is older than retained data' : null);
		}
	}

	function snapshot(now = Date.now()) {
		observations = retainObservations(observations, now - WINDOW);
		return {
			response: {
				current: { data: current, error: currentError },
				history: { data: history, error: historyError },
				refreshedAt: now
			} satisfies DashboardResponse,
			loadedAt: loadedAt ?? now,
			observations: [...observations]
		};
	}

	return { begin, record, snapshot };
}

export const trmnlStore = createTrmnlStore();

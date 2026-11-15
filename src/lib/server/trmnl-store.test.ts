import { describe, expect, it } from 'vitest';
import { HOUR, type DashboardResponse } from '#lib/data.js';
import { prototypeResponse } from './trmnl-prototype';
import { createTrmnlStore } from './trmnl-store';
import { screenData } from '#lib/trmnl/data.js';

const now = Date.parse('2026-11-15T20:00:00Z');
const failed = (at: number): DashboardResponse => ({
	current: { data: null, error: 'Current data request failed' },
	history: { data: null, error: 'History data request failed' },
	refreshedAt: at
});

describe('TRMNL snapshot retention', () => {
	it('retains the last good readings and history on failure, then recovers', () => {
		const store = createTrmnlStore();
		const original = prototypeResponse('normal', now);
		store.record(store.begin(now), original);
		store.record(store.begin(now + 60_000), failed(now + 60_000));
		const retained = store.snapshot(now + 60_000);
		expect(retained.response.current.data?.battery1).toEqual(original.current.data?.battery1);
		expect(retained.response.history.data).toEqual(original.history.data);
		expect(retained.response.current.error).toContain('failed');
		expect(retained.response.history.error).toContain('failed');
		const screen = screenData(retained.response, retained.response.refreshedAt, {
			mode: 'live',
			loadedAt: retained.loadedAt,
			observations: retained.observations
		});
		expect(screen.banner).toContain('CURRENT DATA STALE');
		expect(screen.banner).toContain('HISTORY STALE');
		expect(screen.batteries[0]).toMatchObject({ value: '12.97', status: 'STALE', alert: true });
		expect(screen.batteries[0].chart.segments.length).toBeGreaterThan(0);

		const recovery = prototypeResponse('normal', now + 120_000);
		store.record(store.begin(now + 120_000), recovery);
		const restored = store.snapshot(now + 120_000);
		expect(restored.response.current.error).toBeNull();
		expect(restored.response.history.error).toBeNull();
		expect(restored.response.current.data?.battery1.stale).toBe(false);
	});

	it('preserves valid individual metrics when a newer observation is missing or older', () => {
		const store = createTrmnlStore();
		const first = prototypeResponse('normal', now);
		store.record(store.begin(now), first);
		const next = prototypeResponse('normal', now + 60_000);
		next.current.data!.battery1.value = null;
		next.current.data!.battery2.at = now - HOUR;
		store.record(store.begin(now + 60_000), next);
		const current = store.snapshot(now + 60_000).response.current.data!;
		expect(current.battery1).toEqual({ ...first.current.data!.battery1, stale: true });
		expect(current.battery2).toEqual({ ...first.current.data!.battery2, stale: true });
		expect(current.galley).toEqual(next.current.data!.galley);
	});

	it('keeps observations from dashboard and TRMNL polls and marks counter resets incomplete', () => {
		const store = createTrmnlStore();
		const first = prototypeResponse('normal', now);
		const next = prototypeResponse('normal', now + 60_000);
		next.current.data!.cycles = { at: now + 60_000, value: 1, stale: false };
		store.record(store.begin(now), first);
		store.record(store.begin(now + 60_000), next);
		const snapshot = store.snapshot(now + 60_000);
		expect(snapshot.observations).toEqual([
			{ at: first.current.data!.cycles.at, value: first.current.data!.cycles.value },
			{ at: now + 60_000, value: 1 }
		]);
		const screen = screenData(snapshot.response, snapshot.response.refreshedAt, {
			mode: 'live',
			loadedAt: snapshot.loadedAt,
			observations: snapshot.observations
		});
		expect(screen.cycles).toMatchObject({ note: 'INCOMPLETE COVERAGE', alert: true });
		expect(store.snapshot(now + 49 * HOUR).observations).toHaveLength(1);
	});

	it('does not let older in-flight requests overwrite newer results', () => {
		const store = createTrmnlStore();
		const older = store.begin(now);
		const newer = store.begin(now + 1);
		const fresh = prototypeResponse('normal', now + 1);
		store.record(newer, fresh);
		store.record(older, failed(now + 2));
		expect(store.snapshot(now + 2).response.current).toEqual({
			data: fresh.current.data,
			error: null
		});
		expect(store.snapshot(now + 2).response.history.error).toBeNull();
	});

	it('keeps the newer counter observation when an older request reports the same timestamp', () => {
		const store = createTrmnlStore();
		const older = store.begin(now);
		const newer = store.begin(now + 1);
		const first = prototypeResponse('normal', now);
		const last = prototypeResponse('normal', now);
		first.current.data!.cycles.value = 2;
		last.current.data!.cycles.value = 4;
		store.record(newer, last);
		store.record(older, first);
		expect(store.snapshot(now + 2).observations).toEqual([
			{ at: last.current.data!.cycles.at, value: 4 }
		]);
	});

	it('accepts a late good reading after a newer failure without hiding the failure', () => {
		const store = createTrmnlStore();
		const older = store.begin(now);
		const newer = store.begin(now + 1);
		store.record(newer, failed(now + 2));
		const good = prototypeResponse('normal', now);
		store.record(older, good);
		const snapshot = store.snapshot(now + 3);
		expect(snapshot.response.current.data?.battery1.value).toBe(good.current.data?.battery1.value);
		expect(snapshot.response.current.error).toContain('failed');
		expect(snapshot.response.history.data).toEqual(good.history.data);
		expect(snapshot.response.history.error).toContain('failed');
	});

	it('keeps newer history and marks an older successful history response stale', () => {
		const store = createTrmnlStore();
		const first = prototypeResponse('normal', now);
		store.record(store.begin(now), first);
		const older = prototypeResponse('normal', now + 60_000);
		older.history.data!.end = first.history.data!.end - 60_000;
		store.record(store.begin(now + 60_000), older);
		const history = store.snapshot(now + 60_000).response.history;
		expect(history.data).toEqual(first.history.data);
		expect(history.error).toContain('older');
	});

	it('escalates an initially unavailable source after twelve hours', () => {
		const store = createTrmnlStore();
		store.record(store.begin(now), failed(now));
		store.record(store.begin(now + 12 * HOUR), failed(now + 12 * HOUR));
		const snapshot = store.snapshot(now + 12 * HOUR);
		const screen = screenData(snapshot.response, snapshot.response.refreshedAt, {
			mode: 'live',
			loadedAt: snapshot.loadedAt,
			observations: snapshot.observations
		});
		expect(screen.banner).toBe('NO VALID MEASUREMENT FOR 12 HOURS');
		expect(screen.statuses[0].value).toBe('--');
	});
});

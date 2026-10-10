<script lang="ts">
	import { onMount } from 'svelte';
	import BatteryDial from '#lib/components/BatteryDial.svelte';
	import HistoryChart from '#lib/components/HistoryChart.svelte';
	import MetricCard from '#lib/components/MetricCard.svelte';
	import { manageFullscreen } from '#lib/fullscreen.js';
	import {
		displayValue,
		emptyCurrent,
		mergeCurrent,
		metricKeys,
		observedCycles,
		pacificTime,
		POLL_INTERVAL,
		retainObservations,
		temperatureBounds,
		voltageTone,
		WINDOW,
		type DashboardResponse,
		type History,
		type MetricKey,
		type Point
	} from '#lib/data.js';

	let current = $state(emptyCurrent());
	let history = $state<History | null>(null);
	let now = $state(Date.now());
	let loadedAt = $state(Date.now());
	let refreshedAt = $state<number | null>(null);
	let currentError = $state('Loading current data');
	let historyError = $state('Loading history');
	let flashes = $state<MetricKey[]>([]);
	let cycleFlash = $state(false);
	let observations = $state<Point[]>([]);
	let fullscreen = $state(false);
	let capability = $state('');
	let enterFullscreen = $state<(() => Promise<void>) | null>(null);
	let start = $derived(now - WINDOW);
	let bounds = $derived(temperatureBounds(history, start, now));
	let count = $derived(
		observedCycles(
			[...(history?.cycles ?? []), ...observations],
			start,
			now,
			history?.interval ?? 15 * 60_000
		)
	);
	const batteries = ['battery1', 'battery2'] as const;
	const temperatures = [
		{ key: 'galley', title: 'Galley', color: 'var(--blue)' },
		{ key: 'fridge', title: 'Fridge', color: 'var(--teal)' },
		{ key: 'engine', title: 'Engine Bay', color: 'var(--purple)' }
	] as const;

	onMount(() => {
		loadedAt = Date.now();
		let active = true;
		let pending = false;
		let lastAttempt = 0;
		let flashTimer: ReturnType<typeof setTimeout> | undefined;
		const abort = new AbortController();
		const screen = manageFullscreen(
			(message) => {
				capability = message;
			},
			(value) => {
				fullscreen = value;
			}
		);
		enterFullscreen = screen.enter;
		async function refresh() {
			if (pending || !active) return;
			pending = true;
			lastAttempt = Date.now();
			const before = current;
			const beforeCount = count.value;
			const first = refreshedAt === null;
			try {
				const response = await fetch('/api/dashboard', {
					cache: 'no-store',
					signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)])
				});
				if (!response.ok) throw new Error('Refresh failed');
				const data: DashboardResponse = await response.json();
				if (!active) return;
				now = Date.now();
				currentError = data.current.error ?? '';
				historyError = data.history.error ?? '';
				if (data.current.data) {
					current = mergeCurrent(current, data.current.data);
					const counter = data.current.data.cycles;
					if (counter.at !== null && counter.value !== null) {
						observations = retainObservations(
							[...observations, { at: counter.at, value: counter.value }],
							now - WINDOW
						);
					}
				}
				if (data.history.data) history = data.history.data;
				refreshedAt = data.refreshedAt;
				flashes = first
					? []
					: metricKeys.filter(
							(key) =>
								before[key].value !== null &&
								current[key].value !== null &&
								displayValue(key, before[key].value) !== displayValue(key, current[key].value)
						);
				const afterCount = observedCycles(
					[...(history?.cycles ?? []), ...observations],
					now - WINDOW,
					now,
					history?.interval ?? 900_000
				).value;
				cycleFlash =
					!first && beforeCount !== null && afterCount !== null && beforeCount !== afterCount;
				clearTimeout(flashTimer);
				flashTimer = setTimeout(() => {
					flashes = [];
					cycleFlash = false;
				}, 1500);
			} catch {
				if (active) {
					currentError = 'Dashboard refresh failed; retaining previous readings';
					historyError = 'History refresh failed; retaining previous readings';
				}
			} finally {
				pending = false;
			}
		}
		const tick = setInterval(() => {
			now = Date.now();
			observations = retainObservations(observations, now - WINDOW);
			if (document.visibilityState === 'visible' && now - lastAttempt >= POLL_INTERVAL)
				void refresh();
		}, 1000);
		function visible() {
			now = Date.now();
			if (document.visibilityState === 'visible' && now - lastAttempt >= POLL_INTERVAL)
				void refresh();
		}
		document.addEventListener('visibilitychange', visible);
		void refresh();
		return () => {
			active = false;
			abort.abort();
			clearInterval(tick);
			clearTimeout(flashTimer);
			document.removeEventListener('visibilitychange', visible);
			screen.destroy();
		};
	});
</script>

<svelte:head>
	<title>Boat Spark · Dashboard</title>
	<meta
		name="description"
		content="Live boat batteries, temperatures, shore power and bilge monitoring."
	/>
</svelte:head>

<main>
	<header>
		<div>
			<p class="eyebrow">BOAT SPARK</p>
			<h1>Boat dashboard</h1>
		</div>
		<div class="header-meta">
			<span class="live-dot" class:offline={!!currentError}></span>
			<span>Refresh {pacificTime(refreshedAt)}</span>
			{#if !fullscreen}<button onclick={() => enterFullscreen?.()}
					>Full screen <span aria-hidden="true">[ ]</span></button
				>{/if}
		</div>
	</header>
	{#if currentError || historyError}
		<div class="notice" role="status">
			{[currentError, historyError].filter(Boolean).join(' · ')}
		</div>
	{/if}
	{#if capability}<p class="capability" role="status">{capability}</p>{/if}

	<div class="dashboard">
		<section class="battery-section" aria-label="Batteries">
			<div class="section-heading">
				<h2>Batteries</h2>
				<span>11-15 V · 48-hour history</span>
			</div>
			<div class="battery-grid">
				{#each batteries as key, index}
					<MetricCard
						title={`Battery ${index + 1}`}
						metric={current[key]}
						{now}
						{loadedAt}
						failed={!!currentError}
						flash={flashes.includes(key)}
						tone={voltageTone(current[key].value)}
					>
						<div class="battery-body">
							<BatteryDial value={current[key].value} label={`Battery ${index + 1}`} />
							<HistoryChart
								points={history?.[key] ?? []}
								{start}
								end={now}
								bounds={[11, 15]}
								unit="V"
								color={`var(--${voltageTone(current[key].value) === 'neutral' ? 'blue' : voltageTone(current[key].value)})`}
								interval={history?.interval ?? 900_000}
								label={`Battery ${index + 1}`}
							/>
						</div>
					</MetricCard>
				{/each}
			</div>
			<div class="status-grid">
				{#each [{ key: 'shore', title: 'Shore power', good: 1 }, { key: 'bilge', title: 'Bilge pump', good: 0 }] as status}
					{@const key = status.key as 'shore' | 'bilge'}
					<MetricCard
						title={status.title}
						metric={current[key]}
						{now}
						{loadedAt}
						failed={!!currentError}
						flash={flashes.includes(key)}
						tone={current[key].value === null
							? 'neutral'
							: current[key].value === status.good
								? 'good'
								: 'bad'}
					>
						<p class="status-value">
							<span class="status-dot"></span>{displayValue(key, current[key].value)}
						</p>
					</MetricCard>
				{/each}
				<MetricCard
					title="Observed cycles (48h)"
					metric={current.cycles}
					{now}
					{loadedAt}
					failed={!!currentError}
					flash={cycleFlash}
				>
					<p class="status-value">{count.value ?? '--'}</p>
					<p class="cycle-note">
						{count.incomplete ? 'Incomplete coverage · ' : ''}Sampled counter; resets may hide
						cycles.
					</p>
				</MetricCard>
			</div>
		</section>

		<section class="temperature-section" aria-label="Temperatures">
			<div class="section-heading">
				<h2>Temperatures</h2>
				<span>°F · shared dynamic scale</span>
			</div>
			<div class="temperature-grid">
				{#each temperatures as sensor}
					<MetricCard
						title={sensor.title}
						metric={current[sensor.key]}
						{now}
						{loadedAt}
						failed={!!currentError}
						flash={flashes.includes(sensor.key)}
					>
						<div class="temperature-body">
							<p class="temperature-value">
								{displayValue(sensor.key, current[sensor.key].value)} <span>°F</span>
							</p>
							<HistoryChart
								points={history?.[sensor.key] ?? []}
								{start}
								end={now}
								{bounds}
								unit="°F"
								color={sensor.color}
								interval={history?.interval ?? 900_000}
								label={sensor.title}
							/>
						</div>
					</MetricCard>
				{/each}
			</div>
		</section>
	</div>
	<footer>
		<span>All times Pacific · updates every minute</span><span
			>History is sampled; lines break at missing readings and gaps.</span
		>
	</footer>
</main>

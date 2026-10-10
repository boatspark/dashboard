<script lang="ts">
	import { sortedPoints, type Point } from '#lib/data.js';
	let {
		points,
		start,
		end,
		bounds,
		unit,
		color = 'var(--blue)',
		interval,
		label
	} = $props<{
		points: Point[];
		start: number;
		end: number;
		bounds: readonly [number, number] | null;
		unit: string;
		color?: string;
		interval: number;
		label: string;
	}>();
	let width = $state(608);
	let scale = $derived(608 / Math.max(width, 180));
	let left = $derived(38 * scale);
	let right = $derived(608 - 6 * scale);
	const top = 15,
		bottom = 100;
	const dateLabel = (at: number) =>
		new Intl.DateTimeFormat('en-US', {
			timeZone: 'America/Los_Angeles',
			month: 'short',
			day: 'numeric'
		}).format(at);
	let visible = $derived(sortedPoints(points).filter((p) => p.at >= start && p.at <= end));
	let valid = $derived(
		visible.filter((point): point is Point & { value: number } => point.value !== null)
	);
	let overflow = $derived(
		bounds && visible.some((p) => p.value !== null && (p.value < bounds[0] || p.value > bounds[1]))
	);
	let paths = $derived.by(() => {
		if (!bounds) return [];
		const lines: string[] = [];
		let path = '';
		let previous: number | null = null;
		for (const point of visible) {
			if (point.value === null) {
				if (path) lines.push(path);
				path = '';
				previous = null;
				continue;
			}
			if (previous !== null && point.at - previous > interval * 2) {
				if (path) lines.push(path);
				path = '';
			}
			const x = left + ((point.at - start) / (end - start)) * (right - left);
			const clipped = Math.max(bounds[0], Math.min(bounds[1], point.value));
			const y = bottom - ((clipped - bounds[0]) / (bounds[1] - bounds[0])) * (bottom - top);
			path += `${path ? ' L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
			previous = point.at;
		}
		if (path) lines.push(path);
		return lines;
	});
</script>

<div class="chart" bind:clientWidth={width}>
	<svg
		viewBox="0 0 608 140"
		style:--label-size={`${10 * scale}px`}
		role="img"
		aria-label={`${label}, last 48 hours, ${unit}`}
	>
		{#if bounds}
			{#each [0, 0.5, 1] as fraction}
				{@const y = top + fraction * (bottom - top)}
				<line x1={left} x2={right} y1={y} y2={y} class="grid" />
				<text x={left - 8 * scale} y={y + 4 * scale} text-anchor="end"
					>{(bounds[1] - fraction * (bounds[1] - bounds[0])).toFixed(0)}</text
				>
			{/each}
			{#each paths as path}
				<path d={path} stroke={color} fill="none" stroke-width="2.5" stroke-linejoin="round" />
			{/each}
			{#each valid as point}
				<circle
					cx={left + ((point.at - start) / (end - start)) * (right - left)}
					cy={bottom -
						((Math.max(bounds[0], Math.min(bounds[1], point.value)) - bounds[0]) /
							(bounds[1] - bounds[0])) *
							(bottom - top)}
					r="1.7"
					fill={color}
				/>
			{/each}
		{/if}
		{#if !paths.length}<text x="320" y="65" text-anchor="middle">No valid history</text>{/if}
		<text x={left} y="130">{dateLabel(start)}</text>
		<text x={right} y="130" text-anchor="end">{dateLabel(end)}</text>
	</svg>
	<div class="chart-caption">
		<span>{unit} · 48 hours</span>{#if overflow}<span class="amber-text"
				>Values outside 11-15 V range</span
			>{/if}
	</div>
</div>

<style>
	.chart {
		width: 100%;
	}
	svg {
		display: block;
		width: 100%;
	}
	text {
		fill: var(--muted);
		font-size: var(--label-size);
		font-family: inherit;
	}
	.grid {
		stroke: var(--border);
		stroke-dasharray: 3 5;
	}
	.chart-caption {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		color: var(--muted);
		font-size: 0.7rem;
	}
	.amber-text {
		color: var(--amber);
	}
</style>

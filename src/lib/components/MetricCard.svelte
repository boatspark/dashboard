<script lang="ts">
	import { freshness, pacificTime, type Metric } from '#lib/data.js';
	import type { Snippet } from 'svelte';
	let {
		title,
		metric,
		now,
		loadedAt,
		failed,
		flash = false,
		tone = 'neutral',
		children
	} = $props<{
		title: string;
		metric: Metric;
		now: number;
		loadedAt: number;
		failed: boolean;
		flash?: boolean;
		tone?: string;
		children: Snippet;
	}>();
	let warning = $derived(freshness(metric, now, loadedAt, failed));
</script>

<article
	class={`card ${tone}`}
	class:flash
	class:critical={warning.includes('12 hours')}
	aria-label={title}
>
	<div class="card-heading">
		<h3>{title}</h3>
		{#if warning}<span class="warning" role="status">{warning}</span>{/if}
	</div>
	{@render children()}
	<p class="measurement">Measured {pacificTime(metric.at, true)}</p>
</article>

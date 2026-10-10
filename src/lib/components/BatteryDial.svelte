<script lang="ts">
	import { voltageTone } from '#lib/data.js';
	let { value, label } = $props<{ value: number | null; label: string }>();
	let fraction = $derived(value === null ? 0 : Math.max(0, Math.min(1, (value - 11) / 4)));
	let tone = $derived(voltageTone(value));
</script>

<svg
	class={tone}
	viewBox="0 0 220 148"
	role="img"
	aria-label={`${label}: ${value === null ? 'unavailable' : value.toFixed(2) + ' volts'}`}
>
	<path class="track" d="M35,121 A80,80 0 1,1 185,121" pathLength="100" />
	<path
		class="meter"
		d="M35,121 A80,80 0 1,1 185,121"
		pathLength="100"
		stroke-dasharray={`${fraction * 100} 100`}
	/>
	<text x="110" y="88" text-anchor="middle" class="value"
		>{value === null ? '--' : value.toFixed(2)}</text
	>
	<text x="110" y="110" text-anchor="middle" class="unit">VOLTS</text>
	<text x="30" y="143" class="limit">11</text><text x="190" y="143" text-anchor="end" class="limit"
		>15</text
	>
</svg>

<style>
	svg {
		width: min(100%, 205px);
		display: block;
		margin: 0 auto;
	}
	path {
		fill: none;
		stroke-width: 9;
		stroke-linecap: round;
	}
	.track {
		stroke: var(--border);
	}
	.meter {
		stroke: var(--tone);
	}
	.value {
		fill: var(--text);
		font-family: inherit;
		font-size: 36px;
		font-weight: 600;
	}
	.unit,
	.limit {
		fill: var(--muted);
		font-family: inherit;
		font-size: 10px;
		letter-spacing: 2px;
	}
</style>

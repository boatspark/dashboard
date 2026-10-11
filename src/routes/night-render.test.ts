import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Dashboard from './+page.svelte';
import { load } from './+page.server';

afterEach(() => vi.useRealTimers());

it.each([
	['2026-07-02T05:00:00Z', true],
	['2026-07-02T12:00:00Z', false]
])('renders the serialized schedule before JavaScript runs at %s', (at, night) => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(at));
	const setHeaders = vi.fn();
	const data = load({ setHeaders });
	expect(data).toEqual({ initialTime: Date.parse(at) });
	expect(setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
	vi.setSystemTime(new Date('2026-07-02T19:00:00Z'));
	const output = render(Dashboard, { props: { data, params: {}, form: null } });
	expect(output.body).toMatch(night ? /<main class="night-mode"/ : /<main>/);
});

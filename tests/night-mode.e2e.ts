import { expect, test } from '@playwright/test';
import { fixture } from './fixture';

test.use({ timezoneId: 'Asia/Tokyo' });

for (const boundary of [
	{ name: '10 PM', before: '2026-07-02T04:59:59Z', from: 'none', to: 'brightness(0.1)' },
	{ name: '5 AM', before: '2026-07-02T11:59:59Z', from: 'brightness(0.1)', to: 'none' }
]) {
	test(`switches immediately at ${boundary.name} Pacific despite another browser timezone`, async ({
		page
	}) => {
		const at = Date.parse(boundary.before);
		await page.clock.install({ time: at });
		let requests = 0;
		await page.route('**/api/dashboard', (route) => {
			requests++;
			return route.fulfill({ json: fixture(at) });
		});
		await page.goto('/');
		await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
		await expect(page.locator('main')).toHaveCSS('filter', boundary.from);
		await page.clock.runFor(1000);
		await expect(page.locator('main')).toHaveCSS('filter', boundary.to);
		expect(requests).toBe(1);
	});
}

test('corrects the night schedule immediately when a backgrounded tab returns', async ({
	page
}) => {
	const at = Date.parse('2026-07-02T04:59:00Z');
	await page.clock.install({ time: at });
	await page.route('**/api/dashboard', (route) => route.fulfill({ json: fixture(at) }));
	await page.goto('/');
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
	await expect(page.locator('main')).toHaveCSS('filter', 'none');
	await page.clock.pauseAt(new Date(at + 30_000));
	await page.evaluate(() =>
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden'
		})
	);
	await page.clock.setSystemTime(new Date(at + 120_000));
	await expect(page.locator('main')).toHaveCSS('filter', 'none');
	await page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible'
		});
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await expect(page.locator('main')).toHaveCSS('filter', 'brightness(0.1)');
});

test('dims warnings, changed values and controls in fullscreen without interrupting updates', async ({
	page
}) => {
	const at = Date.parse('2026-07-02T06:00:00Z');
	await page.clock.install({ time: at });
	await page.addInitScript(() => {
		let fullscreen: Element | null = null;
		Object.defineProperty(document, 'fullscreenEnabled', { get: () => true });
		Object.defineProperty(document, 'fullscreenElement', { get: () => fullscreen });
		Element.prototype.requestFullscreen = async () => {
			fullscreen = document.documentElement;
			document.dispatchEvent(new Event('fullscreenchange'));
		};
		document.exitFullscreen = async () => {
			fullscreen = null;
			document.dispatchEvent(new Event('fullscreenchange'));
		};
	});
	let requests = 0;
	await page.route('**/api/dashboard', (route) => {
		const data = fixture(at + requests * 60_000);
		if (requests++ > 0 && data.current.data) {
			data.current.data.battery1.value = 12.3;
			data.current.data.fridge.stale = true;
			data.history = { data: null, error: 'History unavailable' };
		}
		return route.fulfill({ json: data });
	});
	await page.goto('/');
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
	await expect(page.locator('main')).toHaveCSS('filter', 'brightness(0.1)');
	await page.getByRole('button', { name: /Full screen/ }).click();
	await expect(page.getByRole('button', { name: /Full screen/ })).toHaveCount(0);
	await page.clock.runFor(60_000);
	await expect(page.getByRole('article', { name: 'Battery 1', exact: true })).toHaveClass(/flash/);
	await expect(page.getByRole('article', { name: 'Fridge', exact: true })).toContainText('Stale');
	await expect(page.locator('.notice')).toContainText('History unavailable');
	await expect(page.locator('main')).toHaveCSS('filter', 'brightness(0.1)');
	expect(
		await page
			.locator('.notice')
			.evaluate((el) => el.closest('main')?.classList.contains('night-mode'))
	).toBe(true);
	await page.evaluate(() => document.exitFullscreen());
	await expect(page.getByRole('button', { name: /Full screen/ })).toBeVisible();
	await expect(page.locator('main')).toHaveCSS('filter', 'brightness(0.1)');
});

test('dims independently of failed data requests and covers wide-screen margins', async ({
	page
}) => {
	await page.setViewportSize({ width: 2800, height: 1200 });
	await page.clock.install({ time: Date.parse('2026-07-02T06:00:00Z') });
	await page.route('**/api/dashboard', (route) => route.fulfill({ status: 503 }));
	await page.goto('/');
	await expect(page.locator('.notice')).toContainText('Dashboard refresh failed');
	await expect(page.locator('main')).toHaveCSS('filter', 'brightness(0.1)');
	await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
	await page.clock.setSystemTime(new Date('2026-07-02T12:00:00Z'));
	await page.clock.runFor(1000);
	await expect(page.locator('main')).toHaveCSS('filter', 'none');
	await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(11, 17, 27)');
});

test('hydrates without schedule mismatches and captures normal and dim appearance', async ({
	page
}, testInfo) => {
	const hydrationWarnings: string[] = [];
	page.on('console', (message) => {
		if (message.text().includes('hydration')) hydrationWarnings.push(message.text());
	});
	const at = Date.parse('2026-07-02T19:00:00Z');
	await page.clock.install({ time: at });
	await page.route('**/api/dashboard', (route) => route.fulfill({ json: fixture(at) }));
	const response = await page.goto('/');
	expect(response?.headers()['cache-control']).toBe('no-store');
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
	await expect(page.locator('main')).toHaveCSS('filter', 'none');
	await page.screenshot({ path: testInfo.outputPath('day.png'), fullPage: true });
	await page.clock.setSystemTime(new Date('2026-07-03T06:00:00Z'));
	await page.clock.runFor(1000);
	await expect(page.locator('main')).toHaveCSS('filter', 'brightness(0.1)');
	await page.screenshot({ path: testInfo.outputPath('night.png'), fullPage: true });
	expect(hydrationWarnings).toEqual([]);
});

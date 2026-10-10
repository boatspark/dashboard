import { expect, test } from '@playwright/test';
import { fixture } from './fixture';

test('displays five charts, correct precision, good statuses and no initial flash', async ({
	page
}) => {
	await page.route('**/api/dashboard', (route) => route.fulfill({ json: fixture() }));
	await page.goto('/');
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
	await expect(page.getByRole('img', { name: /last 48 hours/ })).toHaveCount(5);
	await expect(page.getByRole('article', { name: 'Fridge', exact: true })).toContainText('40.1');
	await expect(page.getByRole('article', { name: 'Shore power', exact: true })).toContainText('On');
	await expect(page.getByRole('article', { name: 'Bilge pump', exact: true })).toContainText('Off');
	await expect(
		page.getByRole('article', { name: 'Observed cycles (48h)', exact: true })
	).toContainText('2');
	await expect(page.locator('.flash')).toHaveCount(0);
	await expect(page.locator('body')).not.toContainText('synthetic-test');
});

test('refreshes once a minute and highlights all changed displays together', async ({ page }) => {
	const now = Date.now();
	await page.clock.install({ time: now });
	let requests = 0;
	await page.route('**/api/dashboard', (route) => {
		const data = fixture(now + requests * 60_000);
		if (requests > 0 && data.current.data) {
			data.current.data.battery1.value = 12.3;
			data.current.data.engine.value = 52.5;
			data.current.data.bilge.value = 1;
		}
		requests++;
		return route.fulfill({ json: data });
	});
	await page.goto('/');
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
	await page.clock.runFor(59_000);
	expect(requests).toBe(1);
	await page.clock.runFor(1000);
	await expect(page.getByRole('img', { name: 'Battery 1: 12.30 volts' })).toBeVisible();
	await expect(page.locator('.flash')).toHaveCount(3);
	await page.clock.runFor(1600);
	await expect(page.locator('.flash')).toHaveCount(0);
});

test('does not flash for timestamps or invisible temperature changes', async ({ page }) => {
	const now = Date.now();
	await page.clock.install({ time: now });
	let requests = 0;
	await page.route('**/api/dashboard', (route) => {
		const data = fixture(now + requests++ * 60_000);
		if (data.current.data) data.current.data.engine.value = requests > 1 ? 51.21 : 51.2;
		return route.fulfill({ json: data });
	});
	await page.goto('/');
	await expect(page.getByRole('article', { name: 'Engine Bay', exact: true })).toContainText(
		'51.2'
	);
	await page.clock.runFor(60_000);
	await expect.poll(() => requests).toBe(2);
	await expect(page.locator('.flash')).toHaveCount(0);
});

test('retains valid data when one upstream fails', async ({ page }) => {
	const now = Date.now();
	await page.clock.install({ time: now });
	let requests = 0;
	await page.route('**/api/dashboard', (route) => {
		const data = fixture(now);
		if (requests++ > 0) data.current = { data: null, error: 'Current data request failed' };
		return route.fulfill({ json: data });
	});
	await page.goto('/');
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
	await page.clock.runFor(60_000);
	await expect(page.getByRole('article', { name: 'Battery 1', exact: true })).toContainText(
		'Stale'
	);
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
	await expect(page.getByRole('img', { name: /last 48 hours/ })).toHaveCount(5);
});

test('warns on source stale flags and 12-hour measurement age', async ({ page }) => {
	const data = fixture();
	if (data.current.data) {
		data.current.data.galley.stale = true;
		data.current.data.fridge.at = Date.now() - 13 * 3_600_000;
	}
	await page.route('**/api/dashboard', (route) => route.fulfill({ json: data }));
	await page.goto('/');
	await expect(page.getByRole('article', { name: 'Galley', exact: true })).toContainText('Stale');
	await expect(page.getByRole('article', { name: 'Fridge', exact: true })).toContainText(
		'No valid measurement for 12 hours'
	);
	await expect(page.getByRole('article', { name: 'Fridge', exact: true })).toHaveClass(/critical/);
});

test('shows chart overflow and shared temperature axes', async ({ page }) => {
	const data = fixture();
	if (data.history.data) data.history.data.battery1[0].value = 16;
	await page.route('**/api/dashboard', (route) => route.fulfill({ json: data }));
	await page.goto('/');
	await expect(page.getByText('Values outside 11-15 V range')).toBeVisible();
	const charts = page.locator('.temperature-section svg');
	await expect(charts).toHaveCount(3);
	const axes = await charts.evaluateAll((elements) =>
		elements.map((el) =>
			[...el.querySelectorAll('text')].slice(0, 3).map((text) => text.textContent)
		)
	);
	expect(axes[0]).toEqual(axes[1]);
	expect(axes[1]).toEqual(axes[2]);
});

test('breaks chart lines at missing readings and long gaps', async ({ page }) => {
	const now = Date.now();
	const data = fixture(now);
	if (data.history.data)
		data.history.data.galley = [
			{ at: now - 4_000_000, value: 50 },
			{ at: now - 3_900_000, value: 51 },
			{ at: now - 3_800_000, value: null },
			{ at: now - 3_700_000, value: 52 },
			{ at: now, value: 53 }
		];
	await page.route('**/api/dashboard', (route) => route.fulfill({ json: data }));
	await page.goto('/');
	await expect(
		page.getByRole('article', { name: 'Galley', exact: true }).locator('svg path')
	).toHaveCount(3);
});

test('does not overlap polls while a refresh is pending', async ({ page }) => {
	const now = Date.now();
	await page.clock.install({ time: now });
	let requests = 0;
	let release: (() => void) | undefined;
	await page.route('**/api/dashboard', async (route) => {
		requests++;
		if (requests === 2)
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		await route.fulfill({ json: fixture(now) });
	});
	await page.goto('/');
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
	await page.clock.runFor(60_000);
	await expect.poll(() => requests).toBe(2);
	await page.clock.runFor(10_000);
	expect(requests).toBe(2);
	release?.();
});

test('small screen has no horizontal overflow and honors reduced motion', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.route('**/api/dashboard', (route) => route.fulfill({ json: fixture() }));
	await page.goto('/');
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page
		.locator('.card')
		.first()
		.evaluate((el) => el.classList.add('flash'));
	expect(
		await page
			.locator('.card')
			.first()
			.evaluate((el) => getComputedStyle(el).animationName)
	).toBe('none');
});

test('fullscreen hides its button, acquires Wake Lock, and restores on exit', async ({ page }) => {
	await page.addInitScript(() => {
		let fullscreenElement: Element | null = null;
		Object.defineProperty(document, 'fullscreenEnabled', { get: () => true });
		Object.defineProperty(document, 'fullscreenElement', { get: () => fullscreenElement });
		Element.prototype.requestFullscreen = async () => {
			fullscreenElement = document.documentElement;
			document.dispatchEvent(new Event('fullscreenchange'));
		};
		document.exitFullscreen = async () => {
			fullscreenElement = null;
			document.dispatchEvent(new Event('fullscreenchange'));
		};
		Object.defineProperty(navigator, 'wakeLock', {
			value: {
				request: async () => {
					document.documentElement.dataset.lock = 'held';
					return {
						release: async () => {
							document.documentElement.dataset.lock = 'released';
						},
						addEventListener() {}
					};
				}
			}
		});
	});
	await page.route('**/api/dashboard', (route) => route.fulfill({ json: fixture() }));
	await page.goto('/');
	await page.getByRole('button', { name: /Full screen/ }).click();
	await expect(page.getByRole('button', { name: /Full screen/ })).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute('data-lock', 'held');
	await page.evaluate(() => document.exitFullscreen());
	await expect(page.getByRole('button', { name: /Full screen/ })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-lock', 'released');
});

test('reports denied fullscreen without hiding button or disrupting data', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(document, 'fullscreenEnabled', { get: () => true });
		Element.prototype.requestFullscreen = async () => {
			throw new Error('denied');
		};
	});
	await page.route('**/api/dashboard', (route) => route.fulfill({ json: fixture() }));
	await page.goto('/');
	await page.getByRole('button', { name: /Full screen/ }).click();
	await expect(page.getByText('Fullscreen request was denied')).toBeVisible();
	await expect(page.getByRole('button', { name: /Full screen/ })).toBeVisible();
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
});

test('server returns sanitized configuration errors without a runtime URL', async ({ request }) => {
	const response = await request.get('/api/dashboard');
	expect(response.headers()['cache-control']).toBe('no-store');
	const body = await response.json();
	expect(body.current.data).toBeNull();
	expect(body.current.error).toContain('configured');
	expect(JSON.stringify(body)).not.toContain('web.boatspark.com');
	expect((await request.get('/health')).ok()).toBe(true);
});

for (const viewport of [
	{ width: 1024, height: 768 },
	{ width: 1440, height: 900 },
	{ width: 1920, height: 1080 }
]) {
	test(`fits landscape ${viewport.width}x${viewport.height} without clipping dials`, async ({
		page
	}) => {
		await page.setViewportSize(viewport);
		await page.route('**/api/dashboard', (route) => route.fulfill({ json: fixture() }));
		await page.goto('/');
		await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
			true
		);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		const top = await page
			.locator('.track')
			.first()
			.evaluate((path) => (path as SVGGraphicsElement).getBBox().y);
		expect(top).toBeGreaterThan(5);
	});
}

test('initially missing measurements escalate after twelve hours', async ({ page }) => {
	const now = Date.now();
	await page.clock.install({ time: now });
	await page.route('**/api/dashboard', (route) =>
		route.fulfill({
			json: {
				current: { data: null, error: 'Current data unavailable' },
				history: { data: null, error: 'History unavailable' },
				refreshedAt: now
			}
		})
	);
	await page.goto('/');
	await expect(page.getByRole('article', { name: 'Battery 1', exact: true })).toContainText(
		'Unavailable'
	);
	await page.clock.fastForward(12 * 3_600_000);
	await expect(page.getByRole('article', { name: 'Battery 1', exact: true })).toContainText(
		'No valid measurement for 12 hours'
	);
});

test('overdue visible page refreshes immediately after backgrounding', async ({ page }) => {
	const now = Date.now();
	await page.clock.install({ time: now });
	let requests = 0;
	await page.route('**/api/dashboard', (route) => {
		requests++;
		return route.fulfill({ json: fixture(now) });
	});
	await page.goto('/');
	await expect(page.getByRole('img', { name: 'Battery 1: 13.89 volts' })).toBeVisible();
	await page.evaluate(() =>
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
	);
	await page.clock.fastForward(300_000);
	expect(requests).toBe(1);
	await page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible'
		});
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await expect.poll(() => requests).toBe(2);
});

test('releases and reacquires Wake Lock on visibility changes', async ({ page }) => {
	await page.addInitScript(() => {
		let fullscreenElement: Element | null = null;
		Object.defineProperty(document, 'fullscreenEnabled', { get: () => true });
		Object.defineProperty(document, 'fullscreenElement', { get: () => fullscreenElement });
		Object.defineProperty(document, 'visibilityState', {
			get: () => (document.documentElement.dataset.hidden === 'yes' ? 'hidden' : 'visible')
		});
		Element.prototype.requestFullscreen = async () => {
			fullscreenElement = document.documentElement;
			document.dispatchEvent(new Event('fullscreenchange'));
		};
		Object.defineProperty(navigator, 'wakeLock', {
			value: {
				request: async () => {
					document.documentElement.dataset.requests = String(
						Number(document.documentElement.dataset.requests ?? '0') + 1
					);
					const target = new EventTarget();
					document.addEventListener(
						'test-wake-release',
						() => target.dispatchEvent(new Event('release')),
						{ once: true }
					);
					return Object.assign(target, {
						release: async () => {
							target.dispatchEvent(new Event('release'));
						}
					});
				}
			}
		});
	});
	await page.route('**/api/dashboard', (route) => route.fulfill({ json: fixture() }));
	await page.goto('/');
	await page.getByRole('button', { name: /Full screen/ }).click();
	await expect(page.locator('html')).toHaveAttribute('data-requests', '1');
	await page.evaluate(() => {
		document.documentElement.dataset.hidden = 'yes';
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await page.evaluate(() => {
		document.documentElement.dataset.hidden = 'no';
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await expect(page.locator('html')).toHaveAttribute('data-requests', '2');
	await page.evaluate(() => document.dispatchEvent(new Event('test-wake-release')));
	await expect(page.locator('html')).toHaveAttribute('data-requests', '3');
});

for (const supported of [false, true]) {
	test(`reports ${supported ? 'denied' : 'unsupported'} Wake Lock while staying fullscreen`, async ({
		page
	}) => {
		await page.addInitScript((supported) => {
			let fullscreenElement: Element | null = null;
			Object.defineProperty(document, 'fullscreenEnabled', { get: () => true });
			Object.defineProperty(document, 'fullscreenElement', { get: () => fullscreenElement });
			Element.prototype.requestFullscreen = async () => {
				fullscreenElement = document.documentElement;
				document.dispatchEvent(new Event('fullscreenchange'));
			};
			if (supported)
				Object.defineProperty(navigator, 'wakeLock', {
					value: {
						request: async () => {
							throw new Error('denied');
						}
					}
				});
			else Reflect.deleteProperty(Navigator.prototype, 'wakeLock');
		}, supported);
		await page.route('**/api/dashboard', (route) => route.fulfill({ json: fixture() }));
		await page.goto('/');
		await page.getByRole('button', { name: /Full screen/ }).click();
		await expect(page.getByRole('button', { name: /Full screen/ })).toHaveCount(0);
		await expect(
			page.getByText(
				supported
					? 'Screen Wake Lock was denied or is unavailable'
					: 'Screen Wake Lock is unavailable in this browser'
			)
		).toBeVisible();
	});
}

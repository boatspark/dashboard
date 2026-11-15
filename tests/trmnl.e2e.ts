import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { Liquid } from 'liquidjs';

const scenarios = [
	'normal',
	'low-voltage',
	'stale',
	'missing-history',
	'counter-reset',
	'unavailable'
];

test.use({ viewport: { width: 800, height: 480 } });

for (const scenario of scenarios) {
	test(`TRMNL ${scenario} fits a monochrome 800x480 screen without client fetches`, async ({
		page,
		request
	}, testInfo) => {
		const requests: string[] = [];
		page.on('request', (request) => requests.push(request.url()));
		await page.goto(`/trmnl/prototype?scenario=${scenario}`);
		await expect(page.getByText(`SYNTHETIC PROTOTYPE / ${scenario}`)).toBeVisible();
		await expect(page.getByRole('article')).toHaveCount(8);
		await expect(page.getByRole('img', { name: /last 48 hours/ })).toHaveCount(5);
		expect(requests).toHaveLength(1);
		const layout = await page.evaluate(() => {
			const screen = document.querySelector('.boat-screen')!;
			const bounds = screen.getBoundingClientRect();
			const outside = [...screen.querySelectorAll('*')].filter((element) => {
				if (element.closest('svg')) return false;
				const rect = element.getBoundingClientRect();
				return rect.left < 0 || rect.top < 0 || rect.right > 800 || rect.bottom > 480;
			});
			const colors = [...screen.querySelectorAll('*')].flatMap((element) => {
				const style = getComputedStyle(element);
				return [style.color, style.backgroundColor];
			});
			return {
				width: bounds.width,
				height: bounds.height,
				scrollWidth: document.documentElement.scrollWidth,
				scrollHeight: document.documentElement.scrollHeight,
				outside: outside.map((element) => element.textContent),
				colors: [...new Set(colors)]
			};
		});
		expect(layout).toMatchObject({
			width: 800,
			height: 480,
			scrollWidth: 800,
			scrollHeight: 480,
			outside: []
		});
		expect(
			layout.colors.every((color) =>
				['rgb(0, 0, 0)', 'rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)'].includes(color)
			)
		).toBe(true);
		const response = await request.get(`/api/trmnl/prototype?scenario=${scenario}`);
		expect(response.ok()).toBe(true);
		expect(response.headers()['cache-control']).toBe('no-store');
		const data = await response.json();
		expect(data.scenario).toBe(scenario);
		await expect(page.getByRole('article', { name: 'Battery 1', exact: true })).toContainText(
			data.batteries[0].value
		);
		await expect(
			page.getByRole('article', { name: 'Observed cycles (48h)', exact: true })
		).toContainText(data.cycles.value);
		const path = testInfo.outputPath(`${scenario}.png`);
		await page.screenshot({ path });
		await testInfo.attach(`TRMNL ${scenario}`, { path, contentType: 'image/png' });
	});
}

test('TRMNL rejects unknown scenarios without interpreting arbitrary input', async ({
	request
}) => {
	for (const path of ['/trmnl/prototype', '/api/trmnl/prototype']) {
		const response = await request.get(`${path}?scenario=unknown`);
		expect(response.status()).toBe(400);
	}
});

test('live TRMNL requires authorization and reports unavailable sources without inventing readings', async ({
	request,
	page
}, testInfo) => {
	const missing = await request.get('/api/trmnl');
	expect(missing.status()).toBe(401);
	expect(missing.headers()['cache-control']).toBe('private, no-store');
	const wrong = await request.get('/api/trmnl', {
		headers: { Authorization: `Bearer ${'y'.repeat(64)}` }
	});
	expect(wrong.status()).toBe(401);
	const response = await request.get('/api/trmnl', {
		headers: { Authorization: `Bearer ${'x'.repeat(64)}` }
	});
	expect(response.status()).toBe(200);
	const data = await response.json();
	expect(data.screenLabel).toBe('BOAT MONITOR');
	expect(data.banner).toContain('CURRENT UNAVAILABLE');
	expect(data.banner).toContain('HISTORY UNAVAILABLE');
	expect(data.batteries[0].value).toBe('--');
	expect(data.statuses[0].value).toBe('--');
	expect(data.cycles.value).toBe('--');
	expect(JSON.stringify(data)).not.toContain('SYNTHETIC');
	const template = await readFile(
		new URL('../src/lib/trmnl/screen.liquid', import.meta.url),
		'utf8'
	);
	const markup = await new Liquid({ strictVariables: true }).parseAndRender(template, data);
	await page.setContent(
		`<style>html,body{margin:0;padding:0;background:#fff;color:#000}</style>${markup}`
	);
	await expect(page.getByText('BOAT MONITOR')).toBeVisible();
	await expect(page.getByRole('status')).toContainText('CURRENT UNAVAILABLE');
	await expect(page.getByRole('article', { name: 'Shore power' })).toContainText('--');
	const screen = await page.locator('.boat-screen').evaluate((element) => ({
		width: element.scrollWidth,
		height: element.scrollHeight
	}));
	expect(screen).toEqual({ width: 800, height: 480 });
	const path = testInfo.outputPath('live-unavailable.png');
	await page.screenshot({ path });
	await testInfo.attach('TRMNL live unavailable', { path, contentType: 'image/png' });
});

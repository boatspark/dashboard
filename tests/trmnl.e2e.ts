import { expect, test } from '@playwright/test';

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

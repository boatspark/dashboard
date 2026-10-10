import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	testMatch: '**/*.e2e.ts',
	use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 900 } },
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
	webServer: {
		command: 'npm run build && node build/index.js',
		url: 'http://127.0.0.1:4173/health',
		env: { PORT: '4173', HOST: '127.0.0.1', BOATSPARK_BASE_URL: '' },
		reuseExistingServer: false
	}
});

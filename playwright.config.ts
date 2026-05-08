import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'bun server.ts',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 15000,
  },
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'iphone-15',
      use: {
        ...devices['iPhone 15'],
      },
    },
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'desktop-safari',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});

import { defineConfig } from '@playwright/test';

export const testPort = Number(process.env.TIMEPITCH_TEST_PORT ?? 8078);
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) throw new Error('Invalid TIMEPITCH_TEST_PORT');
export const testBase = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/real-model.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  expect: { timeout: 40000 },
  timeout: 90000,
  use: { baseURL: testBase, channel: 'msedge', headless: true },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1366, height: 768 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `"../backend/.venv/Scripts/python.exe" -m uvicorn timepitch.app:create_app --factory --host 127.0.0.1 --port ${testPort}`,
    url: `${testBase}/api/health`, reuseExistingServer: false, timeout: 20000,
  },
});

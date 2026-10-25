import { defineConfig } from '@playwright/test';
import base, { testPort, testBase } from './playwright.config';

export default defineConfig({
  ...base, testIgnore: [], testMatch: '**/real-model.spec.ts', timeout: 90000,
  projects: [{ name: 'real-model-desktop', use: { viewport: { width: 1366, height: 768 } } }],
  webServer: {
    command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "../scripts/start-local.ps1" -EnableLocalAI -SkipBuild -Port ${testPort}`,
    url: `${testBase}/api/health`, reuseExistingServer: false, timeout: 30000,
  },
});

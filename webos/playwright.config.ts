import { defineConfig } from '@playwright/test';

// The built app runs from file://, like on the TV; build first (npm run build).
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  timeout: 30000,
  use: { viewport: { width: 1920, height: 1080 }, trace: 'retain-on-failure' },
});

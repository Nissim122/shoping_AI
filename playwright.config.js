const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 10000,
  use: {
    baseURL: 'http://localhost:3457',
    headless: true,
  },
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3457',
    reuseExistingServer: true,
  },
});

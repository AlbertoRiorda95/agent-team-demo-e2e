// playwright.config.ts: UI tests for the screens in docs/design/.
// Two web apps: viz-web (tests in e2e/viz-web/, port 4173) and control-web
// (tests in e2e/control-web/, port 4174), both served from their built bundle.
import { defineConfig, devices } from '@playwright/test';

// `workspace` is the npm package name: `-w services/<app>` would also select
// the workspaces nested in that folder (services/viz-web/server), which have
// no build or preview script.
const apps = [
  { name: 'viz-web', workspace: '@agent-team-demo-e2e/viz-web', port: 4173 },
  { name: 'control-web', workspace: '@agent-team-demo-e2e/control-web', port: 4174 },
];
// the breakpoints of the design system: every test runs at each of them
const viewports = [
  { name: 'mobile-320', viewport: { width: 320, height: 720 }, touch: true },
  { name: 'tablet-768', viewport: { width: 768, height: 1024 }, touch: false },
  { name: 'desktop-1280', viewport: { width: 1280, height: 800 }, touch: false },
];

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'reports/ui/results',          // screenshots and traces (CI artifact)
  reporter: [['html', { outputFolder: 'reports/ui/html', open: 'never' }], ['list']],
  use: { trace: 'retain-on-failure' },
  projects: apps.flatMap(app => viewports.map(v => ({
    name: `${app.name}-${v.name}`,
    testDir: `e2e/${app.name}`,
    use: { ...devices['Desktop Chrome'], viewport: v.viewport, hasTouch: v.touch, baseURL: `http://localhost:${app.port}` },
  }))),
  webServer: apps.map(app => ({
    command: `npm run build -w ${app.workspace} && npm run preview -w ${app.workspace} -- --port ${app.port} --strictPort`,
    url: `http://localhost:${app.port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  })),
});

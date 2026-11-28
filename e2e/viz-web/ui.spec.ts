// e2e/viz-web/ui.spec.ts: the Viewer page (docs/design/viewer.md) in every
// state of the Live view. /api/live is replaced by a controllable fake
// EventSource (page.addInitScript), so every state is reachable without a backend.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type Fake = { emit(type: string, data: unknown, id?: string): void; error(): void };
declare global {
  interface Window {
    __es: Fake;
  }
}

const sample = (seq: number, t: number, x: number, z: number, phase: string) => ({
  seq,
  t_s: t,
  x_m: x,
  y_m: x / 2,
  z_m: z,
  vx_mps: 10,
  vy_mps: 5,
  vz_mps: 20 - 10 * t,
  phase,
});

function trajectory(id: string, count: number) {
  const samples = Array.from({ length: count }, (_, i) =>
    sample(i, i * 0.1, i, Math.max(0, 2 * i - 0.1 * i * i), i < 5 ? 'PHASE_BURN' : 'PHASE_BALLISTIC'),
  );
  return {
    launch_id: id,
    accepted_at: '2026-11-28T10:00:00.123Z',
    computed_at: '2026-11-28T10:00:00.456Z',
    request: {
      mass_kg: 1,
      position: { x_m: 0, y_m: 0, z_m: 0 },
      azimuth_deg: 45,
      elevation_deg: 60,
      force_n: 100,
      burn_duration_s: 0.5,
    },
    end_reason: 'END_REASON_GROUND',
    flight_time_s: (count - 1) * 0.1,
    max_height_m: 20,
    range_m: count,
    samples,
  };
}

const ID1 = '6f1c2a52-8a43-4d61-9a0e-5b1d1b8f6c21';
const ID2 = '9a8b7c6d-1111-4222-8333-444455556666';

async function install(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners = new Map<string, Array<(e: { data: string; lastEventId: string }) => void>>();
    class FakeES {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      addEventListener(type: string, l: (e: { data: string; lastEventId: string }) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), l]);
      }
      close() {}
    }
    (window as unknown as { EventSource: unknown }).EventSource = FakeES;
    window.__es = {
      emit: (type, data, id = '') =>
        (listeners.get(type) ?? []).forEach(l => l({ data: JSON.stringify(data), lastEventId: id })),
      error: () => {
        // the page's EventSource instance is the one that registered the listeners
        (window as unknown as { __last: { onerror: (() => void) | null } }).__last?.onerror?.();
      },
    };
    const Orig = FakeES;
    (window as unknown as { EventSource: unknown }).EventSource = class extends Orig {
      constructor() {
        super();
        (window as unknown as { __last: unknown }).__last = this;
      }
    };
  });
}

async function checks(page: Page, name: string, info: import('@playwright/test').TestInfo) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect.soft(overflow, 'horizontal scroll in px').toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect.soft(axe.violations.map(v => `${v.id}: ${v.help}`), 'accessibility (axe)').toEqual([]);
  if (info.project.use.hasTouch) {
    const small = await page.$$eval('button, [role=button], select, input:not([type=hidden])', els =>
      els
        .filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && (r.width < 44 || r.height < 44);
        })
        .map(e => e.outerHTML.slice(0, 80)),
    );
    expect.soft(small, 'touch targets under 44 px').toEqual([]);
  }
}

async function open(page: Page) {
  await install(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Trajectory viewer' })).toBeVisible();
}

const connect = (page: Page) => page.evaluate(() => window.__es.emit('bus', { nats: 'connected' }));
const send = (page: Page, t: unknown, id: string) => page.evaluate(([t, id]) => window.__es.emit('trajectory', t, id), [t, id] as const);

test('empty: waiting for the first trajectory', async ({ page }, info) => {
  await open(page);
  await connect(page);
  await expect(page.getByText('Waiting for the first trajectory')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled();
  await checks(page, 'empty', info);
});

test('success: replay on connect, playback, keyboard, no toast', async ({ page }, info) => {
  await open(page);
  await connect(page);
  await send(page, trajectory(ID1, 30), ID1);
  await expect(page.getByText('sample #0 of 30')).toBeVisible();
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /3D view of trajectory 6f1c2a52/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();

  const scrub = page.getByRole('slider', { name: 'Playback time' });
  await scrub.focus();
  await page.keyboard.press('ArrowRight');
  await expect(scrub).toHaveAttribute('aria-valuetext', 't = 0.10 s');
  await expect(page.getByText('sample #1 of 30')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByText('sample #29 of 30')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByText('sample #0 of 30')).toBeVisible();
  await expect(page.locator('tr[aria-current="true"]')).toContainText('0');

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Rewind' }).click();
  await expect(page.getByText('sample #0 of 30')).toBeVisible();
  await checks(page, 'success', info);

  await page.getByRole('button', { name: 'Reset view' }).click();
});

test('playback runs to the end and stops', async ({ page }) => {
  await open(page);
  await connect(page);
  await send(page, trajectory(ID1, 6), ID1);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByText('sample #5 of 6')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('a new live trajectory shows the toast and the live region, focus unchanged', async ({ page }, info) => {
  await open(page);
  await connect(page);
  await send(page, trajectory(ID1, 30), ID1);
  await page.getByRole('slider', { name: 'Playback time' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  await send(page, trajectory(ID2, 20), ID2);
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText(/New trajectory 9a8b7c6d at \d\d:\d\d:\d\d: playback reset to 0/);
  await expect(page.getByRole('status')).toContainText('New trajectory 9a8b7c6d');
  await expect(page.getByText('sample #0 of 20')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Playback time' })).toBeFocused();
  await checks(page, 'toast', info);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toHaveCount(0);
});

test('one sample: sample #0, Play disabled', async ({ page }) => {
  await open(page);
  await connect(page);
  await send(page, trajectory(ID1, 1), ID1);
  await expect(page.getByText('sample #0 of 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled();
});

test('live disconnected keeps the trajectory playable and clears on reconnect', async ({ page }, info) => {
  await open(page);
  await connect(page);
  await send(page, trajectory(ID1, 30), ID1);
  await page.evaluate(() => window.__es.emit('bus', { nats: 'disconnected' }));
  await expect(page.getByText('Live disconnected').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await checks(page, 'disconnected', info);
  await connect(page);
  await expect(page.getByText('Live disconnected')).toHaveCount(0);
});

test('History: a new live trajectory does not change the view', async ({ page }) => {
  await open(page);
  await connect(page);
  await send(page, trajectory(ID1, 30), ID1);
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByText('Select a launch')).toBeVisible();
  await page.waitForTimeout(400);
  await send(page, trajectory(ID2, 20), ID2);
  await expect(page.getByTestId('toast')).toHaveText(/New live trajectory available/);
  await expect(page.getByRole('button', { name: /^Live new/ })).toBeVisible();
  await expect(page.getByText('Select a launch')).toBeVisible();
  await page.getByRole('button', { name: /^Live/ }).click();
  await expect(page.getByText('sample #0 of 20')).toBeVisible();
});

test('keyboard focus is visible', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'nothing focusable';
    const cs = getComputedStyle(el);
    return cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' ? 'visible' : 'invisible';
  });
  expect(focus).toBe('visible');
});

// Helpers of the integration tests.
import { createServer as createNetServer } from 'node:net';

/** A free port of the host, picked by the kernel. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** Polls `check` until it returns a value. */
export async function waitFor<T>(
  check: () => Promise<T | undefined> | T | undefined,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${last ? `: ${String(last)}` : ''}`);
}

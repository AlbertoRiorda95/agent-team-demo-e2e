// A small SSE client for the tests: reads `GET /api/live` with fetch and
// splits it into frames (events and comments).

export interface Frame {
  /** `event:`; undefined for a comment line. */
  event: string | undefined;
  id: string | undefined;
  data: string | undefined;
  comment: string | undefined;
}

export interface LiveClient {
  response: Response;
  /** The next frame, or a rejection after `timeoutMs`. */
  next(timeoutMs?: number): Promise<Frame>;
  /** The next event, skipping comments. */
  nextEvent(timeoutMs?: number): Promise<Frame>;
  /** Resolves true when no event (comments aside) arrives within `ms`. */
  quietFor(ms: number): Promise<boolean>;
  close(): void;
}

function parse(block: string): Frame {
  const frame: Frame = { event: undefined, id: undefined, data: undefined, comment: undefined };
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) frame.comment = line.slice(1).trim();
    else if (line.startsWith('event: ')) frame.event = line.slice(7);
    else if (line.startsWith('id: ')) frame.id = line.slice(4);
    else if (line.startsWith('data: ')) frame.data = (frame.data === undefined ? '' : `${frame.data}\n`) + line.slice(6);
  }
  return frame;
}

export async function openLive(baseUrl: string, lastEventId?: string): Promise<LiveClient> {
  const abort = new AbortController();
  const response = await fetch(`${baseUrl}/api/live`, {
    headers: lastEventId === undefined ? {} : { 'last-event-id': lastEventId },
    signal: abort.signal,
  });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const frames: Frame[] = [];
  let waiting: (() => void) | undefined;
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          frames.push(parse(buffer.slice(0, end)));
          buffer = buffer.slice(end + 2);
        }
        waiting?.();
      }
    } catch {
      // aborted
    }
  })();

  async function next(timeoutMs = 2000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    while (frames.length === 0) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no SSE frame within ${timeoutMs} ms`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        waiting = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    return frames.shift()!;
  }

  async function nextEvent(timeoutMs = 2000): Promise<Frame> {
    for (;;) {
      const frame = await next(timeoutMs);
      if (frame.event !== undefined) return frame;
    }
  }

  return {
    response,
    next,
    nextEvent,
    async quietFor(ms) {
      try {
        await nextEvent(ms);
        return false;
      } catch {
        return true;
      }
    },
    close: () => abort.abort(),
  };
}

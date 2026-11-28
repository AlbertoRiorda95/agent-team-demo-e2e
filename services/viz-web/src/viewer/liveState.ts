import { ref, type Ref } from 'vue';
import type { TrajectoryComputed } from '@albertoriorda95/trajectory-proto';
import { openLive, type EventSourceLike } from '../api/live';
import { clock, shortId } from './format';

/** Trajectories that arrive this soon after the first `bus` event of a connection are the replay of the latest. */
export const REPLAY_WINDOW_MS = 250;
export const TOAST_MS = 8000;

export interface LiveState {
  /** The latest live trajectory, whatever the view the operator is in. */
  latest: Ref<TrajectoryComputed | null>;
  disconnected: Ref<boolean>;
  /** Text for the polite live region. */
  announcement: Ref<string>;
  /** Text of the visible toast, empty when hidden. */
  toast: Ref<string>;
  /** A live trajectory arrived while the operator was in History. */
  hasNew: Ref<boolean>;
  dismissToast(): void;
  stop(): void;
}

export function useLiveState(
  isLiveMode: () => boolean,
  make?: (url: string) => EventSourceLike,
  now: () => number = () => performance.now(),
): LiveState {
  const latest = ref<TrajectoryComputed | null>(null);
  const disconnected = ref(true);
  const announcement = ref('');
  const toast = ref('');
  const hasNew = ref(false);
  let busAt = -Infinity;
  let seenBus = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function say(text: string): void {
    toast.value = text;
    announcement.value = text;
    clearTimeout(timer);
    timer = setTimeout(() => (toast.value = ''), TOAST_MS);
  }

  const close = openLive(
    {
      onOpen: () => {
        seenBus = false;
      },
      onError: () => {
        disconnected.value = true;
      },
      onBus: state => {
        if (!seenBus) {
          seenBus = true;
          busAt = now();
        }
        disconnected.value = state.nats !== 'connected';
      },
      onTrajectory: t => {
        if (latest.value?.launchId === t.launchId) return;
        latest.value = t;
        if (now() - busAt < REPLAY_WINDOW_MS) return;
        if (isLiveMode()) {
          say(`New trajectory ${shortId(t.launchId)} at ${clock(new Date())}: playback reset to 0`);
        } else {
          hasNew.value = true;
          say('New live trajectory available');
        }
      },
    },
    make,
  );

  return {
    latest,
    disconnected,
    announcement,
    toast,
    hasNew,
    dismissToast: () => {
      toast.value = '';
      clearTimeout(timer);
    },
    stop: () => {
      clearTimeout(timer);
      close();
    },
  };
}

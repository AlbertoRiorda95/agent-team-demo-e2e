import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { Sample } from '@albertoriorda95/trajectory-proto';
import { advance, sampleIndexAt, stepTime } from './playback';

/** Playback of a sample list at 1x: t, play/pause/rewind/seek, the current sample. */
export function usePlayback(samples: Ref<readonly Sample[]>) {
  const t = ref(0);
  const playing = ref(false);
  const tLast = computed(() => samples.value[samples.value.length - 1]?.tS ?? 0);
  const index = computed(() => sampleIndexAt(samples.value, t.value));
  const canPlay = computed(() => samples.value.length > 1);
  let raf = 0;
  let last = 0;

  function frame(now: number): void {
    const r = advance(t.value, (now - last) / 1000, tLast.value);
    last = now;
    t.value = r.t;
    if (r.ended) {
      playing.value = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  function play(): void {
    if (!canPlay.value) return;
    if (t.value >= tLast.value) t.value = 0;
    playing.value = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause(): void {
    playing.value = false;
    cancelAnimationFrame(raf);
  }
  function seek(v: number): void {
    t.value = Math.min(Math.max(0, v), tLast.value);
  }
  const rewind = (): void => seek(0);
  const step = (d: number): void => seek(stepTime(samples.value, t.value, d));
  const edge = (end: boolean): void => seek(end ? tLast.value : 0);

  // a new trajectory is shown paused at t = 0
  watch(samples, () => {
    pause();
    t.value = 0;
  });
  onBeforeUnmount(pause);

  return { t, tLast, index, playing, canPlay, play, pause, seek, rewind, step, edge };
}

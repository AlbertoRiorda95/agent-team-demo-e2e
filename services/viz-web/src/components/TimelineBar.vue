<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ t: number; tLast: number; burnEnd: number; playing: boolean; disabled: boolean; canPlay: boolean }>();
const emit = defineEmits<{ play: []; pause: []; rewind: []; seek: [t: number]; step: [delta: number]; edge: [end: boolean] }>();

const burnPct = computed(() => (props.tLast > 0 ? Math.min(100, (props.burnEnd / props.tLast) * 100) : 0));
const text = computed(() => `t = ${props.t.toFixed(2)} s`);

function onKey(e: KeyboardEvent): void {
  const map: Record<string, () => void> = {
    ArrowLeft: () => emit('step', -1),
    ArrowDown: () => emit('step', -1),
    ArrowRight: () => emit('step', 1),
    ArrowUp: () => emit('step', 1),
    Home: () => emit('edge', false),
    End: () => emit('edge', true),
  };
  const fn = map[e.key];
  if (fn) {
    e.preventDefault();
    fn();
  }
}
</script>

<template>
  <div
    class="timeline"
    role="group"
    aria-label="Timeline"
  >
    <button
      type="button"
      :disabled="disabled"
      @click="emit('rewind')"
    >
      Rewind
    </button>
    <button
      type="button"
      :disabled="disabled || !canPlay"
      @click="playing ? emit('pause') : emit('play')"
    >
      {{ playing ? 'Pause' : 'Play' }}
    </button>
    <input
      class="scrub"
      type="range"
      min="0"
      :max="tLast"
      step="any"
      :value="t"
      :disabled="disabled"
      aria-label="Playback time"
      :aria-valuetext="text"
      :style="{ '--burn-pct': `${burnPct}%` }"
      @input="emit('seek', Number(($event.target as HTMLInputElement).value))"
      @keydown="onKey"
    >
    <span class="time">{{ t.toFixed(2) }} / {{ tLast.toFixed(2) }} s</span>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.scrub {
  flex: 1 1 8rem;
  min-height: var(--touch-target);
  accent-color: var(--color-accent);
  background: linear-gradient(to right, var(--color-burn) var(--burn-pct), var(--color-accent) var(--burn-pct)) center / 100% var(--space-1) no-repeat;
  appearance: none;
}
.scrub::-webkit-slider-thumb {
  appearance: none;
  width: var(--space-4);
  height: var(--space-5);
  border-radius: var(--radius-1);
  background: var(--color-fg);
}
.scrub::-moz-range-thumb {
  width: var(--space-4);
  height: var(--space-5);
  border: 0;
  border-radius: var(--radius-1);
  background: var(--color-fg);
}
.time {
  font-family: var(--font-mono);
  color: var(--color-fg-muted);
}
</style>

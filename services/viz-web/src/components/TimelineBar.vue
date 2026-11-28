<script setup lang="ts">
import { computed } from 'vue';
import { SPEEDS } from '../viewer/playback';

const props = defineProps<{ t: number; tLast: number; burnEnd: number; playing: boolean; disabled: boolean; canPlay: boolean; speed: number }>();
const emit = defineEmits<{ play: []; pause: []; rewind: []; seek: [t: number]; step: [delta: number]; stepSeconds: [delta: number]; speed: [value: number]; edge: [end: boolean] }>();

const burnPct = computed(() => (props.tLast > 0 ? Math.min(100, (props.burnEnd / props.tLast) * 100) : 0));
const text = computed(() => `t = ${props.t.toFixed(2)} s`);

function onKey(e: KeyboardEvent): void {
  const map: Record<string, () => void> = {
    ArrowLeft: () => (e.shiftKey ? emit('stepSeconds', -1) : emit('step', -1)),
    ArrowDown: () => (e.shiftKey ? emit('stepSeconds', -1) : emit('step', -1)),
    ArrowRight: () => (e.shiftKey ? emit('stepSeconds', 1) : emit('step', 1)),
    ArrowUp: () => (e.shiftKey ? emit('stepSeconds', 1) : emit('step', 1)),
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
    <label class="speed">
      <span>Speed</span>
      <select
        aria-label="Playback speed"
        :value="speed"
        :disabled="disabled"
        @change="emit('speed', Number(($event.target as HTMLSelectElement).value))"
      >
        <option
          v-for="v in SPEEDS"
          :key="v"
          :value="v"
        >{{ v }}×</option>
      </select>
    </label>
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
.speed {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-fg-muted);
}
.speed select {
  min-height: var(--touch-target);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-1);
  background: var(--color-surface);
  color: var(--color-fg);
  font: inherit;
}
.time {
  font-family: var(--font-mono);
  color: var(--color-fg-muted);
}
</style>

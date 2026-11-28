<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Sample } from '@albertoriorda95/trajectory-proto';
import type { PlaybackState } from '../viewer/interpolate';
import { createScene, type SceneApi } from '../viewer/scene';

const props = defineProps<{
  samples: readonly Sample[];
  index: number;
  state?: PlaybackState;
  label: string;
  loading?: boolean;
  error?: string;
  disconnected?: boolean;
  emptyText: string;
}>();

const host = ref<HTMLElement | null>(null);
const api = shallowRef<SceneApi | null>(null);
const failure = ref('');
let observer: ResizeObserver | undefined;

function draw(): void {
  if (api.value && props.samples.length > 0) {
    api.value.setTrajectory(props.samples);
    if (props.state) api.value.setState(props.state);
  }
}

onMounted(() => {
  if (!host.value) return;
  try {
    api.value = createScene(host.value);
  } catch {
    failure.value = '3D view unavailable: the readout and the table show the data.';
    return;
  }
  observer = new ResizeObserver(() => api.value?.resize());
  observer.observe(host.value);
  api.value.resize();
  draw();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  api.value?.dispose();
});
watch(() => props.samples, draw);
watch(() => props.state, st => st && api.value?.setState(st));

const empty = () => props.samples.length === 0 && !props.loading && !props.error;
</script>

<template>
  <div class="scene">
    <div
      ref="host"
      class="canvas"
      role="img"
      :aria-label="label"
    />
    <p
      v-if="loading"
      class="overlay"
    >
      Loading trajectory…
    </p>
    <p
      v-else-if="error || failure"
      class="overlay error"
      role="alert"
    >
      {{ error || failure }}
    </p>
    <p
      v-else-if="empty()"
      class="overlay"
    >
      {{ emptyText }}
    </p>
    <p
      v-if="disconnected"
      class="badge-overlay"
    >
      Live disconnected
    </p>
    <button
      type="button"
      class="reset"
      :disabled="samples.length === 0"
      @click="api?.resetView()"
    >
      Reset view
    </button>
  </div>
</template>

<style scoped>
.scene {
  position: relative;
  aspect-ratio: 16 / 10;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-1);
  background: var(--color-bg);
  overflow: hidden;
}
.canvas {
  position: absolute;
  inset: 0;
}
.canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  padding: var(--space-4);
  text-align: center;
  color: var(--color-fg-muted);
  pointer-events: none;
}
.overlay.error {
  color: var(--color-danger);
}
.badge-overlay {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  margin: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-1);
  background: var(--color-surface);
  color: var(--color-warning);
}
.reset {
  position: absolute;
  right: var(--space-2);
  bottom: var(--space-2);
}
</style>

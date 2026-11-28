<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Sample } from '@albertoriorda95/trajectory-proto';
import { Sample_Phase } from '@albertoriorda95/trajectory-proto';
import ReadoutPanel from './components/ReadoutPanel.vue';
import SampleTable from './components/SampleTable.vue';
import SceneView from './components/SceneView.vue';
import SummaryPanel from './components/SummaryPanel.vue';
import TimelineBar from './components/TimelineBar.vue';
import { shortId } from './viewer/format';
import { useLiveState } from './viewer/liveState';
import { usePlayback } from './viewer/usePlayback';

const mode = ref<'live' | 'history'>('live');
const live = useLiveState(() => mode.value === 'live');
onBeforeUnmount(live.stop);

// History view: the next task (#6) fills this with the selected launch
const trajectory = computed(() => (mode.value === 'live' ? live.latest.value : null));
const samples = computed<readonly Sample[]>(() => trajectory.value?.samples ?? []);
const pb = usePlayback(samples);
const sample = computed(() => samples.value[pb.index.value]);
const burnEnd = computed(() => {
  const first = samples.value.find(s => s.phase !== Sample_Phase.BURN);
  return first ? first.tS : pb.tLast.value;
});
const label = computed(() => {
  const t = trajectory.value;
  if (!t) return '3D view of the trajectory: none yet';
  return `3D view of trajectory ${shortId(t.launchId)}: ${samples.value.length} samples, flight time ${t.flightTimeS.toFixed(2)} s, range ${t.rangeM.toFixed(1)} m, max height ${t.maxHeightM.toFixed(1)} m`;
});

function choose(m: 'live' | 'history'): void {
  mode.value = m;
  if (m === 'live') live.hasNew.value = false;
}
// a trajectory shown again (back to Live) starts paused at 0
watch(mode, () => pb.rewind());
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Trajectory viewer</h1>
      <div
        class="toggle"
        role="group"
        aria-label="View"
      >
        <button
          type="button"
          :aria-pressed="mode === 'live'"
          @click="choose('live')"
        >
          Live<span
            v-if="live.hasNew.value"
            class="new"
          > new</span>
        </button>
        <button
          type="button"
          :aria-pressed="mode === 'history'"
          @click="choose('history')"
        >
          History
        </button>
      </div>
      <p
        class="status"
        :class="live.disconnected.value ? 'warn' : 'ok'"
      >
        {{ live.disconnected.value ? 'Live disconnected' : 'Live' }}
      </p>
    </header>

    <div
      class="sr-only"
      role="status"
      aria-live="polite"
    >
      {{ live.announcement.value }}
    </div>
    <div
      v-if="live.toast.value"
      class="toast"
      data-testid="toast"
    >
      <span>{{ live.toast.value }}</span>
      <button
        type="button"
        @click="live.dismissToast()"
      >
        Dismiss
      </button>
    </div>

    <main class="grid">
      <div class="main">
        <SceneView
          :samples="samples"
          :index="pb.index.value"
          :label="label"
          :disconnected="mode === 'live' && live.disconnected.value && trajectory !== null"
          :empty-text="mode === 'live' ? 'Waiting for the first trajectory' : 'Select a launch'"
        />
        <TimelineBar
          :t="pb.t.value"
          :t-last="pb.tLast.value"
          :burn-end="burnEnd"
          :playing="pb.playing.value"
          :disabled="samples.length === 0"
          :can-play="pb.canPlay.value"
          @play="pb.play"
          @pause="pb.pause"
          @rewind="pb.rewind"
          @seek="pb.seek"
          @step="pb.step"
          @edge="pb.edge"
        />
      </div>
      <div class="side">
        <ReadoutPanel
          :sample="sample"
          :index="pb.index.value"
          :total="samples.length"
        />
        <SummaryPanel :trajectory="trajectory" />
        <section
          v-if="mode === 'history'"
          class="panel"
          aria-labelledby="history-h"
        >
          <h2 id="history-h">
            History
          </h2>
          <p>The stored launches list arrives with the History view.</p>
        </section>
      </div>
      <div class="wide">
        <SampleTable
          :samples="samples"
          :index="pb.index.value"
          :playing="pb.playing.value"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.page {
  padding: var(--space-4);
}
.header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
h1 {
  margin: 0;
  font-size: var(--font-size-title);
  flex: 1 1 auto;
}
.toggle {
  display: flex;
  gap: var(--space-1);
}
.toggle button[aria-pressed='true'] {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.new {
  margin-left: var(--space-1);
  color: var(--color-warning);
}
.status {
  margin: 0;
  padding: var(--space-1) var(--space-3);
  border: 1px solid;
  border-radius: var(--radius-1);
}
.status.ok {
  color: var(--color-ok);
}
.status.warn {
  color: var(--color-warning);
}
.toast {
  position: fixed;
  top: var(--space-4);
  right: var(--space-4);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  max-width: calc(100vw - var(--space-6));
  padding: var(--space-3);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-1);
  background: var(--color-surface);
}
.grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: minmax(0, 1fr);
}
.side {
  display: grid;
  gap: var(--space-4);
  align-content: start;
}
.panel {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-1);
  background: var(--color-surface);
}
.panel h2 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-body);
}
.panel p {
  margin: 0;
  color: var(--color-fg-muted);
}
@media (min-width: 1100px) {
  .grid {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  }
  .wide {
    grid-column: 1 / -1;
  }
}
</style>

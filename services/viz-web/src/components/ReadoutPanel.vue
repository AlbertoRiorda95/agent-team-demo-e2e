<script setup lang="ts">
import { computed } from 'vue';
import type { PlaybackState } from '../viewer/interpolate';
import { num, phaseLabel } from '../viewer/format';

const props = defineProps<{ state?: PlaybackState; total: number }>();
const dash = '—';
const speed = computed(() => (props.state ? Math.hypot(props.state.vx, props.state.vy, props.state.vz) : 0));
const where = computed(() => {
  const s = props.state;
  if (!s) return 'No sample';
  return s.between ? `between #${s.index} and #${s.index + 1} of ${props.total}` : `sample #${s.index} of ${props.total}`;
});
const rows = computed<Array<[string, string]>>(() => {
  const s = props.state;
  const f = (v: number | undefined, unit: string, d = 2) => (s && v !== undefined ? `${num(v, d)} ${unit}` : dash);
  return [
    ['t', f(s?.t, 's')],
    ['Position x (east)', f(s?.x, 'm')],
    ['Position y (north)', f(s?.y, 'm')],
    ['Position z (up)', f(s?.z, 'm')],
    ['Velocity vx', f(s?.vx, 'm/s')],
    ['Velocity vy', f(s?.vy, 'm/s')],
    ['Velocity vz', f(s?.vz, 'm/s')],
    ['Speed', s ? `${num(speed.value)} m/s` : dash],
    ['Height', f(s?.z, 'm')],
    ['Phase', s ? phaseLabel(s.phase) : dash],
  ];
});
</script>

<template>
  <section
    class="panel"
    aria-labelledby="readout-h"
  >
    <h2 id="readout-h">
      Readout
    </h2>
    <p class="count">
      {{ where }}
    </p>
    <dl>
      <template
        v-for="[k, v] in rows"
        :key="k"
      >
        <dt>{{ k }}</dt>
        <dd>{{ v }}</dd>
      </template>
    </dl>
  </section>
</template>

<style scoped>
.panel {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-1);
  background: var(--color-surface);
}
h2 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-body);
}
.count {
  margin: 0 0 var(--space-2);
  color: var(--color-fg-muted);
  font-family: var(--font-mono);
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-3);
  margin: 0;
}
dt {
  color: var(--color-fg-muted);
}
dd {
  margin: 0;
  font-family: var(--font-mono);
  text-align: right;
}
</style>

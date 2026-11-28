<script setup lang="ts">
import { computed } from 'vue';
import type { Sample } from '@albertoriorda95/trajectory-proto';
import { num, phaseLabel } from '../viewer/format';

const props = defineProps<{ sample?: Sample; index: number; total: number }>();
const dash = '—';
const speed = computed(() => (props.sample ? Math.hypot(props.sample.vxMps, props.sample.vyMps, props.sample.vzMps) : 0));
const rows = computed<Array<[string, string]>>(() => {
  const s = props.sample;
  const f = (v: number | undefined, unit: string, d = 2) => (s && v !== undefined ? `${num(v, d)} ${unit}` : dash);
  return [
    ['t', f(s?.tS, 's')],
    ['Position x (east)', f(s?.xM, 'm')],
    ['Position y (north)', f(s?.yM, 'm')],
    ['Position z (up)', f(s?.zM, 'm')],
    ['Velocity vx', f(s?.vxMps, 'm/s')],
    ['Velocity vy', f(s?.vyMps, 'm/s')],
    ['Velocity vz', f(s?.vzMps, 'm/s')],
    ['Speed', s ? `${num(speed.value)} m/s` : dash],
    ['Height', f(s?.zM, 'm')],
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
      {{ sample ? `sample #${index} of ${total}` : 'No sample' }}
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

<script setup lang="ts">
import { computed } from 'vue';
import type { TrajectoryComputed } from '@albertoriorda95/trajectory-proto';
import { endReasonLabel, num, shortId, timeOf } from '../viewer/format';

const props = defineProps<{ trajectory: TrajectoryComputed | null }>();
const dash = '—';
const rows = computed<Array<[string, string]>>(() => {
  const t = props.trajectory;
  if (!t) return [];
  const r = t.request;
  return [
    ['Launch', shortId(t.launchId)],
    ['Received', timeOf(t.acceptedAt)],
    ['Computed', timeOf(t.computedAt)],
    ['Mass', r ? `${num(r.massKg)} kg` : dash],
    ['Position', r?.position ? `${num(r.position.xM, 1)}, ${num(r.position.yM, 1)}, ${num(r.position.zM, 1)} m` : dash],
    ['Azimuth', r ? `${num(r.azimuthDeg, 1)} °` : dash],
    ['Elevation', r ? `${num(r.elevationDeg, 1)} °` : dash],
    ['Force', r ? `${num(r.forceN)} N` : dash],
    ['Burn duration', r ? `${num(r.burnDurationS)} s` : dash],
    ['End reason', endReasonLabel(t.endReason)],
    ['Flight time', `${num(t.flightTimeS)} s`],
    ['Range', `${num(t.rangeM)} m`],
    ['Max height', `${num(t.maxHeightM)} m`],
  ];
});
</script>

<template>
  <section
    class="panel"
    aria-labelledby="summary-h"
  >
    <h2 id="summary-h">
      Summary
    </h2>
    <p
      v-if="!trajectory"
      class="empty"
    >
      No trajectory
    </p>
    <dl v-else>
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
.empty {
  margin: 0;
  color: var(--color-fg-muted);
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

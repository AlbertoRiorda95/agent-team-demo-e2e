<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Sample } from '@albertoriorda95/trajectory-proto';
import { num, phaseLabel } from '../viewer/format';
import { pageRange } from '../viewer/playback';

const PAGE = 100;
const props = defineProps<{ samples: readonly Sample[]; index: number; playing: boolean }>();
const page = ref(0);
const range = computed(() => pageRange(props.samples.length, page.value, PAGE));
const rows = computed(() => props.samples.slice(range.value.start, range.value.end));
const currentPage = () => Math.floor(props.index / PAGE);
// while paused the page follows the current sample
watch(
  () => [props.index, props.playing, props.samples] as const,
  () => {
    if (!props.playing) page.value = currentPage();
  },
  { immediate: true },
);
const go = (d: number) => (page.value = Math.min(range.value.pages - 1, Math.max(0, page.value + d)));
</script>

<template>
  <section
    class="panel"
    aria-labelledby="samples-h"
  >
    <h2 id="samples-h">
      Samples
    </h2>
    <p
      v-if="samples.length === 0"
      class="empty"
    >
      No samples
    </p>
    <template v-else>
      <div class="pager">
        <button
          type="button"
          :disabled="page === 0"
          @click="go(-1)"
        >
          Previous
        </button>
        <span>Page {{ Math.min(page, range.pages - 1) + 1 }} of {{ range.pages }}</span>
        <button
          type="button"
          :disabled="page >= range.pages - 1"
          @click="go(1)"
        >
          Next
        </button>
        <button
          type="button"
          @click="page = currentPage()"
        >
          Go to current
        </button>
      </div>
      <div
        class="scroll"
        tabindex="0"
        role="region"
        aria-labelledby="samples-h"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">
                seq
              </th><th scope="col">
                t (s)
              </th><th scope="col">
                x (m)
              </th><th scope="col">
                y (m)
              </th>
              <th scope="col">
                z (m)
              </th><th scope="col">
                vx (m/s)
              </th><th scope="col">
                vy (m/s)
              </th><th scope="col">
                vz (m/s)
              </th>
              <th scope="col">
                phase
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in rows"
              :key="s.seq"
              :aria-current="s.seq === samples[index]?.seq ? 'true' : undefined"
            >
              <td>{{ s.seq }}</td>
              <td>{{ num(s.tS) }}</td>
              <td>{{ num(s.xM) }}</td>
              <td>{{ num(s.yM) }}</td>
              <td>{{ num(s.zM) }}</td>
              <td>{{ num(s.vxMps) }}</td>
              <td>{{ num(s.vyMps) }}</td>
              <td>{{ num(s.vzMps) }}</td>
              <td>{{ phaseLabel(s.phase) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-1);
  background: var(--color-surface);
  min-width: 0;
}
h2 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-body);
}
.empty {
  margin: 0;
  color: var(--color-fg-muted);
}
.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
}
th,
td {
  padding: var(--space-1) var(--space-2);
  text-align: right;
  white-space: nowrap;
}
th {
  color: var(--color-fg-muted);
  border-bottom: 1px solid var(--color-border);
}
tr[aria-current='true'] {
  background: var(--color-border);
  outline: 1px solid var(--color-accent);
}
</style>

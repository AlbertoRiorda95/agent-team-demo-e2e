<script setup lang="ts">
import type { LaunchRow } from '../api/history';
import { endReasonShort, num, receivedLabel } from '../viewer/format';

defineProps<{
  rows: readonly LaunchRow[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  selectedId: string;
}>();
const emit = defineEmits<{ select: [id: string]; retry: []; more: [] }>();
</script>

<template>
  <section
    class="panel"
    aria-labelledby="history-h"
    :aria-busy="loading || loadingMore"
  >
    <h2 id="history-h">
      History
    </h2>
    <div
      v-if="loading"
      class="skeleton"
      data-testid="history-loading"
    >
      <p class="muted">
        Loading the history…
      </p>
      <span
        v-for="n in 4"
        :key="n"
        class="bar"
        aria-hidden="true"
      />
    </div>
    <div
      v-else-if="error && rows.length === 0"
      role="alert"
    >
      <p class="error">
        {{ error }}
      </p>
      <button
        type="button"
        @click="emit('retry')"
      >
        Retry
      </button>
    </div>
    <p
      v-else-if="rows.length === 0"
      class="muted"
    >
      No stored launches yet
    </p>
    <template v-else>
      <div class="scroll">
        <table>
          <caption class="sr-only">
            Stored launches, newest first
          </caption>
          <thead>
            <tr>
              <th scope="col">
                Received at
              </th>
              <th scope="col">
                Mass
              </th>
              <th scope="col">
                Force
              </th>
              <th scope="col">
                Elevation
              </th>
              <th scope="col">
                Azimuth
              </th>
              <th scope="col">
                Burn
              </th>
              <th scope="col">
                Flight time
              </th>
              <th scope="col">
                Range
              </th>
              <th scope="col">
                Max height
              </th>
              <th scope="col">
                End reason
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.launchId"
              :aria-selected="r.launchId === selectedId"
              tabindex="0"
              @click="emit('select', r.launchId)"
              @keydown.enter.prevent="emit('select', r.launchId)"
              @keydown.space.prevent="emit('select', r.launchId)"
            >
              <td>{{ receivedLabel(r.receivedAt) }}</td>
              <td>{{ num(r.request.massKg) }} kg</td>
              <td>{{ num(r.request.forceN) }} N</td>
              <td>{{ num(r.request.elevationDeg, 1) }} °</td>
              <td>{{ num(r.request.azimuthDeg, 1) }} °</td>
              <td>{{ num(r.request.burnDurationS) }} s</td>
              <td>{{ num(r.flightTimeS) }} s</td>
              <td>{{ num(r.rangeM) }} m</td>
              <td>{{ num(r.maxHeightM) }} m</td>
              <td>{{ endReasonShort(r.endReason) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-if="error"
        role="alert"
      >
        <p class="error">
          {{ error }}
        </p>
      </div>
      <button
        v-if="hasMore"
        type="button"
        class="more"
        :disabled="loadingMore"
        @click="emit('more')"
      >
        {{ loadingMore ? 'Loading…' : 'Load more' }}
      </button>
    </template>
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
.muted {
  margin: 0;
  color: var(--color-fg-muted);
}
.error {
  margin: 0 0 var(--space-2);
  color: var(--color-danger);
}
.scroll {
  overflow: auto;
  max-height: 24rem;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-family: var(--font-mono);
  white-space: nowrap;
}
th,
td {
  padding: var(--space-2) var(--space-3);
  text-align: left;
}
th {
  color: var(--color-fg-muted);
  border-bottom: 1px solid var(--color-border);
}
tbody tr {
  cursor: pointer;
  min-height: 44px;
}
tbody tr td {
  height: 44px;
}
tbody tr[aria-selected='true'] {
  background: var(--color-bg);
  outline: 1px solid var(--color-accent);
}
.more {
  margin-top: var(--space-3);
}
.skeleton {
  display: grid;
  gap: var(--space-2);
}
.bar {
  height: var(--space-5);
  border-radius: var(--radius-1);
  background: var(--color-border);
}
</style>

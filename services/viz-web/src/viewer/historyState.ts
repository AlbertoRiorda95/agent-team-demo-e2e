import { ref, type Ref } from 'vue';
import type { TrajectoryComputed } from '@albertoriorda95/trajectory-proto';
import { fetchLaunches, fetchTrajectory, type LaunchPage, type LaunchRow } from '../api/history';

export interface HistoryApi {
  list(cursor: string | null): Promise<LaunchPage>;
  trajectory(id: string): Promise<TrajectoryComputed>;
}

const defaultApi: HistoryApi = {
  list: c => fetchLaunches(c),
  trajectory: id => fetchTrajectory(id),
};

const message = (e: unknown): string => (e instanceof Error ? e.message : 'Unexpected error');

export interface HistoryState {
  rows: Ref<LaunchRow[]>;
  loading: Ref<boolean>;
  loadingMore: Ref<boolean>;
  error: Ref<string>;
  hasMore: Ref<boolean>;
  selectedId: Ref<string>;
  trajectory: Ref<TrajectoryComputed | null>;
  trajectoryLoading: Ref<boolean>;
  trajectoryError: Ref<string>;
  /** Text for the polite live region. */
  announcement: Ref<string>;
  /** Load the first page (also the Retry). */
  load(): Promise<void>;
  loadMore(): Promise<void>;
  select(id: string): Promise<void>;
  /** "Back to the list": clears the selection and its error. */
  clearSelection(): void;
}

export function useHistoryState(api: HistoryApi = defaultApi): HistoryState {
  const rows = ref<LaunchRow[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref('');
  const hasMore = ref(false);
  const selectedId = ref('');
  const trajectory = ref<TrajectoryComputed | null>(null);
  const trajectoryLoading = ref(false);
  const trajectoryError = ref('');
  const announcement = ref('');
  let cursor: string | null = null;
  let selecting = 0;

  async function load(): Promise<void> {
    loading.value = true;
    error.value = '';
    announcement.value = 'Loading the history';
    try {
      const page = await api.list(null);
      rows.value = page.items;
      cursor = page.nextCursor;
      hasMore.value = cursor !== null;
      announcement.value = page.items.length ? `${page.items.length} launches loaded` : 'The history is empty';
    } catch (e) {
      error.value = message(e);
      announcement.value = `History failed to load: ${error.value}`;
    } finally {
      loading.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (loadingMore.value || cursor === null) return;
    loadingMore.value = true;
    error.value = '';
    try {
      const page = await api.list(cursor);
      rows.value = [...rows.value, ...page.items];
      cursor = page.nextCursor;
      hasMore.value = cursor !== null;
      announcement.value = `${page.items.length} more launches loaded`;
    } catch (e) {
      error.value = message(e);
      announcement.value = `History failed to load: ${error.value}`;
    } finally {
      loadingMore.value = false;
    }
  }

  async function select(id: string): Promise<void> {
    const mine = ++selecting;
    selectedId.value = id;
    trajectory.value = null;
    trajectoryError.value = '';
    trajectoryLoading.value = true;
    try {
      const t = await api.trajectory(id);
      if (mine !== selecting) return;
      trajectory.value = t;
    } catch (e) {
      if (mine !== selecting) return;
      trajectoryError.value = message(e);
      announcement.value = `Trajectory failed to load: ${trajectoryError.value}`;
    } finally {
      if (mine === selecting) trajectoryLoading.value = false;
    }
  }

  function clearSelection(): void {
    selecting++;
    selectedId.value = '';
    trajectory.value = null;
    trajectoryError.value = '';
    trajectoryLoading.value = false;
  }

  return { rows, loading, loadingMore, error, hasMore, selectedId, trajectory, trajectoryLoading, trajectoryError, announcement, load, loadMore, select, clearSelection };
}

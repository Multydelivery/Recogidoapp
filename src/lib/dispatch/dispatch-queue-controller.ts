import { DispatchApiError } from "./client";
import { createActiveQueuePoller } from "./active-queue-poller";
import type { DispatchNotification, DispatchTransitionTracker } from "./dispatch-notifications";
import { sortActiveRequests, sortHistory } from "./dispatch-queue";
import {
  isFinalHistoryStatus,
  isOnBoard,
  type DispatchHistoryRecord,
  type DispatchHistorySnapshot,
  type DispatchRequest,
  type DispatchSnapshot,
} from "./dispatch-types";

const finishedLimit = 5;

export interface DispatchHistoryState {
  records: DispatchHistoryRecord[];
  /** True once one history response was received; distinguishes "empty" from "not loaded yet". */
  loaded: boolean;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

export interface DispatchQueueState {
  active: DispatchRequest[];
  finished: DispatchRequest[];
  lastUpdated: number | null;
  syncing: boolean;
  error: string | null;
  history: DispatchHistoryState;
}

/** Network calls bound to the current terminal token. Each refresh uses one queue query. */
export interface DispatchQueueApi {
  active: (signal: AbortSignal) => Promise<{ requests: DispatchRequest[] }>;
  status: (requestId: string, signal: AbortSignal) => Promise<DispatchSnapshot>;
  history: (signal: AbortSignal) => Promise<DispatchHistorySnapshot>;
}

export interface DispatchQueueControllerOptions {
  canLoadActive: boolean;
  canLoadHistory: boolean;
  tracker: DispatchTransitionTracker;
  isHidden: () => boolean;
  now?: () => number;
  onState: (state: DispatchQueueState) => void;
  onAuthError: (error: unknown) => void;
  onNotifications: (notifications: readonly DispatchNotification[]) => void;
  onSnapshot: (snapshot: DispatchSnapshot) => void;
}

export const initialHistoryState: DispatchHistoryState = { records: [], loaded: false, loading: false, error: null, lastUpdated: null };

export const initialQueueState: DispatchQueueState = {
  active: [], finished: [], lastUpdated: null, syncing: false, error: null, history: initialHistoryState,
};

function isAuthFailure(error: unknown) {
  return error instanceof DispatchApiError && (error.statusCode === 401 || error.statusCode === 403);
}

export function mergeFinished(incoming: readonly DispatchRequest[], previous: readonly DispatchRequest[]) {
  const ids = new Set(incoming.map((request) => request.requestId));
  return [...incoming, ...previous.filter((request) => !ids.has(request.requestId))].slice(0, finishedLimit);
}

function historyErrorMessage(failure: unknown) {
  if (failure instanceof DispatchApiError && failure.statusCode === 503) return "El historial no está disponible para este restaurante.";
  if (failure instanceof DispatchApiError && failure.statusCode > 0) return failure.message;
  return "No se pudo actualizar el historial.";
}

/**
 * Owns the active queue and the delivery history outside React. Every active refresh issues one query
 * for the whole queue: the active endpoint when the server supports it, otherwise the status of the
 * single request this terminal tracks. The history is never polled: it is loaded on start, after a
 * successful cancellation, when a followed request leaves the board, and on manual refresh.
 * Failures keep the last valid data visible.
 */
export function createDispatchQueueController(options: DispatchQueueControllerOptions) {
  const { canLoadActive, canLoadHistory, tracker } = options;
  const now = options.now ?? Date.now;
  let listeners: Pick<DispatchQueueControllerOptions, "onAuthError" | "onNotifications" | "onSnapshot"> = options;
  let state = initialQueueState;
  let poller: ReturnType<typeof createActiveQueuePoller> | null = null;
  let session = 0;
  let tracked: string | null = null;
  let revision = 0;
  let api: DispatchQueueApi | null = null;
  let historyAbort: AbortController | null = null;
  let historyInFlight: Promise<DispatchHistoryRecord[] | null> | null = null;

  function update(patch: Partial<DispatchQueueState>) {
    state = { ...state, ...patch };
    options.onState(state);
  }

  function updateHistory(patch: Partial<DispatchHistoryState>) {
    update({ history: { ...state.history, ...patch } });
  }

  function notify(notifications: readonly DispatchNotification[]) {
    if (notifications.length) listeners.onNotifications(notifications);
  }

  function stop() {
    session += 1;
    poller?.dispose();
    poller = null;
    historyAbort?.abort();
    historyAbort = null;
    historyInFlight = null;
  }

  /**
   * Loads the restaurant history once. Concurrent callers share the same in-flight request, so
   * a poll, a cancellation and a manual refresh landing together produce a single network call.
   * Resolves with the fresh records, or null when the load failed (previous records are kept).
   */
  function refreshHistory(): Promise<DispatchHistoryRecord[] | null> {
    if (!canLoadHistory || !api) return Promise.resolve(null);
    if (historyInFlight) return historyInFlight;
    const current = session;
    const live = () => current === session;
    const controller = new AbortController();
    historyAbort = controller;
    const load = api.history;
    updateHistory({ loading: true });
    const promise: Promise<DispatchHistoryRecord[] | null> = (async () => {
      try {
        const snapshot = await load(controller.signal);
        if (!live() || controller.signal.aborted) return null;
        const records = sortHistory(snapshot.requests);
        updateHistory({ records, loaded: true, loading: false, error: null, lastUpdated: now() });
        return records;
      } catch (failure: unknown) {
        if (!live() || controller.signal.aborted) return null;
        if (isAuthFailure(failure)) {
          updateHistory({ loading: false });
          listeners.onAuthError(failure);
          return null;
        }
        updateHistory({ loading: false, error: historyErrorMessage(failure) });
        return null;
      } finally {
        if (historyAbort === controller) historyAbort = null;
      }
    })();
    historyInFlight = promise;
    void promise.finally(() => {
      if (historyInFlight === promise) historyInFlight = null;
    });
    return promise;
  }

  /** Final history records for requests that just left this terminal's board. */
  async function finalizedRecords(requestIds: readonly string[]) {
    if (requestIds.length === 0) return [];
    // A load started before the request finished could miss it; wait for it and read once more.
    if (historyInFlight) await historyInFlight;
    const records = await refreshHistory();
    return (records ?? []).filter((record) => requestIds.includes(record.requestId) && isFinalHistoryStatus(record.status));
  }

  function start(nextApi: DispatchQueueApi) {
    stop();
    api = nextApi;
    const current = session;
    const live = () => current === session;
    poller = createActiveQueuePoller({
      isHidden: options.isHidden,
      load: async (signal) => {
        if (!canLoadActive && !tracked) return 0;
        const startRevision = revision;
        let requests: DispatchRequest[] = [];
        let resolved: DispatchRequest[] = [];
        let finalized: DispatchHistoryRecord[] = [];
        update({ syncing: true });
        try {
          if (canLoadActive) {
            requests = (await nextApi.active(signal)).requests.filter(isOnBoard);
            finalized = await finalizedRecords(tracker.missingFrom(requests));
          } else if (tracked) {
            const data = await nextApi.status(tracked, signal);
            if (live()) listeners.onSnapshot(data);
            if (data.request && isOnBoard(data.request)) requests = [data.request];
            else {
              if (data.request) resolved = [data.request];
              tracked = null;
              finalized = await finalizedRecords(resolved.map((request) => request.requestId));
            }
          }
        } finally {
          if (live()) update({ syncing: false });
        }
        if (!live() || signal.aborted) return requests.length;
        // A create/cancel/resend landed while this query was in flight; the poller refetches right away.
        if (startRevision !== revision) return 1;
        const notifications = [...tracker.observe(requests, resolved, finalized), ...tracker.connection(true)];
        update({
          active: sortActiveRequests(requests),
          finished: resolved.length ? mergeFinished(resolved, state.finished) : state.finished,
          lastUpdated: now(),
          error: null,
        });
        notify(notifications);
        return requests.length;
      },
      onError: (failure) => {
        if (!live()) return;
        if (isAuthFailure(failure)) {
          listeners.onAuthError(failure);
          return;
        }
        update({ error: failure instanceof DispatchApiError && failure.statusCode > 0 ? failure.message : "El servidor no respondió." });
        notify(tracker.connection(false));
      },
    });
    void poller.refresh();
    // Initial history load: recorded silently, it never produces toasts or sounds.
    void refreshHistory();
  }

  function upsertActive(request: DispatchRequest) {
    return sortActiveRequests([request, ...state.active.filter((item) => item.requestId !== request.requestId)]);
  }

  return {
    getState: () => state,
    /** Replaces the event callbacks without restarting polling. */
    setListeners(next: typeof listeners) {
      listeners = next;
    },
    start,
    stop,
    refresh() {
      return poller?.refresh() ?? Promise.resolve();
    },
    refreshHistory,
    visibilityChanged() {
      poller?.visibilityChanged();
    },
    /** Silently records the request found while connecting, without announcing it. */
    seed(request: DispatchRequest | null) {
      if (request && isOnBoard(request)) {
        tracker.seed([request]);
        if (!canLoadActive) tracked = request.requestId;
        update({ active: upsertActive(request), lastUpdated: now() });
      } else {
        tracker.seed([]);
        update({ lastUpdated: now() });
      }
    },
    /**
     * Applies a request returned by a confirmed create/cancel/resend response, then refreshes the queue.
     * `silent` still records the transition (so later polls never re-announce it) but lets the caller
     * show its own single message instead of the generic transition toast.
     */
    applyServerRequest(request: DispatchRequest, created = false, applyOptions: { silent?: boolean } = {}) {
      revision += 1;
      const onBoard = isOnBoard(request);
      let notifications: DispatchNotification[];
      if (created) {
        notifications = tracker.created(request);
        if (!onBoard) notifications.push(...tracker.resolved(request));
      } else {
        notifications = onBoard ? tracker.update(request) : tracker.resolved(request);
      }
      if (onBoard) {
        if (!canLoadActive) tracked = request.requestId;
        update({ active: upsertActive(request), lastUpdated: now() });
      } else {
        if (tracked === request.requestId) tracked = null;
        update({
          active: state.active.filter((item) => item.requestId !== request.requestId),
          finished: mergeFinished([request], state.finished),
          lastUpdated: now(),
        });
      }
      if (!applyOptions.silent) notify(notifications);
      void poller?.refresh();
    },
    dismissFinished(requestId: string) {
      update({ finished: state.finished.filter((request) => request.requestId !== requestId) });
    },
    /** Stops polling and forgets every in-memory trace of the queue and history (used when disconnecting). */
    clear() {
      stop();
      api = null;
      revision += 1;
      tracker.reset();
      tracked = null;
      update(initialQueueState);
    },
  };
}

export type DispatchQueueController = ReturnType<typeof createDispatchQueueController>;

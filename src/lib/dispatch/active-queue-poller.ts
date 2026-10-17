/** Active orders are refreshed this often while visible (one request for the whole queue). */
export const activeQueuePollIntervalMs = 4000;

interface QueuePollerOptions {
  load: (signal: AbortSignal) => Promise<number>;
  onError: (error: unknown) => void;
  isHidden: () => boolean;
}

export function createActiveQueuePoller({ load, onError, isHidden }: QueuePollerOptions) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pendingRefresh = false;
  let disposed = false;
  let hasActive = false;

  function clearTimer() {
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
  }

  async function refresh() {
    clearTimer();
    if (disposed || isHidden()) return;
    if (running) {
      pendingRefresh = true;
      return;
    }
    pendingRefresh = false;
    running = true;
    let failed = false;
    try {
      hasActive = (await load(controller.signal)) > 0;
    } catch (error: unknown) {
      failed = true;
      if (!disposed) onError(error);
    } finally {
      running = false;
      if (!disposed && !isHidden()) {
        if (pendingRefresh) {
          pendingRefresh = false;
          void refresh();
        } else if (hasActive || failed) {
          timeout = setTimeout(() => void refresh(), activeQueuePollIntervalMs);
        }
      }
    }
  }

  return {
    refresh,
    visibilityChanged() {
      clearTimer();
      if (!isHidden()) void refresh();
    },
    dispose() {
      disposed = true;
      clearTimer();
      controller.abort();
    },
  };
}

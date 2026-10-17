"use client";

import { useEffect, useMemo, useState } from "react";
import { activeDispatchApi, dispatchApi, historyDispatchApi } from "@/lib/dispatch/client";
import { createSeenStore, DispatchTransitionTracker, type DispatchNotification } from "@/lib/dispatch/dispatch-notifications";
import {
  createDispatchQueueController,
  initialQueueState,
  type DispatchQueueState,
} from "@/lib/dispatch/dispatch-queue-controller";
import type { DispatchCapabilities, DispatchSnapshot } from "@/lib/dispatch/dispatch-types";

function sessionStore() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** React binding for the dispatch queue controller: one query per refresh for the whole queue. */
export function useDispatchQueue({ restaurantId, token, capabilities, onAuthError, onNotifications, onSnapshot }: {
  restaurantId: string;
  token: string | null;
  capabilities: Pick<DispatchCapabilities, "canLoadActive" | "canLoadHistory">;
  onAuthError: (error: unknown) => void;
  onNotifications: (notifications: readonly DispatchNotification[]) => void;
  onSnapshot: (snapshot: DispatchSnapshot) => void;
}) {
  const [state, setState] = useState<DispatchQueueState>(initialQueueState);
  const { canLoadActive, canLoadHistory } = capabilities;

  const controller = useMemo(() => createDispatchQueueController({
    canLoadActive,
    canLoadHistory,
    tracker: new DispatchTransitionTracker(createSeenStore(sessionStore(), `recogido:dispatch-notified:${restaurantId}`)),
    isHidden: () => typeof document !== "undefined" && document.visibilityState !== "visible",
    onState: setState,
    onAuthError: () => {},
    onNotifications: () => {},
    onSnapshot: () => {},
  }), [restaurantId, canLoadActive, canLoadHistory]);

  useEffect(() => {
    controller.setListeners({ onAuthError, onNotifications, onSnapshot });
  }, [controller, onAuthError, onNotifications, onSnapshot]);

  useEffect(() => {
    if (!token) return;
    controller.start({
      active: (signal) => activeDispatchApi(restaurantId, token, signal),
      status: (requestId, signal) => dispatchApi("status", restaurantId, token, signal, { requestId }),
      history: (signal) => historyDispatchApi(restaurantId, token, signal),
    });
    const onVisibility = () => controller.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controller.stop();
    };
  }, [controller, restaurantId, token]);

  return useMemo(() => ({
    ...state,
    refresh: () => void controller.refresh(),
    refreshHistory: () => void controller.refreshHistory(),
    seed: controller.seed,
    applyServerRequest: controller.applyServerRequest,
    dismissFinished: controller.dismissFinished,
    clear: controller.clear,
  }), [state, controller]);
}

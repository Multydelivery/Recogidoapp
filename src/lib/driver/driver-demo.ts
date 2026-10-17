import type {
  DriverAcceptancePolicy,
  DriverActiveStatus,
  DriverAvailability,
  DriverDelivery,
  DriverHistoryItem,
  DriverNotification,
  DriverNotificationTone,
  DriverOffer,
  DriverProfile,
  DriverTab,
} from "./driver-types";

/**
 * DEMO ONLY: everything in this module is simulated and kept in memory.
 * It never calls Twilio, Make, WhatsApp or any API, and it must not be mixed with real dispatch data.
 */

export const driverDemoProfile: DriverProfile = { name: "Maria Elizabeth", firstName: "Maria" };

/** Phase 1 demo rules: one active delivery per restaurant and at most three in total. */
export const driverDemoPolicy: DriverAcceptancePolicy = {
  maxActiveDeliveries: 3,
  maxActivePerRestaurant: 1,
};

export const driverDemoSimulatedDelayMs = 700;
export const driverHistoryLimit = 5;

export const driverMessages = {
  unavailable: "Está como No disponible. Active Disponible para aceptar ofertas.",
  sameRestaurant: "Ya tiene una entrega activa de este restaurante. Puede aceptar ofertas de otros restaurantes.",
  capacity: `Alcanzó su capacidad máxima de ${driverDemoPolicy.maxActiveDeliveries} entregas activas.`,
  busy: "Espere a que termine la acción en curso.",
  simulatedError: "No se pudo completar la acción (error simulado). Intente de nuevo.",
} as const;

export const driverActiveStatuses: readonly DriverActiveStatus[] = ["accepted", "assigned", "picked_up"];

export function isActiveDelivery(delivery: Pick<DriverDelivery, "status">): boolean {
  return (driverActiveStatuses as readonly string[]).includes(delivery.status);
}

export function activeDeliveryCount(state: Pick<DriverDemoState, "activeDeliveries">, restaurantId?: string): number {
  return state.activeDeliveries.filter((delivery) => isActiveDelivery(delivery)
    && (restaurantId === undefined || delivery.restaurantId === restaurantId)).length;
}

export type DriverPendingAction = { kind: "accept" | "pickup" | "complete"; offerId: string };

export interface DriverDemoState {
  driver: DriverProfile;
  availability: DriverAvailability;
  offers: DriverOffer[];
  activeDeliveries: DriverDelivery[];
  /** In-memory session history, newest first, at most five items. */
  history: DriverHistoryItem[];
  pending: DriverPendingAction | null;
  confirmingCompletionId: string | null;
  notification: DriverNotification | null;
  nextNotificationId: number;
  tab: DriverTab;
  simulateNextError: boolean;
}

export type DriverDemoAction =
  | { type: "set_availability"; availability: DriverAvailability }
  | { type: "set_tab"; tab: DriverTab }
  | { type: "accept_start"; offerId: string }
  | { type: "accept_success"; offerId: string; at: string }
  | { type: "decline_offer"; offerId: string }
  | { type: "pickup_start"; offerId: string }
  | { type: "pickup_success"; offerId: string; at: string }
  | { type: "request_completion"; offerId: string }
  | { type: "cancel_completion" }
  | { type: "complete_start"; offerId: string }
  | { type: "complete_success"; offerId: string; at: string }
  | { type: "action_failed"; message?: string }
  | { type: "dismiss_notification" }
  | { type: "set_simulated_error"; enabled: boolean }
  | { type: "reset_offers"; now: number };

export const driverDemoRestaurants = {
  laFonda: { restaurantId: "la-fonda-englewood", restaurantName: "La Fonda" },
  brisas: { restaurantId: "brisas-englewood", restaurantName: "Brisas Englewood" },
  jadeLee: { restaurantId: "jade-lee-englewood", restaurantName: "Jade Lee Englewood" },
} as const;

export function createDemoOffers(now: number): DriverOffer[] {
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const offer = (
    offerId: string,
    orderNumber: string,
    restaurant: (typeof driverDemoRestaurants)[keyof typeof driverDemoRestaurants],
    assignmentLabel: string,
    minutes: number,
  ): DriverOffer => ({
    offerId, orderNumber, ...restaurant, assignmentLabel, assignmentMode: "individual",
    createdAt: minutesAgo(minutes), status: "available", assignedAt: null, pickedUpAt: null, completedAt: null,
  });
  return [
    offer("demo-offer-1", "E814C7-01", driverDemoRestaurants.laFonda, "Entrega 1 de 3", 1),
    offer("demo-offer-2", "A912D3-01", driverDemoRestaurants.brisas, "Entrega 1 de 2", 3),
    offer("demo-offer-3", "B527F9-01", driverDemoRestaurants.jadeLee, "Entrega 1 de 2", 6),
    offer("demo-offer-4", "E814C7-02", driverDemoRestaurants.laFonda, "Entrega 2 de 3", 1),
    offer("demo-offer-5", "A912D3-02", driverDemoRestaurants.brisas, "Entrega 2 de 2", 3),
  ];
}

export function createDriverDemoState(now: number): DriverDemoState {
  return {
    driver: driverDemoProfile,
    availability: "available",
    offers: createDemoOffers(now),
    activeDeliveries: [],
    history: [],
    pending: null,
    confirmingCompletionId: null,
    notification: null,
    nextNotificationId: 1,
    tab: "offers",
    simulateNextError: false,
  };
}

/** Public label for an order. Internal request IDs (WEB…) are never shown. */
export function orderLabel(orderNumber: string): string {
  const code = orderNumber.replace(/^#/, "").trim();
  if (!code || /^WEB/i.test(code)) return "Pedido";
  return `#${code}`;
}

export function visibleOffers(state: DriverDemoState): DriverOffer[] {
  return state.offers.filter((offer) => offer.status === "available");
}

export type AcceptCheck = { ok: true } | { ok: false; reason: string };

export function canAcceptOffer(
  state: DriverDemoState,
  offer: DriverOffer,
  policy: DriverAcceptancePolicy = driverDemoPolicy,
): AcceptCheck {
  if (state.availability !== "available") return { ok: false, reason: driverMessages.unavailable };
  if (state.pending) return { ok: false, reason: driverMessages.busy };
  if (offer.status !== "available") return { ok: false, reason: "Esta oferta ya no está disponible." };
  if (activeDeliveryCount(state) >= policy.maxActiveDeliveries) {
    return { ok: false, reason: `Alcanzó su capacidad máxima de ${policy.maxActiveDeliveries} entregas activas.` };
  }
  if (activeDeliveryCount(state, offer.restaurantId) >= policy.maxActivePerRestaurant) {
    return { ok: false, reason: driverMessages.sameRestaurant };
  }
  return { ok: true };
}

function notify(state: DriverDemoState, tone: DriverNotificationTone, message: string): DriverDemoState {
  return {
    ...state,
    notification: { id: state.nextNotificationId, tone, message },
    nextNotificationId: state.nextNotificationId + 1,
  };
}

function findActive(state: DriverDemoState, offerId: string) {
  return state.activeDeliveries.find((delivery) => delivery.offerId === offerId);
}

export function driverDemoReducer(state: DriverDemoState, action: DriverDemoAction): DriverDemoState {
  switch (action.type) {
    case "set_availability": {
      if (state.availability === action.availability) return state;
      const next = { ...state, availability: action.availability };
      return action.availability === "available"
        ? notify(next, "info", "Ahora está Disponible para recibir ofertas.")
        : notify(next, "info", state.activeDeliveries.length > 1
          ? "Ahora está No disponible. Sus entregas activas se conservan."
          : state.activeDeliveries.length
          ? "Ahora está No disponible. Su entrega activa se conserva."
          : "Ahora está No disponible. No recibirá ofertas nuevas.");
    }
    case "set_tab":
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
    case "accept_start": {
      if (state.pending) return state;
      const offer = state.offers.find((item) => item.offerId === action.offerId);
      if (!offer) return state;
      const check = canAcceptOffer(state, offer);
      if (!check.ok) return notify(state, "error", check.reason);
      return { ...state, pending: { kind: "accept", offerId: offer.offerId } };
    }
    case "accept_success": {
      if (state.pending?.kind !== "accept" || state.pending.offerId !== action.offerId) return state;
      const offer = state.offers.find((item) => item.offerId === action.offerId);
      if (!offer) return { ...state, pending: null };
      if (state.availability !== "available") return notify({ ...state, pending: null }, "error", driverMessages.unavailable);
      const delivery: DriverDelivery = {
        offerId: offer.offerId, orderNumber: offer.orderNumber, restaurantId: offer.restaurantId,
        restaurantName: offer.restaurantName, assignmentLabel: offer.assignmentLabel, assignmentMode: offer.assignmentMode,
        driverName: state.driver.name, status: "assigned", assignedAt: action.at, pickedUpAt: null, completedAt: null,
      };
      return notify({
        ...state,
        pending: null,
        offers: state.offers.filter((item) => item.offerId !== offer.offerId),
        activeDeliveries: [...state.activeDeliveries, delivery],
        tab: "active",
      }, "success", `Entrega ${orderLabel(offer.orderNumber)} asignada correctamente.`);
    }
    case "decline_offer": {
      if (state.pending) return state;
      const offer = state.offers.find((item) => item.offerId === action.offerId && item.status === "available");
      if (!offer) return state;
      return notify({
        ...state,
        offers: state.offers.map((item) => item.offerId === offer.offerId ? { ...item, status: "declined" } : item),
      }, "info", `Oferta ${orderLabel(offer.orderNumber)} rechazada.`);
    }
    case "pickup_start": {
      const status = findActive(state, action.offerId)?.status;
      if (state.pending || (status !== "accepted" && status !== "assigned")) return state;
      return { ...state, pending: { kind: "pickup", offerId: action.offerId } };
    }
    case "pickup_success": {
      if (state.pending?.kind !== "pickup" || state.pending.offerId !== action.offerId) return state;
      const delivery = findActive(state, action.offerId);
      if (!delivery) return { ...state, pending: null };
      return notify({
        ...state,
        pending: null,
        activeDeliveries: state.activeDeliveries.map((item) => item.offerId === action.offerId
          ? { ...item, status: "picked_up", pickedUpAt: action.at } : item),
      }, "success", `Pedido ${orderLabel(delivery.orderNumber)} recogido. Entrega en camino.`);
    }
    case "request_completion": {
      if (state.pending || findActive(state, action.offerId)?.status !== "picked_up") return state;
      return { ...state, confirmingCompletionId: action.offerId };
    }
    case "cancel_completion":
      return state.pending ? state : { ...state, confirmingCompletionId: null };
    case "complete_start": {
      if (state.pending || state.confirmingCompletionId !== action.offerId) return state;
      if (findActive(state, action.offerId)?.status !== "picked_up") return state;
      return { ...state, pending: { kind: "complete", offerId: action.offerId } };
    }
    case "complete_success": {
      if (state.pending?.kind !== "complete" || state.pending.offerId !== action.offerId) return state;
      const delivery = findActive(state, action.offerId);
      if (!delivery?.pickedUpAt) return { ...state, pending: null, confirmingCompletionId: null };
      const item: DriverHistoryItem = {
        ...delivery,
        status: "completed",
        pickedUpAt: delivery.pickedUpAt,
        completedAt: action.at,
        durationMs: Math.max(0, Date.parse(action.at) - Date.parse(delivery.assignedAt)),
      };
      return notify({
        ...state,
        pending: null,
        confirmingCompletionId: null,
        activeDeliveries: state.activeDeliveries.filter((entry) => entry.offerId !== action.offerId),
        history: [item, ...state.history].slice(0, driverHistoryLimit),
      }, "success", `Entrega ${orderLabel(delivery.orderNumber)} completada correctamente.`);
    }
    case "action_failed":
      return notify({ ...state, pending: null }, "error", action.message ?? driverMessages.simulatedError);
    case "dismiss_notification":
      return state.notification ? { ...state, notification: null } : state;
    case "set_simulated_error":
      return { ...state, simulateNextError: action.enabled };
    case "reset_offers": {
      if (state.pending) return state;
      const activeIds = new Set(state.activeDeliveries.map((delivery) => delivery.offerId));
      return notify({
        ...state,
        offers: createDemoOffers(action.now).filter((offer) => !activeIds.has(offer.offerId)),
      }, "info", "Ofertas de demostración restablecidas.");
    }
  }
}

/** Blocks concurrent simulated actions synchronously, before React re-renders (double tap protection). */
export function createActionGate() {
  let busy = false;
  return {
    get busy() { return busy; },
    tryEnter(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    leave() { busy = false; },
  };
}

export type DriverTimelineStepKey = "assigned" | "picked_up" | "on_the_way" | "completed";
export type DriverTimelineStepState = "done" | "current" | "upcoming";

export const driverTimelineSteps: { key: DriverTimelineStepKey; label: string }[] = [
  { key: "assigned", label: "Conductor asignado" },
  { key: "picked_up", label: "Pedido recogido" },
  { key: "on_the_way", label: "En camino" },
  { key: "completed", label: "Entrega completada" },
];

export function driverTimeline(status: DriverDelivery["status"]) {
  const doneCount = status === "picked_up" ? 2 : status === "completed" ? 4 : 1;
  return driverTimelineSteps.map((step, index) => ({
    ...step,
    state: (index < doneCount ? "done" : index === doneCount ? "current" : "upcoming") as DriverTimelineStepState,
  }));
}

const assignedText = { label: "Conductor asignado", detail: "Diríjase al restaurante para recoger el pedido." };

export const driverStatusText: Record<DriverDelivery["status"], { label: string; detail: string }> = {
  accepted: assignedText,
  assigned: assignedText,
  picked_up: { label: "En camino", detail: "Pedido recogido. Entregue el pedido al cliente." },
  completed: { label: "Entrega completada", detail: "El pedido fue entregado." },
  cancelled: { label: "Cancelada", detail: "La entrega fue cancelada." },
};

export function assignmentModeLabel(mode: DriverOffer["assignmentMode"]): string {
  return mode === "batch" ? "Lote" : "Individual";
}

export function formatDriverTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("es-US", { hour: "numeric", minute: "2-digit" });
}

export function formatElapsed(fromIso: string, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - Date.parse(fromIso)) / 60_000);
  if (minutes < 1) return "Hace menos de 1 min";
  if (minutes < 60) return `Hace ${minutes} min`;
  return `Hace ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min ${totalSeconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

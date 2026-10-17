import { driverTokenKey, type DriverAction, type LiveConfig, type LiveDashboard } from "./live-types";

class DriverClientError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
interface LiveState {
  online: boolean;
  authenticated: boolean;
  loading: boolean;
  refreshing: boolean;
  dashboard: LiveDashboard | null;
  pending: ReadonlySet<string>;
  message: string;
  refreshedAt: number | null;
}
interface Dependencies {
  online?: () => boolean;
  fetch: typeof fetch;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  visible: () => boolean;
  setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
}
const initial = (): LiveState => ({ online: true, authenticated: false, loading: false, refreshing: false,
  dashboard: null, pending: new Set(), message: "", refreshedAt: null });

export function createDriverLiveController(deps: Dependencies) {
  let state = initial();
  let token = "";
  let generation = 0;
  let refreshVersion = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const requests = new Set<AbortController>();
  const publish = (patch: Partial<LiveState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const removeToken = () => {
    try { deps.storage.removeItem(driverTokenKey); }
    catch { publish({ message: "No se pudo borrar el PIN del dispositivo. Borre los datos del sitio." }); }
  };
  const stop = () => {
    generation++;
    refreshVersion++;
    if (interval !== undefined) deps.clearInterval(interval);
    interval = undefined;
    requests.forEach((request) => request.abort());
    requests.clear();
    publish({ loading: false, refreshing: false, pending: new Set() });
  };
  const logout = () => {
    stop();
    token = "";
    publish({ ...initial(), online: state.online });
    removeToken();
  };
  const fail = (error: unknown) => {
    if (!state.online) {
      publish({ message: "Sin conexión. Las acciones están deshabilitadas." });
      return;
    }
    const message = error instanceof DriverClientError ? error.message : "No se pudo conectar. Inténtelo nuevamente.";
    if (error instanceof DriverClientError && error.status === 401) logout();
    publish({ message });
  };
  async function api<T>(operation: string, action?: DriverAction): Promise<T> {
    if (!state.online || deps.online?.() === false) {
      throw new DriverClientError(0, "Sin conexión. Las acciones están deshabilitadas.");
    }
    const abort = new AbortController();
    requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 15_000);
    try {
      const response = await deps.fetch(`/api/driver/maria-elizabeth/${operation}`, {
        method: action ? "POST" : "GET", cache: "no-store", signal: abort.signal,
        headers: { "X-Device-Token": token, ...(action ? { "Content-Type": "application/json" } : {}) },
        ...(action ? { body: JSON.stringify(action) } : {}),
      });
      const data = await response.json();
      if (!response.ok) {
        const messages: Record<number, string> = {
          401: "PIN incorrecto. Inténtelo nuevamente.", 403: "Conductor no habilitado.",
          404: "El pedido ya no está disponible.",
          409: "Conflicto de capacidad, restaurante o pedido tomado. Se actualizarán las ofertas.",
          502: "Twilio no pudo completar la operación. Inténtelo nuevamente.",
          503: "El piloto está desactivado o no está configurado.",
          429: "Demasiados intentos. Espere antes de intentar nuevamente.",
        };
        throw new DriverClientError(response.status, messages[response.status] ?? "No se pudo completar la operación.");
      }
      return data as T;
    } finally { clearTimeout(timeout); requests.delete(abort); }
  }
  async function refresh() {
    if (!token || !state.authenticated || !state.online || deps.online?.() === false) return;
    const session = generation;
    const version = ++refreshVersion;
    publish({ refreshing: true });
    try {
      const dashboard = await api<LiveDashboard>("dashboard");
      if (session === generation && version === refreshVersion) publish({ dashboard, refreshedAt: Date.now() });
    } catch (error) {
      if (session === generation && version === refreshVersion) fail(error);
    } finally {
      if (session === generation && version === refreshVersion) publish({ refreshing: false });
    }
  }
  async function login(pin: string) {
    if (state.loading) return;
    if (!state.online || deps.online?.() === false) {
      publish({ message: "Sin conexión. Las acciones están deshabilitadas." });
      return;
    }
    stop();
    const session = generation;
    token = pin;
    publish({ loading: true, message: "" });
    try {
      await api<LiveConfig>("config");
      if (session !== generation) return;
      try { deps.storage.setItem(driverTokenKey, pin); }
      catch { throw new DriverClientError(0, "No se pudo guardar el PIN en este dispositivo."); }
      publish({ authenticated: true });
      await refresh();
      if (session === generation && state.authenticated) {
        interval = deps.setInterval(() => {
          if (state.online && deps.visible() && !state.refreshing && state.pending.size === 0) void refresh();
        }, 8000);
      }
    } catch (error) {
      if (session === generation) fail(error);
    } finally { if (session === generation) publish({ loading: false }); }
  }
  async function act(action: DriverAction) {
    if (!state.online || deps.online?.() === false) {
      publish({ message: "Sin conexión. Las acciones están deshabilitadas." });
      return;
    }
    const key = action.action === "set_availability" ? "availability" : action.orderNumber;
    if (!state.authenticated || state.pending.has(key)) return;
    if (action.action === "accept") {
      const offer = state.dashboard?.offers.find((offer) => offer.orderNumber === action.orderNumber);
      if (!offer?.canAccept) {
        publish({ message: offer?.blockReason ?? "Esta oferta no está disponible." });
        return;
      }
    }
    const session = generation;
    publish({ pending: new Set([...state.pending, key]), message: "" });
    try {
      await api("action", action);
      if (session !== generation) return;
      publish({ message: "Acción confirmada. Actualizando los datos." });
      await refresh();
    } catch (error) {
      if (session !== generation) return;
      fail(error);
      if (error instanceof DriverClientError && (error.status === 409 || error.status === 404)) await refresh();
    } finally {
      if (session === generation) {
        const pending = new Set(state.pending);
        pending.delete(key);
        publish({ pending });
      }
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async start() {
      try {
        const saved = deps.storage.getItem(driverTokenKey);
        if (saved) await login(saved);
      } catch { publish({ message: "No se pudo acceder al almacenamiento del dispositivo." }); }
    },
    setOnline(online: boolean) {
      if (state.online === online) return;
      publish({ online, message: online ? "Conexión restaurada" : "Sin conexión. Las acciones están deshabilitadas." });
      if (online) void refresh();
      else requests.forEach((request) => request.abort());
    },
    stop, login, logout, refresh, act,
  };
}

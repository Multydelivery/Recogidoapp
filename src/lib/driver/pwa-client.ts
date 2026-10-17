export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function isDriverStandalone(displayMode: boolean, iosStandalone?: boolean) {
  return displayMode || iosStandalone === true;
}

export function isIosSafari(userAgent: string, touchPoints: number) {
  return (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) &&
    /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}

export function watchDriverWorker(
  container: ServiceWorkerContainer,
  callbacks: { waiting: (ready: boolean) => void; error: (message: string) => void; reload: () => void },
  enabled = process.env.NODE_ENV === "production",
) {
  let disposed = false;
  let registration: ServiceWorkerRegistration | undefined;
  let installing: ServiceWorker | null = null;
  let updateRequested = false;
  let reloaded = false;
  const error = () => {
    if (!disposed) callbacks.error("La instalación o actualización no pudo prepararse. Inténtelo al volver a abrir Recogido.");
  };
  const controllerChanged = () => {
    if (disposed || !updateRequested || reloaded) return;
    reloaded = true;
    callbacks.reload();
  };
  const checkWaiting = () => {
    if (!disposed) callbacks.waiting(Boolean(registration?.waiting));
  };
  const stateChanged = () => {
    if (installing?.state === "redundant") error();
    if (installing?.state === "installed") checkWaiting();
  };
  const updateFound = () => {
    installing?.removeEventListener("statechange", stateChanged);
    installing = registration?.installing ?? null;
    installing?.addEventListener("statechange", stateChanged);
  };
  if (enabled) {
    container.addEventListener("controllerchange", controllerChanged);
    void container.register("/driver/sw.js", { scope: "/driver/", updateViaCache: "none" }).then((value) => {
      if (disposed) return;
      registration = value;
      registration.addEventListener("updatefound", updateFound);
      updateFound();
      checkWaiting();
    }).catch(error);
  }
  return {
    update() {
      if (disposed || updateRequested) return;
      const worker = registration?.waiting;
      if (!worker) { checkWaiting(); return; }
      updateRequested = true;
      try { worker.postMessage({ type: "ACTIVATE_UPDATE" }); }
      catch { updateRequested = false; error(); }
    },
    dispose() {
      disposed = true;
      container.removeEventListener("controllerchange", controllerChanged);
      registration?.removeEventListener("updatefound", updateFound);
      installing?.removeEventListener("statechange", stateChanged);
    },
  };
}

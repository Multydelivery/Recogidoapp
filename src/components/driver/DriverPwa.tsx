"use client";

import { useEffect, useRef, useState } from "react";
import { isDriverStandalone, isIosSafari, watchDriverWorker, type InstallPromptEvent } from "@/lib/driver/pwa-client";
import styles from "./DriverPwa.module.css";

const iosDismissedKey = "recogido:driver-ios-install-dismissed";

export function DriverPwa() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [iosHelp, setIosHelp] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState("");
  const worker = useRef<ReturnType<typeof watchDriverWorker> | null>(null);
  const installBusy = useRef(false);
  const installDismissed = useRef(false);

  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const dismissed = () => {
      try { return localStorage.getItem(iosDismissedKey) === "true"; }
      catch { setMessage("No se pudo leer la preferencia de instalación del dispositivo."); return false; }
    };
    const updateDisplay = () => {
      const installed = isDriverStandalone(display.matches, "standalone" in navigator && navigator.standalone === true);
      setStandalone(installed);
      setIosHelp(!installed && !dismissed() && isIosSafari(navigator.userAgent, navigator.maxTouchPoints));
      if (installed) setPrompt(null);
    };
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      if (!installDismissed.current) setPrompt(event as InstallPromptEvent);
    };
    const installed = () => {
      setStandalone(true);
      setPrompt(null);
      setIosHelp(false);
      setMessage("Recogido está instalado.");
    };
    const preferenceChanged = (event: StorageEvent) => {
      if (event.key !== iosDismissedKey) return;
      updateDisplay();
    };
    updateDisplay();
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    window.addEventListener("storage", preferenceChanged);
    display.addEventListener("change", updateDisplay);
    if ("serviceWorker" in navigator) {
      worker.current = watchDriverWorker(navigator.serviceWorker, {
        waiting: (ready) => { setWaiting(ready); if (!ready) setUpdating(false); },
        error: (text) => { setMessage(text); setUpdating(false); },
        reload: () => window.location.reload(),
      });
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
      window.removeEventListener("storage", preferenceChanged);
      display.removeEventListener("change", updateDisplay);
      worker.current?.dispose();
      worker.current = null;
    };
  }, []);

  const install = async () => {
    if (!prompt || installBusy.current || standalone) return;
    installBusy.current = true;
    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "dismissed") installDismissed.current = true;
      setMessage(choice.outcome === "accepted" ? "Instalación solicitada." : "Instalación cancelada. Puede instalar desde el menú del navegador.");
    } catch { setMessage("No se pudo abrir la instalación. Inténtelo desde el menú del navegador."); }
    finally {
      setPrompt(null);
      installBusy.current = false;
      setInstalling(false);
    }
  };
  const dismissIos = () => {
    setIosHelp(false);
    try { localStorage.setItem(iosDismissedKey, "true"); }
    catch { setMessage("No se pudo guardar la preferencia. Las instrucciones podrían aparecer al volver a abrir Recogido."); }
  };

  if (!waiting && (standalone || (!prompt && !iosHelp)) && !message) return null;
  return (
    <aside className={styles.toolbar} aria-label="Instalar Recogido">
      {!standalone && prompt && <button type="button" disabled={installing} onClick={() => void install()}>
        {installing ? "INSTALANDO…" : "INSTALAR APLICACIÓN"}
      </button>}
      {!standalone && iosHelp && <div className={styles.instructions}>
        <strong>Instalar Recogido en iPhone o iPad</strong>
        <ol>
          <li>Presione Compartir.</li>
          <li>Seleccione “Agregar a pantalla de inicio”.</li>
          <li>Confirme “Agregar”.</li>
        </ol>
        <button type="button" onClick={dismissIos}>Cerrar instrucciones</button>
      </div>}
      {waiting && <div className={styles.update} role="status" aria-live="polite">
        <span>Hay una nueva versión de Recogido disponible.</span>
        <button type="button" disabled={updating} onClick={() => {
          setUpdating(true);
          worker.current?.update();
        }}>{updating ? "ACTUALIZANDO…" : "ACTUALIZAR"}</button>
      </div>}
      {message && <p role="status" aria-live="polite">{message}</p>}
    </aside>
  );
}

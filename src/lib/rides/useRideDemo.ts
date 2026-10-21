"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  addRide, createRide, decodeRideSession, rideStorageKey, updateRide,
  type RideAction, type RideInput, type RideSession,
} from "./demo";
import { advanceDemoSession, demoRideProvider, demoTickIntervalMs } from "./simulator";

const changeEvent = "recogido-rides-demo-change";
const loading = "__rides_loading__";
const unavailable = "__rides_unavailable__";
const migrationFailed = "__rides_migration_failed__";
let migrationError: string | null = null;

function normalizeStorage() {
  try {
    const raw = window.sessionStorage.getItem(rideStorageKey);
    if (raw !== null) {
      const normalized = JSON.stringify(advanceDemoSession(decodeRideSession(raw), new Date().toISOString()));
      if (raw !== normalized) window.sessionStorage.setItem(rideStorageKey, normalized);
    }
    migrationError = null;
  } catch (error) {
    migrationError = error instanceof Error ? error.message : "No se pudo persistir la migración del demo.";
  }
}

function subscribe(callback: () => void) {
  const onChange = () => { normalizeStorage(); callback(); };
  const onStorage = (event: StorageEvent) => {
    if (event.key === rideStorageKey || event.key === null) onChange();
  };
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", onChange);
  onChange();
  const timer = window.setInterval(onChange, demoTickIntervalMs);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", onChange);
    window.clearInterval(timer);
  };
}

function snapshot() {
  try {
    if (migrationError !== null) return migrationFailed + migrationError;
    return window.sessionStorage.getItem(rideStorageKey);
  } catch {
    return unavailable;
  }
}

function serverSnapshot() { return loading; }

export function useRideDemo() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [actionError, setActionError] = useState<string | null>(null);
  const result = useMemo(() => {
    if (raw === loading) return { session: null, error: null };
    if (raw === unavailable) return { session: null, error: "No se puede acceder a sessionStorage. Permite el almacenamiento de sesión para usar el demo." };
    if (raw?.startsWith(migrationFailed)) return { session: null, error: `No se pudo guardar la migración del demo: ${raw.slice(migrationFailed.length)}` };
    try {
      return { session: decodeRideSession(raw), error: null };
    } catch {
      return { session: null, error: "Los datos de esta sesión están dañados o son incompatibles. Reinicia solo el demo de Rides para continuar." };
    }
  }, [raw]);

  function run(operation: () => void): boolean {
    try {
      operation();
      setActionError(null);
      window.dispatchEvent(new Event(changeEvent));
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo guardar el cambio del demo.");
      return false;
    }
  }

  function save(transform: (session: RideSession) => RideSession) {
    return run(() => {
      const next = transform(decodeRideSession(window.sessionStorage.getItem(rideStorageKey)));
      window.sessionStorage.setItem(rideStorageKey, JSON.stringify(next));
    });
  }

  return {
    session: result.session,
    notices: result.session?.notices ?? [],
    ready: raw !== loading,
    error: actionError ?? result.error,
    create: (input: RideInput) => save((session) =>
      addRide(session, createRide(input, `RIDE-DEMO-${crypto.randomUUID()}`, new Date().toISOString(), demoRideProvider.estimate()))),
    act: (id: string, action: RideAction) => save((session) =>
      updateRide(session, id, action, new Date().toISOString())),
    select: (id: string) => save((session) => {
      if (!session.requests.some((ride) => ride.id === id)) throw new Error("La solicitud ya no existe.");
      return { ...session, currentRideId: id };
    }),
    reset: () => run(() => window.sessionStorage.removeItem(rideStorageKey)),
  };
}

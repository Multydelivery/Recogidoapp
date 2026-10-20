"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  addRide, createRide, decodeRideSession, rideStorageKey, updateRide,
  type RideAction, type RideInput, type RideSession,
} from "./demo";

const changeEvent = "recogido-rides-demo-change";
const loading = "__rides_loading__";
const unavailable = "__rides_unavailable__";

function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.sessionStorage && (event.key === rideStorageKey || event.key === null)) callback();
  };
  window.addEventListener(changeEvent, callback);
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", callback);
  return () => {
    window.removeEventListener(changeEvent, callback);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", callback);
  };
}

function snapshot() {
  try {
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
    ready: raw !== loading,
    error: actionError ?? result.error,
    create: (input: RideInput) => save((session) =>
      addRide(session, createRide(input, `RIDE-DEMO-${crypto.randomUUID()}`, new Date().toISOString()))),
    act: (id: string, action: RideAction) => save((session) =>
      updateRide(session, id, action, new Date().toISOString())),
    select: (id: string) => save((session) => {
      if (!session.requests.some((ride) => ride.id === id)) throw new Error("La solicitud ya no existe.");
      return { ...session, currentRideId: id };
    }),
    reset: () => run(() => window.sessionStorage.removeItem(rideStorageKey)),
  };
}

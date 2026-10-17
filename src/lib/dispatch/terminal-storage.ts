type TerminalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function terminalStorageKeys(slug: string) {
  return {
    pin: `recogido:device-token:${slug}`,
    legacyPin: `recogido.dispatch.device.${slug}`,
    pendingAttempt: `recogido:device-token:${slug}.pending`,
    soundMuted: `recogido:dispatch-sound-muted:${slug}`,
  };
}

export function readSavedPin(storage: TerminalStorage, slug: string): string | null {
  const keys = terminalStorageKeys(slug);
  const value = storage.getItem(keys.pin) ?? storage.getItem(keys.legacyPin);
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function savePin(storage: TerminalStorage, slug: string, pin: string) {
  const keys = terminalStorageKeys(slug);
  storage.setItem(keys.pin, pin);
  try { storage.removeItem(keys.legacyPin); } catch {}
}

/** Removes only this restaurant's PIN keys. Never clears other restaurants or unrelated data. */
export function removeSavedPin(storage: TerminalStorage, slug: string) {
  const keys = terminalStorageKeys(slug);
  storage.removeItem(keys.pin);
  storage.removeItem(keys.legacyPin);
}

export function readPendingAttempt(storage: TerminalStorage, slug: string): { key: string; count: number } | null {
  const raw = storage.getItem(terminalStorageKeys(slug).pendingAttempt);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === "object" && "key" in parsed && typeof parsed.key === "string" &&
    /^[A-Za-z0-9_-]{8,128}$/.test(parsed.key) && "count" in parsed && typeof parsed.count === "number" &&
    Number.isInteger(parsed.count) && parsed.count >= 1 && parsed.count <= 20) {
    return { key: parsed.key, count: parsed.count };
  }
  return null;
}

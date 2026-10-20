import type { CartItem, CartSummary, MenuItem, SelectedModifier } from "./types";
import {
  getConfigurationKey,
  getConfiguredPriceCents,
  sanitizeModifiers,
} from "./pricing";

export const CART_STORAGE_KEY = "recogido:cart:la-fonda-paisa";
export const LEGACY_CART_STORAGE_KEY = "recogido:cart";
export const CART_MIGRATION_KEY = `${CART_STORAGE_KEY}:legacy-migration-complete`;
export const CART_SCHEMA_VERSION = 2;
export const MAX_ITEM_QUANTITY = 20;
export const MAX_SPECIAL_INSTRUCTIONS_LENGTH = 300;

type CartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface PersistedCart {
  schemaVersion: number;
  items: CartItem[];
}

export function createCartItem(
  item: MenuItem,
  selectedModifiers: SelectedModifier[] = [],
  quantity = 1,
  specialInstructions = "",
): CartItem | null {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) return null;
  if (
    typeof specialInstructions !== "string" ||
    specialInstructions.length > MAX_SPECIAL_INSTRUCTIONS_LENGTH ||
    (!item.specialInstructionsEnabled && specialInstructions.trim().length > 0)
  ) return null;
  const normalizedInstructions = specialInstructions.trim();
  const normalizedModifiers = sanitizeModifiers(item, selectedModifiers);
  if (!normalizedModifiers) return null;

  const configurationKey = getConfigurationKey(item.id, normalizedModifiers, normalizedInstructions);
  return {
    lineId: configurationKey,
    productId: item.id,
    quantity,
    unitPriceCents: getConfiguredPriceCents(item, normalizedModifiers),
    selectedModifiers: normalizedModifiers,
    configurationKey,
    ...(normalizedInstructions ? { specialInstructions: normalizedInstructions } : {}),
  };
}

function productQuantity(items: CartItem[], productId: string): number {
  return items.reduce(
    (sum, item) => sum + (item.productId === productId ? item.quantity : 0),
    0,
  );
}

export function addCartItem(items: CartItem[], line: CartItem): CartItem[] {
  if (productQuantity(items, line.productId) + line.quantity > MAX_ITEM_QUANTITY) return items;
  const existing = items.find((item) => item.configurationKey === line.configurationKey);
  if (!existing) return [...items, line];

  return items.map((item) =>
    item.configurationKey === line.configurationKey
      ? { ...item, quantity: item.quantity + line.quantity }
      : item,
  );
}

export function changeCartItemQuantity(
  items: CartItem[],
  lineId: string,
  adjustment: -1 | 1,
): CartItem[] {
  const current = items.find((item) => item.lineId === lineId);
  if (!current) return items;
  if (adjustment === 1 && productQuantity(items, current.productId) >= MAX_ITEM_QUANTITY) return items;
  if (adjustment === 1 && current.quantity >= MAX_ITEM_QUANTITY) return items;
  if (adjustment === -1 && current.quantity === 1) {
    return items.filter((item) => item.lineId !== lineId);
  }

  return items.map((item) =>
    item.lineId === lineId ? { ...item, quantity: item.quantity + adjustment } : item,
  );
}

export function removeCartItem(items: CartItem[], lineId: string): CartItem[] {
  return items.filter((item) => item.lineId !== lineId);
}

export function replaceCartItemConfiguration(
  items: CartItem[],
  lineId: string,
  item: MenuItem,
  selectedModifiers: SelectedModifier[],
  quantity: number,
  specialInstructions = "",
): CartItem[] | null {
  const previous = items.find((entry) => entry.lineId === lineId);
  if (!previous) return null;
  const replacement = createCartItem(item, selectedModifiers, quantity, specialInstructions);
  if (!replacement) return null;

  const otherItems = items.filter((entry) => entry.lineId !== lineId);
  if (productQuantity(otherItems, item.id) + replacement.quantity > MAX_ITEM_QUANTITY) return null;
  return addCartItem(otherItems, replacement);
}

export function normalizeCart(value: unknown, menuItems: MenuItem[]): CartItem[] {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object" &&
        [1, CART_SCHEMA_VERSION].includes((value as Record<string, unknown>).schemaVersion as number) &&
        Array.isArray((value as Record<string, unknown>).items)
      ? (value as { items: unknown[] }).items
      : [];
  const menuById = new Map(menuItems.map((item) => [item.id, item]));
  const normalized: CartItem[] = [];

  for (const candidate of entries) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as Record<string, unknown>;
    const productId = typeof entry.productId === "string"
      ? entry.productId
      : typeof entry.itemId === "string" ? entry.itemId : null;
    const item = productId ? menuById.get(productId) : undefined;
    if (
      !item ||
      typeof entry.quantity !== "number" ||
      !Number.isInteger(entry.quantity) ||
      entry.quantity < 1
    ) {
      continue;
    }

    const modifiersValue = entry.selectedModifiers;
    const selectedModifiers = modifiersValue === undefined
      ? item.modifierGroups.length === 0 ? [] : null
      : sanitizeModifiers(item, modifiersValue);
    if (!selectedModifiers) continue;

    const specialInstructions = typeof entry.specialInstructions === "string"
      ? entry.specialInstructions
      : "";
    const line = createCartItem(
      item,
      selectedModifiers,
      Math.min(entry.quantity, MAX_ITEM_QUANTITY),
      specialInstructions,
    );
    if (line) normalized.push(line);
  }

  const merged: CartItem[] = [];
  for (const line of normalized) {
    const remaining = MAX_ITEM_QUANTITY - productQuantity(merged, line.productId);
    if (remaining < 1) continue;
    const cappedLine = { ...line, quantity: Math.min(line.quantity, remaining) };
    const existing = merged.find((entry) => entry.configurationKey === cappedLine.configurationKey);
    if (existing) existing.quantity += cappedLine.quantity;
    else merged.push(cappedLine);
  }
  return merged;
}

export function readCart(
  storage: CartStorage,
  menuItems: MenuItem[],
): { items: CartItem[]; error: boolean } {
  let storedValue: string | null;
  let migratingLegacy = false;
  try {
    storedValue = storage.getItem(CART_STORAGE_KEY);
    if (storedValue === null && storage.getItem(CART_MIGRATION_KEY) !== "1") {
      const legacyValue = storage.getItem(LEGACY_CART_STORAGE_KEY);
      if (legacyValue !== null) {
        storedValue = legacyValue;
        migratingLegacy = true;
      } else {
        storage.setItem(CART_MIGRATION_KEY, "1");
        return { items: [], error: false };
      }
    }
  } catch {
    return { items: [], error: true };
  }

  if (storedValue === null) return { items: [], error: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(storedValue);
  } catch {
    if (migratingLegacy) {
      try {
        storage.setItem(CART_MIGRATION_KEY, "1");
      } catch {
        return { items: [], error: true };
      }
    } else {
      try {
        storage.removeItem(CART_STORAGE_KEY);
        storage.setItem(CART_MIGRATION_KEY, "1");
      } catch {
        return { items: [], error: true };
      }
    }
    return { items: [], error: true };
  }

  const items = normalizeCart(parsed, menuItems).filter((item) =>
    item.productId.startsWith("lfp-"),
  );
  const persisted: PersistedCart = { schemaVersion: CART_SCHEMA_VERSION, items };
  if (migratingLegacy) {
    try {
      if (items.length) storage.setItem(CART_STORAGE_KEY, JSON.stringify(persisted));
      storage.setItem(CART_MIGRATION_KEY, "1");
    } catch {
      return { items, error: true };
    }
    return { items, error: false };
  }

  if (JSON.stringify(persisted) !== storedValue) {
    try {
      if (items.length) storage.setItem(CART_STORAGE_KEY, JSON.stringify(persisted));
      else storage.removeItem(CART_STORAGE_KEY);
      storage.setItem(CART_MIGRATION_KEY, "1");
    } catch {
      return { items, error: true };
    }
  } else {
    try {
      storage.setItem(CART_MIGRATION_KEY, "1");
    } catch {
      return { items, error: true };
    }
  }

  return { items, error: false };
}

export function saveCart(storage: CartStorage, items: CartItem[]): boolean {
  try {
    if (items.length) {
      const persisted: PersistedCart = { schemaVersion: CART_SCHEMA_VERSION, items };
      storage.setItem(CART_STORAGE_KEY, JSON.stringify(persisted));
    } else {
      storage.removeItem(CART_STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

export function summarizeCart(items: CartItem[]): CartSummary {
  return {
    items,
    totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalCents: items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0),
  };
}

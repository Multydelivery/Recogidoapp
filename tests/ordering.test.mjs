import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  addCartItem,
  CART_MIGRATION_KEY,
  CART_SCHEMA_VERSION,
  CART_STORAGE_KEY,
  changeCartItemQuantity,
  createCartItem,
  MAX_ITEM_QUANTITY,
  LEGACY_CART_STORAGE_KEY,
  normalizeCart,
  readCart,
  removeCartItem,
  replaceCartItemConfiguration,
  saveCart,
  summarizeCart,
} from "../src/lib/ordering/cart.ts";
import {
  createSelectedModifiers,
  getConfigurationKey,
  getConfiguredPriceCents,
  getModifierGroupError,
  getModifierSelectionErrors,
  priceToCents,
  sanitizeModifiers,
} from "../src/lib/ordering/pricing.ts";
import { resolveModifierGroupRefs } from "../src/lib/ordering/catalog.ts";
import { filterMenuItems, normalizeSearchText } from "../src/lib/ordering/menu.ts";
import {
  calculateCheckoutTotals,
  checkoutPricingConfig,
  emptyDeliveryAddress,
  maskDeliveryStreet,
  normalizeDeliveryAddress,
  validateDeliveryAddress,
} from "../src/lib/ordering/checkout.ts";

const baseCatalog = JSON.parse(
  readFileSync(new URL("../src/data/la-fonda-paisa-menu.json", import.meta.url), "utf8"),
);
const phase = JSON.parse(
  readFileSync(new URL("../src/data/la-fonda-paisa-modifiers-phase-1.json", import.meta.url), "utf8"),
);
const menu = resolveModifierGroupRefs(baseCatalog, phase);
const soup = menu.items.find((item) => item.id === "lfp-026-especial-sopa-mondongo");
const creamSoup = menu.items.find((item) => item.id === "lfp-027-especial-crema-pollo");
const bandeja = menu.items.find((item) => item.id === "lfp-001-bandeja-paisa");
const paisita = menu.items.find((item) => item.id === "lfp-002-paisita");
const picada = menu.items.find((item) => item.id === "lfp-003-picada");
const simpleItem = picada;
const validSoupSelections = {
  "soup-special-size": ["medium"],
  "rice-choice": ["rice"],
  "salad-choice": ["green-salad"],
};

function selectSoup(overrides = {}) {
  return createSelectedModifiers(soup, { ...validSoupSelections, ...overrides });
}

function configuredSoup(overrides = {}, quantity = 1) {
  return createCartItem(soup, selectSoup(overrides), quantity);
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => assert.fail("The cart must not clear unrelated localStorage values."),
  };
}

test("the resolved demo catalog contains 27 products and eight ordered categories", () => {
  assert.equal(menu.items.length, 27);
  assert.equal(menu.categories.length, 8);
  assert.deepEqual(
    menu.categories.map(({ id, sortOrder }) => [id, sortOrder]),
    [
      ["popular", 1],
      ["sopas-lunes", 2],
      ["antojitos", 3],
      ["res", 4],
      ["cerdo", 5],
      ["pollo", 6],
      ["mariscos", 7],
      ["postres-bebidas", 8],
    ],
  );
  assert.deepEqual(menu.categories.find((category) => category.id === "sopas-lunes"), {
    id: "sopas-lunes",
    nameEs: "Sopas especiales de los lunes",
    nameEn: "Monday soup specials",
    sortOrder: 2,
  });
  assert.equal(soup.categoryId, "sopas-lunes");
  assert.equal(soup.source.priceLabel, "Desde $12.35");
});

test("catalog IDs are unique, four dishes are configurable, and Picada is direct-add", () => {
  const ids = menu.items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(menu.items.every((item) => item.price >= 0));
  assert.equal(menu.items.filter((item) => item.modifierGroups.length > 0).length, 4);
  assert.deepEqual(
    [bandeja, paisita, creamSoup, soup].map((item) => item.modifierGroups.length > 0),
    [true, true, true, true],
  );
  assert.deepEqual(picada.modifierGroups, []);
  assert.equal(picada.specialInstructionsEnabled, false);
  assert.equal(createCartItem(picada).unitPriceCents, 4160);
});

test("Mondongo has the exact required and optional groups from phase 1", () => {
  assert.equal(soup.modifierGroups.length, 6);
  assert.equal(new Set(soup.modifierGroups.map((group) => group.id)).size, 6);
  for (const group of soup.modifierGroups) {
    const ids = group.options.map((option) => option.id);
    assert.equal(new Set(ids).size, ids.length, `${group.id} option IDs are unique`);
    if (group.required) {
      assert.ok(group.minSelections >= 1);
      assert.ok(group.maxSelections >= group.minSelections);
    }
    assert.ok(group.minSelections >= 0);
    assert.ok(group.maxSelections <= group.options.length);
  }
  assert.deepEqual(soup.modifierGroups.map(({ id }) => id), [
    "soup-special-size",
    "rice-choice",
    "salad-choice",
    "recommended-sides-apps",
    "recommended-desserts",
    "recommended-beverages",
  ]);
  assert.ok(soup.specialInstructionsEnabled);
  assert.ok(soup.modifierGroups.slice(0, 3).every((group) => group.required));
  assert.ok(soup.modifierGroups.slice(3).every((group) =>
    !group.required && group.minSelections === 0 && group.maxSelections === 5,
  ));
});

test("shared templates resolve by reference and missing references fail explicitly", () => {
  const bandejaSides = bandeja.modifierGroups.find((group) => group.id === "recommended-sides-apps");
  const paisitaSides = paisita.modifierGroups.find((group) => group.id === "recommended-sides-apps");
  assert.equal(bandejaSides, paisitaSides);
  assert.equal(
    soup.modifierGroups.find((group) => group.id === "soup-special-size"),
    creamSoup.modifierGroups.find((group) => group.id === "soup-special-size"),
  );
  const invalidPhase = {
    ...phase,
    items: phase.items.map((item) => item.id === picada.id
      ? { ...item, modifierGroupRefs: ["not-a-template"] }
      : item),
  };
  assert.throws(
    () => resolveModifierGroupRefs(baseCatalog, invalidPhase),
    /references missing modifier group not-a-template/,
  );
});

test("menu search filters Spanish and English names and ignores accents", () => {
  assert.deepEqual(filterMenuItems(menu.items, "Bandeja").map((item) => item.id), [
    "lfp-001-bandeja-paisa",
    "lfp-004-bandeja-a-la-fonda-paisa",
  ]);
  assert.deepEqual(filterMenuItems(menu.items, "Tripe Soup").map((item) => item.id), [soup.id]);
  assert.equal(normalizeSearchText("  CHAMPIÑONES "), "champinones");
  assert.deepEqual(filterMenuItems(menu.items, "maracuya").map((item) => item.id), [
    "lfp-025-maracuya",
  ]);
});

test("required soup groups cannot be omitted and report specific instructions", () => {
  for (const [groupId, message] of [
    ["soup-special-size", "Selecciona un tamaño."],
    ["rice-choice", "Indica si deseas arroz."],
    ["salad-choice", "Selecciona un acompañamiento."],
  ]) {
    const selections = { ...validSoupSelections };
    delete selections[groupId];
    assert.ok(getModifierSelectionErrors(soup, selections).includes(message));
    assert.equal(createSelectedModifiers(soup, selections), null);
  }
  assert.equal(createSelectedModifiers(soup, validSoupSelections)?.length, 3);
});

test("phase-1 observed prices and verification status are retained without customer warnings", () => {
  assert.ok([bandeja, paisita, picada, creamSoup, soup].every((item) =>
    item.source.publiclyVerified === true && item.source.merchantConfirmed === false,
  ));
  assert.equal(getConfiguredPriceCents(soup, selectSoup()), 1235);
  assert.equal(
    getConfiguredPriceCents(soup, selectSoup({ "soup-special-size": ["large"] })),
    1495,
  );
  assert.equal(
    getConfiguredPriceCents(creamSoup, createSelectedModifiers(creamSoup, {
      "soup-special-size": ["medium"],
      "rice-choice": ["rice"],
      "salad-choice": ["green-salad"],
    })),
    1235,
  );
  assert.equal(
    getConfiguredPriceCents(creamSoup, createSelectedModifiers(creamSoup, {
      "soup-special-size": ["large"],
      "rice-choice": ["rice"],
      "salad-choice": ["green-salad"],
    })),
    1495,
  );
  assert.doesNotMatch(
    readFileSync(new URL("../src/components/ordering/OrderingExperience.tsx", import.meta.url), "utf8"),
    /merchantConfirmed|publiclyVerified/,
  );
});

test("Bandeja and Paisita add $2.60 for ground beef; Picada stays direct-add", () => {
  const bandejaModifiers = createSelectedModifiers(bandeja, {
    "protein-choice": ["ground-beef"],
  });
  const paisitaModifiers = createSelectedModifiers(paisita, {
    "protein-choice": ["ground-beef"],
  });
  assert.equal(getConfiguredPriceCents(bandeja, bandejaModifiers), 3120);
  assert.equal(getConfiguredPriceCents(paisita, paisitaModifiers), 2340);
  assert.equal(createCartItem(picada).unitPriceCents, 4160);
  assert.equal(picada.modifierGroups.length, 0);
});

test("optional groups enforce their configured selection maximum", () => {
  const sides = soup.modifierGroups.find((group) => group.id === "recommended-sides-apps");
  assert.equal(sides.required, false);
  assert.equal(sides.maxSelections, 5);
  const limitedSoup = {
    ...soup,
    modifierGroups: soup.modifierGroups.map((group) =>
      group.id === sides.id ? { ...group, maxSelections: 2 } : group,
    ),
  };
  assert.match(
    getModifierGroupError(limitedSoup, sides.id, {
      [sides.id]: ["empanadas", "tostones", "extra-beans"],
    }),
    /como máximo 2 opciones/,
  );
});

test("soup pricing is calculated in integer cents", () => {
  assert.equal(priceToCents(soup.price), 1235);
  assert.equal(getConfiguredPriceCents(soup, selectSoup()), 1235);
  assert.equal(
    getConfiguredPriceCents(soup, selectSoup({ "recommended-sides-apps": ["empanadas"] })),
    1463,
  );
  assert.equal(
    getConfiguredPriceCents(
      soup,
      selectSoup({ "recommended-sides-apps": ["empanadas", "chicharron-arepita"] }),
    ),
    2243,
  );
});

test("configuration keys are deterministic and ignore modifier selection order", () => {
  const ordered = selectSoup({ "recommended-sides-apps": ["empanadas", "chicharron-arepita"] });
  const reversed = selectSoup({ "recommended-sides-apps": ["chicharron-arepita", "empanadas"] });
  assert.equal(getConfigurationKey(soup.id, ordered), getConfigurationKey(soup.id, reversed));
  assert.equal(
    getConfigurationKey(soup.id, ordered),
    getConfigurationKey(soup.id, [...ordered].reverse()),
  );
});

test("different soup configurations create separate cart lines", () => {
  const withSalad = configuredSoup();
  const withBeans = configuredSoup({ "salad-choice": ["beans"] });
  const cart = addCartItem(addCartItem([], withSalad), withBeans);
  assert.equal(cart.length, 2);
  assert.notEqual(cart[0].configurationKey, cart[1].configurationKey);
});

test("identical soup configurations increment the same line", () => {
  const line = configuredSoup();
  const cart = addCartItem(addCartItem([], line), configuredSoup());
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
  assert.equal(cart[0].lineId, line.configurationKey);
});

test("special instructions distinguish configurations and persist with the line", () => {
  const first = createCartItem(soup, selectSoup(), 1, "Sin cebolla");
  const second = createCartItem(soup, selectSoup(), 1, "Poco picante");
  assert.notEqual(first.configurationKey, second.configurationKey);
  const cart = addCartItem(addCartItem([], first), second);
  assert.equal(cart.length, 2);
  assert.equal(normalizeCart({ schemaVersion: 2, items: cart }, menu.items)[0].specialInstructions, "Sin cebolla");
});

test("editing options replaces a line and merges into an existing matching configuration", () => {
  const original = configuredSoup();
  const matching = configuredSoup({ "salad-choice": ["beans"] });
  const cart = addCartItem(addCartItem([], original), matching);
  const edited = replaceCartItemConfiguration(
    cart,
    original.lineId,
    soup,
    selectSoup({ "salad-choice": ["beans"] }),
    original.quantity,
  );
  assert.equal(edited.length, 1);
  assert.equal(edited[0].quantity, 2);
  assert.deepEqual(
    replaceCartItemConfiguration(
      [configuredSoup({}, MAX_ITEM_QUANTITY), matching],
      configuredSoup().lineId,
      soup,
      selectSoup({ "salad-choice": ["beans"] }),
      MAX_ITEM_QUANTITY,
    ),
    null,
  );
});

test("Picada and other simple products add directly, change quantity, and summarize in cents", () => {
  const first = createCartItem(simpleItem);
  const secondProduct = menu.items.find((item) => item.id === "lfp-005-empanadas");
  const second = createCartItem(secondProduct);
  assert.deepEqual(first.selectedModifiers, []);
  let cart = addCartItem([], { ...first, quantity: 2 });
  cart = addCartItem(cart, second);
  assert.equal(
    summarizeCart(cart).subtotalCents,
    priceToCents(simpleItem.price) * 2 + priceToCents(secondProduct.price),
  );
  assert.equal(summarizeCart(cart).totalUnits, 3);
  cart = changeCartItemQuantity(cart, first.lineId, -1);
  assert.equal(cart.find((line) => line.productId === simpleItem.id).quantity, 1);
  assert.equal(removeCartItem(cart, first.lineId).some((line) => line.lineId === first.lineId), false);
  for (const product of menu.items.filter((item) => item.modifierGroups.length === 0)) {
    assert.ok(createCartItem(product), `${product.id} remains a valid simple cart item`);
  }
  for (const product of [bandeja, paisita, creamSoup, soup]) {
    assert.equal(createCartItem(product), null, `${product.id} requires configuration`);
  }
});

test("cart keeps the exact key and persists the versioned configurable line schema", () => {
  assert.equal(CART_STORAGE_KEY, "recogido:cart:la-fonda-paisa");
  assert.equal(LEGACY_CART_STORAGE_KEY, "recogido:cart");
  const storage = memoryStorage({ other: "keep me" });
  const cart = [configuredSoup({ "recommended-sides-apps": ["empanadas"] })];
  assert.equal(saveCart(storage, cart), true);
  const persisted = JSON.parse(storage.getItem(CART_STORAGE_KEY));
  assert.equal(persisted.schemaVersion, CART_SCHEMA_VERSION);
  assert.equal(persisted.items[0].productId, soup.id);
  assert.equal(persisted.items[0].selectedModifiers.length, 4);
  assert.equal(persisted.items[0].configurationKey, cart[0].configurationKey);
  assert.equal(storage.getItem("other"), "keep me");
  assert.equal(storage.getItem(LEGACY_CART_STORAGE_KEY), null);
  assert.deepEqual(readCart(storage, menu.items), { items: cart, error: false });
});

test("legacy cart migrates once to the La Fonda key and preserves the old key", () => {
  const legacy = [
    { itemId: simpleItem.id, quantity: 2 },
    { itemId: "missing-product", quantity: 1 },
  ];
  const storage = memoryStorage({ [LEGACY_CART_STORAGE_KEY]: JSON.stringify(legacy) });
  const recovered = readCart(storage, menu.items);
  assert.equal(recovered.error, false);
  assert.equal(recovered.items.length, 1);
  assert.equal(recovered.items[0].productId, simpleItem.id);
  assert.deepEqual(recovered.items[0].selectedModifiers, []);
  assert.equal(JSON.parse(storage.getItem(CART_STORAGE_KEY)).schemaVersion, CART_SCHEMA_VERSION);
  assert.equal(storage.getItem(LEGACY_CART_STORAGE_KEY), JSON.stringify(legacy));
  assert.equal(storage.getItem(CART_MIGRATION_KEY), "1");
  storage.setItem(LEGACY_CART_STORAGE_KEY, JSON.stringify([{ itemId: soup.id, quantity: 3 }]));
  assert.deepEqual(readCart(storage, menu.items).items, recovered.items);
});

test("legacy migration excludes other restaurants and the current key takes precedence", () => {
  const foreignItem = { ...picada, id: "brisas-001-pollo" };
  const legacy = [
    { itemId: picada.id, quantity: 1 },
    { itemId: foreignItem.id, quantity: 2 },
  ];
  const storage = memoryStorage({ [LEGACY_CART_STORAGE_KEY]: JSON.stringify(legacy) });
  const recovered = readCart(storage, [...menu.items, foreignItem]);
  assert.deepEqual(recovered.items.map((line) => line.productId), [picada.id]);

  const currentLine = configuredSoup();
  const authoritativeStorage = memoryStorage({
    [CART_STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, items: [currentLine] }),
    [LEGACY_CART_STORAGE_KEY]: JSON.stringify([{ itemId: picada.id, quantity: 4 }]),
  });
  assert.deepEqual(readCart(authoritativeStorage, menu.items).items, [currentLine]);
  assert.equal(JSON.parse(authoritativeStorage.getItem(CART_STORAGE_KEY)).items[0].productId, soup.id);
});

test("corrupt current cart JSON does not throw and preserves unrelated storage", () => {
  const storage = memoryStorage({ [CART_STORAGE_KEY]: "{broken", unrelated: "preserved" });
  assert.deepEqual(readCart(storage, menu.items), { items: [], error: true });
  assert.equal(storage.getItem(CART_STORAGE_KEY), null);
  assert.equal(storage.getItem("unrelated"), "preserved");
});

test("invalid lines are dropped independently and stale modifiers are normalized", () => {
  const valid = configuredSoup({ "recommended-sides-apps": ["empanadas"] });
  const stale = {
    ...valid,
    lineId: "stale",
    selectedModifiers: [
      ...valid.selectedModifiers,
      { groupId: "recommended-sides-apps", optionId: "deleted-option" },
    ],
  };
  const missingRequired = {
    ...valid,
    lineId: "missing-required",
    selectedModifiers: valid.selectedModifiers.filter((modifier) => modifier.groupId !== "soup-special-size"),
  };
  const normalized = normalizeCart({
    schemaVersion: CART_SCHEMA_VERSION,
    items: [createCartItem(simpleItem), stale, missingRequired],
  }, menu.items);
  assert.equal(normalized.length, 2);
  assert.ok(normalized.some((line) => line.productId === simpleItem.id));
  const normalizedSoup = normalized.find((line) => line.productId === soup.id);
  assert.equal(normalizedSoup.selectedModifiers.some((modifier) =>
    modifier.optionId === "deleted-option"), false);
  assert.equal(sanitizeModifiers(soup, [{ groupId: "soup-special-size", optionId: "missing" }]), null);
});

test("cart quantity is capped and emptying it leaves unrelated storage intact", () => {
  const line = configuredSoup({}, MAX_ITEM_QUANTITY);
  assert.equal(createCartItem(soup, selectSoup(), MAX_ITEM_QUANTITY + 1), null);
  const storage = memoryStorage({
    [CART_STORAGE_KEY]: JSON.stringify({ schemaVersion: CART_SCHEMA_VERSION, items: [line] }),
    unrelated: "preserved",
  });
  assert.equal(saveCart(storage, []), true);
  assert.equal(storage.getItem(CART_STORAGE_KEY), null);
  assert.equal(storage.getItem("unrelated"), "preserved");
  assert.deepEqual(summarizeCart([]), { items: [], totalUnits: 0, subtotalCents: 0 });
});

test("checkout renders all selected choices, unit/line totals, and stays offline", () => {
  const component = readFileSync(
    new URL("../src/components/ordering/OrderingExperience.tsx", import.meta.url),
    "utf8",
  );
  const customizationDialog = readFileSync(
    new URL("../src/components/ordering/ProductCustomizationDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /Precio unitario configurado/);
  assert.match(component, /Total de la línea/);
  assert.match(component, /Catálogo de demostración\. No se enviará ningún pedido real\./);
  assert.match(component, /item\.modifierGroups\.length > 0 \|\| item\.specialInstructionsEnabled/);
  assert.match(component, /modifier\.nameEs/);
  assert.match(customizationDialog, /specialInstructionsEnabled/);
  assert.doesNotMatch(component + customizationDialog, /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/);
});

test("menu cards use one accessible native plus button with direct/configurable routing", () => {
  const component = readFileSync(
    new URL("../src/components/ordering/OrderingExperience.tsx", import.meta.url),
    "utf8",
  );
  const card = component.slice(
    component.indexOf("function MenuItemCard"),
    component.indexOf("\nfunction CartLines"),
  );
  const styles = readFileSync(
    new URL("../src/components/ordering/OrderingExperience.module.css", import.meta.url),
    "utf8",
  );
  assert.equal((card.match(/<button\b/g) ?? []).length, 1);
  assert.match(card, /type="button"/);
  assert.doesNotMatch(card, /role="button"/);
  assert.match(card, /aria-label=\{accessibleName\}/);
  assert.match(card, /`Agregando \$\{item\.nameEs\}`/);
  assert.match(card, /`Personalizar \$\{item\.nameEs\}`/);
  assert.match(card, /`Agregar \$\{item\.nameEs\} al carrito`/);
  assert.match(card, /"Picada agregada al carrito"/);
  assert.match(card, /`\$\{item\.nameEs\} agregado al carrito`/);
  assert.match(card, /event\.stopPropagation\(\)/);
  assert.match(card, /if \(isConfigurable\) onCustomize\(\);\s*else onAdd\(\);/);
  assert.match(card, /<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">/);
  assert.match(card, /M12 5v14M5 12h14/);
  assert.match(card, /m5 12\.5 4\.2 4\.2L19 7/);
  assert.doesNotMatch(card, /<button[^>]*>\s*<button/);
  assert.match(component, /onCustomize=\{\(\) => openCustomization\(item\)\}/);
  assert.match(component, /onAdd=\{\(\) => queueAddItem\(item\)\}/);
  assert.match(component, /}, 800\)/);
  assert.match(component, /aria-label=\{accessibleName\}/);
  assert.ok(createCartItem(picada), "Picada can be created directly from its add button");
  for (const product of [bandeja, soup]) {
    assert.equal(createCartItem(product), null, `${product.nameEs} cannot be added before choices`);
  }
  assert.match(component, /showAddedFeedback\(item\.id\)/);
  assert.match(component, /const queueAddItem = \(item: MenuItem\)/);
  assert.match(component, /setProcessingProductId\(item\.id\)/);
  assert.match(styles, /@keyframes add-button-spin/);
  assert.match(styles, /\.addIconButton\s*\{[^}]*width:\s*46px;[^}]*height:\s*46px;/s);
  assert.match(styles, /\.addIconButton:hover:not\(:disabled\)/);
  assert.match(styles, /\.addIconButton:active:not\(:disabled\)/);
  assert.match(styles, /\.addIconButton:focus-visible/);
  assert.match(styles, /\.addIconButton:disabled/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("restaurant hero supports a local image and a branded delivery placeholder", () => {
  const hero = readFileSync(
    new URL("../src/components/ordering/RestaurantHero.tsx", import.meta.url),
    "utf8",
  );
  const heroStyles = readFileSync(
    new URL("../src/components/ordering/RestaurantHero.module.css", import.meta.url),
    "utf8",
  );
  const page = readFileSync(
    new URL("../src/app/order/la-fonda-paisa/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(hero, /src=\{imageSource\}/);
  assert.match(hero, /sizes="\([^"]*max-width: 800px[^"]*100vw[^"]*"/);
  assert.match(hero, /onError=\{\(\) => \{/);
  assert.match(hero, /imageSource && !imageFailed/);
  assert.match(hero, /\(!imageIsLocal \|\| imageFailed\)/);
  assert.match(hero, /heroImageUrl: string \| null/);
  assert.match(hero, /Foto del restaurante próximamente/);
  assert.match(hero, /className=\{styles\.placeholder\}>\s*<span className=\{styles\.placeholderIcon\} aria-hidden="true"><CarIcon \/><\/span>/);
  assert.match(hero, /aria-hidden="true"/);
  assert.match(hero, /<h1 id="restaurant-title">\{restaurant\.name\}<\/h1>/);
  assert.ok(hero.indexOf('<h1 id="restaurant-title"') < hero.indexOf('aria-label="Ingresar dirección de entrega"'));
  assert.match(hero, /aria-label="Ingresar dirección de entrega"/);
  assert.match(hero, /La validación de direcciones estará disponible próximamente\./);
  assert.match(hero, /const openAddressDialog = \(\) => \{\s*addressDialogRef\.current\?\.showModal\(\);\s*onDialogOpenChange\?\.\(true\);/);
  assert.match(hero, /onCancel=\{\(event\) => \{\s*event\.preventDefault\(\);\s*closeAddressDialog\(\);/);
  assert.match(hero, /const closeAddressDialog = \(\) => \{\s*if \(addressDialogRef\.current\?\.open\) addressDialogRef\.current\.close\(\);\s*onDialogOpenChange\?\.\(false\);/);
  assert.match(hero, /closeAddressDialog\(\)/);
  assert.doesNotMatch(hero, /\bfetch\s*\(|navigator\.geolocation|localStorage|XMLHttpRequest/);
  assert.match(page, /const heroImageUrl: string \| null = null/);
  assert.match(page, /heroImageUrl=\{heroImageUrl\}/);
  assert.match(heroStyles, /object-fit:\s*cover/);
  assert.match(heroStyles, /linear-gradient\(\s*to bottom/);
  assert.match(heroStyles, /min-height:\s*240px/);
  assert.match(heroStyles, /min-height:\s*300px/);
  assert.match(heroStyles, /min-height:\s*380px/);
  assert.match(heroStyles, /width:\s*min\(calc\(100% - 32px\), 680px\)/);
  assert.match(heroStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(heroStyles, /\.addressButton:focus-visible/);
  assert.match(heroStyles, /\.addressButton:hover/);
  assert.match(heroStyles, /\.addressButton:active/);
});

test("restaurant information and fulfillment controls preserve the menu/cart behavior", () => {
  const experience = readFileSync(
    new URL("../src/components/ordering/OrderingExperience.tsx", import.meta.url),
    "utf8",
  );
  const heroIndex = experience.indexOf("<RestaurantHero");
  const addressLabelIndex = experience.indexOf('className={styles.restaurantSummary}');
  const menuIndex = experience.indexOf('<section className={styles.menuPanel}');
  assert.ok(heroIndex >= 0 && heroIndex < addressLabelIndex && addressLabelIndex < menuIndex);
  assert.match(experience, /aria-pressed="true"/);
  assert.match(experience, /<CarIcon aria-hidden="true" \/>/);
  assert.match(experience, />\s*Delivery/);
  assert.match(experience, /disabled aria-label="Pickup, próximamente"/);
  assert.match(experience, /<h2 id="featured-title">Platos destacados<\/h2>/);
  assert.match(experience, /className=\{styles\.addIconButton\}/);
  assert.match(experience, /CART_STORAGE_KEY/);
  assert.doesNotMatch(experience, /\bfetch\s*\(|XMLHttpRequest|navigator\.geolocation|navigator\.sendBeacon/);
  assert.equal(CART_STORAGE_KEY, "recogido:cart:la-fonda-paisa");
  assert.equal(menu.items.find((item) => item.id === soup.id).price, 12.35);
});

test("checkout production pricing keeps unknown charges explicit and fixture math uses cents", () => {
  assert.deepEqual(checkoutPricingConfig, {
    serviceFeeCents: null,
    deliveryFeeCents: null,
    taxRateBasisPoints: null,
    serviceFeeTaxable: false,
    deliveryFeeTaxable: false,
    merchantConfirmed: false,
  });
  const pending = calculateCheckoutTotals(10_000);
  assert.equal(pending.partialTotalCents, 10_000);
  assert.equal(pending.serviceFeeCents, null);
  assert.equal(pending.deliveryFeeCents, null);
  assert.equal(pending.taxCents, null);
  assert.equal(pending.hasPendingCharges, true);
  const unconfirmed = calculateCheckoutTotals(10_000, {
    serviceFeeCents: 150,
    deliveryFeeCents: 500,
    taxRateBasisPoints: 662,
    serviceFeeTaxable: true,
    deliveryFeeTaxable: true,
    merchantConfirmed: false,
  });
  assert.equal(unconfirmed.partialTotalCents, 10_000);
  assert.equal(unconfirmed.serviceFeeCents, null);
  assert.equal(unconfirmed.deliveryFeeCents, null);
  assert.equal(unconfirmed.taxCents, null);

  const fixtureTotals = calculateCheckoutTotals(10_000, {
    serviceFeeCents: 150,
    deliveryFeeCents: 500,
    taxRateBasisPoints: 662,
    serviceFeeTaxable: true,
    deliveryFeeTaxable: true,
    merchantConfirmed: true,
  });
  assert.equal(fixtureTotals.taxCents, 705);
  assert.equal(fixtureTotals.partialTotalCents, 11_355);
  assert.equal(fixtureTotals.hasPendingCharges, false);
  assert.throws(() => calculateCheckoutTotals(1.5), RangeError);
});

test("delivery address validation normalizes whitespace without requiring a delivery zone", () => {
  const validAddress = {
    ...emptyDeliveryAddress,
    street: "  15   West   Palisade Ave ",
    unit: " Apt  2 ",
    city: "  Englewood ",
    state: " nj ",
    zip: " 07631 ",
    instructions: " Call  once ",
  };
  const result = validateDeliveryAddress(validAddress);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.value, {
    street: "15 West Palisade Ave",
    unit: "Apt 2",
    city: "Englewood",
    state: "NJ",
    zip: "07631",
    instructions: "Call once",
  });
  assert.deepEqual(normalizeDeliveryAddress(validAddress), result.value);
  assert.equal(maskDeliveryStreet(result.value.street), "West Palisade Ave ••••");
  assert.doesNotMatch(maskDeliveryStreet(result.value.street), /15/);
  assert.deepEqual(validateDeliveryAddress(emptyDeliveryAddress).errors, {
    street: "Ingresa la dirección.",
    zip: "Ingresa un ZIP válido, por ejemplo 07631 o 07631-1234.",
  });
  assert.equal(
    validateDeliveryAddress({ ...validAddress, zip: "07631-1234" }).errors.zip,
    undefined,
  );
  assert.equal(
    validateDeliveryAddress({ ...validAddress, zip: "0763A" }).errors.zip,
    "Ingresa un ZIP válido, por ejemplo 07631 o 07631-1234.",
  );
  assert.equal(
    validateDeliveryAddress({ ...validAddress, instructions: "x".repeat(201) }).errors.instructions,
    "Las instrucciones no pueden superar 200 caracteres.",
  );
});

test("checkout renders the four-step demo route and protects address and payment data", () => {
  const checkout = readFileSync(
    new URL("../src/components/ordering/CheckoutPage.tsx", import.meta.url),
    "utf8",
  );
  const checkoutStyles = readFileSync(
    new URL("../src/components/ordering/CheckoutPage.module.css", import.meta.url),
    "utf8",
  );
  const checkoutRoute = readFileSync(
    new URL("../src/app/order/la-fonda-paisa/checkout/page.tsx", import.meta.url),
    "utf8",
  );
  const menuPage = readFileSync(
    new URL("../src/components/ordering/OrderingExperience.tsx", import.meta.url),
    "utf8",
  );
  const menuStyles = readFileSync(
    new URL("../src/components/ordering/OrderingExperience.module.css", import.meta.url),
    "utf8",
  );

  assert.match(checkoutRoute, /CheckoutPage/);
  assert.match(checkoutRoute, /resolveModifierGroupRefs\(menu, phaseOne\)/);
  assert.match(checkout, /type CheckoutStep = 0 \| 1 \| 2 \| 3/);
  assert.match(checkout, /Revisa tu pedido/);
  assert.match(checkout, /Confirma los platos, cantidades y opciones antes de continuar\./);
  assert.match(checkout, /¿Dónde entregamos tu pedido\?/);
  assert.match(checkout, /Ingresa la dirección donde quieres recibir la orden\./);
  assert.match(checkout, /Revisa y confirma/);
  assert.match(checkout, /Método de pago/);
  assert.match(checkout, /Los métodos de pago se habilitarán después de conectar un proveedor seguro\./);
  assert.match(checkout, /Confirmar pedido de demostración/);
  assert.match(checkout, /Este pedido no será enviado al restaurante ni se realizará ningún cobro\./);
  assert.match(checkout, /Pedido de demostración preparado/);
  assert.match(checkout, /Conservar carrito para editar/);
  assert.match(checkout, /replaceCartItemConfiguration\(/);
  assert.match(checkout, /initialModifiers=\{customization\?\.modifiers \?\? \[\]\}/);
  assert.match(checkout, /changeCartItemQuantity\(cartItems, line\.lineId, delta\)/);
  assert.match(checkout, /removeCartItem\(cartItems, line\.lineId\)/);
  assert.match(checkout, /readCart\(window\.localStorage, items\)/);
  assert.match(checkout, /saveCart\(window\.localStorage, nextCart\)/);
  assert.match(checkout, /setAddress\(emptyDeliveryAddress\)/);
  assert.match(checkout, /maskDeliveryStreet\(normalizedAddress\.street\)/);
  assert.match(checkout, /addressFieldRefs\.current\[firstInvalidField\]\?\.focus\(\)/);
  assert.match(checkout, /disabled=\{stepIndex >= activeStep\}/);
  assert.match(checkout, /maxLength=\{200\}/);
  assert.match(checkout, /autoComplete="off" noValidate/);
  assert.match(checkout, /onCancel=\{\(event\) => \{\s*event\.preventDefault\(\);/);
  assert.match(checkout, /clearTriggerRef\.current\.focus\(\)/);
  assert.match(checkout, /<ProductCustomizationDialog/);
  assert.match(checkout, /type="radio" name="demo-payment" disabled/);
  assert.doesNotMatch(checkout, /type="(?!radio)[^"]*card|cardNumber|cvv|cvc|expiry|bankAccount/i);
  assert.doesNotMatch(checkout, /sessionStorage|URLSearchParams|console\.log|\bfetch\s*\(|XMLHttpRequest|sendBeacon/);
  assert.match(checkoutStyles, /safe-area-inset-bottom/);
  assert.match(checkoutStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(checkoutStyles, /@media \(max-width: 360px\)/);
  assert.match(checkoutStyles, /overflow-x:\s*clip/);
  assert.match(checkoutStyles, /\.page button:focus-visible/);

  assert.match(menuPage, /showCheckoutBar/);
  assert.match(menuPage, /summary\.items\.length > 0/);
  assert.match(menuPage, /summary\.subtotalCents > 0/);
  assert.match(menuPage, /dialogMode === "closed"/);
  assert.match(menuPage, /customization === null/);
  assert.match(menuPage, /!addressDialogOpen/);
  assert.match(menuPage, /href="\/order\/la-fonda-paisa\/checkout"/);
  assert.match(menuPage, /aria-disabled=\{!summary\.totalUnits\}/);
  assert.match(menuPage, /Continuar con La Fonda/);
  assert.match(menuPage, /aria-label=\{`Continuar con La Fonda\./);
  assert.doesNotMatch(menuPage, /setDialogMode\("checkout"\)|Demostración de pedido/);
  assert.match(menuStyles, /position:\s*fixed/);
  assert.match(menuStyles, /safe-area-inset-bottom/);
  assert.match(menuStyles, /width:\s*min\(100%, 720px\)/);
  assert.match(menuStyles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("checkout pricing summary names pending fees and never persists or exposes the address", () => {
  const checkout = readFileSync(
    new URL("../src/components/ordering/CheckoutPage.tsx", import.meta.url),
    "utf8",
  );
  const pricing = readFileSync(
    new URL("../src/lib/ordering/checkout.ts", import.meta.url),
    "utf8",
  );
  assert.match(checkout, /Por confirmar/);
  assert.match(checkout, /Se calcula según la dirección/);
  assert.match(checkout, /Se calcula al confirmar/);
  assert.match(checkout, /Total parcial/);
  assert.match(pricing, /serviceFeeCents: null/);
  assert.match(pricing, /deliveryFeeCents: null/);
  assert.match(pricing, /taxRateBasisPoints: null/);
  assert.match(pricing, /merchantConfirmed: false/);
  assert.match(checkout, /pricingConfig\?: CheckoutPricingConfig/);
  assert.match(pricing, /Math\.floor\(/);
  assert.match(pricing, /taxableSubtotalCents \* taxRateBasisPoints \+ 5_000/);
  assert.doesNotMatch(pricing, /parseFloat|toFixed|Math\.round/);
  assert.match(checkout, /setDemoConfirmation\(\{/);
  assert.match(checkout, /pendingCharges/);
  assert.match(checkout, /maskedAddress/);
  assert.match(checkout, /¿Quieres eliminar todos los productos del carrito\?/);
  assert.match(checkout, /onClick=\{clearCart\}/);
  assert.doesNotMatch(checkout, /setCartItems\(\[\]\)/);
});

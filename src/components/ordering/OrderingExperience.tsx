"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addCartItem,
  CART_STORAGE_KEY,
  changeCartItemQuantity,
  createCartItem,
  MAX_ITEM_QUANTITY,
  readCart,
  replaceCartItemConfiguration,
  removeCartItem,
  saveCart,
  summarizeCart,
} from "@/lib/ordering/cart";
import { filterMenuItems, getCategoryName } from "@/lib/ordering/menu";
import { priceToCents } from "@/lib/ordering/pricing";
import type { CartItem, MenuCategory, MenuItem, Restaurant, SelectedModifier } from "@/lib/ordering/types";
import { CarIcon, PhoneIcon, RestaurantIcon, SearchIcon, ShoppingBagIcon, TrashIcon } from "@/components/icons";
import { ProductCustomizationDialog } from "./ProductCustomizationDialog";
import { RestaurantHero } from "./RestaurantHero";
import styles from "./OrderingExperience.module.css";

type Props = {
  restaurant: Restaurant;
  categories: MenuCategory[];
  items: MenuItem[];
  heroImageUrl?: string | null;
};

type DialogMode = "closed" | "cart" | "confirm-clear";
type CustomizationState = {
  item: MenuItem;
  lineId: string | null;
  modifiers: SelectedModifier[];
  quantity: number;
  specialInstructions: string;
};

const featuredSectionId = "menu-featured";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function MenuItemCard({
  item,
  categoryName,
  quantity,
  wasJustAdded,
  isProcessing,
  canAdd,
  onAdd,
  onCustomize,
}: {
  item: MenuItem;
  categoryName: string;
  quantity: number;
  wasJustAdded: boolean;
  isProcessing: boolean;
  canAdd: boolean;
  onAdd: () => void;
  onCustomize: () => void;
}) {
  const isConfigurable = item.modifierGroups.length > 0 || item.specialInstructionsEnabled === true;
  const accessibleName = isProcessing
    ? `Agregando ${item.nameEs}`
    : wasJustAdded
    ? item.id === "lfp-003-picada"
      ? "Picada agregada al carrito"
      : `${item.nameEs} agregado al carrito`
    : isConfigurable
      ? `Personalizar ${item.nameEs}`
      : `Agregar ${item.nameEs} al carrito`;

  return (
    <article className={styles.itemCard}>
      <div className={styles.itemPlaceholder} aria-hidden="true">
        <RestaurantIcon />
      </div>
      <div className={styles.itemContent}>
        <div className={styles.itemMeta}>
          <span className={styles.categoryTag}>{categoryName}</span>
          {item.featured && <span className={styles.featuredTag}>Destacado</span>}
        </div>
        <h3>{item.nameEs}</h3>
        <p className={styles.itemEnglish}>{item.nameEn}</p>
        <p className={styles.availability}>
          <span aria-hidden="true" data-available={item.available} />
          {item.available ? "Disponible" : "No disponible"}
        </p>
        {isConfigurable && !item.displayPricePrefix && (
          <p className={styles.configurableLabel}>Personalizable</p>
        )}
        <div className={styles.itemFooter}>
          <strong className={styles.price}>
            {item.displayPricePrefix ? `${item.displayPricePrefix} ` : ""}
            {formatMoney(priceToCents(item.price))}
          </strong>
          <div className={styles.menuCardAddAction}>
            <button
              type="button"
              className={styles.addIconButton}
              aria-label={accessibleName}
              onClick={(event) => {
                event.stopPropagation();
                if (isConfigurable) onCustomize();
                else onAdd();
              }}
              disabled={!item.available || !canAdd || isProcessing}
            >
              {isProcessing ? (
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <circle className={styles.addingSpinner} cx="12" cy="12" r="8" />
                </svg>
              ) : wasJustAdded ? (
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="m5 12.5 4.2 4.2L19 7" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            </button>
            {quantity > 0 && <span>{quantity} en carrito</span>}
          </div>
        </div>
      </div>
    </article>
  );
}

function CartLines({
  cartItems,
  menuItems,
  categories,
  onIncrease,
  onDecrease,
  onRemove,
  onEdit,
}: {
  cartItems: CartItem[];
  menuItems: MenuItem[];
  categories: MenuCategory[];
  onIncrease: (line: CartItem) => void;
  onDecrease: (line: CartItem) => void;
  onRemove: (line: CartItem) => void;
  onEdit: (line: CartItem, item: MenuItem) => void;
}) {
  const menuById = new Map(menuItems.map((item) => [item.id, item]));
  const productQuantities = new Map<string, number>();
  for (const line of cartItems) {
    productQuantities.set(
      line.productId,
      (productQuantities.get(line.productId) ?? 0) + line.quantity,
    );
  }

  if (!cartItems.length) {
    return <p className={styles.emptyCart}>Tu carrito está vacío.</p>;
  }

  return (
    <ul className={styles.cartLines}>
      {cartItems.map((cartItem) => {
        const item = menuById.get(cartItem.productId);
        if (!item) return null;
        const selectedGroups = item.modifierGroups.flatMap((group) => {
          const options = cartItem.selectedModifiers.filter(
            (modifier) => modifier.groupId === group.id,
          );
          if (!options.length) return [];
          return [{
            group,
            options,
          }];
        });

        return (
          <li key={cartItem.lineId} className={styles.cartLine}>
            <div className={styles.cartLineDetails}>
              <strong>{item.nameEs}</strong>
              <span>{getCategoryName(categories, item.categoryId)}</span>
              {selectedGroups.map(({ group, options }) => (
                <span key={group.id}>
                  {group.nameEs}: {options.map((modifier) =>
                    `${modifier.nameEs}${modifier.priceAdjustmentCents > 0
                      ? ` (+${formatMoney(modifier.priceAdjustmentCents)})`
                      : ""}`,
                  ).join(", ")}
                </span>
              ))}
              {cartItem.specialInstructions && (
                <span>Instrucciones: {cartItem.specialInstructions}</span>
              )}
              <span>Precio unitario: {formatMoney(cartItem.unitPriceCents)}</span>
            </div>
            <div className={styles.cartLineControls}>
              <div
                className={styles.quantityControl}
                role="group"
                aria-label={`Cantidad de ${item.nameEs}`}
              >
                <button
                  type="button"
                  aria-label={`Disminuir ${item.nameEs}`}
                  onClick={() => onDecrease(cartItem)}
                >
                  −
                </button>
                <span>{cartItem.quantity}</span>
                <button
                  type="button"
                  aria-label={`Aumentar ${item.nameEs}`}
                  onClick={() => onIncrease(cartItem)}
                  disabled={(productQuantities.get(item.id) ?? 0) >= MAX_ITEM_QUANTITY}
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className={styles.removeButton}
                aria-label={`Eliminar ${item.nameEs} del carrito`}
                onClick={() => onRemove(cartItem)}
              >
                <TrashIcon aria-hidden="true" />
              </button>
            </div>
            {(item.modifierGroups.length > 0 || item.specialInstructionsEnabled) && (
              <button
                type="button"
                className={styles.editOptionsButton}
                onClick={() => onEdit(cartItem, item)}
                aria-label={`Editar ${item.nameEs}`}
              >
                Editar
              </button>
            )}
            <strong className={styles.cartLineTotal}>
              Total de la línea: {formatMoney(cartItem.unitPriceCents * cartItem.quantity)}
            </strong>
          </li>
        );
      })}
    </ul>
  );
}

export function OrderingExperience({
  restaurant,
  categories,
  items,
  heroImageUrl = null,
}: Props) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<Record<string, boolean>>({});
  const [processingProductId, setProcessingProductId] = useState<string | null>(null);
  const [cartReady, setCartReady] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("featured");
  const [dialogMode, setDialogMode] = useState<DialogMode>("closed");
  const [customization, setCustomization] = useState<CustomizationState | null>(null);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [storageError, setStorageError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitleRef = useRef<HTMLHeadingElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const categorySections = useRef<Record<string, HTMLElement | null>>({});
  const addedTimers = useRef(new Map<string, number>());
  const pendingAdds = useRef(new Map<string, number>());

  useEffect(() => () => {
    for (const timer of addedTimers.current.values()) window.clearTimeout(timer);
    addedTimers.current.clear();
    for (const timer of pendingAdds.current.values()) window.clearTimeout(timer);
    pendingAdds.current.clear();
  }, []);

  const filteredItems = useMemo(() => filterMenuItems(items, search), [items, search]);
  const orderedCategories = useMemo(
    () => [...categories].sort((left, right) => left.sortOrder - right.sortOrder),
    [categories],
  );
  const summary = useMemo(() => summarizeCart(cartItems), [cartItems]);
  const cartQuantities = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const entry of cartItems) {
      quantities.set(entry.productId, (quantities.get(entry.productId) ?? 0) + entry.quantity);
    }
    return quantities;
  }, [cartItems]);
  const featuredItems = filteredItems.filter((item) => item.featured);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const result = readCart(window.localStorage, items);
        setCartItems(result.items);
        if (result.error) {
          setStorageError(true);
          setAnnouncement("No se pudo leer correctamente el carrito guardado.");
        }
      } catch {
        setStorageError(true);
        setAnnouncement("No se pudo leer el carrito guardado en este dispositivo.");
      } finally {
        setCartReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [items]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting || entry.boundingClientRect.top < 180)) return;
      const sections = Object.entries(categorySections.current).flatMap(([id, section]) => {
        if (!section) return [];
        const rect = section.getBoundingClientRect();
        return [{ id, top: rect.top, bottom: rect.bottom }];
      });
      const activeSection = sections
        .filter((section) => section.top <= 180 && section.bottom > 180)
        .sort((left, right) => right.top - left.top)[0] ??
        sections.filter((section) => section.top > 180)
          .sort((left, right) => left.top - right.top)[0];
      if (!activeSection) return;
      setActiveCategory(
        activeSection.id === "featured"
          ? "featured"
          : activeSection.id,
      );
    }, {
      rootMargin: "-150px 0px -65% 0px",
      threshold: 0,
    });
    Object.values(categorySections.current).forEach((section) => {
      if (section) observer.observe(section);
    });
    return () => observer.disconnect();
  }, [filteredItems, orderedCategories]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (dialogMode !== "closed" && !dialog.open) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (dialogMode === "closed" && dialog.open) {
      dialog.close();
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }

    if (dialogMode !== "closed") dialogTitleRef.current?.focus();
  }, [dialogMode]);

  const commitCart = (nextCart: CartItem[], message: string) => {
    setCartItems(nextCart);
    setAnnouncement(message);
    if (cartReady) {
      try {
        const saved = saveCart(window.localStorage, nextCart);
        if (!saved) throw new Error("Storage unavailable");
        setStorageError(false);
      } catch {
        setStorageError(true);
        setAnnouncement("El carrito se actualizó, pero no se pudo guardar en este dispositivo.");
      }
    }
  };

  const showAddedFeedback = (productId: string) => {
    const previousTimer = addedTimers.current.get(productId);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    setRecentlyAdded((current) => ({ ...current, [productId]: true }));
    const timer = window.setTimeout(() => {
      setRecentlyAdded((current) => ({ ...current, [productId]: false }));
      addedTimers.current.delete(productId);
    }, 800);
    addedTimers.current.set(productId, timer);
  };

  const queueAddItem = (item: MenuItem) => {
    if (pendingAdds.current.has(item.id)) return;
    setProcessingProductId(item.id);
    const timer = window.setTimeout(() => {
      pendingAdds.current.delete(item.id);
      setProcessingProductId(null);
      addItem(item);
    }, 0);
    pendingAdds.current.set(item.id, timer);
  };

  const addItem = (item: MenuItem) => {
    const previousQuantity = cartQuantities.get(item.id) ?? 0;
    if (previousQuantity >= MAX_ITEM_QUANTITY) {
      setAnnouncement(`El máximo es ${MAX_ITEM_QUANTITY} unidades por producto.`);
      return;
    }
    const line = createCartItem(item);
    if (!line) return;
    const nextCart = addCartItem(cartItems, line);
    if (nextCart === cartItems) {
      setAnnouncement(`El máximo es ${MAX_ITEM_QUANTITY} unidades por producto.`);
      return;
    }
    commitCart(
      nextCart,
      previousQuantity ? `Cantidad de ${item.nameEs} actualizada.` : `${item.nameEs} agregado al carrito.`,
    );
    showAddedFeedback(item.id);
  };

  const openCustomization = (item: MenuItem, line?: CartItem) => {
    setCustomization({
      item,
      lineId: line?.lineId ?? null,
      modifiers: line?.selectedModifiers ?? [],
      quantity: line?.quantity ?? 1,
      specialInstructions: line?.specialInstructions ?? "",
    });
  };

  const saveCustomization = (
    modifiers: SelectedModifier[],
    quantity: number,
    specialInstructions: string,
  ): boolean => {
    if (!customization) return false;
    const { item, lineId } = customization;
    if (lineId) {
      const nextCart = replaceCartItemConfiguration(
        cartItems,
        lineId,
        item,
        modifiers,
        quantity,
        specialInstructions,
      );
      if (!nextCart) return false;
      commitCart(nextCart, `Opciones de ${item.nameEs} actualizadas.`);
      showAddedFeedback(item.id);
      return true;
    }

    const line = createCartItem(item, modifiers, quantity, specialInstructions);
    if (!line) return false;
    const nextCart = addCartItem(cartItems, line);
    if (nextCart === cartItems) return false;
    commitCart(nextCart, `${item.nameEs} agregado al carrito.`);
    showAddedFeedback(item.id);
    return true;
  };

  const changeLineQuantity = (line: CartItem, adjustment: -1 | 1) => {
    if (
      adjustment === 1 &&
      (cartQuantities.get(line.productId) ?? 0) >= MAX_ITEM_QUANTITY
    ) {
      setAnnouncement(`El máximo es ${MAX_ITEM_QUANTITY} unidades por producto.`);
      return;
    }
    commitCart(
      changeCartItemQuantity(cartItems, line.lineId, adjustment),
      adjustment === -1 && line.quantity === 1
        ? `Línea de ${line.productId} eliminada del carrito.`
        : `Cantidad de ${line.productId} actualizada.`,
    );
  };

  const removeItem = (line: CartItem) => {
    commitCart(
      removeCartItem(cartItems, line.lineId),
      `Producto eliminado del carrito.${cartItems.length === 1 ? " Carrito vacío." : ""}`,
    );
  };

  const emptyCart = () => {
    commitCart([], "Carrito vacío.");
    setDialogMode("cart");
  };

  const selectCategory = (id: string) => {
    setActiveCategory(id);
    if (search) setSearch("");
    const scrollToSection = () => {
      const section = categorySections.current[id];
      section?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    };
    if (search) window.requestAnimationFrame(scrollToSection);
    else scrollToSection();
  };

  const cartButtonLabel = `Ver carrito, ${summary.totalUnits} ${
    summary.totalUnits === 1 ? "producto" : "productos"
  }`;
  const checkoutAmountDollars = Math.floor(summary.subtotalCents / 100);
  const checkoutAmountCents = summary.subtotalCents % 100;
  const checkoutSubtotalLabel =
    `${checkoutAmountDollars} ${checkoutAmountDollars === 1 ? "dólar" : "dólares"} con ` +
    `${checkoutAmountCents} ${checkoutAmountCents === 1 ? "centavo" : "centavos"}`;
  const showCheckoutBar =
    cartReady &&
    summary.items.length > 0 &&
    summary.subtotalCents > 0 &&
    dialogMode === "closed" &&
    customization === null &&
    !addressDialogOpen;

  return (
    <div className={styles.page} lang="es" data-checkout-bar={showCheckoutBar}>
      <header className={styles.siteHeader}>
        <Link className={styles.brand} href="/" aria-label="Recogido, página principal">
          <Image src="/recogidoapplogo.png" alt="" width={40} height={40} />
          <span>Recogido</span>
        </Link>
        <button
          type="button"
          className={styles.headerCartButton}
          onClick={() => setDialogMode("cart")}
          aria-label={cartButtonLabel}
        >
          <ShoppingBagIcon aria-hidden="true" />
          <span className={styles.cartCount}>{summary.totalUnits}</span>
        </button>
      </header>

      <main className={styles.main}>
        <RestaurantHero
          restaurant={restaurant}
          heroImageUrl={heroImageUrl}
          onDialogOpenChange={setAddressDialogOpen}
        />
        <section className={styles.restaurantSummary} aria-label={`Detalles de ${restaurant.name}`}>
          <div className={styles.restaurantSummaryDetails}>
            <span className={styles.demoBadge}>Pedido de demostración</span>
            <h2>{restaurant.name}</h2>
            <p>{restaurant.cuisine} <span aria-hidden="true">•</span> {restaurant.address.city}, {restaurant.address.state}</p>
            <a className={styles.phoneLink} href={`tel:${restaurant.phone}`}>
              <PhoneIcon aria-hidden="true" />
              (201) 871-3544
            </a>
            <p className={styles.priceNotice}>
              Los precios y productos están sujetos a confirmación.
            </p>
          </div>
          <div className={styles.fulfillmentSelector} aria-label="Método de entrega">
            <button type="button" aria-pressed="true">
              <CarIcon aria-hidden="true" />
              Delivery
            </button>
            <button type="button" disabled aria-label="Pickup, próximamente">
              Pickup <span>Próximamente</span>
            </button>
          </div>
        </section>

        <section className={styles.menuPanel} aria-labelledby="menu-title" aria-busy={!cartReady}>
          <div className={styles.menuHeading}>
            <div>
              <p className={styles.eyebrow}>MENÚ</p>
              <h2 id="menu-title">Explora el menú</h2>
              <p className={styles.menuCount}>{items.length} productos para descubrir</p>
            </div>
            <label className={styles.searchBox}>
              <span className={styles.searchIcon} aria-hidden="true"><SearchIcon /></span>
              <span className={styles.visuallyHidden}>Buscar en español o inglés</span>
              <input
                type="search"
                aria-label="Buscar en español o inglés"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar en español o inglés"
                autoComplete="off"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda">
                  ×
                </button>
              )}
            </label>
          </div>

          <nav className={styles.categoryNav} aria-label="Categorías del menú">
            <button
              type="button"
              aria-pressed={activeCategory === "featured"}
              onClick={() => selectCategory("featured")}
            >
              Destacados
            </button>
            {orderedCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={activeCategory === category.id}
                onClick={() => selectCategory(category.id)}
              >
                {category.nameEs}
              </button>
            ))}
          </nav>

          {items.length === 0 ? (
            <div className={styles.emptyState} role="status">
              <h3>Menú no disponible</h3>
              <p>El menú de demostración no está disponible en este momento.</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className={styles.emptyState} role="status">
              <h3>No encontramos resultados</h3>
              <p>Prueba con otro nombre en español o inglés.</p>
              <button type="button" className={styles.secondaryButton} onClick={() => setSearch("")}>
                Limpiar búsqueda
              </button>
            </div>
          ) : (
            <div className={styles.menuSections}>
              {featuredItems.length > 0 && (
                <section
                  id={featuredSectionId}
                  className={styles.menuSection}
                  ref={(element) => { categorySections.current.featured = element; }}
                  aria-labelledby="featured-title"
                >
                  <div className={styles.sectionHeading}>
                    <h2 id="featured-title">Platos destacados</h2>
                    <span>Selección destacada</span>
                  </div>
                  <div className={styles.productGrid}>
                    {featuredItems.map((item) => (
                      <MenuItemCard
                        key={`featured-${item.id}`}
                        item={item}
                        categoryName={getCategoryName(categories, item.categoryId)}
                        quantity={cartQuantities.get(item.id) ?? 0}
                        wasJustAdded={recentlyAdded[item.id] ?? false}
                        isProcessing={processingProductId === item.id}
                        canAdd={cartReady && (cartQuantities.get(item.id) ?? 0) < MAX_ITEM_QUANTITY}
                        onAdd={() => queueAddItem(item)}
                        onCustomize={() => openCustomization(item)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {orderedCategories.map((category) => {
                const sectionItems = filteredItems.filter((item) => item.categoryId === category.id);
                if (!sectionItems.length) return null;

                return (
                  <section
                    key={category.id}
                    id={`menu-${category.id}`}
                    className={styles.menuSection}
                    ref={(element) => { categorySections.current[category.id] = element; }}
                    aria-labelledby={`heading-${category.id}`}
                  >
                    <div className={styles.sectionHeading}>
                      <h2 id={`heading-${category.id}`}>{category.nameEs}</h2>
                      <span>{category.nameEn}</span>
                    </div>
                    <div className={styles.productGrid}>
                      {sectionItems.map((item) => (
                        <MenuItemCard
                          key={`${category.id}-${item.id}`}
                          item={item}
                          categoryName={category.nameEs}
                          quantity={cartQuantities.get(item.id) ?? 0}
                          wasJustAdded={recentlyAdded[item.id] ?? false}
                          isProcessing={processingProductId === item.id}
                          canAdd={cartReady && (cartQuantities.get(item.id) ?? 0) < MAX_ITEM_QUANTITY}
                          onAdd={() => queueAddItem(item)}
                          onCustomize={() => openCustomization(item)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>
        <p className={styles.demoFooter}>
          Catálogo de demostración. No se enviará ningún pedido real.
        </p>
      </main>

      {showCheckoutBar && (
        <div className={styles.mobileCartBar}>
          <Link
            href="/order/la-fonda-paisa/checkout"
            aria-label={`Continuar con La Fonda. ${summary.totalUnits} ${summary.totalUnits === 1 ? "producto" : "productos"}.`}
          >
            <span className={styles.checkoutBarCopy}>
              <span>{summary.totalUnits} {summary.totalUnits === 1 ? "producto" : "productos"}</span>
              <strong>Continuar con La Fonda</strong>
            </span>
            <ShoppingBagIcon className={styles.checkoutBarIcon} aria-hidden="true" />
          </Link>
        </div>
      )}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="ordering-dialog-title"
        aria-describedby="ordering-dialog-description"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setDialogMode("closed");
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          setDialogMode("closed");
        }}
      >
        <div className={styles.dialogHeader}>
          <div>
            <p className={styles.eyebrow}>TU PEDIDO</p>
            <h2 id="ordering-dialog-title" ref={dialogTitleRef} tabIndex={-1}>
              {dialogMode === "confirm-clear" ? (
                "¿Vaciar el carrito?"
              ) : (
                <span className={styles.cartHeading}>
                  <ShoppingBagIcon aria-hidden="true" />
                  Tu carrito
                </span>
              )}
            </h2>
          </div>
          <button
            type="button"
            className={styles.dialogClose}
            onClick={() => setDialogMode("closed")}
            aria-label="Cerrar carrito"
          >
            ×
          </button>
        </div>
        <p id="ordering-dialog-description" className={styles.dialogDescription}>
          {dialogMode === "confirm-clear"
            ? "Se quitarán todos los productos de este carrito."
            : "Revisa o actualiza los productos de tu carrito."}
        </p>

        {dialogMode === "confirm-clear" ? (
          <div className={styles.confirmClear}>
            <p>¿Quieres quitar todos los productos del carrito?</p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setDialogMode("cart")}
              >
                <ShoppingBagIcon aria-hidden="true" />
                Volver al carrito
              </button>
              <button type="button" className={styles.dangerButton} onClick={emptyCart}>
                Vaciar carrito
              </button>
            </div>
          </div>
        ) : (
          <>
            <CartLines
              cartItems={summary.items}
              menuItems={items}
              categories={categories}
              onIncrease={(line) => changeLineQuantity(line, 1)}
              onDecrease={(line) => changeLineQuantity(line, -1)}
              onRemove={removeItem}
              onEdit={(line, item) => openCustomization(item, line)}
            />
            <div className={styles.priceSummary}>
              <div>
                <span>Subtotal de productos</span>
                <strong>{formatMoney(summary.subtotalCents)}</strong>
              </div>
              <div>
                <span>Impuestos</span>
                <span>Calculados al confirmar</span>
              </div>
              <div>
                <span>Tarifa de entrega</span>
                <span>Calculada según la dirección</span>
              </div>
              <div className={styles.provisionalTotal}>
                <span>Total provisional</span>
                <strong>{formatMoney(summary.subtotalCents)}</strong>
              </div>
              <p>El total provisional no incluye impuestos ni tarifa de entrega.</p>
            </div>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setDialogMode("confirm-clear")}
                disabled={!summary.totalUnits}
              >
                Vaciar carrito
              </button>
              <Link
                href="/order/la-fonda-paisa/checkout"
                className={styles.primaryButton}
                onClick={(event) => {
                  if (!summary.totalUnits) {
                    event.preventDefault();
                    return;
                  }
                  setDialogMode("closed");
                }}
                aria-label={`Continuar con La Fonda. ${summary.totalUnits} ${summary.totalUnits === 1 ? "producto" : "productos"}. Subtotal ${checkoutSubtotalLabel}.`}
                aria-disabled={!summary.totalUnits}
                tabIndex={summary.totalUnits ? 0 : -1}
              >
                Continuar
              </Link>
            </div>
          </>
        )}
      </dialog>

      <ProductCustomizationDialog
        key={customization
          ? `${customization.item.id}:${customization.lineId ?? "new"}`
          : "closed"}
        item={customization?.item ?? null}
        initialModifiers={customization?.modifiers ?? []}
        initialQuantity={customization?.quantity ?? 1}
        initialSpecialInstructions={customization?.specialInstructions ?? ""}
        editingLineId={customization?.lineId ?? null}
        onClose={() => setCustomization(null)}
        onSave={(modifiers, quantity, specialInstructions) =>
          saveCustomization(modifiers, quantity, specialInstructions)
        }
      />

      <p className={styles.visuallyHidden} aria-live="polite" aria-atomic="true">
        {announcement}
        {storageError ? ` ${CART_STORAGE_KEY}: el guardado local no está disponible.` : ""}
      </p>
    </div>
  );
}

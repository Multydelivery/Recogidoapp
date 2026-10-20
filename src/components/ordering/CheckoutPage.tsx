"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CheckIcon, RestaurantIcon, ShoppingBagIcon } from "@/components/icons";
import {
  CART_STORAGE_KEY,
  changeCartItemQuantity,
  MAX_ITEM_QUANTITY,
  readCart,
  removeCartItem,
  replaceCartItemConfiguration,
  saveCart,
  summarizeCart,
} from "@/lib/ordering/cart";
import {
  calculateCheckoutTotals,
  checkoutPricingConfig,
  emptyDeliveryAddress,
  maskDeliveryStreet,
  normalizeDeliveryAddress,
  validateDeliveryAddress,
  type CheckoutPricingConfig,
  type DeliveryAddress,
  type DeliveryAddressErrors,
  type DeliveryAddressField,
} from "@/lib/ordering/checkout";
import type { CartItem, MenuItem, Restaurant, SelectedModifier } from "@/lib/ordering/types";
import { ProductCustomizationDialog } from "./ProductCustomizationDialog";
import styles from "./CheckoutPage.module.css";

type CheckoutStep = 0 | 1 | 2 | 3;
type CustomizationState = {
  item: MenuItem;
  lineId: string;
  modifiers: SelectedModifier[];
  quantity: number;
  specialInstructions: string;
};

type Props = {
  restaurant: Restaurant;
  items: MenuItem[];
  pricingConfig?: CheckoutPricingConfig;
};

type DemoConfirmation = {
  number: string;
  totalUnits: number;
  partialTotalCents: number;
  pendingCharges: string[];
  maskedAddress: string;
};

const addressFields: DeliveryAddressField[] = [
  "street",
  "unit",
  "city",
  "state",
  "zip",
  "instructions",
];

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function makeDemoNumber(): string {
  return `DEMO-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`;
}

function CheckoutStepper({
  step,
  onNavigate,
}: {
  step: CheckoutStep;
  onNavigate: (nextStep: 0 | 1 | 2) => void;
}) {
  const activeStep: 0 | 1 | 2 = step === 3 ? 2 : step;
  const steps = [
    { index: 0, label: "Carrito" },
    { index: 1, label: "Dirección" },
    { index: 2, label: "Revisar" },
  ] as const;

  return (
    <ol className={styles.stepper} aria-label="Pasos del checkout">
      {steps.map(({ index: stepIndex, label }) => {
        const isCurrent = activeStep === stepIndex;
        const isComplete = step > stepIndex;
        return (
          <li
            key={label}
            className={styles.step}
            data-current={isCurrent}
            data-complete={isComplete}
            data-future={stepIndex > activeStep}
          >
            <button
              type="button"
              className={styles.stepButton}
              aria-label={`${stepIndex + 1}. ${label}${isCurrent ? ", paso actual" : isComplete ? ", completado" : ""}`}
              aria-current={isCurrent ? "step" : undefined}
              disabled={stepIndex >= activeStep}
              onClick={() => onNavigate(stepIndex)}
            >
              {isComplete ? <CheckIcon aria-hidden="true" /> : stepIndex + 1}
            </button>
            <span className={styles.stepLabel}>
              {label === "Carrito" && <ShoppingBagIcon className={styles.cartIcon} aria-hidden="true" />}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CartLineCard({
  line,
  item,
  canIncrease,
  onIncrease,
  onDecrease,
  onEdit,
  onRemove,
}: {
  line: CartItem;
  item: MenuItem;
  canIncrease: boolean;
  onIncrease: () => void;
  onDecrease: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const imageIsLocal = Boolean(item.imageUrl?.startsWith("/") && !item.imageUrl.startsWith("//"));
  const groupsById = new Map(item.modifierGroups.map((group) => [group.id, group]));

  return (
    <li className={styles.lineCard}>
      <div className={styles.productImage}>
        {imageIsLocal && item.imageUrl ? (
          <Image src={item.imageUrl} alt="" fill sizes="104px" />
        ) : (
          <div className={styles.productPlaceholder} role="img" aria-label="Imagen del producto próximamente">
            <RestaurantIcon aria-hidden="true" />
            <span>Imagen próximamente</span>
          </div>
        )}
      </div>
      <div className={styles.lineBody}>
        <h2 className={styles.lineName}>{item.nameEs}</h2>
        <p className={styles.lineEnglish}>{item.nameEn}</p>
        <p className={styles.unitPrice}>
          Precio unitario configurado: {formatMoney(line.unitPriceCents)}
        </p>
        {line.selectedModifiers.length > 0 && (
          <ul className={styles.modifierList} aria-label={`Opciones de ${item.nameEs}`}>
            {line.selectedModifiers.map((modifier) => (
              <li key={`${modifier.groupId}-${modifier.optionId}`}>
                <strong>{groupsById.get(modifier.groupId)?.nameEs ?? "Opción"}:</strong>{" "}
                {modifier.nameEs}
                {modifier.priceAdjustmentCents > 0 &&
                  ` (+${formatMoney(modifier.priceAdjustmentCents)})`}
              </li>
            ))}
          </ul>
        )}
        {line.specialInstructions && (
          <p className={styles.specialInstructions}>
            <strong>Instrucciones:</strong> {line.specialInstructions}
          </p>
        )}
        <div className={styles.lineFooter}>
          <div className={styles.quantityControls} aria-label={`Cantidad de ${item.nameEs}`}>
            <button
              type="button"
              aria-label={`Disminuir ${item.nameEs}`}
              onClick={onDecrease}
            >
              −
            </button>
            <span className={styles.quantityValue}>{line.quantity}</span>
            <button
              type="button"
              aria-label={`Aumentar ${item.nameEs}`}
              onClick={onIncrease}
              disabled={!canIncrease}
            >
              +
            </button>
          </div>
          <strong className={styles.lineTotal}>
            Total de la línea: {formatMoney(line.unitPriceCents * line.quantity)}
          </strong>
          <div className={styles.lineActions}>
            {(item.modifierGroups.length > 0 || item.specialInstructionsEnabled) && (
              <button type="button" className={styles.textButton} onClick={onEdit}>
                Editar
              </button>
            )}
            <button
              type="button"
              className={`${styles.textButton} ${styles.deleteButton}`}
              onClick={onRemove}
              aria-label={`Eliminar ${item.nameEs} del carrito`}
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function PricingSummary({
  totals,
}: {
  totals: ReturnType<typeof calculateCheckoutTotals>;
}) {
  return (
    <section className={styles.pricingCard} aria-labelledby="pricing-title">
      <h2 id="pricing-title">Resumen de precios</h2>
      <div className={styles.priceRow}>
        <span>Subtotal de comida</span>
        <strong>{formatMoney(totals.subtotalCents)}</strong>
      </div>
      <div className={styles.priceRow}>
        <span>Service fee</span>
        <strong className={totals.serviceFeeCents === null ? styles.pending : undefined}>
          {totals.serviceFeeCents === null ? "Por confirmar" : formatMoney(totals.serviceFeeCents)}
        </strong>
      </div>
      <div className={styles.priceRow}>
        <span>Delivery fee</span>
        <strong className={totals.deliveryFeeCents === null ? styles.pending : undefined}>
          {totals.deliveryFeeCents === null
            ? "Se calcula según la dirección"
            : formatMoney(totals.deliveryFeeCents)}
        </strong>
      </div>
      <div className={styles.priceRow}>
        <span>Tax</span>
        <strong className={totals.taxCents === null ? styles.pending : undefined}>
          {totals.taxCents === null ? "Se calcula al confirmar" : formatMoney(totals.taxCents)}
        </strong>
      </div>
      <div className={styles.grandTotal}>
        <span>Total parcial</span>
        <strong>{formatMoney(totals.partialTotalCents)}</strong>
      </div>
      {totals.hasPendingCharges && (
        <p className={styles.pendingNote}>
          Hay cargos pendientes de confirmación; este importe no es el total final.
        </p>
      )}
    </section>
  );
}

export function CheckoutPage({
  restaurant,
  items,
  pricingConfig = checkoutPricingConfig,
}: Props) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [step, setStep] = useState<CheckoutStep>(0);
  const [address, setAddress] = useState<DeliveryAddress>(emptyDeliveryAddress);
  const [addressErrors, setAddressErrors] = useState<DeliveryAddressErrors>({});
  const [customization, setCustomization] = useState<CustomizationState | null>(null);
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);
  const [demoConfirmation, setDemoConfirmation] = useState<DemoConfirmation | null>(null);
  const addressFieldRefs = useRef<
    Record<DeliveryAddressField, HTMLInputElement | HTMLTextAreaElement | null>
  >({
    street: null,
    unit: null,
    city: null,
    state: null,
    zip: null,
    instructions: null,
  });
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  const clearCancelRef = useRef<HTMLButtonElement>(null);
  const clearTriggerRef = useRef<HTMLElement | null>(null);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const validCartItems = useMemo(
    () => cartItems.filter((line) => itemById.has(line.productId)),
    [cartItems, itemById],
  );
  const summary = useMemo(() => summarizeCart(validCartItems), [validCartItems]);
  const totals = useMemo(
    () => calculateCheckoutTotals(summary.subtotalCents, pricingConfig),
    [pricingConfig, summary.subtotalCents],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const result = readCart(window.localStorage, items);
        setCartItems(result.items);
        setStorageError(result.error);
      } catch {
        setStorageError(true);
      } finally {
        setCartReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [items]);

  useEffect(() => {
    const dialog = clearDialogRef.current;
    if (!dialog) return;
    if (clearConfirmationOpen && !dialog.open) {
      clearTriggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      clearCancelRef.current?.focus();
    } else if (!clearConfirmationOpen && dialog.open) {
      dialog.close();
      if (clearTriggerRef.current?.isConnected) clearTriggerRef.current.focus();
      clearTriggerRef.current = null;
    }
  }, [clearConfirmationOpen]);

  const commitCart = (nextCart: CartItem[]) => {
    setCartItems(nextCart);
    try {
      const saved = saveCart(window.localStorage, nextCart);
      setStorageError(!saved);
    } catch {
      setStorageError(true);
    }
  };

  const updateQuantity = (line: CartItem, delta: -1 | 1) => {
    const nextCart = changeCartItemQuantity(cartItems, line.lineId, delta);
    if (nextCart !== cartItems) commitCart(nextCart);
  };

  const editLine = (line: CartItem, item: MenuItem) => {
    setCustomization({
      item,
      lineId: line.lineId,
      modifiers: line.selectedModifiers,
      quantity: line.quantity,
      specialInstructions: line.specialInstructions ?? "",
    });
  };

  const saveCustomization = (
    modifiers: SelectedModifier[],
    quantity: number,
    specialInstructions: string,
  ): boolean => {
    if (!customization) return false;
    const nextCart = replaceCartItemConfiguration(
      cartItems,
      customization.lineId,
      customization.item,
      modifiers,
      quantity,
      specialInstructions,
    );
    if (!nextCart) return false;
    commitCart(nextCart);
    return true;
  };

  const continueToAddress = () => {
    if (!validCartItems.length || summary.subtotalCents <= 0) return;
    setStep(1);
  };

  const continueFromAddress = () => {
    const result = validateDeliveryAddress(address);
    setAddress(result.value);
    setAddressErrors(result.errors);
    const firstInvalidField = addressFields.find((field) => result.errors[field]);
    if (firstInvalidField) {
      addressFieldRefs.current[firstInvalidField]?.focus();
      return;
    }
    setStep(2);
  };

  const submitAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    continueFromAddress();
  };

  const confirmDemoOrder = () => {
    if (!validCartItems.length) return;
    const addressResult = validateDeliveryAddress(address);
    if (Object.keys(addressResult.errors).length > 0) {
      setAddressErrors(addressResult.errors);
      setStep(1);
      const firstInvalidField = addressFields.find((field) => addressResult.errors[field]);
      if (firstInvalidField) addressFieldRefs.current[firstInvalidField]?.focus();
      return;
    }
    const normalizedAddress = addressResult.value;
    const pendingCharges: string[] = [];
    if (totals.serviceFeeCents === null) pendingCharges.push("Service fee por confirmar");
    if (totals.deliveryFeeCents === null) pendingCharges.push("Delivery fee por confirmar");
    if (totals.taxCents === null) pendingCharges.push("Tax por confirmar");
    setDemoConfirmation({
      number: makeDemoNumber(),
      totalUnits: summary.totalUnits,
      partialTotalCents: totals.partialTotalCents,
      pendingCharges,
      maskedAddress: maskDeliveryStreet(normalizedAddress.street),
    });
    setAddress(emptyDeliveryAddress);
    setAddressErrors({});
    setStep(3);
  };

  const clearCart = () => {
    commitCart([]);
    setClearConfirmationOpen(false);
  };

  const closeClearDialog = () => setClearConfirmationOpen(false);
  const returnToMenu = () => {
    setAddress(emptyDeliveryAddress);
    setAddressErrors({});
  };

  const formatAddress = normalizeDeliveryAddress(address);
  return (
    <div className={styles.page} lang="es">
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Recogido, página principal">
          <Image src="/recogidoapplogo.png" alt="" width={38} height={38} />
          <span>Recogido</span>
        </Link>
        <Link
          className={styles.backLink}
          href="/order/la-fonda-paisa"
          onClick={returnToMenu}
        >
          ← Volver al menú
        </Link>
      </header>

      <main className={styles.main}>
        {!cartReady ? (
          <div className={styles.contentCard} role="status">Cargando tu carrito…</div>
        ) : !validCartItems.length || summary.subtotalCents <= 0 ? (
          <section className={`${styles.contentCard} ${styles.emptyState}`}>
            <RestaurantIcon aria-hidden="true" />
            <h2 className={styles.cartHeading}>
              <ShoppingBagIcon aria-hidden="true" />
              Tu carrito está vacío
            </h2>
            <p className={styles.description}>Agrega productos del menú para preparar una demostración.</p>
            <Link className={styles.primaryButton} href="/order/la-fonda-paisa" onClick={returnToMenu}>
              Volver al menú
            </Link>
          </section>
        ) : step === 3 && demoConfirmation ? (
          <section className={`${styles.contentCard} ${styles.confirmation}`} aria-labelledby="confirmation-title">
            <span className={styles.confirmationIcon}><CheckIcon aria-hidden="true" /></span>
            <h1 id="confirmation-title" className={styles.title}>Pedido de demostración preparado</h1>
            <p className={styles.description}>
              Tu pedido fue revisado correctamente. No se envió al restaurante y no se realizó ningún cobro.
            </p>
            <p className={styles.demoNumber}>{demoConfirmation.number}</p>
            <div className={styles.confirmationDetails}>
              <p><span>Productos</span><strong>{demoConfirmation.totalUnits}</strong></p>
              <p><span>Total parcial</span><strong>{formatMoney(demoConfirmation.partialTotalCents)}</strong></p>
              <p><span>Entrega en</span><strong>{demoConfirmation.maskedAddress}</strong></p>
              {demoConfirmation.pendingCharges.map((charge) => (
                <p key={charge}><span>Cargo pendiente</span><strong>{charge}</strong></p>
              ))}
            </div>
            <div className={styles.confirmationActions}>
              <Link className={styles.primaryButton} href="/order/la-fonda-paisa" onClick={returnToMenu}>
                Volver al menú
              </Link>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setAddress(emptyDeliveryAddress);
                  setDemoConfirmation(null);
                  setStep(0);
                }}
              >
                Conservar carrito para editar
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={(event) => {
                  clearTriggerRef.current = event.currentTarget;
                  setClearConfirmationOpen(true);
                }}
              >
                Vaciar carrito
              </button>
            </div>
          </section>
        ) : (
          <>
            <CheckoutStepper
              step={step}
              onNavigate={(nextStep) => setStep(nextStep)}
            />

            {step === 0 && (
              <section className={styles.contentCard} aria-labelledby="cart-review-title">
                <p className={styles.eyebrow}>{restaurant.name.toLocaleUpperCase("es-US")}</p>
                <h1 id="cart-review-title" className={styles.title}>Revisa tu pedido</h1>
                <p className={styles.description}>
                  Confirma los platos, cantidades y opciones antes de continuar.
                </p>
                <ul className={styles.lineList}>
                  {validCartItems.map((line) => {
                    const item = itemById.get(line.productId);
                    if (!item) return null;
                    const productQuantity = cartItems
                      .filter((entry) => entry.productId === line.productId)
                      .reduce((total, entry) => total + entry.quantity, 0);
                    return (
                      <CartLineCard
                        key={line.lineId}
                        line={line}
                        item={item}
                        canIncrease={productQuantity < MAX_ITEM_QUANTITY}
                        onIncrease={() => updateQuantity(line, 1)}
                        onDecrease={() => updateQuantity(line, -1)}
                        onEdit={() => editLine(line, item)}
                        onRemove={() => commitCart(removeCartItem(cartItems, line.lineId))}
                      />
                    );
                  })}
                </ul>
                <div className={styles.subtotalRow}>
                  <span>Subtotal de comida</span>
                  <strong>{formatMoney(summary.subtotalCents)}</strong>
                </div>
                <p className={styles.description}>
                  Los cargos adicionales y la disponibilidad deben confirmarse antes de cualquier pedido real.
                </p>
              </section>
            )}

            {step === 1 && (
              <section className={styles.contentCard} aria-labelledby="address-title">
                <p className={styles.eyebrow}>PASO 2 DE 3</p>
                <h1 id="address-title" className={styles.title}>¿Dónde entregamos tu pedido?</h1>
                <p className={styles.description}>
                  Ingresa la dirección donde quieres recibir la orden.
                </p>
                <p className={styles.addressNotice}>
                  La disponibilidad y tarifa de entrega deben confirmarse antes de realizar el pedido.
                </p>
                <form className={styles.addressForm} autoComplete="off" noValidate onSubmit={submitAddress}>
                  <div className={`${styles.field} ${styles.fieldWide}`}>
                    <label htmlFor="delivery-street">Dirección principal</label>
                    <input
                      id="delivery-street"
                      name="street"
                      autoComplete="off"
                      value={address.street}
                      ref={(element) => { addressFieldRefs.current.street = element; }}
                      aria-invalid={Boolean(addressErrors.street)}
                      aria-describedby={addressErrors.street ? "delivery-street-error" : undefined}
                      onChange={(event) => {
                        setAddress((current) => ({ ...current, street: event.target.value }));
                        setAddressErrors((current) => ({ ...current, street: undefined }));
                      }}
                    />
                    {addressErrors.street && <span id="delivery-street-error" className={styles.fieldError}>{addressErrors.street}</span>}
                  </div>
                  <div className={`${styles.field} ${styles.fieldWide}`}>
                    <label htmlFor="delivery-unit">Apartamento, piso o unidad <span className={styles.optional}>— opcional</span></label>
                    <input
                      id="delivery-unit"
                      name="unit"
                      autoComplete="off"
                      value={address.unit}
                      ref={(element) => { addressFieldRefs.current.unit = element; }}
                      onChange={(event) => {
                        setAddress((current) => ({ ...current, unit: event.target.value }));
                        setAddressErrors((current) => ({ ...current, unit: undefined }));
                      }}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="delivery-city">Ciudad</label>
                    <input
                      id="delivery-city"
                      name="city"
                      autoComplete="off"
                      value={address.city}
                      ref={(element) => { addressFieldRefs.current.city = element; }}
                      aria-invalid={Boolean(addressErrors.city)}
                      aria-describedby={addressErrors.city ? "delivery-city-error" : undefined}
                      onChange={(event) => {
                        setAddress((current) => ({ ...current, city: event.target.value }));
                        setAddressErrors((current) => ({ ...current, city: undefined }));
                      }}
                    />
                    {addressErrors.city && <span id="delivery-city-error" className={styles.fieldError}>{addressErrors.city}</span>}
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="delivery-state">Estado</label>
                    <input
                      id="delivery-state"
                      name="state"
                      autoComplete="off"
                      value={address.state}
                      ref={(element) => { addressFieldRefs.current.state = element; }}
                      aria-invalid={Boolean(addressErrors.state)}
                      aria-describedby={addressErrors.state ? "delivery-state-error" : undefined}
                      onChange={(event) => {
                        setAddress((current) => ({ ...current, state: event.target.value }));
                        setAddressErrors((current) => ({ ...current, state: undefined }));
                      }}
                    />
                    {addressErrors.state && <span id="delivery-state-error" className={styles.fieldError}>{addressErrors.state}</span>}
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="delivery-zip">Código postal</label>
                    <input
                      id="delivery-zip"
                      name="zip"
                      autoComplete="off"
                      inputMode="numeric"
                      value={address.zip}
                      ref={(element) => { addressFieldRefs.current.zip = element; }}
                      aria-invalid={Boolean(addressErrors.zip)}
                      aria-describedby={addressErrors.zip ? "delivery-zip-error" : undefined}
                      onChange={(event) => {
                        setAddress((current) => ({ ...current, zip: event.target.value }));
                        setAddressErrors((current) => ({ ...current, zip: undefined }));
                      }}
                    />
                    {addressErrors.zip && <span id="delivery-zip-error" className={styles.fieldError}>{addressErrors.zip}</span>}
                  </div>
                  <div className={`${styles.field} ${styles.fieldWide}`}>
                    <label htmlFor="delivery-instructions">Instrucciones para el conductor <span className={styles.optional}>— opcional</span></label>
                    <textarea
                      id="delivery-instructions"
                      name="instructions"
                      maxLength={200}
                      value={address.instructions}
                      ref={(element) => { addressFieldRefs.current.instructions = element; }}
                      aria-invalid={Boolean(addressErrors.instructions)}
                      aria-describedby={addressErrors.instructions ? "delivery-instructions-error" : "delivery-instructions-count"}
                      onChange={(event) => {
                        setAddress((current) => ({ ...current, instructions: event.target.value }));
                        setAddressErrors((current) => ({ ...current, instructions: undefined }));
                      }}
                    />
                    <span id="delivery-instructions-count" className={styles.optional}>
                      {address.instructions.length}/200 caracteres
                    </span>
                    {addressErrors.instructions && <span id="delivery-instructions-error" className={styles.fieldError}>{addressErrors.instructions}</span>}
                  </div>
                  <div className={`${styles.formActions} ${styles.fieldWide}`}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => setStep(0)}
                    >
                      <ShoppingBagIcon aria-hidden="true" />
                      Volver al carrito
                    </button>
                  </div>
                </form>
              </section>
            )}

            {step === 2 && (
              <section className={styles.contentCard} aria-labelledby="final-review-title">
                <p className={styles.eyebrow}>PASO 3 DE 3</p>
                <h1 id="final-review-title" className={styles.title}>Revisa y confirma</h1>
                <section className={styles.reviewSection} aria-labelledby="review-address-title">
                  <div className={styles.sectionHeader}>
                    <h2 id="review-address-title">Dirección de entrega</h2>
                    <button type="button" className={styles.textButton} onClick={() => setStep(1)}>
                      Editar dirección
                    </button>
                  </div>
                  <p className={styles.addressText}>
                    {formatAddress.street}
                    {formatAddress.unit && <><br />{formatAddress.unit}</>}
                    <br />{formatAddress.city}, {formatAddress.state} {formatAddress.zip}
                    {formatAddress.instructions && <><br />Instrucciones: {formatAddress.instructions}</>}
                  </p>
                  <p className={styles.addressNotice}>
                    La disponibilidad y tarifa de entrega deben confirmarse antes de realizar el pedido.
                  </p>
                </section>
                <section className={styles.reviewSection} aria-labelledby="review-order-title">
                  <div className={styles.sectionHeader}>
                    <h2 id="review-order-title">Tu pedido</h2>
                    <button type="button" className={styles.textButton} onClick={() => setStep(0)}>
                      <ShoppingBagIcon aria-hidden="true" />
                      Editar carrito
                    </button>
                  </div>
                  <div className={styles.reviewItems}>
                    {validCartItems.map((line) => {
                      const item = itemById.get(line.productId);
                      if (!item) return null;
                      return (
                        <div className={styles.reviewItem} key={line.lineId}>
                          <div>
                            <strong>{line.quantity} × {item.nameEs}</strong>
                            {line.selectedModifiers.length > 0 && (
                              <p>{line.selectedModifiers.map((modifier) => modifier.nameEs).join(" · ")}</p>
                            )}
                            {line.specialInstructions && <p>Instrucciones: {line.specialInstructions}</p>}
                          </div>
                          <strong>{formatMoney(line.unitPriceCents * line.quantity)}</strong>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <PricingSummary totals={totals} />
                <section className={styles.reviewSection} aria-labelledby="payment-title">
                  <h2 id="payment-title" className={styles.lineName}>Método de pago</h2>
                  <label className={styles.paymentCard}>
                    <input type="radio" name="demo-payment" disabled />
                    <span>
                      <strong>Pago en línea</strong>
                      <p>Disponible en la próxima etapa.</p>
                      <p>Los métodos de pago se habilitarán después de conectar un proveedor seguro.</p>
                    </span>
                  </label>
                </section>
                <p className={styles.demoNotice}>
                  Este pedido no será enviado al restaurante ni se realizará ningún cobro.
                </p>
              </section>
            )}
          </>
        )}
      </main>

      {cartReady && validCartItems.length > 0 && step < 3 && (
        <div className={styles.bottomBar}>
          <div className={styles.bottomBarInner}>
            {step === 0 && (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={continueToAddress}
              >
                <span>Continuar a dirección — {formatMoney(summary.subtotalCents)}</span>
                <span aria-hidden="true">→</span>
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={continueFromAddress}
              >
                Continuar a revisar orden
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={confirmDemoOrder}
              >
                Confirmar pedido de demostración
              </button>
            )}
          </div>
        </div>
      )}

      <dialog
        ref={clearDialogRef}
        className={styles.clearDialog}
        aria-labelledby="clear-cart-title"
        onCancel={(event) => {
          event.preventDefault();
          closeClearDialog();
        }}
      >
        <h2 id="clear-cart-title">¿Quieres eliminar todos los productos del carrito?</h2>
        <p>El carrito se conservará a menos que confirmes esta acción.</p>
        <div className={styles.formActions}>
          <button
            ref={clearCancelRef}
            type="button"
            className={styles.secondaryButton}
            onClick={closeClearDialog}
          >
            Conservar carrito
          </button>
          <button type="button" className={styles.primaryButton} onClick={clearCart}>
            Sí, vaciar carrito
          </button>
        </div>
      </dialog>

      <ProductCustomizationDialog
        key={customization ? `${customization.lineId}:${customization.item.id}` : "closed"}
        item={customization?.item ?? null}
        initialModifiers={customization?.modifiers ?? []}
        initialQuantity={customization?.quantity ?? 1}
        initialSpecialInstructions={customization?.specialInstructions ?? ""}
        editingLineId={customization?.lineId ?? null}
        onClose={() => setCustomization(null)}
        onSave={(modifiers, quantity, specialInstructions) =>
          saveCustomization(modifiers, quantity, specialInstructions)}
      />

      {storageError && (
        <p role="alert" className={styles.visuallyHidden}>
          No se pudo guardar el carrito en este dispositivo ({CART_STORAGE_KEY}).
        </p>
      )}
    </div>
  );
}

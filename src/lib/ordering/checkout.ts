export interface CheckoutPricingConfig {
  serviceFeeCents: number | null;
  deliveryFeeCents: number | null;
  taxRateBasisPoints: number | null;
  serviceFeeTaxable: boolean;
  deliveryFeeTaxable: boolean;
  merchantConfirmed: boolean;
}

export const checkoutPricingConfig: CheckoutPricingConfig = {
  serviceFeeCents: null,
  deliveryFeeCents: null,
  taxRateBasisPoints: null,
  serviceFeeTaxable: false,
  deliveryFeeTaxable: false,
  merchantConfirmed: false,
};

export interface CheckoutTotals {
  subtotalCents: number;
  serviceFeeCents: number | null;
  deliveryFeeCents: number | null;
  taxCents: number | null;
  partialTotalCents: number;
  hasPendingCharges: boolean;
}

export function calculateCheckoutTotals(
  subtotalCents: number,
  config: CheckoutPricingConfig = checkoutPricingConfig,
): CheckoutTotals {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    throw new RangeError("Subtotal must be a non-negative safe integer in cents.");
  }

  for (const fee of [config.serviceFeeCents, config.deliveryFeeCents]) {
    if (fee !== null && (!Number.isSafeInteger(fee) || fee < 0)) {
      throw new RangeError("Checkout fees must be null or non-negative safe integers in cents.");
    }
  }
  if (
    config.taxRateBasisPoints !== null &&
    (!Number.isSafeInteger(config.taxRateBasisPoints) || config.taxRateBasisPoints < 0)
  ) {
    throw new RangeError("Tax rate must be null or a non-negative integer in basis points.");
  }

  const serviceFeeCents = config.merchantConfirmed ? config.serviceFeeCents : null;
  const deliveryFeeCents = config.merchantConfirmed ? config.deliveryFeeCents : null;
  const taxRateBasisPoints = config.merchantConfirmed ? config.taxRateBasisPoints : null;
  let taxableSubtotalCents = subtotalCents;
  if (config.serviceFeeTaxable && serviceFeeCents !== null) {
    taxableSubtotalCents += serviceFeeCents;
  }
  if (config.deliveryFeeTaxable && deliveryFeeCents !== null) {
    taxableSubtotalCents += deliveryFeeCents;
  }
  if (!Number.isSafeInteger(taxableSubtotalCents)) {
    throw new RangeError("Taxable subtotal exceeds the safe integer range.");
  }
  const taxNumerator = taxRateBasisPoints === null
    ? null
    : taxableSubtotalCents * taxRateBasisPoints + 5_000;
  if (
    taxNumerator !== null &&
    !Number.isSafeInteger(taxNumerator)
  ) {
    throw new RangeError("Tax calculation exceeds the safe integer range.");
  }
  const taxCents = taxNumerator === null
    ? null
    : Math.floor(taxNumerator / 10_000);
  let partialTotalCents = subtotalCents;
  if (serviceFeeCents !== null) partialTotalCents += serviceFeeCents;
  if (deliveryFeeCents !== null) partialTotalCents += deliveryFeeCents;
  if (taxCents !== null) partialTotalCents += taxCents;
  if (!Number.isSafeInteger(partialTotalCents)) {
    throw new RangeError("Partial total exceeds the safe integer range.");
  }

  return {
    subtotalCents,
    serviceFeeCents,
    deliveryFeeCents,
    taxCents,
    partialTotalCents,
    hasPendingCharges:
      serviceFeeCents === null ||
      deliveryFeeCents === null ||
      taxCents === null,
  };
}

export interface DeliveryAddress {
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  instructions: string;
}

export type DeliveryAddressField = keyof DeliveryAddress;
export type DeliveryAddressErrors = Partial<Record<DeliveryAddressField, string>>;

export const emptyDeliveryAddress: DeliveryAddress = {
  street: "",
  unit: "",
  city: "Englewood",
  state: "NJ",
  zip: "",
  instructions: "",
};

export function normalizeDeliveryAddress(
  address: DeliveryAddress,
): DeliveryAddress {
  return {
    street: address.street.trim().replace(/\s+/g, " "),
    unit: address.unit.trim().replace(/\s+/g, " "),
    city: address.city.trim().replace(/\s+/g, " "),
    state: address.state.trim().replace(/\s+/g, " ").toUpperCase(),
    zip: address.zip.trim().replace(/\s+/g, ""),
    instructions: address.instructions.trim().replace(/\s+/g, " "),
  };
}

export function validateDeliveryAddress(
  address: DeliveryAddress,
): { value: DeliveryAddress; errors: DeliveryAddressErrors } {
  const value = normalizeDeliveryAddress(address);
  const errors: DeliveryAddressErrors = {};
  if (!value.street) errors.street = "Ingresa la dirección.";
  if (!value.city) errors.city = "Ingresa la ciudad.";
  if (!value.state) errors.state = "Ingresa el estado.";
  if (!/^\d{5}(?:-\d{4})?$/.test(value.zip)) {
    errors.zip = "Ingresa un ZIP válido, por ejemplo 07631 o 07631-1234.";
  }
  if (value.instructions.length > 200) {
    errors.instructions = "Las instrucciones no pueden superar 200 caracteres.";
  }
  return { value, errors };
}

export function maskDeliveryStreet(street: string): string {
  const publicStreet = street.replace(/^\d+[\s-]*/, "").slice(0, 24).trim();
  return `${publicStreet || "Dirección"} ••••`;
}

export const PLATFORM_RATE_BPS = 1000;
export const BASE_COORDINATION_FEE_CENTS = 200;
export const PILOT_MAX_COORDINATION_FEE_CENTS = 500;
export const DEFAULT_TEMPORARY_RESERVE_BPS = 1000;
export const MAX_TEMPORARY_RESERVE_CENTS = 500;
export const MAX_PROVIDER_CENTS = 100_000_000;

export function assertCents(value: number, maximum = MAX_PROVIDER_CENTS): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error("El importe debe ser un entero de centavos entre cero y el límite permitido.");
  }
}

export function roundedRatio(value: number, numerator: number, denominator: number): number {
  if (![value, numerator, denominator].every(Number.isSafeInteger) || value < 0 || numerator < 0 || denominator <= 0) {
    throw new Error("Proporción monetaria inválida.");
  }
  return Number((BigInt(value) * BigInt(numerator) + BigInt(Math.floor(denominator / 2))) / BigInt(denominator));
}

export function estimateProcessingFee(cents: number): number {
  assertCents(cents, MAX_PROVIDER_CENTS * 3);
  return cents === 0 ? 0 : roundedRatio(cents, 290, 10_000) + 30;
}

export type RidePricing = {
  providerEstimateCents: number;
  coordinationFeeCents: number;
  customerTotalCents: number;
  estimatedStripeFeeCents: number;
  estimatedContributionCents: number;
  temporaryReserveCents: number;
  authorizationTotalCents: number;
};

export function calculateRidePricing(providerEstimateCents: number, temporaryReserveBps = DEFAULT_TEMPORARY_RESERVE_BPS): RidePricing {
  assertCents(providerEstimateCents);
  if (!Number.isInteger(temporaryReserveBps) || temporaryReserveBps < 0 || temporaryReserveBps > 10_000) {
    throw new Error("La reserva debe estar entre 0 y 10000 basis points.");
  }
  const coordinationFeeCents = Math.min(
    roundedRatio(providerEstimateCents, PLATFORM_RATE_BPS, 10_000) + BASE_COORDINATION_FEE_CENTS,
    PILOT_MAX_COORDINATION_FEE_CENTS,
  );
  const customerTotalCents = providerEstimateCents + coordinationFeeCents;
  const estimatedStripeFeeCents = estimateProcessingFee(customerTotalCents);
  const temporaryReserveCents = Math.min(
    roundedRatio(providerEstimateCents, temporaryReserveBps, 10_000), MAX_TEMPORARY_RESERVE_CENTS,
  );
  return {
    providerEstimateCents, coordinationFeeCents, customerTotalCents, estimatedStripeFeeCents,
    estimatedContributionCents: coordinationFeeCents - estimatedStripeFeeCents,
    temporaryReserveCents, authorizationTotalCents: customerTotalCents + temporaryReserveCents,
  };
}

export type RideSettlement = {
  finalCustomerTotalCents: number;
  amountToCaptureCents: number;
  amountToReleaseCents: number;
  additionalPaymentRequiredCents: number;
  authorizedCancellationChargeCents: number;
};

export function reconcileRide(
  actualProviderCostCents: number, coordinationFeeCents: number,
  authorizedCancellationChargeCents: number, authorizedAmountCents: number,
): RideSettlement {
  assertCents(actualProviderCostCents);
  assertCents(coordinationFeeCents, PILOT_MAX_COORDINATION_FEE_CENTS);
  assertCents(authorizedCancellationChargeCents, MAX_PROVIDER_CENTS * 2);
  assertCents(authorizedAmountCents, MAX_PROVIDER_CENTS * 2);
  const finalCustomerTotalCents = actualProviderCostCents + coordinationFeeCents + authorizedCancellationChargeCents;
  return {
    finalCustomerTotalCents,
    amountToCaptureCents: Math.min(finalCustomerTotalCents, authorizedAmountCents),
    amountToReleaseCents: Math.max(0, authorizedAmountCents - finalCustomerTotalCents),
    additionalPaymentRequiredCents: Math.max(0, finalCustomerTotalCents - authorizedAmountCents),
    authorizedCancellationChargeCents,
  };
}

export function settleCancellation(providerCancellationFeeCents: number, authorizedAmountCents: number): RideSettlement {
  assertCents(providerCancellationFeeCents);
  assertCents(authorizedAmountCents, MAX_PROVIDER_CENTS * 2);
  return reconcileRide(0, 0, Math.min(providerCancellationFeeCents, authorizedAmountCents), authorizedAmountCents);
}

export type AutomaticSettlement = {
  finalCustomerTotalCents: number;
  amountToCaptureCents: number;
  amountToReleaseCents: number;
  additionalPaymentRequiredCents: number;
  settlementStatus: "settled" | "needs_attention";
};

export function settleRideAutomatically({ authorizedAmountCents, providerFinalCostCents, coordinationFeeCents, cancellationFeeCents }: {
  authorizedAmountCents: number;
  providerFinalCostCents: number;
  coordinationFeeCents: number;
  cancellationFeeCents: number;
}): AutomaticSettlement {
  const result = reconcileRide(providerFinalCostCents, coordinationFeeCents, cancellationFeeCents, authorizedAmountCents);
  return {
    finalCustomerTotalCents: result.finalCustomerTotalCents,
    amountToCaptureCents: result.amountToCaptureCents,
    amountToReleaseCents: result.amountToReleaseCents,
    additionalPaymentRequiredCents: result.additionalPaymentRequiredCents,
    settlementStatus: result.additionalPaymentRequiredCents ? "needs_attention" : "settled",
  };
}

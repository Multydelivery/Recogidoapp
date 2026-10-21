import type { RideRequest } from "./demo";
import { estimateProcessingFee, roundedRatio } from "./pricing";

export type Indicator = "green" | "amber" | "red";

export function calculateRideMetrics(requests: RideRequest[], now: string) {
  if (!Number.isFinite(Date.parse(now))) throw new Error("Fecha de métricas inválida.");
  const count = requests.length;
  const automaticCount = requests.filter((ride) => ride.requestChannel === "web" && !ride.operatorInterventionRequired && ride.status === "settled").length;
  const interventionCount = requests.filter((ride) => ride.operatorInterventionRequired).length;
  const priced = requests.filter((ride) => ride.pricing !== null);
  const settled = requests.filter((ride) => ride.settlement !== null);
  const completed = requests.filter((ride) => ride.completedAt !== null);
  const coordinationRevenueCents = settled.reduce((sum, ride) => sum + (
    ride.wasCancelled ? 0 : Math.min(ride.pricing.coordinationFeeCents,
      Math.max(0, (ride.settlement?.amountToCaptureCents ?? 0) +
        (ride.additionalPaymentApprovedAt ? ride.additionalPaymentConsentCents : 0) - (ride.actualProviderCostCents ?? 0)))
  ), 0);
  const totalCustomerPaymentsCents = settled.reduce((sum, ride) => sum + (ride.settlement?.amountToCaptureCents ?? 0) +
    (ride.additionalPaymentApprovedAt ? ride.additionalPaymentConsentCents : 0), 0);
  const estimatedProcessingFeesCents = settled.reduce((sum, ride) => sum + estimateProcessingFee(ride.settlement?.amountToCaptureCents ?? 0) +
    (ride.additionalPaymentApprovedAt ? estimateProcessingFee(ride.additionalPaymentConsentCents) : 0), 0);
  const contributionCents = coordinationRevenueCents - estimatedProcessingFeesCents;
  const averageProviderEstimateCents = priced.length
    ? roundedRatio(priced.reduce((sum, ride) => sum + (ride.pricing?.providerEstimateCents ?? 0), 0), 1, priced.length) : null;
  const automationBps = count ? roundedRatio(automaticCount, 10_000, count) : null;
  const interventionBps = count ? roundedRatio(interventionCount, 10_000, count) : null;
  const cancellationBps = count ? roundedRatio(requests.filter((ride) => ride.wasCancelled).length, 10_000, count) : null;
  const startDay = count ? Math.min(...requests.map((ride) => Math.floor(Date.parse(ride.createdAt) / 86_400_000))) : Math.floor(Date.parse(now) / 86_400_000);
  const observationDays = Math.max(1, Math.floor(Date.parse(now) / 86_400_000) - startDay + 1);
  const dailyCounts: Record<string, number> = {};
  for (const ride of completed) {
    const date = ride.completedAt?.slice(0, 10);
    if (date) dailyCounts[date] = (dailyCounts[date] ?? 0) + 1;
  }
  const settledTrips = settled.filter((ride) => !ride.wasCancelled && ride.status === "settled");
  const projectedCoordination = settledTrips.reduce((sum, ride) => sum + ride.pricing.coordinationFeeCents, 0);
  const averageCoordinationCents = settledTrips.length ? roundedRatio(projectedCoordination, 1, settledTrips.length) : null;
  const averageProcessingCents = settledTrips.length ? roundedRatio(
    settledTrips.reduce((sum, ride) => sum + estimateProcessingFee(ride.settlement?.amountToCaptureCents ?? 0) +
      (ride.additionalPaymentApprovedAt ? estimateProcessingFee(ride.additionalPaymentConsentCents) : 0), 0), 1, settledTrips.length,
  ) : null;
  const closed = requests.filter((ride) => ["settled", "cancelled"].includes(ride.status));
  function averageDelay(field: "bookedAt" | "driverAssignedAt") {
    const samples = requests.filter((ride) => ride.paymentStartedAt && ride[field]);
    return samples.length ? roundedRatio(samples.reduce((sum, ride) =>
      sum + Math.max(0, Date.parse(ride[field]!) - Date.parse(ride.paymentStartedAt!)), 0), 1, samples.length) : null;
  }
  function project(trips: number) {
    return {
      trips,
      coordinationRevenueCents: averageCoordinationCents === null ? null : averageCoordinationCents * trips,
      estimatedProcessingFeesCents: averageProcessingCents === null ? null : averageProcessingCents * trips,
      contributionCents: averageCoordinationCents === null || averageProcessingCents === null ? null : (averageCoordinationCents - averageProcessingCents) * trips,
    };
  }
  const indicators = {
    automation: automationBps === null ? "amber" : automationBps >= 9000 ? "green" : automationBps >= 7500 ? "amber" : "red",
    provider: averageProviderEstimateCents === null ? "amber" : averageProviderEstimateCents >= 2500 && averageProviderEstimateCents <= 3000 ? "green" : "amber",
    contribution: settled.length === 0 ? "amber" : contributionCents > 0 ? "green" : "red",
  } satisfies Record<string, Indicator>;
  const overall: Indicator = Object.values(indicators).includes("red") ? "red"
    : Object.values(indicators).every((value) => value === "green") ? "green" : "amber";
  return {
    count, automaticCount, interventionCount, automationBps, interventionBps, averageProviderEstimateCents,
    coordinationRevenueCents, totalCustomerPaymentsCents, estimatedProcessingFeesCents, contributionCents,
    cancellationBps, suggestedRiskReserveCents: roundedRatio(totalCustomerPaymentsCents, 200, 10_000),
    observationDays, completedTrips: completed.length, dailyCounts,
    tripsPerDay: completed.length / observationDays,
    averageCoordinationCents, averageProcessingCents,
    monthlyCurrent: project(roundedRatio(completed.length, 30, observationDays)),
    monthlyHundredDaily: project(3000),
    indicators, overall,
    closedWithoutInterventionBps: closed.length ? roundedRatio(closed.filter((ride) => !ride.operatorInterventionRequired).length, 10_000, closed.length) : null,
    exceptionCount: requests.reduce((sum, ride) => sum + ride.exceptionCount, 0),
    averageBookingMs: averageDelay("bookedAt"), averageAssignmentMs: averageDelay("driverAssignedAt"),
    duplicateEventsIgnored: requests.reduce((sum, ride) => sum + ride.duplicateEventsIgnored, 0),
    blockedCount: requests.filter((ride) => ride.status === "needs_attention").length,
  };
}

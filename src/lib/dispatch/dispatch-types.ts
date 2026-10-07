export type DispatchStatus = "pending" | "offer_sent" | "searching" | "claimed" | "cancelled";

export interface DispatchRequest {
  requestId: string;
  deliveryCount: number;
  status: DispatchStatus;
  driverName?: string;
  createdAt: string;
}

export interface RestaurantPublic {
  slug: string;
  name: string;
}

export interface DispatchSnapshot {
  mockMode: true;
  restaurant: RestaurantPublic;
  request: DispatchRequest | null;
  history: DispatchRequest[];
}

export function isOpenRequest(status: DispatchStatus) {
  return status === "pending" || status === "offer_sent" || status === "searching";
}

export const dispatchStatusLabels: Record<DispatchStatus, string> = {
  pending: "Solicitud recibida",
  offer_sent: "Oferta enviada",
  searching: "Buscando conductor",
  claimed: "Conductor asignado",
  cancelled: "Solicitud cancelada",
};

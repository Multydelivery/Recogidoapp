export type DispatchStatus = "pending" | "offer_sent" | "searching" | "claimed" | "cancelled" | "error";

export interface DeliveryRequestResult {
  success: boolean;
  requestId: string;
  status: DispatchStatus;
  restaurantName?: string;
  deliveryCount?: number;
  driverName?: string;
  driverPhone?: string;
  createdAt?: string;
  updatedAt?: string;
  message?: string;
}

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
  mockMode: boolean;
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
  error: "Error en la solicitud",
};

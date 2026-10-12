export type AssignmentMode = "individual" | "batch";
export type DispatchStatus =
  | "open"
  | "partially_claimed"
  | "claimed"
  | "fully_assigned"
  | "cancelled"
  | "closed";

export interface RestaurantPublic {
  slug: string;
  name: string;
  active: boolean;
  deliveryEnabled: boolean;
  maxDeliveries: number;
  assignmentMode: AssignmentMode;
  maxActiveDeliveriesPerDriver: number;
}

export interface DeliveryAssignment {
  requestId: string;
  deliveryNumber: number;
  status: "open" | "claimed" | "cancelled" | "closed";
  driverName?: string;
  assignedAt?: string;
}

export interface DispatchRequest {
  requestId: string;
  requestType: "parent" | "batch";
  parentRequestId: string;
  deliveryCount: number;
  totalDeliveries: number;
  assignedDeliveries: number;
  remainingDeliveries: number;
  assignmentMode: AssignmentMode;
  status: DispatchStatus;
  childRequestIds: string[];
  deliveries: DeliveryAssignment[];
  driverName?: string;
  assignedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface DispatchSnapshot {
  mockMode: boolean;
  restaurant: RestaurantPublic;
  request: DispatchRequest | null;
  history: DispatchRequest[];
}

export function isOpenRequest(status: DispatchStatus) {
  return status === "open" || status === "partially_claimed";
}

export const dispatchStatusLabels: Record<DispatchStatus, string> = {
  open: "Buscando conductores",
  partially_claimed: "Parcialmente asignada",
  claimed: "Conductor asignado",
  fully_assigned: "Todas asignadas",
  cancelled: "Cancelada",
  closed: "Cerrada",
};

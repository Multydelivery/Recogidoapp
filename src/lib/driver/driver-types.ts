export type DriverAvailability = "available" | "unavailable";

/** Internal states of an offer/delivery as seen by the driver. */
export type DriverDeliveryStatus =
  | "available"
  | "accepted"
  | "assigned"
  | "picked_up"
  | "completed"
  | "declined"
  | "cancelled"
  | "unavailable";

/** Statuses that occupy driver capacity. completed, declined and cancelled never count. */
export type DriverActiveStatus = Extract<DriverDeliveryStatus, "accepted" | "assigned" | "picked_up">;

export type DriverAssignmentMode = "individual" | "batch";

export interface DriverOffer {
  /** Demo-only identifier; never rendered. Real offers will use server-side IDs that must stay private. */
  offerId: string;
  /** Short public order code, rendered as "#E814C7-01". */
  orderNumber: string;
  restaurantId: string;
  restaurantName: string;
  assignmentLabel: string;
  assignmentMode: DriverAssignmentMode;
  createdAt: string;
  status: Extract<DriverDeliveryStatus, "available" | "declined" | "cancelled" | "unavailable">;
  /** Always null on an offer; filled once it becomes a delivery. */
  assignedAt: string | null;
  pickedUpAt: string | null;
  completedAt: string | null;
}

export interface DriverDelivery {
  offerId: string;
  orderNumber: string;
  restaurantId: string;
  restaurantName: string;
  assignmentLabel: string;
  assignmentMode: DriverAssignmentMode;
  driverName: string;
  status: Extract<DriverDeliveryStatus, "accepted" | "assigned" | "picked_up" | "completed" | "cancelled">;
  assignedAt: string;
  pickedUpAt: string | null;
  completedAt: string | null;
}

export interface DriverHistoryItem extends DriverDelivery {
  status: "completed";
  pickedUpAt: string;
  completedAt: string;
  durationMs: number;
}

export interface DriverProfile {
  name: string;
  firstName: string;
}

/** Rules are kept separate from the state so future phases can add restaurant authorizations or batches. */
export interface DriverAcceptancePolicy {
  /** Global limit of simultaneous active deliveries. */
  maxActiveDeliveries: number;
  /** Limit of simultaneous active deliveries for the same restaurantId. */
  maxActivePerRestaurant: number;
}

export type DriverNotificationTone = "success" | "info" | "error";

export interface DriverNotification {
  id: number;
  tone: DriverNotificationTone;
  message: string;
}

export type DriverTab = "offers" | "active" | "history";

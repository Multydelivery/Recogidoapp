export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  address: {
    street: string;
    city: string;
    state: string;
    country: string;
  };
  phone: string;
  currency: string;
}

export interface MenuCategory {
  id: string;
  nameEs: string;
  nameEn: string;
  sortOrder: number;
}

export interface ModifierOption {
  id: string;
  nameEs: string;
  nameEn: string;
  priceDeltaCents: number | null;
  available: boolean;
  recommended?: boolean;
}

export interface ModifierGroup {
  id: string;
  nameEs: string;
  nameEn: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  nameEs: string;
  nameEn: string;
  description: string;
  price: number;
  currency: string;
  available: boolean;
  featured: boolean;
  imageUrl: string | null;
  modifierGroups: ModifierGroup[];
  specialInstructionsEnabled?: boolean;
  displayPricePrefix?: string;
  source: {
    provider: string;
    extractedAt: string;
    priceLabel?: string;
    publiclyVerified?: boolean;
    merchantConfirmed?: boolean;
  };
}

export interface SelectedModifier {
  groupId: string;
  optionId: string;
  nameEs: string;
  nameEn: string;
  priceAdjustmentCents: number;
}

export interface CartItem {
  lineId: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  selectedModifiers: SelectedModifier[];
  configurationKey: string;
  specialInstructions?: string;
}

export interface CartSummary {
  items: CartItem[];
  totalUnits: number;
  subtotalCents: number;
}

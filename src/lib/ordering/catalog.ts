import type {
  MenuCategory,
  MenuItem,
  ModifierGroup,
  ModifierOption,
  Restaurant,
} from "./types";

interface PhaseOneOption {
  id: string;
  nameEs: string;
  nameEn: string;
  priceAdjustmentCents: number;
  available?: boolean;
}

interface PhaseOneGroup {
  nameEs: string;
  nameEn: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: PhaseOneOption[];
}

interface PhaseOneItem {
  id: string;
  categoryId: string;
  nameEs: string;
  nameEn: string;
  basePriceCents: number;
  displayPricePrefix?: string;
  modifierGroupRefs: string[];
  specialInstructionsEnabled: boolean;
}

export interface PhaseOneCatalog {
  extractedAt: string;
  source: {
    provider: string;
    publiclyVerified: boolean;
    merchantConfirmed: boolean;
  };
  modifierGroupTemplates: Record<string, PhaseOneGroup>;
  items: PhaseOneItem[];
}

export interface MenuCatalog {
  restaurant: Restaurant;
  categories: MenuCategory[];
  items: MenuItem[];
}

export function resolveModifierGroupRefs(
  catalog: MenuCatalog,
  phase: PhaseOneCatalog,
): MenuCatalog {
  const templates = new Map<string, ModifierGroup>(
    Object.entries(phase.modifierGroupTemplates).map(([id, group]) => [
      id,
      {
        id,
        nameEs: group.nameEs,
        nameEn: group.nameEn,
        required: group.required,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        options: group.options.map((option): ModifierOption => ({
          id: option.id,
          nameEs: option.nameEs,
          nameEn: option.nameEn,
          priceDeltaCents: option.priceAdjustmentCents,
          available: option.available ?? true,
        })),
      },
    ]),
  );
  const itemsById = new Map(catalog.items.map((item) => [item.id, item]));

  for (const sourceItem of phase.items) {
    const existing = itemsById.get(sourceItem.id);
    const modifierGroups = sourceItem.modifierGroupRefs.map((reference) => {
      const group = templates.get(reference);
      if (!group) {
        throw new Error(
          `Product ${sourceItem.id} references missing modifier group ${reference}.`,
        );
      }
      return group;
    });
    const merged: MenuItem = {
      ...(existing ?? {
        description: "",
        currency: catalog.restaurant.currency,
        available: true,
        featured: sourceItem.categoryId === "sopas-lunes",
        imageUrl: null,
        source: { provider: phase.source.provider, extractedAt: phase.extractedAt },
      }),
      id: sourceItem.id,
      categoryId: sourceItem.categoryId,
      nameEs: sourceItem.nameEs,
      nameEn: sourceItem.nameEn,
      price: sourceItem.basePriceCents / 100,
      modifierGroups,
      specialInstructionsEnabled: sourceItem.specialInstructionsEnabled,
      displayPricePrefix: sourceItem.displayPricePrefix,
      source: {
        ...(existing?.source ?? {}),
        provider: phase.source.provider,
        extractedAt: phase.extractedAt,
        priceLabel: sourceItem.displayPricePrefix
          ? `${sourceItem.displayPricePrefix} $${(sourceItem.basePriceCents / 100).toFixed(2)}`
          : existing?.source.priceLabel,
        publiclyVerified: phase.source.publiclyVerified,
        merchantConfirmed: phase.source.merchantConfirmed,
      },
    };
    itemsById.set(sourceItem.id, merged);
  }

  const categories = catalog.categories.some((category) => category.id === "sopas-lunes")
    ? catalog.categories
    : [
        ...catalog.categories,
        {
          id: "sopas-lunes",
          nameEs: "Sopas especiales de los lunes",
          nameEn: "Monday soup specials",
          sortOrder: catalog.categories.length + 1,
        },
      ];

  return {
    ...catalog,
    categories,
    items: catalog.items.map((item) => itemsById.get(item.id) ?? item).concat(
      phase.items
        .filter((item) => !catalog.items.some((existing) => existing.id === item.id))
        .map((item) => {
          const resolved = itemsById.get(item.id);
          if (!resolved) {
            throw new Error(`Product ${item.id} could not be resolved into the menu.`);
          }
          return resolved;
        }),
    ),
  };
}

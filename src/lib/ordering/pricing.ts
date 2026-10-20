import type {
  MenuItem,
  SelectedModifier,
} from "./types";

export type ModifierSelections = Record<string, string[]>;

const REQUIRED_SELECTION_MESSAGES: Record<string, string> = {
  "soup-special-size": "Selecciona un tamaño.",
  "rice-choice": "Indica si deseas arroz.",
  "salad-choice": "Selecciona un acompañamiento.",
};

export function priceToCents(price: number): number {
  return Math.round(price * 100);
}

export function getModifierGroupError(
  item: MenuItem,
  groupId: string,
  selections: ModifierSelections,
): string | null {
  const group = item.modifierGroups.find((candidate) => candidate.id === groupId);
  if (!group) return "Hay opciones que ya no están disponibles.";
  const selectedIds = selections[group.id] ?? [];
  const uniqueIds = new Set(selectedIds);
  const invalidOption = selectedIds.some((optionId) => {
    const option = group.options.find((candidate) => candidate.id === optionId);
    return !option || !option.available || option.priceAdjustment === null;
  });

  if (invalidOption || uniqueIds.size !== selectedIds.length) {
    return "Quita las opciones no disponibles.";
  }
  const minimum = group.required ? Math.max(1, group.minSelections) : group.minSelections;
  if (selectedIds.length < minimum) {
    return REQUIRED_SELECTION_MESSAGES[group.id] ??
      `Selecciona al menos ${minimum} opción${minimum === 1 ? "" : "es"} para ${group.nameEs.toLocaleLowerCase()}.`;
  }
  if (selectedIds.length > group.maxSelections) {
    const optionWord = group.maxSelections === 1 ? "opción" : "opciones";
    return `Selecciona como máximo ${group.maxSelections} ${optionWord}.`;
  }
  return null;
}

export function getModifierSelectionErrors(
  item: MenuItem,
  selections: ModifierSelections,
): string[] {
  const errors: string[] = [];
  const groupsById = new Map(item.modifierGroups.map((group) => [group.id, group]));

  for (const groupId of Object.keys(selections)) {
    if (!groupsById.has(groupId)) errors.push("Hay opciones que ya no están disponibles.");
  }

  for (const group of item.modifierGroups) {
    const error = getModifierGroupError(item, group.id, selections);
    if (error) errors.push(error);
  }

  return errors;
}

export function createSelectedModifiers(
  item: MenuItem,
  selections: ModifierSelections,
): SelectedModifier[] | null {
  if (getModifierSelectionErrors(item, selections).length) return null;

  return item.modifierGroups.flatMap((group) =>
    (selections[group.id] ?? []).flatMap((optionId) => {
      const option = group.options.find((candidate) => candidate.id === optionId);
      if (!option || option.priceAdjustment === null) return [];
      return [{
        groupId: group.id,
        optionId: option.id,
        nameEs: option.nameEs,
        nameEn: option.nameEn,
        priceAdjustmentCents: priceToCents(option.priceAdjustment),
      }];
    }),
  );
}

export function selectionsFromModifiers(
  modifiers: SelectedModifier[],
): ModifierSelections {
  const selections: ModifierSelections = {};
  for (const modifier of modifiers) {
    (selections[modifier.groupId] ??= []).push(modifier.optionId);
  }
  return selections;
}

export function getConfiguredPriceCents(
  item: MenuItem,
  modifiers: SelectedModifier[],
): number {
  return priceToCents(item.price) +
    modifiers.reduce((sum, modifier) => sum + modifier.priceAdjustmentCents, 0);
}

export function getConfigurationKey(
  productId: string,
  modifiers: SelectedModifier[],
  specialInstructions = "",
): string {
  const selectedByGroup = new Map<string, string[]>();
  for (const modifier of modifiers) {
    let optionIds = selectedByGroup.get(modifier.groupId);
    if (!optionIds) {
      optionIds = [];
      selectedByGroup.set(modifier.groupId, optionIds);
    }
    optionIds.push(modifier.optionId);
  }

  const groups = Array.from(selectedByGroup, ([groupId, optionIds]) =>
    `${groupId}:${optionIds.sort().join(",")}`,
  ).sort();
  return [
    productId,
    ...groups,
    ...(specialInstructions ? [`instructions:${encodeURIComponent(specialInstructions)}`] : []),
  ].join("|");
}

export function sanitizeModifiers(
  item: MenuItem,
  value: unknown,
): SelectedModifier[] | null {
  if (!Array.isArray(value)) return null;

  const selections: ModifierSelections = {};
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const modifier = candidate as Record<string, unknown>;
    if (typeof modifier.groupId !== "string" || typeof modifier.optionId !== "string") return null;
    const group = item.modifierGroups.find((entry) => entry.id === modifier.groupId);
    const option = group?.options.find((entry) => entry.id === modifier.optionId);
    if (!group || !option || !option.available || option.priceAdjustment === null) continue;
    (selections[group.id] ??= []).push(option.id);
  }

  return createSelectedModifiers(item, selections);
}

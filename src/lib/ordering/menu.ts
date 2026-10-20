import type { MenuCategory, MenuItem } from "./types";

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

export function filterMenuItems(items: MenuItem[], query: string): MenuItem[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return items;

  return items.filter((item) =>
    normalizeSearchText(`${item.nameEs} ${item.nameEn}`).includes(normalizedQuery),
  );
}

export function getCategoryName(
  categories: MenuCategory[],
  categoryId: string,
  language: "es" | "en" = "es",
): string {
  const category = categories.find((entry) => entry.id === categoryId);
  if (!category) return "Categoría";
  return language === "es" ? category.nameEs : category.nameEn;
}

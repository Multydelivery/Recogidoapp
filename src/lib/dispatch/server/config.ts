import "server-only";

export class DispatchError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export interface RestaurantConfig {
  slug: string;
  name: string;
  phone: string;
  deviceToken: string;
}

export function getRestaurants(): RestaurantConfig[] {
  if ((process.env.DISPATCH_MOCK_MODE ?? "true") !== "true") {
    throw new DispatchError(503, "El modo real no está disponible. Activa DISPATCH_MOCK_MODE=true.");
  }
  const raw = process.env.RESTAURANTS_JSON;
  if (!raw) throw new DispatchError(503, "Falta la configuración de restaurantes en el servidor.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DispatchError(503, "La configuración de restaurantes no es JSON válido.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    throw new DispatchError(503, "La configuración de restaurantes debe ser una lista de 1 a 100 entradas.");
  }
  const slugs = new Set<string>();
  return parsed.map((value: unknown) => {
    if (!value || typeof value !== "object" ||
      !("slug" in value) || typeof value.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length > 80 ||
      !("name" in value) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 ||
      !("phone" in value) || typeof value.phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(value.phone) ||
      !("deviceToken" in value) || typeof value.deviceToken !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(value.deviceToken) ||
      value.slug === "demo" || slugs.has(value.slug)) {
      throw new DispatchError(503, "Hay una entrada inválida o duplicada en la configuración de restaurantes.");
    }
    slugs.add(value.slug);
    return { slug: value.slug, name: value.name.trim(), phone: value.phone, deviceToken: value.deviceToken };
  });
}

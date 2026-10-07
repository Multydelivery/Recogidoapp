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

export function isDispatchMockMode() {
  const mode = process.env.DISPATCH_MOCK_MODE ?? "true";
  if (mode !== "true" && mode !== "false") {
    throw new DispatchError(503, "Configuración de Dispatch inválida.");
  }
  return mode === "true";
}

export function getBackendConfig() {
  const invalid = () => new DispatchError(503, "La integración central no está configurada correctamente.");
  const url = (name: string) => {
    const raw = process.env[name];
    if (!raw) throw invalid();
    let parsed: URL;
    try { parsed = new URL(raw); } catch { throw invalid(); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw invalid();
    return parsed.toString();
  };
  const secret = process.env.RECOGIDO_DISPATCH_API_SECRET;
  if (!secret?.trim()) throw invalid();
  const rawTimeout = process.env.DISPATCH_REQUEST_TIMEOUT_MS ?? "10000";
  if (!/^\d+$/.test(rawTimeout)) throw invalid();
  const timeoutMs = Number(rawTimeout);
  if (timeoutMs < 1 || timeoutMs > 10_000) throw invalid();
  return {
    submitUrl: url("RECOGIDO_DISPATCH_SUBMIT_URL"),
    manageUrl: url("RECOGIDO_DISPATCH_MANAGE_URL"),
    statusUrl: url("RECOGIDO_DISPATCH_STATUS_URL"),
    secret,
    timeoutMs,
  };
}

export function validateDispatchConfiguration() {
  if (!isDispatchMockMode()) getBackendConfig();
}

export function getRestaurants(): RestaurantConfig[] {
  isDispatchMockMode();
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

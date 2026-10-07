import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { DispatchError, getRestaurants } from "./config";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleApi(action: () => Response | Promise<Response>) {
  try {
    return await action();
  } catch (error: unknown) {
    if (error instanceof DispatchError) {
      if (error.statusCode >= 500) console.error("Dispatch configuration or capacity error:", error.message);
      return json({ error: error.message }, error.statusCode);
    }
    console.error("Unexpected dispatch error:", error instanceof Error ? error.name : "Unknown");
    return json({ error: "Error interno de Dispatch. Intenta nuevamente." }, 500);
  }
}

export function authenticate(request: Request, slug: unknown) {
  const restaurants = getRestaurants();
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(slug)) {
    throw new DispatchError(400, "Identificador de restaurante inválido.");
  }
  const restaurant = restaurants.find((entry) => entry.slug === slug);
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  const matches = timingSafeEqual(hash(token.slice(0, 129)), hash(restaurant?.deviceToken ?? ""));
  if (!restaurant || !token || token.length > 128 || !matches) {
    throw new DispatchError(401, "Token o PIN inválido para este restaurante.");
  }
  return restaurant;
}

export async function readBody(request: Request, allowedKeys: string[]): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new DispatchError(415, "Envía el cuerpo como application/json.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > 4096) throw new DispatchError(413, "El cuerpo de la solicitud es demasiado grande.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new DispatchError(400, "El cuerpo no es JSON válido.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some((key) => !allowedKeys.includes(key))) {
    throw new DispatchError(400, "Campos no permitidos en la solicitud.");
  }
  return Object.fromEntries(Object.entries(body));
}

export function readRequestId(value: unknown) {
  if (typeof value !== "string" || !/^WEB_\d{13}_[a-f0-9]{16}$/.test(value)) {
    throw new DispatchError(400, "Request ID inválido.");
  }
  return value;
}

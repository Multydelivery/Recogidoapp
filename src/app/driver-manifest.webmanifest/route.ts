import type { MetadataRoute } from "next";

export function GET() {
  const manifest: MetadataRoute.Manifest = {
    id: "/driver/",
    name: "Recogido Conductor",
    short_name: "Recogido",
    description: "Aplicación de entregas para conductores de Recogido",
    start_url: "/driver/maria-elizabeth",
    scope: "/driver/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#14b8ab",
    background_color: "#f4f6f9",
    lang: "es",
    icons: [
      { src: "/driver/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/driver/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/driver/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return Response.json(manifest, {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=0, must-revalidate" },
  });
}

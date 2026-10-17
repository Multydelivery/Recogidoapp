import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const logo = await sharp(fileURLToPath(new URL("../public/recogidoapplogo.png", import.meta.url)))
  .trim().toBuffer();
const output = new URL("../public/driver/icons/", import.meta.url);
await mkdir(output, { recursive: true });
for (const [name, size, fraction] of [
  ["icon-192.png", 192, 0.84],
  ["icon-512.png", 512, 0.84],
  ["maskable-512.png", 512, 0.56],
  ["apple-touch-icon.png", 180, 0.84],
]) {
  const inner = Math.round(size * fraction);
  const image = await sharp(logo).resize(inner, inner, { fit: "inside" }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: "#ffffff" } })
    .composite([{ input: image, gravity: "centre" }]).png()
    .toFile(fileURLToPath(new URL(name, output)));
}

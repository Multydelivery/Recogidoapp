import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Read configuration locally for comparison only; never print values or matched content.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const secrets = new Set();
function add(value) {
  if (typeof value === "string" && value.length) secrets.add(value);
}
for (const [key, value] of Object.entries(process.env)) {
  if (/^(TWILIO_|RECOGIDO_DISPATCH_.*(?:SECRET|URL)$|MAKE_.*(?:SECRET|URL)$)/.test(key)) add(value);
}
for (const key of ["DRIVERS_JSON", "RESTAURANTS_JSON"]) {
  if (!process.env[key]) continue;
  let profiles;
  try { profiles = JSON.parse(process.env[key]); }
  catch { throw new Error("Private configuration could not be parsed for the public-artifact audit."); }
  if (!Array.isArray(profiles)) throw new Error("Private profiles must be a list for the public-artifact audit.");
  for (const profile of profiles) {
    add(profile.deviceToken);
    add(profile.phone);
    if (typeof profile.phone === "string") add(profile.phone.replace(/^whatsapp:/, ""));
  }
}
if (process.env.TWILIO_WEB_AUTH_USERNAME && process.env.TWILIO_WEB_AUTH_PASSWORD) {
  add(Buffer.from(`${process.env.TWILIO_WEB_AUTH_USERNAME}:${process.env.TWILIO_WEB_AUTH_PASSWORD}`).toString("base64"));
}
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : [filename];
  }));
  return children.flat();
}
if (!existsSync(path.join(".next", "static"))) throw new Error("Build the application before auditing public artifacts.");
const candidates = [
  ...await files(path.join(".next", "static")),
  ...await files(path.join(".next", "server", "app")),
  ...await files("public"),
].filter((filename) => {
  if (filename.startsWith(path.join(".next", "server"))) return /\.(?:html|rsc|body|meta)$/.test(filename);
  return /\.(?:js|css|json|map|html|webmanifest|svg|txt)$/.test(filename);
});
let contaminated = false;
for (const filename of candidates) {
  const content = await readFile(filename, "utf8");
  if (/DRIVERS_JSON|TWILIO_DRIVER_(?:CONFIG|DASHBOARD|ACTION)_URL|TWILIO_WEB_AUTH_(?:USERNAME|PASSWORD)|WEB_[a-f0-9]{32}|(?:AC|SM|IS|MP|ET|ES)[a-f0-9]{32}/i.test(content)) {
    contaminated = true;
  }
  for (const secret of secrets) {
    const quoted = [JSON.stringify(secret), `'${secret.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`, `>${secret}<`];
    if ((secret.length >= 8 && content.includes(secret)) || quoted.some((value) => content.includes(value))) contaminated = true;
  }
}
if (contaminated) throw new Error("Public artifact audit failed: private configuration or an internal identifier was detected. No matched values were logged.");
console.log(`Public artifact audit passed: ${candidates.length} bundles, public resources and prerendered artifacts checked; no private configuration detected.`);

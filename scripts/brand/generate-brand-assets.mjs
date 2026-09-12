import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const tokens = JSON.parse(await readFile(path.join(root, "shared/brand-tokens.json"), "utf8"));

const publicDir = path.join(root, "public/brand");
const mobileDir = path.join(root, "mobile/assets/brand");
await Promise.all([mkdir(publicDir, { recursive: true }), mkdir(mobileDir, { recursive: true })]);

const escape = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
const navy = escape(tokens.brand.navy);
const green = escape(tokens.brand.green);
const surface = escape(tokens.surface.default);

function iconSvg(size, { transparent = false, monochrome = false } = {}) {
  const background = transparent ? "" : `<rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="${navy}"/>`;
  const c = monochrome ? "#000000" : surface;
  const b = monochrome ? "#000000" : green;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background}<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(size * 0.41)}" font-weight="900"><tspan fill="${c}">C</tspan><tspan fill="${b}">B</tspan></text></svg>`);
}

function splashWordmarkSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="260" viewBox="0 0 900 260"><text x="450" y="142" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="142" font-weight="900"><tspan fill="${navy}">Collect</tspan><tspan fill="${green}">Boss</tspan></text></svg>`);
}

function pocketIconSvg(size, { transparent = false, monochrome = false } = {}) {
  const background = transparent ? "" : `<rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="${navy}"/>`;
  const c = monochrome ? "#000000" : surface;
  const bp = monochrome ? "#000000" : green;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background}<text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(size * 0.31)}" font-weight="900"><tspan fill="${c}">C</tspan><tspan fill="${bp}">BP</tspan></text></svg>`);
}

function pocketSplashWordmarkSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="260" viewBox="0 0 1800 260"><text x="900" y="142" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="132" font-weight="900"><tspan fill="${navy}">Collect</tspan><tspan fill="${green}">Boss Pocket</tspan></text></svg>`);
}

await Promise.all([
  sharp(iconSvg(192)).png().toFile(path.join(publicDir, "icon-192.png")),
  sharp(iconSvg(512)).png().toFile(path.join(publicDir, "icon-512.png")),
  sharp(iconSvg(1024)).png().toFile(path.join(mobileDir, "icon.png")),
  sharp(iconSvg(1024, { transparent: true })).png().toFile(path.join(mobileDir, "adaptive-foreground.png")),
  sharp(iconSvg(1024, { transparent: true, monochrome: true })).png().toFile(path.join(mobileDir, "adaptive-monochrome.png")),
  sharp(iconSvg(48)).png().toFile(path.join(mobileDir, "favicon.png")),
  sharp(splashWordmarkSvg()).png().toFile(path.join(mobileDir, "splash-wordmark.png")),
  writeFile(path.join(publicDir, "pocket-icon.svg"), pocketIconSvg(512)),
  sharp(pocketIconSvg(192)).png().toFile(path.join(publicDir, "pocket-icon-192.png")),
  sharp(pocketIconSvg(512)).png().toFile(path.join(publicDir, "pocket-icon-512.png")),
  sharp(pocketIconSvg(1024)).png().toFile(path.join(mobileDir, "pocket-icon.png")),
  sharp(pocketIconSvg(1024, { transparent: true })).png().toFile(path.join(mobileDir, "pocket-adaptive-foreground.png")),
  sharp(pocketIconSvg(1024, { transparent: true, monochrome: true })).png().toFile(path.join(mobileDir, "pocket-adaptive-monochrome.png")),
  sharp(pocketIconSvg(48)).png().toFile(path.join(mobileDir, "pocket-favicon.png")),
  sharp(pocketSplashWordmarkSvg()).png().toFile(path.join(mobileDir, "pocket-splash-wordmark.png")),
]);

console.log("Generated additive CollectBoss Main and Pocket brand assets.");

#!/usr/bin/env node
// Builds the Ride Film Studio add-on packs into data/studio-addons/.
//
//   node scripts/studio-addons/build.mjs <gl-transitions checkout> <glfx.js checkout> <pixi filters checkout> [--exclude file]
//
// gl-transitions: every MIT-licensed transition that needs no extra textures is converted as-is
// (its own uniforms and the "// = default" comments become the add-on's parameters).
// glfx.js and PixiJS filters: the hand ports in ports.mjs. Each pack ships the upstream licence.
import fs from "node:fs";
import path from "node:path";
import { GLFX_PACK, PIXI_PACK } from "./ports.mjs";

const [glt, glfx, pixi] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const exIdx = process.argv.indexOf("--exclude");
const exclude = new Set(exIdx > 0 ? JSON.parse(fs.readFileSync(process.argv[exIdx + 1], "utf8")) : []);
if (!glt || !glfx || !pixi) {
  console.error("usage: build.mjs <gl-transitions> <glfx.js> <pixi-filters> [--exclude excluded.json]");
  process.exit(1);
}
const OUT = path.resolve("data/studio-addons");
const NOW = "2026-11-12T12:00:00.000Z";
const VERSION = "1.0.0";

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase().replace(/-+/g, "-").replace(/^-|-$/g, "");
const title = (s) => s.replace(/\.glsl$/, "").replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

function parseValue(type, text) {
  if (text == null) return undefined;
  const t = text.trim().replace(/;$/, "");
  if (type === "bool") return /^true$/i.test(t);
  const nums = (t.match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi) || []).map(Number);
  const n = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4, ivec2: 2, ivec3: 3, ivec4: 4 }[type];
  if (!n || !nums.length) return undefined;
  if (n === 1) return nums[0];
  return Array.from({ length: n }, (_, i) => (nums.length === 1 ? nums[0] : nums[i] ?? 0));
}

function convertTransition(file) {
  const src = fs.readFileSync(file, "utf8");
  const lic = (src.match(/\/\/\s*License:\s*(.+)/i) || [])[1];
  if (!lic || !/MIT/i.test(lic)) return null;
  if (/sampler2D/.test(src)) return null;
  const author = ((src.match(/\/\/\s*Author:\s*(.+)/i) || [])[1] || "gl-transitions contributors").trim();
  const desc = ((src.match(/\/\/\s*Description:\s*(.+)/i) || [])[1] || "").trim();
  const tags = ((src.match(/\/\/\s*Tags?:\s*(.+)/i) || [])[1] || "").split(/[,\s]+/).filter(Boolean).slice(0, 6);
  const params = [];
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    const m = line.match(/^\s*uniform\s+(\w+)\s+(\w+)\s*(?:\/\*\s*=\s*(.+?)\s*\*\/)?\s*;\s*(?:\/\/\s*=\s*(.+))?/);
    if (!m) return;
    const [, type, name, d1, d2] = m;
    const def = parseValue(type, d2 || d1);
    const p = { name, type, label: title(name) };
    const range = (lines[i - 1] || "").match(/@range\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*(.*)/);
    if (range) {
      p.min = Number(range[1]);
      p.max = Number(range[2]);
      if (range[3]) p.label = range[3].trim().slice(0, 40);
    }
    if (/colou?r/i.test(name) && (type === "vec3" || type === "vec4")) p.color = true;
    p.default = def !== undefined ? def : type === "bool" ? false : { float: 0, int: 0 }[type] ?? new Array(Number(type.slice(-1))).fill(0);
    params.push(p);
  });
  const base = path.basename(file, ".glsl");
  return {
    format: "rydr-studio-addon/1",
    id: `glt-${kebab(base)}`.slice(0, 48),
    kind: "transition",
    name: title(base),
    version: VERSION,
    description: desc,
    author,
    license: "MIT",
    source: `https://github.com/gl-transitions/gl-transitions/blob/master/transitions/${encodeURIComponent(path.basename(file))}`,
    tags,
    params,
    glsl: src.replace(/\r/g, ""),
  };
}

function finishAddon(a, pack) {
  return { format: "rydr-studio-addon/1", version: VERSION, author: pack.author, license: pack.license, source: pack.source, ...a };
}

const packs = [];
const gltFiles = fs.readdirSync(path.join(glt, "transitions")).filter((f) => f.endsWith(".glsl")).sort();
const gltAddons = gltFiles.map((f) => convertTransition(path.join(glt, "transitions", f))).filter(Boolean).filter((a) => !exclude.has(a.id));
const seen = new Set();
for (const a of gltAddons) {
  if (seen.has(a.id)) throw new Error(`duplicate id ${a.id}`);
  seen.add(a.id);
}
packs.push({
  id: "gl-transitions",
  name: "GL Transitions",
  description: `${gltAddons.length} transitions from the open gl-transitions collection: wipes, zooms, warps, glitches, page curls and more.`,
  author: "gl-transitions contributors",
  license: "MIT",
  source: "https://github.com/gl-transitions/gl-transitions",
  icon: "🎞️",
  tags: ["transitions", "glsl"],
  licenseFile: path.join(glt, "LICENSE"),
  addons: gltAddons,
});
for (const [pack, dir, icon, tags] of [
  [GLFX_PACK, glfx, "🎨", ["effects", "overlays", "colour"]],
  [PIXI_PACK, pixi, "📼", ["effects", "overlays", "retro"]],
]) {
  packs.push({ ...pack, icon, tags, licenseFile: path.join(dir, "LICENSE"), addons: pack.addons.map((a) => finishAddon(a, pack)).filter((a) => !exclude.has(a.id)) });
}

fs.mkdirSync(OUT, { recursive: true });
const items = [];
for (const p of packs) {
  const dir = path.join(OUT, p.id, "files");
  fs.mkdirSync(dir, { recursive: true });
  const kinds = [...new Set(p.addons.map((a) => a.kind))];
  const packJson = { format: "rydr-studio-pack/1", id: p.id, name: p.name, version: VERSION, description: p.description, author: p.author, license: p.license, source: p.source, addons: p.addons };
  fs.writeFileSync(path.join(dir, `${p.id}.json`), JSON.stringify(packJson) + "\n");
  fs.copyFileSync(p.licenseFile, path.join(dir, "LICENSE.txt"));
  const item = {
    id: p.id,
    category: "studio-addons",
    name: p.name,
    description: p.description,
    author: p.author,
    version: VERSION,
    icon: p.icon,
    repo: p.source.replace(/^https:\/\//, ""),
    entryFile: `${p.id}.json`,
    rydrCategory: "tool",
    license: p.license,
    addonCount: p.addons.length,
    kinds,
    createdAt: NOW,
    updatedAt: NOW,
    downloads: 0,
    tags: p.tags,
  };
  fs.writeFileSync(path.join(OUT, p.id, "manifest.json"), JSON.stringify(item, null, 2) + "\n");
  items.push(item);
  console.log(`${p.id}: ${p.addons.length} add-ons (${kinds.join(", ")})`);
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(items, null, 2) + "\n");

// the marketplace's aggregate index: replace this category's entries, keep everything else
const idxPath = path.resolve("data/index.json");
const index = JSON.parse(fs.readFileSync(idxPath, "utf8")).filter((x) => x.category !== "studio-addons");
fs.writeFileSync(idxPath, JSON.stringify([...index, ...items], null, 2) + "\n");

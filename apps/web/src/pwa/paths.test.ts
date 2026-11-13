import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeBase, publicUrl } from "./paths";
import { buildServiceWorker, precacheList, swVersion } from "./serviceWorkerBuild";

describe("chemins sous la base", () => {
  it("normalise la base", () => {
    expect(normalizeBase("/")).toBe("/");
    expect(normalizeBase("")).toBe("/");
    expect(normalizeBase("./")).toBe("/");
    expect(normalizeBase("/clairiere-celeste")).toBe("/clairiere-celeste/");
    expect(normalizeBase("clairiere-celeste/")).toBe("/clairiere-celeste/");
  });

  it("construit les URL en local et sous /clairiere-celeste/", () => {
    expect(publicUrl("sw.js", "/")).toBe("/sw.js");
    expect(publicUrl("sw.js", "/clairiere-celeste/")).toBe("/clairiere-celeste/sw.js");
    expect(publicUrl("/icons/icon-192.png", "/clairiere-celeste/")).toBe("/clairiere-celeste/icons/icon-192.png");
    expect(publicUrl("", "/clairiere-celeste/")).toBe("/clairiere-celeste/");
  });
});

describe("manifeste", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../public/manifest.webmanifest", import.meta.url), "utf-8")) as {
    name: string;
    display: string;
    start_url: string;
    scope: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  it("porte le nom, les couleurs de D4 et un mode autonome", () => {
    expect(manifest.name).toBe("Clairière céleste");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#1B1838");
    expect(manifest.background_color).toBe("#1B1838");
  });

  it("n'utilise que des chemins relatifs, valables à la racine comme sous /clairiere-celeste/", () => {
    for (const p of [manifest.start_url, manifest.scope, ...manifest.icons.map((i) => i.src)]) {
      expect(p.startsWith("/"), p).toBe(false);
      expect(p, p).not.toMatch(/^https?:/);
    }
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
  });

  it("déclare les icônes 192, 512 et masquable, et les fichiers existent", () => {
    const has = (size: string, purpose: string) => manifest.icons.some((i) => i.sizes === size && (i.purpose ?? "any") === purpose);
    expect(has("192x192", "any")).toBe(true);
    expect(has("512x512", "any")).toBe(true);
    expect(has("512x512", "maskable")).toBe(true);
    for (const i of manifest.icons) expect(existsSync(new URL(`../../public/${i.src}`, import.meta.url)), i.src).toBe(true);
  });

  it("index.html référence le manifeste et les icônes via la base", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf-8");
    expect(html).toContain('href="%BASE_URL%manifest.webmanifest"');
    expect(html).toContain('href="%BASE_URL%icons/apple-touch-icon.png"');
    expect(html).toContain("<title>Clairière céleste</title>");
    expect(html).not.toMatch(/(?:href|src)="\/(?!src\/)/);
  });
});

describe("fabrication du service worker", () => {
  const template = readFileSync(new URL("../sw/sw.js", import.meta.url), "utf-8");

  it("liste les fichiers du build sans le service worker ni les cartes de source", () => {
    expect(precacheList(["sw.js", "assets\\index-ab.js", "./index.html", "assets/index-ab.js.map", "icons/icon-192.png"])).toEqual([
      "assets/index-ab.js",
      "icons/icon-192.png",
      "index.html",
    ]);
  });

  it("la version change quand le contenu du build change", () => {
    expect(swVersion(["a"])).toBe(swVersion(["a"]));
    expect(swVersion(["a"])).not.toBe(swVersion(["a", "b"]));
  });

  it("remplace les deux marqueurs, avec des chemins relatifs seulement", () => {
    const out = buildServiceWorker(template, ["index.html", "assets/index-ab.js", "sw.js"]);
    expect(out).not.toContain("__VERSION__");
    expect(out).not.toContain("__PRECACHE__");
    expect(out).toContain('"assets/index-ab.js"');
    expect(out).not.toContain('"/');
  });
});

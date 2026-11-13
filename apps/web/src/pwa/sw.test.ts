// Exécute le service worker généré (src/sw/sw.js) dans un bac à sable avec de fausses API, sous les deux bases.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildServiceWorker } from "./serviceWorkerBuild";

const template = readFileSync(new URL("../sw/sw.js", import.meta.url), "utf-8");
type Handler = (event: Record<string, unknown>) => void;

function boot(scope: string, files: string[]) {
  const origin = "https://example.test";
  const handlers: Record<string, Handler> = {};
  const caches = new Map<string, Map<string, string>>();
  const added: string[] = [];
  const offline = { value: false };
  const network: string[] = [];
  const cacheApi = {
    open: async (name: string) => {
      const store = caches.get(name) ?? new Map<string, string>();
      caches.set(name, store);
      return {
        addAll: async (reqs: { url: string }[]) => {
          for (const r of reqs) {
            added.push(r.url);
            store.set(r.url, `cached:${r.url}`);
          }
        },
      };
    },
    keys: async () => [...caches.keys()],
    delete: async (k: string) => caches.delete(k),
    match: async (req: { url: string } | string) => {
      const url = typeof req === "string" ? req : req.url;
      for (const store of caches.values()) if (store.has(url)) return store.get(url);
      return undefined;
    },
  };
  let claimed = false;
  let skipped = false;
  const self = {
    registration: { scope: origin + scope },
    location: { origin },
    addEventListener: (type: string, fn: Handler) => {
      handlers[type] = fn;
    },
    skipWaiting: () => {
      skipped = true;
    },
    clients: {
      claim: async () => {
        claimed = true;
      },
      matchAll: async () => [],
      openWindow: async () => null,
    },
  };
  class Request {
    constructor(
      public url: string,
      public init?: unknown,
    ) {}
  }
  const sandbox = {
    self,
    caches: cacheApi,
    Request,
    URL,
    Response: { error: () => "offline-error" },
    fetch: async (req: { url: string }) => {
      network.push(req.url);
      if (offline.value) throw new Error("hors ligne");
      return `network:${req.url}`;
    },
  };
  runInNewContext(buildServiceWorker(template, files), sandbox);
  const wait = async (type: string): Promise<void> => {
    let p: Promise<unknown> | undefined;
    handlers[type]?.({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
  };
  const respond = async (req: Record<string, unknown>): Promise<unknown> => {
    let p: Promise<unknown> | undefined;
    handlers["fetch"]?.({ request: req, respondWith: (x: Promise<unknown>) => (p = x) });
    return p === undefined ? "ignored" : await p;
  };
  return { origin, handlers, caches, added, network, offline, wait, respond, claimed: () => claimed, skipped: () => skipped };
}

for (const scope of ["/", "/clairiere-celeste/"]) {
  describe(`service worker sous ${scope}`, () => {
    const files = ["index.html", "assets/index-ab.js", "icons/icon-192.png", "manifest.webmanifest"];

    it("précache les fichiers du build sous la portée, puis nettoie les anciens caches", async () => {
      const sw = boot(scope, files);
      sw.caches.set("clairiere-celeste-ancien", new Map());
      sw.caches.set("autre-site", new Map());
      await sw.wait("install");
      expect(sw.added).toEqual([...files].sort().map((f) => sw.origin + scope + f));
      await sw.wait("activate");
      expect(sw.caches.has("clairiere-celeste-ancien")).toBe(false);
      expect(sw.caches.has("autre-site")).toBe(true);
      expect(sw.claimed()).toBe(true);
    });

    it("fichiers : cache d'abord ; pages : réseau d'abord puis index.html hors ligne", async () => {
      const sw = boot(scope, files);
      await sw.wait("install");
      const asset = sw.origin + scope + "assets/index-ab.js";
      expect(await sw.respond({ method: "GET", url: asset, mode: "no-cors" })).toBe(`cached:${asset}`);
      expect(sw.network).toEqual([]);

      const page = { method: "GET", url: sw.origin + scope + "?debug", mode: "navigate" };
      expect(await sw.respond(page)).toBe(`network:${page.url}`);
      sw.offline.value = true;
      expect(await sw.respond(page)).toBe(`cached:${sw.origin + scope}index.html`);
    });

    it("ignore les requêtes hors portée, d'un autre site ou non GET", async () => {
      const sw = boot(scope, files);
      await sw.wait("install");
      expect(await sw.respond({ method: "POST", url: sw.origin + scope + "x", mode: "cors" })).toBe("ignored");
      expect(await sw.respond({ method: "GET", url: "https://autre.test" + scope + "x", mode: "cors" })).toBe("ignored");
      if (scope !== "/") expect(await sw.respond({ method: "GET", url: sw.origin + "/ailleurs/x.js", mode: "cors" })).toBe("ignored");
    });

    it("la mise à jour n'est activée que sur demande de la page", () => {
      const sw = boot(scope, files);
      expect(sw.skipped()).toBe(false);
      sw.handlers["message"]?.({ data: { type: "SKIP_WAITING" } });
      expect(sw.skipped()).toBe(true);
    });
  });
}

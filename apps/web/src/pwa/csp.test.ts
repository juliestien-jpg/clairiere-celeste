import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSP_DIRECTIVES, cspContent, injectCsp } from "./csp";

const assetsDir = decodeURIComponent(new URL("../../../../assets", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");

function svgFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const full = join(dir, n);
    return statSync(full).isDirectory() ? svgFiles(full) : full.endsWith(".svg") ? [full] : [];
  });
}

describe("politique de sécurité du contenu", () => {
  it("est stricte : pas de script ni de style en ligne, pas d'eval, pas de source externe", () => {
    const csp = cspContent();
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
    expect(CSP_DIRECTIVES["script-src"]).toBe("'self'");
    expect(CSP_DIRECTIVES["object-src"]).toBe("'none'");
    expect(CSP_DIRECTIVES["worker-src"]).toBe("'self'");
  });

  it("s'injecte une seule fois, après <meta charset>", () => {
    const html = '<!doctype html><html><head>\n    <meta charset="UTF-8" />\n    <title>x</title></head></html>';
    const out = injectCsp(html);
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    expect(out.indexOf("Content-Security-Policy")).toBeGreaterThan(out.indexOf("charset"));
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(out.indexOf("<title>"));
    expect(injectCsp(out)).toBe(out);
  });

  it("les SVG inline n'utilisent ni attribut style ni balise <style> (interdits par la politique)", () => {
    const files = svgFiles(assetsDir);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => /\sstyle\s*=|<style[\s>]/i.test(readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
  });
});

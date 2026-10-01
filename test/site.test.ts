import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** Where a page path lives in the repo: art/ is copied from docs/art/ when the site is built. */
const inRepo = (ref: string) => new URL(`../${ref.startsWith("art/") ? `docs/${ref}` : `site/${ref}`}`, import.meta.url);

describe("site", () => {
	const html = read("site/index.html");
	const css = read("site/styles.css");

	it("loads nothing from other sites, and everything it loads exists", () => {
		const refs = [
			...[...html.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
			...[...html.matchAll(/<link\b[^>]*>/gi)]
				.filter((m) => !/rel=["']canonical["']/i.test(m[0]))
				.map((m) => /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? ""),
			...[...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((m) => m[1]),
		];
		expect(refs.length).toBeGreaterThan(0);
		for (const ref of refs) {
			expect(ref, ref).not.toMatch(/^([a-z][a-z0-9+.-]*:|\/\/)/i);
			expect(existsSync(inRepo(ref)), `missing ${ref}`).toBe(true);
		}
	});

	it("runs no scripts", () => {
		expect(html).not.toMatch(/<script/i);
	});

	it("describes every image", () => {
		for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) expect(tag, tag).toMatch(/\balt="[^"]+"/);
	});

	it("previews links with the social image", () => {
		expect(html).toContain('<meta property="og:image" content="https://mpalermiti.github.io/tally-for-teams/art/social.png">');
		expect(existsSync(inRepo("art/social.png"))).toBe(true);
	});

	it("downloads the latest release", () => {
		expect(html).toContain('href="https://github.com/mpalermiti/tally-for-teams/releases/latest/download/Tally.streamDeckPlugin"');
	});
});

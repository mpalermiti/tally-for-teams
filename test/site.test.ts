import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** Where a page path lives in the repo: art/ is copied from docs/art/ when the site is built. */
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const repoParts = (ref: string) => (ref.startsWith("art/") ? ["docs", ...ref.split("/")] : ["site", ...ref.split("/")]);
const inRepo = (ref: string) => join(repoRoot, ...repoParts(ref));
const srcsetRefs = (value: string) => value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean);
function expectCaseExactPath(ref: string): void {
	const path = inRepo(ref);
	expect(existsSync(path), `missing ${ref}`).toBe(true);
	let parent = repoRoot;
	for (const part of repoParts(ref)) {
		expect(readdirSync(parent), `wrong case in ${ref}: ${basename(part)}`).toContain(part);
		parent = join(parent, part);
	}
}

describe("site", () => {
	const html = read("site/index.html");
	const css = read("site/styles.css");

	it("loads nothing from other sites, and everything it loads exists", () => {
		const refs = [
			...[...html.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
			...[...html.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)].flatMap((m) => srcsetRefs(m[1])),
			...[...html.matchAll(/<link\b[^>]*>/gi)]
				.filter((m) => !/rel=["']canonical["']/i.test(m[0]))
				.map((m) => /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? ""),
			...[...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((m) => m[1]),
		];
		expect(refs.length).toBeGreaterThan(0);
		for (const ref of refs) {
			expect(ref, ref).not.toMatch(/^([a-z][a-z0-9+.-]*:|\/\/)/i);
			expectCaseExactPath(ref);
		}
	});

	it("serves a compact key strip on phones", () => {
		expect(html).toContain('<source media="(max-width: 734px)" srcset="art/keys-compact.svg" width="720" height="420">');
	});

	it("runs no scripts (structured data for search engines is just JSON)", () => {
		expect(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, "")).not.toMatch(/<script/i);
	});

	it("tells search engines it's a free macOS app", () => {
		const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(html);
		expect(block, "JSON-LD block").not.toBeNull();
		expect(JSON.parse(block![1])).toMatchObject({
			"@context": "https://schema.org",
			"@type": "SoftwareApplication",
			name: "Tally for Teams",
			operatingSystem: expect.stringContaining("macOS"),
			url: "https://mpalermiti.github.io/tally-for-teams/",
			downloadUrl: "https://github.com/mpalermiti/tally-for-teams/releases/latest/download/Tally.streamDeckPlugin",
			offers: { "@type": "Offer", price: "0" },
		});
	});

	it("names what people search for in the title", () => {
		const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? "";
		for (const word of ["Microsoft Teams", "plugin", "Stream Deck", "Mac"]) expect(title).toContain(word);
	});

	it("describes every image", () => {
		for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) expect(tag, tag).toMatch(/\balt="[^"]+"/);
	});

	it("previews links with the social image", () => {
		expect(html).toContain('<meta property="og:image" content="https://mpalermiti.github.io/tally-for-teams/art/social.png">');
		expect(html).toContain('<meta property="og:image:width" content="1280">');
		expect(html).toContain('<meta property="og:image:height" content="640">');
		expect(html).toContain('<meta property="og:image:alt" content="Tally for Teams: a Stream Deck with Tally keys lit mid-meeting">');
		expectCaseExactPath("art/social.png");
	});

	it("offers PNG icon fallbacks", () => {
		expect(html).toContain('<link rel="icon" href="art/icon.svg" type="image/svg+xml">');
		expect(html).toContain('<link rel="icon" href="art/icon-32.png" sizes="32x32" type="image/png">');
		expect(html).toContain('<link rel="apple-touch-icon" href="art/apple-touch-icon.png">');
	});

	it("downloads the latest release", () => {
		expect(html).toContain('href="https://github.com/mpalermiti/tally-for-teams/releases/latest/download/Tally.streamDeckPlugin"');
	});

	it("keeps the page neutral outside the key art", () => {
		expect(css).not.toMatch(/--action|#0066cc|#0071e3/i);
		expect(css).toMatch(/a\s*\{\s*color:\s*inherit;\s*text-decoration:\s*none;\s*\}/);
		expect(css).toMatch(/a:hover\s*\{\s*text-decoration:\s*underline;\s*\}/);
		expect(css).toMatch(/a:focus-visible\s*\{\s*outline:\s*2px solid #1d1d1f;\s*outline-offset:\s*3px;/);
		expect(css).toMatch(/\.button\s*\{[^}]*background:\s*#1d1d1f;[^}]*color:\s*#fff;/s);
		expect(css).toMatch(/\.button:hover\s*\{[^}]*background:\s*#000;[^}]*text-decoration:\s*none;[^}]*\}/s);
		expect(css).toMatch(/\.setup a\s*\{\s*text-decoration:\s*underline;\s*\}/);
		expect(css).toMatch(/footer a\s*\{[^}]*text-decoration:\s*underline;[^}]*\}/s);
		expect(css).toMatch(/\.setup li::before\s*\{[^}]*background:\s*#1d1d1f;[^}]*color:\s*#fff;/s);
	});

	it("balances display copy to avoid lone words", () => {
		expect(css).toMatch(/h1[^{]*\{[^}]*text-wrap:\s*balance;/s);
		expect(css).toMatch(/\.lede\s*\{[^}]*text-wrap:\s*balance;/s);
		expect(css).toMatch(/h2\s*\{[^}]*text-wrap:\s*balance;/s);
		expect(css).toMatch(/\.why p, \.keys p, \.privacy p, \.caption, \.setup-note\s*\{[^}]*text-wrap:\s*balance;/s);
	});
});

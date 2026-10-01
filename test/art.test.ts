import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildArt } from "../scripts/art";

describe("docs/art", () => {
	it.each(Object.entries(buildArt()))("%s matches the key renderer (run npm run art)", (name, svg) => {
		expect(readFileSync(new URL(`../docs/art/${name}`, import.meta.url), "utf8")).toBe(svg);
	});

	it("draws the hero from the real key faces", () => {
		const hero = buildArt()["hero.svg"];
		expect(hero).toContain('viewBox="0 0 1400 900"');
		expect(hero).toContain("radialGradient"); // lit keys (mic, camera, leave)
		expect(hero).not.toContain('id="g"'); // key gradient ids are made unique
	});

	it("animates the demo on a loop, small and still for reduced motion", () => {
		const demo = buildArt()["demo.svg"];
		expect(demo).toContain("@keyframes");
		expect(demo).toContain("prefers-reduced-motion");
		expect(Buffer.byteLength(demo)).toBeLessThan(150_000);
		expect(demo).not.toContain('id="g"');
	});

	it("stacks demo toolbar frames over an opaque base so fades stay solid", () => {
		const demo = buildArt()["demo.svg"];
		expect(demo).toContain('<g class="t0" opacity="1">');
		expect(demo).not.toContain(".t0{animation-name:t0}");
		expect(demo).toContain(".t1{animation-name:t1}.t2{animation-name:t2}.t3{animation-name:t3}");
		expect(demo).toContain("@keyframes t1{0%{opacity:0}11%{opacity:0}14%{opacity:1}89%{opacity:1}93%{opacity:0}100%{opacity:0}}");
		expect(demo).toContain("@keyframes t2{0%{opacity:0}39%{opacity:0}42%{opacity:1}89%{opacity:1}93%{opacity:0}100%{opacity:0}}");
		expect(demo).toContain("@keyframes t3{0%{opacity:0}59%{opacity:0}62%{opacity:1}89%{opacity:1}93%{opacity:0}100%{opacity:0}}");
	});

	it("keeps social.png rendered from the current social.svg (run npm run art)", () => {
		const expected = createHash("sha256").update(buildArt()["social.svg"]).digest("hex");
		expect(readFileSync(new URL("../docs/art/social.png.source", import.meta.url), "utf8").trim()).toBe(expected);
	});
});

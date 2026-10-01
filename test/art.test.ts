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
});

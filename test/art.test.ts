import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildArt, PNG_RENDERS } from "../scripts/art";

const pngSourceHash = (target: (typeof PNG_RENDERS)[number], svg: string) =>
	createHash("sha256")
		.update(
			JSON.stringify({
				width: target.width,
				height: target.height,
				fit: target.fit,
				backgroundColor: target.backgroundColor,
				svg,
			}),
		)
		.digest("hex");

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

	it("draws compact keys as two phone-legible rows", () => {
		const keys = buildArt()["keys-compact.svg"];
		expect(keys).toBeDefined();
		expect(keys).toContain('viewBox="0 0 720 420"');
		expect(keys).toContain('aria-label="The seven Tally keys: Mute, Camera, Raise hand, Share, Chat, React and Leave"');
		expect(keys).toContain('translate(12 0)');
		expect(keys).toContain('translate(104 220)');
		expect(keys).not.toContain('id="g"');
	});

	it("animates the demo on a loop, small and still for reduced motion", () => {
		const demo = buildArt()["demo.svg"];
		expect(demo).toContain("@keyframes");
		expect(demo).toContain("prefers-reduced-motion");
		expect(demo).toContain('<g class="a t3" opacity="1">');
		expect(Buffer.byteLength(demo)).toBeLessThan(150_000);
		expect(demo).not.toContain('id="g"');
	});

	it("starts the demo pointer away from the Leave button", () => {
		const demo = buildArt()["demo.svg"];
		expect(demo).toContain("transform:translate(117px,628px)");
		expect(demo).not.toContain("transform:translate(890px,620px)");
	});

	it("builds a full-bleed opaque apple touch icon", () => {
		const touchIcon = buildArt()["apple-touch-icon.svg"];
		expect(touchIcon).toBeDefined();
		if (touchIcon === undefined) return;
		expect(touchIcon).toContain('viewBox="0 0 180 180"');
		expect(touchIcon).toContain('<rect width="180" height="180" fill="url(#g)"/>');
		expect(touchIcon).not.toContain('x="16"');
		expect(touchIcon).not.toContain('width="224" height="224" rx="48"');
		expect(PNG_RENDERS.find(({ name }) => name === "apple-touch-icon.png")?.source).toBe("apple-touch-icon.svg");
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

	it.each(PNG_RENDERS)("keeps $name rendered from the current $source and settings (run npm run art)", (target) => {
		const { name, source } = target;
		const expected = pngSourceHash(target, buildArt()[source]);
		expect(readFileSync(new URL(`../docs/art/${name}`, import.meta.url)).byteLength).toBeGreaterThan(0);
		expect(readFileSync(new URL(`../docs/art/${name}.source`, import.meta.url), "utf8").trim()).toBe(expected);
	});

	it.each(PNG_RENDERS)("renders $name at its configured size", ({ name, width, height }) => {
		const png = readFileSync(new URL(`../docs/art/${name}`, import.meta.url));
		expect(png.readUInt32BE(16)).toBe(width);
		expect(png.readUInt32BE(20)).toBe(height);
	});
});

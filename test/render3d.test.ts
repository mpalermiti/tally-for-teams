import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { SHOTS, imageSize, sourceHash } from "../scripts/render3d";
import { THREE_FILES, THREE_VERSION, checkSha256 } from "../scripts/render3d/three";

describe("render3d three.js pin", () => {
	it("pins r186 files by sha256", () => {
		expect(THREE_VERSION).toBe("0.186.0");
		expect(THREE_FILES.map((f) => f.path)).toEqual([
			"build/three.module.js",
			"build/three.core.js",
			"examples/jsm/geometries/RoundedBoxGeometry.js",
			"examples/jsm/environments/RoomEnvironment.js",
		]);
		for (const f of THREE_FILES) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it("rejects a download whose hash doesn't match", () => {
		expect(() => checkSha256(Buffer.from("x"), "0".repeat(64), "f.js")).toThrow(/f\.js/);
		expect(() =>
			checkSha256(Buffer.from(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "f.js"),
		).not.toThrow();
	});
});

describe("render3d shots", () => {
	it("defines the three shots", () => {
		expect(SHOTS.map((s) => [s.name, s.width, s.height, s.format])).toEqual([
			["hero-device.jpg", 2400, 1350, "jpeg"],
			["social.png", 1280, 640, "png"],
			["keys-floating.jpg", 2000, 1000, "jpeg"],
		]);
	});

	it("hashes every input of a shot", () => {
		const shot = SHOTS[0];
		expect(sourceHash(shot)).toMatch(/^[0-9a-f]{64}$/);
		expect(sourceHash(shot)).toBe(sourceHash(shot));
		expect(sourceHash(shot, { faces: ["<svg/>"] })).not.toBe(sourceHash(shot));
		expect(sourceHash(shot, { scene: "changed" })).not.toBe(sourceHash(shot));
	});
});

describe("render3d image sizes", () => {
	it("reads PNG dimensions from the IHDR header", () => {
		const png = Buffer.alloc(33);
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
		png.writeUInt32BE(13, 8);
		Buffer.from("IHDR").copy(png, 12);
		png.writeUInt32BE(1280, 16);
		png.writeUInt32BE(640, 20);
		expect(imageSize(png)).toEqual({ width: 1280, height: 640 });
	});

	it("rejects PNG-looking data without an IHDR chunk", () => {
		const png = Buffer.alloc(24);
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
		png.writeUInt32BE(1280, 16);
		png.writeUInt32BE(640, 20);
		expect(() => imageSize(png)).toThrow(/IHDR/);
	});

	it("reads JPEG dimensions from the first SOF segment", () => {
		const jpg = Buffer.concat([
			Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
			Buffer.alloc(14),
			Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x46, 0x09, 0x60]),
			Buffer.alloc(10),
		]);
		expect(imageSize(jpg)).toEqual({ width: 2400, height: 1350 });
	});

	it("throws for unsupported image data", () => {
		expect(() => imageSize(Buffer.from("nope"))).toThrow(/image size/i);
	});
});

describe("render3d package script", () => {
	it("wires npm run art:3d through tsx", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts["art:3d"]).toBe("node --import tsx scripts/render3d.ts");
	});
});

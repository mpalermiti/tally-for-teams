import { describe, expect, it } from "vitest";

import { SHOTS, sourceHash } from "../scripts/render3d";
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

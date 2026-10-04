import { describe, expect, it } from "vitest";

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

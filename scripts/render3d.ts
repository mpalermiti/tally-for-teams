import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { deviceKeyFaces, floatingKeyFaces } from "./art";
import { THREE_FILES, THREE_VERSION } from "./render3d/three";

export type Shot = {
	name: string;
	shot: "hero" | "social" | "floating";
	width: number;
	height: number;
	format: "jpeg" | "png";
	quality?: number;
};

export const SHOTS: readonly Shot[] = [
	{ name: "hero-device.jpg", shot: "hero", width: 2400, height: 1350, format: "jpeg", quality: 0.9 },
	{ name: "social.png", shot: "social", width: 1280, height: 640, format: "png" },
	{ name: "keys-floating.jpg", shot: "floating", width: 2000, height: 1000, format: "jpeg", quality: 0.9 },
];

const SCENE_DIR = new URL("./render3d/", import.meta.url);

export function sceneSource(): string {
	return ["scene.html", "scene.js"].map((f) => readFileSync(new URL(f, SCENE_DIR), "utf8")).join("\n/*--*/\n");
}

export function shotFaces(): string[] {
	const floating = floatingKeyFaces();
	return [...deviceKeyFaces(), ...Object.keys(floating).sort().map((k) => floating[k as keyof typeof floating])];
}

export function sourceHash(shot: Shot, override: { faces?: string[]; scene?: string } = {}): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				shot,
				three: THREE_VERSION,
				threeFiles: THREE_FILES.map((f) => f.sha256),
				scene: override.scene ?? sceneSource(),
				faces: override.faces ?? shotFaces(),
			}),
		)
		.digest("hex");
}

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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2]);

export function imageSize(buf: Buffer): { width: number; height: number } {
	if (buf.length >= 24 && buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
	}

	if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
		let offset = 2;
		while (offset + 3 < buf.length) {
			if (buf[offset] !== 0xff) throw new Error("Couldn't read image size: invalid JPEG segment");
			const marker = buf[offset + 1];
			if (marker === 0xda || marker === 0xd9) break;
			const length = buf.readUInt16BE(offset + 2);
			const next = offset + 2 + length;
			if (length < 2 || next > buf.length) throw new Error("Couldn't read image size: invalid JPEG segment length");
			if (JPEG_SOF_MARKERS.has(marker)) {
				if (length < 7) throw new Error("Couldn't read image size: invalid JPEG SOF segment");
				return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
			}
			offset = next;
		}
	}

	throw new Error("Couldn't read image size");
}

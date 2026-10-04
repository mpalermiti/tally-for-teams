/** three.js for the device renders: fetched from jsDelivr (the npm package) at a pinned version, checked by sha256, cached outside the repo. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const THREE_VERSION = "0.186.0";
export const THREE_FILES = [
	{ path: "build/three.module.js", sha256: "9052042d676cb0fdc1ddfefe193053f34b7ac0513a616fdac4535d49987812ea" },
	{ path: "build/three.core.js", sha256: "9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6" },
	{ path: "examples/jsm/geometries/RoundedBoxGeometry.js", sha256: "c5feab96123858ed8823c889b238dc8734adab7e760e3cfd21e7f3f2f3e348e3" },
	{ path: "examples/jsm/environments/RoomEnvironment.js", sha256: "55f466192cc84298755a424c5e040345006b2ee1455589b3b54126c2ea4123f4" },
] as const;

export function checkSha256(data: Buffer, expected: string, label: string): void {
	const actual = createHash("sha256").update(data).digest("hex");
	if (actual !== expected) throw new Error(`${label}: sha256 ${actual} doesn't match the pinned ${expected}`);
}

export const threeCacheDir = () => join(homedir(), "Library", "Caches", "tally-art", `three-${THREE_VERSION}`);

/** Downloads any missing file, verifies every file, and returns the cache directory. */
export async function ensureThree(): Promise<string> {
	const dir = threeCacheDir();
	for (const file of THREE_FILES) {
		const target = join(dir, file.path);
		if (!existsSync(target)) {
			const url = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/${file.path}`;
			const response = await fetch(url);
			if (!response.ok) throw new Error(`Couldn't download ${url}: HTTP ${response.status}`);
			const data = Buffer.from(await response.arrayBuffer());
			checkSha256(data, file.sha256, file.path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, data);
		}
		checkSha256(readFileSync(target), file.sha256, file.path);
	}
	return dir;
}

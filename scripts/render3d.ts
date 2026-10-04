import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { deviceKeyFaces, floatingKeyFaces } from "./art";
import { THREE_FILES, THREE_VERSION, ensureThree } from "./render3d/three";

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
const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_PROFILE_PREFIX = "tally-art-chrome-";
const STALE_CHROME_PROFILE_MS = 60 * 60 * 1000;
const SAVE_LIMIT_BYTES = 25 * 1024 * 1024;
const ERROR_LIMIT_BYTES = 64 * 1024;

class BodyTooLargeError extends Error {
	readonly status = 413;

	constructor(limit: number) {
		super(`Request body too large; limit is ${limit} bytes`);
	}
}

export function imageSize(buf: Buffer): { width: number; height: number } {
	if (buf.length >= PNG_SIGNATURE.length && buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		if (
			buf.length < 33 ||
			buf.readUInt32BE(8) !== 13 ||
			buf.subarray(12, 16).toString("ascii") !== "IHDR"
		) {
			throw new Error("Couldn't read image size: invalid PNG IHDR chunk");
		}
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

export function validateUpload(shot: Shot, buf: Buffer): void {
	const size = imageSize(buf);
	if (size.width !== shot.width || size.height !== shot.height) {
		throw new Error(`${shot.name}: uploaded ${size.width}×${size.height}, expected ${shot.width}×${shot.height}`);
	}
}

type PendingSave = {
	resolve: () => void;
	reject: (error: Error) => void;
};

type CurrentShot = {
	name: string;
	reject: (error: Error) => void;
};

export async function readBody(req: AsyncIterable<Buffer | string>, limit: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		size += buf.byteLength;
		if (size > limit) throw new BodyTooLargeError(limit);
		chunks.push(buf);
	}
	return Buffer.concat(chunks, size);
}

function send(res: ServerResponse, status: number, type: string, data = ""): void {
	res.writeHead(status, { "content-type": type });
	res.end(data);
}

function notFound(res: ServerResponse): void {
	send(res, 404, "text/plain", "Not found");
}

async function closeServer(server: Server): Promise<void> {
	if (!server.listening) return;
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

async function listen(server: Server): Promise<number> {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Couldn't start render server");
	return address.port;
}

function exitLabel(code: number | null, signal: NodeJS.Signals | null): string {
	if (code !== null) return `exit ${code}`;
	return signal ? `signal ${signal}` : "unknown exit";
}

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
		? error.code
		: undefined;
}

function removeTempProfiles(profiles: Set<string>): void {
	for (const profile of profiles) {
		rmSync(profile, { recursive: true, force: true });
		profiles.delete(profile);
	}
}

function cleanupStaleChromeProfiles(): void {
	for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith(CHROME_PROFILE_PREFIX)) continue;
		const path = join(tmpdir(), entry.name);
		try {
			if (Date.now() - statSync(path).mtimeMs > STALE_CHROME_PROFILE_MS) {
				rmSync(path, { recursive: true, force: true });
			}
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
		}
	}
}

function chromeExited(child: ChildProcess): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

function signalChrome(child: ChildProcess, signal: NodeJS.Signals): void {
	if (child.pid === undefined) return;
	try {
		process.kill(-child.pid, signal);
	} catch (error) {
		if (errorCode(error) !== "ESRCH") throw error;
	}
}

async function waitForChromeExit(child: ChildProcess, ms: number): Promise<void> {
	if (chromeExited(child)) return;
	await new Promise<void>((resolve) => {
		const done = () => {
			clearTimeout(timeout);
			child.off("error", done);
			child.off("exit", done);
			resolve();
		};
		const timeout = setTimeout(done, ms);
		child.once("error", done);
		child.once("exit", done);
	});
}

async function terminateChrome(child: ChildProcess): Promise<void> {
	if (chromeExited(child)) return;
	signalChrome(child, "SIGTERM");
	await waitForChromeExit(child, 5_000);
	if (!chromeExited(child)) {
		signalChrome(child, "SIGKILL");
		await waitForChromeExit(child, 3_000);
	}
}

function writeUpload(out: string, shot: Shot, buf: Buffer): void {
	validateUpload(shot, buf);
	const tmp = join(out, `${shot.name}.tmp-${process.pid}`);
	try {
		writeFileSync(tmp, buf);
		renameSync(tmp, join(out, shot.name));
		writeFileSync(join(out, `${shot.name}.source`), `${sourceHash(shot)}\n`);
	} catch (error) {
		rmSync(tmp, { force: true });
		throw error;
	}
}

async function main(): Promise<void> {
	cleanupStaleChromeProfiles();
	const chrome = process.env.CHROME ?? DEFAULT_CHROME;
	if (!existsSync(chrome)) throw new Error(`Chrome not found at ${chrome}. Set CHROME=/path/to/chrome, then run npm run art:3d.`);

	const threeDir = await ensureThree();
	const out = fileURLToPath(new URL("../docs/art/", import.meta.url));
	mkdirSync(out, { recursive: true });
	const faces = { device: deviceKeyFaces(), floating: floatingKeyFaces() };
	const allowedThree = new Set<string>(THREE_FILES.map((file) => file.path));
	const shotsByName = new Map<string, Shot>(SHOTS.map((shot) => [shot.name, shot]));
	const pending = new Map<string, PendingSave>();
	let current: CurrentShot | undefined;
	let activeChrome: ChildProcess | undefined;
	const tempProfiles = new Set<string>();
	let signalReceived = false;

	const server = createServer((req, res) => {
		void (async () => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (req.method === "GET" && url.pathname === "/") {
				send(res, 200, "text/html", readFileSync(new URL("scene.html", SCENE_DIR), "utf8"));
				return;
			}
			if (req.method === "GET" && url.pathname === "/scene.js") {
				send(res, 200, "text/javascript", readFileSync(new URL("scene.js", SCENE_DIR), "utf8"));
				return;
			}
			if (req.method === "GET" && url.pathname.startsWith("/three/")) {
				const threePath = decodeURIComponent(url.pathname.slice("/three/".length));
				if (!allowedThree.has(threePath)) {
					notFound(res);
					return;
				}
				send(res, 200, "text/javascript", readFileSync(join(threeDir, threePath), "utf8"));
				return;
			}
			if (req.method === "GET" && url.pathname === "/faces.json") {
				send(res, 200, "application/json", JSON.stringify(faces));
				return;
			}
			if (req.method === "POST" && url.pathname.startsWith("/save/")) {
				const name = decodeURIComponent(url.pathname.slice("/save/".length));
				const shot = shotsByName.get(name);
				if (!shot) {
					notFound(res);
					return;
				}
				const save = pending.get(name);
				if (!save) {
					send(res, 409, "text/plain", "No pending render for shot");
					return;
				}
				writeUpload(out, shot, await readBody(req, SAVE_LIMIT_BYTES));
				res.writeHead(204);
				res.end();
				save.resolve();
				return;
			}
			if (req.method === "POST" && url.pathname === "/error") {
				const message = (await readBody(req, ERROR_LIMIT_BYTES)).toString();
				console.error(message);
				current?.reject(new Error(message || `${current.name}: scene failed`));
				res.writeHead(204);
				res.end();
				return;
			}
			notFound(res);
		})().catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			current?.reject(error instanceof Error ? error : new Error(message));
			if (!res.headersSent) send(res, error instanceof BodyTooLargeError ? error.status : 500, "text/plain", message);
			else res.end();
		});
	});

	try {
		const port = await listen(server);
		const handleSignal = (signal: NodeJS.Signals, code: number) => {
			if (signalReceived) return;
			signalReceived = true;
			void (async () => {
				try {
					if (activeChrome) await terminateChrome(activeChrome);
					removeTempProfiles(tempProfiles);
					await closeServer(server);
				} catch (error) {
					console.error(`art:3d: cleanup after ${signal} failed: ${error instanceof Error ? error.message : String(error)}`);
				} finally {
					process.exit(code);
				}
			})();
		};
		const onSigint = () => handleSignal("SIGINT", 130);
		const onSigterm = () => handleSignal("SIGTERM", 143);
		process.once("SIGINT", onSigint);
		process.once("SIGTERM", onSigterm);
		for (const shot of SHOTS) {
			const tmpProfile = mkdtempSync(join(tmpdir(), CHROME_PROFILE_PREFIX));
			tempProfiles.add(tmpProfile);
			let saved = false;
			let rejectSave: (error: Error) => void = () => {};
			const save = new Promise<void>((resolve, reject) => {
				rejectSave = reject;
				pending.set(shot.name, {
					resolve: () => {
						saved = true;
						resolve();
					},
					reject,
				});
			});
			current = { name: shot.name, reject: rejectSave };

			const q = shot.quality ?? 0.92;
			const url =
				`http://127.0.0.1:${port}/?shot=${shot.shot}&name=${encodeURIComponent(shot.name)}` +
				`&w=${shot.width}&h=${shot.height}&format=${shot.format}&q=${q}`;
			const child = spawn(
				chrome,
				[
					"--headless=new",
					"--use-angle=metal",
					"--enable-gpu",
					"--hide-scrollbars",
					"--force-device-scale-factor=1",
					`--window-size=${shot.width},${shot.height}`,
					`--user-data-dir=${tmpProfile}`,
					"--no-first-run",
					"--no-default-browser-check",
					url,
				],
				{ detached: true, stdio: ["ignore", "ignore", "pipe"] },
			);
			activeChrome = child;
			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
				if (stderr.length > 8000) stderr = stderr.slice(-8000);
			});
			child.once("error", (error) => {
				if (!saved) rejectSave(error);
			});
			child.once("exit", (code, signal) => {
				if (!saved) {
					const detail = stderr.trim();
					rejectSave(new Error(`${shot.name}: Chrome exited before saving (${exitLabel(code, signal)})${detail ? `\n${detail}` : ""}`));
				}
			});
			const timeout = setTimeout(() => rejectSave(new Error(`${shot.name}: render timed out after 90s`)), 90_000);
			try {
				await save;
			} finally {
				clearTimeout(timeout);
				pending.delete(shot.name);
				if (current?.name === shot.name) current = undefined;
				await terminateChrome(child);
				if (activeChrome === child) activeChrome = undefined;
				rmSync(tmpProfile, { recursive: true, force: true });
				tempProfiles.delete(tmpProfile);
			}
		}
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
	} finally {
		if (activeChrome) await terminateChrome(activeChrome);
		removeTempProfiles(tempProfiles);
		await closeServer(server);
	}

	console.log(`art:3d: ${SHOTS.map((shot) => shot.name).join(", ")}`);
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		console.error(`art:3d: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}

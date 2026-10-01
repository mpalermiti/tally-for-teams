/**
 * Renders the README and site art from the plugin's own key renderer, so pictures of keys always
 * match the real thing:
 *   docs/art/hero.svg          a Stream Deck MK.2 mid-meeting
 *   docs/art/demo.svg          animated: press Mute, raise a hand in Teams, press Share
 *   docs/art/keys.svg          the seven keys, labelled
 *   docs/art/keys-compact.svg  the seven keys in two phone-sized rows
 *   docs/art/icon.svg          favicon (the plugin mark)
 *   docs/art/social.svg        1280×640 link preview
 *   docs/art/social.png        Chrome-rendered link preview PNG (browser/SF Pro text)
 *   docs/art/social.png.source sha256 of the social.svg markup rendered into social.png
 *   docs/art/icon-32.png       Chrome-rendered 32×32 favicon PNG from icon.svg
 *   docs/art/apple-touch-icon.png Chrome-rendered 180×180 touch icon PNG from icon.svg
 * Run `npm run art` after changing the key design; test/art.test.ts fails if these are stale.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GLYPHS, type GlyphName } from "../src/render/glyphs";
import { keySvg, markSvg, visualFor, type KeyKind } from "../src/render/key";
import {
	EMPTY_STATE,
	NO_PERMISSIONS,
	type MeetingPermissions,
	type MeetingState,
	type Reaction,
	type Snapshot,
} from "../src/teams/protocol";

const ALLOWED = Object.fromEntries(Object.keys(NO_PERMISSIONS).map((key) => [key, true])) as unknown as MeetingPermissions;
const inMeeting = (state: Partial<MeetingState> = {}): Snapshot => ({
	online: true,
	state: { ...EMPTY_STATE, isInMeeting: true, ...state },
	permissions: ALLOWED,
});

const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const INK = "#1D1D1F";
const SOFT_INK = "#6E6E73";
const PAPER = "#F5F5F7";
const AMBER = "#F7B93E";

const KEY = 144;
const GAP = 34;
const PAD = 58;
const DEVICE_W = PAD * 2 + 5 * KEY + 4 * GAP;
const DEVICE_H = PAD * 2 + 3 * KEY + 2 * GAP;

type Slot = { kind: KeyKind; reaction?: Reaction } | null;
/** The MK.2 layout used everywhere: meeting keys, reactions, Leave in the far corner. */
const LAYOUT: Slot[] = [
	{ kind: "mute" },
	{ kind: "camera" },
	{ kind: "hand" },
	{ kind: "share" },
	{ kind: "chat" },
	{ kind: "react", reaction: "like" },
	{ kind: "react", reaction: "love" },
	{ kind: "react", reaction: "applause" },
	{ kind: "react", reaction: "laugh" },
	{ kind: "react", reaction: "wow" },
	null,
	null,
	null,
	null,
	{ kind: "leave" },
];

/** Hands out ids, so several key faces (each with its own gradient) can share one SVG. */
class Ids {
	#n = 0;
	next(prefix: string): string {
		return `${prefix}${this.#n++}`;
	}
}

/** A key face's inner markup, with its gradient id made unique. Empty slots are dark. */
function face(slot: Slot, snapshot: Snapshot, ids: Ids): string {
	if (!slot) return `<rect width="${KEY}" height="${KEY}" fill="#0B0B0D"/>`;
	const id = ids.next("g");
	return keySvg(visualFor(slot.kind, snapshot, { reaction: slot.reaction }))
		.replace(/^<svg[^>]*>/, "")
		.replace(/<\/svg>$/, "")
		.replaceAll('id="g"', `id="${id}"`)
		.replaceAll("url(#g)", `url(#${id})`);
}

/** A key with rounded corners; `inner` may stack several faces. */
function keyCap(inner: string, ids: Ids, options: { hairline?: boolean; shadow?: boolean } = {}): string {
	const clip = ids.next("c");
	const hairline = options.hairline ?? true;
	return (
		(options.shadow
			? `<rect x="4" y="8" width="${KEY - 8}" height="${KEY - 2}" rx="24" fill="#000" opacity=".08" filter="url(#keyStripShadow)"/>`
			: "") +
		`<clipPath id="${clip}"><rect width="${KEY}" height="${KEY}" rx="24"/></clipPath>` +
		`<g clip-path="url(#${clip})">${inner}</g>` +
		(hairline
			? `<rect width="${KEY}" height="${KEY}" rx="24" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="2"/>`
			: "")
	);
}

const DEVICE_DEFS =
	`<linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E2E33"/><stop offset="1" stop-color="#1C1C20"/></linearGradient>` +
	`<filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>`;
const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * A Stream Deck MK.2. `keyAt` returns each key's inner markup (the demo stacks an "off" and an
 * "on" face); `keyClass` lets the demo animate a whole key (the press dip).
 */
function device(keyAt: (index: number, slot: Slot) => string, ids: Ids, keyClass: (index: number) => string = () => ""): string {
	let keys = "";
	LAYOUT.forEach((slot, i) => {
		const x = PAD + (i % 5) * (KEY + GAP);
		const y = PAD + Math.floor(i / 5) * (KEY + GAP);
		const cls = keyClass(i);
		keys += `<g transform="translate(${x} ${y})"><g${cls ? ` class="${cls}"` : ""}>${keyCap(keyAt(i, slot), ids)}</g></g>`;
	});
	return (
		`<rect y="14" width="${DEVICE_W}" height="${DEVICE_H}" rx="56" fill="#000" opacity=".18" filter="url(#shadow)"/>` +
		`<rect width="${DEVICE_W}" height="${DEVICE_H}" rx="56" fill="url(#body)"/>` +
		`<rect x="1.5" y="1.5" width="${DEVICE_W - 3}" height="${DEVICE_H - 3}" rx="54.5" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="3"/>` +
		keys
	);
}

const svgDoc = (width: number, height: number, label: string, body: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">${body}</svg>`;

const card = (width: number, height: number) => `<rect width="${width}" height="${height}" rx="32" fill="${PAPER}"/>`;

/** The hero: an MK.2 mid-meeting, mic and camera live, Leave red. */
export function heroSvg(): string {
	const ids = new Ids();
	const snapshot = inMeeting({ isMuted: false, isVideoOn: true });
	const W = 1400;
	const H = 900;
	const body = device((_, slot) => face(slot, snapshot, ids), ids);
	return svgDoc(
		W,
		H,
		"A Stream Deck with Tally keys mid-meeting: mic and camera lit, Leave in red",
		`<defs>${DEVICE_DEFS}</defs>${card(W, H)}<g transform="translate(${(W - DEVICE_W) / 2} ${(H - DEVICE_H) / 2 - 10})">${body}</g>`,
	);
}

const KEY_STRIP_KEYS: [Slot, string][] = [
	[{ kind: "mute" }, "Mute"],
	[{ kind: "camera" }, "Camera"],
	[{ kind: "hand" }, "Raise hand"],
	[{ kind: "share" }, "Share"],
	[{ kind: "chat" }, "Chat"],
	[{ kind: "react", reaction: "like" }, "React"],
	[{ kind: "leave" }, "Leave"],
];

function labeledKey(slot: Slot, label: string, ids: Ids, snapshot: Snapshot, fontSize = 22): string {
	return (
		keyCap(face(slot, snapshot, ids), ids, { hairline: false, shadow: true }) +
		`<text x="${KEY / 2}" y="${KEY + 40}" text-anchor="middle" font-family="${FONT}" font-size="${fontSize}" fill="${INK}">${label}</text>`
	);
}

/** The seven keys in a row, lit as in a meeting, each labelled. For the site. */
export function keysSvg(): string {
	const ids = new Ids();
	const snapshot = inMeeting({ isMuted: false, isVideoOn: true, isHandRaised: true, isSharing: true });
	const STEP = KEY + 56;
	const W = KEY_STRIP_KEYS.length * KEY + (KEY_STRIP_KEYS.length - 1) * 56;
	const H = KEY + 52;
	let body = "";
	KEY_STRIP_KEYS.forEach(([slot, label], i) => {
		body += `<g transform="translate(${i * STEP} 0)">${labeledKey(slot, label, ids, snapshot)}</g>`;
	});
	return svgDoc(
		W,
		H,
		"The seven Tally keys: Mute, Camera, Raise hand, Share, Chat, React and Leave",
		`<defs><filter id="keyStripShadow" x="-12%" y="-8%" width="124%" height="126%"><feGaussianBlur stdDeviation="4"/></filter></defs>${body}`,
	);
}

/** The same seven keys in two centered, phone-legible rows. */
export function keysCompactSvg(): string {
	const ids = new Ids();
	const snapshot = inMeeting({ isMuted: false, isVideoOn: true, isHandRaised: true, isSharing: true });
	const W = 720;
	const H = 420;
	const STEP = KEY + 40;
	const ROW_GAP = 220;
	const rows = [KEY_STRIP_KEYS.slice(0, 4), KEY_STRIP_KEYS.slice(4)];
	let body = "";
	rows.forEach((row, rowIndex) => {
		const rowWidth = row.length * KEY + (row.length - 1) * 40;
		const x = (W - rowWidth) / 2;
		const y = rowIndex * ROW_GAP;
		body += `<g transform="translate(${x} ${y})">`;
		row.forEach(([slot, label], i) => {
			body += `<g transform="translate(${i * STEP} 0)">${labeledKey(slot, label, ids, snapshot, 24)}</g>`;
		});
		body += "</g>";
	});
	return svgDoc(
		W,
		H,
		"The seven Tally keys: Mute, Camera, Raise hand, Share, Chat, React and Leave",
		`<defs><filter id="keyStripShadow" x="-12%" y="-8%" width="124%" height="126%"><feGaussianBlur stdDeviation="4"/></filter></defs>${body}`,
	);
}

/** The 1280×640 link preview: name and one line beside the device. */
export function socialSvg(): string {
	const ids = new Ids();
	const snapshot = inMeeting({ isMuted: false, isVideoOn: true });
	const W = 1280;
	const H = 640;
	const scale = 0.55;
	const body = device((_, slot) => face(slot, snapshot, ids), ids);
	return svgDoc(
		W,
		H,
		"Tally for Teams",
		`<defs>${DEVICE_DEFS}</defs><rect width="${W}" height="${H}" fill="${PAPER}"/>` +
			`<text x="88" y="300" font-family="${FONT}" font-size="64" font-weight="700" fill="${INK}">Tally for Teams</text>` +
			`<text x="88" y="360" font-family="${FONT}" font-size="28" fill="${SOFT_INK}">Live Teams controls</text>` +
			`<text x="88" y="396" font-family="${FONT}" font-size="28" fill="${SOFT_INK}">for Stream Deck on Mac.</text>` +
			`<g transform="translate(${W - DEVICE_W * scale - 64} ${(H - DEVICE_H * scale) / 2}) scale(${scale})">${body}</g>`,
	);
}

function icon(name: GlyphName, color: string, x: number, y: number, size = 30): string {
	return `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</g>`;
}

/** One toolbar button: icon over a label, optionally highlighted like Teams does. */
function toolButton(index: number, glyph: GlyphName, label: string, highlighted = false): string {
	return (
		`<g transform="translate(${24 + index * 108} 18)">` +
		(highlighted ? `<rect x="-6" y="-6" width="96" height="92" rx="16" fill="${AMBER}" opacity=".22"/>` : "") +
		icon(glyph, INK, 27, 6) +
		`<text x="42" y="70" text-anchor="middle" font-family="${FONT}" font-size="15" fill="#3A3A3C">${label}</text></g>`
	);
}

/** A simplified meeting toolbar (not Microsoft's artwork) in one state. */
function toolbar(state: Partial<MeetingState>): string {
	const muted = state.isMuted ?? false;
	return (
		`<rect width="600" height="120" rx="22" fill="#FFFFFF" stroke="#E5E5EA" stroke-width="2"/>` +
		toolButton(0, muted ? "mic-off" : "mic", muted ? "Unmute" : "Mute") +
		toolButton(1, "video", "Camera") +
		toolButton(2, "hand", state.isHandRaised ? "Lower" : "React", state.isHandRaised) +
		toolButton(3, "screen-share", state.isSharing ? "Stop" : "Share", state.isSharing) +
		`<g transform="translate(456 30)"><rect width="124" height="60" rx="14" fill="#D83A31"/>${icon("phone-off", "#FFFFFF", 16, 17, 26)}` +
		`<text x="52" y="37" font-family="${FONT}" font-size="17" font-weight="600" fill="#FFFFFF">Leave</text></g>`
	);
}

/** CSS keyframes from [percent, value] stops. */
const keyframes = (name: string, property: "opacity" | "transform", stops: [number, string][]) =>
	`@keyframes ${name}{${stops.map(([at, value]) => `${at}%{${property}:${value}}`).join("")}}`;

/** Fade in at `on`, out at `off` (each over 3% of the loop). */
const fadeWindow = (name: string, on: number, off: number) =>
	keyframes(name, "opacity", [
		[0, "0"],
		[on, "0"],
		[on + 3, "1"],
		[off, "1"],
		[off + 4, "0"],
		[100, "0"],
	]);

/** The demo: press Mute, raise a hand in Teams, press Share; keys and Teams stay in step. */
export function demoSvg(): string {
	const ids = new Ids();
	const W = 980;
	const H = 680;
	const deviceScale = 0.55;
	const toolbarScale = 1.55;
	const beats: Partial<MeetingState>[] = [
		{ isMuted: true, isVideoOn: true },
		{ isMuted: false, isVideoOn: true },
		{ isMuted: false, isVideoOn: true, isHandRaised: true },
		{ isMuted: false, isVideoOn: true, isHandRaised: true, isSharing: true },
	];
	const final = inMeeting(beats[3]);
	// Keys that change: index → [state before, class of the lit layer].
	const changing: Record<number, [Partial<MeetingState>, string]> = {
		0: [beats[0], "mute-on"],
		2: [beats[1], "hand-on"],
		3: [beats[2], "share-on"],
	};
	const keyAt = (index: number, slot: Slot) => {
		const change = changing[index];
		if (!change) return face(slot, final, ids);
		const [before, cls] = change;
		return `${face(slot, inMeeting(before), ids)}<g class="a ${cls}" opacity="1">${face(slot, final, ids)}</g>`;
	};
	const keyClass = (index: number) => (index === 0 ? "a dip mute-dip" : index === 3 ? "a dip share-dip" : "");

	const frames = beats
		.map((state, i) => `<g class="${i === 0 ? "t0" : `a t${i}`}" opacity="1">${toolbar(state)}</g>`)
		.join("");
	const pointer =
		`<g class="a pointer" opacity="0"><path d="M0 0 L0 30 L8 23 L13 34 L18 32 L13 21 L23 21 Z" fill="${INK}" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/></g>`;

	const deviceX = (W - DEVICE_W * deviceScale) / 2;
	const deviceY = 46;
	const toolbarX = (W - 600 * toolbarScale) / 2;
	const toolbarY = 438;
	const handX = toolbarX + toolbarScale * (24 + 2 * 108 + 40);
	const handY = toolbarY + toolbarScale * (18 + 30);
	const pointerStartX = toolbarX + 92;
	const pointerStartY = H - 52;
	const css =
		`.a{animation-duration:10s;animation-iteration-count:infinite;animation-timing-function:ease-in-out}` +
		`.dip{transform-box:fill-box;transform-origin:center}` +
		`.mute-on{animation-name:muteOn}.hand-on{animation-name:handOn}.share-on{animation-name:shareOn}` +
		`.mute-dip{animation-name:muteDip}.share-dip{animation-name:shareDip}` +
		`.t1{animation-name:t1}.t2{animation-name:t2}.t3{animation-name:t3}.pointer{animation-name:pointer}` +
		fadeWindow("muteOn", 11, 89) +
		fadeWindow("handOn", 41, 89) +
		fadeWindow("shareOn", 59, 89) +
		keyframes("muteDip", "transform", [
			[0, "scale(1)"],
			[9, "scale(1)"],
			[11, "scale(.93)"],
			[13, "scale(1)"],
			[100, "scale(1)"],
		]) +
		keyframes("shareDip", "transform", [
			[0, "scale(1)"],
			[57, "scale(1)"],
			[59, "scale(.93)"],
			[61, "scale(1)"],
			[100, "scale(1)"],
		]) +
		keyframes("t1", "opacity", [
			[0, "0"],
			[11, "0"],
			[14, "1"],
			[89, "1"],
			[93, "0"],
			[100, "0"],
		]) +
		keyframes("t2", "opacity", [
			[0, "0"],
			[39, "0"],
			[42, "1"],
			[89, "1"],
			[93, "0"],
			[100, "0"],
		]) +
		keyframes("t3", "opacity", [
			[0, "0"],
			[59, "0"],
			[62, "1"],
			[89, "1"],
			[93, "0"],
			[100, "0"],
		]) +
		`@keyframes pointer{0%,28%{opacity:0;transform:translate(${pointerStartX}px,${pointerStartY}px)}31%{opacity:1;transform:translate(${pointerStartX}px,${pointerStartY}px)}` +
		`38%{opacity:1;transform:translate(${handX}px,${handY}px) scale(1)}40%{opacity:1;transform:translate(${handX}px,${handY}px) scale(.88)}` +
		`42%{opacity:1;transform:translate(${handX}px,${handY}px) scale(1)}47%,100%{opacity:0;transform:translate(${handX}px,${handY}px)}}` +
		`@media (prefers-reduced-motion:reduce){.a{animation:none}}`;

	return svgDoc(
		W,
		H,
		"Pressing Mute on the Stream Deck lights the key and unmutes Teams; raising your hand in Teams lights the hand key; pressing Share lights the Share key",
		`<defs>${DEVICE_DEFS}</defs><style>${css}</style>${card(W, H)}` +
			`<g transform="translate(${deviceX} ${deviceY}) scale(${deviceScale})">${device(keyAt, ids, keyClass)}</g>` +
			`<g transform="translate(${toolbarX} ${toolbarY}) scale(${toolbarScale})">${frames}</g>${pointer}`,
	);
}

/** Every generated SVG, by file name under docs/art/. */
export function buildArt(): Record<string, string> {
	return {
		"hero.svg": heroSvg(),
		"keys.svg": keysSvg(),
		"keys-compact.svg": keysCompactSvg(),
		"icon.svg": markSvg(),
		"social.svg": socialSvg(),
		"demo.svg": demoSvg(),
	};
}

export const PNG_RENDERS = [
	{ name: "social.png", source: "social.svg", width: 1280, height: 640, fit: false },
	{ name: "icon-32.png", source: "icon.svg", width: 32, height: 32, fit: true },
	{ name: "apple-touch-icon.png", source: "icon.svg", width: 180, height: 180, fit: true },
] as const satisfies readonly {
	name: string;
	source: keyof ReturnType<typeof buildArt>;
	width: number;
	height: number;
	fit: boolean;
}[];

const sha256 = (markup: string) => createHash("sha256").update(markup).digest("hex");

function renderUrl(out: string, target: (typeof PNG_RENDERS)[number]): string {
	if (!target.fit) return pathToFileURL(out + target.source).href;
	const tmp = mkdtempSync(join(tmpdir(), "tally-art-"));
	const html = join(tmp, "render.html");
	writeFileSync(
		html,
		`<!doctype html><meta charset="utf-8"><style>html,body{width:${target.width}px;height:${target.height}px;margin:0;overflow:hidden;background:transparent}img{display:block;width:${target.width}px;height:${target.height}px}</style><img src="${pathToFileURL(out + target.source).href}" alt="">`,
	);
	return pathToFileURL(html).href;
}

function renderPng(out: string, target: (typeof PNG_RENDERS)[number], sourceMarkup: string): void {
	const sourcePath = out + `${target.name}.source`;
	const sourceHash = sha256(sourceMarkup);
	const chrome = process.env.CHROME ?? DEFAULT_CHROME;

	if (!existsSync(chrome)) {
		const currentHash = existsSync(sourcePath) ? readFileSync(sourcePath, "utf8").trim() : "";
		if (currentHash === sourceHash) {
			console.warn(`${target.name} unchanged; Chrome not found at ${chrome}. Skipping PNG render.`);
			return;
		}
		console.error(
			`${target.name} is stale, but Chrome was not found at ${chrome}.\n` +
				`Install Google Chrome there or set CHROME=/path/to/chrome, then run npm run art.`,
		);
		process.exit(1);
	}

	const url = renderUrl(out, target);
	try {
		execFileSync(
			chrome,
			[
				"--headless=new",
				"--disable-gpu",
				"--hide-scrollbars",
				"--default-background-color=00000000",
				"--force-device-scale-factor=1",
				`--window-size=${target.width},${target.height}`,
				`--screenshot=${out}${target.name}`,
				url,
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
	} catch (error) {
		const stderr = error instanceof Error && "stderr" in error && Buffer.isBuffer(error.stderr) ? error.stderr.toString().trim() : "";
		console.error(`Failed to render docs/art/${target.name} with Chrome.${stderr ? `\n${stderr}` : ""}`);
		process.exit(1);
	} finally {
		if (target.fit) rmSync(fileURLToPath(new URL(".", url)), { recursive: true, force: true });
	}
	writeFileSync(sourcePath, `${sourceHash}\n`);
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const out = fileURLToPath(new URL("../docs/art/", import.meta.url));
	mkdirSync(out, { recursive: true });
	const art = buildArt();
	for (const [name, markup] of Object.entries(art)) writeFileSync(out + name, markup);
	for (const target of PNG_RENDERS) renderPng(out, target, art[target.source]);
	console.log(`art: ${[...Object.keys(art), ...PNG_RENDERS.map(({ name }) => name)].join(", ")}`);
}

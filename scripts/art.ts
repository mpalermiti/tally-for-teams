/**
 * Renders the README and site art from the plugin's own key renderer, so pictures of keys always
 * match the real thing:
 *   docs/art/hero.svg    a Stream Deck MK.2 mid-meeting
 *   docs/art/demo.svg    animated: press Mute, raise a hand in Teams, press Share
 *   docs/art/keys.svg    the seven keys, labelled
 *   docs/art/icon.svg    favicon (the plugin mark)
 *   docs/art/social.svg  1280×640 link preview, also rendered to social.png
 * Run `npm run art` after changing the key design; test/art.test.ts fails if these are stale.
 */
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

/** A key with rounded corners and a hairline edge; `inner` may stack several faces. */
function keyCap(inner: string, ids: Ids): string {
	const clip = ids.next("c");
	return (
		`<clipPath id="${clip}"><rect width="${KEY}" height="${KEY}" rx="24"/></clipPath>` +
		`<g clip-path="url(#${clip})">${inner}</g>` +
		`<rect width="${KEY}" height="${KEY}" rx="24" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="2"/>`
	);
}

const DEVICE_DEFS =
	`<linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E2E33"/><stop offset="1" stop-color="#1C1C20"/></linearGradient>` +
	`<filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>`;

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

/** The seven keys in a row, lit as in a meeting, each labelled. For the site. */
export function keysSvg(): string {
	const ids = new Ids();
	const snapshot = inMeeting({ isMuted: false, isVideoOn: true, isHandRaised: true, isSharing: true });
	const keys: [Slot, string][] = [
		[{ kind: "mute" }, "Mute"],
		[{ kind: "camera" }, "Camera"],
		[{ kind: "hand" }, "Raise hand"],
		[{ kind: "share" }, "Share"],
		[{ kind: "chat" }, "Chat"],
		[{ kind: "react", reaction: "like" }, "React"],
		[{ kind: "leave" }, "Leave"],
	];
	const STEP = KEY + 56;
	const W = keys.length * KEY + (keys.length - 1) * 56;
	const H = KEY + 52;
	let body = "";
	keys.forEach(([slot, label], i) => {
		body +=
			`<g transform="translate(${i * STEP} 0)">${keyCap(face(slot, snapshot, ids), ids)}` +
			`<text x="${KEY / 2}" y="${KEY + 40}" text-anchor="middle" font-family="${FONT}" font-size="22" fill="${INK}">${label}</text></g>`;
	});
	return svgDoc(W, H, "The seven Tally keys: Mute, Camera, Raise hand, Share, Chat, React and Leave", body);
}

/** The 1280×640 link preview: name and one line beside the device. */
export function socialSvg(): string {
	const ids = new Ids();
	const snapshot = inMeeting({ isMuted: false, isVideoOn: true });
	const W = 1280;
	const H = 640;
	const scale = 0.6;
	const body = device((_, slot) => face(slot, snapshot, ids), ids);
	return svgDoc(
		W,
		H,
		"Tally for Teams",
		`<defs>${DEVICE_DEFS}</defs><rect width="${W}" height="${H}" fill="${PAPER}"/>` +
			`<text x="88" y="292" font-family="${FONT}" font-size="64" font-weight="700" fill="${INK}">Tally for Teams</text>` +
			`<text x="88" y="350" font-family="${FONT}" font-size="28" fill="${SOFT_INK}">Live Teams controls for Stream Deck on Mac.</text>` +
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
	const W = 1360;
	const H = 480;
	const scale = 0.56;
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

	const frames = beats.map((state, i) => `<g class="a t${i}" opacity="${i === 3 ? 1 : 0}">${toolbar(state)}</g>`).join("");
	const pointer =
		`<g class="a pointer" opacity="0"><path d="M0 0 L0 30 L8 23 L13 34 L18 32 L13 21 L23 21 Z" fill="${INK}" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/></g>`;

	const toolbarX = 700;
	const toolbarY = (H - 120) / 2;
	const handX = toolbarX + 24 + 2 * 108 + 40;
	const handY = toolbarY + 18 + 30;
	const css =
		`.a{animation-duration:10s;animation-iteration-count:infinite;animation-timing-function:ease-in-out}` +
		`.dip{transform-box:fill-box;transform-origin:center}` +
		`.mute-on{animation-name:muteOn}.hand-on{animation-name:handOn}.share-on{animation-name:shareOn}` +
		`.mute-dip{animation-name:muteDip}.share-dip{animation-name:shareDip}` +
		`.t0{animation-name:t0}.t1{animation-name:t1}.t2{animation-name:t2}.t3{animation-name:t3}.pointer{animation-name:pointer}` +
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
		keyframes("t0", "opacity", [
			[0, "1"],
			[11, "1"],
			[14, "0"],
			[89, "0"],
			[93, "1"],
			[100, "1"],
		]) +
		fadeWindow("t1", 11, 39) +
		keyframes("t2", "opacity", [
			[0, "0"],
			[39, "0"],
			[42, "1"],
			[59, "1"],
			[62, "0"],
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
		`@keyframes pointer{0%,28%{opacity:0;transform:translate(${W - 90}px,${H - 60}px)}31%{opacity:1;transform:translate(${W - 90}px,${H - 60}px)}` +
		`38%{opacity:1;transform:translate(${handX}px,${handY}px) scale(1)}40%{opacity:1;transform:translate(${handX}px,${handY}px) scale(.88)}` +
		`42%{opacity:1;transform:translate(${handX}px,${handY}px) scale(1)}47%,100%{opacity:0;transform:translate(${handX}px,${handY}px)}}` +
		`@media (prefers-reduced-motion:reduce){.a{animation:none}}`;

	return svgDoc(
		W,
		H,
		"Pressing Mute on the Stream Deck lights the key and unmutes Teams; raising your hand in Teams lights the hand key; pressing Share lights the Share key",
		`<defs>${DEVICE_DEFS}</defs><style>${css}</style>${card(W, H)}` +
			`<g transform="translate(56 ${(H - DEVICE_H * scale) / 2}) scale(${scale})">${device(keyAt, ids, keyClass)}</g>` +
			`<g transform="translate(${toolbarX} ${toolbarY})">${frames}</g>${pointer}`,
	);
}

/** Every generated SVG, by file name under docs/art/. */
export function buildArt(): Record<string, string> {
	return { "hero.svg": heroSvg(), "keys.svg": keysSvg(), "icon.svg": markSvg(), "social.svg": socialSvg(), "demo.svg": demoSvg() };
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const out = fileURLToPath(new URL("../docs/art/", import.meta.url));
	mkdirSync(out, { recursive: true });
	const art = buildArt();
	for (const [name, markup] of Object.entries(art)) writeFileSync(out + name, markup);
	try {
		const { Resvg } = await import("@resvg/resvg-js");
		writeFileSync(out + "social.png", new Resvg(art["social.svg"], { font: { loadSystemFonts: true } }).render().asPng());
	} catch (error) {
		console.warn(`social.png not rendered (${(error as Error).message}). Render docs/art/social.svg to a 1280×640 PNG another way.`);
	}
	console.log(`art: ${Object.keys(art).join(", ")}`);
}

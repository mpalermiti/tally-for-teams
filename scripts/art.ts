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

/** Every generated SVG, by file name under docs/art/. */
export function buildArt(): Record<string, string> {
	return { "hero.svg": heroSvg(), "keys.svg": keysSvg(), "icon.svg": markSvg(), "social.svg": socialSvg() };
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

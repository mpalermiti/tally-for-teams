import type { Snapshot } from "../teams/client";
import { EMPTY_STATE, NO_PERMISSIONS, type Reaction } from "../teams/protocol";
import { GLYPHS, type GlyphName } from "./glyphs";

/**
 * Key design, in one rule: a LIT key means that thing is live.
 *
 *   offline  Teams unreachable (closed, or its API is off)      — glyph barely visible
 *   idle     connected, but not in a meeting / not allowed now  — glyph dim
 *   off      in a meeting, feature off (muted, camera off, …)   — glyph grey
 *   ready    in a meeting, one-shot action available            — glyph white
 *   on       in a meeting, feature live (mic hot, camera on, …) — warm lit key
 *   danger   leave, while in a meeting                          — red key
 */
export type Tone = "offline" | "idle" | "off" | "ready" | "on" | "danger";

export const KEY_KINDS = ["mute", "camera", "blur", "hand", "leave", "react", "chat", "share"] as const;
export type KeyKind = (typeof KEY_KINDS)[number];

export interface Visual {
	tone: Tone;
	glyph: GlyphName;
	/** Red dot: the meeting is being recorded. Shown only on mic and camera. */
	recording: boolean;
}

export const OFFLINE_SNAPSHOT: Snapshot = { online: false, state: EMPTY_STATE, permissions: NO_PERMISSIONS };

const REACTION_GLYPHS: Record<Reaction, GlyphName> = {
	like: "thumbs-up",
	love: "heart",
	applause: "party-popper",
	laugh: "laugh",
	wow: "wow",
};

/** Decides how a key should look for the current meeting. Pure, so it's tested without Stream Deck. */
export function visualFor(kind: KeyKind, snapshot: Snapshot, options: { reaction?: Reaction } = {}): Visual {
	const { online, state, permissions: can } = snapshot;
	const live = online && state.isInMeeting;
	const recording = live && state.isRecordingOn && (kind === "mute" || kind === "camera");

	// [glyph when on/neutral, glyph when off, available now?, currently on?]
	const spec: Record<KeyKind, [GlyphName, GlyphName, boolean, boolean | "action" | "danger"]> = {
		mute: ["mic", "mic-off", can.canToggleMute, !state.isMuted],
		camera: ["video", "video-off", can.canToggleVideo, state.isVideoOn],
		blur: ["blur", "blur", can.canToggleBlur, state.isBackgroundBlurred],
		hand: ["hand", "hand", can.canToggleHand, state.isHandRaised],
		leave: ["phone-off", "phone-off", can.canLeave, "danger"],
		react: [REACTION_GLYPHS[options.reaction ?? "like"], REACTION_GLYPHS[options.reaction ?? "like"], can.canReact, "action"],
		chat: [
			state.hasUnreadMessages ? "message-square-dot" : "message-square",
			"message-square",
			can.canToggleChat,
			state.hasUnreadMessages || "action",
		],
		// While sharing, the key stops sharing, so it stays usable even if the tray isn't.
		share: ["screen-share", "screen-share", can.canToggleShareTray || (state.isSharing && can.canStopSharing), state.isSharing || "action"],
	};

	const [onGlyph, offGlyph, available, current] = spec[kind];

	if (!online) return { tone: "offline", glyph: onGlyph, recording };
	if (!live || !available) return { tone: "idle", glyph: onGlyph, recording };
	if (current === "danger") return { tone: "danger", glyph: onGlyph, recording };
	if (current === "action") return { tone: "ready", glyph: onGlyph, recording };
	return current ? { tone: "on", glyph: onGlyph, recording } : { tone: "off", glyph: offGlyph, recording };
}

// ── Drawing ────────────────────────────────────────────────────────────────

const INK = {
	offline: { bg: "#0E0E10", glyph: "#3A3A42" },
	idle: { bg: "#111113", glyph: "#5C5C66" },
	off: { bg: "#18181B", glyph: "#8A8A94" },
	ready: { bg: "#18181B", glyph: "#EDEDF0" },
	on: { bg: "#F7B93E", glyph: "#1E1507" },
	danger: { bg: "#D83A31", glyph: "#FFFFFF" },
} as const;

/** Lit tones get a soft centre highlight so they read as glowing rather than flat paint. */
const GLOW: Partial<Record<Tone, [string, string]>> = {
	on: ["#FFD989", "#F2AE2E"],
	danger: ["#EC5A50", "#C9322A"],
};

const SIZE = 144;
const GLYPH_SIZE = 64;

function glyphGroup(glyph: GlyphName, color: string, x: number, y: number, size: number): string {
	const scale = size / 24;
	return (
		`<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" ` +
		`stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[glyph]}</g>`
	);
}

/** A 144×144 key face. Stream Deck scales it for smaller keys. */
export function keySvg(visual: Visual): string {
	const ink = INK[visual.tone];
	const glow = GLOW[visual.tone];
	const offset = (SIZE - GLYPH_SIZE) / 2;

	const background = glow
		? `<defs><radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="${glow[0]}"/><stop offset="1" stop-color="${glow[1]}"/></radialGradient></defs>` +
			`<rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>`
		: `<rect width="${SIZE}" height="${SIZE}" fill="${ink.bg}"/>`;

	// Ringed so it separates from the amber "on" background as well as the dark ones.
	const badge = visual.recording
		? `<circle data-badge="recording" cx="120" cy="24" r="9" fill="#FF3B30" stroke="${ink.bg}" stroke-width="3"/>`
		: "";

	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
		background +
		glyphGroup(visual.glyph, ink.glyph, offset, offset, GLYPH_SIZE) +
		badge +
		`</svg>`
	);
}

export function keyDataUrl(visual: Visual): string {
	return `data:image/svg+xml;base64,${Buffer.from(keySvg(visual)).toString("base64")}`;
}

/** A bare glyph on transparent — for action-list and category icons. */
export function glyphSvg(glyph: GlyphName, color: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${glyphGroup(glyph, color, 0, 0, 24)}</svg>`;
}

/** Plugin icon: a single lit key, rounded like the hardware. */
export function markSvg(): string {
	const [inner, outer] = GLOW.on!;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
		`<defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${inner}"/><stop offset="1" stop-color="${outer}"/></radialGradient></defs>` +
		`<rect x="16" y="16" width="224" height="224" rx="48" fill="url(#g)"/>` +
		glyphGroup("mic", INK.on.glyph, 72, 72, 112) +
		`</svg>`
	);
}

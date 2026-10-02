import type { Snapshot } from "../teams/protocol";
import { EMPTY_STATE, NO_PERMISSIONS, type OfflineReason, type Reaction } from "../teams/protocol";
import { GLYPHS, type GlyphName } from "./glyphs";

/**
 * Key design, in one rule: a LIT key means that thing is live.
 *
 *   offline  Teams unreachable (closed, or its API is off)      — glyph barely visible
 *   idle     connected, but not in a meeting / not allowed now  — glyph dim
 *   off      in a meeting, feature off (muted, camera off, …)   — glyph white
 *   ready    in a meeting, one-shot action available            — glyph white
 *   on       in a meeting, feature live (mic hot, camera on, …) — warm lit key
 *   danger   leave, while in a meeting                          — red key
 *
 * Every key you can press is drawn equally bright. Only the fill says what's live, and the
 * glyph (mic-off, video-off) says what's off. Brightness drops only when the key won't work.
 */
export type Tone = "offline" | "idle" | "off" | "ready" | "on" | "danger";

export const KEY_KINDS = ["mute", "camera", "hand", "leave", "react", "chat", "share", "timer", "people"] as const;
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
	const recording = live && state.isRecording && (kind === "mute" || kind === "camera");

	// [glyph when on/neutral, glyph when off, available now?, currently on?]
	const spec: Record<KeyKind, [GlyphName, GlyphName, boolean, boolean | "action" | "danger"]> = {
		mute: ["mic", "mic-off", can.canToggleMute, state.isMuteKnown ? !state.isMuted : "action"],
		camera: ["video", "video-off", can.canToggleVideo, state.isVideoKnown ? state.isVideoOn : "action"],
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
		share: [
			"screen-share",
			"screen-share",
			can.canToggleShareTray || (state.isSharing && can.canStopSharing),
			state.isSharingKnown ? state.isSharing || "action" : "action",
		],
		timer: ["timer", "timer", false, "action"],
		people: ["users", "users", can.canTogglePeople, "action"],
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
	off: { bg: "#18181B", glyph: "#EDEDF0" },
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

function background(tone: Tone, width: number, height: number): string {
	const glow = GLOW[tone];
	if (!glow) return `<rect width="${width}" height="${height}" fill="${INK[tone].bg}"/>`;
	return (
		`<defs><radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="${glow[0]}"/><stop offset="1" stop-color="${glow[1]}"/></radialGradient></defs>` +
		`<rect width="${width}" height="${height}" fill="url(#g)"/>`
	);
}

/** Red "being recorded" dot, ringed so it separates from amber and dark keys. */
function recordingBadge(visual: Visual, cx: number, cy: number): string {
	if (!visual.recording) return "";
	return `<circle data-badge="recording" cx="${cx}" cy="${cy}" r="9" fill="#FF3B30" stroke="${INK[visual.tone].bg}" stroke-width="3"/>`;
}

/** Temporary marks over a key: how far through a hold, or a one-word hint. */
export interface KeyOverlay {
	/** 0–1, drawn as a ring around the glyph. */
	progress?: number;
	/** A word under the glyph, e.g. "Hold". */
	hint?: string;
}

function progressRing(progress: number, color: string): string {
	const r = 62;
	const circumference = 2 * Math.PI * r;
	const centre = SIZE / 2;
	return (
		`<circle data-progress="${progress.toFixed(2)}" cx="${centre}" cy="${centre}" r="${r}" fill="none" stroke="${color}" ` +
		`stroke-width="6" stroke-linecap="round" stroke-dasharray="${(progress * circumference).toFixed(1)} ${circumference.toFixed(1)}" ` +
		`transform="rotate(-90 ${centre} ${centre})"/>`
	);
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function hintText(hint: string, color: string): string {
	return (
		`<text x="${SIZE / 2}" y="132" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" ` +
		`font-size="20" font-weight="600" fill="${color}">${escapeXml(hint)}</text>`
	);
}

function svg(width: number, height: number, body: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

const dataUrl = (markup: string) => `data:image/svg+xml;base64,${Buffer.from(markup).toString("base64")}`;

/** A 144×144 key face. Stream Deck scales it for smaller keys. */
export function keySvg(visual: Visual, overlay: KeyOverlay = {}): string {
	const offset = (SIZE - GLYPH_SIZE) / 2;
	const ink = INK[visual.tone].glyph;
	return svg(
		SIZE,
		SIZE,
		background(visual.tone, SIZE, SIZE) +
			glyphGroup(visual.glyph, ink, offset, offset, GLYPH_SIZE) +
			recordingBadge(visual, 120, 24) +
			(overlay.progress === undefined ? "" : progressRing(overlay.progress, ink)) +
			(overlay.hint ? hintText(overlay.hint, ink) : ""),
	);
}

export function keyDataUrl(visual: Visual, overlay?: KeyOverlay): string {
	return dataUrl(keySvg(visual, overlay));
}

export function formatTimerSeconds(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	const h = Math.floor(whole / 3600);
	const m = Math.floor((whole % 3600) / 60);
	const s = whole % 60;
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** A 144×144 custom face for the meeting timer key. */
export function timerFace(seconds: number | undefined, tone: Tone): string {
	const ink = INK[tone].glyph;
	const text = seconds === undefined ? "—" : formatTimerSeconds(seconds);
	const fontSize = text.length > 5 ? 32 : 40;
	return svg(
		SIZE,
		SIZE,
		background(tone, SIZE, SIZE) +
			glyphGroup("timer", ink, 18, 18, 28) +
			`<text x="${SIZE / 2}" y="88" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" ` +
			`font-size="${fontSize}" font-weight="700" font-variant-numeric="tabular-nums" fill="${ink}">${escapeXml(text)}</text>`,
	);
}

export function timerDataUrl(seconds: number | undefined, tone: Tone): string {
	return dataUrl(timerFace(seconds, tone));
}

// ── Stream Deck+ touch strip (mute dial) ───────────────────────────────────
//
// Each dial owns a 200×100 slice of the strip. The face (background, glyph,
// badge and overlays) is our SVG; the words are native text items from
// layouts/mute-dial.json, so they use Stream Deck's own font rendering.

/** Label and hint colours per tone; the hint sits one step quieter than the label. */
const TEXT: Record<Tone, { label: string; detail: string }> = {
	offline: { label: "#5C5C66", detail: "#3A3A42" },
	idle: { label: "#8A8A94", detail: "#5C5C66" },
	off: { label: "#EDEDF0", detail: "#8A8A94" },
	ready: { label: "#EDEDF0", detail: "#8A8A94" },
	on: { label: "#1E1507", detail: "#6B4A10" },
	danger: { label: "#FFFFFF", detail: "#FFD6D3" },
};

export interface DialFeedback {
	[key: string]: { value: string; color?: string } | string;
	face: string;
	label: { value: string; color: string };
	detail: { value: string; color: string };
}

const OFFLINE_TEXT: Record<OfflineReason, [string, string]> = {
	"no-permission": ["Allow", "Accessibility"],
	"teams-not-running": ["Teams", "Not running"],
	"teams-changed": ["Teams changed", "See README"],
	starting: ["Teams", "Connecting"],
};

/** Face and words for the mute dial's slice of the touch strip. */
export function muteDialFeedback(snapshot: Snapshot): DialFeedback {
	const visual = visualFor("mute", snapshot);
	const { state } = snapshot;

	const [label, detail] =
		snapshot.reason === "teams-changed" ? OFFLINE_TEXT["teams-changed"]
		: visual.tone === "offline" ? OFFLINE_TEXT[snapshot.reason ?? "starting"]
		: visual.tone === "idle" ? ["Mic", state.isInMeeting ? "Not available" : "No meeting"]
		: !state.isMuteKnown ? ["Mic", "Ready"]
		: visual.recording ? [state.isMuted ? "Muted" : "Live", "Recording"]
		: state.isMuted ? ["Muted", "Hold to talk"]
		: ["Live", "Hold to mute"];

	const face = svg(
		200,
		100,
		background(visual.tone, 200, 100) +
			glyphGroup(visual.glyph, INK[visual.tone].glyph, 22, 24, 52) +
			recordingBadge(visual, 182, 18),
	);

	return {
		face: dataUrl(face),
		label: { value: label, color: TEXT[visual.tone].label },
		detail: { value: detail, color: TEXT[visual.tone].detail },
	};
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

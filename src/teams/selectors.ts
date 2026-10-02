/**
 * Everything the plugin knows about Teams' on-screen controls, in one place.
 *
 * The bridge (bridge/TeamsBridge.swift) only finds controls by web id, reads their
 * labels and styles, and presses them. What those mean lives here, so when a Teams
 * update renames something, users can override this file's defaults without waiting
 * for a plugin update.
 *
 * Confirmed on Teams 26267 for Mac (2026-09-29) with probe/teams-ax-probe.swift:
 * toolbar and React-menu ids, the mute and camera labels, and pressing and reading
 * with Teams in the background. With probe/teams-ax-diff.swift: the "Stop sharing"
 * label and how a raised hand restyles React, both confirmed lighting their keys live.
 */

import {
	EMPTY_STATE,
	NO_PERMISSIONS,
	type ActionParameters,
	type Reaction,
	type Snapshot,
	type TeamsAction,
} from "./protocol";

export const TEAMS_BUNDLE_IDS = ["com.microsoft.teams2"];

type ButtonKey = "mute" | "camera" | "share" | "react" | "chat" | "leave";

export interface MenuItemSelector {
	id: string;
	labels: readonly string[];
}

export interface SelectorConfig {
	buttonIds: Record<ButtonKey, string>;
	plainIds: readonly string[];
	reactionItems: Record<Reaction, MenuItemSelector>;
	handItem: MenuItemSelector;
	meetingMarkerIds: readonly string[];
	labelPatterns: {
		mute: { muted: string; live: string };
		camera: { on: string; off: string };
		share: { sharing: string; notSharing: string };
		chat: { unreadPattern: string | null };
	};
}

export interface Selectors extends Omit<SelectorConfig, "labelPatterns"> {
	labelPatterns: {
		mute: { muted: RegExp; live: RegExp };
		camera: { on: RegExp; off: RegExp };
		share: { sharing: RegExp; notSharing: RegExp };
		chat: { unreadPattern: RegExp | null };
	};
}

export interface MergeSelectorsResult {
	selectors: Selectors;
	problems: string[];
}

/** Teams 26267 defaults. These are intentionally plain JSON-shaped values for user overrides. */
export const DEFAULT_SELECTORS = {
	buttonIds: {
		mute: "microphone-button",
		camera: "video-button",
		share: "share-button",
		react: "reaction-menu-button",
		chat: "chat-button",
		leave: "hangup-button",
	},
	plainIds: ["callingButtons-showMoreBtn", "roster-button", "chat-button"],
	reactionItems: {
		like: { id: "like-button", labels: ["like"] },
		love: { id: "heart-button", labels: ["love", "heart"] },
		applause: { id: "applause-button", labels: ["applause"] },
		laugh: { id: "laugh-button", labels: ["laugh"] },
		wow: { id: "surprised-button", labels: ["surprised", "wow"] },
	},
	handItem: { id: "raisehands-button", labels: ["raise", "lower"] },
	meetingMarkerIds: ["horizontalMiddleEnd", "horizontalEnd"],
	labelPatterns: {
		mute: { muted: "^unmute", live: "^mute" },
		camera: { on: "\\boff\\b", off: "\\bon\\b" },
		share: { sharing: "^stop", notSharing: "^share" },
		chat: { unreadPattern: null },
	},
} as const satisfies SelectorConfig;

export const DEFAULT_ACTIVE_SELECTORS = mergeSelectors(DEFAULT_SELECTORS).selectors;

/** Default exports kept for tests and scripts that refer to the current Teams facts directly. */
export const BUTTON_IDS = DEFAULT_SELECTORS.buttonIds;
export const PLAIN_IDS = DEFAULT_SELECTORS.plainIds;
export const ANCHOR_ID = BUTTON_IDS.mute;
export const WATCH_IDS = watchIds(DEFAULT_ACTIVE_SELECTORS);

export interface BridgeButton {
	label: string;
	enabled: boolean;
	/** The button's web classes. Only ever compared with other buttons', never interpreted. */
	style?: string;
}

export interface BridgeStatus {
	type: "status";
	trusted: boolean;
	running: boolean;
	buttons: Record<string, BridgeButton>;
	/** Web ids of meeting UI markers the bridge saw in the selected Teams window. */
	markers?: string[];
}

export type BridgeCommand =
	| { cmd: "press"; id: string }
	| { cmd: "menu"; id: string; itemIds: string[]; labels: readonly string[] };

export function mergeSelectors(defaults: SelectorConfig, override?: unknown): MergeSelectorsResult {
	const problems: string[] = [];
	const merged = mergeConfig(defaults, override, "selectors", problems) as SelectorConfig;
	return { selectors: compileSelectors(merged, defaults, problems), problems };
}

export function anchorId(selectors: Selectors = DEFAULT_ACTIVE_SELECTORS): string {
	return selectors.buttonIds.mute;
}

/** Every web id the bridge keeps an eye on. */
export function watchIds(selectors: Selectors = DEFAULT_ACTIVE_SELECTORS): string[] {
	return unique([...Object.values(selectors.buttonIds), selectors.handItem.id, ...selectors.plainIds]);
}

/** Every web id whose presence means Teams still has meeting UI even if the mic anchor moved. */
export function meetingMarkerIds(selectors: Selectors = DEFAULT_ACTIVE_SELECTORS): string[] {
	return unique([selectors.buttonIds.leave, ...selectors.meetingMarkerIds]);
}

/** Turns the bridge's raw button labels into the meeting model keys render from. */
export function snapshotFrom(status: BridgeStatus, selectors: Selectors = DEFAULT_ACTIVE_SELECTORS): Snapshot {
	if (!status.trusted) return { online: false, reason: "no-permission", state: EMPTY_STATE, permissions: NO_PERMISSIONS };
	if (!status.running) return { online: false, reason: "teams-not-running", state: EMPTY_STATE, permissions: NO_PERMISSIONS };

	const label = (id: string) => status.buttons[id]?.label;
	const usable = (id: string) => status.buttons[id] !== undefined && status.buttons[id].enabled;

	const mic = label(selectors.buttonIds.mute);
	if (mic === undefined && hasMeetingMarkers(status, selectors)) {
		return { online: true, reason: "teams-changed", state: EMPTY_STATE, permissions: NO_PERMISSIONS };
	}

	const camera = label(selectors.buttonIds.camera);
	const share = label(selectors.buttonIds.share);
	const chat = label(selectors.buttonIds.chat);
	const muted = matchKnown(mic, selectors.labelPatterns.mute.muted, selectors.labelPatterns.mute.live);
	const videoOn = matchKnown(camera, selectors.labelPatterns.camera.on, selectors.labelPatterns.camera.off);
	const sharing = matchKnown(share, selectors.labelPatterns.share.sharing, selectors.labelPatterns.share.notSharing);
	const unreadPattern = selectors.labelPatterns.chat.unreadPattern;

	return {
		online: true,
		state: {
			...EMPTY_STATE,
			isInMeeting: mic !== undefined,
			isMuteKnown: muted !== undefined,
			isMuted: muted ?? false,
			isVideoKnown: videoOn !== undefined,
			isVideoOn: videoOn ?? false,
			isHandRaised: handRaised(status, selectors),
			isSharingKnown: sharing !== undefined,
			isSharing: sharing ?? false,
			hasUnreadMessages: chat !== undefined && unreadPattern !== null && unreadPattern.test(chat),
		},
		permissions: {
			...NO_PERMISSIONS,
			canToggleMute: usable(selectors.buttonIds.mute),
			canToggleVideo: usable(selectors.buttonIds.camera),
			canLeave: usable(selectors.buttonIds.leave),
			canReact: usable(selectors.buttonIds.react),
			canToggleHand: usable(selectors.buttonIds.react) || usable(selectors.handItem.id),
			canToggleChat: usable(selectors.buttonIds.chat),
			canToggleShareTray: usable(selectors.buttonIds.share),
			canStopSharing: usable(selectors.buttonIds.share) && sharing === true,
		},
	};
}

/**
 * Teams keeps React's label while your hand is up and only says so in a hover tooltip, but it
 * restyles the button: at rest React looks exactly like the plain toolbar buttons, raised it
 * doesn't. The compact view restyles its own raise-hand button instead. Comparing with the
 * plain buttons avoids depending on Teams' generated class names, which change between builds.
 * Found on Teams 26267 with probe/teams-ax-diff.swift; confirmed lighting the key in a live meeting (2026-09-29).
 */
function handRaised(status: BridgeStatus, selectors: Selectors): boolean {
	const resting = restingStyle(status, selectors);
	const hand = status.buttons[selectors.handItem.id] ?? status.buttons[selectors.buttonIds.react];
	return resting !== undefined && hand?.style !== undefined && hand.style !== resting;
}

/** What most plain toolbar buttons look like right now; ties go to the first plain id. */
function restingStyle(status: BridgeStatus, selectors: Selectors): string | undefined {
	const styles = selectors.plainIds.map((id) => status.buttons[id]?.style).filter((s): s is string => s !== undefined);
	let best: string | undefined;
	let bestCount = 0;
	for (const style of styles) {
		const count = styles.filter((s) => s === style).length;
		if (count > bestCount) [best, bestCount] = [style, count];
	}
	return best;
}

/** What the bridge should do for a key's action. */
export function commandFor(
	action: TeamsAction,
	parameters: ActionParameters,
	selectors: Selectors = DEFAULT_ACTIVE_SELECTORS,
): BridgeCommand | { unsupported: string } {
	const type = "type" in parameters ? parameters.type : undefined;
	switch (action) {
		case "toggle-mute":
			return { cmd: "press", id: selectors.buttonIds.mute };
		case "toggle-video":
			return { cmd: "press", id: selectors.buttonIds.camera };
		case "leave-call":
			return { cmd: "press", id: selectors.buttonIds.leave };
		case "toggle-ui":
			return { cmd: "press", id: type === "chat" ? selectors.buttonIds.chat : selectors.buttonIds.share };
		case "stop-sharing":
			return { cmd: "press", id: selectors.buttonIds.share }; // While presenting, the share button reads "Stop sharing" and stops it (confirmed live).
		case "send-reaction": {
			const item = selectors.reactionItems[(type as Reaction) ?? "like"] ?? selectors.reactionItems.like;
			return { cmd: "menu", id: selectors.buttonIds.react, itemIds: [item.id], labels: item.labels };
		}
		case "toggle-hand":
			return { cmd: "menu", id: selectors.buttonIds.react, itemIds: [selectors.handItem.id], labels: selectors.handItem.labels };
		case "query-state":
			return { unsupported: "Not needed: the bridge reports state continuously" };
	}
}

function matchKnown(label: string | undefined, truePattern: RegExp, falsePattern: RegExp): boolean | undefined {
	if (label === undefined) return undefined;
	if (truePattern.test(label)) return true;
	if (falsePattern.test(label)) return false;
	return undefined;
}

function hasMeetingMarkers(status: BridgeStatus, selectors: Selectors): boolean {
	const knownMarkers = new Set(meetingMarkerIds(selectors));
	return (status.markers ?? []).some((id) => knownMarkers.has(id));
}

function compileSelectors(config: SelectorConfig, defaults: SelectorConfig, problems: string[]): Selectors {
	return {
		buttonIds: config.buttonIds,
		plainIds: config.plainIds,
		reactionItems: config.reactionItems,
		handItem: config.handItem,
		meetingMarkerIds: config.meetingMarkerIds,
		labelPatterns: {
			mute: {
				muted: compilePattern(config.labelPatterns.mute.muted, defaults.labelPatterns.mute.muted, "labelPatterns.mute.muted", problems),
				live: compilePattern(config.labelPatterns.mute.live, defaults.labelPatterns.mute.live, "labelPatterns.mute.live", problems),
			},
			camera: {
				on: compilePattern(config.labelPatterns.camera.on, defaults.labelPatterns.camera.on, "labelPatterns.camera.on", problems),
				off: compilePattern(config.labelPatterns.camera.off, defaults.labelPatterns.camera.off, "labelPatterns.camera.off", problems),
			},
			share: {
				sharing: compilePattern(config.labelPatterns.share.sharing, defaults.labelPatterns.share.sharing, "labelPatterns.share.sharing", problems),
				notSharing: compilePattern(
					config.labelPatterns.share.notSharing,
					defaults.labelPatterns.share.notSharing,
					"labelPatterns.share.notSharing",
					problems,
				),
			},
			chat: {
				unreadPattern: compileOptionalPattern(
					config.labelPatterns.chat.unreadPattern,
					defaults.labelPatterns.chat.unreadPattern,
					"labelPatterns.chat.unreadPattern",
					problems,
				),
			},
		},
	};
}

function compilePattern(source: string, fallback: string, path: string, problems: string[]): RegExp {
	try {
		return new RegExp(source, "i");
	} catch (error) {
		problems.push(`${path}: invalid regex ${(error as Error).message}; using default`);
		return new RegExp(fallback, "i");
	}
}

function compileOptionalPattern(source: string | null, fallback: string | null, path: string, problems: string[]): RegExp | null {
	if (source === null) return null;
	try {
		return new RegExp(source, "i");
	} catch (error) {
		problems.push(`${path}: invalid regex ${(error as Error).message}; using default`);
		return fallback === null ? null : new RegExp(fallback, "i");
	}
}

function mergeConfig(defaultValue: unknown, overrideValue: unknown, path: string, problems: string[]): unknown {
	if (overrideValue === undefined) return clone(defaultValue);
	if (Array.isArray(defaultValue)) {
		if (Array.isArray(overrideValue) && overrideValue.every((value) => typeof value === "string")) return [...overrideValue];
		problems.push(`${path}: expected an array of strings; using default`);
		return clone(defaultValue);
	}
	if (defaultValue === null) {
		if (typeof overrideValue === "string" || overrideValue === null) return overrideValue;
		problems.push(`${path}: expected a regex string or null; using default`);
		return defaultValue;
	}
	if (typeof defaultValue === "string") {
		if (typeof overrideValue === "string") return overrideValue;
		problems.push(`${path}: expected a string; using default`);
		return defaultValue;
	}
	if (isRecord(defaultValue)) {
		if (!isRecord(overrideValue)) {
			problems.push(`${path}: expected an object; using default`);
			return clone(defaultValue);
		}
		return Object.fromEntries(
			Object.entries(defaultValue).map(([key, value]) => [key, mergeConfig(value, overrideValue[key], `${path}.${key}`, problems)]),
		);
	}
	return clone(defaultValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

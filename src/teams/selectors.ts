/**
 * Everything the plugin knows about Teams' on-screen controls, in one place.
 *
 * The bridge (bridge/TeamsBridge.swift) only finds buttons by web id, reads their
 * labels and styles, and presses them. What those mean lives here, so when a Teams
 * update renames something, this file is the fix.
 *
 * Confirmed on Teams 26267 for Mac (2026-09-29) with probe/teams-ax-probe.swift:
 * toolbar and React-menu ids, the mute and camera labels, and pressing and reading
 * with Teams in the background. With probe/teams-ax-diff.swift: the "Stop sharing"
 * label and how a raised hand restyles React, both confirmed lighting their keys live.
 * Marked UNVERIFIED below: guesses awaiting a probe run.
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

/** Web ids of the meeting toolbar buttons. */
export const BUTTON_IDS = {
	mute: "microphone-button",
	camera: "video-button",
	share: "share-button",
	react: "reaction-menu-button",
	chat: "chat-button",
	leave: "hangup-button",
} as const;

/** The button whose presence means "in a meeting"; the bridge rescans when it disappears. */
export const ANCHOR_ID = BUTTON_IDS.mute;

/**
 * Toolbar buttons that almost always sit in their resting style. What most of them look like
 * is the baseline a raised hand is compared with (see `handRaised`).
 */
export const PLAIN_IDS = ["callingButtons-showMoreBtn", "roster-button", BUTTON_IDS.chat] as const;

/**
 * React-menu items, confirmed on Teams 26267 with `probe --menus`: ids like-button,
 * heart-button, applause-button, laugh-button, surprised-button, raisehands-button
 * (labels Like, Love, Applause, Laugh, Surprised, Raise). Ids are matched first; the
 * labels are a fallback in case a Teams update renames the ids.
 */
const REACTION_ITEMS: Record<Reaction, { id: string; labels: string[] }> = {
	like: { id: "like-button", labels: ["like"] },
	love: { id: "heart-button", labels: ["love", "heart"] },
	applause: { id: "applause-button", labels: ["applause"] },
	laugh: { id: "laugh-button", labels: ["laugh"] },
	wow: { id: "surprised-button", labels: ["surprised", "wow"] },
};
/**
 * Raise hand is in the React menu, and also on the toolbar itself in the compact meeting view.
 * Its label stays "Raise" while your hand is up (confirmed on Teams 26267).
 */
const HAND_ITEM = { id: "raisehands-button", labels: ["raise", "lower"] };

/** Every web id the bridge keeps an eye on. */
export const WATCH_IDS = [...new Set<string>([...Object.values(BUTTON_IDS), HAND_ITEM.id, ...PLAIN_IDS])];

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
}

export type BridgeCommand =
	| { cmd: "press"; id: string }
	| { cmd: "menu"; id: string; itemIds: string[]; labels: string[] };

/** Turns the bridge's raw button labels into the meeting model keys render from. */
export function snapshotFrom(status: BridgeStatus): Snapshot {
	if (!status.trusted) return { online: false, reason: "no-permission", state: EMPTY_STATE, permissions: NO_PERMISSIONS };
	if (!status.running) return { online: false, reason: "teams-not-running", state: EMPTY_STATE, permissions: NO_PERMISSIONS };

	const label = (id: string) => status.buttons[id]?.label.toLowerCase();
	const usable = (id: string) => status.buttons[id] !== undefined && status.buttons[id].enabled;

	const mic = label(BUTTON_IDS.mute);
	const camera = label(BUTTON_IDS.camera);
	const share = label(BUTTON_IDS.share);
	const chat = label(BUTTON_IDS.chat);
	// "Stop sharing" is shown while presenting (confirmed on Teams 26267).
	const sharing = share?.startsWith("stop") ?? false;

	return {
		online: true,
		state: {
			...EMPTY_STATE,
			isInMeeting: mic !== undefined,
			// "Unmute mic" is shown while muted; "Mute mic" while live.
			isMuted: mic?.startsWith("unmute") ?? false,
			// "Turn camera off" is shown while the camera is on.
			isVideoOn: camera?.includes("off") ?? false,
			isHandRaised: handRaised(status),
			isSharing: sharing,
			hasUnreadMessages: chat ? /unread|new message/.test(chat) : false, // UNVERIFIED
		},
		permissions: {
			...NO_PERMISSIONS,
			canToggleMute: usable(BUTTON_IDS.mute),
			canToggleVideo: usable(BUTTON_IDS.camera),
			canLeave: usable(BUTTON_IDS.leave),
			canReact: usable(BUTTON_IDS.react),
			canToggleHand: usable(BUTTON_IDS.react) || usable(HAND_ITEM.id),
			canToggleChat: usable(BUTTON_IDS.chat),
			canToggleShareTray: usable(BUTTON_IDS.share),
			canStopSharing: usable(BUTTON_IDS.share) && sharing,
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
function handRaised(status: BridgeStatus): boolean {
	const resting = restingStyle(status);
	const hand = status.buttons[HAND_ITEM.id] ?? status.buttons[BUTTON_IDS.react];
	return resting !== undefined && hand?.style !== undefined && hand.style !== resting;
}

/** What most plain toolbar buttons look like right now; ties go to the first in PLAIN_IDS. */
function restingStyle(status: BridgeStatus): string | undefined {
	const styles = PLAIN_IDS.map((id) => status.buttons[id]?.style).filter((s): s is string => s !== undefined);
	let best: string | undefined;
	let bestCount = 0;
	for (const style of styles) {
		const count = styles.filter((s) => s === style).length;
		if (count > bestCount) [best, bestCount] = [style, count];
	}
	return best;
}

/** What the bridge should do for a key's action. */
export function commandFor(action: TeamsAction, parameters: ActionParameters): BridgeCommand | { unsupported: string } {
	const type = "type" in parameters ? parameters.type : undefined;
	switch (action) {
		case "toggle-mute":
			return { cmd: "press", id: BUTTON_IDS.mute };
		case "toggle-video":
			return { cmd: "press", id: BUTTON_IDS.camera };
		case "leave-call":
			return { cmd: "press", id: BUTTON_IDS.leave };
		case "toggle-ui":
			return { cmd: "press", id: type === "chat" ? BUTTON_IDS.chat : BUTTON_IDS.share };
		case "stop-sharing":
			return { cmd: "press", id: BUTTON_IDS.share }; // While presenting, the share button reads "Stop sharing" and stops it (confirmed live).
		case "send-reaction": {
			const item = REACTION_ITEMS[(type as Reaction) ?? "like"] ?? REACTION_ITEMS.like;
			return { cmd: "menu", id: BUTTON_IDS.react, itemIds: [item.id], labels: item.labels };
		}
		case "toggle-hand":
			return { cmd: "menu", id: BUTTON_IDS.react, itemIds: [HAND_ITEM.id], labels: HAND_ITEM.labels };
		case "query-state":
			return { unsupported: "Not needed: the bridge reports state continuously" };
	}
}

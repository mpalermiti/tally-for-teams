/**
 * Everything the plugin knows about Teams' on-screen controls, in one place.
 *
 * The bridge (bridge/TeamsBridge.swift) only finds buttons by web id, reads their
 * labels and presses them. What those buttons mean lives here, so when a Teams
 * update renames something, this file is the fix.
 *
 * Confirmed on Teams 26267 for Mac (2026-09-29) with probe/teams-ax-probe.swift:
 * toolbar and React-menu ids, the mute and camera labels, and pressing and reading
 * with Teams in the background.
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
/** Raise hand is in the React menu. Its label is "Raise"; "Lower" while raised is expected but unverified. */
const HAND_ITEM = { id: "raisehands-button", labels: ["raise", "lower"] };

export interface BridgeButton {
	label: string;
	enabled: boolean;
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
	const sharing = share?.startsWith("stop") ?? false; // UNVERIFIED: label while presenting

	return {
		online: true,
		state: {
			...EMPTY_STATE,
			isInMeeting: mic !== undefined,
			// "Unmute mic" is shown while muted; "Mute mic" while live.
			isMuted: mic?.startsWith("unmute") ?? false,
			// "Turn camera off" is shown while the camera is on.
			isVideoOn: camera?.includes("off") ?? false,
			isSharing: sharing,
			hasUnreadMessages: chat ? /unread|new message/.test(chat) : false, // UNVERIFIED
		},
		permissions: {
			...NO_PERMISSIONS,
			canToggleMute: usable(BUTTON_IDS.mute),
			canToggleVideo: usable(BUTTON_IDS.camera),
			canLeave: usable(BUTTON_IDS.leave),
			canReact: usable(BUTTON_IDS.react),
			canToggleHand: usable(BUTTON_IDS.react),
			canToggleChat: usable(BUTTON_IDS.chat),
			canToggleShareTray: usable(BUTTON_IDS.share),
			canStopSharing: usable(BUTTON_IDS.share) && sharing,
		},
	};
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
			return { cmd: "press", id: BUTTON_IDS.share }; // UNVERIFIED: the share button stops sharing while presenting
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

/**
 * Everything the plugin knows about Teams' on-screen controls, in one place.
 *
 * The bridge (bridge/TeamsBridge.swift) only finds buttons by web id, reads their
 * labels and presses them. What those buttons mean lives here, so when a Teams
 * update renames something, this file is the fix.
 *
 * Confirmed on Teams 26267 for Mac (2026-09-29) with probe/teams-ax-probe.swift:
 * button ids, the mute and camera labels, and pressing with Teams in the background.
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
 * Words to look for in the React menu. Matched case-insensitively against items that
 * appear when the menu opens. UNVERIFIED: exact item labels.
 */
const REACTION_LABELS: Record<Reaction, string[]> = {
	like: ["like"],
	love: ["heart", "love"],
	applause: ["applause", "clap"],
	laugh: ["laugh"],
	wow: ["surprised", "wow"],
};
/** UNVERIFIED: raise hand is believed to sit in the React menu as "Raise hand" / "Lower hand". */
const HAND_LABELS = ["raise", "lower"];

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

export type BridgeCommand = { cmd: "press"; id: string } | { cmd: "menu"; id: string; labels: string[] };

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
		case "send-reaction":
			return { cmd: "menu", id: BUTTON_IDS.react, labels: REACTION_LABELS[(type as Reaction) ?? "like"] ?? ["like"] };
		case "toggle-hand":
			return { cmd: "menu", id: BUTTON_IDS.react, labels: HAND_LABELS };
		case "toggle-background-blur":
			return { unsupported: "Background blur isn't supported yet" };
		case "query-state":
			return { unsupported: "Not needed: the bridge reports state continuously" };
	}
}

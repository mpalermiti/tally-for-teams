/**
 * The plugin's model of a Teams meeting. Originally the wire types of Teams' local
 * API (retired 2026-06-30); now filled in from Accessibility by src/teams/selectors.ts.
 * Keys and the dial render from these types only.
 */

/** Actions a key can ask for. */
export type TeamsAction =
	| "toggle-mute"
	| "toggle-video"
	| "toggle-background-blur"
	| "toggle-hand"
	| "leave-call"
	| "send-reaction"
	| "toggle-ui"
	| "stop-sharing"
	| "query-state";

export type Reaction = "like" | "love" | "applause" | "laugh" | "wow";
export const REACTIONS: readonly Reaction[] = ["like", "love", "applause", "laugh", "wow"];

/** `toggle-ui` targets. */
export type UiTarget = "chat" | "sharing-tray";

export type ActionParameters = { type: Reaction | UiTarget } | Record<string, never>;

/** Why keys are dimmed while offline; shown in words on the Stream Deck+ dial. */
export type OfflineReason = "no-permission" | "teams-not-running" | "starting";

/** What every key renders from. Replaced (never mutated) on each change. */
export interface Snapshot {
	/** True while Teams is running and readable. */
	online: boolean;
	reason?: OfflineReason;
	state: MeetingState;
	permissions: MeetingPermissions;
}

export interface RequestResult {
	ok: boolean;
	message: string;
}

export interface MeetingState {
	isMuted: boolean;
	isVideoOn: boolean;
	isHandRaised: boolean;
	isInMeeting: boolean;
	isRecordingOn: boolean;
	isBackgroundBlurred: boolean;
	isSharing: boolean;
	hasUnreadMessages: boolean;
}

export interface MeetingPermissions {
	canToggleMute: boolean;
	canToggleVideo: boolean;
	canToggleHand: boolean;
	canToggleBlur: boolean;
	canLeave: boolean;
	canReact: boolean;
	canToggleShareTray: boolean;
	canToggleChat: boolean;
	canStopSharing: boolean;
	canPair: boolean;
}

export const EMPTY_STATE: MeetingState = {
	isMuted: false,
	isVideoOn: false,
	isHandRaised: false,
	isInMeeting: false,
	isRecordingOn: false,
	isBackgroundBlurred: false,
	isSharing: false,
	hasUnreadMessages: false,
};

export const NO_PERMISSIONS: MeetingPermissions = {
	canToggleMute: false,
	canToggleVideo: false,
	canToggleHand: false,
	canToggleBlur: false,
	canLeave: false,
	canReact: false,
	canToggleShareTray: false,
	canToggleChat: false,
	canStopSharing: false,
	canPair: false,
};

/**
 * Wire types for the Microsoft Teams "third-party app API" — the local WebSocket
 * that new Teams exposes at ws://127.0.0.1:8124 when Settings → Privacy →
 * Third-party app API is enabled. Protocol version 2.0.0.
 */

export const TEAMS_PORT = 8124;
export const PROTOCOL_VERSION = "2.0.0";

/** Actions the plugin sends. Teams also accepts explicit mute/unmute etc., but toggles are all we need. */
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

/** `toggle-ui` targets. Note the tray is "sharing-tray", not "share-tray". */
export type UiTarget = "chat" | "sharing-tray";

export type ActionParameters = { type: Reaction | UiTarget } | Record<string, never>;

export interface ClientMessage {
	action: TeamsAction;
	parameters: ActionParameters;
	requestId: number;
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

/** Everything Teams can send us. Exactly one of these fields is normally present. */
export interface ServerMessage {
	requestId?: number;
	response?: string;
	errorMsg?: string;
	tokenRefresh?: string;
	meetingUpdate?: {
		meetingState?: Partial<MeetingState>;
		meetingPermissions?: Partial<MeetingPermissions>;
	};
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

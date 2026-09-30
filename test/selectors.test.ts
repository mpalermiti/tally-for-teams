import { describe, expect, it } from "vitest";

import { BUTTON_IDS, commandFor, snapshotFrom, type BridgeStatus } from "../src/teams/selectors";

/** A status as the bridge reports it, using the labels seen on Teams 26267 for Mac. */
function status(buttons: Record<string, string>, extra: Partial<BridgeStatus> = {}): BridgeStatus {
	return {
		type: "status",
		trusted: true,
		running: true,
		buttons: Object.fromEntries(Object.entries(buttons).map(([id, label]) => [id, { label, enabled: true }])),
		...extra,
	};
}

const toolbar = {
	"microphone-button": "Unmute mic",
	"video-button": "Turn camera on",
	"share-button": "Share",
	"reaction-menu-button": "React",
	"chat-button": "Chat",
	"hangup-button": "Leave",
};

describe("snapshotFrom", () => {
	it("reads mute and camera state from the button labels", () => {
		const muted = snapshotFrom(status(toolbar));
		expect(muted.online).toBe(true);
		expect(muted.state).toMatchObject({ isInMeeting: true, isMuted: true, isVideoOn: false });

		const live = snapshotFrom(status({ ...toolbar, "microphone-button": "Mute mic", "video-button": "Turn camera off" }));
		expect(live.state).toMatchObject({ isMuted: false, isVideoOn: true });
	});

	it("allows exactly the controls that are on screen", () => {
		const { permissions } = snapshotFrom(status(toolbar));
		expect(permissions).toMatchObject({
			canToggleMute: true,
			canToggleVideo: true,
			canLeave: true,
			canReact: true,
			canToggleHand: true, // raise hand lives in the React menu
			canToggleChat: true,
			canToggleShareTray: true,
		});

		const narrow = snapshotFrom(status({ "microphone-button": "Mute mic", "hangup-button": "Leave" }));
		expect(narrow.permissions.canToggleVideo).toBe(false);
		expect(narrow.permissions.canReact).toBe(false);
	});

	it("treats a disabled button as unavailable", () => {
		const s = status(toolbar);
		s.buttons["microphone-button"].enabled = false;
		expect(snapshotFrom(s).permissions.canToggleMute).toBe(false);
	});

	it("is not in a meeting when the mic button is gone", () => {
		const s = snapshotFrom(status({}));
		expect(s.online).toBe(true);
		expect(s.state.isInMeeting).toBe(false);
	});

	it("goes offline with a reason when Teams can't be read", () => {
		expect(snapshotFrom(status({}, { trusted: false }))).toMatchObject({ online: false, reason: "no-permission" });
		expect(snapshotFrom(status({}, { running: false }))).toMatchObject({ online: false, reason: "teams-not-running" });
	});
});

describe("raised hand and sharing", () => {
	// Class lists as Teams 26267 reports them (trimmed). Plain toolbar buttons all share one;
	// a raised hand restyles React, or the compact view's own raise-hand button.
	const PLAIN = "fui-Button r1f29ykk ___b5pqyf0 ftsixi f1wf6e08";
	const LIT = "fui-Button r1f29ykk ___1js7tsg ftsixi f1pikq0";
	const COMPACT_PLAIN = "fui-Button r1f29ykk ___1ne3p97 ftsixi f1wf6e08";
	const COMPACT_LIT = "fui-Button r1f29ykk ___969umn0 ffp7eso f1phragk";

	function styled(buttons: Record<string, [label: string, style?: string]>): BridgeStatus {
		return {
			type: "status",
			trusted: true,
			running: true,
			buttons: Object.fromEntries(Object.entries(buttons).map(([id, [label, style]]) => [id, { label, enabled: true, style }])),
		};
	}
	const fullToolbar = (react: string, chat = PLAIN) =>
		styled({
			"microphone-button": ["Mute mic", LIT],
			"reaction-menu-button": ["React", react],
			"roster-button": ["People", PLAIN],
			"callingButtons-showMoreBtn": ["More", PLAIN],
			"chat-button": ["Chat", chat],
			"share-button": ["Share", PLAIN],
		});

	it("reads a raised hand from React looking different from the plain toolbar buttons", () => {
		expect(snapshotFrom(fullToolbar(LIT)).state.isHandRaised).toBe(true);
		expect(snapshotFrom(fullToolbar(PLAIN)).state.isHandRaised).toBe(false);
	});

	it("goes by what most plain buttons look like, so one open pane isn't a raised hand", () => {
		expect(snapshotFrom(fullToolbar(PLAIN, LIT)).state.isHandRaised).toBe(false);
	});

	it("reads the compact view's own raise-hand button", () => {
		const compact = (hand: string) =>
			styled({
				"microphone-button": ["Mute mic", COMPACT_PLAIN],
				"reaction-menu-button": ["React", COMPACT_PLAIN],
				"roster-button": ["People", COMPACT_PLAIN],
				"raisehands-button": ["Raise", hand],
			});
		expect(snapshotFrom(compact(COMPACT_LIT)).state.isHandRaised).toBe(true);
		expect(snapshotFrom(compact(COMPACT_PLAIN)).state.isHandRaised).toBe(false);
		expect(snapshotFrom(compact(COMPACT_PLAIN)).permissions.canToggleHand).toBe(true);
	});

	it("doesn't guess when there's nothing plain to compare with", () => {
		const bare = styled({ "microphone-button": ["Mute mic", LIT], "reaction-menu-button": ["React", LIT] });
		expect(snapshotFrom(bare).state.isHandRaised).toBe(false);
		expect(snapshotFrom(status(toolbar)).state.isHandRaised).toBe(false);
	});

	it("is sharing while the share button says Stop sharing", () => {
		const sharing = snapshotFrom(status({ ...toolbar, "share-button": "Stop sharing" }));
		expect(sharing.state.isSharing).toBe(true);
		expect(sharing.permissions.canStopSharing).toBe(true);
		expect(snapshotFrom(status(toolbar)).state.isSharing).toBe(false);
	});
});

describe("commandFor", () => {
	it("presses the matching toolbar button", () => {
		expect(commandFor("toggle-mute", {})).toEqual({ cmd: "press", id: BUTTON_IDS.mute });
		expect(commandFor("toggle-video", {})).toEqual({ cmd: "press", id: BUTTON_IDS.camera });
		expect(commandFor("leave-call", {})).toEqual({ cmd: "press", id: BUTTON_IDS.leave });
		expect(commandFor("toggle-ui", { type: "chat" })).toEqual({ cmd: "press", id: BUTTON_IDS.chat });
		expect(commandFor("toggle-ui", { type: "sharing-tray" })).toEqual({ cmd: "press", id: BUTTON_IDS.share });
	});

	it("sends reactions and raises hands by pressing React-menu items by id", () => {
		expect(commandFor("send-reaction", { type: "love" })).toMatchObject({
			cmd: "menu",
			id: BUTTON_IDS.react,
			itemIds: ["heart-button"],
		});
		expect(commandFor("send-reaction", { type: "wow" })).toMatchObject({ itemIds: ["surprised-button"] });
		expect(commandFor("send-reaction", {})).toMatchObject({ itemIds: ["like-button"] });
		expect(commandFor("toggle-hand", {})).toMatchObject({ cmd: "menu", id: BUTTON_IDS.react, itemIds: ["raisehands-button"] });
	});

	it("keeps label fallbacks in case Teams renames the item ids", () => {
		const love = commandFor("send-reaction", { type: "love" });
		expect("labels" in love && love.labels).toContain("love");
	});

	it("reports what isn't supported instead of guessing", () => {
		expect(commandFor("query-state", {})).toMatchObject({ unsupported: expect.any(String) });
	});
});

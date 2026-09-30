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
			canToggleBlur: false, // not supported yet
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

describe("commandFor", () => {
	it("presses the matching toolbar button", () => {
		expect(commandFor("toggle-mute", {})).toEqual({ cmd: "press", id: BUTTON_IDS.mute });
		expect(commandFor("toggle-video", {})).toEqual({ cmd: "press", id: BUTTON_IDS.camera });
		expect(commandFor("leave-call", {})).toEqual({ cmd: "press", id: BUTTON_IDS.leave });
		expect(commandFor("toggle-ui", { type: "chat" })).toEqual({ cmd: "press", id: BUTTON_IDS.chat });
		expect(commandFor("toggle-ui", { type: "sharing-tray" })).toEqual({ cmd: "press", id: BUTTON_IDS.share });
	});

	it("sends reactions and raises hands through the React menu", () => {
		expect(commandFor("send-reaction", { type: "love" })).toMatchObject({ cmd: "menu", id: BUTTON_IDS.react });
		const love = commandFor("send-reaction", { type: "love" });
		expect("labels" in love && love.labels).toContain("heart");
		const hand = commandFor("toggle-hand", {});
		expect(hand).toMatchObject({ cmd: "menu", id: BUTTON_IDS.react });
		expect("labels" in hand && hand.labels).toEqual(expect.arrayContaining(["raise", "lower"]));
	});

	it("reports what isn't supported instead of guessing", () => {
		expect(commandFor("toggle-background-blur", {})).toEqual({ unsupported: "Background blur isn't supported yet" });
	});
});

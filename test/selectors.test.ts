import { describe, expect, it } from "vitest";

import {
	BUTTON_IDS,
	DEFAULT_SELECTORS,
	TeamsChangedDebouncer,
	commandFor,
	mergeSelectors,
	parseMeetingDurationSeconds,
	snapshotFrom,
	type BridgeStatus,
} from "../src/teams/selectors";

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
	"roster-button": "People",
	"hangup-button": "Leave",
};

describe("snapshotFrom", () => {
	it("uses only meeting-only marker ids by default", () => {
		expect(DEFAULT_SELECTORS.meetingMarkerIds).toEqual(["horizontalMiddleEnd", "horizontalEnd"]);
	});

	it("watches the meeting indicators container by default", () => {
		expect(DEFAULT_SELECTORS.indicatorContainerIds).toEqual(["indicators"]);
	});

	it("uses Teams' video options menu for Background blur by default", () => {
		expect(DEFAULT_SELECTORS.buttonIds.blur).toBe("video-button-configure");
		expect(DEFAULT_SELECTORS.blur.on.labels).toEqual(["standard blur", "blur"]);
		expect(DEFAULT_SELECTORS.blur.on.excludeLabels).toEqual(["no background effect", "none"]);
		expect(DEFAULT_SELECTORS.blur.off.labels).toEqual(["no background effect", "none"]);
	});

	it("reads mute and camera state from the button labels", () => {
		const muted = snapshotFrom(status(toolbar));
		expect(muted.online).toBe(true);
		expect(muted.state).toMatchObject({ isInMeeting: true, isMuted: true, isVideoOn: false });

		const live = snapshotFrom(status({ ...toolbar, "microphone-button": "Mute mic", "video-button": "Turn camera off" }));
		expect(live.state).toMatchObject({ isMuted: false, isVideoOn: true });
	});

	it("reads recording only from positive indicator labels or labeled recording ids", () => {
		for (const label of ["Recording", "Recording and transcribing", "This meeting is being recorded", "Recording has started", "Transcription started"]) {
			expect(snapshotFrom(status(toolbar, { indicators: [{ role: "AXStaticText", label }] })).state.isRecording).toBe(true);
		}
		for (const label of ["Start recording", "Recording stopped", "Recording\nStopped", "Not recording", "Recording disabled", "No transcript"]) {
			expect(snapshotFrom(status(toolbar, { indicators: [{ role: "AXStaticText", label }] })).state.isRecording).toBe(false);
		}
		expect(
			snapshotFrom(
				status(toolbar, {
					indicators: [{ id: "recording-indicator-container", role: "AXGroup" }],
				}),
			).state.isRecording,
		).toBe(false);
		expect(
			snapshotFrom(
				status(toolbar, {
					indicators: [{ id: "call-recording-pill", role: "AXButton", label: "On" }],
				}),
			).state.isRecording,
		).toBe(true);
		for (const label of ["Recording stopped", "Off"]) {
			expect(
				snapshotFrom(
					status(toolbar, {
						indicators: [{ id: "call-recording-pill", role: "AXButton", label }],
					}),
				).state.isRecording,
			).toBe(false);
		}
		expect(
			snapshotFrom(
				status(toolbar, {
					indicators: [{ id: "call-duration-custom", role: "AXTimeGroup", label: "Elapsed time 00:34" }],
				}),
			).state.isRecording,
		).toBe(false);
	});

	it("reads meeting duration from the call-duration indicator", () => {
		expect(
			snapshotFrom(
				status(toolbar, {
					indicators: [{ id: "call-duration-custom", role: "AXTimeGroup", label: "Elapsed time 01:05" }],
				}),
			).state.meetingElapsedSeconds,
		).toBe(65);
	});

	it("marks mic, camera, and share state unknown when labels do not match their patterns", () => {
		const unknown = snapshotFrom(
			status({
				...toolbar,
				"microphone-button": "Stummschaltung aufheben",
				"video-button": "Kamera einschalten",
				"share-button": "Bildschirmfreigabe",
			}),
		);
		expect(unknown.state).toMatchObject({
			isInMeeting: true,
			isMuteKnown: false,
			isVideoKnown: false,
			isSharingKnown: false,
		});
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
			canTogglePeople: true,
		});

		const narrow = snapshotFrom(status({ "microphone-button": "Mute mic", "hangup-button": "Leave" }));
		expect(narrow.permissions.canToggleVideo).toBe(false);
		expect(narrow.permissions.canReact).toBe(false);
		expect(narrow.permissions.canTogglePeople).toBe(false);
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
		expect(s.reason).toBeUndefined();
	});

	it("reports teams-changed when meeting UI markers are present but the mic anchor is gone", () => {
		const s = snapshotFrom(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"] }));
		expect(s).toMatchObject({
			online: true,
			reason: "teams-changed",
			state: { isInMeeting: false, isMuteKnown: false, isVideoKnown: false, isSharingKnown: false },
			permissions: {
				canToggleMute: false,
				canToggleVideo: false,
				canLeave: false,
				canReact: false,
			},
		});
	});

	it("goes offline with a reason when Teams can't be read", () => {
		expect(snapshotFrom(status({}, { trusted: false }))).toMatchObject({ online: false, reason: "no-permission" });
		expect(snapshotFrom(status({}, { running: false }))).toMatchObject({ online: false, reason: "teams-not-running" });
	});
});

describe("parseMeetingDurationSeconds", () => {
	it("parses the first language-independent timer in an indicator label", () => {
		expect(parseMeetingDurationSeconds("Elapsed time 00:34")).toBe(34);
		expect(parseMeetingDurationSeconds("Durée écoulée 1:02:03")).toBe(3_723);
		expect(parseMeetingDurationSeconds("garbage")).toBeUndefined();
	});
});

describe("TeamsChangedDebouncer", () => {
	function clock(start = 1_000) {
		let t = start;
		return { now: () => t, advance: (ms: number) => (t += ms) };
	}

	it("keeps the last stable meeting snapshot during a transient markers-without-mic window", () => {
		const c = clock();
		const debounce = new TeamsChangedDebouncer(c.now);
		const live = debounce.next(status({ ...toolbar, "microphone-button": "Mute mic" }));
		expect(live.state).toMatchObject({ isInMeeting: true, isMuted: false });

		c.advance(500);
		const transient = debounce.next(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"] }));
		expect(transient.reason).toBeUndefined();
		expect(transient.state).toMatchObject({ isInMeeting: true, isMuted: false });
	});

	it("reports teams-changed only after markers without the mic persist for at least 3 seconds", () => {
		const c = clock();
		const debounce = new TeamsChangedDebouncer(c.now);
		debounce.next(status({ ...toolbar, "microphone-button": "Mute mic" }));

		c.advance(500);
		debounce.next(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"] }));
		c.advance(2_999);
		expect(debounce.next(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"] })).reason).toBeUndefined();
		c.advance(1);
		expect(debounce.next(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"] })).reason).toBe("teams-changed");
	});

	it("keeps showing teams-changed when the marker set changes after the debounce fires", () => {
		const c = clock();
		const debounce = new TeamsChangedDebouncer(c.now);
		debounce.next(status({ ...toolbar, "microphone-button": "Mute mic" }));

		c.advance(500);
		debounce.next(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"] }));
		c.advance(3_000);
		expect(debounce.next(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"] })).reason).toBe("teams-changed");

		c.advance(100);
		expect(debounce.next(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalMiddleEnd"] })).reason).toBe(
			"teams-changed",
		);
	});

	it("cancels the pending teams-changed state when the mic anchor comes back", () => {
		const c = clock();
		const debounce = new TeamsChangedDebouncer(c.now);
		debounce.next(status({ ...toolbar, "microphone-button": "Mute mic" }));
		c.advance(500);
		debounce.next(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"] }));
		c.advance(2_000);
		expect(debounce.next(status({ ...toolbar, "microphone-button": "Mute mic" })).state.isInMeeting).toBe(true);
		c.advance(500);
		expect(debounce.next(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"] })).reason).toBeUndefined();
	});

	it("forgets the last stable meeting snapshot after reset", () => {
		const c = clock();
		const debounce = new TeamsChangedDebouncer(c.now);
		debounce.next(status({ ...toolbar, "microphone-button": "Mute mic" }));
		debounce.reset();
		const transient = debounce.next(status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"] }));
		expect(transient.reason).toBeUndefined();
		expect(transient.state).toMatchObject({
			isInMeeting: false,
			isMuteKnown: false,
			isVideoKnown: false,
			isSharingKnown: false,
		});
	});
});

describe("mergeSelectors", () => {
	it("deep-merges overrides over the defaults and compiles label patterns case-insensitively", () => {
		const { selectors, problems } = mergeSelectors(DEFAULT_SELECTORS, {
			buttonIds: { mute: "custom-mic-button" },
			labelPatterns: { mute: { muted: "^silence" } },
		});

		expect(problems).toEqual([]);
		expect(selectors.buttonIds.mute).toBe("custom-mic-button");
		expect(selectors.buttonIds.camera).toBe(DEFAULT_SELECTORS.buttonIds.camera);
		expect(selectors.labelPatterns.mute.muted.test("SILENCE microphone")).toBe(true);
		expect(selectors.labelPatterns.mute.live.test("Mute mic")).toBe(true);
	});

	it("falls back to the default for invalid override fields and reports each problem", () => {
		const { selectors, problems } = mergeSelectors(DEFAULT_SELECTORS, {
			buttonIds: { mute: 42 },
			labelPatterns: {
				mute: { muted: "(" },
				camera: { on: "\\bdisable\\b" },
				chat: { unreadPattern: "(" },
			},
		});

		expect(problems).toEqual(
			expect.arrayContaining([
				expect.stringContaining("buttonIds.mute"),
				expect.stringContaining("labelPatterns.mute.muted"),
				expect.stringContaining("labelPatterns.chat.unreadPattern"),
			]),
		);
		expect(selectors.buttonIds.mute).toBe(DEFAULT_SELECTORS.buttonIds.mute);
		expect(selectors.labelPatterns.mute.muted.test("Unmute mic")).toBe(true);
		expect(selectors.labelPatterns.camera.on.test("DISABLE camera")).toBe(true);
		expect(selectors.labelPatterns.chat.unreadPattern).toBeNull();
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
		expect(commandFor("toggle-people", {})).toEqual({ cmd: "press", id: "roster-button" });
	});

	it("opens video options with a bridge-side Background blur toggle", () => {
		expect(commandFor("set-background-blur", {})).toEqual({
			cmd: "menu",
			id: "video-button-configure",
			escapeIfNoFreshItems: "ifExpanded",
			toggle: {
				on: { itemIds: [], labels: ["standard blur", "blur"], excludeLabels: ["no background effect", "none"] },
				off: { itemIds: [], labels: ["no background effect", "none"], excludeLabels: [] },
			},
		});
	});

	it("sends reactions and raises hands by pressing React-menu items by id", () => {
		expect(commandFor("send-reaction", { type: "love" })).toMatchObject({
			cmd: "menu",
			id: BUTTON_IDS.react,
			itemIds: ["heart-button"],
			escapeIfNoFreshItems: "always",
		});
		expect(commandFor("send-reaction", { type: "wow" })).toMatchObject({ itemIds: ["surprised-button"] });
		expect(commandFor("send-reaction", {})).toMatchObject({ itemIds: ["like-button"] });
		expect(commandFor("toggle-hand", {})).toMatchObject({
			cmd: "menu",
			id: BUTTON_IDS.react,
			itemIds: ["raisehands-button"],
			escapeIfNoFreshItems: "always",
		});
	});

	it("uses AXExpanded-gated Escape for Background blur because video options belongs to Teams, not React", () => {
		expect(commandFor("set-background-blur", {})).toMatchObject({
			cmd: "menu",
			id: "video-button-configure",
			escapeIfNoFreshItems: "ifExpanded",
		});
	});

	it("keeps label fallbacks in case Teams renames the item ids", () => {
		const love = commandFor("send-reaction", { type: "love" });
		expect("labels" in love && love.labels).toContain("love");
	});

	it("reports what isn't supported instead of guessing", () => {
		expect(commandFor("query-state", {})).toMatchObject({ unsupported: expect.any(String) });
	});
});

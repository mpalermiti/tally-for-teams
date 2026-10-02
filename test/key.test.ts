import { describe, expect, it } from "vitest";

import type { Snapshot } from "../src/teams/protocol";
import { EMPTY_STATE, NO_PERMISSIONS, type MeetingPermissions, type MeetingState } from "../src/teams/protocol";
import { KEY_KINDS, keySvg, muteDialFeedback, visualFor } from "../src/render/key";

const ALL_ALLOWED = Object.fromEntries(Object.keys(NO_PERMISSIONS).map((k) => [k, true])) as unknown as MeetingPermissions;

function inMeeting(state: Partial<MeetingState> = {}, permissions: Partial<MeetingPermissions> = {}): Snapshot {
	return {
		online: true,
		state: { ...EMPTY_STATE, isInMeeting: true, ...state },
		permissions: { ...ALL_ALLOWED, ...permissions },
	};
}

const offline: Snapshot = { online: false, state: EMPTY_STATE, permissions: NO_PERMISSIONS };
const noMeeting: Snapshot = { online: true, state: EMPTY_STATE, permissions: NO_PERMISSIONS };

describe("visualFor", () => {
	it("dims every key while Teams is unreachable, and distinguishes that from 'no meeting'", () => {
		for (const kind of KEY_KINDS) {
			expect(visualFor(kind, offline).tone).toBe("offline");
			expect(visualFor(kind, noMeeting).tone).toBe("idle");
		}
	});

	it("lights the mute key when the mic is live, not when muted", () => {
		expect(visualFor("mute", inMeeting({ isMuted: false }))).toMatchObject({ tone: "on", glyph: "mic" });
		expect(visualFor("mute", inMeeting({ isMuted: true }))).toMatchObject({ tone: "off", glyph: "mic-off" });
	});

	it("lights camera and hand when they're on", () => {
		expect(visualFor("camera", inMeeting({ isVideoOn: true }))).toMatchObject({ tone: "on", glyph: "video" });
		expect(visualFor("camera", inMeeting({ isVideoOn: false }))).toMatchObject({ tone: "off", glyph: "video-off" });
		expect(visualFor("hand", inMeeting({ isHandRaised: true })).tone).toBe("on");
		expect(visualFor("hand", inMeeting({ isHandRaised: false })).tone).toBe("off");
	});

	it("renders unknown mic, camera, and share state as neutral ready keys with plain glyphs", () => {
		expect(visualFor("mute", inMeeting({ isMuteKnown: false } as Partial<MeetingState>))).toMatchObject({
			tone: "ready",
			glyph: "mic",
		});
		expect(visualFor("camera", inMeeting({ isVideoKnown: false } as Partial<MeetingState>))).toMatchObject({
			tone: "ready",
			glyph: "video",
		});
		expect(visualFor("share", inMeeting({ isSharingKnown: false } as Partial<MeetingState>))).toMatchObject({
			tone: "ready",
			glyph: "screen-share",
		});
	});

	it("goes idle when Teams says the control isn't available in this meeting", () => {
		expect(visualFor("mute", inMeeting({}, { canToggleMute: false })).tone).toBe("idle");
		expect(visualFor("camera", inMeeting({}, { canToggleVideo: false })).tone).toBe("idle");
		expect(visualFor("leave", inMeeting({}, { canLeave: false })).tone).toBe("idle");
		expect(visualFor("react", inMeeting({}, { canReact: false })).tone).toBe("idle");
	});

	it("shows leave as a red key only during a meeting", () => {
		expect(visualFor("leave", inMeeting()).tone).toBe("danger");
		expect(visualFor("leave", noMeeting).tone).toBe("idle");
	});

	it("draws the chosen reaction", () => {
		expect(visualFor("react", inMeeting(), { reaction: "love" })).toMatchObject({ tone: "ready", glyph: "heart" });
		expect(visualFor("react", inMeeting(), { reaction: "wow" }).glyph).toBe("wow");
		expect(visualFor("react", inMeeting()).glyph).toBe("thumbs-up");
	});

	it("lights chat on unread messages and share while sharing", () => {
		expect(visualFor("chat", inMeeting({ hasUnreadMessages: true }))).toMatchObject({ tone: "on", glyph: "message-square-dot" });
		expect(visualFor("chat", inMeeting()).tone).toBe("ready");
		expect(visualFor("share", inMeeting({ isSharing: true })).tone).toBe("on");
		expect(visualFor("share", inMeeting()).tone).toBe("ready");
	});

	it("keeps share lit while sharing even if the tray itself is unavailable, because the key stops sharing", () => {
		expect(visualFor("share", inMeeting({ isSharing: true }, { canToggleShareTray: false })).tone).toBe("on");
	});

});

describe("keySvg", () => {
	const stroke = (svg: string) => svg.match(/stroke="(#[0-9A-F]{6})"/i)?.[1];

	it("draws every pressable dark key with the same bright glyph; only the lit fill says what's on", () => {
		const ready = stroke(keySvg(visualFor("react", inMeeting())));
		expect(stroke(keySvg(visualFor("hand", inMeeting())))).toBe(ready);
		expect(stroke(keySvg(visualFor("camera", inMeeting({ isVideoOn: false }))))).toBe(ready);
		expect(stroke(keySvg(visualFor("mute", inMeeting({ isMuted: true }))))).toBe(ready);
	});

	it("still dims keys you can't press", () => {
		const ready = stroke(keySvg(visualFor("react", inMeeting())));
		expect(stroke(keySvg(visualFor("hand", noMeeting)))).not.toBe(ready);
		expect(stroke(keySvg(visualFor("hand", offline)))).not.toBe(ready);
	});

	it("renders a 144px square SVG with the glyph", () => {
		const svg = keySvg(visualFor("mute", inMeeting()));
		expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 144 144"/);
		expect(svg).toContain('stroke="#1E1507"');
	});

	it("draws hold progress as a ring and a hint as a word under the glyph", () => {
		const leave = visualFor("leave", inMeeting());
		expect(keySvg(leave)).not.toContain("data-progress");
		expect(keySvg(leave, { progress: 0.5 })).toContain('data-progress="0.50"');
		expect(keySvg(leave, { hint: "Hold" })).toContain(">Hold</text>");
	});
});

describe("muteDialFeedback", () => {
	const text = (f: ReturnType<typeof muteDialFeedback>) => [f.label.value, f.detail.value];

	it("says what the mic is doing and what holding will do", () => {
		expect(text(muteDialFeedback(inMeeting({ isMuted: false })))).toEqual(["Live", "Hold to mute"]);
		expect(text(muteDialFeedback(inMeeting({ isMuted: true })))).toEqual(["Muted", "Hold to talk"]);
	});

	it("explains why it's inactive", () => {
		expect(text(muteDialFeedback({ ...offline, reason: "no-permission" }))).toEqual(["Allow", "Accessibility"]);
		expect(text(muteDialFeedback({ ...offline, reason: "teams-not-running" }))).toEqual(["Teams", "Not running"]);
		expect(text(muteDialFeedback({ ...offline, reason: "starting" }))).toEqual(["Teams", "Connecting"]);
		expect(text(muteDialFeedback({ ...noMeeting, reason: "teams-changed" }))).toEqual(["Teams changed", "See README"]);
		expect(text(muteDialFeedback(noMeeting))).toEqual(["Mic", "No meeting"]);
		expect(text(muteDialFeedback(inMeeting({}, { canToggleMute: false })))).toEqual(["Mic", "Not available"]);
	});

	it("draws the face as a 200×100 strip that matches the key's tone", () => {
		const face = Buffer.from(muteDialFeedback(inMeeting()).face.split(",")[1], "base64").toString();
		expect(face).toMatch(/viewBox="0 0 200 100"/);
		expect(face).toContain("radialGradient"); // lit, like the key
	});
});

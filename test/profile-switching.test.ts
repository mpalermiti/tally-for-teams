import { describe, expect, it } from "vitest";

import { INITIAL_PROFILE_SWITCH_STATE, nextProfileSwitch } from "../src/profiles";

describe("profile auto-switch decisions", () => {
	const devices = [
		{ id: "SD15", type: 0 },
		{ id: "PLUS", type: 7 },
		{ id: "XL", type: 2 },
	];

	it("never switches while auto-switch is disabled", () => {
		const result = nextProfileSwitch(INITIAL_PROFILE_SWITCH_STATE, {
			autoSwitchProfile: false,
			isInMeeting: true,
			devices,
		});

		expect(result.actions).toEqual([]);
		expect(result.state).toEqual({ isInMeeting: true, switchedDeviceIds: [] });
	});

	it("switches supported connected devices on a disabled-to-enabled meeting transition", () => {
		const result = nextProfileSwitch(INITIAL_PROFILE_SWITCH_STATE, {
			autoSwitchProfile: true,
			isInMeeting: true,
			devices,
		});

		expect(result.actions).toEqual([
			{ deviceId: "SD15", profileName: "profiles/Tally (Stream Deck)" },
			{ deviceId: "PLUS", profileName: "profiles/Tally (Stream Deck +)" },
		]);
		expect(result.state).toEqual({ isInMeeting: true, switchedDeviceIds: ["SD15", "PLUS"] });
	});

	it("does not switch repeatedly while the meeting remains active", () => {
		const state = { isInMeeting: true, switchedDeviceIds: ["PLUS"] };

		expect(nextProfileSwitch(state, { autoSwitchProfile: true, isInMeeting: true, devices }).actions).toEqual([]);
	});

	it("switches only devices it moved back to the previous profile on meeting end", () => {
		const state = { isInMeeting: true, switchedDeviceIds: ["PLUS"] };

		expect(nextProfileSwitch(state, { autoSwitchProfile: true, isInMeeting: false, devices }).actions).toEqual([
			{ deviceId: "PLUS" },
		]);
	});
});

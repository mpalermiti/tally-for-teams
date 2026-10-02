import { describe, expect, it } from "vitest";

import {
	INITIAL_PROFILE_SWITCH_STATE,
	PROFILE_SWITCH_BACK_DELAY_MS,
	meetingStatusForProfileSwitch,
	nextProfileSwitch,
	type ProfileSwitchState,
} from "../src/profiles";
import { EMPTY_STATE, NO_PERMISSIONS, type Snapshot } from "../src/teams/protocol";

describe("profile auto-switch decisions", () => {
	const bundledVisibleActionsByDeviceType = {
		0: [
			{ manifestId: "ai.michaelp.tally.mute", controllerType: "Keypad", coordinates: { column: 0, row: 0 } },
			{ manifestId: "ai.michaelp.tally.leave", controllerType: "Keypad", coordinates: { column: 4, row: 2 } },
		],
		7: [
			{ manifestId: "ai.michaelp.tally.mute", controllerType: "Keypad", coordinates: { column: 0, row: 0 } },
			{ manifestId: "ai.michaelp.tally.leave", controllerType: "Keypad", coordinates: { column: 3, row: 1 } },
		],
	};
	const visibleActionsForDeviceType = (type: number) =>
		bundledVisibleActionsByDeviceType[type as keyof typeof bundledVisibleActionsByDeviceType] ?? [];
	const device = (id: string, type: number, visibleActions = visibleActionsForDeviceType(type)) => ({ id, type, visibleActions });
	const devices = [device("SD15", 0), device("PLUS", 7), device("XL", 2)];

	const afterSwitch: ProfileSwitchState = { isInMeeting: true, switchedDeviceIds: ["SD15", "PLUS"] };

	it("never switches while auto-switch is disabled", () => {
		const result = nextProfileSwitch(INITIAL_PROFILE_SWITCH_STATE, {
			autoSwitchProfile: false,
			meetingStatus: "in-meeting",
			nowMs: 0,
			devices,
		});

		expect(result.actions).toEqual([]);
		expect(result.state).toEqual({ isInMeeting: true, switchedDeviceIds: [] });
	});

	it("switches supported connected devices on a disabled-to-enabled meeting transition", () => {
		const result = nextProfileSwitch(INITIAL_PROFILE_SWITCH_STATE, {
			autoSwitchProfile: true,
			meetingStatus: "in-meeting",
			nowMs: 0,
			devices,
		});

		expect(result.actions).toEqual([
			{ deviceId: "SD15", profileName: "profiles/Tally (Stream Deck)" },
			{ deviceId: "PLUS", profileName: "profiles/Tally (Stream Deck +)" },
		]);
		expect(result.state).toEqual({ isInMeeting: true, switchedDeviceIds: ["SD15", "PLUS"] });
	});

	it("does not mark an active meeting as handled while global settings are still loading", () => {
		const loading = nextProfileSwitch(INITIAL_PROFILE_SWITCH_STATE, {
			autoSwitchProfile: undefined,
			meetingStatus: "in-meeting",
			nowMs: 0,
			devices,
		});

		expect(loading.actions).toEqual([]);
		expect(loading.state).toEqual(INITIAL_PROFILE_SWITCH_STATE);

		const settingsArrived = nextProfileSwitch(loading.state, {
			autoSwitchProfile: true,
			meetingStatus: "in-meeting",
			nowMs: 1_000,
			devices,
		});
		expect(settingsArrived.actions).toEqual([
			{ deviceId: "SD15", profileName: "profiles/Tally (Stream Deck)" },
			{ deviceId: "PLUS", profileName: "profiles/Tally (Stream Deck +)" },
		]);
	});

	it("does not switch repeatedly while the meeting remains active", () => {
		const state: ProfileSwitchState = { isInMeeting: true, switchedDeviceIds: ["PLUS"] };

		expect(nextProfileSwitch(state, { autoSwitchProfile: true, meetingStatus: "in-meeting", nowMs: 1_000, devices }).actions).toEqual([]);
	});

	it("ignores a brief not-in-meeting toolbar rebuild blip before switching back", () => {
		const blip = nextProfileSwitch(afterSwitch, {
			autoSwitchProfile: true,
			meetingStatus: "not-in-meeting",
			nowMs: 1_000,
			devices,
		});

		expect(blip.actions).toEqual([]);
		expect(blip.state).toEqual({ ...afterSwitch, notInMeetingSinceMs: 1_000 });
		expect(blip.recheckInMs).toBe(PROFILE_SWITCH_BACK_DELAY_MS);

		const recovered = nextProfileSwitch(blip.state, {
			autoSwitchProfile: true,
			meetingStatus: "in-meeting",
			nowMs: 4_000,
			devices,
		});

		expect(recovered.actions).toEqual([]);
		expect(recovered.state).toEqual(afterSwitch);
	});

	it("treats helper restarts as unknown and restarts the not-in-meeting clock", () => {
		const unknown = nextProfileSwitch(afterSwitch, {
			autoSwitchProfile: true,
			meetingStatus: "unknown",
			nowMs: 1_000,
			devices,
		});

		expect(unknown.actions).toEqual([]);
		expect(unknown.state).toEqual(afterSwitch);

		const firstNoMeeting = nextProfileSwitch(unknown.state, {
			autoSwitchProfile: true,
			meetingStatus: "not-in-meeting",
			nowMs: 3_000,
			devices,
		});
		const almostElapsed = nextProfileSwitch(firstNoMeeting.state, {
			autoSwitchProfile: true,
			meetingStatus: "not-in-meeting",
			nowMs: 3_000 + PROFILE_SWITCH_BACK_DELAY_MS - 1,
			devices,
		});

		expect(firstNoMeeting.actions).toEqual([]);
		expect(almostElapsed.actions).toEqual([]);
		expect(almostElapsed.recheckInMs).toBe(1);
		expect(almostElapsed.state).toEqual({ ...afterSwitch, notInMeetingSinceMs: 3_000 });
	});

	it("treats Teams-changed snapshots as unknown instead of switching back", () => {
		const snapshot: Snapshot = {
			online: true,
			reason: "teams-changed",
			state: EMPTY_STATE,
			permissions: NO_PERMISSIONS,
		};

		expect(meetingStatusForProfileSwitch(snapshot)).toBe("unknown");
		expect(
			nextProfileSwitch(afterSwitch, {
				autoSwitchProfile: true,
				meetingStatus: meetingStatusForProfileSwitch(snapshot),
				nowMs: 1_000 + PROFILE_SWITCH_BACK_DELAY_MS,
				devices,
			}).actions,
		).toEqual([]);
	});

	it("switches only devices it moved back to the previous profile after a real meeting end persists", () => {
		const ending = nextProfileSwitch(afterSwitch, {
			autoSwitchProfile: true,
			meetingStatus: "not-in-meeting",
			nowMs: 1_000,
			devices,
		});
		const elapsed = nextProfileSwitch(ending.state, {
			autoSwitchProfile: true,
			meetingStatus: "not-in-meeting",
			nowMs: 1_000 + PROFILE_SWITCH_BACK_DELAY_MS,
			devices,
		});

		expect(elapsed.actions).toEqual([{ deviceId: "SD15" }, { deviceId: "PLUS" }]);
		expect(elapsed.state).toEqual({ isInMeeting: false, switchedDeviceIds: [] });
	});

	it("does not yank devices that no longer show Tally actions on meeting end", () => {
		const devicesAfterUserSwitch = [device("SD15", 0, []), device("PLUS", 7)];
		const ending = nextProfileSwitch(afterSwitch, {
			autoSwitchProfile: true,
			meetingStatus: "not-in-meeting",
			nowMs: 1_000,
			devices: devicesAfterUserSwitch,
		});

		expect(
			nextProfileSwitch(ending.state, {
				autoSwitchProfile: true,
				meetingStatus: "not-in-meeting",
				nowMs: 1_000 + PROFILE_SWITCH_BACK_DELAY_MS,
				devices: devicesAfterUserSwitch,
			}).actions,
		).toEqual([
			{ deviceId: "PLUS" },
		]);
	});

	it("does not yank devices that only show Tally actions in a custom layout", () => {
		const devicesAfterUserSwitch = [
			device("SD15", 0, [
				{ manifestId: "ai.michaelp.tally.mute", controllerType: "Keypad", coordinates: { column: 2, row: 2 } },
				{ manifestId: "ai.michaelp.tally.leave", controllerType: "Keypad", coordinates: { column: 4, row: 2 } },
			]),
			device("PLUS", 7),
		];
		const ending = nextProfileSwitch(afterSwitch, {
			autoSwitchProfile: true,
			meetingStatus: "not-in-meeting",
			nowMs: 1_000,
			devices: devicesAfterUserSwitch,
		});

		expect(
			nextProfileSwitch(ending.state, {
				autoSwitchProfile: true,
				meetingStatus: "not-in-meeting",
				nowMs: 1_000 + PROFILE_SWITCH_BACK_DELAY_MS,
				devices: devicesAfterUserSwitch,
			}).actions,
		).toEqual([
			{ deviceId: "PLUS" },
		]);
	});

	it("does not count dial actions as bundled key layout anchors", () => {
		const devicesAfterUserSwitch = [
			device("SD15", 0),
			device("PLUS", 7, [
				{ manifestId: "ai.michaelp.tally.mute", controllerType: "Encoder", coordinates: { column: 0, row: 0 } },
				{ manifestId: "ai.michaelp.tally.leave", controllerType: "Keypad", coordinates: { column: 3, row: 1 } },
			]),
		];
		const ending = nextProfileSwitch(afterSwitch, {
			autoSwitchProfile: true,
			meetingStatus: "not-in-meeting",
			nowMs: 1_000,
			devices: devicesAfterUserSwitch,
		});

		expect(
			nextProfileSwitch(ending.state, {
				autoSwitchProfile: true,
				meetingStatus: "not-in-meeting",
				nowMs: 1_000 + PROFILE_SWITCH_BACK_DELAY_MS,
				devices: devicesAfterUserSwitch,
			}).actions,
		).toEqual([{ deviceId: "SD15" }]);
	});

	it("maps offline snapshots to unknown", () => {
		expect(meetingStatusForProfileSwitch({ online: false, reason: "teams-not-running", state: EMPTY_STATE, permissions: NO_PERMISSIONS })).toBe(
			"unknown",
		);
	});
});

import type { Snapshot } from "./teams/protocol";

const PLUGIN_UUID = "ai.michaelp.tally";

export const TALLY_PROFILE_BY_DEVICE_TYPE = {
	0: "profiles/Tally (Stream Deck)",
	7: "profiles/Tally (Stream Deck +)",
} as const;

export const PROFILE_SWITCH_BACK_DELAY_MS = 8_000;

export interface ProfileSwitchDevice {
	id: string;
	type: number;
	visibleActions: readonly ProfileSwitchVisibleAction[];
}

export interface ProfileSwitchVisibleAction {
	manifestId: string;
	controllerType?: ProfileSwitchControllerType;
	coordinates?: ProfileSwitchCoordinates;
}

export type ProfileSwitchControllerType = "Encoder" | "Keypad" | "Neo";

export interface ProfileSwitchCoordinates {
	column: number;
	row: number;
}

export interface ProfileSwitchState {
	isInMeeting: boolean;
	switchedDeviceIds: readonly string[];
	notInMeetingSinceMs?: number;
}

export type ProfileMeetingStatus = "in-meeting" | "not-in-meeting" | "unknown";

export interface ProfileSwitchInput {
	autoSwitchProfile: boolean | undefined;
	meetingStatus: ProfileMeetingStatus;
	nowMs: number;
	devices: readonly ProfileSwitchDevice[];
	switchBackDelayMs?: number;
}

export interface ProfileSwitchAction {
	deviceId: string;
	/** Omitted to return to the previous profile. */
	profileName?: string;
}

export interface ProfileSwitchResult {
	state: ProfileSwitchState;
	actions: ProfileSwitchAction[];
	recheckInMs?: number;
}

export const INITIAL_PROFILE_SWITCH_STATE: ProfileSwitchState = { isInMeeting: false, switchedDeviceIds: [] };

export function profileNameForDeviceType(type: number): string | undefined {
	return TALLY_PROFILE_BY_DEVICE_TYPE[type as keyof typeof TALLY_PROFILE_BY_DEVICE_TYPE];
}

export function hasBundledProfileVisibleActions(device: Pick<ProfileSwitchDevice, "type" | "visibleActions">): boolean {
	const requiredActions = REQUIRED_VISIBLE_ACTIONS_BY_DEVICE_TYPE[device.type as keyof typeof REQUIRED_VISIBLE_ACTIONS_BY_DEVICE_TYPE];
	if (!requiredActions) return false;
	return requiredActions.every((required) =>
		device.visibleActions.some(
			(action) =>
				action.manifestId === required.manifestId &&
				action.controllerType === required.controllerType &&
				sameCoordinates(action.coordinates, required.coordinates),
		),
	);
}

export function meetingStatusForProfileSwitch(snapshot: Snapshot): ProfileMeetingStatus {
	if (!snapshot.online || snapshot.reason === "teams-changed") return "unknown";
	return snapshot.state.isInMeeting ? "in-meeting" : "not-in-meeting";
}

export function nextProfileSwitch(
	previous: ProfileSwitchState,
	input: ProfileSwitchInput,
): ProfileSwitchResult {
	const supported = input.devices
		.map((device) => ({ device, profileName: profileNameForDeviceType(device.type) }))
		.filter((entry): entry is { device: ProfileSwitchDevice; profileName: string } => entry.profileName !== undefined);

	if (input.autoSwitchProfile === undefined) {
		return { state: previous, actions: [] };
	}

	if (input.autoSwitchProfile === false) {
		return {
			state: {
				isInMeeting:
					input.meetingStatus === "in-meeting" ? true
					: input.meetingStatus === "not-in-meeting" ? false
					: previous.isInMeeting,
				switchedDeviceIds: input.meetingStatus === "in-meeting" ? previous.switchedDeviceIds : [],
			},
			actions: [],
		};
	}

	if (input.meetingStatus === "unknown") {
		return { state: { isInMeeting: previous.isInMeeting, switchedDeviceIds: previous.switchedDeviceIds }, actions: [] };
	}

	if (input.meetingStatus === "in-meeting") {
		if (previous.isInMeeting) return { state: { isInMeeting: true, switchedDeviceIds: previous.switchedDeviceIds }, actions: [] };

		const actions = supported.map(({ device, profileName }) => ({ deviceId: device.id, profileName }));
		return { state: { isInMeeting: true, switchedDeviceIds: actions.map((action) => action.deviceId) }, actions };
	}

	if (!previous.isInMeeting) return { state: { isInMeeting: false, switchedDeviceIds: [] }, actions: [] };

	const notInMeetingSinceMs = previous.notInMeetingSinceMs ?? input.nowMs;
	const recheckInMs = (input.switchBackDelayMs ?? PROFILE_SWITCH_BACK_DELAY_MS) - (input.nowMs - notInMeetingSinceMs);
	if (recheckInMs > 0) {
		return { state: { ...previous, notInMeetingSinceMs }, actions: [], recheckInMs };
	}

	const previouslySwitched = new Set(previous.switchedDeviceIds);
	const actions = supported
		.filter(({ device }) => previouslySwitched.has(device.id) && hasBundledProfileVisibleActions(device))
		.map(({ device }) => ({ deviceId: device.id }));
	return { state: { isInMeeting: false, switchedDeviceIds: [] }, actions };
}

export const REQUIRED_VISIBLE_ACTIONS_BY_DEVICE_TYPE = {
	0: [
		{ manifestId: `${PLUGIN_UUID}.mute`, controllerType: "Keypad", coordinates: { column: 0, row: 0 } },
		{ manifestId: `${PLUGIN_UUID}.leave`, controllerType: "Keypad", coordinates: { column: 4, row: 2 } },
	],
	7: [
		{ manifestId: `${PLUGIN_UUID}.mute`, controllerType: "Keypad", coordinates: { column: 0, row: 0 } },
		{ manifestId: `${PLUGIN_UUID}.leave`, controllerType: "Keypad", coordinates: { column: 3, row: 1 } },
	],
} as const satisfies Record<
	number,
	readonly { manifestId: string; controllerType: ProfileSwitchControllerType; coordinates: ProfileSwitchCoordinates }[]
>;

function sameCoordinates(actual: ProfileSwitchCoordinates | undefined, expected: ProfileSwitchCoordinates): boolean {
	return actual !== undefined && actual.column === expected.column && actual.row === expected.row;
}

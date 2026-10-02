export const TALLY_PROFILE_BY_DEVICE_TYPE = {
	0: "profiles/Tally (Stream Deck)",
	7: "profiles/Tally (Stream Deck +)",
} as const;

export interface ProfileSwitchDevice {
	id: string;
	type: number;
}

export interface ProfileSwitchState {
	isInMeeting: boolean;
	switchedDeviceIds: readonly string[];
}

export interface ProfileSwitchInput {
	autoSwitchProfile: boolean;
	isInMeeting: boolean;
	devices: readonly ProfileSwitchDevice[];
}

export interface ProfileSwitchAction {
	deviceId: string;
	/** Omitted to return to the previous profile. */
	profileName?: string;
}

export const INITIAL_PROFILE_SWITCH_STATE: ProfileSwitchState = { isInMeeting: false, switchedDeviceIds: [] };

export function profileNameForDeviceType(type: number): string | undefined {
	return TALLY_PROFILE_BY_DEVICE_TYPE[type as keyof typeof TALLY_PROFILE_BY_DEVICE_TYPE];
}

export function nextProfileSwitch(
	previous: ProfileSwitchState,
	input: ProfileSwitchInput,
): { state: ProfileSwitchState; actions: ProfileSwitchAction[] } {
	const supported = input.devices
		.map((device) => ({ device, profileName: profileNameForDeviceType(device.type) }))
		.filter((entry): entry is { device: ProfileSwitchDevice; profileName: string } => entry.profileName !== undefined);

	if (!input.autoSwitchProfile) {
		return { state: { isInMeeting: input.isInMeeting, switchedDeviceIds: input.isInMeeting ? previous.switchedDeviceIds : [] }, actions: [] };
	}

	if (!previous.isInMeeting && input.isInMeeting) {
		const actions = supported.map(({ device, profileName }) => ({ deviceId: device.id, profileName }));
		return { state: { isInMeeting: true, switchedDeviceIds: actions.map((action) => action.deviceId) }, actions };
	}

	if (previous.isInMeeting && !input.isInMeeting) {
		const previouslySwitched = new Set(previous.switchedDeviceIds);
		const actions = supported
			.filter(({ device }) => previouslySwitched.has(device.id))
			.map(({ device }) => ({ deviceId: device.id }));
		return { state: { isInMeeting: false, switchedDeviceIds: [] }, actions };
	}

	return {
		state: {
			isInMeeting: input.isInMeeting,
			switchedDeviceIds: input.isInMeeting ? previous.switchedDeviceIds : [],
		},
		actions: [],
	};
}

import streamDeck from "@elgato/streamdeck";
import { chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BlurKey, CameraKey, ChatKey, HandKey, LeaveKey, MuteKey, PeopleKey, ReactKey, ShareKey, TimerKey } from "./actions/keys";
import { INITIAL_PROFILE_SWITCH_STATE, nextProfileSwitch, type ProfileSwitchState } from "./profiles";
import { TeamsBridge } from "./teams/bridge";
import type { Snapshot } from "./teams/protocol";
import { loadSelectors } from "./teams/selectors-loader";

streamDeck.logger.setLevel("info");

// The Swift helper is built next to this bundle (bin/teams-bridge). TEAMS_BRIDGE overrides it
// for the end-to-end smoke test, which substitutes a scripted fake.
const bridgePath = process.env.TEAMS_BRIDGE ?? join(dirname(fileURLToPath(import.meta.url)), "teams-bridge");

// `streamdeck pack` drops the executable bit, so an installed plugin can't launch its helper
// until it's restored. The plugin folder belongs to the user, so this is allowed.
try {
	chmodSync(bridgePath, 0o755);
} catch (error) {
	streamDeck.logger.error(`Can't make teams-bridge executable: ${(error as Error).message}`);
}

const selectorLoad = loadSelectors();
for (const problem of selectorLoad.problems) streamDeck.logger.warn(`selectors: ${problem}`);

const teams = new TeamsBridge({
	command: bridgePath,
	log: (message) => streamDeck.logger.info(`bridge: ${message}`),
	selectors: selectorLoad.selectors,
});

const keys = [
	new MuteKey(teams),
	new CameraKey(teams),
	new BlurKey(teams),
	new HandKey(teams),
	new LeaveKey(teams),
	new ReactKey(teams),
	new ChatKey(teams),
	new ShareKey(teams),
	new TimerKey(teams),
	new PeopleKey(teams),
];
for (const key of keys) streamDeck.actions.registerAction(key);

type GlobalSettings = { [key: string]: unknown; autoSwitchProfile?: boolean };

let autoSwitchProfile = false;
let profileSwitchState: ProfileSwitchState = INITIAL_PROFILE_SWITCH_STATE;

function applyGlobalSettings(settings: GlobalSettings): void {
	autoSwitchProfile = settings.autoSwitchProfile === true;
}

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => applyGlobalSettings(ev.settings));

function connectedProfileDevices() {
	const devices: { id: string; type: number }[] = [];
	streamDeck.devices.forEach((device) => {
		if (device.isConnected !== false) devices.push({ id: device.id, type: device.type });
	});
	return devices;
}

async function syncMeetingProfile(snapshot: Snapshot): Promise<void> {
	const result = nextProfileSwitch(profileSwitchState, {
		autoSwitchProfile,
		isInMeeting: snapshot.online && snapshot.state.isInMeeting,
		devices: connectedProfileDevices(),
	});
	profileSwitchState = result.state;
	for (const action of result.actions) {
		try {
			await streamDeck.profiles.switchToProfile(action.deviceId, action.profileName);
		} catch (error) {
			streamDeck.logger.warn(`profiles: couldn't switch ${action.deviceId}: ${(error as Error).message}`);
		}
	}
}

let lastReason: string | undefined = "starting";
teams.on("change", (snapshot) => {
	const reason =
		snapshot.reason === "teams-changed" ? "teams-changed"
		: snapshot.online ? (snapshot.state.isInMeeting ? "in a meeting" : "connected")
		: snapshot.reason;
	if (reason !== lastReason) {
		lastReason = reason;
		streamDeck.logger.info(`Teams: ${reason}`);
	}
	for (const key of keys) void key.refresh();
	void syncMeetingProfile(snapshot);
});

await streamDeck.connect();
try {
	applyGlobalSettings(await streamDeck.settings.getGlobalSettings<GlobalSettings>());
} catch (error) {
	streamDeck.logger.warn(`profiles: couldn't read global settings; auto-switch stays off: ${(error as Error).message}`);
}
teams.start();

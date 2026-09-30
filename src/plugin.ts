import streamDeck from "@elgato/streamdeck";
import { chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BlurKey, CameraKey, ChatKey, HandKey, LeaveKey, MuteKey, ReactKey, ShareKey } from "./actions/keys";
import { TeamsBridge } from "./teams/bridge";

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

const teams = new TeamsBridge({
	command: bridgePath,
	log: (message) => streamDeck.logger.info(`bridge: ${message}`),
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
];
for (const key of keys) streamDeck.actions.registerAction(key);

let lastReason: string | undefined = "starting";
teams.on("change", (snapshot) => {
	const reason = snapshot.online ? (snapshot.state.isInMeeting ? "in a meeting" : "connected") : snapshot.reason;
	if (reason !== lastReason) {
		lastReason = reason;
		streamDeck.logger.info(`Teams: ${reason}`);
	}
	for (const key of keys) void key.refresh();
});

await streamDeck.connect();
teams.start();

import streamDeck from "@elgato/streamdeck";

import { BlurKey, CameraKey, ChatKey, HandKey, LeaveKey, MuteKey, ReactKey, ShareKey } from "./actions/keys";
import { TeamsClient } from "./teams/client";

// Keep in step with "Version" in manifest.json. Teams shows it in its list of connected apps.
const VERSION = "0.2.0";

type GlobalSettings = { teamsToken?: string };

// Never "trace": that logs every message to disk, including the pairing token.
streamDeck.logger.setLevel("info");

const teams = new TeamsClient({
	identity: { manufacturer: "michaelp.ai", device: "Stream Deck", app: "Teams Controls", appVersion: VERSION },
	onToken: (teamsToken) => {
		streamDeck.logger.info("Paired with Teams; saving token");
		void streamDeck.settings.setGlobalSettings<GlobalSettings>({ teamsToken });
	},
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

let wasOnline = false;
teams.on("change", (snapshot) => {
	if (snapshot.online !== wasOnline) {
		wasOnline = snapshot.online;
		streamDeck.logger.info(snapshot.online ? "Connected to Teams" : "Teams unreachable; retrying");
	}
	for (const key of keys) void key.refresh();
});

await streamDeck.connect();
const { teamsToken } = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
teams.start(teamsToken);

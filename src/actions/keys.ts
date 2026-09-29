import { action } from "@elgato/streamdeck";

import { TeamsKey, type KeySettings } from "./teams-key";

// One class per key: Stream Deck identifies actions by UUID, and each UUID needs its own decorated class.
// UUIDs must match ai.michaelp.teams.sdPlugin/manifest.json.

@action({ UUID: "ai.michaelp.teams.mute" })
export class MuteKey extends TeamsKey {
	readonly kind = "mute";
	protected press = () => this.teams.request("toggle-mute");
}

@action({ UUID: "ai.michaelp.teams.camera" })
export class CameraKey extends TeamsKey {
	readonly kind = "camera";
	protected press = () => this.teams.request("toggle-video");
}

@action({ UUID: "ai.michaelp.teams.blur" })
export class BlurKey extends TeamsKey {
	readonly kind = "blur";
	protected press = () => this.teams.request("toggle-background-blur");
}

@action({ UUID: "ai.michaelp.teams.hand" })
export class HandKey extends TeamsKey {
	readonly kind = "hand";
	protected press = () => this.teams.request("toggle-hand");
}

@action({ UUID: "ai.michaelp.teams.leave" })
export class LeaveKey extends TeamsKey {
	readonly kind = "leave";
	protected press = () => this.teams.request("leave-call");
}

@action({ UUID: "ai.michaelp.teams.react" })
export class ReactKey extends TeamsKey {
	readonly kind = "react";
	protected press = (settings: KeySettings) =>
		this.teams.request("send-reaction", { type: settings.reaction ?? "like" });
}

@action({ UUID: "ai.michaelp.teams.chat" })
export class ChatKey extends TeamsKey {
	readonly kind = "chat";
	protected press = () => this.teams.request("toggle-ui", { type: "chat" });
}

/** Opens the share tray — or, while you're presenting, stops sharing. */
@action({ UUID: "ai.michaelp.teams.share" })
export class ShareKey extends TeamsKey {
	readonly kind = "share";
	protected press = () =>
		this.teams.snapshot.state.isSharing
			? this.teams.request("stop-sharing")
			: this.teams.request("toggle-ui", { type: "sharing-tray" });
}

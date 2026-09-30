import {
	action,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type TouchTapEvent,
} from "@elgato/streamdeck";

import { muteDialFeedback } from "../render/key";
import { HoldToggle, RotateToggle } from "./gestures";
import { TeamsKey, type KeySettings } from "./teams-key";

// One class per key: Stream Deck identifies actions by UUID, and each UUID needs its own decorated class.
// UUIDs must match ai.michaelp.tally.sdPlugin/manifest.json.

/**
 * Mute works on a key or a Stream Deck+ dial. On a dial: tap toggles, hold flips
 * the mic only while held (push-to-talk / cough button), turn right to unmute and
 * left to mute, touch the strip to toggle.
 */
@action({ UUID: "ai.michaelp.tally.mute" })
export class MuteKey extends TeamsKey {
	readonly kind = "mute";
	protected press = () => this.teams.request("toggle-mute");

	#hold = new HoldToggle();
	#rotate = new RotateToggle();

	protected override dialFeedback() {
		return muteDialFeedback(this.teams.snapshot);
	}

	override onDialDown(ev: DialDownEvent<KeySettings>): Promise<void> {
		this.#hold.down(this.#muted);
		return this.perform(ev.action, this.press());
	}

	override async onDialUp(ev: DialUpEvent<KeySettings>): Promise<void> {
		if (this.#hold.up(this.#muted)) await this.perform(ev.action, this.press());
	}

	override async onDialRotate(ev: DialRotateEvent<KeySettings>): Promise<void> {
		if (this.#rotate.shouldToggle(ev.payload.ticks, this.#muted)) await this.perform(ev.action, this.press());
	}

	override onTouchTap(ev: TouchTapEvent<KeySettings>): Promise<void> {
		return this.perform(ev.action, this.press());
	}

	get #muted(): boolean {
		return this.teams.snapshot.state.isMuted;
	}
}

@action({ UUID: "ai.michaelp.tally.camera" })
export class CameraKey extends TeamsKey {
	readonly kind = "camera";
	protected press = () => this.teams.request("toggle-video");
}

@action({ UUID: "ai.michaelp.tally.hand" })
export class HandKey extends TeamsKey {
	readonly kind = "hand";
	protected press = () => this.teams.request("toggle-hand");
}

@action({ UUID: "ai.michaelp.tally.leave" })
export class LeaveKey extends TeamsKey {
	readonly kind = "leave";
	protected press = () => this.teams.request("leave-call");
}

@action({ UUID: "ai.michaelp.tally.react" })
export class ReactKey extends TeamsKey {
	readonly kind = "react";
	protected press = (settings: KeySettings) =>
		this.teams.request("send-reaction", { type: settings.reaction ?? "like" });
}

@action({ UUID: "ai.michaelp.tally.chat" })
export class ChatKey extends TeamsKey {
	readonly kind = "chat";
	protected press = () => this.teams.request("toggle-ui", { type: "chat" });
}

/** Opens the share tray — or, while you're presenting, stops sharing. */
@action({ UUID: "ai.michaelp.tally.share" })
export class ShareKey extends TeamsKey {
	readonly kind = "share";
	protected press = () =>
		this.teams.snapshot.state.isSharing
			? this.teams.request("stop-sharing")
			: this.teams.request("toggle-ui", { type: "sharing-tray" });
}

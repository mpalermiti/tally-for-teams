import {
	action,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	type TouchTapEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { muteDialFeedback } from "../render/key";
import { HOLD_TO_LEAVE_MS, HoldToConfirm, HoldToggle, RotateToggle, shouldHoldMuteKey, shouldHoldToLeave } from "./gestures";
import { TeamsKey, type KeySettings } from "./teams-key";

// One class per key: Stream Deck identifies actions by UUID, and each UUID needs its own decorated class.
// UUIDs must match ai.michaelp.tally.sdPlugin/manifest.json.

/**
 * Mute works on a key or a Stream Deck+ dial. Tap toggles; hold flips the mic only
 * while held (push-to-talk / cough button). Dials can also turn right to unmute,
 * left to mute, and touch the strip to toggle.
 */
@action({ UUID: "ai.michaelp.tally.mute" })
export class MuteKey extends TeamsKey {
	readonly kind = "mute";
	protected press = () => this.teams.request("toggle-mute");

	#dialHold = new HoldToggle();
	#keyHolds = new Map<string, HoldToggle>();
	#rotate = new RotateToggle();

	protected override dialFeedback() {
		return muteDialFeedback(this.teams.snapshot);
	}

	override onKeyDown(ev: KeyDownEvent<KeySettings>): Promise<void> {
		if (!shouldHoldMuteKey({ isInMultiAction: ev.payload.isInMultiAction })) return super.onKeyDown(ev);
		const hold = new HoldToggle();
		hold.down(this.#muted);
		this.#keyHolds.set(ev.action.id, hold);
		return this.perform(ev.action, this.press());
	}

	override async onKeyUp(ev: KeyUpEvent<KeySettings>): Promise<void> {
		const hold = this.#keyHolds.get(ev.action.id);
		if (!hold) return;
		this.#keyHolds.delete(ev.action.id);
		if (hold.up(this.#muted)) await this.perform(ev.action, this.press());
	}

	override onWillDisappear(ev: WillDisappearEvent<KeySettings>): void {
		this.#keyHolds.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	override onDialDown(ev: DialDownEvent<KeySettings>): Promise<void> {
		this.#dialHold.down(this.#muted);
		return this.perform(ev.action, this.press());
	}

	override async onDialUp(ev: DialUpEvent<KeySettings>): Promise<void> {
		if (this.#dialHold.up(this.#muted)) await this.perform(ev.action, this.press());
	}

	override async onDialRotate(ev: DialRotateEvent<KeySettings>): Promise<void> {
		if (this.#rotate.shouldToggle(ev.payload.ticks, this.#muted)) await this.perform(ev.action, this.press());
	}

	override onTouchTap(ev: TouchTapEvent<KeySettings>): Promise<void> {
		return this.perform(ev.action, this.press());
	}

	get #muted(): boolean | undefined {
		const { state } = this.teams.snapshot;
		return state.isMuteKnown ? state.isMuted : undefined;
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

/** Leaves the meeting. With Hold to leave on, only a held press does, except while Teams is offline or in a multi-action. */
@action({ UUID: "ai.michaelp.tally.leave" })
export class LeaveKey extends TeamsKey {
	readonly kind = "leave";
	protected press = () => this.teams.request("leave-call");

	/** Holds in progress, by key, with the timer animating each. */
	#holds = new Map<string, { hold: HoldToConfirm; timer: ReturnType<typeof setInterval> }>();
	#hintSerials = new Map<string, number>();
	#nextHintSerial = 0;

	override onKeyDown(ev: KeyDownEvent<KeySettings>): Promise<void> {
		if (
			!shouldHoldToLeave({
				holdToLeave: ev.payload.settings.holdToLeave,
				isInMultiAction: ev.payload.isInMultiAction,
				teamsOnline: this.teams.snapshot.online,
			})
		) {
			return super.onKeyDown(ev);
		}
		this.#stop(ev.action.id);
		this.#hintSerials.delete(ev.action.id);
		const hold = new HoldToConfirm(HOLD_TO_LEAVE_MS);
		hold.start();
		const timer = setInterval(() => void this.#tick(ev.action, hold), 50);
		this.#holds.set(ev.action.id, { hold, timer });
		return this.setOverlay(ev.action, { progress: 0 });
	}

	override async onKeyUp(ev: KeyUpEvent<KeySettings>): Promise<void> {
		const held = this.#holds.get(ev.action.id);
		if (!held) return;
		if (held.hold.fire()) {
			this.#stop(ev.action.id);
			await this.setOverlay(ev.action, undefined);
			await this.perform(ev.action, this.press());
			return;
		}
		this.#stop(ev.action.id);
		if (!held.hold.release()) return;
		const hintSerial = ++this.#nextHintSerial;
		this.#hintSerials.set(ev.action.id, hintSerial);
		await this.setOverlay(ev.action, { hint: "Hold" });
		setTimeout(() => {
			if (!this.#holds.has(ev.action.id) && this.#hintSerials.get(ev.action.id) === hintSerial) {
				this.#hintSerials.delete(ev.action.id);
				void this.setOverlay(ev.action, undefined);
			}
		}, 1000);
	}

	override onWillDisappear(ev: WillDisappearEvent<KeySettings>): void {
		this.#stop(ev.action.id);
		this.#hintSerials.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	async #tick(action: KeyAction<KeySettings>, hold: HoldToConfirm): Promise<void> {
		if (this.#holds.get(action.id)?.hold !== hold) return;
		if (hold.fire()) {
			this.#stop(action.id);
			await this.setOverlay(action, undefined);
			await this.perform(action, this.press());
			return;
		}
		await this.setOverlay(action, { progress: hold.progress ?? 0 });
	}

	#stop(id: string): void {
		const held = this.#holds.get(id);
		if (!held) return;
		clearInterval(held.timer);
		this.#holds.delete(id);
	}
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

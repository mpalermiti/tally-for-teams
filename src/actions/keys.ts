import {
	action,
	SingletonAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { muteDialFeedback, timerDataUrl, type Tone } from "../render/key";
import type { RequestResult, Snapshot } from "../teams/protocol";
import { BackgroundBlurToggle } from "./blur";
import { HOLD_TO_LEAVE_MS, HoldToConfirm, HoldToggle, RotateToggle, shouldHoldMuteKey, shouldHoldToLeave } from "./gestures";
import { TeamsKey, type KeySettings } from "./teams-key";
import { KeyedMeetingTimers } from "./timer";

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
		const hold = this.#keyHold(ev.action.id);
		return this.perform(ev.action, hold.down(() => this.#muted, () => this.press()));
	}

	override async onKeyUp(ev: KeyUpEvent<KeySettings>): Promise<void> {
		const hold = this.#keyHolds.get(ev.action.id);
		if (!hold) return;
		await this.#releaseHold(hold, (result) => this.reportResult(ev.action, result, { alert: true }));
		this.#dropKeyHoldWhenIdle(ev.action.id, hold);
	}

	override onWillDisappear(ev: WillDisappearEvent<KeySettings>): void {
		if (ev.payload.controller === "Encoder") {
			if (this.#dialHold.hasHold) void this.#releaseHold(this.#dialHold, (result) => this.#logReleaseFailure(result));
		} else {
			const hold = this.#keyHolds.get(ev.action.id);
			if (hold?.hasHold) {
				void this.#releaseHold(hold, (result) => this.#logReleaseFailure(result)).finally(() =>
					this.#dropKeyHoldWhenIdle(ev.action.id, hold),
				);
			} else if (hold) {
				this.#dropKeyHoldWhenIdle(ev.action.id, hold);
			}
		}
		super.onWillDisappear(ev);
	}

	override onDialDown(ev: DialDownEvent<KeySettings>): Promise<void> {
		return this.perform(ev.action, this.#dialHold.down(() => this.#muted, () => this.press()));
	}

	override async onDialUp(ev: DialUpEvent<KeySettings>): Promise<void> {
		await this.#releaseHold(this.#dialHold, (result) => this.reportResult(ev.action, result, { alert: true }));
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

	#keyHold(id: string): HoldToggle {
		const existing = this.#keyHolds.get(id);
		if (existing) return existing;
		const hold = new HoldToggle();
		this.#keyHolds.set(id, hold);
		return hold;
	}

	async #releaseHold(hold: HoldToggle, report: (result: RequestResult) => Promise<void> | void): Promise<void> {
		if (!hold.hasHold) return;
		const result = await hold.up({
			currentMuted: () => this.#muted,
			waitForChange: (startMuted, timeoutMs) => this.#waitForMuteChange(startMuted, timeoutMs),
			warn: (message) => this.warn(message),
			toggleBack: () => this.teams.request("toggle-mute"),
		});
		if (result.toggledBack) await report(result.result);
	}

	#logReleaseFailure(result: RequestResult): void {
		if (!result.ok) this.warn(result.message);
	}

	#dropKeyHoldWhenIdle(id: string, hold: HoldToggle): void {
		if (this.#keyHolds.get(id) !== hold) return;
		if (hold.idle) {
			this.#keyHolds.delete(id);
			return;
		}
		void hold.whenIdle().finally(() => {
			if (this.#keyHolds.get(id) === hold && hold.idle) this.#keyHolds.delete(id);
		});
	}

	#waitForMuteChange(startMuted: boolean, timeoutMs: number): Promise<boolean> {
		if (this.#muted !== undefined && this.#muted !== startMuted) return Promise.resolve(true);

		return new Promise((resolve) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout>;
			const finish = (flipped: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.teams.off("change", onChange);
				resolve(flipped);
			};
			const onChange = (snapshot: Snapshot) => {
				const muted = snapshot.state.isMuteKnown ? snapshot.state.isMuted : undefined;
				if (muted !== undefined && muted !== startMuted) finish(true);
			};
			this.teams.on("change", onChange);
			timer = setTimeout(() => finish(false), timeoutMs);
			if (this.#muted !== undefined && this.#muted !== startMuted) finish(true);
		});
	}
}

@action({ UUID: "ai.michaelp.tally.camera" })
export class CameraKey extends TeamsKey {
	readonly kind = "camera";
	protected press = () => this.teams.request("toggle-video");
}

@action({ UUID: "ai.michaelp.tally.blur" })
export class BlurKey extends TeamsKey {
	readonly kind = "blur";
	#toggle = new BackgroundBlurToggle();

	protected press = async () => {
		const direction = this.#toggle.next();
		const result = await this.teams.request("set-background-blur", { type: direction === "on" ? "blur-on" : "blur-off" });
		this.#toggle.record(direction, result.ok);
		return result;
	};
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

@action({ UUID: "ai.michaelp.tally.people" })
export class PeopleKey extends TeamsKey {
	readonly kind = "people";
	protected press = () => this.teams.request("toggle-people");
}

@action({ UUID: "ai.michaelp.tally.timer" })
export class TimerKey extends SingletonAction<KeySettings> {
	#drawn = new Map<string, string>();
	#clocks = new KeyedMeetingTimers();
	#timers = new Map<string, ReturnType<typeof setInterval>>();

	constructor(private readonly teams: { snapshot: Snapshot }) {
		super();
	}

	override onWillAppear(ev: WillAppearEvent<KeySettings>): Promise<void> {
		this.#drawn.delete(ev.action.id);
		return ev.action.isKey() ? this.#sync(ev.action) : Promise.resolve();
	}

	override onWillDisappear(ev: WillDisappearEvent<KeySettings>): void {
		this.#stop(ev.action.id);
		this.#clocks.delete(ev.action.id);
		this.#drawn.delete(ev.action.id);
	}

	override onKeyDown(_ev: KeyDownEvent<KeySettings>): Promise<void> {
		return Promise.resolve();
	}

	async refresh(): Promise<void> {
		const draws: Promise<void>[] = [];
		this.actions.forEach((action) => {
			if (action.isKey()) draws.push(this.#sync(action));
		});
		await Promise.all(draws);
	}

	async #sync(action: KeyAction<KeySettings>): Promise<void> {
		const snapshot = this.teams.snapshot;
		if (!snapshot.online) {
			this.#stop(action.id);
			this.#clocks.delete(action.id);
			await this.#draw(action, undefined, "offline");
			return;
		}

		if (!snapshot.state.isInMeeting) {
			this.#stop(action.id);
			this.#clocks.delete(action.id);
			await this.#draw(action, undefined, "idle");
			return;
		}

		const seconds = this.#clocks.update(action.id, {
			isInMeeting: true,
			elapsedSeconds: snapshot.state.meetingElapsedSeconds,
		});
		if (seconds !== undefined) this.#start(action);
		await this.#draw(action, seconds, "ready");
	}

	#start(action: KeyAction<KeySettings>): void {
		if (this.#timers.has(action.id)) return;
		this.#timers.set(action.id, setInterval(() => void this.#drawRunning(action), 1_000));
	}

	#stop(id: string): void {
		const timer = this.#timers.get(id);
		if (timer) clearInterval(timer);
		this.#timers.delete(id);
	}

	#drawRunning(action: KeyAction<KeySettings>): Promise<void> {
		return this.#draw(action, this.#clocks.currentSeconds(action.id), "ready");
	}

	async #draw(action: KeyAction<KeySettings>, seconds: number | undefined, tone: Tone): Promise<void> {
		const image = timerDataUrl(seconds, tone);
		if (this.#drawn.get(action.id) === image) return;
		this.#drawn.set(action.id, image);
		await action.setImage(image);
	}
}

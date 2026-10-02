/**
 * Gestures for meeting controls, kept free of Stream Deck types so they're tested directly.
 * Teams' API only offers toggle-mute, so each gesture decides *whether* to toggle
 * based on the current mute state.
 */

import type { RequestResult } from "../teams/protocol";

const DEFAULT_HOLD_RELEASE_TIMEOUT_MS = 1_500;

type MuteGetter = () => boolean | undefined;
type MuteChangeWaiter = (startMuted: boolean, timeoutMs: number) => Promise<boolean>;

export type HoldReleaseResult =
	| { toggledBack: false }
	| { toggledBack: true; result: RequestResult };

export async function resolveHoldRelease({
	startMuted,
	press,
	currentMuted,
	waitForChange,
	timeoutMs = DEFAULT_HOLD_RELEASE_TIMEOUT_MS,
	warn,
}: {
	startMuted: boolean | undefined;
	press: Promise<RequestResult>;
	currentMuted: MuteGetter;
	waitForChange: MuteChangeWaiter;
	timeoutMs?: number;
	warn?: (message: string) => void;
}): Promise<boolean> {
	const result = await press;
	if (!result.ok || startMuted === undefined) return false;

	const muted = currentMuted();
	if (muted !== undefined && muted !== startMuted) return true;

	if (await waitForChange(startMuted, timeoutMs)) return true;

	warn?.("Teams accepted the held mute press but never reported the mic state change; not toggling back");
	return false;
}

/**
 * Tap to toggle; hold to flip temporarily. Muted + hold = push-to-talk,
 * live + hold = cough button. The first toggle happens on press so a tap feels instant.
 */
export class HoldToggle {
	#down: { at: number; muted: boolean | undefined; press: Promise<RequestResult> } | undefined;
	#downReady: Promise<void> | undefined;
	#release: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly thresholdMs = 400,
		private readonly now: () => number = () => performance.now(),
	) {}

	/** Always toggles; remembers the state it started from. */
	down(currentMuted: MuteGetter, press: () => Promise<RequestResult>): Promise<RequestResult> {
		const at = this.now();
		let request: Promise<RequestResult>;
		const started = this.#release.then(() => {
			const muted = currentMuted();
			request = press();
			this.#down = { at, muted, press: request };
		});
		this.#downReady = started.then(
			() => undefined,
			() => undefined,
		);
		return started.then(() => request);
	}

	/** Toggles back only after a hold, and only if the first toggle actually landed. */
	up({
		currentMuted,
		waitForChange,
		timeoutMs,
		warn,
		toggleBack,
	}: {
		currentMuted: MuteGetter;
		waitForChange: MuteChangeWaiter;
		timeoutMs?: number;
		warn?: (message: string) => void;
		toggleBack: () => Promise<RequestResult>;
	}): Promise<HoldReleaseResult> {
		const releasedAt = this.now();
		const downReady = this.#downReady ?? Promise.resolve();

		const release = (async (): Promise<HoldReleaseResult> => {
			await downReady;
			const down = this.#down;
			this.#down = undefined;
			if (this.#downReady === downReady) this.#downReady = undefined;
			if (!down) return { toggledBack: false };
			const held = releasedAt - down.at >= this.thresholdMs;
			if (!held) return { toggledBack: false };

			const shouldToggleBack = await resolveHoldRelease({
				startMuted: down.muted,
				press: down.press,
				currentMuted,
				waitForChange,
				timeoutMs,
				warn,
			});
			if (!shouldToggleBack) return { toggledBack: false };
			return { toggledBack: true, result: await toggleBack() };
		})();
		this.#release = release.then(
			() => undefined,
			() => undefined,
		);
		return release;
	}
}

/**
 * Turn right to unmute, left to mute. One physical turn arrives as a burst of
 * tick events before Teams reports the new state, so a short cooldown stops
 * the burst from toggling back and forth.
 */
export class RotateToggle {
	#cooldownUntil = 0;

	constructor(
		private readonly cooldownMs = 500,
		private readonly now: () => number = () => performance.now(),
	) {}

	shouldToggle(ticks: number, muted: boolean | undefined): boolean {
		if (this.now() < this.#cooldownUntil) return false;
		if (muted === undefined) return false;
		const wantsMuted = ticks < 0;
		if (ticks === 0 || wantsMuted === muted) return false;
		this.#cooldownUntil = this.now() + this.cooldownMs;
		return true;
	}
}

/** How long "Hold to leave" needs the Leave key held. */
export const HOLD_TO_LEAVE_MS = 600;

export function shouldHoldToLeave({
	holdToLeave,
	isInMultiAction,
	teamsOnline,
}: {
	holdToLeave?: boolean;
	isInMultiAction?: boolean;
	teamsOnline: boolean;
}): boolean {
	return Boolean(holdToLeave && !isInMultiAction && teamsOnline);
}

export function shouldHoldMuteKey({ isInMultiAction }: { isInMultiAction?: boolean }): boolean {
	return !isInMultiAction;
}

/**
 * A press that only counts once held for `holdMs`, so a tap can't do something drastic.
 * The caller polls `progress` to animate and `fire()` to act; `release()` says whether
 * the press ended too early to count.
 */
export class HoldToConfirm {
	#startedAt: number | undefined;
	#fired = false;

	constructor(
		private readonly holdMs = HOLD_TO_LEAVE_MS,
		private readonly now: () => number = () => performance.now(),
	) {}

	start(): void {
		this.#startedAt = this.now();
		this.#fired = false;
	}

	/** How far through the hold, 0–1, or undefined when not held. */
	get progress(): number | undefined {
		if (this.#startedAt === undefined) return undefined;
		return Math.max(0, Math.min(1, (this.now() - this.#startedAt) / this.holdMs));
	}

	/** True exactly once per hold, the first time it's asked after the hold completes. */
	fire(): boolean {
		if (this.#fired || (this.progress ?? 0) < 1) return false;
		this.#fired = true;
		return true;
	}

	/** Ends the hold. True if it ended before firing, i.e. it was only a tap. */
	release(): boolean {
		const early = this.#startedAt !== undefined && !this.#fired;
		this.#startedAt = undefined;
		return early;
	}
}

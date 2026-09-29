/**
 * Dial gestures for mute, kept free of Stream Deck types so they're tested directly.
 * Teams' API only offers toggle-mute, so each gesture decides *whether* to toggle
 * based on the current mute state.
 */

/**
 * Tap to toggle; hold to flip temporarily. Muted + hold = push-to-talk,
 * live + hold = cough button. The first toggle happens on press so a tap feels instant.
 */
export class HoldToggle {
	#down: { at: number; muted: boolean } | undefined;

	constructor(
		private readonly thresholdMs = 400,
		private readonly now: () => number = Date.now,
	) {}

	/** Always toggles; remembers the state it started from. */
	down(muted: boolean): true {
		this.#down = { at: this.now(), muted };
		return true;
	}

	/** Toggles back only after a hold, and only if the first toggle actually landed. */
	up(muted: boolean): boolean {
		const down = this.#down;
		this.#down = undefined;
		if (!down) return false;
		const held = this.now() - down.at >= this.thresholdMs;
		return held && muted !== down.muted;
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
		private readonly now: () => number = Date.now,
	) {}

	shouldToggle(ticks: number, muted: boolean): boolean {
		if (this.now() < this.#cooldownUntil) return false;
		const wantsMuted = ticks < 0;
		if (ticks === 0 || wantsMuted === muted) return false;
		this.#cooldownUntil = this.now() + this.cooldownMs;
		return true;
	}
}

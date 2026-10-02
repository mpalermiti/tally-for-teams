export interface MeetingTimerReading {
	isInMeeting: boolean;
	elapsedSeconds?: number;
}

export class MeetingTimer {
	#startedAtMs: number | undefined;
	#lastReading: number | undefined;

	constructor(private readonly now: () => number = () => Date.now()) {}

	update(reading: MeetingTimerReading): number | undefined {
		if (!reading.isInMeeting) {
			this.reset();
			return undefined;
		}

		if (reading.elapsedSeconds !== undefined) {
			if (this.#startedAtMs === undefined) {
				this.#sync(reading.elapsedSeconds);
			} else if (reading.elapsedSeconds !== this.#lastReading) {
				const current = this.currentSeconds();
				if (current === undefined || Math.abs(current - reading.elapsedSeconds) >= 2) this.#sync(reading.elapsedSeconds);
			}
			this.#lastReading = reading.elapsedSeconds;
		}

		return this.currentSeconds();
	}

	currentSeconds(): number | undefined {
		if (this.#startedAtMs === undefined) return undefined;
		return Math.max(0, Math.floor((this.now() - this.#startedAtMs) / 1_000));
	}

	reset(): void {
		this.#startedAtMs = undefined;
		this.#lastReading = undefined;
	}

	#sync(elapsedSeconds: number): void {
		this.#startedAtMs = this.now() - elapsedSeconds * 1_000;
	}
}

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

export class KeyedMeetingTimers {
	#clocks = new Map<string, MeetingTimer>();

	constructor(private readonly now: () => number = () => Date.now()) {}

	update(id: string, reading: MeetingTimerReading): number | undefined {
		return this.#clock(id).update(reading);
	}

	currentSeconds(id: string): number | undefined {
		return this.#clocks.get(id)?.currentSeconds();
	}

	delete(id: string): void {
		this.#clocks.delete(id);
	}

	#clock(id: string): MeetingTimer {
		const existing = this.#clocks.get(id);
		if (existing) return existing;
		const clock = new MeetingTimer(this.now);
		this.#clocks.set(id, clock);
		return clock;
	}
}

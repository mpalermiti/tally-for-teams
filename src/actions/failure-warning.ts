import type { KeyKind } from "../render/key";
import type { RequestResult } from "../teams/protocol";

export const MEETING_WINDOW_NOT_FOCUSED = "meeting-window-not-focused";
export const FAILURE_WARNING_RATE_LIMIT_MS = 30_000;

export class FailureWarningLimiter {
	#lastWarnings = new Map<string, number>();

	constructor(
		public now: () => number = () => performance.now(),
		private readonly intervalMs = FAILURE_WARNING_RATE_LIMIT_MS,
	) {}

	shouldWarn(kind: KeyKind, result: RequestResult): boolean {
		if (result.error !== MEETING_WINDOW_NOT_FOCUSED) return true;

		const now = this.now();
		const last = this.#lastWarnings.get(kind);
		if (last !== undefined && now - last < this.intervalMs) return false;

		this.#lastWarnings.set(kind, now);
		return true;
	}
}

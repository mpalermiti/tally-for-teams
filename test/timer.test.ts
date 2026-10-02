import { afterEach, describe, expect, it, vi } from "vitest";

import { MeetingTimer } from "../src/actions/timer";

describe("MeetingTimer", () => {
	afterEach(() => vi.useRealTimers());

	it("keeps ticking from the last known start while an in-meeting snapshot has no duration", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const timer = new MeetingTimer(() => Date.now());

		expect(timer.update({ isInMeeting: true, elapsedSeconds: 10 })).toBe(10);
		vi.setSystemTime(1_000);
		expect(timer.update({ isInMeeting: true, elapsedSeconds: undefined })).toBe(11);
		vi.setSystemTime(2_000);
		expect(timer.currentSeconds()).toBe(12);

		expect(timer.update({ isInMeeting: false, elapsedSeconds: undefined })).toBeUndefined();
	});

	it("does not resync from an unchanged reading, but accepts a fresh reading that disagrees by at least two seconds", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const timer = new MeetingTimer(() => Date.now());

		expect(timer.update({ isInMeeting: true, elapsedSeconds: 10 })).toBe(10);
		vi.setSystemTime(3_000);
		expect(timer.update({ isInMeeting: true, elapsedSeconds: 10 })).toBe(13);
		expect(timer.update({ isInMeeting: true, elapsedSeconds: 11 })).toBe(11);
	});
});

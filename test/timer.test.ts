import { afterEach, describe, expect, it, vi } from "vitest";

import { KeyedMeetingTimers, MeetingTimer } from "../src/actions/timer";

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
		vi.setSystemTime(1_000);
		expect(timer.update({ isInMeeting: true, elapsedSeconds: 12 })).toBe(11);
		vi.setSystemTime(3_000);
		expect(timer.update({ isInMeeting: true, elapsedSeconds: 12 })).toBe(13);
		expect(timer.update({ isInMeeting: true, elapsedSeconds: 11 })).toBe(11);
	});

	it("treats a much smaller fresh reading as a new meeting timer", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const timer = new MeetingTimer(() => Date.now());

		expect(timer.update({ isInMeeting: true, elapsedSeconds: 30 * 60 })).toBe(30 * 60);
		vi.setSystemTime(32 * 60 * 1_000);
		expect(timer.currentSeconds()).toBe(62 * 60);

		expect(timer.update({ isInMeeting: true, elapsedSeconds: 8 })).toBe(8);
		vi.setSystemTime(32 * 60 * 1_000 + 1_000);
		expect(timer.currentSeconds()).toBe(9);
	});
});

describe("KeyedMeetingTimers", () => {
	afterEach(() => vi.useRealTimers());

	it("forgets a disappeared key's local clock so a new meeting cannot inherit stale time", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const timers = new KeyedMeetingTimers(() => Date.now());

		expect(timers.update("timer-1", { isInMeeting: true, elapsedSeconds: 10 * 60 })).toBe(10 * 60);
		timers.delete("timer-1");

		vi.setSystemTime(10 * 60 * 1_000);
		expect(timers.update("timer-1", { isInMeeting: true, elapsedSeconds: undefined })).toBeUndefined();
	});
});

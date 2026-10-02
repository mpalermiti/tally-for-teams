import { afterEach, describe, expect, it, vi } from "vitest";

import {
	HoldToConfirm,
	HoldToggle,
	RotateToggle,
	resolveHoldRelease,
	shouldHoldMuteKey,
	shouldHoldToLeave,
} from "../src/actions/gestures";
import type { RequestResult } from "../src/teams/protocol";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/** A controllable clock. */
function clock(start = 1_000) {
	let t = start;
	return { now: () => t, advance: (ms: number) => (t += ms) };
}

const OK: RequestResult = { ok: true, message: "pressed" };
const REFUSED: RequestResult = { ok: false, message: "no mic" };
const releaseDefaults = () => ({
	currentMuted: () => false as boolean | undefined,
	waitForChange: () => Promise.resolve(false),
	toggleBack: () => Promise.resolve(OK),
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function delayedTeamsMute(initialMuted: boolean) {
	let actual = initialMuted;
	let reported = initialMuted;
	const waiters = new Set<() => void>();

	const notify = () => {
		for (const waiter of [...waiters]) waiter();
	};
	const waitUntil = (condition: () => boolean, timeoutMs: number) => {
		if (condition()) return Promise.resolve(true);
		return new Promise<boolean>((resolve) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout>;
			const finish = (matched: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				waiters.delete(check);
				resolve(matched);
			};
			const check = () => {
				if (condition()) finish(true);
			};
			waiters.add(check);
			timer = setTimeout(() => finish(false), timeoutMs);
		});
	};

	return {
		get actual() {
			return actual;
		},
		get reported() {
			return reported;
		},
		current: () => reported,
		pressWithReportLag: (lagMs: number) => {
			const next = !actual;
			actual = next;
			setTimeout(() => {
				reported = next;
				notify();
			}, lagMs);
			return Promise.resolve(OK);
		},
		waitForChange: (startMuted: boolean, timeoutMs: number) => waitUntil(() => reported !== startMuted, timeoutMs),
	};
}

describe("resolveHoldRelease", () => {
	it("doesn't toggle back when Teams refused the key-down press", async () => {
		const waitForChange = vi.fn(() => Promise.resolve(true));
		await expect(
			resolveHoldRelease({
				startMuted: true,
				press: Promise.resolve(REFUSED),
				currentMuted: () => false,
				waitForChange,
			}),
		).resolves.toBe(false);
		expect(waitForChange).not.toHaveBeenCalled();
	});

	it("toggles back when Teams has already reported the flipped mute state", async () => {
		await expect(
			resolveHoldRelease({
				startMuted: true,
				press: Promise.resolve(OK),
				currentMuted: () => false,
				waitForChange: () => Promise.resolve(false),
			}),
		).resolves.toBe(true);
	});

	it("waits for a later bridge change before toggling back", async () => {
		vi.useFakeTimers();
		const flip = deferred<boolean>();
		const resolved = resolveHoldRelease({
			startMuted: true,
			press: Promise.resolve(OK),
			currentMuted: () => true,
			waitForChange: (_start, timeoutMs) =>
				new Promise((resolve) => {
					setTimeout(() => resolve(false), timeoutMs);
					flip.promise.then(resolve);
				}),
			timeoutMs: 1_500,
		});

		await vi.advanceTimersByTimeAsync(300);
		flip.resolve(true);

		await expect(resolved).resolves.toBe(true);
	});

	it("doesn't toggle back, and warns, when Teams never reports the flipped mute state", async () => {
		vi.useFakeTimers();
		const warn = vi.fn();
		const resolved = resolveHoldRelease({
			startMuted: true,
			press: Promise.resolve(OK),
			currentMuted: () => true,
			waitForChange: (_start, timeoutMs) => new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
			timeoutMs: 1_500,
			warn,
		});

		await vi.advanceTimersByTimeAsync(1_500);

		await expect(resolved).resolves.toBe(false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("never reported"));
	});

	it("keeps unknown mute state as a single toggle with no toggle-back", async () => {
		const waitForChange = vi.fn(() => Promise.resolve(true));
		await expect(
			resolveHoldRelease({
				startMuted: undefined,
				press: Promise.resolve(OK),
				currentMuted: () => false,
				waitForChange,
			}),
		).resolves.toBe(false);
		expect(waitForChange).not.toHaveBeenCalled();
	});
});

describe("HoldToggle", () => {
	it("toggles immediately on press, so a tap feels instant", async () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		await expect(hold.down(() => true, () => Promise.resolve(OK))).resolves.toBe(OK);
		c.advance(120);
		await expect(hold.up(releaseDefaults())).resolves.toMatchObject({ toggledBack: false }); // tap: stay toggled
	});

	it("toggles back on release after a hold (push-to-talk when muted)", async () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		await hold.down(() => true, () => Promise.resolve(OK)); // muted → unmute
		c.advance(900);
		await expect(hold.up(releaseDefaults())).resolves.toMatchObject({ toggledBack: true, result: OK }); // now live → re-mute
	});

	it("works the other way round as a cough button when live", async () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		await hold.down(() => false, () => Promise.resolve(OK));
		c.advance(600);
		await expect(
			hold.up({
				...releaseDefaults(),
				currentMuted: () => true,
			}),
		).resolves.toMatchObject({ toggledBack: true, result: OK });
	});

	it("doesn't toggle back if Teams never applied the first toggle", async () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		await hold.down(() => true, () => Promise.resolve(OK));
		c.advance(900);
		await expect(
			hold.up({
				...releaseDefaults(),
				currentMuted: () => true,
			}),
		).resolves.toMatchObject({ toggledBack: false }); // still muted: toggling would unmute by surprise
	});

	it("treats an unknown mute state as a single toggle with no release toggle-back", async () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		await expect(hold.down(() => undefined, () => Promise.resolve(OK))).resolves.toBe(OK);
		c.advance(900);
		await expect(hold.up(releaseDefaults())).resolves.toMatchObject({ toggledBack: false });
	});

	it("ignores a release with no matching press", async () => {
		await expect(new HoldToggle().up(releaseDefaults())).resolves.toMatchObject({ toggledBack: false });
	});

	it("uses a monotonic default clock, so a backwards wall-clock step still releases a hold", async () => {
		vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(500);
		vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(500);
		const hold = new HoldToggle(400);
		await hold.down(() => true, () => Promise.resolve(OK));
		await expect(hold.up(releaseDefaults())).resolves.toMatchObject({ toggledBack: true, result: OK });
	});

	it("serializes the next hold until the previous release finishes toggling back", async () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		await hold.down(() => true, () => Promise.resolve(OK));
		c.advance(900);

		const flip = deferred<boolean>();
		const toggleBack = deferred<RequestResult>();
		const firstRelease = hold.up({
			...releaseDefaults(),
			currentMuted: () => true,
			waitForChange: () => flip.promise,
			toggleBack: () => toggleBack.promise,
		});

		let reads = 0;
		let presses = 0;
		const secondDown = hold.down(
			() => {
				reads++;
				return false;
			},
			() => {
				presses++;
				return Promise.resolve(OK);
			},
		);
		await Promise.resolve();
		expect(reads).toBe(0);
		expect(presses).toBe(0);

		flip.resolve(true);
		await Promise.resolve();
		expect(reads).toBe(0);
		expect(presses).toBe(0);

		toggleBack.resolve(OK);
		await expect(firstRelease).resolves.toMatchObject({ toggledBack: true, result: OK });
		await expect(secondDown).resolves.toBe(OK);
		expect(reads).toBe(1);
		expect(presses).toBe(1);
	});

	it("queues a re-hold release until the delayed down has started", async () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		let muted = true;
		await hold.down(() => muted, () => Promise.resolve(OK));
		c.advance(900);

		const firstFlip = deferred<boolean>();
		const firstToggleBack = deferred<RequestResult>();
		const firstRelease = hold.up({
			...releaseDefaults(),
			currentMuted: () => muted,
			waitForChange: () =>
				firstFlip.promise.then((flipped) => {
					if (flipped) muted = false;
					return flipped;
				}),
			toggleBack: () =>
				firstToggleBack.promise.then((result) => {
					muted = true;
					return result;
				}),
		});

		const secondDown = hold.down(
			() => muted,
			() => {
				muted = false;
				return Promise.resolve(OK);
			},
		);
		c.advance(500);
		const secondRelease = hold.up({
			...releaseDefaults(),
			currentMuted: () => muted,
			toggleBack: () => {
				muted = true;
				return Promise.resolve(OK);
			},
		});
		let secondResolved = false;
		void secondRelease.then(() => {
			secondResolved = true;
		});
		await Promise.resolve();
		expect(secondResolved).toBe(false);

		firstFlip.resolve(true);
		firstToggleBack.resolve(OK);

		await expect(firstRelease).resolves.toMatchObject({ toggledBack: true, result: OK });
		await expect(secondDown).resolves.toBe(OK);
		await expect(secondRelease).resolves.toMatchObject({ toggledBack: true, result: OK });
		expect(muted).toBe(true);
	});

	async function expectQuickSecondHoldRestores(initialMuted: boolean) {
		vi.useFakeTimers();
		const c = clock();
		const mic = delayedTeamsMute(initialMuted);
		const hold = new HoldToggle(400, c.now);
		const releaseOptions = () => ({
			...releaseDefaults(),
			currentMuted: mic.current,
			waitForChange: mic.waitForChange,
		});

		await hold.down(mic.current, () => mic.pressWithReportLag(150));
		await vi.advanceTimersByTimeAsync(150);
		expect(mic.reported).toBe(!initialMuted);

		c.advance(900);
		const firstRelease = hold.up({
			...releaseOptions(),
			toggleBack: () => mic.pressWithReportLag(150),
		});

		c.advance(10);
		const secondDown = hold.down(mic.current, () => mic.pressWithReportLag(500));
		await vi.advanceTimersByTimeAsync(550);

		c.advance(700);
		const secondRelease = hold.up({
			...releaseOptions(),
			toggleBack: () => mic.pressWithReportLag(150),
		});

		await vi.advanceTimersByTimeAsync(2_000);
		await expect(firstRelease).resolves.toMatchObject({ toggledBack: true, result: OK });
		await expect(secondDown).resolves.toBe(OK);
		await expect(secondRelease).resolves.toMatchObject({ toggledBack: true, result: OK });
		expect(mic.actual).toBe(initialMuted);
		expect(mic.reported).toBe(initialMuted);
	}

	it("keeps push-to-talk muted after a quick second hold with delayed Teams reports", async () => {
		await expectQuickSecondHoldRestores(true);
	});

	it("keeps the cough button live after a quick second hold with delayed Teams reports", async () => {
		await expectQuickSecondHoldRestores(false);
	});
});

describe("RotateToggle", () => {
	it("unmutes on a clockwise turn and mutes on a counter-clockwise one", () => {
		const c = clock();
		const rotate = new RotateToggle(500, c.now);
		expect(rotate.shouldToggle(1, true)).toBe(true);
		c.advance(600);
		expect(rotate.shouldToggle(-1, false)).toBe(true);
	});

	it("does nothing when already in the requested state", () => {
		const rotate = new RotateToggle();
		expect(rotate.shouldToggle(2, false)).toBe(false); // already live
		expect(rotate.shouldToggle(-2, true)).toBe(false); // already muted
	});

	it("does nothing when the mute state is unknown", () => {
		const rotate = new RotateToggle();
		expect(rotate.shouldToggle(2, undefined)).toBe(false);
		expect(rotate.shouldToggle(-2, undefined)).toBe(false);
	});

	it("ignores the burst of ticks from one turn while Teams catches up", () => {
		const c = clock();
		const rotate = new RotateToggle(500, c.now);
		expect(rotate.shouldToggle(1, true)).toBe(true);
		c.advance(80);
		expect(rotate.shouldToggle(1, true)).toBe(false); // state not updated yet; don't double-toggle
		c.advance(500);
		expect(rotate.shouldToggle(1, true)).toBe(true);
	});

	it("uses a monotonic default clock, so a backwards wall-clock step doesn't stretch the cooldown", () => {
		vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_000).mockReturnValueOnce(900);
		vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(600);
		const rotate = new RotateToggle(500);
		expect(rotate.shouldToggle(1, true)).toBe(true);
		expect(rotate.shouldToggle(-1, false)).toBe(true);
	});
});

describe("shouldHoldToLeave", () => {
	it("holds whenever the option is on and Teams is readable, even if the leave key is only idle", () => {
		expect(shouldHoldToLeave({ holdToLeave: true, isInMultiAction: false, teamsOnline: true })).toBe(true);
	});

	it("skips the hold only when disabled, in a multi-action, or Teams is offline", () => {
		expect(shouldHoldToLeave({ holdToLeave: false, isInMultiAction: false, teamsOnline: true })).toBe(false);
		expect(shouldHoldToLeave({ holdToLeave: true, isInMultiAction: true, teamsOnline: true })).toBe(false);
		expect(shouldHoldToLeave({ holdToLeave: true, isInMultiAction: false, teamsOnline: false })).toBe(false);
	});
});

describe("shouldHoldMuteKey", () => {
	it("allows hold-to-talk on ordinary Mute keys, but not inside multi-actions", () => {
		expect(shouldHoldMuteKey({ isInMultiAction: false })).toBe(true);
		expect(shouldHoldMuteKey({})).toBe(true);
		expect(shouldHoldMuteKey({ isInMultiAction: true })).toBe(false);
	});
});

describe("HoldToConfirm", () => {
	it("reports progress while held and fires once when the hold completes", () => {
		const c = clock();
		const hold = new HoldToConfirm(600, c.now);
		expect(hold.progress).toBeUndefined();
		hold.start();
		c.advance(300);
		expect(hold.progress).toBeCloseTo(0.5);
		expect(hold.fire()).toBe(false);
		c.advance(300);
		expect(hold.progress).toBe(1);
		expect(hold.fire()).toBe(true);
		expect(hold.fire()).toBe(false); // once per hold
	});

	it("calls an early release a tap, which shouldn't count", () => {
		const c = clock();
		const hold = new HoldToConfirm(600, c.now);
		hold.start();
		c.advance(200);
		expect(hold.release()).toBe(true);
		expect(hold.progress).toBeUndefined();
	});

	it("never reports negative progress if the clock goes backwards", () => {
		const c = clock();
		const hold = new HoldToConfirm(600, c.now);
		hold.start();
		c.advance(-100);
		expect(hold.progress).toBe(0);
		expect(hold.fire()).toBe(false);
	});

	it("doesn't call it a tap once the hold has fired", () => {
		const c = clock();
		const hold = new HoldToConfirm(600, c.now);
		hold.start();
		c.advance(700);
		hold.fire();
		expect(hold.release()).toBe(false);
	});

	it("ignores a release without a press", () => {
		expect(new HoldToConfirm(600, clock().now).release()).toBe(false);
	});
});

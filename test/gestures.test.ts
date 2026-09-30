import { describe, expect, it } from "vitest";

import { HoldToConfirm, HoldToggle, RotateToggle } from "../src/actions/gestures";

/** A controllable clock. */
function clock(start = 1_000) {
	let t = start;
	return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("HoldToggle", () => {
	it("toggles immediately on press, so a tap feels instant", () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		expect(hold.down(true)).toBe(true);
		c.advance(120);
		expect(hold.up(false)).toBe(false); // tap: stay toggled
	});

	it("toggles back on release after a hold (push-to-talk when muted)", () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		hold.down(true); // muted → unmute
		c.advance(900);
		expect(hold.up(false)).toBe(true); // now live → re-mute
	});

	it("works the other way round as a cough button when live", () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		hold.down(false);
		c.advance(600);
		expect(hold.up(true)).toBe(true);
	});

	it("doesn't toggle back if Teams never applied the first toggle", () => {
		const c = clock();
		const hold = new HoldToggle(400, c.now);
		hold.down(true);
		c.advance(900);
		expect(hold.up(true)).toBe(false); // still muted: toggling would unmute by surprise
	});

	it("ignores a release with no matching press", () => {
		expect(new HoldToggle().up(true)).toBe(false);
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

	it("ignores the burst of ticks from one turn while Teams catches up", () => {
		const c = clock();
		const rotate = new RotateToggle(500, c.now);
		expect(rotate.shouldToggle(1, true)).toBe(true);
		c.advance(80);
		expect(rotate.shouldToggle(1, true)).toBe(false); // state not updated yet; don't double-toggle
		c.advance(500);
		expect(rotate.shouldToggle(1, true)).toBe(true);
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

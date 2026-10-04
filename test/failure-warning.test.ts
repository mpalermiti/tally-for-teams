import { describe, expect, it } from "vitest";

import { FailureWarningLimiter } from "../src/actions/failure-warning";

describe("FailureWarningLimiter", () => {
	it("rate-limits the meeting-window focus warning per key kind", () => {
		const warnings = new FailureWarningLimiter(() => 1_000);
		const message = "Teams' main window has focus, so its menus can't close from the background. Click the meeting window once.";

		expect(warnings.shouldWarn("react", { ok: false, message, error: "meeting-window-not-focused" })).toBe(true);
		expect(warnings.shouldWarn("react", { ok: false, message, error: "meeting-window-not-focused" })).toBe(false);
		expect(warnings.shouldWarn("blur", { ok: false, message, error: "meeting-window-not-focused" })).toBe(true);

		warnings.now = () => 30_999;
		expect(warnings.shouldWarn("react", { ok: false, message, error: "meeting-window-not-focused" })).toBe(false);

		warnings.now = () => 31_000;
		expect(warnings.shouldWarn("react", { ok: false, message, error: "meeting-window-not-focused" })).toBe(true);
	});

	it("doesn't rate-limit ordinary failures", () => {
		const warnings = new FailureWarningLimiter(() => 1_000);
		const result = { ok: false, message: "No like-button in reaction-menu-button menu" };

		expect(warnings.shouldWarn("react", result)).toBe(true);
		expect(warnings.shouldWarn("react", result)).toBe(true);
	});
});

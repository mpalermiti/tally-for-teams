import { describe, expect, it } from "vitest";

import { chooseBackgroundBlurTarget, chooseBackgroundBlurTargetFromMenu, selectedStateFromAttributes } from "../src/actions/blur";

describe("selectedStateFromAttributes", () => {
	it("treats a non-empty menu mark char as selected even when AXSelected is false", () => {
		expect(selectedStateFromAttributes({ axSelected: 0, axMenuItemMarkChar: "✓" })).toBe(true);
	});

	it("treats AXValue 1 as selected", () => {
		expect(selectedStateFromAttributes({ axValue: 1 })).toBe(true);
		expect(selectedStateFromAttributes({ axValue: "1" })).toBe(true);
		expect(selectedStateFromAttributes({ axValue: "true" })).toBe(true);
	});

	it("is unreadable only when no selected-state attributes exist", () => {
		expect(selectedStateFromAttributes({})).toBeUndefined();
		expect(selectedStateFromAttributes({ axSelected: 0 })).toBe(false);
		expect(selectedStateFromAttributes({ axMenuItemMarkChar: "" })).toBe(false);
	});
});

describe("chooseBackgroundBlurTargetFromMenu", () => {
	it("presses off when the blur item is checked by menu mark char", () => {
		expect(
			chooseBackgroundBlurTargetFromMenu({
				blur: { axMenuItemMarkChar: "✓" },
				off: { axSelected: 0 },
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: false,
			}),
		).toEqual({ target: "off", memoryAfterSuccess: false, reason: "blur-selected" });
	});

	it("presses off when the blur item is checked by AXValue", () => {
		expect(
			chooseBackgroundBlurTargetFromMenu({
				blur: { axValue: 1 },
				off: { axSelected: 0 },
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: false,
			}),
		).toEqual({ target: "off", memoryAfterSuccess: false, reason: "blur-selected" });
	});

	it("falls back to memory when neither matched item has selected-state attributes", () => {
		expect(
			chooseBackgroundBlurTargetFromMenu({
				blur: {},
				off: {},
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: true,
			}),
		).toEqual({ target: "off", memoryAfterSuccess: false, reason: "fallback-off" });
	});
});

describe("chooseBackgroundBlurTarget", () => {
	it("turns blur off only when Teams reports the blur item is already selected", () => {
		expect(
			chooseBackgroundBlurTarget({
				blurSelected: true,
				offSelected: false,
				hasReadableSelection: true,
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: false,
			}),
		).toEqual({ target: "off", memoryAfterSuccess: false, reason: "blur-selected" });
	});

	it("still targets off when blur is selected but the off item is missing", () => {
		expect(
			chooseBackgroundBlurTarget({
				blurSelected: true,
				hasReadableSelection: true,
				canPressOn: true,
				canPressOff: false,
				fallbackBlurTurnedOn: false,
			}),
		).toEqual({ target: "off", memoryAfterSuccess: false, memoryAfterMissingItem: false, reason: "blur-selected" });
	});

	it("turns blur on when Teams reports no background effect is selected", () => {
		expect(
			chooseBackgroundBlurTarget({
				blurSelected: false,
				offSelected: true,
				hasReadableSelection: true,
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: true,
			}),
		).toEqual({ target: "on", memoryAfterSuccess: true, reason: "none-selected" });
	});

	it("falls back to memory when matched blur and off items are readable but neither is selected", () => {
		expect(
			chooseBackgroundBlurTarget({
				blurSelected: false,
				offSelected: false,
				hasReadableSelection: true,
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: true,
			}),
		).toEqual({ target: "off", memoryAfterSuccess: false, reason: "readable-no-selection" });

		expect(
			chooseBackgroundBlurTarget({
				blurSelected: false,
				offSelected: false,
				hasReadableSelection: true,
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: false,
			}),
		).toEqual({ target: "on", memoryAfterSuccess: true, reason: "readable-no-selection" });
	});

	it("uses per-meeting fallback memory only when Teams exposes no selected state", () => {
		expect(
			chooseBackgroundBlurTarget({
				hasReadableSelection: false,
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: false,
			}),
		).toEqual({ target: "on", memoryAfterSuccess: true, reason: "fallback-on" });

		expect(
			chooseBackgroundBlurTarget({
				hasReadableSelection: false,
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: true,
			}),
		).toEqual({ target: "off", memoryAfterSuccess: false, reason: "fallback-off" });
	});

	it("returns off-missing instead of pressing blur again when fallback wanted off but no off item exists", () => {
		expect(
			chooseBackgroundBlurTarget({
				hasReadableSelection: false,
				canPressOn: true,
				canPressOff: false,
				fallbackBlurTurnedOn: true,
			}),
		).toEqual({ target: "off", memoryAfterSuccess: false, memoryAfterMissingItem: false, reason: "fallback-off-missing" });
	});
});

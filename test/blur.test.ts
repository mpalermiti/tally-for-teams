import { describe, expect, it } from "vitest";

import { chooseBackgroundBlurTarget } from "../src/actions/blur";

describe("chooseBackgroundBlurTarget", () => {
	it("turns blur off only when Teams reports the blur item is already selected", () => {
		expect(
			chooseBackgroundBlurTarget({
				blurSelected: true,
				offSelected: false,
				otherEffectSelected: false,
				hasReadableSelection: true,
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: false,
			}),
		).toEqual({ target: "off", memoryAfterSuccess: false, reason: "blur-selected" });
	});

	it("turns blur on when Teams reports none or another background effect is selected", () => {
		expect(
			chooseBackgroundBlurTarget({
				blurSelected: false,
				offSelected: true,
				otherEffectSelected: false,
				hasReadableSelection: true,
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: true,
			}),
		).toEqual({ target: "on", memoryAfterSuccess: true, reason: "none-selected" });

		expect(
			chooseBackgroundBlurTarget({
				blurSelected: false,
				offSelected: false,
				otherEffectSelected: true,
				hasReadableSelection: true,
				canPressOn: true,
				canPressOff: true,
				fallbackBlurTurnedOn: true,
			}),
		).toEqual({ target: "on", memoryAfterSuccess: true, reason: "other-effect-selected" });
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

	it("falls back to blur-on when fallback wanted off but no off item exists", () => {
		expect(
			chooseBackgroundBlurTarget({
				hasReadableSelection: false,
				canPressOn: true,
				canPressOff: false,
				fallbackBlurTurnedOn: true,
			}),
		).toEqual({ target: "on", memoryAfterSuccess: false, reason: "fallback-off-missing" });
	});
});

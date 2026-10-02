export type BackgroundBlurTarget = "on" | "off";
export type BackgroundBlurDecisionReason =
	| "blur-selected"
	| "none-selected"
	| "other-effect-selected"
	| "readable-no-selection"
	| "fallback-on"
	| "fallback-off"
	| "fallback-off-missing";

export interface BackgroundBlurDecisionInput {
	blurSelected?: boolean;
	offSelected?: boolean;
	otherEffectSelected?: boolean;
	hasReadableSelection: boolean;
	canPressOn: boolean;
	canPressOff: boolean;
	fallbackBlurTurnedOn: boolean;
}

export interface BackgroundBlurDecision {
	target: BackgroundBlurTarget;
	/** Fallback memory to keep only when no reliable selected state is readable. */
	memoryAfterSuccess: boolean;
	reason: BackgroundBlurDecisionReason;
}

/** Mirrors the Swift bridge's Background blur toggle choice so the privacy-critical logic is unit-tested. */
export function chooseBackgroundBlurTarget(input: BackgroundBlurDecisionInput): BackgroundBlurDecision {
	if (input.hasReadableSelection) {
		if (input.blurSelected === true && input.canPressOff) return { target: "off", memoryAfterSuccess: false, reason: "blur-selected" };
		if (input.otherEffectSelected === true) return { target: "on", memoryAfterSuccess: true, reason: "other-effect-selected" };
		if (input.offSelected === true) return { target: "on", memoryAfterSuccess: true, reason: "none-selected" };
		return { target: "on", memoryAfterSuccess: true, reason: "readable-no-selection" };
	}

	if (input.fallbackBlurTurnedOn) {
		if (input.canPressOff) return { target: "off", memoryAfterSuccess: false, reason: "fallback-off" };
		return { target: "on", memoryAfterSuccess: false, reason: "fallback-off-missing" };
	}

	return { target: "on", memoryAfterSuccess: true, reason: "fallback-on" };
}

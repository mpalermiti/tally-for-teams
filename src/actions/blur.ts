export type BackgroundBlurTarget = "on" | "off";
export type BackgroundBlurDecisionReason =
	| "blur-selected"
	| "none-selected"
	| "readable-no-selection"
	| "fallback-on"
	| "fallback-off"
	| "fallback-off-missing";

export interface SelectedStateAttributes {
	axMenuItemMarkChar?: unknown;
	axValue?: unknown;
	axSelected?: unknown;
}

export interface BackgroundBlurDecisionInput {
	blurSelected?: boolean;
	offSelected?: boolean;
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

function attributeExists(value: unknown): boolean {
	return value !== undefined && value !== null;
}

function selectedValue(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value === 1;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		return normalized === "1" || normalized === "true";
	}
	return false;
}

export function selectedStateFromAttributes(attributes: SelectedStateAttributes): boolean | undefined {
	let readable = false;

	if (attributeExists(attributes.axMenuItemMarkChar)) {
		readable = true;
		if (String(attributes.axMenuItemMarkChar).trim() !== "") return true;
	}
	if (attributeExists(attributes.axValue)) {
		readable = true;
		if (selectedValue(attributes.axValue)) return true;
	}
	if (attributeExists(attributes.axSelected)) {
		readable = true;
		if (selectedValue(attributes.axSelected)) return true;
	}

	return readable ? false : undefined;
}

function fallbackDecision(input: BackgroundBlurDecisionInput, reason?: BackgroundBlurDecisionReason): BackgroundBlurDecision {
	if (input.fallbackBlurTurnedOn) {
		return {
			target: "off",
			memoryAfterSuccess: false,
			reason: reason ?? (input.canPressOff ? "fallback-off" : "fallback-off-missing"),
		};
	}
	return { target: "on", memoryAfterSuccess: true, reason: reason ?? "fallback-on" };
}

/** Mirrors the Swift bridge's Background blur toggle choice so the privacy-critical logic is unit-tested. */
export function chooseBackgroundBlurTarget(input: BackgroundBlurDecisionInput): BackgroundBlurDecision {
	if (input.hasReadableSelection) {
		if (input.blurSelected === true) return { target: "off", memoryAfterSuccess: false, reason: "blur-selected" };
		if (input.offSelected === true) return { target: "on", memoryAfterSuccess: true, reason: "none-selected" };
		return fallbackDecision(input, "readable-no-selection");
	}

	return fallbackDecision(input);
}

export function chooseBackgroundBlurTargetFromMenu(input: {
	blur?: SelectedStateAttributes;
	off?: SelectedStateAttributes;
	canPressOn: boolean;
	canPressOff: boolean;
	fallbackBlurTurnedOn: boolean;
}): BackgroundBlurDecision {
	const blurSelected = input.blur === undefined ? undefined : selectedStateFromAttributes(input.blur);
	const offSelected = input.off === undefined ? undefined : selectedStateFromAttributes(input.off);
	return chooseBackgroundBlurTarget({
		blurSelected,
		offSelected,
		hasReadableSelection: blurSelected !== undefined || offSelected !== undefined,
		canPressOn: input.canPressOn,
		canPressOff: input.canPressOff,
		fallbackBlurTurnedOn: input.fallbackBlurTurnedOn,
	});
}

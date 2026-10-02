export type BackgroundBlurDirection = "on" | "off";

export class BackgroundBlurToggle {
	#lastConfirmed: BackgroundBlurDirection | undefined;

	next(): BackgroundBlurDirection {
		return this.#lastConfirmed === "on" ? "off" : "on";
	}

	record(direction: BackgroundBlurDirection, confirmed: boolean): void {
		if (confirmed) this.#lastConfirmed = direction;
	}
}

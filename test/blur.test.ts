import { describe, expect, it } from "vitest";

import { BackgroundBlurToggle } from "../src/actions/blur";

describe("BackgroundBlurToggle", () => {
	it("starts by turning blur on, then alternates only after Teams confirms a press", () => {
		const toggle = new BackgroundBlurToggle();

		expect(toggle.next()).toBe("on");
		toggle.record("on", false);
		expect(toggle.next()).toBe("on");

		toggle.record("on", true);
		expect(toggle.next()).toBe("off");

		toggle.record("off", false);
		expect(toggle.next()).toBe("off");

		toggle.record("off", true);
		expect(toggle.next()).toBe("on");
	});
});

import { describe, expect, it } from "vitest";

import { versionProblem } from "../scripts/check-version";

describe("versionProblem", () => {
	it("accepts a manifest version that is the package version plus .0", () => {
		expect(versionProblem("1.0.0.0", "1.0.0")).toBeUndefined();
	});

	it("ignores a pre-release suffix, which the manifest can't carry", () => {
		expect(versionProblem("1.0.0.0", "1.0.0-rc.1")).toBeUndefined();
	});

	it("ignores build metadata too", () => {
		expect(versionProblem("1.0.0.0", "1.0.0+build.5")).toBeUndefined();
	});

	it("flags a manifest that disagrees", () => {
		expect(versionProblem("0.3.0.0", "1.0.0")).toMatch(/manifest\.json says 0\.3\.0\.0/);
	});

	it("requires a release tag to match the package version exactly", () => {
		expect(versionProblem("1.0.0.0", "1.0.0", "v1.0.0")).toBeUndefined();
		expect(versionProblem("1.0.0.0", "1.0.0-rc.1", "v1.0.0-rc.1")).toBeUndefined();
		expect(versionProblem("1.0.0.0", "1.0.0", "v1.0.1")).toMatch(/tag v1\.0\.1/);
	});
});

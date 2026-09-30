import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { KEY_KINDS } from "../src/render/key";

const manifest = JSON.parse(readFileSync(new URL("../ai.michaelp.tally.sdPlugin/manifest.json", import.meta.url), "utf8"));
const uuids: string[] = manifest.Actions.map((a: { UUID: string }) => a.UUID);

describe("manifest", () => {
	it("is Tally for Teams", () => {
		expect(manifest).toMatchObject({ Name: "Tally for Teams", Category: "Tally for Teams" });
	});

	// The SDK throws at startup if the plugin registers an action the manifest doesn't list.
	it("lists exactly one action per key kind", () => {
		expect([...uuids].sort()).toEqual(KEY_KINDS.map((kind) => `ai.michaelp.tally.${kind}`).sort());
	});

	it("doesn't offer keys that can't work yet", () => {
		expect(uuids).not.toContain("ai.michaelp.tally.blur");
	});

	it("gives Leave a settings page", () => {
		const leave = manifest.Actions.find((a: { UUID: string }) => a.UUID === "ai.michaelp.tally.leave");
		expect(leave.PropertyInspectorPath).toBe("ui/leave.html");
	});

	it("keeps every settings page working offline", () => {
		for (const { PropertyInspectorPath: page } of manifest.Actions.filter((a: { PropertyInspectorPath?: string }) => a.PropertyInspectorPath)) {
			const html = readFileSync(new URL(`../ai.michaelp.tally.sdPlugin/${page}`, import.meta.url), "utf8");
			expect(html, page).not.toMatch(/src="https?:/);
		}
	});
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { KEY_KINDS } from "../src/render/key";

const manifest = JSON.parse(readFileSync(new URL("../ai.michaelp.teams.sdPlugin/manifest.json", import.meta.url), "utf8"));
const uuids: string[] = manifest.Actions.map((a: { UUID: string }) => a.UUID);

describe("manifest", () => {
	// The SDK throws at startup if the plugin registers an action the manifest doesn't list.
	it("lists exactly one action per key kind", () => {
		expect([...uuids].sort()).toEqual(KEY_KINDS.map((kind) => `ai.michaelp.teams.${kind}`).sort());
	});

	it("doesn't offer keys that can't work yet", () => {
		expect(uuids).not.toContain("ai.michaelp.teams.blur");
	});
});

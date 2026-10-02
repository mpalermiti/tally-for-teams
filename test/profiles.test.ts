import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildProfileSummary } from "../scripts/profiles";

const pluginRoot = new URL("../ai.michaelp.tally.sdPlugin/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../ai.michaelp.tally.sdPlugin/manifest.json", import.meta.url), "utf8"));
const summaryPath = new URL("../ai.michaelp.tally.sdPlugin/profiles/summary.json", import.meta.url);
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const actionUuids = new Set<string>(manifest.Actions.map((action: { UUID: string }) => action.UUID));

describe("bundled profiles", () => {
	it("declares the generated Stream Deck and Stream Deck + profiles in the manifest", () => {
		expect(manifest.Profiles).toEqual([
			{
				Name: "profiles/Tally (Stream Deck)",
				DeviceType: 0,
				Readonly: false,
				DontAutoSwitchWhenInstalled: true,
			},
			{
				Name: "profiles/Tally (Stream Deck +)",
				DeviceType: 7,
				Readonly: false,
				DontAutoSwitchWhenInstalled: true,
			},
		]);

		for (const profile of manifest.Profiles) {
			expect(existsSync(fileURLToPath(new URL(`${profile.Name}.streamDeckProfile`, pluginRoot))), profile.Name).toBe(true);
		}
	});

	it("keeps the committed profile summary current with scripts/profiles.ts", () => {
		expect(summary).toEqual(buildProfileSummary());
	});

	it("lays out the 15-key profile with every requested Tally action", () => {
		expect(summary.profiles["profiles/Tally (Stream Deck)"].keys).toEqual({
			"0,0": { uuid: "ai.michaelp.tally.mute" },
			"1,0": { uuid: "ai.michaelp.tally.camera" },
			"2,0": { uuid: "ai.michaelp.tally.hand" },
			"3,0": { uuid: "ai.michaelp.tally.share" },
			"4,0": { uuid: "ai.michaelp.tally.chat" },
			"0,1": { uuid: "ai.michaelp.tally.react", settings: { reaction: "like" } },
			"1,1": { uuid: "ai.michaelp.tally.react", settings: { reaction: "love" } },
			"2,1": { uuid: "ai.michaelp.tally.react", settings: { reaction: "applause" } },
			"3,1": { uuid: "ai.michaelp.tally.react", settings: { reaction: "laugh" } },
			"4,1": { uuid: "ai.michaelp.tally.react", settings: { reaction: "wow" } },
			"0,2": { uuid: "ai.michaelp.tally.people" },
			"1,2": { uuid: "ai.michaelp.tally.blur" },
			"2,2": { uuid: "ai.michaelp.tally.timer" },
			"4,2": { uuid: "ai.michaelp.tally.leave" },
		});
	});

	it("lays out the Stream Deck + keypad and puts Mute on dial 1 only", () => {
		expect(summary.profiles["profiles/Tally (Stream Deck +)"].keys).toEqual({
			"0,0": { uuid: "ai.michaelp.tally.mute" },
			"1,0": { uuid: "ai.michaelp.tally.camera" },
			"2,0": { uuid: "ai.michaelp.tally.hand" },
			"3,0": { uuid: "ai.michaelp.tally.share" },
			"0,1": { uuid: "ai.michaelp.tally.react", settings: { reaction: "like" } },
			"1,1": { uuid: "ai.michaelp.tally.people" },
			"2,1": { uuid: "ai.michaelp.tally.timer" },
			"3,1": { uuid: "ai.michaelp.tally.leave" },
		});
		expect(summary.profiles["profiles/Tally (Stream Deck +)"].dials).toEqual({
			"0,0": { uuid: "ai.michaelp.tally.mute" },
		});
	});

	it("only references actions that exist in the manifest", () => {
		for (const profile of Object.values(summary.profiles) as { keys: Record<string, { uuid: string }>; dials: Record<string, { uuid: string }> }[]) {
			for (const action of [...Object.values(profile.keys), ...Object.values(profile.dials)]) {
				expect(actionUuids.has(action.uuid), action.uuid).toBe(true);
			}
		}
	});
});

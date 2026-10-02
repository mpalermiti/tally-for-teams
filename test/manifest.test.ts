import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { KEY_KINDS } from "../src/render/key";

const manifest = JSON.parse(readFileSync(new URL("../ai.michaelp.tally.sdPlugin/manifest.json", import.meta.url), "utf8"));
const uuids: string[] = manifest.Actions.map((a: { UUID: string }) => a.UUID);
const pluginRoot = new URL("../ai.michaelp.tally.sdPlugin/", import.meta.url);

function existingImage(ref: string): string | undefined {
	for (const ext of [".svg", ".png"]) {
		const path = fileURLToPath(new URL(`${ref}${ext}`, pluginRoot));
		if (existsSync(path)) return path;
	}
	return undefined;
}

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

	it("resolves every manifest image path to a shipped SVG or PNG", () => {
		const refs = [
			manifest.Icon,
			manifest.CategoryIcon,
			...manifest.Actions.flatMap((action: { Icon?: string; States?: { Image?: string }[]; Encoder?: { Icon?: string; background?: string } }) => [
				action.Icon,
				...(action.States ?? []).map((state) => state.Image),
				action.Encoder?.Icon,
				action.Encoder?.background,
			]),
		].filter(Boolean) as string[];

		for (const ref of refs) expect(existingImage(ref), ref).toBeDefined();
	});

	it("uses SVGs, not PNGs, for action-list icons and default key images", () => {
		for (const action of manifest.Actions as { Icon: string; States?: { Image?: string }[]; Encoder?: { Icon?: string; background?: string } }[]) {
			const refs = [action.Icon, ...(action.States ?? []).map((state) => state.Image), action.Encoder?.Icon, action.Encoder?.background].filter(
				Boolean,
			) as string[];
			for (const ref of refs) {
				expect(existsSync(fileURLToPath(new URL(`${ref}.svg`, pluginRoot))), ref).toBe(true);
				expect(existsSync(fileURLToPath(new URL(`${ref}.png`, pluginRoot))), ref).toBe(false);
			}
		}
	});

	it("keeps every settings page working offline", () => {
		for (const { PropertyInspectorPath: page } of manifest.Actions.filter((a: { PropertyInspectorPath?: string }) => a.PropertyInspectorPath)) {
			const pageUrl = new URL(`../ai.michaelp.tally.sdPlugin/${page}`, import.meta.url);
			const html = readFileSync(pageUrl, "utf8");
			const assetReferences = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]);

			for (const value of assetReferences) {
				expect(value, `${page} references an absolute URL`).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
				expect(value.startsWith("//"), `${page} references a protocol-relative URL ${value}`).toBe(false);
				expect(existsSync(fileURLToPath(new URL(value, pageUrl))), `${page} references missing local asset ${value}`).toBe(true);
			}
		}
	});
});

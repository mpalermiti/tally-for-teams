import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { DEFAULT_SELECTORS, mergeSelectors, type MergeSelectorsResult } from "./selectors";

export const SELECTORS_PATH = join(homedir(), "Library", "Application Support", "Tally for Teams", "selectors.json");

export function loadSelectors(path = SELECTORS_PATH): MergeSelectorsResult {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return mergeSelectors(DEFAULT_SELECTORS, parsed);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return mergeSelectors(DEFAULT_SELECTORS);
		return {
			...mergeSelectors(DEFAULT_SELECTORS),
			problems: [`${path}: invalid selectors JSON (${(error as Error).message}); using defaults`],
		};
	}
}

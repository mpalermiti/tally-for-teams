/**
 * Fails when manifest.json, package.json and (on a release) the tag disagree on the version.
 *   node --import tsx scripts/check-version.ts [tag]      e.g. v1.0.0 or v1.0.0-rc.1
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Why the versions disagree, or undefined when they agree. */
export function versionProblem(manifestVersion: string, packageVersion: string, tag?: string): string | undefined {
	const core = packageVersion.replace(/-.*$/, "");
	if (manifestVersion !== `${core}.0`) return `manifest.json says ${manifestVersion}, package.json says ${packageVersion}`;
	if (tag && tag.replace(/^v/, "") !== packageVersion) return `tag ${tag} doesn't match package.json ${packageVersion}`;
	return undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
	const manifest = read("../ai.michaelp.tally.sdPlugin/manifest.json");
	const pkg = read("../package.json");
	const problem = versionProblem(manifest.Version, pkg.version, process.argv[2] || undefined);
	if (problem) {
		console.error(`✗ ${problem}`);
		process.exit(1);
	}
	console.log(`✓ version ${pkg.version}`);
}

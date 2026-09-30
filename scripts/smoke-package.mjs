/**
 * Checks the PACKED plugin (dist/*.streamDeckPlugin) the way Stream Deck installs it:
 * unzip, launch bin/plugin.js with the real bin/teams-bridge, and confirm the helper
 * starts and reports. Catches packaging problems the build-folder smoke test can't,
 * such as `streamdeck pack` dropping the helper's executable bit.
 *
 * On a Mac without Accessibility permission for this process, the expected result is
 * the dial saying "Allow / Accessibility", which proves the helper ran and answered. With
 * permission it says "Teams / Not running" or "Mic / No meeting"; any answer but
 * "Teams / Connecting" passes.
 *
 * Usage: npm run smoke:package
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const UUID = "ai.michaelp.tally";
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "teams-plugin-"));
execFileSync("unzip", ["-q", join(root, "dist", `${UUID}.streamDeckPlugin`), "-d", dir]);
const pluginDir = join(dir, `${UUID}.sdPlugin`);

const deck = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((r) => deck.once("listening", r));
const fromPlugin = [];
let socket;
deck.on("connection", (s) => {
	socket = s;
	s.on("message", (d) => fromPlugin.push(JSON.parse(d.toString())));
});

const info = {
	application: { font: "", language: "en", platform: "mac", platformVersion: "15.0", version: "7.1.0.0" },
	colors: {},
	devicePixelRatio: 2,
	devices: [{ id: "D", name: "Stream Deck +", size: { columns: 4, rows: 2 }, type: 7 }],
	plugin: { uuid: UUID, version: "0.3.0.0" },
};
const env = { ...process.env };
delete env.TEAMS_BRIDGE;
const plugin = spawn(
	process.execPath,
	["bin/plugin.js", "-port", String(deck.address().port), "-pluginUUID", UUID, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)],
	{ cwd: pluginDir, stdio: ["ignore", "inherit", "inherit"], env },
);

const deadline = Date.now() + 10_000;
while (!socket && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
socket?.send(JSON.stringify({
	event: "willAppear", action: `${UUID}.mute`, context: "DIAL", device: "D",
	payload: { settings: {}, coordinates: { column: 0, row: 0 }, controller: "Encoder", isInMultiAction: false },
}));

const answered = () => {
	const payload = fromPlugin.filter((m) => m.event === "setFeedback").at(-1)?.payload;
	const words = payload && [payload.label?.value, payload.detail?.value].filter(Boolean).join(" / ");
	// "Teams / Connecting" means no answer yet; "Teams / Not running" is an answer.
	return words && payload.detail?.value !== "Connecting" ? words : undefined;
};
while (!answered() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
plugin.kill();
deck.close();

const label = answered();
console.log(label ? `✓ packaged helper launched and reported (dial: ${label})` : "✗ packaged helper never reported");
process.exit(label ? 0 : 1);

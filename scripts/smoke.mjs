/**
 * End-to-end smoke test of the BUILT plugin (bin/plugin.js), no hardware or Teams needed.
 *
 * Plays both counterparts: a fake Stream Deck app (launches the plugin with the real
 * CLI arguments and speaks its WebSocket protocol) and the Accessibility bridge, via
 * scripts/fake-bridge.mjs, answering the way bin/teams-bridge does on a Mac with Teams
 * (button ids and labels as seen on Teams 26267). Walks through: no permission →
 * meeting → key presses → reactions → the Stream Deck+ dial → bridge crash and recovery.
 *
 * Usage: npm run build && npm run smoke
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(root, "ai.michaelp.tally.sdPlugin");
const UUID = "ai.michaelp.tally";
const DEVICE = "DECK1";

const failures = [];
const check = (ok, label) => {
	console.log(`${ok ? "✓" : "✗"} ${label}`);
	if (!ok) failures.push(label);
};
const until = async (predicate, label, timeoutMs = 5000) => {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) return check(false, label);
		await new Promise((r) => setTimeout(r, 20));
	}
	check(true, label);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = () =>
	new Promise((resolve, reject) => {
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		server.once("listening", () => resolve(server));
		server.once("error", reject);
	});

// ── Fake Stream Deck ─────────────────────────────────────────────
const deck = await listen();
const fromPlugin = [];
let pluginSocket;
deck.on("connection", (socket) => {
	pluginSocket = socket;
	socket.on("message", (data) => fromPlugin.push(JSON.parse(data.toString())));
});
const toPlugin = (msg) => pluginSocket.send(JSON.stringify(msg));
const event = (name, kind, context, payload) => toPlugin({ event: name, action: `${UUID}.${kind}`, context, device: DEVICE, payload });
const keyPayload = (settings = {}) => ({ settings, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false, state: 0 });
const dialPayload = { settings: {}, coordinates: { column: 0, row: 0 }, controller: "Encoder", isInMultiAction: false };
const lastImage = (context) => {
	const all = fromPlugin.filter((m) => m.event === "setImage" && m.context === context);
	return all.length ? Buffer.from(all.at(-1).payload.image.split(",")[1], "base64").toString() : "";
};
const feedback = (context) => fromPlugin.filter((m) => m.event === "setFeedback" && m.context === context).at(-1)?.payload;
const alerts = (context) => fromPlugin.filter((m) => m.event === "showAlert" && m.context === context).length;

// ── Fake Accessibility bridge ────────────────────────────────────
const bridge = await listen();
const toBridge = []; // commands the plugin sent the helper
let bridgeSocket;
let connections = 0;
bridge.on("connection", (socket) => {
	bridgeSocket = socket;
	connections++;
	socket.on("message", (data) => toBridge.push(JSON.parse(data.toString())));
});
const TOOLBAR = {
	"microphone-button": "Mute mic",
	"video-button": "Turn camera on",
	"share-button": "Share",
	"reaction-menu-button": "React",
	"chat-button": "Chat",
	"hangup-button": "Leave",
};
let buttons = { ...TOOLBAR };
const status = (extra = {}) =>
	bridgeSocket.send(
		JSON.stringify({
			type: "status",
			trusted: true,
			running: true,
			buttons: Object.fromEntries(Object.entries(buttons).map(([id, label]) => [id, { label, enabled: true }])),
			...extra,
		}),
	);
const commands = (cmd) => toBridge.filter((m) => m.cmd === cmd);
const reply = (command, ok = true, message = "pressed") => bridgeSocket.send(JSON.stringify({ type: "result", req: command.req, ok, message }));
/** Answers the latest press like Teams would: flips the mic label. */
const pressMic = (live) => {
	reply(commands("press").at(-1));
	buttons["microphone-button"] = live ? "Mute mic" : "Unmute mic";
	status();
};

// ── Launch the plugin like Stream Deck does ──────────────────────
const info = {
	application: { font: "", language: "en", platform: "mac", platformVersion: "15.0", version: "7.1.0.0" },
	colors: {},
	devicePixelRatio: 2,
	devices: [{ id: DEVICE, name: "Stream Deck +", size: { columns: 4, rows: 2 }, type: 7 }],
	plugin: { uuid: UUID, version: "0.3.0.0" },
};
const plugin = spawn(
	process.execPath,
	["bin/plugin.js", "-port", String(deck.address().port), "-pluginUUID", UUID, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)],
	{
		cwd: pluginDir,
		stdio: ["ignore", "inherit", "inherit"],
		env: { ...process.env, TEAMS_BRIDGE: join(root, "scripts/fake-bridge.mjs"), FAKE_BRIDGE_URL: `ws://127.0.0.1:${bridge.address().port}` },
	},
);

try {
	await until(() => fromPlugin.some((m) => m.event === "registerPlugin"), "plugin registers with Stream Deck");
	await until(() => commands("watch").length === 1, "plugin starts the bridge and asks it to watch the toolbar");
	check(commands("watch")[0].ids.includes("microphone-button"), "…including microphone-button");

	event("willAppear", "mute", "MUTE1", keyPayload());
	event("willAppear", "react", "REACT1", keyPayload({ reaction: "love" }));
	event("willAppear", "mute", "DIAL1", dialPayload);
	await until(() => lastImage("MUTE1").includes("#3A3A42"), "keys draw offline before the bridge reports");
	await until(() => feedback("DIAL1")?.label?.value === "Teams", "dial says Teams / Connecting");

	// No Accessibility permission yet.
	status({ trusted: false, buttons: {} });
	await until(() => feedback("DIAL1")?.detail?.value === "Accessibility", "without permission the dial says Allow / Accessibility");
	event("keyDown", "mute", "MUTE1", keyPayload());
	await until(() => commands("prompt").length === 1, "pressing a key asks macOS for permission");
	await until(() => alerts("MUTE1") === 1, "…and flashes an alert");

	// Permission granted, in a meeting, mic live.
	status();
	await until(() => lastImage("MUTE1").includes("radialGradient"), "mute key lights up when the label says Mute mic (live)");
	await until(() => feedback("DIAL1")?.label?.value === "Live", "dial says Live");

	event("keyDown", "mute", "MUTE1", keyPayload());
	await until(() => commands("press").some((c) => c.id === "microphone-button"), "pressing mute presses microphone-button");
	pressMic(false);
	await until(() => lastImage("MUTE1").includes('fill="#18181B"') && !lastImage("MUTE1").includes("radialGradient"), "mute key goes dark when the label flips to Unmute mic");
	check(alerts("MUTE1") === 1, "no alert on a successful press");

	// Reactions go through the React menu.
	event("keyDown", "react", "REACT1", keyPayload({ reaction: "love" }));
	await until(() => commands("menu").length === 1, "react key opens the React menu");
	const menu = commands("menu")[0];
	check(menu.id === "reaction-menu-button" && menu.itemIds.includes("heart-button"), "…looking for heart-button");
	reply(menu, true, "pressed Love");
	await sleep(200);
	check(alerts("REACT1") === 0, "a sent reaction doesn't alert");

	event("keyDown", "react", "REACT1", keyPayload({ reaction: "love" }));
	await until(() => commands("menu").length === 2, "…second reaction");
	reply(commands("menu")[1], false, "No heart-button in reaction-menu-button menu; it offered: nothing");
	await until(() => alerts("REACT1") === 1, "a missing menu item flashes an alert");

	// Stream Deck+ dial: hold to talk.
	let presses = commands("press").length;
	event("dialDown", "mute", "DIAL1", dialPayload);
	await until(() => commands("press").length === presses + 1, "pressing the dial presses mute immediately");
	pressMic(true);
	await until(() => feedback("DIAL1")?.label?.value === "Live", "dial shows Live while held");
	await sleep(500);
	event("dialUp", "mute", "DIAL1", dialPayload);
	await until(() => commands("press").length === presses + 2, "releasing after a hold mutes again (push-to-talk)");
	pressMic(false);
	await until(() => feedback("DIAL1")?.label?.value === "Muted", "dial back to Muted");

	// Turn right once (a burst of ticks) → one unmute.
	await sleep(600);
	presses = commands("press").length;
	for (let i = 0; i < 3; i++) event("dialRotate", "mute", "DIAL1", { ...dialPayload, ticks: 1, pressed: false });
	await sleep(300);
	check(commands("press").length === presses + 1, "turning right unmutes exactly once for a burst of ticks");
	pressMic(true);

	// Meeting ends: toolbar disappears.
	buttons = {};
	status();
	await until(() => feedback("DIAL1")?.detail?.value === "No meeting", "dial says No meeting once the toolbar is gone");

	// Teams quits.
	status({ running: false });
	await until(() => feedback("DIAL1")?.detail?.value === "Not running", "dial says Not running when Teams quits");

	// The helper crashes; the plugin restarts it.
	bridgeSocket.close();
	await until(() => connections === 2 && commands("watch").length === 2, "plugin restarts a crashed bridge and re-sends watch", 8000);
	buttons = { ...TOOLBAR };
	status();
	await until(() => feedback("DIAL1")?.label?.value === "Live", "…and recovers meeting state");
} finally {
	plugin.kill();
	bridge.close();
	deck.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures.length ? 1 : 0);

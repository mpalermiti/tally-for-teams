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
const keyPayload = (settings = {}, coordinates = { column: 0, row: 0 }) => ({
	settings,
	coordinates,
	controller: "Keypad",
	isInMultiAction: false,
	state: 0,
});
const dialPayload = { settings: {}, coordinates: { column: 0, row: 0 }, controller: "Encoder", isInMultiAction: false };
// DECK1 is the fake Stream Deck + (device type 7); these are the bundled profile's switch-back anchors.
const STREAM_DECK_PLUS_PROFILE_KEYS = {
	mute: { column: 0, row: 0 },
	leave: { column: 3, row: 1 },
};
const lastImage = (context) => {
	const all = fromPlugin.filter((m) => m.event === "setImage" && m.context === context);
	return all.length ? Buffer.from(all.at(-1).payload.image.split(",")[1], "base64").toString() : "";
};
const imageCount = (context) => fromPlugin.filter((m) => m.event === "setImage" && m.context === context).length;
const feedback = (context) => fromPlugin.filter((m) => m.event === "setFeedback" && m.context === context).at(-1)?.payload;
const alerts = (context) => fromPlugin.filter((m) => m.event === "showAlert" && m.context === context).length;
const globalSettingsRequests = () => fromPlugin.filter((m) => m.event === "getGlobalSettings");
const sendGlobalSettings = (settings) => toPlugin({ event: "didReceiveGlobalSettings", payload: { settings } });
const profileSwitches = () => fromPlugin.filter((m) => m.event === "switchToProfile");

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
	"roster-button": "People",
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
const menus = (id) => commands("menu").filter((c) => c.id === id);
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
	toPlugin({ event: "deviceDidConnect", device: DEVICE, deviceInfo: info.devices[0] });
	await until(() => globalSettingsRequests().length === 1, "plugin asks for global settings");
	sendGlobalSettings({ autoSwitchProfile: false });
	await until(() => commands("watch").length === 1, "plugin starts the bridge and asks it to watch the toolbar");
	check(commands("watch")[0].ids.includes("microphone-button"), "…including microphone-button");
	check(commands("watch")[0].indicatorContainers?.includes("indicators"), "…including the indicators container");

	event("willAppear", "mute", "MUTE1", keyPayload());
	event("willAppear", "blur", "BLUR1", keyPayload());
	event("willAppear", "react", "REACT1", keyPayload({ reaction: "love" }));
	event("willAppear", "timer", "TIMER1", keyPayload());
	event("willAppear", "people", "PEOPLE1", keyPayload());
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
	await sleep(100);
	check(profileSwitches().length === 0, "profile auto-switch stays off by default");
	status({ indicators: [{ id: "call-recording-pill", role: "AXButton", label: "Recording" }] });
	await until(() => lastImage("MUTE1").includes('data-badge="recording"'), "recording indicator adds the mic badge");
	status({ indicators: [{ id: "call-duration-custom", role: "AXTimeGroup", label: "Elapsed time 01:05" }] });
	await until(() => lastImage("TIMER1").includes(">1:05<"), "timer key shows a time from the duration indicator");

	let blurMenus = menus("video-button-configure").length;
	event("keyDown", "blur", "BLUR1", keyPayload());
	await until(() => menus("video-button-configure").length === blurMenus + 1, "Background blur opens video options");
	let blurMenu = menus("video-button-configure").at(-1);
	check(
		blurMenu.toggle.on.labels.includes("standard blur") && blurMenu.toggle.on.excludeLabels.includes("no background effect"),
		"…asking the bridge to toggle blur on from fresh Teams menu state",
	);
	check(blurMenu.toggle.off.labels.includes("no background effect"), "…including the no-background-effect off target");
	reply(blurMenu, true, "pressed Standard blur; selection: no selected item seen");
	await sleep(200);
	check(alerts("BLUR1") === 0, "Background blur does not alert on success");

	blurMenus = menus("video-button-configure").length;
	event("keyDown", "blur", "BLUR1", keyPayload());
	await until(() => menus("video-button-configure").length === blurMenus + 1, "Background blur asks the bridge to decide again from fresh Teams state");
	blurMenu = menus("video-button-configure").at(-1);
	check(blurMenu.toggle.on.labels.includes("standard blur"), "…still sends a bridge-side toggle, not a remembered direction");
	reply(blurMenu, true, "pressed No background effect; selection: blur selected");

	event("keyDown", "mute", "MUTE1", keyPayload());
	await until(() => commands("press").some((c) => c.id === "microphone-button"), "pressing mute presses microphone-button");
	pressMic(false);
	await until(() => lastImage("MUTE1").includes('fill="#18181B"') && !lastImage("MUTE1").includes("radialGradient"), "mute key goes dark when the label flips to Unmute mic");
	check(alerts("MUTE1") === 1, "no alert on a successful press");

	// Mute key: hold to talk / cough button.
	let presses = commands("press").length;
	event("keyDown", "mute", "MUTE1", keyPayload());
	await until(() => commands("press").length === presses + 1, "pressing the mute key presses mute immediately");
	pressMic(true);
	await until(() => lastImage("MUTE1").includes("radialGradient"), "mute key lights while held");
	await sleep(500);
	event("keyUp", "mute", "MUTE1", keyPayload());
	await until(() => commands("press").length === presses + 2, "releasing the mute key after a hold mutes again (push-to-talk)");
	pressMic(false);
	await until(() => !lastImage("MUTE1").includes("radialGradient"), "mute key returns to muted after hold release");

	presses = commands("press").length;
	event("keyDown", "mute", "MUTE1", keyPayload());
	await until(() => commands("press").length === presses + 1, "pressing the mute key starts a laggy hold");
	await sleep(500);
	event("keyUp", "mute", "MUTE1", keyPayload());
	await sleep(300);
	check(commands("press").length === presses + 1, "laggy mute-key release waits for Teams to report the first toggle");
	pressMic(true);
	await until(() => commands("press").length === presses + 2, "laggy mute-key release still toggles back after Teams reports live");
	pressMic(false);
	await until(() => !lastImage("MUTE1").includes("radialGradient"), "mute key returns to muted after laggy hold release");

	presses = commands("press").length;
	event("keyDown", "mute", "MUTE1", keyPayload());
	await until(() => commands("press").length === presses + 1, "a quick mute-key tap toggles immediately");
	pressMic(true);
	event("keyUp", "mute", "MUTE1", keyPayload());
	await sleep(500);
	check(commands("press").length === presses + 1, "a quick mute-key tap doesn't toggle back on release");

	presses = commands("press").length;
	const multiActionMute = { ...keyPayload(), isInMultiAction: true };
	event("keyDown", "mute", "MUTE1", multiActionMute);
	await until(() => commands("press").length === presses + 1, "mute key in a multi-action toggles on key down");
	pressMic(false);
	await sleep(500);
	event("keyUp", "mute", "MUTE1", multiActionMute);
	await sleep(300);
	check(commands("press").length === presses + 1, "mute key in a multi-action doesn't toggle back");

	// Reactions go through the React menu.
	const reactMenus = () => menus("reaction-menu-button");
	const reactMenuStart = reactMenus().length;
	event("keyDown", "react", "REACT1", keyPayload({ reaction: "love" }));
	await until(() => reactMenus().length === reactMenuStart + 1, "react key opens the React menu");
	const menu = reactMenus().at(-1);
	check(menu.id === "reaction-menu-button" && menu.itemIds.includes("heart-button"), "…looking for heart-button");
	reply(menu, true, "pressed Love");
	await sleep(200);
	check(alerts("REACT1") === 0, "a sent reaction doesn't alert");

	event("keyDown", "react", "REACT1", keyPayload({ reaction: "love" }));
	await until(() => reactMenus().length === reactMenuStart + 2, "…second reaction");
	reply(reactMenus().at(-1), false, "No heart-button in reaction-menu-button menu; it offered: nothing");
	await until(() => alerts("REACT1") === 1, "a missing menu item flashes an alert");

	event("keyDown", "people", "PEOPLE1", keyPayload());
	await until(() => commands("press").some((c) => c.id === "roster-button"), "People key presses roster-button");
	reply(commands("press").filter((c) => c.id === "roster-button").at(-1));
	await sleep(200);
	check(alerts("PEOPLE1") === 0, "People key does not alert on success");

	// Leave: a tap leaves by default.
	const leaves = () => commands("press").filter((c) => c.id === "hangup-button").length;
	event("willAppear", "leave", "LEAVE1", keyPayload());
	event("keyDown", "leave", "LEAVE1", keyPayload());
	await until(() => leaves() === 1, "Leave leaves on a tap by default");
	reply(commands("press").at(-1));
	event("keyUp", "leave", "LEAVE1", keyPayload());

	// With Hold to leave on, a tap only shows "Hold"…
	const holdToLeave = keyPayload({ holdToLeave: true });
	event("willAppear", "leave", "LEAVE2", holdToLeave);
	event("keyDown", "leave", "LEAVE2", holdToLeave);
	await until(() => lastImage("LEAVE2").includes("data-progress"), "holding Leave draws a progress ring");
	await sleep(200);
	event("keyUp", "leave", "LEAVE2", holdToLeave);
	await until(() => lastImage("LEAVE2").includes(">Hold<"), "releasing early says Hold");
	check(leaves() === 1, "…and doesn't leave");

	// …pressing again while "Hold" shows starts a fresh hold, and a full hold leaves without waiting for release.
	event("keyDown", "leave", "LEAVE2", holdToLeave);
	await until(() => lastImage("LEAVE2").includes("data-progress"), "a new press during the hint starts a fresh ring");
	await until(() => leaves() === 2, "holding Leave for 0.6 s leaves", 2000);
	reply(commands("press").at(-1));
	event("keyUp", "leave", "LEAVE2", holdToLeave);
	await sleep(300);
	check(leaves() === 2, "…exactly once, even after the key comes up");

	// A multi-action can't hold, so Leave acts at once there.
	const multiActionLeave = { ...holdToLeave, isInMultiAction: true };
	event("keyDown", "leave", "LEAVE2", multiActionLeave);
	await until(() => leaves() === 3, "in a multi-action, Leave acts immediately");
	reply(commands("press").at(-1));
	event("keyUp", "leave", "LEAVE2", multiActionLeave);

	// Stream Deck+ dial: hold to talk.
	presses = commands("press").length;
	event("dialDown", "mute", "DIAL1", dialPayload);
	await until(() => commands("press").length === presses + 1, "pressing the dial presses mute immediately");
	pressMic(true);
	await until(() => feedback("DIAL1")?.label?.value === "Live", "dial shows Live while held");
	await sleep(500);
	event("dialUp", "mute", "DIAL1", dialPayload);
	await until(() => commands("press").length === presses + 2, "releasing after a hold mutes again (push-to-talk)");
	pressMic(false);
	await until(() => feedback("DIAL1")?.label?.value === "Muted", "dial back to Muted");

	presses = commands("press").length;
	event("dialDown", "mute", "DIAL1", dialPayload);
	await until(() => commands("press").length === presses + 1, "pressing the dial starts a laggy hold");
	await sleep(500);
	event("dialUp", "mute", "DIAL1", dialPayload);
	await sleep(300);
	check(commands("press").length === presses + 1, "laggy dial release waits for Teams to report the first toggle");
	pressMic(true);
	await until(() => commands("press").length === presses + 2, "laggy dial release still toggles back after Teams reports live");
	pressMic(false);
	await until(() => feedback("DIAL1")?.label?.value === "Muted", "dial back to Muted after laggy hold release");

	// Turn right once (a burst of ticks) → one unmute.
	await sleep(600);
	presses = commands("press").length;
	for (let i = 0; i < 3; i++) event("dialRotate", "mute", "DIAL1", { ...dialPayload, ticks: 1, pressed: false });
	await sleep(300);
	check(commands("press").length === presses + 1, "turning right unmutes exactly once for a burst of ticks");
	pressMic(true);

	// Teams changed: meeting UI is present, but the mic anchor disappeared.
	buttons = { "hangup-button": "Leave" };
	status({ markers: ["hangup-button", "horizontalEnd"] });
	await until(
		() => feedback("DIAL1")?.label?.value === "Teams changed",
		"dial says Teams changed when meeting markers remain but the mic button is gone",
		5000,
	);
	await until(() => lastImage("MUTE1").includes(">?</text>"), "keys add a ? hint when Teams changed");

	// Meeting ends: toolbar disappears.
	buttons = {};
	status();
	await until(() => feedback("DIAL1")?.detail?.value === "No meeting", "dial says No meeting once the toolbar is gone");
	check(profileSwitches().length === 0, "disabled profile auto-switch never sends switchToProfile");

	sendGlobalSettings({ autoSwitchProfile: true });
	buttons = { ...TOOLBAR };
	status();
	await until(() => profileSwitches().length === 1, "profile auto-switch switches to Tally on the next meeting start");
	check(profileSwitches().at(-1).payload.profile === "profiles/Tally (Stream Deck +)", "…using the bundled Stream Deck + profile name");
	event("willAppear", "mute", "PROFILE_MUTE", keyPayload({}, STREAM_DECK_PLUS_PROFILE_KEYS.mute));
	event("willAppear", "leave", "PROFILE_LEAVE", keyPayload({}, STREAM_DECK_PLUS_PROFILE_KEYS.leave));
	await until(
		() => imageCount("PROFILE_MUTE") > 0 && imageCount("PROFILE_LEAVE") > 0,
		"bundled Stream Deck + profile Mute and Leave actions are visible",
	);
	buttons = {};
	status();
	await until(() => profileSwitches().length === 2, "profile auto-switch returns to the previous profile on meeting end", 12_000);
	check(profileSwitches().at(-1).payload.profile === undefined, "…by omitting the profile name");

	// With Hold to leave on, a tap never leaves while Teams is readable, even with the key dimmed.
	const before = leaves();
	event("keyDown", "leave", "LEAVE2", holdToLeave);
	await sleep(150);
	event("keyUp", "leave", "LEAVE2", holdToLeave);
	await sleep(300);
	check(leaves() === before, "a tap on a dimmed Leave key doesn't leave when Hold to leave is on");

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

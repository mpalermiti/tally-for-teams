/**
 * End-to-end smoke test of the BUILT plugin (bin/plugin.js), no hardware needed.
 *
 * Plays both counterparts: a fake Stream Deck app (launches the plugin with the
 * real CLI arguments and speaks its WebSocket protocol) and a fake Teams on
 * port 8124. Then walks through: draw offline → Teams comes up → meeting starts →
 * key press → pairing token saved.
 *
 * Usage: npm run build && npm run smoke   (8124 must be free, i.e. Teams closed)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(root, "ai.michaelp.teams.sdPlugin");
const UUID = "ai.michaelp.teams";
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
const listen = (port) =>
	new Promise((resolve, reject) => {
		const server = new WebSocketServer({ host: "127.0.0.1", port });
		server.once("listening", () => resolve(server));
		server.once("error", reject);
	});

// ── Fake Stream Deck ─────────────────────────────────────────────
const deck = await listen(0);
const fromPlugin = [];
let pluginSocket;
let globalSettings = {};
deck.on("connection", (socket) => {
	pluginSocket = socket;
	socket.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		fromPlugin.push(msg);
		if (msg.event === "getGlobalSettings") {
			socket.send(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: globalSettings } }));
		}
		if (msg.event === "setGlobalSettings") globalSettings = msg.payload;
	});
});
const toPlugin = (msg) => pluginSocket.send(JSON.stringify(msg));
const key = (kind, context, extra = {}) => ({
	action: `${UUID}.${kind}`,
	context,
	device: DEVICE,
	...extra,
});
const keyPayload = (settings = {}) => ({
	settings,
	coordinates: { column: 0, row: 0 },
	controller: "Keypad",
	isInMultiAction: false,
	state: 0,
});
const imagesFor = (context) => fromPlugin.filter((m) => m.event === "setImage" && m.context === context);
const lastImage = (context) => {
	const all = imagesFor(context);
	return all.length ? Buffer.from(all.at(-1).payload.image.split(",")[1], "base64").toString() : "";
};

// ── Launch the plugin like Stream Deck does ──────────────────────
const info = {
	application: { font: "", language: "en", platform: "mac", platformVersion: "15.0", version: "7.1.0.0" },
	colors: {},
	devicePixelRatio: 2,
	devices: [{ id: DEVICE, name: "Stream Deck", size: { columns: 5, rows: 3 }, type: 0 }],
	plugin: { uuid: UUID, version: "0.1.0.0" },
};
const plugin = spawn(
	process.execPath,
	["bin/plugin.js", "-port", String(deck.address().port), "-pluginUUID", UUID, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)],
	{ cwd: pluginDir, stdio: ["ignore", "inherit", "inherit"] },
);

let teams;
try {
	await until(() => fromPlugin.some((m) => m.event === "registerPlugin"), "plugin registers with Stream Deck");
	await until(() => fromPlugin.some((m) => m.event === "getGlobalSettings"), "plugin asks for its saved token");

	toPlugin({ event: "willAppear", ...key("mute", "MUTE1", { payload: keyPayload() }) });
	toPlugin({ event: "willAppear", ...key("react", "REACT1", { payload: keyPayload({ reaction: "love" }) }) });
	await until(() => imagesFor("MUTE1").length > 0, "mute key draws while Teams is closed");
	check(lastImage("MUTE1").includes("#3A3A42"), "…in the offline tone");

	// Teams starts.
	teams = await listen(8124);
	const teamsUrls = [];
	const toTeams = [];
	let teamsSocket;
	teams.on("connection", (socket, req) => {
		teamsSocket = socket;
		teamsUrls.push(new URL(req.url, "ws://x"));
		socket.on("message", (d) => toTeams.push(JSON.parse(d.toString())));
	});
	await until(() => teamsUrls.length > 0, "plugin connects to Teams once it's running", 20000);
	const q = teamsUrls[0].searchParams;
	check(q.get("protocol-version") === "2.0.0" && q.get("app") === "Teams Controls" && !q.has("token"), "…unpaired, with protocol 2.0.0 and app identity");

	// Meeting starts, mic live.
	teamsSocket.send(
		JSON.stringify({
			meetingUpdate: {
				meetingState: { isInMeeting: true, isMuted: false, isRecordingOn: true },
				meetingPermissions: { canToggleMute: true, canReact: true, canPair: true },
			},
		}),
	);
	await until(() => lastImage("MUTE1").includes("radialGradient"), "mute key lights up when the mic is live");
	check(lastImage("MUTE1").includes('data-badge="recording"'), "…with the recording badge");
	await until(() => lastImage("REACT1").includes("#EDEDF0"), "react key becomes ready");

	// Press mute → Teams gets toggle-mute, replies with a token (pairing), then state flips.
	toPlugin({ event: "keyDown", ...key("mute", "MUTE1", { payload: keyPayload() }) });
	await until(() => toTeams.some((m) => m.action === "toggle-mute"), "pressing mute sends toggle-mute to Teams");
	const req = toTeams.find((m) => m.action === "toggle-mute");
	teamsSocket.send(JSON.stringify({ tokenRefresh: "paired-token-123" }));
	teamsSocket.send(JSON.stringify({ requestId: req.requestId, response: "Success" }));
	teamsSocket.send(JSON.stringify({ meetingUpdate: { meetingState: { isMuted: true } } }));
	await until(() => globalSettings.teamsToken === "paired-token-123", "pairing token is saved to Stream Deck");
	await until(() => lastImage("MUTE1").includes("#8A8A94"), "mute key goes dark once muted");
	check(!fromPlugin.some((m) => m.event === "showAlert" && m.context === "MUTE1"), "no alert on a successful press");

	// Reaction uses the key's setting.
	toPlugin({ event: "keyDown", ...key("react", "REACT1", { payload: keyPayload({ reaction: "love" }) }) });
	await until(
		() => toTeams.some((m) => m.action === "send-reaction" && m.parameters.type === "love"),
		"react key sends the configured reaction",
	);

	// Teams refuses → alert.
	const refused = toTeams.find((m) => m.action === "send-reaction");
	teamsSocket.send(JSON.stringify({ requestId: refused.requestId, errorMsg: "Not allowed" }));
	await until(() => fromPlugin.some((m) => m.event === "showAlert" && m.context === "REACT1"), "a refused action flashes an alert");

	// Teams quits → keys dim; restarts → reconnects with the saved token.
	teamsSocket.terminate();
	await until(() => lastImage("MUTE1").includes("#3A3A42"), "keys dim when Teams quits");
	await until(() => teamsUrls.length > 1, "plugin reconnects when Teams returns", 20000);
	check(teamsUrls.at(-1).searchParams.get("token") === "paired-token-123", "…using the saved token");
} finally {
	plugin.kill();
	teams?.close();
	deck.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures.length ? 1 : 0);

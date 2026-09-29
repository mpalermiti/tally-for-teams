import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { AddressInfo } from "node:net";

import { TeamsClient, type Snapshot } from "../src/teams/client";

/** A stand-in for the Teams desktop app's local API. */
class FakeTeams {
	server!: WebSocketServer;
	sockets: ServerSocket[] = [];
	urls: URL[] = [];
	received: any[] = [];

	async start(port = 0): Promise<number> {
		this.server = new WebSocketServer({ host: "127.0.0.1", port });
		this.server.on("connection", (socket, req) => {
			this.sockets.push(socket);
			this.urls.push(new URL(req.url!, "ws://127.0.0.1"));
			socket.on("message", (data) => this.received.push(JSON.parse(data.toString())));
		});
		await new Promise((resolve) => this.server.once("listening", resolve));
		return (this.server.address() as AddressInfo).port;
	}

	get latest(): ServerSocket {
		return this.sockets[this.sockets.length - 1];
	}

	send(message: object): void {
		this.latest.send(JSON.stringify(message));
	}

	async stop(): Promise<void> {
		for (const s of this.sockets) s.terminate();
		await new Promise((resolve) => this.server.close(resolve));
	}
}

const identity = { manufacturer: "Test", device: "Deck", app: "Plugin", appVersion: "1.0.0" };

/** Resolves once `predicate` holds, polling briefly. */
async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
		await new Promise((r) => setTimeout(r, 10));
	}
}

describe("TeamsClient", () => {
	let teams: FakeTeams;
	let port: number;
	let client: TeamsClient;
	let snapshots: Snapshot[];

	beforeEach(async () => {
		teams = new FakeTeams();
		port = await teams.start();
		snapshots = [];
	});

	afterEach(async () => {
		client?.stop();
		await teams.stop();
	});

	function connect(opts: Partial<ConstructorParameters<typeof TeamsClient>[0]> = {}) {
		client = new TeamsClient({ url: `ws://127.0.0.1:${port}`, identity, backoffMs: [20], ...opts });
		client.on("change", (s) => snapshots.push(s));
		client.start();
		return until(() => client.snapshot.online);
	}

	it("connects with the protocol version and app identity, and no token before pairing", async () => {
		await connect();
		const q = teams.urls[0].searchParams;
		expect(q.get("protocol-version")).toBe("2.0.0");
		expect(q.get("manufacturer")).toBe("Test");
		expect(q.get("device")).toBe("Deck");
		expect(q.get("app")).toBe("Plugin");
		expect(q.get("app-version")).toBe("1.0.0");
		expect(q.has("token")).toBe(false);
	});

	it("sends the saved token once paired", async () => {
		await connect({ token: "abc" });
		expect(teams.urls[0].searchParams.get("token")).toBe("abc");
	});

	it("merges meeting updates into the snapshot", async () => {
		await connect();
		teams.send({
			meetingUpdate: {
				meetingState: { isInMeeting: true, isMuted: true },
				meetingPermissions: { canToggleMute: true },
			},
		});
		await until(() => client.snapshot.state.isInMeeting);
		expect(client.snapshot.state.isMuted).toBe(true);
		expect(client.snapshot.state.isVideoOn).toBe(false);
		expect(client.snapshot.permissions.canToggleMute).toBe(true);

		// A later partial update keeps fields it doesn't mention.
		teams.send({ meetingUpdate: { meetingState: { isVideoOn: true } } });
		await until(() => client.snapshot.state.isVideoOn);
		expect(client.snapshot.state.isMuted).toBe(true);
	});

	it("sends actions with increasing request ids and resolves on Teams' response", async () => {
		await connect();
		const first = client.request("toggle-mute");
		await until(() => teams.received.length === 1);
		expect(teams.received[0]).toEqual({ action: "toggle-mute", parameters: {}, requestId: 1 });
		teams.send({ requestId: 1, response: "Success" });
		await expect(first).resolves.toEqual({ ok: true, message: "Success" });

		const second = client.request("send-reaction", { type: "applause" });
		await until(() => teams.received.length === 2);
		expect(teams.received[1]).toEqual({ action: "send-reaction", parameters: { type: "applause" }, requestId: 2 });
		teams.send({ requestId: 2, errorMsg: "Action not allowed" });
		await expect(second).resolves.toEqual({ ok: false, message: "Action not allowed" });
	});

	it("fails fast when Teams isn't reachable", async () => {
		client = new TeamsClient({ url: `ws://127.0.0.1:${port}`, identity, backoffMs: [20] });
		// Never started, so never online.
		await expect(client.request("toggle-mute")).resolves.toEqual({ ok: false, message: "Teams is not connected" });
	});

	it("times out requests Teams never answers", async () => {
		await connect({ requestTimeoutMs: 50 });
		await expect(client.request("toggle-mute")).resolves.toEqual({ ok: false, message: "Teams did not respond" });
	});

	it("reports a new pairing token and reconnects with it", async () => {
		const tokens: string[] = [];
		await connect({ onToken: (t) => tokens.push(t) });
		teams.send({ tokenRefresh: "fresh-token" });
		await until(() => tokens.length === 1);
		expect(tokens).toEqual(["fresh-token"]);

		teams.latest.terminate();
		await until(() => teams.urls.length === 2);
		expect(teams.urls[1].searchParams.get("token")).toBe("fresh-token");
	});

	it("goes offline and forgets meeting state when Teams drops, then recovers", async () => {
		await connect();
		teams.send({ meetingUpdate: { meetingState: { isInMeeting: true } } });
		await until(() => client.snapshot.state.isInMeeting);

		teams.latest.terminate();
		await until(() => !client.snapshot.online);
		expect(client.snapshot.state.isInMeeting).toBe(false);

		await until(() => client.snapshot.online);
		expect(teams.sockets.length).toBe(2);
	});

	it("keeps retrying while Teams is closed, and connects once it starts", async () => {
		await teams.stop();
		client = new TeamsClient({ url: `ws://127.0.0.1:${port}`, identity, backoffMs: [20] });
		client.start();
		await new Promise((r) => setTimeout(r, 100));
		expect(client.snapshot.online).toBe(false);

		teams = new FakeTeams();
		await teams.start(port);
		await until(() => client.snapshot.online);
	});

	it("stops reconnecting after stop()", async () => {
		await connect();
		client.stop();
		await new Promise((r) => setTimeout(r, 100));
		expect(teams.sockets.length).toBe(1);
		expect(client.snapshot.online).toBe(false);
	});
});

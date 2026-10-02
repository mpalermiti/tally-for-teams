import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamsBridge, type BridgeProcess } from "../src/teams/bridge";
import type { Snapshot } from "../src/teams/protocol";
import { ANCHOR_ID, BUTTON_IDS } from "../src/teams/selectors";

/** Stands in for the Swift helper: records what the plugin writes, lets the test speak for it. */
class FakeHelper extends EventEmitter implements BridgeProcess {
	stdin = new PassThrough();
	stdout = new PassThrough();
	written: any[] = [];
	killed = false;

	constructor() {
		super();
		let buffer = "";
		this.stdin.on("data", (chunk) => {
			buffer += chunk.toString();
			let i: number;
			while ((i = buffer.indexOf("\n")) >= 0) {
				this.written.push(JSON.parse(buffer.slice(0, i)));
				buffer = buffer.slice(i + 1);
			}
		});
	}
	say(message: object): void {
		this.stdout.write(JSON.stringify(message) + "\n");
	}
	status(buttons: Record<string, string>, extra: object = {}): void {
		const entries = Object.entries(buttons).map(([id, label]) => [id, { label, enabled: true }]);
		this.say({ type: "status", trusted: true, running: true, buttons: Object.fromEntries(entries), ...extra });
	}
	crash(): void {
		this.emit("exit", 1);
	}
	kill(): void {
		this.killed = true;
		this.emit("exit", null);
	}
}

async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
		await new Promise((r) => setTimeout(r, 5));
	}
}

async function flushStatus(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("TeamsBridge", () => {
	let helpers: FakeHelper[];
	let bridge: TeamsBridge;
	let snapshots: Snapshot[];
	const latest = () => helpers[helpers.length - 1];

	function start(options: Partial<ConstructorParameters<typeof TeamsBridge>[0]> = {}) {
		helpers = [];
		snapshots = [];
		bridge = new TeamsBridge({
			command: "teams-bridge",
			spawn: () => {
				const helper = new FakeHelper();
				helpers.push(helper);
				return helper;
			},
			backoffMs: [10],
			requestTimeoutMs: 100,
			...options,
		});
		bridge.on("change", (s) => snapshots.push(s));
		bridge.start();
	}

	afterEach(() => {
		bridge?.stop();
		vi.useRealTimers();
	});

	it("starts offline, then tells the helper which buttons to watch", async () => {
		start();
		expect(bridge.snapshot).toMatchObject({ online: false, reason: "starting" });
		await until(() => latest().written.length > 0);
		expect(latest().written[0]).toMatchObject({
			cmd: "watch",
			anchor: ANCHOR_ID,
			bundleIds: ["com.microsoft.teams2"],
			indicatorContainers: ["indicators"],
			ids: expect.arrayContaining([
				...Object.values(BUTTON_IDS),
				"raisehands-button",
				"roster-button",
				"callingButtons-showMoreBtn",
			]),
		});
	});

	it("turns helper status into snapshots", async () => {
		start();
		latest().status({ [BUTTON_IDS.mute]: "Unmute mic" });
		await until(() => bridge.snapshot.online);
		expect(bridge.snapshot.state).toMatchObject({ isInMeeting: true, isMuted: true });
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await until(() => !bridge.snapshot.state.isMuted);
	});

	it("presses a button and resolves with the helper's result", async () => {
		start();
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await until(() => bridge.snapshot.online);

		const pending = bridge.request("toggle-mute");
		await until(() => latest().written.some((m) => m.cmd === "press"));
		const sent = latest().written.find((m) => m.cmd === "press");
		expect(sent).toMatchObject({ cmd: "press", id: BUTTON_IDS.mute, req: expect.any(Number) });
		latest().say({ type: "result", req: sent.req, ok: true, message: "pressed" });
		await expect(pending).resolves.toEqual({ ok: true, message: "pressed" });
	});

	it("passes a failed press through, so the key can flash an alert", async () => {
		start();
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await until(() => bridge.snapshot.online);
		const pending = bridge.request("send-reaction", { type: "wow" });
		await until(() => latest().written.some((m) => m.cmd === "menu"));
		const sent = latest().written.find((m) => m.cmd === "menu");
		latest().say({ type: "result", req: sent.req, ok: false, message: "No surprised/wow in menu" });
		await expect(pending).resolves.toEqual({ ok: false, message: "No surprised/wow in menu" });
	});

	it("sends Background blur requests through the video options menu", async () => {
		start();
		latest().status({ [BUTTON_IDS.mute]: "Mute mic", "video-button-configure": "Open video options" });
		await until(() => bridge.snapshot.online);

		const pending = bridge.request("set-background-blur", { type: "blur-on" });
		await until(() => latest().written.some((m) => m.cmd === "menu"));
		const sent = latest().written.find((m) => m.cmd === "menu");
		expect(sent).toMatchObject({
			cmd: "menu",
			id: "video-button-configure",
			itemIds: [],
			labels: ["blur"],
			excludeLabels: ["no background effect", "none"],
			req: expect.any(Number),
		});
		latest().say({ type: "result", req: sent.req, ok: true, message: "pressed Standard blur" });
		await expect(pending).resolves.toEqual({ ok: true, message: "pressed Standard blur" });
	});

	it("answers unsupported actions without bothering the helper", async () => {
		start();
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await until(() => bridge.snapshot.online);
		await expect(bridge.request("query-state")).resolves.toMatchObject({ ok: false });
		expect(latest().written.filter((m) => m.cmd !== "watch")).toEqual([]);
	});

	it("asks macOS for permission when a key is pressed without it", async () => {
		start();
		latest().status({}, { trusted: false });
		await until(() => bridge.snapshot.reason === "no-permission");
		const result = await bridge.request("toggle-mute");
		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/Accessibility/);
		expect(latest().written.some((m) => m.cmd === "prompt")).toBe(true);
	});

	it("times out if the helper never answers", async () => {
		start();
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await until(() => bridge.snapshot.online);
		await expect(bridge.request("toggle-mute")).resolves.toEqual({ ok: false, message: "Teams didn't respond" });
	});

	it("restarts a crashed helper and forgets meeting state meanwhile", async () => {
		start();
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await until(() => bridge.snapshot.online);

		const pending = bridge.request("toggle-mute");
		latest().crash();
		await expect(pending).resolves.toMatchObject({ ok: false });
		expect(bridge.snapshot).toMatchObject({ online: false, reason: "starting" });

		await until(() => helpers.length === 2 && latest().written.length > 0);
		expect(latest().written[0].cmd).toBe("watch");
	});

	it("ignores malformed output and forwards helper logs", async () => {
		const logs: string[] = [];
		start({ log: (m) => logs.push(m) });
		latest().stdout.write("not json\n");
		latest().say({ type: "log", message: "menu offered: Like | Heart" });
		await until(() => logs.length > 0);
		expect(logs).toContain("menu offered: Like | Heart");
	});

	it("publishes teams-changed from one marker-only status after the debounce timer", async () => {
		vi.useFakeTimers();
		const logs: string[] = [];
		start({ now: () => Date.now(), log: (m) => logs.push(m) });
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await flushStatus();
		expect(bridge.snapshot.state).toMatchObject({ isInMeeting: true, isMuted: false });

		const changed = {
			markers: ["hangup-button", "horizontalEnd"],
			markerControlIds: ["hangup-button", "share-button"],
		};
		latest().status({ "hangup-button": "Leave" }, changed);
		await flushStatus();
		expect(bridge.snapshot.reason).toBeUndefined();
		expect(bridge.snapshot.state).toMatchObject({ isInMeeting: true, isMuted: false });
		expect(vi.getTimerCount()).toBe(1);
		expect(logs.filter((m) => m.includes("teams-changed markers"))).toEqual([]);

		await vi.advanceTimersByTimeAsync(2_999);
		expect(bridge.snapshot.reason).toBeUndefined();

		await vi.advanceTimersByTimeAsync(1);
		expect(bridge.snapshot.reason).toBe("teams-changed");
		expect(logs.filter((m) => m.includes("teams-changed markers"))).toEqual([
			"teams-changed markers: hangup-button | horizontalEnd; control ids: hangup-button | share-button",
		]);

		latest().status({ "hangup-button": "Leave" }, changed);
		await flushStatus();
		expect(logs.filter((m) => m.includes("teams-changed markers"))).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(5_000);
		expect(logs.filter((m) => m.includes("teams-changed markers"))).toHaveLength(1);
	});

	it("clears a pending teams-changed timer when the helper crashes", async () => {
		vi.useFakeTimers();
		const logs: string[] = [];
		start({ now: () => Date.now(), log: (m) => logs.push(m) });
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await flushStatus();

		latest().status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"], markerControlIds: ["hangup-button"] });
		await flushStatus();
		expect(vi.getTimerCount()).toBe(1);

		latest().crash();
		expect(bridge.snapshot.reason).toBe("starting");
		expect(vi.getTimerCount()).toBe(1); // restart timer only; the teams-changed timer was cleared

		await vi.advanceTimersByTimeAsync(3_000);
		expect(bridge.snapshot.reason).toBe("starting");
		expect(logs.filter((m) => m.includes("teams-changed markers"))).toEqual([]);
	});

	it("cancels a pending teams-changed timer when a normal status arrives", async () => {
		vi.useFakeTimers();
		const logs: string[] = [];
		start({ now: () => Date.now(), log: (m) => logs.push(m) });
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await flushStatus();

		latest().status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"], markerControlIds: ["hangup-button"] });
		await flushStatus();
		expect(vi.getTimerCount()).toBe(1);

		await vi.advanceTimersByTimeAsync(1_500);
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await flushStatus();
		expect(bridge.snapshot.state.isInMeeting).toBe(true);
		expect(bridge.snapshot.reason).toBeUndefined();
		expect(vi.getTimerCount()).toBe(0);

		await vi.advanceTimersByTimeAsync(3_000);
		expect(bridge.snapshot.reason).toBeUndefined();
		expect(logs.filter((m) => m.includes("teams-changed markers"))).toEqual([]);
	});

	it("clears a pending teams-changed timer on stop", async () => {
		vi.useFakeTimers();
		const logs: string[] = [];
		start({ now: () => Date.now(), log: (m) => logs.push(m) });
		latest().status({ [BUTTON_IDS.mute]: "Mute mic" });
		await flushStatus();
		latest().status({ "hangup-button": "Leave" }, { markers: ["hangup-button", "horizontalEnd"], markerControlIds: ["hangup-button"] });
		await flushStatus();
		expect(vi.getTimerCount()).toBe(1);

		bridge.stop();
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(logs.filter((m) => m.includes("teams-changed markers"))).toEqual([]);
	});

	it("stops the helper and doesn't restart it", async () => {
		start();
		bridge.stop();
		await new Promise((r) => setTimeout(r, 50));
		expect(helpers.length).toBe(1);
		expect(helpers[0].killed).toBe(true);
	});
});

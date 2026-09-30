import { spawn as spawnProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import {
	EMPTY_STATE,
	NO_PERMISSIONS,
	type ActionParameters,
	type RequestResult,
	type Snapshot,
	type TeamsAction,
} from "./protocol";
import { ANCHOR_ID, TEAMS_BUNDLE_IDS, WATCH_IDS, commandFor, snapshotFrom, type BridgeStatus } from "./selectors";

/** The parts of a child process the bridge uses; tests substitute a fake. */
export interface BridgeProcess {
	stdin: Writable;
	stdout: Readable;
	on(event: "exit", listener: (code: number | null) => void): unknown;
	kill(): void;
}

export interface TeamsBridgeOptions {
	/** Path to the compiled teams-bridge helper. */
	command: string;
	spawn?: (command: string) => BridgeProcess;
	/** Restart delays after the helper exits; the last value repeats. */
	backoffMs?: number[];
	requestTimeoutMs?: number;
	log?: (message: string) => void;
}

interface Pending {
	resolve: (result: RequestResult) => void;
	timer: NodeJS.Timeout;
}

const STARTING: Snapshot = { online: false, reason: "starting", state: EMPTY_STATE, permissions: NO_PERMISSIONS };

const PERMISSION_HINT = "Allow Stream Deck in System Settings → Privacy & Security → Accessibility";

/**
 * Runs the Swift helper that reads Teams through macOS Accessibility, and turns its
 * reports into meeting snapshots for the keys. Same shape the keys used with Teams'
 * retired local API: a live `snapshot`, a `change` event, and `request()`.
 */
export class TeamsBridge extends EventEmitter<{ change: [Snapshot] }> {
	#options: Required<Omit<TeamsBridgeOptions, "log">> & Pick<TeamsBridgeOptions, "log">;
	#process: BridgeProcess | undefined;
	#snapshot: Snapshot = STARTING;
	#running = false;
	#attempt = 0;
	#restartTimer: NodeJS.Timeout | undefined;
	#nextRequestId = 1;
	#pending = new Map<number, Pending>();

	constructor(options: TeamsBridgeOptions) {
		super();
		this.#options = {
			spawn: (command) => spawnProcess(command, [], { stdio: ["pipe", "pipe", "inherit"] }) as BridgeProcess,
			backoffMs: [1_000, 2_000, 5_000, 10_000],
			requestTimeoutMs: 4_000, // menus take up to ~2 s to open and search
			...options,
		};
	}

	get snapshot(): Snapshot {
		return this.#snapshot;
	}

	start(): void {
		if (this.#running) return;
		this.#running = true;
		this.#launch();
	}

	stop(): void {
		this.#running = false;
		clearTimeout(this.#restartTimer);
		const process = this.#process;
		this.#process = undefined;
		process?.kill();
		this.#reset();
	}

	/** Performs a key's action in Teams. Never rejects. */
	async request(action: TeamsAction, parameters: ActionParameters = {}): Promise<RequestResult> {
		const command = commandFor(action, parameters);
		if ("unsupported" in command) return { ok: false, message: command.unsupported };

		if (this.#snapshot.reason === "no-permission") {
			this.#write({ cmd: "prompt" });
			return { ok: false, message: PERMISSION_HINT };
		}
		if (!this.#process || !this.#snapshot.online) return { ok: false, message: "Teams isn't running" };

		const req = this.#nextRequestId++;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(req);
				resolve({ ok: false, message: "Teams didn't respond" });
			}, this.#options.requestTimeoutMs);
			this.#pending.set(req, { resolve, timer });
			this.#write({ ...command, req });
		});
	}

	#launch(): void {
		const process = this.#options.spawn(this.#options.command);
		this.#process = process;

		createInterface({ input: process.stdout }).on("line", (line) => {
			if (this.#process === process) this.#handle(line);
		});
		process.on("exit", () => {
			if (this.#process !== process) return; // stopped on purpose
			this.#process = undefined;
			this.#options.log?.("teams-bridge exited; restarting");
			this.#reset();
			this.#scheduleRestart();
		});
		// A missing or unlaunchable binary surfaces as an error event on real processes.
		(process as unknown as EventEmitter).on?.("error", (error: Error) => this.#options.log?.(`teams-bridge: ${error.message}`));

		this.#write({ cmd: "watch", ids: WATCH_IDS, anchor: ANCHOR_ID, bundleIds: TEAMS_BUNDLE_IDS });
	}

	#handle(line: string): void {
		let message: { type?: string; req?: number; ok?: boolean; message?: string };
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (message.type === "status") {
			this.#attempt = 0;
			this.#publish(snapshotFrom(message as BridgeStatus));
		} else if (message.type === "result" && typeof message.req === "number") {
			const pending = this.#pending.get(message.req);
			if (!pending) return;
			this.#pending.delete(message.req);
			clearTimeout(pending.timer);
			pending.resolve({ ok: message.ok === true, message: message.message ?? "" });
		} else if (message.type === "log" && message.message) {
			this.#options.log?.(message.message);
		}
	}

	#write(message: object): void {
		this.#process?.stdin.write(JSON.stringify(message) + "\n");
	}

	#scheduleRestart(): void {
		if (!this.#running) return;
		const delays = this.#options.backoffMs;
		const delay = delays[Math.min(this.#attempt, delays.length - 1)];
		this.#attempt++;
		this.#restartTimer = setTimeout(() => this.#launch(), delay);
	}

	/** Meeting state is unknowable without the helper, so forget it rather than show stale keys. */
	#reset(): void {
		for (const { resolve, timer } of this.#pending.values()) {
			clearTimeout(timer);
			resolve({ ok: false, message: "Lost contact with Teams" });
		}
		this.#pending.clear();
		if (this.#snapshot !== STARTING) this.#publish(STARTING);
	}

	#publish(snapshot: Snapshot): void {
		if (JSON.stringify(snapshot) === JSON.stringify(this.#snapshot)) return;
		this.#snapshot = snapshot;
		this.emit("change", snapshot);
	}
}

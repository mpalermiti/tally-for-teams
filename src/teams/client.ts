import { EventEmitter } from "node:events";

import {
	EMPTY_STATE,
	NO_PERMISSIONS,
	PROTOCOL_VERSION,
	TEAMS_PORT,
	type ActionParameters,
	type ClientMessage,
	type MeetingPermissions,
	type MeetingState,
	type ServerMessage,
	type TeamsAction,
} from "./protocol";

/** What every key renders from. Replaced (never mutated) on each change. */
export interface Snapshot {
	/** True while the socket to Teams is open. */
	online: boolean;
	state: MeetingState;
	permissions: MeetingPermissions;
}

export interface RequestResult {
	ok: boolean;
	message: string;
}

export interface TeamsClientOptions {
	/** Shown to the user in Teams' pairing prompt and its list of connected apps. */
	identity: { manufacturer: string; device: string; app: string; appVersion: string };
	/** Pairing token from a previous session, if any. */
	token?: string;
	/** Called whenever Teams issues a new token; persist it so the next launch skips pairing. */
	onToken?: (token: string) => void;
	url?: string;
	/** Reconnect delays; the last value repeats forever. */
	backoffMs?: number[];
	requestTimeoutMs?: number;
}

interface Pending {
	resolve: (result: RequestResult) => void;
	timer: NodeJS.Timeout;
}

const OFFLINE: Snapshot = { online: false, state: EMPTY_STATE, permissions: NO_PERMISSIONS };

/**
 * One long-lived connection to the Teams local API, shared by every key.
 *
 * Teams may be closed, restarting, or have the API switched off, so the client
 * treats "not connected" as a normal state: it retries quietly in the background
 * and keys render dimmed until Teams answers.
 */
export class TeamsClient extends EventEmitter<{ change: [Snapshot] }> {
	#options: Required<Omit<TeamsClientOptions, "token" | "onToken">> & Pick<TeamsClientOptions, "onToken">;
	#token: string | undefined;
	#socket: WebSocket | undefined;
	#snapshot: Snapshot = OFFLINE;
	#running = false;
	#attempt = 0;
	#retryTimer: NodeJS.Timeout | undefined;
	#nextRequestId = 1;
	#pending = new Map<number, Pending>();

	constructor(options: TeamsClientOptions) {
		super();
		this.#options = {
			url: `ws://127.0.0.1:${TEAMS_PORT}`,
			backoffMs: [1_000, 2_000, 5_000, 10_000, 15_000],
			requestTimeoutMs: 5_000,
			...options,
		};
		this.#token = options.token;
	}

	get snapshot(): Snapshot {
		return this.#snapshot;
	}

	/** @param token Saved pairing token, when it's only known after construction (e.g. loaded from Stream Deck). */
	start(token?: string): void {
		if (this.#running) return;
		if (token) this.#token = token;
		this.#running = true;
		this.#connect();
	}

	stop(): void {
		this.#running = false;
		clearTimeout(this.#retryTimer);
		this.#socket?.close();
		this.#socket = undefined;
		this.#goOffline();
	}

	/** Sends an action and resolves with Teams' reply. Never rejects. */
	request(action: TeamsAction, parameters: ActionParameters = {}): Promise<RequestResult> {
		const socket = this.#socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return Promise.resolve({ ok: false, message: "Teams is not connected" });
		}

		const requestId = this.#nextRequestId++;
		const message: ClientMessage = { action, parameters, requestId };

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(requestId);
				resolve({ ok: false, message: "Teams did not respond" });
			}, this.#options.requestTimeoutMs);
			this.#pending.set(requestId, { resolve, timer });
			socket.send(JSON.stringify(message));
		});
	}

	#connect(): void {
		const { identity } = this.#options;
		const url = new URL(this.#options.url);
		if (this.#token) url.searchParams.set("token", this.#token);
		url.searchParams.set("protocol-version", PROTOCOL_VERSION);
		url.searchParams.set("manufacturer", identity.manufacturer);
		url.searchParams.set("device", identity.device);
		url.searchParams.set("app", identity.app);
		url.searchParams.set("app-version", identity.appVersion);

		const socket = new WebSocket(url);
		this.#socket = socket;

		socket.addEventListener("open", () => {
			this.#attempt = 0;
			this.#publish({ ...this.#snapshot, online: true });
		});

		socket.addEventListener("message", (event) => {
			this.#handle(String(event.data));
		});

		// Node's WebSocket fires only "error" (never "close") when the connection is
		// refused — e.g. Teams isn't running — so both events count as a drop.
		const dropped = () => {
			if (this.#socket !== socket) return; // already handled, superseded, or stopped
			this.#socket = undefined;
			socket.close();
			this.#goOffline();
			this.#scheduleReconnect();
		};
		socket.addEventListener("error", dropped);
		socket.addEventListener("close", dropped);
	}

	#handle(raw: string): void {
		let message: ServerMessage;
		try {
			message = JSON.parse(raw);
		} catch {
			return; // Teams only sends JSON; ignore anything else rather than crash the plugin.
		}

		if (message.tokenRefresh) {
			this.#token = message.tokenRefresh;
			this.#options.onToken?.(message.tokenRefresh);
		}

		if (message.meetingUpdate) {
			const { meetingState, meetingPermissions } = message.meetingUpdate;
			this.#publish({
				online: this.#snapshot.online,
				state: { ...this.#snapshot.state, ...meetingState },
				permissions: { ...this.#snapshot.permissions, ...meetingPermissions },
			});
		}

		if (message.requestId !== undefined) {
			const pending = this.#pending.get(message.requestId);
			if (pending) {
				this.#pending.delete(message.requestId);
				clearTimeout(pending.timer);
				pending.resolve(
					message.errorMsg
						? { ok: false, message: message.errorMsg }
						: { ok: true, message: message.response ?? "" },
				);
			}
		}
	}

	#scheduleReconnect(): void {
		if (!this.#running) return;
		const delays = this.#options.backoffMs;
		const delay = delays[Math.min(this.#attempt, delays.length - 1)];
		this.#attempt++;
		this.#retryTimer = setTimeout(() => this.#connect(), delay);
	}

	/** Meeting state is unknowable while disconnected, so forget it rather than show stale keys. */
	#goOffline(): void {
		for (const { resolve, timer } of this.#pending.values()) {
			clearTimeout(timer);
			resolve({ ok: false, message: "Teams disconnected" });
		}
		this.#pending.clear();
		if (this.#snapshot !== OFFLINE) this.#publish(OFFLINE);
	}

	#publish(snapshot: Snapshot): void {
		this.#snapshot = snapshot;
		this.emit("change", snapshot);
	}
}

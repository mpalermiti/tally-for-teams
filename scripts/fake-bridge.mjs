#!/usr/bin/env node
/**
 * Stand-in for bin/teams-bridge in the smoke test. It relays: lines the plugin writes
 * go to the smoke test over a WebSocket (FAKE_BRIDGE_URL), and whatever the smoke test
 * sends comes back out as lines, so the smoke test can play Teams + Accessibility.
 */
import { createInterface } from "node:readline";
import { WebSocket } from "ws";

const socket = new WebSocket(process.env.FAKE_BRIDGE_URL);
const queued = [];
socket.on("open", () => queued.splice(0).forEach((line) => socket.send(line)));
socket.on("message", (data) => process.stdout.write(data.toString() + "\n"));
socket.on("close", () => process.exit(1)); // the smoke test "crashed" us
createInterface({ input: process.stdin }).on("line", (line) =>
	socket.readyState === WebSocket.OPEN ? socket.send(line) : queued.push(line),
);
process.stdin.on("end", () => process.exit(0));

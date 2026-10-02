import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PLUGIN_DIR = join(ROOT, "ai.michaelp.tally.sdPlugin");
const OUT_DIR = join(PLUGIN_DIR, "profiles");
const MANIFEST_PATH = join(PLUGIN_DIR, "manifest.json");
const PLUGIN_UUID = "ai.michaelp.tally";
const PLUGIN_NAME = "Tally for Teams";

type Controller = "Keypad" | "Encoder";
type ProfileAction = {
	uuid: string;
	name: string;
	settings?: Record<string, string | boolean | number>;
};
type Layout = Record<string, ProfileAction>;
export type DeviceProfile = {
	manifestName: string;
	displayName: string;
	deviceType: number;
	model: string;
	columns: number;
	rows: number;
	encoders: number;
	profileUuid: string;
	defaultPageUuid: string;
	pageUuid: string;
	keys: Layout;
	dials?: Layout;
};

export type BuiltProfileFile = { path: string; data: Buffer };

const action = (kind: string, name: string, settings?: ProfileAction["settings"]): ProfileAction => ({
	uuid: `${PLUGIN_UUID}.${kind}`,
	name,
	...(settings ? { settings } : {}),
});

export const PROFILES: readonly DeviceProfile[] = [
	{
		manifestName: "profiles/Tally (Stream Deck)",
		displayName: "Tally (Stream Deck)",
		deviceType: 0,
		model: "20GBA9901",
		columns: 5,
		rows: 3,
		encoders: 0,
		profileUuid: "F5E31DC0-4615-4EDC-A66E-C05F1C54F101",
		defaultPageUuid: "96F1C6AE-93D8-4F85-B1E4-6FE9F86C4892",
		pageUuid: "8D03D640-0B4F-4A5E-8C69-7C8D789B4011",
		keys: {
			"0,0": action("mute", "Mute"),
			"1,0": action("camera", "Camera"),
			"2,0": action("hand", "Raise hand"),
			"3,0": action("share", "Share"),
			"4,0": action("chat", "Chat"),
			"0,1": action("react", "React: Like", { reaction: "like" }),
			"1,1": action("react", "React: Love", { reaction: "love" }),
			"2,1": action("react", "React: Applause", { reaction: "applause" }),
			"3,1": action("react", "React: Laugh", { reaction: "laugh" }),
			"4,1": action("react", "React: Wow", { reaction: "wow" }),
			"0,2": action("people", "People"),
			"1,2": action("blur", "Background blur"),
			"2,2": action("timer", "Meeting timer"),
			"4,2": action("leave", "Leave", { holdToLeave: true }),
		},
	},
	{
		manifestName: "profiles/Tally (Stream Deck +)",
		displayName: "Tally (Stream Deck +)",
		deviceType: 7,
		model: "20GBD9901",
		columns: 4,
		rows: 2,
		encoders: 4,
		profileUuid: "6A3B3ED8-BE93-47C8-A82D-75AD9C7F02E1",
		defaultPageUuid: "2212BB7A-BE19-4D92-A7BC-A1FB6F45009E",
		pageUuid: "B016A418-0555-4B3E-B859-28A2B3861931",
		keys: {
			"0,0": action("mute", "Mute"),
			"1,0": action("camera", "Camera"),
			"2,0": action("hand", "Raise hand"),
			"3,0": action("share", "Share"),
			"0,1": action("react", "React: Like", { reaction: "like" }),
			"1,1": action("people", "People"),
			"2,1": action("timer", "Meeting timer"),
			"3,1": action("leave", "Leave", { holdToLeave: true }),
		},
		dials: {
			"0,0": action("mute", "Mute"),
		},
	},
] as const;

export function buildProfileSummary() {
	const profiles = Object.fromEntries(
		PROFILES.map((profile) => [
			profile.manifestName,
			{
				deviceType: profile.deviceType,
				model: profile.model,
				keys: summarizeLayout(profile.keys),
				dials: summarizeLayout(profile.dials ?? {}),
			},
		]),
	);
	const sourceHash = createHash("sha256").update(JSON.stringify(profiles)).digest("hex");
	return { version: 1, sourceHash, profiles };
}

function summarizeLayout(layout: Layout): Record<string, { uuid: string; settings?: ProfileAction["settings"] }> {
	return Object.fromEntries(
		Object.entries(layout)
			.sort(([a], [b]) => a.localeCompare(b, "en"))
			.map(([position, action]) => [
				position,
				{
					uuid: action.uuid,
					...(action.settings ? { settings: action.settings } : {}),
				},
			]),
	);
}

function profileRootManifest(profile: DeviceProfile) {
	return {
		Device: { Model: profile.model, UUID: "" },
		InstalledByPluginUUID: PLUGIN_UUID,
		Name: profile.displayName,
		Pages: { Current: profile.pageUuid, Default: profile.defaultPageUuid, Pages: [profile.pageUuid] },
		PreconfiguredName: profile.manifestName,
		Version: "3.0",
	};
}

function pageManifest(profile: DeviceProfile, { empty = false, pluginVersion = readPluginVersion() } = {}) {
	return {
		Controllers: [
			{ Actions: placedActions(profile, "Keypad", empty ? {} : profile.keys, pluginVersion), Type: "Keypad" },
			...(profile.encoders > 0
				? [{ Actions: placedActions(profile, "Encoder", empty ? {} : (profile.dials ?? {}), pluginVersion), Type: "Encoder" }]
				: []),
		],
		Icon: "",
		Name: "",
	};
}

function placedActions(profile: DeviceProfile, controller: Controller, layout: Layout, pluginVersion: string): Record<string, object> | null {
	const placed = Object.fromEntries(
		Object.entries(layout)
			.sort(([a], [b]) => a.localeCompare(b, "en"))
			.map(([position, profileAction]) => {
				assertPosition(profile, controller, position);
				return [
					position,
					{
						ActionID: stableUuid(`${profile.manifestName}:${controller}:${position}:${profileAction.uuid}`),
						LinkedTitle: true,
						Name: profileAction.name,
						Plugin: { Name: PLUGIN_NAME, UUID: PLUGIN_UUID, Version: pluginVersion },
						Resources: null,
						Settings: profileAction.settings ?? {},
						State: 0,
						States: [
							{
								FontFamily: "",
								FontSize: 9,
								FontStyle: "",
								FontUnderline: false,
								OutlineThickness: 2,
								ShowTitle: false,
								TitleAlignment: "bottom",
								TitleColor: "#ffffff",
							},
						],
						UUID: profileAction.uuid,
					},
				];
			}),
	);
	return Object.keys(placed).length === 0 ? null : placed;
}

function assertPosition(profile: DeviceProfile, controller: Controller, position: string): void {
	const [column, row] = position.split(",").map((part) => Number(part));
	const offKeypad = controller === "Keypad" && (column >= profile.columns || row >= profile.rows);
	const offEncoder = controller === "Encoder" && (column >= profile.encoders || row !== 0);
	if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 || offKeypad || offEncoder) {
		throw new Error(`${profile.displayName}: ${controller} position ${position} is outside the device layout`);
	}
}

function stableUuid(source: string): string {
	const hex = createHash("sha1").update(source).digest("hex").slice(0, 32).toUpperCase();
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readPluginVersion(): string {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")).Version;
}

export function buildProfileArchiveEntries(profile: DeviceProfile): ZipEntry[] {
	const root = `${profile.profileUuid}.sdProfile`;
	const pluginVersion = readPluginVersion();
	return [
		{ path: `${root}/manifest.json`, data: Buffer.from(JSON.stringify(profileRootManifest(profile)), "utf8") },
		{
			path: `${root}/Profiles/${profile.defaultPageUuid.toUpperCase()}/manifest.json`,
			data: Buffer.from(JSON.stringify(pageManifest(profile, { empty: true, pluginVersion })), "utf8"),
		},
		{
			path: `${root}/Profiles/${profile.pageUuid.toUpperCase()}/manifest.json`,
			data: Buffer.from(JSON.stringify(pageManifest(profile, { pluginVersion })), "utf8"),
		},
	];
}

function buildProfileArchive(profile: DeviceProfile): Buffer {
	return zipBuffer(buildProfileArchiveEntries(profile));
}

export function buildProfileFiles(): BuiltProfileFile[] {
	return [
		...PROFILES.map((profile) => ({
			path: `${profile.manifestName}.streamDeckProfile`,
			data: buildProfileArchive(profile),
		})),
		{
			path: "profiles/summary.json",
			data: Buffer.from(JSON.stringify(buildProfileSummary(), null, "\t") + "\n", "utf8"),
		},
	];
}

function writeManifestProfiles(): void {
	const raw = readFileSync(MANIFEST_PATH, "utf8");
	const manifest = JSON.parse(raw);
	manifest.Profiles = PROFILES.map((profile) => ({
		Name: profile.manifestName,
		DeviceType: profile.deviceType,
		Readonly: false,
		DontAutoSwitchWhenInstalled: true,
	}));
	writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, "\t") + "\n");
}

function writeProfiles(): void {
	rmSync(OUT_DIR, { recursive: true, force: true });
	mkdirSync(OUT_DIR, { recursive: true });
	for (const file of buildProfileFiles()) {
		const outPath = join(PLUGIN_DIR, file.path);
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, file.data);
	}
	writeManifestProfiles();
}

type ZipEntry = { path: string; data: Buffer };

function zipBuffer(entries: ZipEntry[]): Buffer {
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;

	for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path, "en"))) {
		const name = Buffer.from(entry.path, "utf8");
		const crc = crc32(entry.data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(0, 8);
		local.writeUInt16LE(0, 10);
		local.writeUInt16LE(33, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(entry.data.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		parts.push(local, name, entry.data);

		const header = Buffer.alloc(46);
		header.writeUInt32LE(0x02014b50, 0);
		header.writeUInt16LE(20, 4);
		header.writeUInt16LE(20, 6);
		header.writeUInt16LE(0x0800, 8);
		header.writeUInt16LE(0, 10);
		header.writeUInt16LE(0, 12);
		header.writeUInt16LE(33, 14);
		header.writeUInt32LE(crc, 16);
		header.writeUInt32LE(entry.data.length, 20);
		header.writeUInt32LE(entry.data.length, 24);
		header.writeUInt16LE(name.length, 28);
		header.writeUInt16LE(0, 30);
		header.writeUInt16LE(0, 32);
		header.writeUInt16LE(0, 34);
		header.writeUInt16LE(0, 36);
		header.writeUInt32LE(0, 38);
		header.writeUInt32LE(offset, 42);
		central.push(header, name);
		offset += local.length + name.length + entry.data.length;
	}

	const centralSize = central.reduce((sum, part) => sum + part.length, 0);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(offset, 16);
	eocd.writeUInt16LE(0, 20);
	return Buffer.concat([...parts, ...central, eocd]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
	return value >>> 0;
});

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	writeProfiles();
	console.log(`profiles: ${PROFILES.map((profile) => `${profile.manifestName}.streamDeckProfile`).join(", ")}`);
}

export const profileArtifactsExist = () => PROFILES.every((profile) => existsSync(join(PLUGIN_DIR, `${profile.manifestName}.streamDeckProfile`)));

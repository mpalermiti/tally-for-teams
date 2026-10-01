/** Dev aid: renders every key in every meaningful state to one PNG. `node --import tsx scripts/sheet.ts <out.png>` */
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { KEY_KINDS, keySvg, muteDialFeedback, visualFor, OFFLINE_SNAPSHOT } from "../src/render/key";
import { EMPTY_STATE, NO_PERMISSIONS } from "../src/teams/protocol";

const all = Object.fromEntries(Object.keys(NO_PERMISSIONS).map((k) => [k, true])) as any;
const meet = (s: object = {}) => ({ online: true, state: { ...EMPTY_STATE, isInMeeting: true, ...s }, permissions: all });
const rows: [string, any, object?][] = [
	["offline", OFFLINE_SNAPSHOT],
	["no meeting", { online: true, state: EMPTY_STATE, permissions: NO_PERMISSIONS }],
	["muted / off", meet({ isMuted: true })],
	["live / on", meet({ isVideoOn: true, isHandRaised: true, isSharing: true })],
];
const cell = 160, pad = 8, label = 150;
let body = "";
rows.forEach(([name, snap], r) => {
	body += `<text x="10" y="${r * cell + 88}" fill="#999" font-family="Helvetica" font-size="18">${name}</text>`;
	KEY_KINDS.forEach((kind, c) => {
		const svg = keySvg(visualFor(kind, snap, { reaction: "love" }));
		const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").replaceAll('id="g"', `id="g${r}${c}"`).replaceAll("url(#g)", `url(#g${r}${c})`);
		body += `<g transform="translate(${label + c * cell + pad} ${r * cell + pad})"><clipPath id="c${r}${c}"><rect width="144" height="144" rx="22"/></clipPath><g clip-path="url(#c${r}${c})">${inner}</g></g>`;
	});
});
// Mute dial strips (Stream Deck+), one per state. Text approximates layouts/mute-dial.json's native text.
const dialStates: [string, any][] = [
	["offline", OFFLINE_SNAPSHOT],
	["no meeting", { online: true, state: EMPTY_STATE, permissions: NO_PERMISSIONS }],
	["muted", meet({ isMuted: true })],
	["live", meet()],
];
const dialTop = rows.length * cell + 24;
body += `<text x="10" y="${dialTop + 56}" fill="#999" font-family="Helvetica" font-size="18">mute dial</text>`;
dialStates.forEach(([, snap], i) => {
	const f = muteDialFeedback(snap);
	const face = Buffer.from(f.face.split(",")[1], "base64").toString()
		.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")
		.replaceAll('id="g"', `id="d${i}"`).replaceAll("url(#g)", `url(#d${i})`);
	const x = label + pad + i * 216;
	body += `<g transform="translate(${x} ${dialTop})"><clipPath id="dc${i}"><rect width="200" height="100" rx="10"/></clipPath><g clip-path="url(#dc${i})">${face}` +
		`<text x="90" y="48" fill="${f.label.color}" font-family="Helvetica" font-weight="600" font-size="22">${f.label.value}</text>` +
		`<text x="90" y="69" fill="${f.detail.color}" font-family="Helvetica" font-weight="500" font-size="13">${f.detail.value}</text></g></g>`;
});

const w = label + KEY_KINDS.length * cell, h = dialTop + 124;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#050505"/>${body}</svg>`;
writeFileSync(process.argv[2], new Resvg(sheet, { font: { loadSystemFonts: true } }).render().asPng());

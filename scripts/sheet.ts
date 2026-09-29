/** Dev aid: renders every key in every meaningful state to one PNG. `node --import tsx scripts/sheet.ts <out.png>` */
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { KEY_KINDS, keySvg, visualFor, OFFLINE_SNAPSHOT } from "../src/render/key";
import { EMPTY_STATE, NO_PERMISSIONS } from "../src/teams/protocol";

const all = Object.fromEntries(Object.keys(NO_PERMISSIONS).map((k) => [k, true])) as any;
const meet = (s: object = {}) => ({ online: true, state: { ...EMPTY_STATE, isInMeeting: true, ...s }, permissions: all });
const rows: [string, any, object?][] = [
	["offline", OFFLINE_SNAPSHOT],
	["no meeting", { online: true, state: EMPTY_STATE, permissions: NO_PERMISSIONS }],
	["muted / off", meet({ isMuted: true })],
	["live / on", meet({ isVideoOn: true, isBackgroundBlurred: true, isHandRaised: true, hasUnreadMessages: true, isSharing: true, isRecordingOn: true })],
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
const w = label + KEY_KINDS.length * cell, h = rows.length * cell;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#050505"/>${body}</svg>`;
writeFileSync(process.argv[2], new Resvg(sheet, { font: { loadSystemFonts: true } }).render().asPng());

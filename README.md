# Teams Controls for Stream Deck

Microsoft Teams meeting controls with live state on every key. Built on the local
**third-party app API** that new Teams exposes, the same one Microsoft's discontinued
plugin used, so there's no cloud service, account, or Graph permission involved.

![Every key in every state](docs/keys.png)

**One rule: a lit key means it's live.** Warm = your mic is hot, camera is on, hand is up,
you're sharing, or chat has unread messages. Dark = off. Dimmed = not in a meeting
(dimmer still = Teams isn't reachable). Leave turns red during a meeting. A red dot on
mic and camera means the meeting is being recorded.

| Key | Press | Lit when |
|---|---|---|
| Mute | toggle mic (also works on a Stream Deck+ dial, see below) | mic is live |
| Camera | toggle camera | camera is on |
| Background blur | toggle blur | blurred |
| Raise hand | raise / lower | hand is up |
| Leave | leave the meeting | (red during a meeting) |
| React | send the reaction chosen in the key's settings | — |
| Chat | open / close meeting chat | unread messages |
| Share | open the share tray; while presenting, stop sharing | sharing |

### Stream Deck+ dial

Put **Mute** on a dial and its strip shows a large **Live** or **Muted**, with what holding will
do, or a recording warning.

- **Tap** the dial: toggle mute.
- **Hold** the dial: flip the mic only while held. Muted, it's push-to-talk; live, it's a cough button.
- **Turn right** to unmute, **left** to mute. Turning toward the state you're already in does nothing.
- **Touch** the strip: toggle mute.

## Setup

Requires Stream Deck 7.1+ and new Teams.

1. **Turn on the Teams API:** Teams → Settings → Privacy → Third-party app API → Manage API → **Enable API**.
2. **Install the plugin:**
   ```bash
   npm install
   npm run pack        # builds ai.michaelp.teams.streamDeckPlugin — double-click to install
   ```
   Or, for development, `npm run build && npm run link` (needs the Elgato CLI: `npm i -g @elgato/cli`).
3. **Pair:** drag some keys onto your deck, join a meeting, press any key. Teams asks to allow
   "Teams Controls"; click Allow. The token is saved, so this happens once.

Teams only lets apps pair *during a meeting*. Until you pair, keys show connection state but
Teams won't report meeting state.

## Development

```bash
npm test            # unit tests: Teams client (against a fake Teams), key/dial visuals, dial gestures
npm run typecheck
npm run build       # bundle to ai.michaelp.teams.sdPlugin/bin/plugin.js
npm run smoke       # end-to-end: runs the built plugin against a fake Stream Deck + fake Teams
npm run watch       # rebuild + restart the plugin in Stream Deck on save
npm run icons       # regenerate glyphs.ts and every PNG after design changes
npm run sheet -- out.png   # render all keys in all states to one image
```

`npm run smoke` needs port 8124 free, so quit Teams first.

```
src/teams/protocol.ts   wire types for the Teams local API (ws://127.0.0.1:8124, protocol 2.0.0)
src/teams/client.ts     one shared connection: pairing token, reconnect, request/response
src/render/key.ts       meeting state → key visual (pure), and the SVG key design
src/actions/            one class per key; shared behaviour in teams-key.ts, dial gestures in gestures.ts
src/plugin.ts           wiring: load the saved token, register keys, redraw on change
```

## Notes

- **Token storage:** the pairing token lives in Stream Deck's plugin settings on disk. It only
  lets a local process control your meetings; revoke it anytime in Teams' Manage API screen.
- **What the API can't do:** join meetings, set presence, or read chat or calendar. Those need
  Microsoft Graph and an Entra app registration, which this plugin deliberately avoids.
- Glyphs from [Lucide](https://lucide.dev) (ISC); `wow` and `blur` are custom on the same grid.

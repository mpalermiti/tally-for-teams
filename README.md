# Teams Controls for Stream Deck

Microsoft Teams meeting controls for Mac, with live state on every key. Works while Teams
is in the background.

Microsoft retired Teams' local control API (the one its own Stream Deck plugin used) on
June 30, 2026, with no replacement. This plugin instead works the way a screen reader does:
through **macOS Accessibility** it reads Teams' meeting buttons ("Mute mic" / "Unmute mic")
to know your state, and presses them when you press a key. There's no cloud service,
account, or Graph permission involved, and it never reads chat or message content.

![Every key in every state](docs/keys.png)

**One rule: a lit key means it's live.** Warm = your mic is hot, camera is on, your hand is up,
you're sharing, or chat has unread messages. Dark = off. Dimmed = not in a meeting (dimmer still =
Teams isn't readable). Leave turns red during a meeting.

| Key | Press | Lit when | Status on Teams 26267 |
|---|---|---|---|
| Mute | toggle mic (also a Stream Deck+ dial, see below) | mic is live | ✅ verified |
| Camera | toggle camera | camera is on | ✅ verified |
| Leave | leave the meeting | (red during a meeting) | button verified |
| Chat | open / close meeting chat | unread messages* | button verified |
| Share | open the share tray; while presenting, stop sharing* | sharing | "Stop sharing" label verified |
| React | send the chosen reaction (Like, Love, Applause, Laugh, Wow) via the React menu | — | menu item ids verified |
| Raise hand | raise / lower via the React menu | hand is up† | menu item id and styling verified |

\* Unverified: the unread-messages label, and that pressing Stop sharing stops it.
† Teams says whether your hand is up only in a hover tooltip, but it restyles the React button
while it is. The plugin compares React with the plain toolbar buttons (People, More, Chat), so it
doesn't depend on Teams' generated class names.

### Stream Deck+ dial

Put **Mute** on a dial and its strip shows a large **Live** or **Muted**, with what holding will do.

- **Tap** the dial: toggle mute.
- **Hold** the dial: flip the mic only while held. Muted, it's push-to-talk; live, it's a cough button.
- **Turn right** to unmute, **left** to mute. Turning toward the state you're already in does nothing.
- **Touch** the strip: toggle mute.

## Setup

Requires a Mac, Stream Deck 7.1+, new Teams, Node.js, and Apple's command-line tools
(`xcode-select --install`) to compile the Accessibility helper.

1. **Install.** Without npm (e.g. behind a corporate npm mirror), use the prebuilt package:
   `open dist/ai.michaelp.teams.streamDeckPlugin`. Or build it yourself:
   ```bash
   npm install
   npm run pack        # builds ai.michaelp.teams.streamDeckPlugin — double-click to install
   ```
   Or, for development, `npm run build && npm run link` (needs the Elgato CLI: `npm i -g @elgato/cli`).
2. **Allow Accessibility:** press any Teams key. macOS asks to let **Stream Deck** control your
   computer; turn it on in System Settings → Privacy & Security → Accessibility. Until then,
   keys stay dimmed and the dial says *Allow / Accessibility*.
3. Join a meeting.

## How it works

```
Stream Deck ──▶ plugin (Node, src/)  ──stdin/stdout JSON──▶  teams-bridge (Swift, bridge/)  ──Accessibility──▶ Teams
                 knows what buttons mean                        finds buttons by web id,
                 (src/teams/selectors.ts)                       reads labels, presses them
```

- **Finding the controls:** Teams exposes its accessibility tree only to assistive tech, so the
  helper sets the same switch VoiceOver does (`AXEnhancedUserInterface`) while it runs, and turns
  it off when it quits.
- **Keeping up with state:** it finds the toolbar buttons once, then re-reads just those every
  half second (about 0 ms). A full rescan (50–450 ms) only happens when the toolbar changes.
- **When Teams changes its interface:** button ids and label rules all live in
  `src/teams/selectors.ts`. The probe (`probe/teams-ax-probe.swift`) shows what the current Teams
  exposes.

## Development

```bash
npm test            # unit tests: selectors, bridge process handling, key/dial visuals, dial gestures
npm run typecheck
npm run build       # compiles bin/teams-bridge (Swift) and bundles bin/plugin.js
npm run smoke       # end-to-end: the built plugin against a fake Stream Deck + scripted bridge
npm run smoke:package  # the packed dist/ plugin, unzipped, starts its real helper
npm run watch       # rebuild + restart the plugin in Stream Deck on save
npm run icons       # regenerate glyphs.ts and every PNG after design changes
npm run sheet -- out.png   # render all keys in all states to one image
```

CI (`.github/workflows/build.yml`) typechecks, tests, packs and smoke-tests on a Mac on every push
to `main`, and keeps the package as a run artifact. That's how `dist/` is refreshed when npm is
blocked locally: `gh run download --name ai.michaelp.teams.streamDeckPlugin --dir dist`.

Probe Teams directly (terminal needs Accessibility permission; run during a meeting):

```bash
swift probe/teams-ax-probe.swift              # list the meeting toolbar's buttons
swift probe/teams-ax-probe.swift --watch      # live mute/camera labels; Ctrl-C to stop
swift probe/teams-ax-probe.swift --press-test # press mute twice (mic blips on, then back)
swift probe/teams-ax-probe.swift --menus      # list what the React / More / video-options menus offer
swift probe/teams-ax-diff.swift --only reaction-menu-button,share-button
                                              # print what changes as you raise a hand, share, …
```

```
bridge/TeamsBridge.swift   Accessibility helper: watch ids, press, open-menu-and-press
src/teams/selectors.ts     Teams knowledge: button ids, what labels mean, action → command
src/teams/bridge.ts        runs the helper: status → snapshot, requests, restarts
src/teams/protocol.ts      the meeting model keys render from
src/render/key.ts          meeting state → key visual (pure), and the SVG key design
src/actions/               one class per key; shared behaviour in teams-key.ts, dial gestures in gestures.ts
src/plugin.ts              wiring: start the helper, register keys, redraw on change
```

## Notes

- **Privacy:** the helper only reads buttons, toggles and menu items, never messages, chat rows
  or window titles. Menu items are matched only if they appeared after the plugin opened the
  menu, so a chat message's "Like" can never be pressed.
- **Limits:** it can only use what Teams shows on screen, so it can't join meetings, set presence
  or read your calendar. A Teams interface update can break a button until `selectors.ts` is updated.
- Glyphs from [Lucide](https://lucide.dev) (ISC); `wow` is custom on the same grid.

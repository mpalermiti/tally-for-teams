# Developing Tally for Teams

## How it works

```
Stream Deck ──▶ plugin (Node, src/)  ──stdin/stdout JSON──▶  teams-bridge (Swift, bridge/)  ──Accessibility──▶ Teams
                 knows what buttons mean                        finds buttons by web id, reads
                 (src/teams/selectors.ts)                       labels and styles, presses them
```

- **Finding the controls:** Teams exposes its accessibility tree only to assistive tech, so the helper sets the same switch VoiceOver does (`AXEnhancedUserInterface`) while it runs, and turns it off when it quits.
- **One window at a time:** a meeting can have a full window and a compact view that swap in and out. The helper takes every button from the one window holding the mic button and the most of the others, so the two toolbars are never mixed.
- **Menus stay in the meeting window:** Hand, reactions and Background blur use Teams' menus, which close only in the meeting window. If Teams' main window has focus, those keys alert until you click the meeting window once; Mute, Camera, Leave and the rest still work.
- **Keeping up with state:** it finds the toolbar buttons and the `#indicators` container once, then re-reads just those every half second (about 0 ms for buttons; the indicator subtree is capped). A full rescan (50–450 ms) happens within 2 s of watched toolbar buttons going stale. If a previously found indicator container goes dead, Tally tries one fast rediscovery; if that does not find it, it falls back to the normal 10 s meeting cadence.
- **State Teams only shows as styling:** a raised hand keeps React's label; only its look changes. The plugin compares React with the plain toolbar buttons instead of matching Teams' generated class names, which change between builds.
- **When Teams changes its interface:** button ids and label rules all live in `src/teams/selectors.ts`. The probes show what the current Teams exposes: `teams-ax-probe.swift` lists the toolbar, and `teams-ax-diff.swift` prints what changes as you do something.

## Development

Building requires Node.js and Apple's command-line tools (`xcode-select --install`) to compile the Accessibility helper.

Build from source:

```bash
npm install
npm run pack                    # builds dist/ai.michaelp.tally.streamDeckPlugin; double-click to install
npm run build && npm run link    # development install; needs the Elgato CLI: npm i -g @elgato/cli
```

Useful scripts:

```bash
npm test                # unit tests: selectors, bridge process handling, key/dial visuals, dial gestures
npm run typecheck
npm run build           # compiles bin/teams-bridge (Swift) and bundles bin/plugin.js
npm run smoke           # end-to-end: the built plugin against a fake Stream Deck + scripted bridge
npm run smoke:package   # package smoke: unzips the packed plugin and starts its real helper
npm run watch           # rebuild + restart the plugin in Stream Deck on save
npm run icons           # regenerate glyphs.ts plus action-list/key SVGs
npm run profiles        # regenerate bundled Stream Deck profiles and manifest Profiles entries
npm run sheet -- out.png   # render all keys in all states to one image
```

`npm run art` regenerates the SVG art and icons in `docs/art/` from the key renderer: the key strip,
compact key strip, demo, favicon and touch icon. It renders the favicon PNGs with Google Chrome at its
default macOS path, or set `CHROME=/path/to/chrome`. Without Chrome, it still regenerates the SVGs and
skips PNGs that are already current.

`npm run art:3d` renders the device shots (`hero-device.jpg`, `social.png`, and
`keys-floating.jpg`) on a Mac with Chrome and the Metal GPU. It downloads three.js r186 from jsDelivr,
checks the files against pinned sha256 hashes, and caches them in `~/Library/Caches/tally-art`.
Re-run it whenever key art changes; `test/render3d.test.ts` fails until the committed renders and
`.source` files are current.

`docs/keys.png` (`npm run sheet -- docs/keys.png`) shows every key in every state. After key-design
changes, run `npm run icons`, `npm run art`, and `npm run art:3d`. The site is plain HTML/CSS in
`site/`; `.github/workflows/pages.yml` publishes it with `docs/art/` once the repo is public.

### Publishing the site

The site deploys from `.github/workflows/pages.yml` once the repo is public. Do this one time:

1. Make the repo public.
2. In Settings → Pages, set Source to GitHub Actions.
3. In Actions → Pages, run the workflow. Making a repo public does not trigger it.
4. After the social card changes, in Settings → General → Social preview, upload `docs/art/social.png`. The repo page does not use the site's link-preview tags.
5. Set the repo's Website to `https://mpalermiti.github.io/tally-for-teams/`.

After that, pushes to `main` that touch `site/` or `docs/art/` redeploy.

CI (`.github/workflows/build.yml`) builds, tests, and packs on pushes to `main`, pull requests, and version tags; Markdown-only changes are skipped. Pushing a tag `vX.Y.Z` matching `package.json` and `manifest.json`, checked by `npm run version:check`, publishes a GitHub Release with `Tally.streamDeckPlugin` attached.

### Probing Teams

Probe Teams directly (terminal needs Accessibility permission; run during a meeting):

```bash
swift probe/teams-ax-probe.swift              # list the meeting toolbar's buttons
swift probe/teams-ax-probe.swift --watch      # live mute/camera labels; Ctrl-C to stop
swift probe/teams-ax-probe.swift --press-test # press mute twice (mic blips on, then back)
swift probe/teams-ax-probe.swift --menus      # list what the React / More / video-options menus offer
swift probe/teams-ax-diff.swift --only reaction-menu-button,share-button
                                              # print what changes as you raise a hand, share, …
```

### Code map

```
bridge/TeamsBridge.swift   Accessibility helper: watch ids, press, open-menu-and-press
src/teams/selectors.ts     Teams knowledge: button ids, what labels mean, action → command
src/teams/bridge.ts        runs the helper: status → snapshot, requests, restarts
src/teams/protocol.ts      the meeting model keys render from
src/render/key.ts          meeting state → key visual (pure), and the SVG key design
src/actions/               one class per key; shared behaviour in teams-key.ts, dial gestures in gestures.ts
src/plugin.ts              wiring: start the helper, register keys, redraw on change
```

### Fixing Tally when Teams changes

Selector overrides live at `~/Library/Application Support/Tally for Teams/selectors.json`. The file
is deep-merged over Tally's built-in Teams selectors at plugin start, so it survives plugin updates
and can override only the changed pieces. Example:

```json
{
  "buttonIds": {
    "mute": "new-microphone-button"
  },
  "labelPatterns": {
    "mute": {
      "muted": "^unmute|^restore microphone"
    }
  }
}
```

Label patterns are regex source strings compiled case-insensitively; invalid JSON or regex fields are
reported in the plugin log and fall back to defaults. Recording detection reads only descendants of
the configured indicator containers (default `#indicators`) and matches `recording.labels` as a
case-insensitive regex. `recording.ids` are only a fallback: an id match still needs a non-negative
label, so labels such as "Recording stopped" or "Off" never light the recording badge. The meeting timer
reads the `call-duration-custom` indicator label and parses the first `MM:SS` or `H:MM:SS` duration.
The People key presses `buttonIds.people` (default `roster-button`). Background blur presses the
`buttonIds.blur` menu host (default `video-button-configure`) and sends both configured `blur.on`
and `blur.off` targets to the bridge. The bridge chooses while the Teams menu is open: if the blur
item is selected it presses `blur.off`; if `blur.off` is still missing after one more poll tick, the
request fails instead of pressing blur again. Only the matched `blur.on` and `blur.off` items decide
whether selected state is readable; unrelated menu controls and readable-but-unselected matched
items fall back to meeting-scoped memory. The built-in on-label defaults prefer `standard blur`
before the broader `blur`; off defaults are `no background effect` / `none`. Fallback memory resets
when the meeting or Teams/helper process ends, not on a transient toolbar miss. The key stays neutral
unless a reliable status-time blur state is added. When Teams still looks like a meeting but the
mic anchor is missing, Tally reports "Teams changed", keys show a small `?`, and the Stream Deck+
dial says "Teams changed" / "See README". The plugin log lists the control ids it saw in that Teams
window, capped for readability. It never logs labels or window titles.

For Teams in another language, Mute, Camera, Raise hand, React, Share, Chat, People, and Leave can
still press controls by id. Mute tap toggles, and holding Mute still ends where it started. Lit
state, Background blur, and the Stream Deck + dial need English Teams or a
[`selectors.json` override](#fixing-tally-when-teams-changes). Prefer narrow positive patterns and
explicit negative patterns for anything that can read as stopped/off, especially recording and blur.

### Bundled profiles

`npm run profiles` builds the one-click setup profiles from `scripts/profiles.ts` into
`ai.michaelp.tally.sdPlugin/profiles/` and rewrites the manifest `Profiles` entries. The generated
files are Stream Deck profile format 3.0 ZIPs: each `.streamDeckProfile` contains one
`<UUID>.sdProfile/manifest.json` plus page manifests under `Profiles/<PAGE-ID>/manifest.json`.
The root manifest keeps the Stream Deck-exported shape (`Version`, `Device.Model`, `Device.UUID`,
`Pages`), with a separate empty default page and a current page that holds Tally actions. Each action
entry includes the plugin UUID/name/version, and each page has a `Keypad` controller; Stream Deck +
pages also include an `Encoder` controller. `profiles/summary.json` and the profile ZIP bytes are
generated from the same source so tests can verify the layout without unpacking the committed ZIPs.

The shipped profiles are:

- `profiles/Tally (Stream Deck)` — DeviceType `0`, 5×3 MK.2/standard Stream Deck layout.
- `profiles/Tally (Stream Deck +)` — DeviceType `7`, 4×2 keys plus four dials, with Mute on dial 1.

Stream Deck installs a bundled profile once and does not update an already-installed copy when the
plugin later ships a different ZIP at the same manifest path. A layout change after release needs a
new profile name/path (for example a visible revision suffix); otherwise existing users silently keep
the old layout. Do not bump names casually: Stream Deck cannot remove old bundled profiles for users.

Auto-switch is opt-in through the global `autoSwitchProfile` setting in every action's property
inspector. When enabled, the plugin switches connected DeviceType 0 and 7 devices to the matching
bundled profile immediately on a no-meeting → in-meeting transition. It switches back only after
Stream Deck has reported a readable no-meeting state for about eight seconds; offline, helper restart,
and "Teams changed" states are treated as unknown and never start that timer. On meeting end it calls
`switchToProfile(deviceId)` without a profile name only for devices it moved that still have the
bundled Mute and Leave keys visible at their bundled positions. Users who move either key will not be
switched back automatically, which avoids pulling them away from a profile they selected manually. If
the setting is off, Tally never sends `switchToProfile`.

### Releasing

Releases go to [GitHub Releases](https://github.com/mpalermiti/tally-for-teams/releases), not npm (the package is private). Pushing a version tag makes CI build the plugin and attach `Tally.streamDeckPlugin`. `npm version` below only edits the version number.

1. `npm version X.Y.Z --no-git-tag-version` (updates `package.json` and `package-lock.json`), set `Version` to `X.Y.Z.0` in `ai.michaelp.tally.sdPlugin/manifest.json`, then run `npm run profiles`.
2. `npm run version:check`.
3. Commit the bump.
4. `git tag vX.Y.Z`.
5. `git push && git push origin vX.Y.Z`.

Pre-release tags like `v1.1.0-rc.1` publish pre-releases; for those, the npm version is `X.Y.Z-rc.N` and the manifest stays `X.Y.Z.0`.

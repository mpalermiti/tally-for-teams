# Developing Tally for Teams

## How it works

```
Stream Deck ──▶ plugin (Node, src/)  ──stdin/stdout JSON──▶  teams-bridge (Swift, bridge/)  ──Accessibility──▶ Teams
                 knows what buttons mean                        finds buttons by web id, reads
                 (src/teams/selectors.ts)                       labels and styles, presses them
```

- **Finding the controls:** Teams exposes its accessibility tree only to assistive tech, so the helper sets the same switch VoiceOver does (`AXEnhancedUserInterface`) while it runs, and turns it off when it quits.
- **One window at a time:** a meeting can have a full window and a compact view that swap in and out. The helper takes every button from the one window holding the mic button and the most of the others, so the two toolbars are never mixed.
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
npm run sheet -- out.png   # render all keys in all states to one image
```

`npm run art` regenerates the README and site art in `docs/art/` from the key renderer. It renders
the PNGs (the social image and favicons) with Google Chrome at its default macOS path, or set
`CHROME=/path/to/chrome`. Without Chrome, it still regenerates the SVGs and skips PNGs that are
already current. A test fails if anything is stale. `docs/keys.png` (`npm run sheet -- docs/keys.png`)
shows every key in every state. After key-design changes, run both `npm run icons` and `npm run art`.
The site is plain HTML/CSS in `site/`; `.github/workflows/pages.yml` publishes it with `docs/art/`
once the repo is public.

### Publishing the site

The site deploys from `.github/workflows/pages.yml` once the repo is public. Do this one time:

1. Make the repo public.
2. In Settings → Pages, set Source to GitHub Actions.
3. In Actions → Pages, run the workflow. Making a repo public does not trigger it.
4. In Settings → General → Social preview, upload `docs/art/social.png`. The repo page does not use the site's link-preview tags.
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
`buttonIds.blur` menu host (default `video-button-configure`) and then a configured `blur.on` or
`blur.off` menu item. The built-in item-label defaults use `blur` for on and `no background effect`
/ `none` for off; the item names match Bad Duck's Teams Control selectors for Teams' video options
menu. Because Teams does not expose a verified status-time blur state on Mac, Tally uses the last
confirmed blur press only to choose the next menu item and keeps the key neutral unless a reliable
state signal is added. When Teams still looks like a meeting but the
mic anchor is missing, Tally reports "Teams changed" and the plugin log lists the control ids it saw
in that Teams window, capped for readability. It never logs labels or window titles.

### Releasing

Releases go to [GitHub Releases](https://github.com/mpalermiti/tally-for-teams/releases), not npm (the package is private). Pushing a version tag makes CI build the plugin and attach `Tally.streamDeckPlugin`. `npm version` below only edits the version number.

1. `npm version X.Y.Z --no-git-tag-version` (updates `package.json` and `package-lock.json`), and set `Version` to `X.Y.Z.0` in `ai.michaelp.tally.sdPlugin/manifest.json`.
2. `npm run version:check`.
3. Commit the bump.
4. `git tag vX.Y.Z`.
5. `git push && git push origin vX.Y.Z`.

Pre-release tags like `v1.1.0-rc.1` publish pre-releases; for those, the npm version is `X.Y.Z-rc.N` and the manifest stays `X.Y.Z.0`.

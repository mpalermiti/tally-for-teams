# Tally for Teams

Live Microsoft Teams controls for Stream Deck on Mac.

<p align="center"><img src="docs/art/hero.svg" width="760" alt="A Stream Deck with Tally keys mid-meeting: mic and camera lit, Leave in red"></p>

<p align="center"><b><a href="https://github.com/mpalermiti/tally-for-teams/releases/latest/download/Tally.streamDeckPlugin">Download Tally</a></b> · macOS 13+ · Stream Deck 7.1+ · the new Teams desktop app, in English</p>

**See it at a glance.** Keys light while your mic is live, your camera's on, your hand is up, or you're sharing, even when you change it in Teams itself.

**Stays out of your way.** Works with Teams in the background and never pulls it to the front.

**No accidental hang-ups.** Leave can require a hold.

**Private by design.** Runs entirely on your Mac. No account, no cloud. It reads only Teams' meeting buttons.

<p align="center"><img src="docs/art/demo.svg" width="760" alt="Pressing Mute on the Stream Deck lights the key and unmutes Teams; raising your hand in Teams lights the hand key; pressing Share lights the Share key"></p>

**Why "Tally"?** On a TV set, the tally light is the small red lamp on a camera that tells everyone it's live. Tally puts that light on your Stream Deck: a lit key means that thing is live — your mic, your camera, your raised hand, your shared screen.

## The keys

| Key | Press | Lit when |
|---|---|---|
| Mute | toggle your mic | your mic is live |
| Camera | toggle your camera | your camera is on |
| Raise hand | raise or lower your hand | your hand is up |
| Share | open the share tray; while presenting, stop sharing | you're sharing |
| Chat | open or close meeting chat | — |
| React | send Like, Love, Applause, Laugh or Wow (pick in its settings) | — |
| Leave | leave the meeting; optionally only when held | red during a meeting |

Keys dim when there's nothing to do: no meeting, or that control isn't available right now.

On a **Stream Deck+**, put Mute on a dial: tap to toggle, hold to talk, turn right to unmute and left to mute.

## Set up

1. [Download Tally](https://github.com/mpalermiti/tally-for-teams/releases/latest/download/Tally.streamDeckPlugin) and double-click it.
2. Drag the keys you want from **Tally for Teams** onto your Stream Deck. For Leave, consider turning on *Hold to leave* in its settings. (In a Multi Action, Leave still acts at once.)
3. Press any Tally key. macOS asks to let **Stream Deck** control your computer: turn it on in System Settings → Privacy & Security → Accessibility. (Teams no longer offers a control API, so Tally works the way a screen reader does.) Until it's on, keys stay dark and a Stream Deck+ dial says *Allow / Accessibility*.

**Updating:** download the latest release and double-click it; your keys stay put. To hear about new versions, watch this repo → Custom → Releases.

**If a key stops working:** Teams probably changed its interface. [Open an issue](https://github.com/mpalermiti/tally-for-teams/issues/new/choose).

## Notes

- **Privacy:** the helper reads meeting buttons (their labels, styling, and whether they're enabled) and items of menus it opens, never messages, chat, or window titles. It logs menu controls by id only. Menu items are matched only if they appeared after the plugin opened the menu, so a chat message's "Like" can never be pressed.
- **Limits:** it can only use what Teams shows on screen, so it can't join meetings, set presence, or read your calendar. A Teams interface update can break a button until `selectors.ts` is updated. Key states follow Teams' English labels, so other languages aren't supported yet.
- **Glyphs:** from [Lucide](https://lucide.dev) (ISC; parts MIT); `wow` is custom on the same grid. License in [`ai.michaelp.tally.sdPlugin/lucide.LICENSE.txt`](ai.michaelp.tally.sdPlugin/lucide.LICENSE.txt).
- **Settings pages:** use [sdpi-components](https://sdpi-components.dev) (MIT), which bundles [Lit](https://lit.dev) (BSD-3-Clause); both are shipped with the plugin, with their licenses in [`ai.michaelp.tally.sdPlugin/ui/sdpi-components.LICENSE.txt`](ai.michaelp.tally.sdPlugin/ui/sdpi-components.LICENSE.txt).
- **Bundled code:** licenses for the npm packages bundled into the plugin are in [`ai.michaelp.tally.sdPlugin/third-party-licenses.txt`](ai.michaelp.tally.sdPlugin/third-party-licenses.txt).
- Not affiliated with or endorsed by Microsoft or Elgato. Microsoft Teams is a trademark of Microsoft Corporation.

Building from source and how it works: [DEVELOPMENT.md](DEVELOPMENT.md). License: MIT ([LICENSE](LICENSE)).

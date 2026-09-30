#!/bin/sh
# Builds bin/teams-bridge for Apple Silicon, macOS 13+ (the manifest's minimum), so a plugin
# packed on one Mac runs on another regardless of its macOS version. (An Intel slice linked
# with missing Swift compatibility libraries on the build Mac, so it's left out until tested.)
set -eu
mkdir -p ai.michaelp.tally.sdPlugin/bin
swiftc -O -target arm64-apple-macos13 bridge/TeamsBridge.swift -o ai.michaelp.tally.sdPlugin/bin/teams-bridge

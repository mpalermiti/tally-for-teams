#!/bin/sh
# Builds bin/teams-bridge as one file for Apple Silicon and Intel Macs, macOS 13+ (the
# manifest's minimum), so a plugin packed on one Mac runs on any other. Fails if either
# architecture is missing, rather than shipping a helper that some Macs can't run.
set -eu
out=ai.michaelp.tally.sdPlugin/bin
mkdir -p "$out" build
for arch in arm64 x86_64; do
	swiftc -O -target "$arch-apple-macos13" bridge/TeamsBridge.swift -o "build/teams-bridge-$arch"
done
lipo -create build/teams-bridge-arm64 build/teams-bridge-x86_64 -output "$out/teams-bridge"
lipo "$out/teams-bridge" -verify_arch arm64
lipo "$out/teams-bridge" -verify_arch x86_64

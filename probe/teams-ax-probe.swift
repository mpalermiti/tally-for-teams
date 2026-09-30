// Teams Accessibility probe
//
// Answers one question: can a Stream Deck plugin see and press Teams' meeting
// controls through macOS Accessibility (the system VoiceOver uses), now that
// Teams' local API is gone?
//
// Run it on a Mac with Teams, DURING a meeting:
//
//   swift probe/teams-ax-probe.swift                read-only scan (default)
//   swift probe/teams-ax-probe.swift --watch        print mic/camera/hand state as it changes; Ctrl-C to stop
//   swift probe/teams-ax-probe.swift --press-test   press Mute twice (toggles your mic, then restores it)
//   swift probe/teams-ax-probe.swift --full         also save every button in Teams (labels may include names)
//
// First run: macOS asks for Accessibility permission for your terminal app.
// Grant it in System Settings → Privacy & Security → Accessibility, then run again.
//
// Teams (WebView2) hides its accessibility tree until asked. The probe flips the same
// switch VoiceOver uses (AXEnhancedUserInterface) and turns it back off when it exits.
//
// Privacy: only buttons, toggles and similar controls are ever read — never messages,
// chat rows, text or window titles. By default only the meeting toolbar (the controls
// around the mic button) is printed and saved.

import AppKit
import ApplicationServices

// MARK: - Arguments

var arguments = Array(CommandLine.arguments.dropFirst())
func flag(_ name: String) -> Bool {
	guard let i = arguments.firstIndex(of: name) else { return false }
	arguments.remove(at: i)
	return true
}
func option(_ name: String) -> String? {
	guard let i = arguments.firstIndex(of: name), i + 1 < arguments.count else { return nil }
	let value = arguments[i + 1]
	arguments.removeSubrange(i...(i + 1))
	return value
}

if flag("--help") || flag("-h") {
	print("usage: swift teams-ax-probe.swift [--watch | --press-test] [--full] [--app <bundle id>]")
	exit(0)
}
let watchMode = flag("--watch")
let pressTest = flag("--press-test")
let fullDump = flag("--full")
let bundleIDs = option("--app").map { [$0] } ?? ["com.microsoft.teams2", "com.microsoft.teams"]

// MARK: - What we're looking for

/// Web ids Teams gives its meeting buttons, confirmed on Teams 26267 for Mac. Matched exactly.
let knownIDs: [String: String] = [
	"microphone-button": "mute",
	"video-button": "camera",
	"hangup-button": "leave",
	"reaction-menu-button": "react",
]

/// For toolbar controls without a known id: words in the label or id.
let capabilities: [(name: String, keywords: [String])] = [
	("mute", ["mute", "unmute", "microphone"]),
	("camera", ["camera"]),
	("hand", ["raise", "hand"]),
	("leave", ["leave", "hang up", "hangup"]),
	("react", ["react"]),
	("chat", ["chat"]),
	("share", ["share", "present"]),
	("blur", ["blur", "background", "effects"]),
	("more", ["more"]),
	("recording", ["record", "transcri"]),
]

/// Only real controls. Chat messages and list rows are also "pressable" in Teams, so
/// pressability alone would sweep in message text and names.
let controlRoles: Set<String> = [
	"AXButton", "AXCheckBox", "AXRadioButton", "AXMenuButton", "AXPopUpButton", "AXToggle", "AXSwitch",
]

// MARK: - Accessibility helpers

func value(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
	var result: AnyObject?
	guard AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success else { return nil }
	return result
}
func string(_ element: AXUIElement, _ attribute: String) -> String? {
	(value(element, attribute) as? String).flatMap { $0.isEmpty ? nil : $0 }
}
func actions(_ element: AXUIElement) -> [String] {
	var names: CFArray?
	guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
	return (names as? [String]) ?? []
}
func children(_ element: AXUIElement) -> [AXUIElement] {
	(value(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}
func parent(_ element: AXUIElement) -> AXUIElement? {
	guard let p = value(element, kAXParentAttribute) else { return nil }
	return (p as! AXUIElement)
}
func truncate(_ s: String?, _ n: Int = 60) -> String? {
	guard let s else { return nil }
	return s.count > n ? String(s.prefix(n)) + "…" : s
}
func milliseconds(since start: Date) -> Int { Int(Date().timeIntervalSince(start) * 1000) }

struct Control: Codable {
	var capability: String?
	var role: String
	var subrole: String?
	var label: String?
	var domIdentifier: String?
	var value: String?
	var enabled: Bool?
	var actions: [String]
}

func describe(_ element: AXUIElement) -> Control {
	let role = string(element, kAXRoleAttribute) ?? "?"
	let label = string(element, kAXTitleAttribute) ?? string(element, kAXDescriptionAttribute) ?? string(element, kAXHelpAttribute)
	var control = Control(
		capability: nil,
		role: role,
		subrole: string(element, kAXSubroleAttribute),
		label: truncate(label),
		domIdentifier: string(element, "AXDOMIdentifier") ?? string(element, kAXIdentifierAttribute),
		value: (value(element, kAXValueAttribute) as? NSNumber)?.stringValue,
		enabled: (value(element, kAXEnabledAttribute) as? NSNumber)?.boolValue,
		actions: actions(element)
	)
	control.capability = classify(control)
	return control
}

func classify(_ c: Control) -> String? {
	if let id = c.domIdentifier, let known = knownIDs[id] { return known }
	let haystack = "\(c.label ?? "") \(c.domIdentifier ?? "")".lowercased()
	return capabilities.first { cap in cap.keywords.contains { haystack.contains($0) } }?.name
}

func show(_ c: Control) -> String {
	var parts = [(c.domIdentifier ?? "(no id)").padding(toLength: 26, withPad: " ", startingAt: 0)]
	parts.append("\(c.role)\(c.subrole.map { "/\($0)" } ?? "") \"\(c.label ?? "(no label)")\"")
	if let v = c.value { parts.append("value=\(v)") }
	if c.enabled == false { parts.append("disabled") }
	if !c.actions.contains(kAXPressAction as String) { parts.append("NOT pressable") }
	return parts.joined(separator: " ")
}

struct Scan {
	var controls: [(Control, AXUIElement)] = []
	var nodes = 0
	var windows = 0
	var milliseconds = 0
	var truncated = false
}

/// Walks a subtree collecting controls. Bounded so a huge tree can't hang the probe.
func collect(_ roots: [AXUIElement], maxNodes: Int = 40_000, maxDepth: Int = 90) -> Scan {
	var result = Scan()
	let start = Date()
	var stack = roots.map { ($0, 0) }
	while let (element, depth) = stack.popLast() {
		result.nodes += 1
		if result.nodes > maxNodes { result.truncated = true; break }
		if let role = string(element, kAXRoleAttribute), controlRoles.contains(role) {
			result.controls.append((describe(element), element))
		}
		if depth < maxDepth { for child in children(element).reversed() { stack.append((child, depth + 1)) } }
	}
	result.milliseconds = milliseconds(since: start)
	return result
}

func scanApp(_ app: AXUIElement) -> Scan {
	let windows = (value(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
	var result = collect(windows)
	result.windows = windows.count
	return result
}

/// The meeting toolbar: the nearest ancestor of the mic button holding at least five controls.
func toolbar(around mic: AXUIElement) -> [(Control, AXUIElement)] {
	var node = mic
	for _ in 0..<8 {
		guard let up = parent(node) else { break }
		node = up
		let found = collect([node], maxNodes: 3_000, maxDepth: 10).controls
		if found.count >= 5 { return found }
	}
	return []
}

func find(_ capability: String, in controls: [(Control, AXUIElement)]) -> (Control, AXUIElement)? {
	controls.first { $0.0.capability == capability && $0.0.domIdentifier.flatMap { knownIDs[$0] } == capability }
		?? controls.first { $0.0.capability == capability && $0.0.actions.contains(kAXPressAction as String) }
}

// MARK: - 1. Permission

print("Teams Accessibility probe\n")
let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
guard AXIsProcessTrustedWithOptions(prompt) else {
	print("✗ Accessibility permission is missing for this terminal app.")
	print("  System Settings → Privacy & Security → Accessibility → turn on your terminal (Terminal, iTerm, Ghostty…),")
	print("  then quit and reopen the terminal and run this again.")
	exit(2)
}
print("✓ Accessibility permission granted")

// MARK: - 2. Find Teams

guard let app = NSWorkspace.shared.runningApplications.first(where: { bundleIDs.contains($0.bundleIdentifier ?? "") }) else {
	print("✗ Teams isn't running (looked for \(bundleIDs.joined(separator: ", "))).")
	exit(3)
}
let version = app.bundleURL.flatMap { Bundle(url: $0)?.infoDictionary?["CFBundleShortVersionString"] as? String } ?? "?"
print("✓ Found \(app.localizedName ?? "Teams") \(version) (\(app.bundleIdentifier ?? "?"), pid \(app.processIdentifier))")

let axApp = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(axApp, 2.0)

func teamsIsFrontmost() -> Bool { NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier }
func frontmostName() -> String { NSWorkspace.shared.frontmostApplication?.localizedName ?? "?" }

// MARK: - 3. Turn Teams' accessibility tree on

// WebView2 builds its tree only for assistive tech. VoiceOver's switch works (the call reports
// an error, but the tree appears); Electron's AXManualAccessibility does not, so we don't try it.
let enhancedBefore = (value(axApp, "AXEnhancedUserInterface") as? NSNumber)?.boolValue ?? false
AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
func restoreEnhanced() {
	if !enhancedBefore { AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanFalse) }
}

/// Scans until the mic button appears or the tree stops growing (it builds asynchronously).
func settledScan(timeout: TimeInterval = 8) -> Scan {
	let deadline = Date().addingTimeInterval(timeout)
	var current = scanApp(axApp)
	while Date() < deadline && find("mute", in: current.controls) == nil {
		Thread.sleep(forTimeInterval: 0.75)
		let next = scanApp(axApp)
		if next.nodes <= current.nodes && current.nodes > 200 { return next }
		current = next
	}
	return current
}

let first = settledScan()
print("  \(first.windows) window(s), \(first.nodes) nodes, \(first.controls.count) controls — full scan \(first.milliseconds) ms" +
	(first.truncated ? " (hit node limit)" : ""))
print("  Teams is \(teamsIsFrontmost() ? "FRONTMOST — for a real test, click another app while this runs" : "in the background (front: \(frontmostName())) ✓")")

// MARK: - 4. Meeting toolbar

guard let (_, micElement) = find("mute", in: first.controls) else {
	print("\n✗ No mic button (id microphone-button). Are you in a meeting with its window open?")
	restoreEnhanced()
	exit(1)
}
let start = Date()
var bar = toolbar(around: micElement)
let barMs = milliseconds(since: start)
// Known-id buttons that live outside the toolbar container (e.g. Leave) still count.
for (control, element) in first.controls where control.domIdentifier.flatMap({ knownIDs[$0] }) != nil {
	if !bar.contains(where: { $0.0.domIdentifier == control.domIdentifier }) { bar.append((control, element)) }
}

print("\nMeeting toolbar (\(bar.count) controls around the mic button, read in \(barMs) ms):")
for (control, _) in bar { print("  \(show(control))") }

print("\nCapabilities:")
var found: [String: Bool] = [:]
for cap in capabilities {
	let hit = find(cap.name, in: bar)
	found[cap.name] = hit != nil
	let status = hit.map { "✓ \($0.0.domIdentifier ?? "(no id)") \"\($0.0.label ?? "")\"" } ?? {
		switch cap.name {
		case "hand", "blur": return "✗ not in the toolbar (probably inside the React / More / video-options menu)"
		case "recording": return "✗ not shown (expected unless this meeting is being recorded)"
		default: return "✗ not in the toolbar (window too narrow? it may be under More)"
		}
	}()
	print("  \(cap.name.padding(toLength: 10, withPad: " ", startingAt: 0))\(status)")
}

// MARK: - 5. Save report

struct Report: Codable {
	var generated: String
	var teamsVersion: String
	var teamsFrontmost: Bool
	var nodes: Int
	var fullScanMilliseconds: Int
	var toolbarMilliseconds: Int
	var found: [String: Bool]
	var toolbar: [Control]
	var allControls: [Control]?
}
let stamp = ISO8601DateFormatter().string(from: Date())
let report = Report(
	generated: stamp,
	teamsVersion: version,
	teamsFrontmost: teamsIsFrontmost(),
	nodes: first.nodes,
	fullScanMilliseconds: first.milliseconds,
	toolbarMilliseconds: barMs,
	found: found,
	toolbar: bar.map(\.0),
	allControls: fullDump ? first.controls.map(\.0) : nil
)
let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
let file = downloads.appendingPathComponent("teams-ax-probe-\(stamp.replacingOccurrences(of: ":", with: "-")).json")
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
try encoder.encode(report).write(to: file)
print("\nSaved report: \(file.path)" + (fullDump ? "  (--full: includes every button in Teams — check before sharing)" : ""))

// MARK: - 6. Optional: press test

if pressTest {
	func read() -> String { describe(micElement).label ?? "?" }
	print("\nPress test: toggling your mic, then restoring it (about 3 s). Front app: \(frontmostName())")
	print("  before:        \(read())")
	let pressed = AXUIElementPerformAction(micElement, kAXPressAction as CFString)
	Thread.sleep(forTimeInterval: 1.5)
	print("  after press:   \(read())   (AXPress → \(pressed == .success ? "ok" : "AXError \(pressed.rawValue)"))")
	let restored = AXUIElementPerformAction(micElement, kAXPressAction as CFString)
	Thread.sleep(forTimeInterval: 1.5)
	print("  after restore: \(read())   (AXPress → \(restored == .success ? "ok" : "AXError \(restored.rawValue)"))")
	print("  Teams stayed \(teamsIsFrontmost() ? "frontmost" : "in the background") during the test.")
	print("  Pass = the label flips and flips back.")
}

// MARK: - 7. Optional: watch (the cheap way a plugin would poll)

if !watchMode { restoreEnhanced() }

if watchMode {
	signal(SIGINT, SIG_IGN)
	let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
	interrupt.setEventHandler { restoreEnhanced(); exit(0) }
	interrupt.resume()

	// Find the buttons once, then re-read only them: what the plugin would do every half second.
	var watched = ["mute", "camera", "hand"].compactMap { cap in find(cap, in: bar).map { (cap, $0.1) } }
	print("\nWatching \(watched.map(\.0).joined(separator: ", ")) every 0.5 s by re-reading just those buttons.")
	print("Change them in Teams (or with ⌘⇧M) — try it with another app in front, and with the meeting window minimized. Ctrl-C to stop.")
	var last = ""
	while true {
		let t = Date()
		var stale = false
		let line = watched.map { cap, element -> String in
			guard let label = string(element, kAXTitleAttribute) ?? string(element, kAXDescriptionAttribute) else {
				stale = true
				return "\(cap): —"
			}
			return "\(cap): \(label)"
		}.joined(separator: " | ")
		let readMs = milliseconds(since: t)
		if stale {
			// The button went away (meeting window rebuilt, meeting ended): find it again.
			let rescan = scanApp(axApp)
			if let mic = find("mute", in: rescan.controls) {
				let fresh = toolbar(around: mic.1)
				watched = ["mute", "camera", "hand"].compactMap { cap in find(cap, in: fresh).map { (cap, $0.1) } }
			}
			print("  buttons changed; rediscovered with a full scan in \(rescan.milliseconds) ms")
		}
		if line != last {
			let time = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
			print("  \(time)  \(line)   [read \(readMs) ms; front: \(frontmostName())]")
			last = line
		}
		Thread.sleep(forTimeInterval: 0.5)
	}
}

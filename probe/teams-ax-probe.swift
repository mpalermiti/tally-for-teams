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
//   swift probe/teams-ax-probe.swift --full         also save every button's label (may include people's names)
//
// If Teams hides its controls, the probe tries the switches screen readers use to turn
// Teams' accessibility on, and prints a roles-only skeleton of where the tree stops.
//
// First run: macOS asks for Accessibility permission for your terminal app.
// Grant it in System Settings → Privacy & Security → Accessibility, then run again.
//
// Privacy: by default the saved report holds only controls matching meeting-control
// keywords (mute, camera, share, …), never chat text, window titles or names.

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

/// Each capability the plugin needs, and words that tend to appear in the
/// matching control's label, tooltip or web id.
let capabilities: [(name: String, keywords: [String])] = [
	("mute", ["mute", "unmute", "microphone", "mic-"]),
	("camera", ["camera", "video"]),
	("hand", ["raise", "hand"]),
	("leave", ["leave", "hang up", "hangup", "end call"]),
	("react", ["react"]),
	("chat", ["chat"]),
	("share", ["share", "sharing", "present"]),
	("blur", ["blur", "background", "effects"]),
	("recording", ["recording", "transcri"]),
]

let interactiveRoles: Set<String> = [
	"AXButton", "AXCheckBox", "AXRadioButton", "AXMenuButton", "AXPopUpButton", "AXMenuItem", "AXToggle", "AXSwitch",
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
func truncate(_ s: String?, _ n: Int = 80) -> String? {
	guard let s else { return nil }
	return s.count > n ? String(s.prefix(n)) + "…" : s
}

struct Control: Codable {
	var capabilities: [String]
	var window: Int
	var depth: Int
	var role: String
	var subrole: String?
	var title: String?
	var description: String?
	var help: String?
	var identifier: String?
	var domIdentifier: String?
	var domClasses: [String]?
	var value: String?
	var enabled: Bool?
	var actions: [String]
}

struct Scan {
	var controls: [(Control, AXUIElement)] = []
	var nodes = 0
	var windows = 0
	var milliseconds = 0.0
	var roleCounts: [String: Int] = [:]
	var truncated = false
}

func describe(_ element: AXUIElement, role: String, window: Int, depth: Int) -> Control {
	let raw = value(element, kAXValueAttribute)
	let valueText: String? =
		(raw as? NSNumber).map { $0.stringValue } ?? (role == "AXStaticText" ? truncate(raw as? String, 60) : nil)
	return Control(
		capabilities: [],
		window: window,
		depth: depth,
		role: role,
		subrole: string(element, kAXSubroleAttribute),
		title: truncate(string(element, kAXTitleAttribute)),
		description: truncate(string(element, kAXDescriptionAttribute)),
		help: truncate(string(element, kAXHelpAttribute)),
		identifier: string(element, kAXIdentifierAttribute),
		domIdentifier: string(element, "AXDOMIdentifier"),
		domClasses: value(element, "AXDOMClassList") as? [String],
		value: valueText,
		enabled: (value(element, kAXEnabledAttribute) as? NSNumber)?.boolValue,
		actions: actions(element)
	)
}

func matches(_ c: Control) -> [String] {
	let haystack = [c.title, c.description, c.help, c.identifier, c.domIdentifier, c.value]
		.compactMap { $0 }
		.joined(separator: " ")
		.lowercased() + " " + (c.domClasses ?? []).joined(separator: " ").lowercased()
	return capabilities.filter { cap in cap.keywords.contains { haystack.contains($0) } }.map(\.name)
}

/// Walks every window's accessibility tree, keeping controls. Bounded so a huge tree can't hang the probe.
func scan(_ app: AXUIElement, maxNodes: Int = 40_000, maxDepth: Int = 90) -> Scan {
	var result = Scan()
	let start = Date()
	let windows = (value(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
	result.windows = windows.count

	var stack: [(AXUIElement, Int, Int)] = windows.enumerated().map { ($0.element, $0.offset + 1, 0) }
	while let (element, window, depth) = stack.popLast() {
		result.nodes += 1
		if result.nodes > maxNodes { result.truncated = true; break }
		let role = string(element, kAXRoleAttribute) ?? "?"
		result.roleCounts[role, default: 0] += 1

		let pressable = interactiveRoles.contains(role) || actions(element).contains(kAXPressAction as String)
		// Static text is kept only for the "recording" banner; never for chat or names.
		if pressable || role == "AXStaticText" {
			var control = describe(element, role: role, window: window, depth: depth)
			control.capabilities = matches(control)
			if role == "AXStaticText" { control.capabilities = control.capabilities.filter { $0 == "recording" } }
			if pressable || !control.capabilities.isEmpty { result.controls.append((control, element)) }
		}
		if depth < maxDepth {
			for child in children(element).reversed() { stack.append((child, window, depth + 1)) }
		}
	}
	result.milliseconds = Date().timeIntervalSince(start) * 1000
	return result
}

func label(_ c: Control) -> String {
	let text = c.title ?? c.description ?? c.help ?? c.value ?? "(no label)"
	var parts = ["\(c.role)\(c.subrole.map { "/\($0)" } ?? "") \"\(text)\""]
	if let id = c.domIdentifier ?? c.identifier { parts.append("id=\(id)") }
	if let v = c.value, c.role != "AXStaticText" { parts.append("value=\(v)") }
	if c.enabled == false { parts.append("disabled") }
	if !c.actions.isEmpty { parts.append("[\(c.actions.joined(separator: ","))]") }
	return parts.joined(separator: " ")
}

/// Best guess at the control for a capability: pressable, enabled, shallowest.
func best(_ capability: String, in scan: Scan) -> (Control, AXUIElement)? {
	scan.controls
		.filter { $0.0.capabilities.contains(capability) && $0.0.actions.contains(kAXPressAction as String) }
		.sorted { ($0.0.enabled == false ? 1 : 0, $0.0.depth) < ($1.0.enabled == false ? 1 : 0, $1.0.depth) }
		.first
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
	let similar = NSWorkspace.shared.runningApplications.compactMap(\.bundleIdentifier).filter { $0.lowercased().contains("teams") }
	if !similar.isEmpty { print("  Running apps with 'teams' in their ID: \(similar.joined(separator: ", ")) — pass one with --app") }
	exit(3)
}
let version = app.bundleURL.flatMap { Bundle(url: $0)?.infoDictionary?["CFBundleShortVersionString"] as? String } ?? "?"
print("✓ Found \(app.localizedName ?? "Teams") \(version) (\(app.bundleIdentifier ?? "?"), pid \(app.processIdentifier))")

let axApp = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(axApp, 2.0)
var diagnostics: [String] = []
func note(_ line: String) {
	print("  \(line)")
	diagnostics.append(line)
}

// What renders Teams' UI decides which "turn accessibility on" switch it listens to.
let frameworks = app.bundleURL
	.map { $0.appendingPathComponent("Contents/Frameworks") }
	.flatMap { try? FileManager.default.contentsOfDirectory(atPath: $0.path) } ?? []
let engines = frameworks.filter { name in
	["edge", "webview", "chromium", "electron", "cef", "webkit"].contains { name.lowercased().contains($0) }
}
note("UI engine frameworks: \(engines.isEmpty ? "none recognised (\(frameworks.count) frameworks)" : engines.joined(separator: ", "))")

/// Scans repeatedly until the node count stops growing: web views build their tree asynchronously.
func settledScan(timeout: TimeInterval = 6) -> Scan {
	var current = scan(axApp)
	let deadline = Date().addingTimeInterval(timeout)
	while Date() < deadline {
		Thread.sleep(forTimeInterval: 0.75)
		let next = scan(axApp)
		if next.nodes <= current.nodes && current.nodes > 200 { return next }
		current = next
	}
	return current
}

// Try the least invasive switch first:
//   AXManualAccessibility  — Electron's opt-in
//   AXEnhancedUserInterface — what VoiceOver sets; Chromium and WebKit views respond to it.
// Both are what screen readers do, and both reset when Teams quits (Enhanced is also reset at exit below).
var first = scan(axApp)
note("as found: \(first.nodes) nodes")
let enhancedBefore = (value(axApp, "AXEnhancedUserInterface") as? NSNumber)?.boolValue
var setEnhanced = false
for switchName in ["AXManualAccessibility", "AXEnhancedUserInterface"] {
	if first.controls.contains(where: { !$0.0.capabilities.isEmpty }) { break }
	let error = AXUIElementSetAttributeValue(axApp, switchName as CFString, kCFBooleanTrue)
	if switchName == "AXEnhancedUserInterface" && error == .success { setEnhanced = true }
	first = settledScan()
	note("after \(switchName) (set → \(error == .success ? "ok" : "AXError \(error.rawValue)")): \(first.nodes) nodes")
}
func restoreEnhanced() {
	if setEnhanced && enhancedBefore != true {
		AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanFalse)
	}
}

/// Roles and child counts only (no labels), to show where the tree stops.
func skeleton(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 7, into lines: inout [String]) {
	guard lines.count < 60 else { return }
	let kids = children(element)
	let role = string(element, kAXRoleAttribute) ?? "?"
	let sub = string(element, kAXSubroleAttribute).map { "/\($0)" } ?? ""
	lines.append(String(repeating: "  ", count: depth) + "\(role)\(sub)" + (kids.isEmpty ? "" : " (\(kids.count))"))
	if depth < maxDepth { for kid in kids { skeleton(kid, depth: depth + 1, maxDepth: maxDepth, into: &lines) } }
}
if !first.controls.contains(where: { !$0.0.capabilities.isEmpty }) {
	var lines: [String] = []
	for window in (value(axApp, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { skeleton(window, into: &lines) }
	print("\n  Tree skeleton (roles only):")
	for line in lines { print("    \(line)") }
	diagnostics.append(contentsOf: lines.map { "skeleton: \($0)" })
}

let frontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == app.bundleIdentifier
print("  \(first.windows) window(s), \(first.nodes) accessibility nodes scanned in \(Int(first.milliseconds)) ms" +
	(first.truncated ? " (stopped at the node limit)" : "") + (frontmost ? "" : " — Teams is in the background ✓"))
if app.isHidden { print("  Teams is hidden") }

print("\nMeeting controls:")
var found: [String: Bool] = [:]
for cap in capabilities {
	let hits = first.controls.filter { $0.0.capabilities.contains(cap.name) }
	found[cap.name] = !hits.isEmpty
	if let (control, _) = best(cap.name, in: first) ?? hits.first {
		print("  \(cap.name.padding(toLength: 10, withPad: " ", startingAt: 0))✓ \(label(control))")
		for (other, _) in hits.prefix(4) where other.depth != control.depth || other.title != control.title {
			print("  \(String(repeating: " ", count: 12))also: \(label(other))")
		}
	} else {
		print("  \(cap.name.padding(toLength: 10, withPad: " ", startingAt: 0))✗ not found")
	}
}

let core = ["mute", "camera", "leave"].filter { found[$0] == true }
print("\nVerdict: ", terminator: "")
if core.count == 3 {
	print("the core controls are visible to Accessibility. An Accessibility-based plugin looks feasible.")
} else if first.nodes < 50 {
	print("Teams exposed almost nothing (\(first.nodes) nodes). Are you in a meeting? If so, Teams may be hiding its tree; send this report back.")
} else {
	print("some controls are missing (\(["mute", "camera", "leave"].filter { found[$0] != true }.joined(separator: ", "))). Are you in a meeting, with its window open (not only the mini-window)?")
}

// MARK: - 4. Save report

struct Report: Codable {
	var generated: String
	var teamsVersion: String
	var bundleID: String
	var teamsFrontmost: Bool
	var windows: Int
	var nodes: Int
	var scanMilliseconds: Int
	var roleCounts: [String: Int]
	var found: [String: Bool]
	var diagnostics: [String]
	var controls: [Control]
}
let stamp = ISO8601DateFormatter().string(from: Date())
let report = Report(
	generated: stamp,
	teamsVersion: version,
	bundleID: app.bundleIdentifier ?? "?",
	teamsFrontmost: frontmost,
	windows: first.windows,
	nodes: first.nodes,
	scanMilliseconds: Int(first.milliseconds),
	roleCounts: first.roleCounts,
	found: found,
	diagnostics: diagnostics,
	controls: first.controls.map(\.0).filter { fullDump || !$0.capabilities.isEmpty }
)
let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
let file = downloads.appendingPathComponent("teams-ax-probe-\(stamp.replacingOccurrences(of: ":", with: "-")).json")
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
try encoder.encode(report).write(to: file)
print("\nSaved report: \(file.path)" + (fullDump ? "  (--full: contains every button label; check it before sharing)" : ""))

// MARK: - 5. Optional: press test

if pressTest {
	guard let (control, element) = best("mute", in: first) else {
		print("\nPress test skipped: no pressable mute control found.")
		restoreEnhanced()
		exit(1)
	}
	func reread() -> String { label(describe(element, role: control.role, window: control.window, depth: control.depth)) }
	print("\nPress test: toggling your mic, then restoring it (about 3 s).")
	print("  before:        \(reread())")
	let pressed = AXUIElementPerformAction(element, kAXPressAction as CFString)
	Thread.sleep(forTimeInterval: 1.5)
	print("  after press:   \(reread())   (AXPress → \(pressed == .success ? "ok" : "error \(pressed.rawValue)"))")
	let restored = AXUIElementPerformAction(element, kAXPressAction as CFString)
	Thread.sleep(forTimeInterval: 1.5)
	print("  after restore: \(reread())   (AXPress → \(restored == .success ? "ok" : "error \(restored.rawValue)"))")
	print("  If the label changed and changed back, pressing works and state is readable from the label.")
}

// MARK: - 6. Optional: watch

if !watchMode { restoreEnhanced() }

if watchMode {
	signal(SIGINT, SIG_IGN)
	let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
	interrupt.setEventHandler { restoreEnhanced(); exit(0) }
	interrupt.resume()
	print("\nWatching mic, camera and hand every 0.5 s. Change them in Teams (or with ⌘⇧M) and watch for updates. Ctrl-C to stop.")
	var last = ""
	while true {
		let s = scan(axApp)
		let line = ["mute", "camera", "hand"].map { cap -> String in
			guard let (c, _) = best(cap, in: s) else { return "\(cap): —" }
			return "\(cap): \(c.title ?? c.description ?? c.help ?? "?")\(c.value.map { " (\($0))" } ?? "")"
		}.joined(separator: " | ")
		if line != last {
			let time = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
			print("  \(time)  \(line)   [scan \(Int(s.milliseconds)) ms, \(s.nodes) nodes]")
			last = line
		}
		Thread.sleep(forTimeInterval: 0.5)
	}
}

// Teams Accessibility diff probe
//
// Prints what changes in Teams' UI while you do something, so a new state can be found
// by observation instead of guessing. Start it, then raise your hand, share your screen,
// and so on; each change is printed with the time it appeared.
//
//   swift probe/teams-ax-diff.swift [--seconds 150] [--interval 1.5] [--only id,id,…] [--app com.microsoft.teams2]
//
// --only narrows the output to those web ids (with every attribute they carry), their
// descendants, and anything mentioning a hand or sharing.
//
// Run it in a meeting on your own (Teams → Meet now), so no one else's names or messages
// are read. Your terminal needs Accessibility permission. Window titles are never read and
// every string is cut to 80 characters.

import AppKit
import ApplicationServices

func option(_ name: String) -> String? {
	guard let i = CommandLine.arguments.firstIndex(of: name), i + 1 < CommandLine.arguments.count else { return nil }
	return CommandLine.arguments[i + 1]
}

let seconds = Double(option("--seconds") ?? "") ?? 150
let interval = Double(option("--interval") ?? "") ?? 1.5
let bundleID = option("--app") ?? "com.microsoft.teams2"

let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
guard AXIsProcessTrustedWithOptions(prompt) else {
	print("✗ Accessibility permission is missing for this terminal app.")
	print("  System Settings → Privacy & Security → Accessibility → turn on your terminal, then run again.")
	exit(1)
}
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
	print("✗ Teams (\(bundleID)) isn't running.")
	exit(1)
}

let axApp = AXUIElementCreateApplication(app.processIdentifier)

func value(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
	var result: AnyObject?
	return AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success ? result : nil
}

func text(_ element: AXUIElement, _ attribute: String, limit: Int = 80) -> String? {
	switch value(element, attribute) {
	case let s as String: return s.isEmpty ? nil : String(s.prefix(limit))
	case let n as NSNumber: return n.stringValue
	case let list as [String]: return list.isEmpty ? nil : String(list.joined(separator: ".").prefix(limit))
	default: return nil
	}
}

// Same switch VoiceOver sets; Teams builds its accessibility tree only while it's on.
let enhancedBefore = (value(axApp, "AXEnhancedUserInterface") as? NSNumber)?.boolValue ?? false
AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
func restore() {
	if !enhancedBefore { AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanFalse) }
}
signal(SIGINT, SIG_IGN)
let interrupt = DispatchSource.makeSignalSource(signal: SIGINT)
interrupt.setEventHandler { restore(); exit(0) }
interrupt.resume()

// Text you type and read (chat, compose boxes) is skipped entirely.
let privateRoles: Set<String> = ["AXTextArea", "AXTextField"]
// The meeting clock changes every second and would drown out everything else.
let clock = try! NSRegularExpression(pattern: #"^\d{1,2}:\d{2}(:\d{2})?$"#)

// --only id,id,…: print just those elements (every attribute they have), their descendants,
// and anything that mentions a hand or sharing. Without it, everything is printed.
let focusIDs = Set((option("--only") ?? "").split(separator: ",").map(String.init))
let keywords = try! NSRegularExpression(pattern: "hand|raise|lower|shar|present", options: .caseInsensitive)
func mentionsKeyword(_ s: String) -> Bool { keywords.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil }

/// Every string, number or string-list attribute, for the elements being watched closely.
func allAttributes(_ element: AXUIElement, skipping known: Set<String>) -> [String] {
	var names: CFArray?
	guard AXUIElementCopyAttributeNames(element, &names) == .success, let list = names as? [String] else { return [] }
	return list.sorted().compactMap { name in
		guard !known.contains(name), let v = text(element, name, limit: 300) else { return nil }
		return "\(name)=\(v)"
	}
}

/// One line per element that carries any identity or state.
func snapshot() -> [String] {
	var lines: [String] = []
	let roots = (value(axApp, kAXWindowsAttribute) as? [AXUIElement]) ?? []
	var queue: [(AXUIElement, String, Int)] = roots.map { ($0, "window", 0) }
	var visited = 0
	while !queue.isEmpty, visited < 60_000 {
		let (element, nearestID, depth) = queue.removeFirst()
		visited += 1
		let role = text(element, kAXRoleAttribute) ?? "?"
		if privateRoles.contains(role) { continue }
		let id = text(element, "AXDOMIdentifier")
		let classes = text(element, "AXDOMClassList", limit: 300)
		// Window titles carry the meeting's name.
		let isWindowChrome = role == "AXWindow" || (classes?.contains("BrowserRootView") ?? false)
		var parts: [String] = []
		let standard: [(String, String)] = [
			("title", kAXTitleAttribute), ("desc", kAXDescriptionAttribute), ("help", kAXHelpAttribute),
			("value", kAXValueAttribute), ("selected", kAXSelectedAttribute), ("expanded", kAXExpandedAttribute),
			("enabled", kAXEnabledAttribute),
		]
		for (name, attribute) in standard {
			if isWindowChrome, name == "title" || name == "desc" { continue }
			guard let v = text(element, attribute) else { continue }
			if name == "value" || name == "title", clock.firstMatch(in: v, range: NSRange(v.startIndex..., in: v)) != nil { continue }
			parts.append("\(name)=\(v)")
		}
		if let classes { parts.append("class=\(classes)") }
		let watched = id.map(focusIDs.contains) ?? false
		if watched {
			let known = Set(standard.map { $0.1 } + ["AXDOMClassList", "AXDOMIdentifier", kAXRoleAttribute, kAXSubroleAttribute])
			parts += allAttributes(element, skipping: known)
		}
		let line = parts.joined(separator: "  ")
		let wanted = focusIDs.isEmpty || watched || focusIDs.contains(nearestID) || mentionsKeyword(line) || mentionsKeyword(id ?? "")
		if wanted, id != nil || parts.contains(where: { !$0.hasPrefix("enabled=") }) {
			let subrole = text(element, kAXSubroleAttribute).map { "/\($0)" } ?? ""
			lines.append("\(role)\(subrole) #\(id ?? "-") in #\(nearestID)  \(line)")
		}
		if depth < 120 {
			let next = id ?? nearestID
			for child in (value(element, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { queue.append((child, next, depth + 1)) }
		}
	}
	return lines
}

func counts(_ lines: [String]) -> [String: Int] { lines.reduce(into: [:]) { $0[$1, default: 0] += 1 } }

// Give Teams a moment to build its tree after the switch flips.
Thread.sleep(forTimeInterval: 2)
var previous = counts(snapshot())
let start = Date()
print("Watching Teams for \(Int(seconds))s (\(previous.count) distinct elements). Change something now.")
setvbuf(stdout, nil, _IOLBF, 0)

while Date().timeIntervalSince(start) < seconds {
	Thread.sleep(forTimeInterval: interval)
	let current = counts(snapshot())
	let removed = previous.filter { current[$0.key, default: 0] < $0.value }.keys.sorted()
	let added = current.filter { previous[$0.key, default: 0] < $0.value }.keys.sorted()
	if !removed.isEmpty || !added.isEmpty {
		print(String(format: "\n[+%.1fs] %d gone, %d new", Date().timeIntervalSince(start), removed.count, added.count))
		for line in removed.prefix(40) { print("  − \(line)") }
		for line in added.prefix(40) { print("  + \(line)") }
	}
	previous = current
}
restore()
print("\nDone.")

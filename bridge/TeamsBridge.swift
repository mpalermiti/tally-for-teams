// teams-bridge — reads and presses Teams' meeting controls through macOS Accessibility.
//
// Teams retired its local control API (port 8124) on 2026-06-30. This helper replaces it
// by doing what a screen reader does: find buttons by their web id, read their labels,
// and press them. It knows nothing about what the buttons mean; the plugin
// (src/teams/selectors.ts) owns that, so Teams UI changes are fixed in TypeScript.
//
// Protocol: one JSON object per line.
//   stdin  {"cmd":"watch","ids":["microphone-button",…],"anchor":"microphone-button","bundleIds":["com.microsoft.teams2"]}
//          {"cmd":"press","req":1,"id":"microphone-button"}
//          {"cmd":"menu","req":2,"id":"reaction-menu-button","labels":["like"]}   open a menu, press the new item matching a label
//          {"cmd":"prompt"}                                                       show macOS's Accessibility permission prompt
//   stdout {"type":"status","trusted":true,"running":true,"buttons":{"microphone-button":{"label":"Mute mic","enabled":true}}}
//          {"type":"result","req":1,"ok":true,"message":"pressed"}
//          {"type":"log","message":"…"}
//
// Status is sent only when it changes. The helper exits when stdin closes (the plugin quit).

import AppKit
import ApplicationServices

setvbuf(stdout, nil, _IOLBF, 0)

// MARK: - Output

func send(_ object: [String: Any]) {
	guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
		let line = String(data: data, encoding: .utf8)
	else { return }
	print(line)
}
func log(_ message: String) { send(["type": "log", "message": message]) }

// MARK: - Accessibility helpers

func value(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
	var result: AnyObject?
	guard AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success else { return nil }
	return result
}
func string(_ element: AXUIElement, _ attribute: String) -> String? {
	(value(element, attribute) as? String).flatMap { $0.isEmpty ? nil : $0 }
}
func children(_ element: AXUIElement) -> [AXUIElement] {
	(value(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}
func label(_ element: AXUIElement) -> String? {
	string(element, kAXTitleAttribute) ?? string(element, kAXDescriptionAttribute)
}
func domID(_ element: AXUIElement) -> String? {
	string(element, "AXDOMIdentifier") ?? string(element, kAXIdentifierAttribute)
}

/// Only real controls. Teams also makes chat rows and messages pressable; never touch those.
let controlRoles: Set<String> = [
	"AXButton", "AXCheckBox", "AXRadioButton", "AXMenuButton", "AXPopUpButton", "AXMenuItem", "AXToggle", "AXSwitch",
]

/// Every control in the app's windows. Bounded so a huge tree can't stall the helper.
func controls(in app: AXUIElement, maxNodes: Int = 40_000) -> [AXUIElement] {
	var found: [AXUIElement] = []
	var stack = (value(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
	var visited = 0
	while let element = stack.popLast(), visited < maxNodes {
		visited += 1
		if let role = string(element, kAXRoleAttribute), controlRoles.contains(role) { found.append(element) }
		stack.append(contentsOf: children(element))
	}
	return found
}

// MARK: - State

var watchIDs: [String] = []
var anchorID = "microphone-button"
var bundleIDs = ["com.microsoft.teams2"]

var appPID: pid_t = 0
var axApp: AXUIElement?
var cache: [String: AXUIElement] = [:]
var lastDiscovery = Date.distantPast
var lastStatus = ""
var promptedThisSession = false

func teamsApp() -> NSRunningApplication? {
	NSWorkspace.shared.runningApplications.first { bundleIDs.contains($0.bundleIdentifier ?? "") }
}

/// Teams' web content builds its accessibility tree only for assistive tech; this is VoiceOver's switch.
/// The call reports an error on Teams but the tree appears.
func enableTree(_ app: AXUIElement) {
	AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
}
func disableTree() {
	if let axApp { AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanFalse) }
}

/// Full scan for the watched ids. Costs 50–450 ms, so it's throttled; normal polling re-reads cached buttons.
func discover(_ app: AXUIElement) {
	lastDiscovery = Date()
	cache = [:]
	let wanted = Set(watchIDs)
	for element in controls(in: app) {
		if let id = domID(element), wanted.contains(id), cache[id] == nil { cache[id] = element }
	}
}

func poll() {
	guard !watchIDs.isEmpty else { return }
	let trusted = AXIsProcessTrusted()
	var buttons: [String: [String: Any]] = [:]
	var running = false

	if trusted, let app = teamsApp() {
		running = true
		if app.processIdentifier != appPID {
			appPID = app.processIdentifier
			let element = AXUIElementCreateApplication(appPID)
			AXUIElementSetMessagingTimeout(element, 1.0)
			enableTree(element)
			axApp = element
			cache = [:]
			lastDiscovery = .distantPast
		}
		if let app = axApp {
			let anchorAlive = cache[anchorID].flatMap(label) != nil
			let since = Date().timeIntervalSince(lastDiscovery)
			// Rediscover when the meeting toolbar vanished or reappeared (throttled), and every
			// 10 s in a meeting to catch buttons moving in or out of the "More" overflow.
			if (!anchorAlive && since > 2) || (anchorAlive && since > 10) { discover(app) }
			for (id, element) in cache {
				guard let text = label(element) else { continue }
				let enabled = (value(element, kAXEnabledAttribute) as? NSNumber)?.boolValue ?? true
				buttons[id] = ["label": text, "enabled": enabled]
			}
		}
	} else if !trusted || teamsApp() == nil {
		appPID = 0
		axApp = nil
		cache = [:]
	}

	let status: [String: Any] = ["type": "status", "trusted": trusted, "running": running, "buttons": buttons]
	if let data = try? JSONSerialization.data(withJSONObject: status, options: [.sortedKeys]),
		let line = String(data: data, encoding: .utf8), line != lastStatus
	{
		lastStatus = line
		print(line)
	}
}

// MARK: - Commands

func result(_ req: Any?, _ ok: Bool, _ message: String) {
	send(["type": "result", "req": req ?? NSNull(), "ok": ok, "message": message])
}

func element(for id: String) -> AXUIElement? {
	if let cached = cache[id], label(cached) != nil { return cached }
	guard let app = axApp else { return nil }
	discover(app)
	return cache[id]
}

func press(_ id: String, req: Any?) {
	guard AXIsProcessTrusted() else { return result(req, false, "Accessibility permission is off") }
	guard axApp != nil else { return result(req, false, "Teams isn't running") }
	guard let button = element(for: id) else { return result(req, false, "No \(id) on screen") }
	let error = AXUIElementPerformAction(button, kAXPressAction as CFString)
	result(req, error == .success, error == .success ? "pressed" : "AXError \(error.rawValue)")
	// Pick up the new label promptly instead of waiting for the next tick.
	DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: poll)
}

/// Opens a menu (e.g. React) and presses the item that appeared whose label contains one of `labels`.
/// Controls that existed before opening are ignored, so a chat message's "Like" can never match.
func menu(_ id: String, labels: [String], req: Any?) {
	guard AXIsProcessTrusted() else { return result(req, false, "Accessibility permission is off") }
	guard let app = axApp else { return result(req, false, "Teams isn't running") }
	guard let button = element(for: id) else { return result(req, false, "No \(id) on screen") }

	let before = controls(in: app)
	let opened = AXUIElementPerformAction(button, kAXPressAction as CFString)
	guard opened == .success else { return result(req, false, "Couldn't open \(id): AXError \(opened.rawValue)") }

	let wanted = labels.map { $0.lowercased() }
	var fresh: [AXUIElement] = []
	let deadline = Date().addingTimeInterval(1.5)
	while Date() < deadline {
		Thread.sleep(forTimeInterval: 0.1)
		fresh = controls(in: app).filter { candidate in !before.contains { CFEqual($0, candidate) } }
		if let item = fresh.first(where: { el in
			guard let text = label(el)?.lowercased() else { return false }
			return wanted.contains { text.contains($0) }
		}) {
			let error = AXUIElementPerformAction(item, kAXPressAction as CFString)
			result(req, error == .success, error == .success ? "pressed \(label(item) ?? "item")" : "AXError \(error.rawValue)")
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: poll)
			return
		}
	}
	// Not found: close the menu again and report what it offered, so selectors can be fixed.
	AXUIElementPerformAction(button, kAXPressAction as CFString)
	let offered = fresh.compactMap(label).prefix(25).joined(separator: " | ")
	result(req, false, "No \(labels.joined(separator: "/")) in \(id) menu; it offered: \(offered.isEmpty ? "nothing" : offered)")
}

func handle(_ line: String) {
	guard let data = line.data(using: .utf8),
		let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
		let cmd = message["cmd"] as? String
	else { return log("ignored malformed line") }

	switch cmd {
	case "watch":
		watchIDs = message["ids"] as? [String] ?? []
		anchorID = message["anchor"] as? String ?? anchorID
		bundleIDs = message["bundleIds"] as? [String] ?? bundleIDs
		cache = [:]
		lastDiscovery = .distantPast
		lastStatus = ""
		poll()
	case "press":
		press(message["id"] as? String ?? "", req: message["req"])
	case "menu":
		menu(message["id"] as? String ?? "", labels: message["labels"] as? [String] ?? [], req: message["req"])
	case "prompt":
		if !promptedThisSession {
			promptedThisSession = true
			let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
			_ = AXIsProcessTrustedWithOptions(options)
		}
	default:
		log("unknown command \(cmd)")
	}
}

// MARK: - Main loop

var buffer = Data()
FileHandle.standardInput.readabilityHandler = { input in
	let chunk = input.availableData
	if chunk.isEmpty {
		// The plugin went away; leave Teams as we found it.
		DispatchQueue.main.async {
			disableTree()
			exit(0)
		}
		return
	}
	DispatchQueue.main.async {
		buffer.append(chunk)
		while let newline = buffer.firstIndex(of: 0x0A) {
			let lineData = buffer[buffer.startIndex..<newline]
			buffer.removeSubrange(buffer.startIndex...newline)
			if let line = String(data: lineData, encoding: .utf8), !line.isEmpty { handle(line) }
		}
	}
}

var signalSources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
	signal(sig, SIG_IGN)
	let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
	source.setEventHandler {
		disableTree()
		exit(0)
	}
	source.resume()
	signalSources.append(source)
}

Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in poll() }
RunLoop.main.run()

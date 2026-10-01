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
//          {"cmd":"menu","req":2,"id":"reaction-menu-button","itemIds":["like-button"],"labels":["like"]}
//                                                                                 open a menu, press the new item (id first, then label)
//          {"cmd":"prompt"}                                                       show macOS's Accessibility permission prompt
//   stdout {"type":"status","trusted":true,"running":true,"buttons":{"microphone-button":{"label":"Mute mic","enabled":true,"style":"fui-Button …"}}}
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
/// The element's web classes. Teams signals some states (a raised hand) only through styling.
func style(_ element: AXUIElement) -> String? {
	(value(element, "AXDOMClassList") as? [String]).flatMap { $0.isEmpty ? nil : $0.joined(separator: " ") }
}

/// Only real controls. Teams also makes chat rows and messages pressable; never touch those.
let controlRoles: Set<String> = [
	"AXButton", "AXCheckBox", "AXRadioButton", "AXMenuButton", "AXPopUpButton", "AXMenuItem", "AXToggle", "AXSwitch",
]

func windows(of app: AXUIElement) -> [AXUIElement] {
	(value(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
}

/// Every control under `root`. Bounded so a huge tree can't stall the helper.
func controls(under root: AXUIElement, maxNodes: Int = 40_000) -> [AXUIElement] {
	var found: [AXUIElement] = []
	var stack = [root]
	var visited = 0
	while let element = stack.popLast(), visited < maxNodes {
		visited += 1
		if let role = string(element, kAXRoleAttribute), controlRoles.contains(role) { found.append(element) }
		stack.append(contentsOf: children(element))
	}
	return found
}

/// Every control in all of the app's windows.
func controls(in app: AXUIElement) -> [AXUIElement] {
	windows(of: app).flatMap { controls(under: $0) }
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

/// Full scan for the watched ids. A meeting can have two windows (the full one and a compact
/// view) that come and go, so every id is taken from the one window holding the anchor and the
/// most of them; mixing the two would compare buttons from different toolbars.
/// Costs 50–450 ms, so it's throttled; normal polling re-reads cached buttons.
func discover(_ app: AXUIElement) {
	lastDiscovery = Date()
	let wanted = Set(watchIDs)
	var best: [String: AXUIElement] = [:]
	var bestScore = 0
	for window in windows(of: app) {
		var found: [String: AXUIElement] = [:]
		for element in controls(under: window) {
			if let id = domID(element), wanted.contains(id), found[id] == nil { found[id] = element }
		}
		let score = found.count + (found[anchorID] != nil ? 1000 : 0)
		if score > bestScore { (best, bestScore) = (found, score) }
	}
	cache = best
}

/// The cached buttons that are still on screen.
func readButtons() -> [String: [String: Any]] {
	var buttons: [String: [String: Any]] = [:]
	for (id, element) in cache {
		guard let text = label(element) else { continue }
		var button: [String: Any] = ["label": text, "enabled": (value(element, kAXEnabledAttribute) as? NSNumber)?.boolValue ?? true]
		if let style = style(element) { button["style"] = style }
		buttons[id] = button
	}
	return buttons
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
			buttons = readButtons()
			let since = Date().timeIntervalSince(lastDiscovery)
			// Rediscover (throttled) when the toolbar vanished or any watched button went stale:
			// Teams rebuilds the toolbar when sharing starts and swaps in the compact view. Also
			// every 10 s in a meeting, to catch buttons moving in or out of the "More" overflow.
			let stale = buttons[anchorID] == nil || buttons.count < cache.count
			if (stale && since > 2) || since > 10 {
				discover(app)
				buttons = readButtons()
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

/// Opens a menu (e.g. React) and presses the item that appeared whose web id is in `itemIds`,
/// falling back to one whose label contains a word from `labels`. Controls that existed before
/// opening are ignored, so a chat message's "Like" can never match.
func menu(_ id: String, itemIds: [String], labels: [String], req: Any?) {
	guard AXIsProcessTrusted() else { return result(req, false, "Accessibility permission is off") }
	guard let app = axApp else { return result(req, false, "Teams isn't running") }
	guard let button = element(for: id) else { return result(req, false, "No \(id) on screen") }

	let before = controls(in: app)
	let opened = AXUIElementPerformAction(button, kAXPressAction as CFString)
	guard opened == .success else { return result(req, false, "Couldn't open \(id): AXError \(opened.rawValue)") }

	let wantedLabels = labels.map { $0.lowercased() }
	var fresh: [AXUIElement] = []
	var item: AXUIElement?
	let deadline = Date().addingTimeInterval(1.5)
	while item == nil && Date() < deadline {
		Thread.sleep(forTimeInterval: 0.1)
		fresh = controls(in: app).filter { candidate in !before.contains { CFEqual($0, candidate) } }
		item = fresh.first { domID($0).map(itemIds.contains) ?? false }
			?? fresh.first { el in
				guard let text = label(el)?.lowercased() else { return false }
				return wantedLabels.contains { text.contains($0) }
			}
	}

	guard let item else {
		let offered = fresh.compactMap { domID($0) }.prefix(25).joined(separator: " | ")
		closeMenu(app, items: fresh, button: button)
		return result(req, false, "No \(itemIds.first ?? labels.first ?? "item") in \(id) menu; it offered: \(offered.isEmpty ? "nothing" : offered)")
	}
	let error = AXUIElementPerformAction(item, kAXPressAction as CFString)
	let pressedLabel = label(item) ?? domID(item) ?? "item"
	Thread.sleep(forTimeInterval: 0.3)
	closeMenu(app, items: fresh, button: button)
	result(req, error == .success, error == .success ? "pressed \(pressedLabel)" : "AXError \(error.rawValue)")
	DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: poll)
}

/// Closes a menu left open. On Teams 26267, pressing React again does NOT close its menu but
/// Escape does, so Escape goes first; pressing the button again is the fallback.
func closeMenu(_ app: AXUIElement, items: [AXUIElement], button: AXUIElement) {
	func stillOpen() -> Bool {
		let now = controls(in: app)
		return items.contains { item in now.contains { CFEqual($0, item) } }
	}
	guard !items.isEmpty, stillOpen() else { return }
	for down in [true, false] { CGEvent(keyboardEventSource: nil, virtualKey: 0x35, keyDown: down)?.postToPid(appPID) }
	Thread.sleep(forTimeInterval: 0.3)
	if stillOpen() {
		AXUIElementPerformAction(button, kAXPressAction as CFString)
		Thread.sleep(forTimeInterval: 0.3)
		log(stillOpen() ? "menu stayed open after Escape and re-press" : "menu closed by re-press (Escape didn't)")
	}
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
		menu(
			message["id"] as? String ?? "",
			itemIds: message["itemIds"] as? [String] ?? [],
			labels: message["labels"] as? [String] ?? [],
			req: message["req"]
		)
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

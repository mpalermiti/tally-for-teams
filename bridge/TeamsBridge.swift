// teams-bridge — reads and presses Teams' meeting controls through macOS Accessibility.
//
// Teams retired its local control API (port 8124) on 2026-06-30. This helper replaces it
// by doing what a screen reader does: find buttons by their web id, read their labels,
// and press them. It knows nothing about what the buttons mean; the plugin
// (src/teams/selectors.ts) owns that, so Teams UI changes are fixed in TypeScript.
//
// Protocol: one JSON object per line.
//   stdin  {"cmd":"watch","ids":["microphone-button",…],"anchor":"microphone-button","markers":["hangup-button",…],"indicatorContainers":["indicators"],"bundleIds":["com.microsoft.teams2"]}
//          {"cmd":"press","req":1,"id":"microphone-button","deadline":1800000003000}
//          {"cmd":"menu","req":2,"id":"reaction-menu-button","deadline":1800000005000,"itemIds":["like-button"],"labels":["like"],"excludeLabels":["none"]}
//                                                                                 open a menu, press the new item (id first, then label)
//          {"cmd":"menu","req":3,"id":"video-button-configure","toggle":{"on":{"itemIds":[],"labels":["standard blur","blur"],"excludeLabels":["no background effect","none"]},"off":{"itemIds":[],"labels":["no background effect","none"]}}}
//                                                                                 open video options and choose blur on/off from fresh selected state
//          {"cmd":"prompt"}                                                       show macOS's Accessibility permission prompt
//   stdout {"type":"status","trusted":true,"running":true,"indicators":[{"id":"call-duration-custom","role":"AXTimeGroup","label":"Elapsed time 00:34"}],"markers":["hangup-button"],"markerControlIds":["hangup-button"],"buttons":{"microphone-button":{"label":"Mute mic","enabled":true,"style":"fui-Button …"}}}
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
func rawString(_ element: AXUIElement, _ attribute: String) -> String? {
	value(element, attribute) as? String
}
func bool(_ element: AXUIElement, _ attribute: String) -> Bool? {
	guard let raw = value(element, attribute) else { return nil }
	if let number = raw as? NSNumber { return number.boolValue }
	if let bool = raw as? Bool { return bool }
	return nil
}
func children(_ element: AXUIElement) -> [AXUIElement] {
	(value(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}
func label(_ element: AXUIElement) -> String? {
	string(element, kAXTitleAttribute) ?? string(element, kAXDescriptionAttribute)
}
func domIdentifier(_ element: AXUIElement) -> String? {
	string(element, "AXDOMIdentifier")
}
func domID(_ element: AXUIElement) -> String? {
	domIdentifier(element) ?? string(element, kAXIdentifierAttribute)
}
/// The element's web classes. Teams signals some states (a raised hand) only through styling.
func style(_ element: AXUIElement) -> String? {
	(value(element, "AXDOMClassList") as? [String]).flatMap { $0.isEmpty ? nil : $0.joined(separator: " ") }
}

func position(_ element: AXUIElement) -> CGPoint? {
	guard let raw = value(element, kAXPositionAttribute) else { return nil }
	guard CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
	let axValue = raw as! AXValue
	guard AXValueGetType(axValue) == .cgPoint else { return nil }
	var point = CGPoint.zero
	return AXValueGetValue(axValue, .cgPoint, &point) ? point : nil
}

func boolLike(_ raw: AnyObject?) -> Bool? {
	guard let raw else { return nil }
	if let number = raw as? NSNumber { return number.boolValue }
	if let bool = raw as? Bool { return bool }
	if let string = raw as? String {
		switch string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
		case "true", "1", "yes", "on", "checked", "mixed":
			return true
		case "false", "0", "no", "off", "unchecked":
			return false
		default:
			return nil
		}
	}
	return nil
}

func selectedValue(_ raw: AnyObject) -> Bool {
	if let number = raw as? NSNumber { return number.doubleValue == 1 }
	if let bool = raw as? Bool { return bool }
	if let string = raw as? String {
		let normalized = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		return normalized == "1" || normalized == "true"
	}
	return false
}

func selectedState(_ element: AXUIElement) -> Bool? {
	var readable = false
	if let rawMark = value(element, "AXMenuItemMarkChar") {
		readable = true
		if let mark = rawMark as? String, !mark.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			return true
		}
	}
	if let rawValue = value(element, kAXValueAttribute) {
		readable = true
		if selectedValue(rawValue) { return true }
	}
	if let rawSelected = value(element, "AXSelected") {
		readable = true
		if selectedValue(rawSelected) { return true }
	}
	return readable ? false : nil
}

/// Only real controls. Teams also makes chat rows and messages pressable; never touch those.
let controlRoles: Set<String> = [
	"AXButton", "AXCheckBox", "AXRadioButton", "AXMenuButton", "AXPopUpButton", "AXMenuItem", "AXToggle", "AXSwitch",
]
let markerContainerRoles: Set<String> = ["AXToolbar", "AXGroup"]
let indicatorRoles: Set<String> = ["AXButton", "AXGroup", "AXTimeGroup", "AXStaticText"]
let textInputRoles: Set<String> = ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox"]

struct MenuSelector {
	let itemIds: [String]
	let labels: [String]
	let excludeLabels: [String]
}

struct MenuMatch {
	let element: AXUIElement
	let state: Bool?
}

enum BlurDecisionReason: String {
	case blurSelected = "blur-selected"
	case noneSelected = "none-selected"
	case readableNoSelection = "readable-no-selection"
	case fallbackOn = "fallback-on"
	case fallbackOff = "fallback-off"
	case fallbackOffMissing = "fallback-off-missing"
}

struct BlurDecision {
	let target: String
	let memoryAfterSuccess: Bool
	let memoryAfterMissingItem: Bool?
	let reason: BlurDecisionReason
}

enum MenuEscapeIfNoFreshItems: String {
	case always
	case ifExpanded
}

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

struct WindowScan {
	let found: [String: AXUIElement]
	let markers: [String]
	let markerControlIDs: [String]
	let indicatorContainers: [String: AXUIElement]
}

func scanWindow(
	_ root: AXUIElement,
	wanted: Set<String>,
	markers: [String],
	indicatorContainerIDs: [String],
	maxNodes: Int = 40_000
) -> WindowScan {
	let markerSet = Set(markers)
	let indicatorContainerSet = Set(indicatorContainerIDs)
	var seenMarkers = Set<String>()
	var found: [String: AXUIElement] = [:]
	var markerControlIDs: [String] = []
	var seenMarkerControlIDs = Set<String>()
	var indicatorContainers: [String: AXUIElement] = [:]
	var indicatorRanks: [String: Int] = [:]
	var stack: [(element: AXUIElement, insideMarkerContainer: Bool)] = [(root, false)]
	var visited = 0
	while let current = stack.popLast(), visited < maxNodes {
		visited += 1
		let element = current.element
		let role = string(element, kAXRoleAttribute)
		var insideMarkerContainer = current.insideMarkerContainer
		if let role, markerContainerRoles.contains(role), let id = domIdentifier(element) {
			if markerSet.contains(id) {
				seenMarkers.insert(id)
				insideMarkerContainer = true
			}
			if indicatorContainerSet.contains(id) {
				let rank = role == "AXToolbar" ? 0 : 1
				if indicatorContainers[id] == nil || rank < (indicatorRanks[id] ?? Int.max) {
					indicatorContainers[id] = element
					indicatorRanks[id] = rank
				}
			}
		}
		if let role, controlRoles.contains(role), let id = domID(element) {
			if markerSet.contains(id) { seenMarkers.insert(id) }
			if wanted.contains(id), found[id] == nil { found[id] = element }
			if insideMarkerContainer, seenMarkerControlIDs.insert(id).inserted { markerControlIDs.append(id) }
		}
		stack.append(contentsOf: children(element).map { ($0, insideMarkerContainer) })
	}
	return WindowScan(
		found: found,
		markers: markers.filter { seenMarkers.contains($0) },
		markerControlIDs: markerControlIDs,
		indicatorContainers: indicatorContainers
	)
}

// MARK: - State

var watchIDs: [String] = []
var anchorID = "microphone-button"
var markerIDs: [String] = []
var indicatorContainerIDs: [String] = []
var bundleIDs = ["com.microsoft.teams2"]

var appPID: pid_t = 0
var axApp: AXUIElement?
var cache: [String: AXUIElement] = [:]
var indicatorContainers: [String: AXUIElement] = [:]
var meetingMarkers: [String] = []
var meetingMarkerControlIDs: [String] = []
var lastDiscovery = Date.distantPast
var lastStatus = ""
var promptedThisSession = false
var indicatorFastRediscoverySpent = false
var fallbackBlurTurnedOnMenus = Set<String>()
var anchorMissingSince: Date?

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

/// Whether Teams currently lets us press this element. Unknown counts as yes, so we never get in the way.
func canPress(_ element: AXUIElement) -> Bool {
	var names: CFArray?
	guard AXUIElementCopyActionNames(element, &names) == .success, let list = names as? [String] else { return true }
	return list.contains(kAXPressAction as String)
}

/// If something turns Teams' accessibility mode off while we run (VoiceOver quitting, another
/// tool, a probe), Teams keeps showing its buttons but drops their press action, so presses
/// silently do nothing. Turn the mode back on, at most every few seconds.
var lastTreeRepair = Date.distantPast
func repairTreeIfNeeded(_ element: AXUIElement) {
	guard !canPress(element), let app = axApp, Date().timeIntervalSince(lastTreeRepair) > 5 else { return }
	lastTreeRepair = Date()
	enableTree(app)
	log("Teams' accessibility mode was off; turned it back on")
}

/// Makes sure `element` can be pressed, repairing Teams' accessibility mode if needed; waits up to 1 s.
func ensurePressable(_ element: AXUIElement) -> Bool {
	if canPress(element) { return true }
	repairTreeIfNeeded(element)
	for _ in 0..<10 {
		Thread.sleep(forTimeInterval: 0.1)
		if canPress(element) { return true }
	}
	return false
}

/// Full scan for the watched ids. A meeting can have two windows (the full one and a compact
/// view) that come and go, so every id is taken from the one window holding the anchor and the
/// most of them; mixing the two would compare buttons from different toolbars.
/// Costs 50–450 ms, so it's throttled; normal polling re-reads cached buttons.
func discover(_ app: AXUIElement) {
	lastDiscovery = Date()
	let wanted = Set(watchIDs)
	var best: [String: AXUIElement] = [:]
	var bestMarkers: [String] = []
	var bestMarkerControlIDs: [String] = []
	var bestIndicatorContainers: [String: AXUIElement] = [:]
	var bestScore = -1
	for window in windows(of: app) {
		let scan = scanWindow(window, wanted: wanted, markers: markerIDs, indicatorContainerIDs: indicatorContainerIDs)
		let hasAnchor = scan.found[anchorID] != nil
		let score = scan.found.count + (hasAnchor ? 1000 : 0) + (!hasAnchor && !scan.markers.isEmpty ? 500 : 0)
		if score > bestScore {
			best = scan.found
			bestMarkers = hasAnchor ? [] : scan.markers
			bestMarkerControlIDs = hasAnchor || scan.markers.isEmpty ? [] : scan.markerControlIDs
			bestIndicatorContainers = scan.indicatorContainers
			bestScore = score
		}
	}
	cache = best
	indicatorContainers = bestIndicatorContainers
	meetingMarkers = bestMarkers
	meetingMarkerControlIDs = bestMarkerControlIDs
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

/// Indicator descendants from named containers in the chosen meeting window. Labels are read only here.
func readIndicators(maxNodes: Int = 500, maxItems: Int = 20) -> [[String: Any]] {
	var indicators: [[String: Any]] = []
	var seen = Set<String>()
	for containerID in indicatorContainerIDs {
		guard let container = indicatorContainers[containerID] else { continue }
		var stack = children(container)
		var visited = 0
		while let element = stack.popLast(), visited < maxNodes, indicators.count < maxItems {
			visited += 1
			let role = string(element, kAXRoleAttribute)
			if let role, textInputRoles.contains(role) { continue }
			if let role, indicatorRoles.contains(role) {
				let id = domID(element)
				let text = label(element)
				if id != nil || text != nil {
					let key = "\(id ?? "")|\(role)|\(text ?? "")"
					if seen.insert(key).inserted {
						var item: [String: Any] = ["role": role]
						if let id { item["id"] = id }
						if let text { item["label"] = text }
						indicators.append(item)
					}
				}
			}
			stack.append(contentsOf: children(element))
		}
		if indicators.count >= maxItems { break }
	}
	return indicators
}

func indicatorContainersStale() -> Bool {
	guard !indicatorContainerIDs.isEmpty else { return false }
	for containerID in indicatorContainerIDs {
		guard let container = indicatorContainers[containerID], !children(container).isEmpty else { return true }
	}
	return false
}

func poll() {
	guard !watchIDs.isEmpty else { return }
	let trusted = AXIsProcessTrusted()
	var buttons: [String: [String: Any]] = [:]
	var indicators: [[String: Any]] = []
	var markers: [String] = []
	var markerControlIds: [String] = []
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
			indicatorContainers = [:]
			meetingMarkers = []
			meetingMarkerControlIDs = []
			lastDiscovery = .distantPast
			indicatorFastRediscoverySpent = false
			fallbackBlurTurnedOnMenus.removeAll()
			anchorMissingSince = nil
		}
		if let app = axApp {
			buttons = readButtons()
			let since = Date().timeIntervalSince(lastDiscovery)
			// Rediscover (throttled) when the toolbar vanished or any watched button went stale:
			// Teams rebuilds the toolbar when sharing starts and swaps in the compact view. A
			// previously found indicator container gets one fast recovery scan; if it stays
			// missing, fall back to the 10 s cadence instead of rescanning every 2 s.
			let toolbarStale = buttons[anchorID] == nil || buttons.count < cache.count
			let indicatorsWentStale = buttons[anchorID] != nil && !indicatorContainers.isEmpty && indicatorContainersStale()
			let quickIndicatorRecovery = indicatorsWentStale && !indicatorFastRediscoverySpent
			if ((toolbarStale || quickIndicatorRecovery) && since > 2) || since > 10 {
				discover(app)
				buttons = readButtons()
				if quickIndicatorRecovery && since <= 10 { indicatorFastRediscoverySpent = indicatorContainersStale() }
			}
			if buttons[anchorID] != nil && !indicatorContainers.isEmpty && !indicatorContainersStale() {
				indicatorFastRediscoverySpent = false
			}
			indicators = readIndicators()
			if buttons[anchorID] == nil {
				markers = meetingMarkers
				markerControlIds = markers.isEmpty ? [] : meetingMarkerControlIDs
			}
			if let anchor = cache[anchorID], buttons[anchorID] != nil { repairTreeIfNeeded(anchor) }
		}
	} else if !trusted || teamsApp() == nil {
		appPID = 0
		axApp = nil
		cache = [:]
		indicatorContainers = [:]
		meetingMarkers = []
		meetingMarkerControlIDs = []
		indicatorFastRediscoverySpent = false
		fallbackBlurTurnedOnMenus.removeAll()
		anchorMissingSince = nil
	}

	if running && trusted {
		if buttons[anchorID] == nil {
			let missingSince = anchorMissingSince ?? Date()
			anchorMissingSince = missingSince
			if Date().timeIntervalSince(missingSince) >= 3 {
				fallbackBlurTurnedOnMenus.removeAll()
			}
		} else {
			anchorMissingSince = nil
		}
	}

	let status: [String: Any] = [
		"type": "status",
		"trusted": trusted,
		"running": running,
		"buttons": buttons,
		"indicators": indicators,
		"markers": markers,
		"markerControlIds": markerControlIds,
	]
	if let data = try? JSONSerialization.data(withJSONObject: status, options: [.sortedKeys]),
		let line = String(data: data, encoding: .utf8), line != lastStatus
	{
		lastStatus = line
		print(line)
	}
}

// MARK: - Commands

func result(_ req: Any?, _ ok: Bool, _ message: String, extra: [String: Any] = [:]) {
	var payload: [String: Any] = ["type": "result", "req": req ?? NSNull(), "ok": ok, "message": message]
	for (key, value) in extra { payload[key] = value }
	send(payload)
}

func deadlineMilliseconds(_ raw: Any?) -> Double? {
	if let number = raw as? NSNumber { return number.doubleValue }
	if let string = raw as? String { return Double(string) }
	return nil
}

func deadlinePassed(_ raw: Any?) -> Bool {
	guard let deadline = deadlineMilliseconds(raw) else { return false }
	return Date().timeIntervalSince1970 * 1000 >= deadline
}

func expired(_ req: Any?) {
	result(req, false, "expired", extra: ["error": "expired"])
}

func element(for id: String) -> AXUIElement? {
	if let cached = cache[id], label(cached) != nil { return cached }
	guard let app = axApp else { return nil }
	discover(app)
	return cache[id]
}

func press(_ id: String, req: Any?, deadline: Any?) {
	guard !deadlinePassed(deadline) else { return expired(req) }
	guard AXIsProcessTrusted() else { return result(req, false, "Accessibility permission is off") }
	guard axApp != nil else { return result(req, false, "Teams isn't running") }
	guard var button = element(for: id) else { return result(req, false, "No \(id) on screen") }
	var pressable = ensurePressable(button)
	if !pressable, let app = axApp {
		discover(app)
		if let fresh = cache[id] {
			button = fresh
			pressable = ensurePressable(button)
		}
	}
	guard pressable else { return result(req, false, "No AXPress action for \(id)") }
	guard !deadlinePassed(deadline) else { return expired(req) }
	let error = AXUIElementPerformAction(button, kAXPressAction as CFString)
	result(req, error == .success, error == .success ? "pressed" : "AXError \(error.rawValue)")
	// Pick up the new label promptly instead of waiting for the next tick.
	DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: poll)
}

func menuSelector(from object: Any?) -> MenuSelector {
	guard let dict = object as? [String: Any] else { return MenuSelector(itemIds: [], labels: [], excludeLabels: []) }
	return MenuSelector(
		itemIds: dict["itemIds"] as? [String] ?? [],
		labels: dict["labels"] as? [String] ?? [],
		excludeLabels: dict["excludeLabels"] as? [String] ?? []
	)
}

func ordered(_ items: [AXUIElement]) -> [AXUIElement] {
	items.enumerated().sorted { left, right in
		let lp = position(left.element)
		let rp = position(right.element)
		if let lp, let rp {
			if abs(lp.y - rp.y) > 1 { return lp.y < rp.y }
			if abs(lp.x - rp.x) > 1 { return lp.x < rp.x }
			return left.offset > right.offset
		}
		if lp != nil { return true }
		if rp != nil { return false }
		return left.offset > right.offset
	}.map(\.element)
}

func matches(_ element: AXUIElement, selector: MenuSelector) -> Bool {
	if let id = domID(element), selector.itemIds.contains(id) { return true }
	guard let text = label(element)?.lowercased() else { return false }
	if selector.excludeLabels.map({ $0.lowercased() }).contains(where: { text.contains($0) }) { return false }
	return selector.labels.map { $0.lowercased() }.contains(where: { text.contains($0) })
}

func firstMatch(in items: [AXUIElement], selector: MenuSelector) -> MenuMatch? {
	for id in selector.itemIds {
		if let element = items.first(where: { domID($0) == id }) {
			return MenuMatch(element: element, state: selectedState(element))
		}
	}
	let excluded = selector.excludeLabels.map { $0.lowercased() }
	for wanted in selector.labels.map({ $0.lowercased() }) {
		if let element = items.first(where: { element in
			guard let text = label(element)?.lowercased(), text.contains(wanted) else { return false }
			return !excluded.contains(where: { text.contains($0) })
		}) {
			return MenuMatch(element: element, state: selectedState(element))
		}
	}
	return nil
}

func offeredDescription(_ fresh: [AXUIElement]) -> String {
	let offeredIds = fresh.compactMap { domID($0) }
	let withoutIDCount = fresh.count - offeredIds.count
	let offeredList = offeredIds.prefix(25).joined(separator: " | ")
	if fresh.isEmpty { return "nothing" }
	if offeredList.isEmpty { return "\(withoutIDCount) control\(withoutIDCount == 1 ? "" : "s") without id" }
	if withoutIDCount == 0 { return offeredList }
	return "\(offeredList) (+\(withoutIDCount) without id)"
}

func chooseBackgroundBlurTarget(
	blurSelected: Bool?,
	offSelected: Bool?,
	hasReadableSelection: Bool,
	canPressOn: Bool,
	canPressOff: Bool,
	fallbackBlurTurnedOn: Bool
) -> BlurDecision {
	if hasReadableSelection {
		if blurSelected == true {
			return BlurDecision(target: "off", memoryAfterSuccess: false, memoryAfterMissingItem: canPressOff ? nil : false, reason: .blurSelected)
		}
		if offSelected == true {
			return BlurDecision(target: "on", memoryAfterSuccess: true, memoryAfterMissingItem: nil, reason: .noneSelected)
		}
		return fallbackBackgroundBlurDecision(canPressOff: canPressOff, fallbackBlurTurnedOn: fallbackBlurTurnedOn, reason: .readableNoSelection)
	}

	return fallbackBackgroundBlurDecision(canPressOff: canPressOff, fallbackBlurTurnedOn: fallbackBlurTurnedOn)
}

func fallbackBackgroundBlurDecision(canPressOff: Bool, fallbackBlurTurnedOn: Bool, reason: BlurDecisionReason? = nil) -> BlurDecision {
	if fallbackBlurTurnedOn {
		return BlurDecision(
			target: "off",
			memoryAfterSuccess: false,
			memoryAfterMissingItem: canPressOff ? nil : false,
			reason: reason ?? (canPressOff ? .fallbackOff : .fallbackOffMissing)
		)
	}
	return BlurDecision(target: "on", memoryAfterSuccess: true, memoryAfterMissingItem: nil, reason: reason ?? .fallbackOn)
}

func stateText(_ state: Bool?) -> String {
	guard let state else { return "unreadable" }
	return state ? "selected" : "not selected"
}

func blurSelectionDescription(
	decision: BlurDecision,
	blurState: Bool?,
	offState: Bool?,
	hasReadableSelection: Bool
) -> String {
	if !hasReadableSelection {
		return "unreadable (\(decision.reason.rawValue))"
	}
	return "blur \(stateText(blurState)), off \(stateText(offState)) (\(decision.reason.rawValue))"
}

/// Opens a menu (e.g. React) and presses the item that appeared whose web id is in `itemIds`,
/// falling back to configured labels. Controls that existed before opening are ignored, so a chat
/// message's "Like" can never match. Background blur passes `toggle` so the choice is made from
/// the open Teams menu's current selected state rather than plugin memory.
func menu(
	_ id: String,
	itemIds: [String],
	labels: [String],
	excludeLabels: [String],
	toggle: [String: Any]? = nil,
	escapeIfNoFreshItems: MenuEscapeIfNoFreshItems = .always,
	req: Any?,
	deadline: Any?
) {
	guard !deadlinePassed(deadline) else { return expired(req) }
	guard AXIsProcessTrusted() else { return result(req, false, "Accessibility permission is off") }
	guard let app = axApp else { return result(req, false, "Teams isn't running") }
	guard let button = element(for: id) else { return result(req, false, "No \(id) on screen") }
	guard ensurePressable(button) else { return result(req, false, "No AXPress action for \(id)") }
	guard !deadlinePassed(deadline) else { return expired(req) }

	let before = controls(in: app)
	let opened = AXUIElementPerformAction(button, kAXPressAction as CFString)
	guard opened == .success else { return result(req, false, "Couldn't open \(id): AXError \(opened.rawValue)") }

	var fresh: [AXUIElement] = []
	let selector = MenuSelector(itemIds: itemIds, labels: labels, excludeLabels: excludeLabels)
	let onSelector = menuSelector(from: toggle?["on"])
	let offSelector = menuSelector(from: toggle?["off"])
	var item: MenuMatch?
	var onItem: MenuMatch?
	var offItem: MenuMatch?
	func refreshFreshItems() {
		fresh = ordered(controls(in: app).filter { candidate in !before.contains { CFEqual($0, candidate) } })
		if toggle != nil {
			onItem = firstMatch(in: fresh, selector: onSelector)
			offItem = firstMatch(in: fresh, selector: offSelector)
		} else {
			item = firstMatch(in: fresh, selector: selector)
		}
	}
	let searchDeadline = Date().addingTimeInterval(1.5)
	while Date() < searchDeadline {
		if deadlinePassed(deadline) {
			closeMenu(app, items: fresh, button: button, escapeIfNoFreshItems: escapeIfNoFreshItems)
			return expired(req)
		}
		Thread.sleep(forTimeInterval: 0.1)
		refreshFreshItems()
		if toggle != nil, onItem != nil || offItem != nil { break }
		if toggle == nil, item != nil { break }
	}
	if deadlinePassed(deadline) {
		closeMenu(app, items: fresh, button: button, escapeIfNoFreshItems: escapeIfNoFreshItems)
		return expired(req)
	}

	if toggle != nil {
		let hasReadableSelection = onItem?.state != nil || offItem?.state != nil
		let decision = chooseBackgroundBlurTarget(
			blurSelected: onItem?.state,
			offSelected: offItem?.state,
			hasReadableSelection: hasReadableSelection,
			canPressOn: onItem != nil,
			canPressOff: offItem != nil,
			fallbackBlurTurnedOn: fallbackBlurTurnedOnMenus.contains(id)
		)
		if decision.target == "off" && offItem == nil {
			Thread.sleep(forTimeInterval: 0.1)
			refreshFreshItems()
		}
		let chosen = decision.target == "off" ? offItem : onItem
		guard let chosen else {
			if let memoryAfterMissingItem = decision.memoryAfterMissingItem {
				if memoryAfterMissingItem {
					fallbackBlurTurnedOnMenus.insert(id)
				} else {
					fallbackBlurTurnedOnMenus.remove(id)
				}
			}
			closeMenu(app, items: fresh, button: button, escapeIfNoFreshItems: escapeIfNoFreshItems)
			let missing = decision.target == "off" ? "'No background effect'" : "Background blur"
			return result(req, false, "No \(missing) item in \(id) menu; it offered: \(offeredDescription(fresh))")
		}
		if deadlinePassed(deadline) {
			closeMenu(app, items: fresh, button: button, escapeIfNoFreshItems: escapeIfNoFreshItems)
			return expired(req)
		}
		let error = AXUIElementPerformAction(chosen.element, kAXPressAction as CFString)
		if error == .success {
			if decision.memoryAfterSuccess {
				fallbackBlurTurnedOnMenus.insert(id)
			} else {
				fallbackBlurTurnedOnMenus.remove(id)
			}
		}
		let pressedLabel = label(chosen.element) ?? domID(chosen.element) ?? "item"
		var extra: [String: Any] = [:]
		if let state = chosen.state { extra["selected"] = state }
		let seen = blurSelectionDescription(
			decision: decision,
			blurState: onItem?.state,
			offState: offItem?.state,
			hasReadableSelection: hasReadableSelection
		)
		result(req, error == .success, error == .success ? "pressed \(pressedLabel); selection: \(seen)" : "AXError \(error.rawValue); selection: \(seen)", extra: extra)
		Thread.sleep(forTimeInterval: 0.3)
		closeMenu(app, items: fresh, button: button, escapeIfNoFreshItems: escapeIfNoFreshItems)
		DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: poll)
		return
	}

	guard let item else {
		closeMenu(app, items: fresh, button: button, escapeIfNoFreshItems: escapeIfNoFreshItems)
		return result(req, false, "No \(itemIds.first ?? labels.first ?? "item") in \(id) menu; it offered: \(offeredDescription(fresh))")
	}
	if deadlinePassed(deadline) {
		closeMenu(app, items: fresh, button: button, escapeIfNoFreshItems: escapeIfNoFreshItems)
		return expired(req)
	}
	let error = AXUIElementPerformAction(item.element, kAXPressAction as CFString)
	let pressedLabel = label(item.element) ?? domID(item.element) ?? "item"
	var extra: [String: Any] = [:]
	if let selected = item.state { extra["selected"] = selected }
	result(req, error == .success, error == .success ? "pressed \(pressedLabel)" : "AXError \(error.rawValue)", extra: extra)
	Thread.sleep(forTimeInterval: 0.3)
	closeMenu(app, items: fresh, button: button, escapeIfNoFreshItems: escapeIfNoFreshItems)
	DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: poll)
}

/// Closes a menu left open. On Teams 26267, pressing React again does NOT close its menu but
/// Escape does, so Escape goes first; pressing the button again is the fallback.
func closeMenu(
	_ app: AXUIElement,
	items: [AXUIElement],
	button: AXUIElement,
	escapeIfNoFreshItems: MenuEscapeIfNoFreshItems = .always
) {
	func escape() {
		for down in [true, false] { CGEvent(keyboardEventSource: nil, virtualKey: 0x35, keyDown: down)?.postToPid(appPID) }
		Thread.sleep(forTimeInterval: 0.3)
	}
	func menuExpanded() -> Bool? {
		boolLike(value(button, kAXExpandedAttribute))
	}
	func stillOpen() -> Bool {
		let now = controls(in: app)
		return items.contains { item in now.contains { CFEqual($0, item) } }
	}
	if items.isEmpty {
		switch escapeIfNoFreshItems {
		case .always:
			escape()
		case .ifExpanded:
			if menuExpanded() == true { escape() }
		}
		return
	}
	guard stillOpen() else { return }
	escape()
	if stillOpen() {
		if ensurePressable(button) {
			AXUIElementPerformAction(button, kAXPressAction as CFString)
			Thread.sleep(forTimeInterval: 0.3)
			log(stillOpen() ? "menu stayed open after Escape and re-press" : "menu closed by re-press (Escape didn't)")
		} else {
			log("menu stayed open after Escape; toolbar button had no AXPress action")
		}
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
		markerIDs = message["markers"] as? [String] ?? []
		indicatorContainerIDs = message["indicatorContainers"] as? [String] ?? []
		bundleIDs = message["bundleIds"] as? [String] ?? bundleIDs
		cache = [:]
		indicatorContainers = [:]
		meetingMarkers = []
		meetingMarkerControlIDs = []
		lastDiscovery = .distantPast
		indicatorFastRediscoverySpent = false
		fallbackBlurTurnedOnMenus.removeAll()
		anchorMissingSince = nil
		lastStatus = ""
		poll()
	case "press":
		press(message["id"] as? String ?? "", req: message["req"], deadline: message["deadline"])
	case "menu":
		menu(
			message["id"] as? String ?? "",
			itemIds: message["itemIds"] as? [String] ?? [],
			labels: message["labels"] as? [String] ?? [],
			excludeLabels: message["excludeLabels"] as? [String] ?? [],
			toggle: message["toggle"] as? [String: Any],
			escapeIfNoFreshItems: MenuEscapeIfNoFreshItems(rawValue: message["escapeIfNoFreshItems"] as? String ?? "") ?? .always,
			req: message["req"],
			deadline: message["deadline"]
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

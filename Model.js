var SYSTEM = "system"
var BUILT_IN = "built-in"
var PROC_MARKER = "#proc"
var FIXED_MARKER = "#fixed"

var LAYOUTS = [
  { id: "qwerty", label: "QWERTY", layout: "us", variant: "" },
  { id: "azerty-be", label: "AZERTY (Belgian)", layout: "be", variant: "" },
  { id: "azerty-fr", label: "AZERTY (French)", layout: "fr", variant: "" },
  { id: "colemak-dh", label: "Colemak-DH", layout: "us", variant: "colemak_dh" },
  { id: "colemak-dh-iso", label: "Colemak-DH ISO", layout: "us", variant: "colemak_dh_iso" },
  { id: "colemak-dh-wide", label: "Colemak-DH Wide", layout: "us", variant: "colemak_dh_wide" },
  { id: "colemak-dh-wide-iso", label: "Colemak-DH Wide ISO", layout: "us", variant: "colemak_dh_wide_iso" },
  { id: "colemak-dh-ortho", label: "Colemak-DH Ortholinear", layout: "us", variant: "colemak_dh_ortho" },
  { id: "dvorak", label: "Dvorak", layout: "us", variant: "dvorak" }
]

// Linux key codes of Q to P, A to L and Z to M.
var LETTER_CODES = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35, 36, 37, 38,
  44, 45, 46, 47, 48, 49, 50]

// The kernel names each interface of a USB keyboard after the keyboard plus
// what the interface is, so stripping the suffix puts a Corne's five devices
// under one name.
var INTERFACES = "keyboard|keypad|mouse|system control|consumer control|wireless radio control"
var LABEL_SUFFIX = new RegExp(" (" + INTERFACES + ")$", "i")
var NAME_SUFFIX = new RegExp("-(" + INTERFACES.replace(/ /g, "-") + ")$")

// Bus numbers from linux/input.h. i8042, I2C, host and SPI only ever carry a
// machine's own keyboard; USB carries both, and the firmware marks a port
// inside the machine as fixed.
var BUILT_IN_BUSES = ["0011", "0018", "0019", "001c"]
var USB_BUS = "0003"

var READ_COMMAND = ["sh", "-c",
  "hyprctl -j devices && printf '\\n" + PROC_MARKER + "\\n' && cat /proc/bus/input/devices"
  + " && printf '\\n" + FIXED_MARKER + "\\n' && grep -lx fixed /sys/bus/usb/devices/*/removable 2>/dev/null"]

function layoutById(id) {
  for (var i = 0; i < LAYOUTS.length; i++) {
    if (LAYOUTS[i].id === id) return LAYOUTS[i]
  }
  return null
}

function idFor(layout, variant) {
  for (var i = 0; i < LAYOUTS.length; i++) {
    if (LAYOUTS[i].layout === layout && LAYOUTS[i].variant === (variant || "")) return LAYOUTS[i].id
  }
  return null
}

function labelFor(id) {
  var entry = layoutById(id)
  return entry ? entry.label : "Hyprland's layout"
}

function options(allowSystem) {
  var list = LAYOUTS.map(function (l) { return { value: l.id, label: l.label } })
  return allowSystem ? [{ value: SYSTEM, label: labelFor(SYSTEM) }].concat(list) : list
}

function stepLayout(id, step, allowSystem) {
  var ids = options(allowSystem).map(function (o) { return o.value })
  var i = ids.indexOf(id)
  if (i === -1) return step > 0 ? ids[0] : ids[ids.length - 1]
  return ids[(i + step + ids.length) % ids.length]
}

function findLayout(query, allowSystem) {
  var q = String(query || "").toLowerCase()
  var list = options(allowSystem)
  for (var i = 0; i < list.length; i++) {
    if (list[i].value === q || list[i].label.toLowerCase() === q) return list[i].value
  }
  return null
}

function hyprlandName(name) {
  return String(name).toLowerCase().replace(/[ \n]/g, "-")
}

// Hyprland also appends -1, -2 to a name it already has.
function groupKey(name) {
  return String(name).replace(/-\d+$/, "").replace(NAME_SUFFIX, "")
}

// B: KEY= is a bitmap of the keys a device can send, in hex words with the
// highest first, so every letter is in the last word. Thirteen hex digits are
// 52 bits, which a double holds exactly.
function hasLetters(keyLine) {
  var words = String(keyLine || "").trim().split(/\s+/)
  var low = parseInt(words[words.length - 1].slice(-13), 16)
  if (!isFinite(low)) return false
  return LETTER_CODES.every(function (code) { return Math.floor(low / Math.pow(2, code)) % 2 === 1 })
}

// The port a USB input sits on is the last path segment named like 1-4 or
// 1-2.1. A keyboard behind a hub in the machine is still on its own port, and
// a Bluetooth keyboard is not on the adapter's.
function isBuiltIn(block, fixed) {
  var bus = (block.match(/^I: Bus=(\w+)/m) || [])[1]
  if (bus !== USB_BUS) return BUILT_IN_BUSES.indexOf(bus) !== -1
  var sysfs = (block.match(/^S: Sysfs=(.*)$/m) || [])[1] || ""
  var port = sysfs.split("/").filter(function (part) { return /^\d+-[\d.]+$/.test(part) }).pop()
  return fixed.indexOf(port) !== -1
}

// Hyprland lists power buttons, lid switches and a mouse's media keys as
// keyboards. The kernel knows which devices can type a letter.
function parseProc(text, fixed) {
  var devices = Object.create(null)
  String(text || "").split(/\n\s*\n/).forEach(function (block) {
    var name = block.match(/^N: Name="(.*)"$/m)
    if (!name) return
    var keys = block.match(/^B: KEY=(.*)$/m)
    var key = hyprlandName(name[1])
    var known = devices[key]
    devices[key] = {
      label: name[1].replace(LABEL_SUFFIX, ""),
      typing: (!!keys && hasLetters(keys[1])) || (!!known && known.typing),
      builtIn: isBuiltIn(block, fixed || []) || (!!known && known.builtIn)
    }
  })
  return devices
}

function parseReading(text) {
  var raw = String(text || "")
  var at = raw.indexOf("\n" + PROC_MARKER + "\n")
  if (at === -1) return null
  var devices
  try {
    devices = JSON.parse(raw.slice(0, at))
  } catch (e) {
    return null
  }
  if (!devices || !Array.isArray(devices.keyboards)) return null
  var rest = raw.slice(at + PROC_MARKER.length + 2)
  var cut = rest.indexOf("\n" + FIXED_MARKER + "\n")
  var fixed = cut === -1 ? [] : rest.slice(cut).match(/[^\/\n]+(?=\/removable$)/gm) || []
  return { keyboards: devices.keyboards, proc: parseProc(cut === -1 ? rest : rest.slice(0, cut), fixed) }
}

function copyKeyboards(keyboards) {
  var copy = Object.create(null)
  for (var key in keyboards) copy[key] = keyboards[key]
  return copy
}

function withKeyboard(state, key, id) {
  var keyboards = copyKeyboards(state.keyboards)
  keyboards[key] = id
  return { newKeyboards: state.newKeyboards, keyboards: keyboards }
}

function typedLayout(devices) {
  var ids = devices.map(function (kb) { return idFor(kb.layout, kb.variant) })
  return ids.every(function (id) { return id !== null && id === ids[0] }) ? ids[0] : SYSTEM
}

// A keyboard is pinned the first time it is seen: to the new keyboard layout
// when there is one, otherwise to whatever it already types, so changing the
// new keyboard layout later never moves a keyboard that is already set up.
//
// attempted maps a device address to the layout last sent to it. A layout
// Hyprland did not take is not sent again until the device comes back with a
// new address, which is what stops a bad variant from looping.
function plan(keyboards, proc, state, attempted) {
  var byKey = Object.create(null)
  var order = []
  ;(keyboards || []).forEach(function (kb) {
    var name = String(kb.name || "")
    var info = proc[name] || proc[name.replace(/-\d+$/, "")]
    var key = groupKey(name)
    var group = byKey[key]
    if (!group) {
      group = byKey[key] = { key: key, label: "", devices: [], typing: [], builtIn: false }
      order.push(group)
    }
    group.devices.push(kb)
    if (info && info.typing) {
      if (group.typing.length === 0) group.label = info.label
      group.typing.push(kb)
      group.builtIn = group.builtIn || info.builtIn
    }
  })

  // A laptop can type through a different controller than the one it looks
  // like it has, so every keyboard inside the machine is the one row.
  var builtIn = { key: BUILT_IN, label: "Built-in keyboard", devices: [], typing: [] }
  order = order.filter(function (group) {
    if (!group.builtIn) return true
    builtIn.devices = builtIn.devices.concat(group.devices)
    builtIn.typing = builtIn.typing.concat(group.typing)
    return false
  })
  if (builtIn.typing.length > 0) order.push(builtIn)

  var pinned = copyKeyboards(state.keyboards)
  var stateChanged = false
  var groups = []
  var changes = []
  var nextAttempted = {}

  order.forEach(function (group) {
    if (group.typing.length === 0) return
    var id = pinned[group.key]
    if (id === undefined) {
      id = state.newKeyboards !== SYSTEM ? state.newKeyboards : typedLayout(group.typing)
      pinned[group.key] = id
      stateChanged = true
    }
    groups.push({ key: group.key, label: group.label, id: id, keymap: String(group.typing[0].active_keymap || "") })

    var target = layoutById(id)
    if (!target) return
    var want = target.layout + ":" + target.variant
    group.devices.forEach(function (kb) {
      if (kb.layout + ":" + (kb.variant || "") === want) return
      nextAttempted[kb.address] = want
      if (attempted[kb.address] !== want) {
        changes.push({ name: String(kb.name), layout: target.layout, variant: target.variant })
      }
    })
  })

  groups.sort(function (a, b) {
    if ((a.key === BUILT_IN) !== (b.key === BUILT_IN)) return a.key === BUILT_IN ? -1 : 1
    return a.label.localeCompare(b.label)
  })

  return {
    groups: groups,
    changes: changes,
    attempted: nextAttempted,
    state: stateChanged ? { newKeyboards: state.newKeyboards, keyboards: pinned } : null
  }
}

// JSON string syntax is Lua's apart from \u escapes, which JSON only writes
// for control characters. Those fail to parse rather than end the string, so a
// device name cannot turn into code.
function luaFor(changes) {
  return changes.map(function (c) {
    return "hl.device({ name = " + JSON.stringify(c.name) + ", kb_layout = " + JSON.stringify(c.layout)
      + ", kb_variant = " + JSON.stringify(c.variant) + " })"
  }).join("; ")
}

function findKeyboard(groups, query) {
  var q = String(query || "").toLowerCase()
  if (q === "") return { error: "name a keyboard" }
  var hits = groups.filter(function (g) { return g.key === q || g.label.toLowerCase() === q })
  if (hits.length === 0) {
    hits = groups.filter(function (g) {
      return g.key.indexOf(q) !== -1 || g.label.toLowerCase().indexOf(q) !== -1
    })
  }
  if (hits.length === 1) return { key: hits[0].key, label: hits[0].label }
  if (hits.length === 0) return { error: "no connected keyboard matches " + query }
  return { error: query + " matches " + hits.map(function (g) { return g.label }).join(", ") }
}

function currentLabel(group) {
  return group.id === SYSTEM ? group.keymap : labelFor(group.id)
}

function summary(groups, newKeyboards) {
  return groups.map(function (g) { return g.label + ": " + currentLabel(g) })
    .concat(["New keyboards: " + labelFor(newKeyboards)])
    .join("\n")
}

function parseState(raw) {
  var data = null
  try {
    data = JSON.parse(raw)
  } catch (e) {
  }
  var state = { newKeyboards: SYSTEM, keyboards: Object.create(null) }
  if (!data || typeof data !== "object") return state
  if (layoutById(data.newKeyboards)) state.newKeyboards = data.newKeyboards
  var stored = data.keyboards && typeof data.keyboards === "object" ? data.keyboards : {}
  for (var key in stored) {
    if (stored[key] === SYSTEM || layoutById(stored[key])) state.keyboards[key] = stored[key]
  }
  return state
}

function serializeState(state) {
  var keyboards = Object.create(null)
  Object.keys(state.keyboards).sort().forEach(function (key) { keyboards[key] = state.keyboards[key] })
  return JSON.stringify({ version: 1, newKeyboards: state.newKeyboards, keyboards: keyboards }, null, 2) + "\n"
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SYSTEM: SYSTEM,
    LAYOUTS: LAYOUTS,
    READ_COMMAND: READ_COMMAND,
    layoutById: layoutById,
    idFor: idFor,
    labelFor: labelFor,
    options: options,
    stepLayout: stepLayout,
    findLayout: findLayout,
    hyprlandName: hyprlandName,
    groupKey: groupKey,
    parseProc: parseProc,
    parseReading: parseReading,
    withKeyboard: withKeyboard,
    plan: plan,
    luaFor: luaFor,
    findKeyboard: findKeyboard,
    currentLabel: currentLabel,
    summary: summary,
    parseState: parseState,
    serializeState: serializeState
  }
}

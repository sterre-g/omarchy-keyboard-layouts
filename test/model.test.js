const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const M = require("../Model.js")

const fixture = name => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
const devicesJson = fixture("devices.json")
const procText = fixture("proc-devices.txt")
const devices = JSON.parse(devicesJson).keyboards
// The USB ports the Legion that took the fixtures calls fixed: its two ITE
// keyboard controllers.
const FIXED = ["1-4", "3-3"]
const proc = M.parseProc(procText, FIXED)

const CORNE = [
  "keebart-corne_choc_pro",
  "keebart-corne_choc_pro-consumer-control",
  "keebart-corne_choc_pro-keyboard",
  "keebart-corne_choc_pro-mouse",
  "keebart-corne_choc_pro-system-control",
]

function stateWith(newKeyboards, keyboards) {
  return M.parseState(JSON.stringify({ newKeyboards, keyboards }))
}

function run(name, fn) {
  fn()
  process.stdout.write("ok - " + name + "\n")
}

run("only devices that can type every letter count as keyboards", () => {
  const typing = Object.keys(proc).filter(key => proc[key].typing).sort()
  assert.deepEqual(typing, [
    "at-translated-set-2-keyboard",
    "ite-tech.-inc.-ite-device(8295)-keyboard",
    "ite-tech.-inc.-ite-device(8910)-keyboard",
    "keebart-corne_choc_pro",
    "keebart-corne_choc_pro-keyboard",
    "logitech-g305",
  ])
  assert.equal(proc["keebart-corne_choc_pro-keyboard"].label, "Keebart corne_choc_pro")
})

run("the interfaces of one keyboard share one name", () => {
  for (const name of CORNE) assert.equal(M.groupKey(name), "keebart-corne_choc_pro")
  assert.equal(M.groupKey("at-translated-set-2-keyboard"), "at-translated-set-2")
  assert.equal(M.groupKey("power-button-1"), "power-button")
  assert.equal(M.groupKey("chicony-hp-elite-usb-keyboard-1"), "chicony-hp-elite-usb")
  assert.equal(M.groupKey("ite-tech.-inc.-ite-device(8910)-wireless-radio-control"), "ite-tech.-inc.-ite-device(8910)")
})

run("only a keyboard inside the machine counts as built in", () => {
  const builtIn = Object.keys(proc).filter(key => proc[key].typing && proc[key].builtIn).sort()
  assert.deepEqual(builtIn, [
    "at-translated-set-2-keyboard",
    "ite-tech.-inc.-ite-device(8295)-keyboard",
    "ite-tech.-inc.-ite-device(8910)-keyboard",
  ])
  assert.equal(M.parseProc(procText, ["1-2"])["logitech-g305"].builtIn, false)
  const bluetooth = [
    "I: Bus=0005 Vendor=046d Product=b342 Version=0001",
    'N: Name="BT Keyboard"',
    "S: Sysfs=/devices/pci0000:00/0000:00:08.1/0000:05:00.3/usb1/1-3/1-3:1.0/bluetooth/hci0/hci0:256/0005:046D:B342.0005/input/input30",
  ].join("\n")
  assert.equal(M.parseProc(bluetooth, ["1-3"])["bt-keyboard"].builtIn, false)
})

run("a first reading keeps every keyboard on the layout it already has", () => {
  const out = M.plan(devices, proc, M.parseState(""), {})
  assert.deepEqual(out.changes, [])
  assert.deepEqual(out.groups.map(g => [g.label, g.id]), [
    ["Built-in keyboard", "system"],
    ["Keebart corne_choc_pro", "qwerty"],
    ["Logitech G305", "qwerty"],
  ])
  assert.equal(out.state.keyboards["keebart-corne_choc_pro"], "qwerty")
  assert.equal(M.plan(devices, proc, out.state, {}).state, null)
})

run("a keyboard seen for the first time gets the new keyboard layout", () => {
  const state = stateWith("colemak-dh-wide-iso", { "keebart-corne_choc_pro": "qwerty" })
  const out = M.plan(devices, proc, state, {})
  assert.deepEqual(out.changes.map(c => c.name).sort(), [
    "ite-tech.-inc.-ite-device(8295)-keyboard",
    "ite-tech.-inc.-ite-device(8910)-keyboard",
    "ite-tech.-inc.-ite-device(8910)-wireless-radio-control",
    "logitech-g305",
  ])
  assert.ok(out.changes.every(c => c.layout === "us" && c.variant === "colemak_dh_wide_iso"))
  assert.equal(out.state.keyboards["built-in"], "colemak-dh-wide-iso")
  assert.equal(out.state.keyboards["logitech-g305"], "colemak-dh-wide-iso")
  assert.equal(out.state.keyboards["keebart-corne_choc_pro"], "qwerty")
})

run("buttons and virtual keyboards are left alone", () => {
  const out = M.plan(devices, proc, stateWith("dvorak", {}), {})
  const touched = out.changes.map(c => c.name)
  for (const name of ["power-button", "power-button-1", "video-bus", "video-bus-1", "ideapad-extra-buttons", "hl-virtual-keyboard-fcitx5"]) {
    assert.ok(!touched.includes(name), name + " was given a layout")
  }
  assert.ok(!("power-button" in out.state.keyboards))
})

run("every interface of a keyboard switches together", () => {
  const out = M.plan(devices, proc, stateWith("system", { "keebart-corne_choc_pro": "dvorak" }), {})
  const corne = out.changes.filter(c => c.name.startsWith("keebart"))
  assert.deepEqual(corne.map(c => c.name).sort(), CORNE)
  assert.ok(corne.every(c => c.variant === "dvorak"))
})

run("a layout Hyprland did not take is not sent again until the device reconnects", () => {
  const state = stateWith("system", { "keebart-corne_choc_pro": "dvorak" })
  const first = M.plan(devices, proc, state, {})
  assert.equal(first.changes.length, 5)

  const again = M.plan(devices, proc, state, first.attempted)
  assert.deepEqual(again.changes, [])

  const replugged = devices.map(d => d.name === "keebart-corne_choc_pro" ? { ...d, address: "0xfresh" } : d)
  const after = M.plan(replugged, proc, state, first.attempted)
  assert.deepEqual(after.changes.map(c => c.name), ["keebart-corne_choc_pro"])
})

run("a layout that took is forgotten, so a later change is sent", () => {
  const state = stateWith("system", { "keebart-corne_choc_pro": "dvorak" })
  const first = M.plan(devices, proc, state, {})
  const applied = devices.map(d => d.name.startsWith("keebart") ? { ...d, variant: "dvorak" } : d)
  const settled = M.plan(applied, proc, state, first.attempted)
  assert.deepEqual(settled.attempted, {})
})

run("a device name is written into Lua as a string, never as code", () => {
  const code = M.luaFor([{ name: 'evil"}) os.exit() --\\', layout: "us", variant: "" }])
  assert.equal(code, 'hl.device({ name = "evil\\"}) os.exit() --\\\\", kb_layout = "us", kb_variant = "" })')
  assert.equal(M.luaFor([
    { name: "a", layout: "us", variant: "dvorak" },
    { name: "b", layout: "be", variant: "" },
  ]), 'hl.device({ name = "a", kb_layout = "us", kb_variant = "dvorak" }); hl.device({ name = "b", kb_layout = "be", kb_variant = "" })')
})

run("the reading splits hyprctl from /proc", () => {
  const reading = M.parseReading(devicesJson + "\n#proc\n" + procText)
  assert.equal(reading.keyboards.length, devices.length)
  assert.equal(reading.proc["keebart-corne_choc_pro"].typing, true)
  assert.equal(M.parseReading("not json\n#proc\n" + procText), null)
  assert.equal(M.parseReading(devicesJson), null)

  const ite = "ite-tech.-inc.-ite-device(8910)-keyboard"
  assert.equal(reading.proc[ite].builtIn, false)
  const fixed = M.parseReading(devicesJson + "\n#proc\n" + procText + "\n\n#fixed\n/sys/bus/usb/devices/1-4/removable\n")
  assert.equal(fixed.proc[ite].builtIn, true)
  assert.equal(fixed.proc["logitech-g305"].builtIn, false)
})

run("the state file survives garbage and drops what it does not know", () => {
  assert.deepEqual({ ...M.parseState("{").keyboards }, {})
  assert.equal(M.parseState("null").newKeyboards, "system")
  const state = M.parseState(
    '{"newKeyboards":"klingon","keyboards":{"a":"dvorak","b":"klingon","c":"system","__proto__":"qwerty"}}')
  assert.equal(state.newKeyboards, "system")
  assert.deepEqual(Object.keys(state.keyboards).sort(), ["__proto__", "a", "c"])
  assert.equal(Object.getPrototypeOf(state.keyboards), null)

  const round = M.parseState(M.serializeState(state))
  assert.equal(round.keyboards["__proto__"], "qwerty")
  assert.equal(round.keyboards.a, "dvorak")

  const moved = M.withKeyboard(round, "a", "qwerty")
  assert.equal(moved.keyboards.a, "qwerty")
  assert.equal(round.keyboards.a, "dvorak")
})

run("keyboards and layouts can be named loosely", () => {
  const { groups } = M.plan(devices, proc, M.parseState(""), {})
  assert.equal(M.findKeyboard(groups, "corne").key, "keebart-corne_choc_pro")
  assert.equal(M.findKeyboard(groups, "Built-in").key, "built-in")
  assert.match(M.findKeyboard(groups, "e").error, /matches Built-in keyboard, Keebart/)
  assert.match(M.findKeyboard(groups, "hp elite").error, /no connected keyboard/)

  assert.equal(M.findLayout("Colemak-DH Wide ISO"), "colemak-dh-wide-iso")
  assert.equal(M.findLayout("dvorak"), "dvorak")
  assert.equal(M.findLayout("system"), null)
  assert.equal(M.findLayout("system", true), "system")
})

run("stepping through layouts wraps at both ends", () => {
  assert.equal(M.stepLayout("qwerty", 1, false), "azerty-be")
  assert.equal(M.stepLayout("dvorak", 1, false), "qwerty")
  assert.equal(M.stepLayout("qwerty", -1, false), "dvorak")
  assert.equal(M.stepLayout("system", 1, false), "qwerty")
  assert.equal(M.stepLayout("dvorak", 1, true), "system")
})

run("every layout on offer exists in xkeyboard-config", () => {
  const rules = "/usr/share/X11/xkb/rules/evdev.lst"
  if (!fs.existsSync(rules)) return
  const lst = fs.readFileSync(rules, "utf8")
  for (const l of M.LAYOUTS) {
    const line = l.variant === ""
      ? new RegExp("^\\s+" + l.layout + "\\s", "m")
      : new RegExp("^\\s+" + l.variant + "\\s+" + l.layout + ":", "m")
    assert.match(lst, line, l.id + " is not a layout xkb knows")
  }
})

import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import "Model.js" as Model

Item {
  id: root

  property string omarchyPath: ""
  property var shell: null
  property var manifest: null

  readonly property string statePath: (Quickshell.env("HOME") || "") + "/.local/state/omarchy/sterre-keyboard-layouts.json"
  property var state: Model.parseState("")
  property bool stateLoaded: false
  property var groups: []
  property var attempted: ({})
  property bool readAgain: false

  readonly property string newKeyboards: root.state.newKeyboards
  readonly property string summary: Model.summary(root.groups, root.newKeyboards)

  property var widgets: []

  function registerWidget(widget) {
    if (!widget || root.widgets.indexOf(widget) !== -1) return
    root.widgets = root.widgets.concat([widget])
  }

  function unregisterWidget(widget) {
    root.widgets = root.widgets.filter(function (w) { return w !== widget })
  }

  function focusedWidget() {
    for (var i = 0; i < root.widgets.length; i++) {
      if (root.widgets[i] && root.widgets[i].onFocusedScreen === true) return root.widgets[i]
    }
    return root.widgets.length > 0 ? root.widgets[0] : null
  }

  function refresh() {
    if (!root.stateLoaded) return
    if (reader.running) {
      root.readAgain = true
      return
    }
    reader.running = true
  }

  function adopt(text) {
    var reading = Model.parseReading(text)
    if (!reading) return
    var result = Model.plan(reading.keyboards, reading.proc, root.state, root.attempted)
    root.attempted = result.attempted
    // Rebuilding the panel's rows closes a dropdown someone has open, so only
    // hand over a list that says something new.
    if (JSON.stringify(result.groups) !== JSON.stringify(root.groups)) root.groups = result.groups
    if (result.state) root.save(result.state)
    if (result.changes.length > 0) Quickshell.execDetached(["hyprctl", "eval", Model.luaFor(result.changes)])
  }

  function save(next) {
    root.state = next
    stateFile.setText(Model.serializeState(next))
  }

  function assign(key, id) {
    if (!root.stateLoaded || !Model.layoutById(id) || root.state.keyboards[key] === id) return
    root.save(Model.withKeyboard(root.state, key, id))
    root.refresh()
  }

  function setNewKeyboards(id) {
    if (!root.stateLoaded || (id !== Model.SYSTEM && !Model.layoutById(id)) || id === root.newKeyboards) return
    root.save({ newKeyboards: id, keyboards: root.state.keyboards })
  }

  function begin(raw) {
    if (root.stateLoaded) return
    root.state = Model.parseState(raw)
    root.stateLoaded = true
    root.refresh()
  }

  FileView {
    id: stateFile
    path: root.statePath
    atomicWrites: true
    printErrors: false
    onLoaded: root.begin(text())
    onLoadFailed: root.begin("")
  }

  Process {
    id: reader
    command: Model.READ_COMMAND
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.adopt(text)
    }
    onRunningChanged: {
      if (reader.running) {
        deadline.restart()
        return
      }
      deadline.stop()
      if (root.readAgain) {
        root.readAgain = false
        root.refresh()
      }
    }
  }

  // A hyprctl that never answers would keep the reader running, and a running
  // Process cannot be started again, so nothing after it would be read.
  Timer {
    id: deadline
    interval: 5000
    onTriggered: reader.signal(15)
  }

  Timer {
    id: settle
    interval: 250
    onTriggered: root.refresh()
  }

  // Hyprland announces no new device, but it gives every keyboard its layout
  // as it arrives and reports that as activelayout, as it does for a layout
  // sent from here. fcitx5's virtual keyboard raises one on every focus
  // change, and nothing here ever sets its layout. A reload may put back
  // what was sent, so it is sent again.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      var name = String(event.name)
      if (name === "configreloaded") {
        root.attempted = ({})
        settle.restart()
      } else if (name === "activelayout" && String(event.data).indexOf("hl-virtual-keyboard") !== 0) {
        settle.restart()
      }
    }
  }

  IpcHandler {
    target: "sterre.keyboard-layouts"

    function open(): void {
      var widget = root.focusedWidget()
      if (widget) widget.open()
    }
    function close(): void {
      root.widgets.forEach(function (w) { w.close() })
    }
    function toggle(): void {
      var widget = root.focusedWidget()
      if (widget) widget.toggle()
    }
    function status(): string {
      return root.summary
    }
    function layouts(): string {
      return Model.options(true).map(function (o) { return o.value + "  " + o.label }).join("\n")
    }
    function set(keyboard: string, layout: string): string {
      var found = Model.findKeyboard(root.groups, keyboard)
      if (found.error) return found.error
      var id = Model.findLayout(layout, false)
      if (!id) return "no layout called " + layout + ", see layouts"
      root.assign(found.key, id)
      return found.label + ": " + Model.labelFor(id)
    }
    function newKeyboards(layout: string): string {
      var id = Model.findLayout(layout, true)
      if (!id) return "no layout called " + layout + ", see layouts"
      root.setNewKeyboards(id)
      return "New keyboards: " + Model.labelFor(id)
    }
  }
}

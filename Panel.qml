import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Hyprland
import qs.Commons
import qs.Ui
import "Model.js" as Model

Panel {
  id: root
  moduleName: "sterre.keyboard-layouts"
  manageIpc: false

  // Each monitor has its own copy of this widget, so the service owns the
  // state and the talking to Hyprland. Resolved by assignment rather than a
  // binding: ensureService() writes the shell state serviceFor() reads.
  property var service: null
  readonly property var groups: root.service ? root.service.groups : []
  readonly property string newKeyboards: root.service ? root.service.newKeyboards : Model.SYSTEM
  readonly property int rowCount: root.groups.length + 1

  property int cursorIndex: 0
  property bool cursorActive: false
  property int openPopups: 0

  readonly property string screenName: root.QsWindow.window && root.QsWindow.window.screen
    ? root.QsWindow.window.screen.name
    : ""
  readonly property bool onFocusedScreen: Hyprland.focusedMonitor && root.screenName !== ""
    ? Hyprland.focusedMonitor.name === root.screenName
    : false

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function resolveService() {
    if (root.service || !root.bar || !root.bar.shell) return
    var shell = root.bar.shell
    var found = typeof shell.serviceFor === "function" ? shell.serviceFor(root.moduleName) : null
    if (!found && typeof shell.ensureService === "function") found = shell.ensureService(root.moduleName)
    if (!found) return
    root.service = found
    root.service.registerWidget(root)
  }

  function dropdownAt(index) {
    return index < root.groups.length ? rows.itemAt(index) : newKeyboardsDropdown
  }

  function step(direction) {
    if (!root.service) return
    if (root.cursorIndex < root.groups.length) {
      var group = root.groups[root.cursorIndex]
      root.service.assign(group.key, Model.stepLayout(group.id, direction, false))
    } else {
      root.service.setNewKeyboards(Model.stepLayout(root.newKeyboards, direction, true))
    }
  }

  // The first key only shows where the cursor is, so opening the panel and
  // pressing l cannot change a layout nobody was looking at.
  function moveCursor(dx, dy) {
    if (!root.cursorActive) {
      root.cursorActive = true
      return
    }
    if (dx !== 0) root.step(dx)
    else root.cursorIndex = Math.max(0, Math.min(root.rowCount - 1, root.cursorIndex + dy))
  }

  function openAtCursor() {
    if (!root.cursorActive) {
      root.cursorActive = true
      return
    }
    var dropdown = root.dropdownAt(root.cursorIndex)
    if (dropdown) dropdown.open()
  }

  function popupToggled(isOpen) {
    root.openPopups = Math.max(0, root.openPopups + (isOpen ? 1 : -1))
    if (!isOpen) keyCatcher.forceActiveFocus()
  }

  onBarChanged: root.resolveService()
  Component.onCompleted: root.resolveService()
  Component.onDestruction: if (root.service) root.service.unregisterWidget(root)

  // A row that is rebuilt with its dropdown open never reports it closing.
  onGroupsChanged: {
    root.openPopups = newKeyboardsDropdown.popupOpen ? 1 : 0
    root.cursorIndex = Math.min(root.cursorIndex, root.rowCount - 1)
  }

  // Picking from the dropdown replaces its value binding with the pick.
  onNewKeyboardsChanged: newKeyboardsDropdown.value = root.newKeyboards

  onOpenedChanged: {
    if (!opened) {
      root.cursorActive = false
      return
    }
    if (root.service) root.service.refresh()
    Qt.callLater(function () { keyCatcher.forceActiveFocus() })
  }

  // The service is created lazily by the shell, so a widget built first has to
  // look again rather than give up.
  Timer {
    interval: 250
    repeat: true
    running: root.service === null
    triggeredOnStart: true
    onTriggered: root.resolveService()
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰌓"
    tooltipText: root.service ? root.service.summary : "Keyboard layouts"
    onPressed: function (buttonCode) { root.toggle() }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.openPopups > 0
      onCloseRequested: root.close()
      onTabRequested: function (direction) { root.switchPanel(direction) }
      onMoveRequested: function (dx, dy) { root.moveCursor(dx, dy) }
      onActivateRequested: root.openAtCursor()

      Flickable {
        id: flick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: flick.width
          spacing: Style.space(10)

          PanelSectionHeader {
            width: parent.width
            text: "Keyboard layouts"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Text {
            width: parent.width
            visible: root.groups.length === 0
            text: root.service ? "Looking for keyboards" : "Waiting for the layout service"
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            color: root.dim
            wrapMode: Text.WordWrap
          }

          Repeater {
            id: rows
            model: root.groups

            Dropdown {
              required property var modelData
              required property int index

              width: column.width
              label: modelData.label
              value: modelData.id === Model.SYSTEM ? modelData.keymap : modelData.id
              options: Model.options(false)
              hasCursor: root.cursorActive && root.cursorIndex === index
              fontFamily: root.fontFamily
              onChanged: function (value) { if (root.service) root.service.assign(modelData.key, value) }
              onHovered: function (isHovered) {
                if (!isHovered) return
                root.cursorActive = true
                root.cursorIndex = index
              }
              onPopupOpenChanged: root.popupToggled(popupOpen)
            }
          }

          PanelSeparator {
            width: parent.width
            foreground: root.foreground
          }

          Dropdown {
            id: newKeyboardsDropdown
            width: column.width
            label: "New keyboards"
            value: root.newKeyboards
            options: Model.options(true)
            hasCursor: root.cursorActive && root.cursorIndex === root.groups.length
            fontFamily: root.fontFamily
            onChanged: function (value) { if (root.service) root.service.setNewKeyboards(value) }
            onHovered: function (isHovered) {
              if (!isHovered) return
              root.cursorActive = true
              root.cursorIndex = root.groups.length
            }
            onPopupOpenChanged: root.popupToggled(popupOpen)
          }

          Text {
            width: parent.width
            text: "A keyboard keeps the layout you give it. One you have not plugged in before gets the new keyboard layout."
              + "\nj/k move, h/l change the layout, Enter opens the list"
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            color: root.dim
            wrapMode: Text.WordWrap
          }
        }
      }
    }
  }
}

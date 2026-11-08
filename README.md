# omarchy-keyboard-layouts

A layout per keyboard for the Omarchy shell. The laptop can type Colemak-DH
while the split keyboard on the desk types QWERTY, and a keyboard you have
never plugged in before gets the layout you picked for new keyboards.

The layouts on offer are QWERTY, AZERTY (Belgian and French), all five
Colemak-DH variants xkeyboard-config ships (ANSI, ISO, Wide, Wide ISO and
Ortholinear) and Dvorak.

## Install

Needs Omarchy 4.5 or newer.

```sh
omarchy plugin add https://github.com/sterre-g/omarchy-keyboard-layouts.git --enable
omarchy plugin enable sterre.keyboard-layouts --section right
```

Nothing changes when it starts: every keyboard that is plugged in keeps the
layout it already has, and new keyboards are left to your Hyprland config until
you pick a layout for them.

## Using it

Click the keyboard icon on the bar. Each keyboard that is plugged in has a row
with its layout, and picking another switches it straight away. The last row,
New keyboards, is the layout a keyboard gets the first time it is plugged in.
From then on it keeps its own, so changing that row never moves a keyboard you
have already set up.

In the panel, `j` and `k` move between keyboards, `h` and `l` step through the
layouts, and Enter opens the list.

```sh
omarchy-shell sterre.keyboard-layouts status
omarchy-shell sterre.keyboard-layouts set corne qwerty
omarchy-shell sterre.keyboard-layouts set built-in colemak-dh-wide-iso
omarchy-shell sterre.keyboard-layouts newKeyboards colemak-dh-wide-iso
omarchy-shell sterre.keyboard-layouts layouts
omarchy-shell sterre.keyboard-layouts toggle
```

`set` takes any part of a keyboard's name, as long as only one plugged-in
keyboard matches it. `newKeyboards system` hands new keyboards back to your
Hyprland config. To open the panel from a key, bind the last command, for
example in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + ALT + L", "Keyboard layouts", "omarchy-shell sterre.keyboard-layouts toggle")
```

## Keyboards with a layout in their firmware

A keyboard that already does Colemak or another layout in its own firmware, a
Corne running QMK, Vial or ZMK for example, sends the key codes of a QWERTY
board and wants QWERTY here. Giving it Colemak as well translates every key
twice.

## What counts as a keyboard

Hyprland lists power buttons, lid switches and the media keys of a mouse as
keyboards too. The plugin only shows a device that `/proc/bus/input/devices`
says can type every letter, and it treats the parts the kernel splits one USB
keyboard into (`Keyboard`, `Mouse`, `System Control`, `Consumer Control`) as
one keyboard, so a Corne is one row and all of its parts switch together.
Virtual keyboards, like the one fcitx5 types through, are never touched.

Every keyboard inside the machine is one row, Built-in keyboard: one on the
PS/2, I2C, SPI or host bus, or a USB one on a port the firmware marks as fixed
in `/sys/bus/usb/devices/*/removable`. A laptop does not always type through
the keyboard it looks like it has. A Lenovo Legion 5 Pro has a PS/2 keyboard
that sends nothing and types through a USB controller from ITE, so the row
switches all of them.

A keyboard first seen on a layout that is not in the list above, or on more
than one layout, is left as Hyprland has it until you pick one.

## How it works

[Service.qml](Service.qml) reads `hyprctl -j devices`, `/proc/bus/input/devices`
and which USB ports are fixed, and for each device whose layout differs from the
one it should have, sends

```lua
hl.device({ name = "keebart-corne_choc_pro", kb_layout = "us", kb_variant = "" })
```

through `hyprctl eval`. Hyprland reports `activelayout` for every keyboard as it
is plugged in, and for every keyboard a config reload changes, so those two
events are when it reads again. A layout Hyprland does not take is not sent to
the same device twice.

[Model.js](Model.js) holds the layout list, the parsing and the decisions, and
[Panel.qml](Panel.qml) is the bar widget. What you picked is kept in
`~/.local/state/omarchy/sterre-keyboard-layouts.json`.

Limits:

- These layouts live in the running Hyprland, not in your config. Until the
  shell has started after a login, a keyboard has whatever your Hyprland config
  gives it.
- Hyprland matches keybindings against the global `input.kb_layout`, whatever
  layout a keyboard has of its own, so `Super` shortcuts stay where the global
  layout puts them.
- Only keyboards that are plugged in are listed. Plug one in to change it.

## Development

```sh
./run-tests       # node, lua, omarchy plugin validate, Qt 6 qmllint
./dev-sync
omarchy-shell shell rescanPlugins
```

[test/model.test.js](test/model.test.js) runs against `hyprctl -j devices` and
`/proc/bus/input/devices` captured on a laptop with a Corne plugged in, and
[test/escape.test.lua](test/escape.test.lua) runs the generated Lua through a Lua
interpreter to check that a device name cannot become code in `hyprctl eval`.

## License

MIT, see [LICENSE](LICENSE).

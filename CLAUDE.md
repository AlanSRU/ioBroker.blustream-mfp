# CLAUDE.md — Blustream MFP Presentation Switcher Adapter

> **Maintenance:** Update this file as changes are made during each session. Do not wait until end of session.

## Overview

ioBroker adapter for Blustream multi-format presentation switchers (MFP62/MFP72/MFP112/AMF42AU/WMF51/WMF72) and Contractor HDBaseT matrices (C66/C88). Controls output routing, audio, microphone, CEC, presets, WiFi, and network settings.

Model definitions carry an `isMatrix` flag (C66/C88) that switches matrix-specific behaviour: per-output PoC (`POCOUT xx ON/OFF`), an `output.allSource` control that routes every output at once (`OUT 00 FR yy`), and no splitter/matrix `output.mode` toggle. C66/C88 are crosspoint matrices (up to 8 outputs) with no scaler/audio/mic/WiFi states. Preset recall uses `PRESET pp APPLY` (verified against C66 FW V1.0.1d — `SET` returns `[FAIL]Invalid Command.`).

C66 STATUS/INSTA/OUTSTA/CTRLSTA output is a **space-padded fixed-width table** (not the MFP tab/`KEY:VALUE` format), parsed by `parseC66Response()` using column offsets. Command confirmations are plain-language `[SUCCESS]…` / `[FAIL]…` strings, also parsed there. Command reference: `protocols/c66.txt`.

### TODO — C66/C88 not yet implemented (deferred, hardware-verified commands in `protocols/c66.txt`)
Shipped in 0.5.0 as "core routing only". Still to add for the C series:
- **CEC** — discrete per-input/per-output action buttons (`IN/OUT xx CEC OK|UP|DOWN|VOLUP|PON|POFF|INPUTyy…`). Note: NOT the AMF enable/disable toggle model.
- **IR routing** — `IROUTxx ON/OFF`, `MXIR xx FR yy`, `IRFV ON/OFF`, `IRPON ENABLE/DISABLE`.
- **RS232 passthrough** — `RS232OUTxx ON/OFF`, `RS232ONOUTxx`/`RS232OFFOUTxx`, `RS232DLYOUTxx`.
- **EDID** — `EDID xx DF/CP`, `EDID SAVE yy TO zz`; **output HDMI/HDBT select** — `OUTxx EH/ET`.
- **Status parsing** — Input table (per-input EDID/CEC) and per-output RS232/IR/CEC control columns from CTRLSTA are not yet mapped to states.

**Base path:** `blustream-mfp.0`
**Protocol:** Telnet (TCP port 8000) or RS232 serial (57600 baud)
**Source:** `main.js` + utility files (JavaScript, ~6 files)

## State Tree

```
info.{connection, model}
system.{power, ir, key, beep, lcd, osd, debug, autoSwitch, ir232}
output.{1..8}.{source, enabled, resolution, videoMute, poc}   # poc + outputs 3-8 are C66/C88 only
output.{bypass, mode, aspectRatio, zoom, overscan, freqMode}
audio.{volume, mute, source, pcmMode, hdmi.input{1-4}, rx.input{1-5}}
microphone.{volume, mute, mixMode, autoBg, bgVolume, bgDelay, rampUp, rampDown}
network.{dhcp, ip, gateway, subnet, telnetPort, lan{1-2}.*}
wifi.{enabled, frequency, channel, ssid, password}
presets.{save, apply, clear}
cec.{input{1-4}, output{1-3}}
commands.{vgaAutoAdjust, getStatus, homeScreen}
```

## Configuration

| Option | Default | Description |
|---|---|---|
| `connectionType` | `ip` | `ip` or `serial` |
| `ipAddress` | — | Device IP |
| `ipPort` | `23` | Telnet port |
| `serialPort` | — | Serial port path |
| `serialBaudRate` | `57600` | Baud rate |
| `deviceModel` | — | Model selection |
| `pollingInterval` | `30000` | Status poll (ms) |
| `reconnectInterval` | `10000` | Reconnect delay (ms) |
| `telnetNegotiation` | `true` | Handle telnet IAC |

## Key Patterns

- Model-definition-driven state creation with device capability flags
- Telnet IAC (Interpret As Command) handling with WILL/WONT negotiation
- Command response parsing with regex extraction
- State cleanup between model switches
- Serial + IP connection abstraction

## Dependencies

- `@iobroker/adapter-core ^3.2.2`, `serialport ^12.0.0`

# CLAUDE.md — Blustream MFP Presentation Switcher Adapter

> **Maintenance:** Update this file as changes are made during each session. Do not wait until end of session.

## Overview

ioBroker adapter for Blustream multi-format presentation switchers (MFP62/MFP72/MFP112/AMF42AU/WMF51/WMF72). Controls output routing, audio, microphone, CEC, presets, WiFi, and network settings.

**Base path:** `blustream-mfp.0`
**Protocol:** Telnet (TCP port 8000) or RS232 serial (57600 baud)
**Source:** `main.js` + utility files (JavaScript, ~6 files)

## State Tree

```
info.{connection, model}
system.{power, ir, key, beep, lcd, osd, debug, autoSwitch, ir232}
output.{1,2,3}.{source, enabled, resolution, videoMute}
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

# CLAUDE.md — Blustream MFP Presentation Switcher Adapter

> **Maintenance:** Update this file as changes are made during each session. Do not wait until end of session.

## Overview

ioBroker adapter for Blustream multi-format presentation switchers (MFP/AMF/WMF), HDBaseT matrices (C-series, HMXL, HMX-18G, PLA/Platinum, Pro/Custom-Pro), HDMI matrices (CMX/MX), basic HDMI/HDBaseT switchers (SW-series), video-wall/multi-view processors (MX44VW/MX44AVW/MV41) and a USB/KVM matrix (MX44KVM). Controls output routing, audio, microphone, CEC, presets, WiFi, PoC, video-wall mode/bezel, USB routing and network settings. **47 models** (see `MODEL_DEFINITIONS` in `main.js` and the admin `deviceModel` dropdown).

Model definitions carry an `isMatrix` flag that switches crosspoint behaviour: per-output PoC, an `output.allSource` control that routes every output at once (`OUT 00 FR yy`, multi-output only), and no scaler/audio/mic/WiFi/splitter states. Matrices support **up to 16 outputs** (PRO16HBT / CUSTOMPRO-HUB16). Preset recall uses `PRESET pp APPLY` (verified against C66 FW V1.0.1d — `SET` returns `[FAIL]Invalid Command.`).

### Command-form flags (v0.5.3 expansion)
The numeric routing/enable commands are built by helpers (`cmdRoute` / `cmdOutOnOff` / `cmdPoc`) that respect per-model def flags, because the firmware families differ:
- `commandStyle: 'nospace'` → `OUT01FR04` (CMX/MX HDMI matrices, SW-AB switchers). Default is spaced `OUT 01 FR 04` (C/HMX/Pro/MFP/AMF; C-series accepts both — hardware verified).
- `noOutputIndex: true` → single-output SW-AB switches route as `OUTFR04` (no output index).
- `pocCommand` → PoC verb: `POCOUT` (default, C/HMX/HMXL/PLA), `POC OUT` (SW41HDBT), `POC TX` (Pro/Custom-Pro).
- `routePrefix` → routing verb (default `OUT`; MX44KVM routes USB as `USBOUT xx FR yy`). `noAllSource` suppresses the route-all control (KVM has no all-hosts form).
- `hasVideoWall` → adds `videowall.{mode,vwSource,audioSource}`, per-output `bezel{Left,Right,Top,Bottom}`, and (with `hasVGAInputs`) `input.N.type`. Commands: `OUT MODE mm`, `OUT VW FR yy`, `OUT xx VCL/VCR/VCT/VCB bb`, `IN xx FR HDMI|VGA`, `MV AUD aa`. Multi-view windows and matrix outputs reuse `output.N.source` (`OUT xx FR yy`).
- `hasEDID` → per-input `edidProfile` (`EDID xx DF zz`) + `edidCopyFrom` (`EDID xx CP yy`). Auto-enabled for every crosspoint matrix in the normalisation loop **except** KVM (`routePrefix`) and basic SW-AB switches (`noOutputIndex`).
- `hasCECActions` → per-output/-input `cecEnabled` + `cecAction` (`OUT/IN xx CEC ENABLE|DISABLE|<action>`), actions from `CEC_OUTPUT_ACTIONS`/`CEC_INPUT_ACTIONS`. Set on HMX-18G & SW41HDBT (spaced `CEC <action>` form). **C-series uses a different concatenated `CEC<action>` form** — still its own TODO below.
- `hasAudioMatrix` (HMX-18G) → per-output `audioSource` (`AUDIO xx FR yy`), `audioVolume` (`VOL v TX xx`), `arcMode` (`OUT xx ARC aa`), `audioMute` (`AUDOUT xx On/Off`).
- `hasAudioEmbed` (Pro-Matrix) → per-input `audioEmbed` (`AUD RX xx ORG|ANA|AUTO`), per-output `audioMute` (`MUTE On/Off TX xx`). **CMX/MX audio "follows video" with no API command → no audio states** (`hasAudioBreakout` there is informational only).
- `hasCSC` / `hasARC` / `simulHDMI` / `configurableIO` — informational/capability flags.
- `inputCount` shorthand auto-generates the `HDMI N` inputs map (normalisation loop after `MODEL_DEFINITIONS`).

Matrix/switcher STATUS/INSTA/OUTSTA/CTRLSTA/AUDSTA output is a **space-padded fixed-width table**, parsed by `MatrixStatusParser` in [`lib/statusParser.js`](lib/statusParser.js) (a pure, dependency-free module; `main.js` streams each line through `feed()` and applies the returned `{id,val}` updates). This was **grounded against real device captures** in [`protocols/Status Feedback/`](protocols/Status%20Feedback/) — the earlier hardcoded layouts were wrong (e.g. C88CS has no `IRPON`, HMX/HMXL use `InputPort`/`OutputPort` + `EnableOutput=ON`, HDMI matrices use `OutputEn=Yes`), so those families had no working read-back before. Layouts are declared **per family** (`resolveFamily(def)` → `hdbt`/`hdmi`/`swHdbt`/`swBasic`/`videowall`/`kvm`); columns are matched by header token (robust to column order/name/spacing), sliced by offset, and writes are gated by capability flags so a state the model never created is never targeted. The parser stays **conservative** — a table only activates when its first token matches and its `require` signature tokens are present, so unrecognised/other-format tables (and the `MV41` spaceless header, which can't be offset-sliced) are safely ignored (no garbage). Coverage is proven by [`test/unit/statusParser.test.js`](test/unit/statusParser.test.js) (`npm run test:unit`), which replays every capture. Command confirmations are plain-language `[SUCCESS]…` / `[FAIL]…` strings handled by `handleMatrixConfirmation()`. **Read-back covered:** power/IR/key/LCD, routing, output-enable, PoC, per-input/output CEC (HMX/SW41HDBT), EDID profile, audio-matrix source/volume/mute (HMX-18G only — hasAudioMatrix is not set on HMXL, so its AUDSTA table is parsed and skipped), network/telnet, video-wall Mode, KVM host routing, **KVM GPIO in/out modes + USB cascade** (`gpio.*`, `usb.cascade*`), and **SW42DA Dante-DSP master volume/mute + ARC mode** (`hasDanteDsp` → read-only `audio.volume`/`audio.mute`/`audio.arcMode`, via bespoke matchers since those tables have duplicate/multi-token headers). **Not surfaced** (parsed-and-skipped, no adapter state): SW42DA per-channel Dante/line output lists (20+ rows), per-port RS232/IR CTRLSTA columns.

### Command references (`protocols/`)
`c66.txt` (C-series), `pro-matrix.txt` (PRO/CUSTOMPRO), `hmx-18g.txt` (HMX 18G), `cmx-hdmi.txt` (CMX/MX HDMI), `sw-switchers.txt` (SW-series), `mx44vw-videowall.txt` (MX44VW/AVW/MV41), `mx44kvm.txt` (KVM). `Status Feedback/` holds **real captured STATUS/INSTA/OUTSTA/CTRLSTA/AUDSTA replies** per model — the ground truth for `lib/statusParser.js` and its unit test. HMXL/PLA/C-CS reuse the C-series/pro-matrix conventions. Full rollout tracked in `MODEL-EXPANSION-PLAN.md`.

### Not yet supported (distinct protocols — deferred)
- **AMF41W** — wireless BYOD multi-view presenter with a **Linux-CLI API** (`config --…`, `layout --set …`), not the `OUT xx FR yy` dialect. Needs its own dialect + parser (closer to the WMF wireless domain than the AMF42AU). Command doc: `DownloadFile?downloadId=450`.
- **MFP31** (portable 3×1, EOL) and **SW12USB** (2×1 USB switch) — command docs not yet sourced; not added rather than guessed.
- **MX44AVW** advanced controls (PIP/POP/PBP, rotation) — modelled as MX44VW for now; superset commands not mapped. **MV41** modelled on MX44VW — verify against hardware.

### TODO — C66/C88 not yet implemented (deferred, hardware-verified commands in `protocols/c66.txt`)
Shipped in 0.5.0 as "core routing only". Still to add for the C series:
- **CEC** — discrete per-input/per-output action buttons (`IN/OUT xx CEC OK|UP|DOWN|VOLUP|PON|POFF|INPUTyy…`). Note: NOT the AMF enable/disable toggle model.
- **IR routing** — `IROUTxx ON/OFF`, `MXIR xx FR yy`, `IRFV ON/OFF`, `IRPON ENABLE/DISABLE`.
- **RS232 passthrough** — `RS232OUTxx ON/OFF`, `RS232ONOUTxx`/`RS232OFFOUTxx`, `RS232DLYOUTxx`.
- **EDID** — `EDID xx DF/CP`, `EDID SAVE yy TO zz`; **output HDMI/HDBT select** — `OUTxx EH/ET`.
- **Status parsing** — core read-back is now grounded (see status-parsing paragraph): system/routing/enable/PoC/EDID-profile/network map to states for the C series. Still unmapped: per-output RS232/IR/CEC control columns from CTRLSTA, and per-input CEC (C series is not `hasCECActions`).

### TODO — expanded range (v0.5.3)
Implemented: routing/enable/PoC/presets (all families); video-wall/multi-view (MX44VW/AVW/MV41); USB/KVM (MX44KVM); **EDID** (all matrices); **CEC actions** (HMX-18G/SW41HDBT); **audio matrix** (HMX-18G) & **audio embed** (Pro-Matrix). **STATUS read-back now grounded** against real captures (see status-parsing paragraph above + `lib/statusParser.js`): power/IR/key/LCD, routing, output-enable, PoC, CEC enable, EDID profile, audio-matrix source/volume/mute (HMX-18G only), network/telnet, video-wall Mode, KVM host routing — across `hdbt`/`hdmi`/`swHdbt`/`swBasic`/`videowall`/`kvm` families. Still to wire:
- **Deep audio-DSP telemetry** — SW42DA-V2 master volume/mute + ARC mode now read back (`hasDanteDsp`, read-only `audio.*`). The per-channel Dante/line output lists (20+ rows, dB volumes/mutes/delays) remain unmapped — a big low-value tree with no matching write path. Note: SW42DA-V2 STATUS shows a 2nd output row, but it is a scaled/downmix **follower** of the single switch selection (the def keeps `outputs:1`, `noOutputIndex`), not an independent route.
- **KVM GPIO / cascade** — MX44KVM GPIO in/out modes (`gpio.output/input.N.mode`) and USB cascade (`usb.cascadeOut/From.N`) now read back (read-only). Still to add: USB-power/pairing writes, GPIO trigger-time/level values.
- **CTRLSTA extras** — per-output RS232/IR control columns and per-input IR routing from CTRLSTA not mapped to states.
- **C-series CEC** — uses the concatenated `CEC<action>` form (not `CEC <action>`); not wired to `hasCECActions`. Also IR routing / RS232 passthrough / EDID-SAVE / `OUTxx EH/ET` (see C66/C88 TODO above).
- **CSC scaling** — `OUT xx SCALING ON/OFF` (HMX-18G, SW41HDBT) not exposed (`hasCSC` informational).
- **Modular I/O discovery** — CUSTOMPRO-HUB/HUB16 expose the chassis max; populated I/O from `STATUS` not detected (`configurableIO`).
- **MX44AVW advanced** (PIP/POP/rotation — full command set now in `protocols/Status Feedback/MX44AVW_API.txt`), **MV41** hardware-verify (its STATUS headers are spaceless → not parseable by the grid engine).
- **Deferred families** — AMF41W (Linux-CLI API), MFP31, SW12USB, SW14USB (USB-only, no adapter def yet).

**Base path:** `blustream-mfp.0`
**Protocol:** Telnet (TCP port 8000) or RS232 serial (57600 baud)
**Source:** `main.js` + `lib/models.js` (model definitions, dependency-free for reuse/tests) + `lib/statusParser.js` (STATUS table parser). Parser coverage tested in `test/unit/` (`npm run test:unit`).

## State Tree

```
info.{connection, model}
system.{power, ir, key, beep, lcd, osd, debug, autoSwitch, ir232}
output.{1..16}.{source, enabled, resolution, videoMute, poc}   # poc = HDBaseT matrices; outputs >2 = matrices (up to 16)
output.{1..N}.bezel{Left,Right,Top,Bottom}   # video-wall models (MX44VW/AVW)
output.{1..N}.{cecEnabled, cecAction}         # CEC (HMX-18G/SW41HDBT)
output.{1..N}.{audioSource, audioVolume, arcMode, audioMute}   # audio matrix (HMX-18G) / audioMute also Pro
videowall.{mode, vwSource, audioSource}       # video-wall/multi-view models
input.{1..N}.type                             # HDMI/VGA select (MX44VW/AVW)
input.{1..N}.{edidProfile, edidCopyFrom}      # EDID mgmt (all matrices)
input.{1..N}.{cecEnabled, cecAction}          # CEC (HMX-18G/SW41HDBT)
input.{1..N}.audioEmbed                       # audio embed (Pro-Matrix)
output.{bypass, mode, aspectRatio, zoom, overscan, freqMode}
audio.{volume, mute, source, pcmMode, hdmi.input{1-4}, rx.input{1-5}}
audio.{volume, mute, arcMode}                 # Dante-DSP master read-back (SW42DA, hasDanteDsp) — read-only
gpio.{output,input}.{1-4}                     # KVM GPIO port modes (MX44KVM) — read-only string
usb.{cascadeOut,cascadeFrom}.{1-4}            # KVM USB cascade routing (MX44KVM) — read-only
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

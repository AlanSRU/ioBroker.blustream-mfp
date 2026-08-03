# Model Expansion Plan — Full Blustream Switcher/Matrix Range

> Status: **planning** (2026-07-19). Goal: extend the adapter from 8 supported models to the
> complete Blustream video **switcher/matrix** line, current and discontinued.
> Multicast / AV-over-IP (ACM200/210/500/1000, IPxxx TX/RX) is **out of scope** — a separate
> adapter covers that product line.

## 1. What we learned (the shape of the work)

Blustream's switcher/matrix range uses **one dominant control dialect** — the same
space/no-space `OUT..FR..` telnet+RS232 protocol this adapter already speaks. Most models are
therefore **variants of existing logic** (crosspoint-matrix `isMatrix`, or MFP/AMF scaling
switch), not new protocol code. Genuinely new work is confined to video-wall, multiview and KVM.

### Command dialects
| Dialect | Form | Used by | In adapter today |
|---|---|---|---|
| **Spaced** | `OUT 01 FR 02`, `MIC VOL 10`, `PRESET 01 APPLY` | MFP/AMF/WMF switchers | ✅ default emitter |
| **No-space** | `OUT01FR02`, `OUTMODEVW`, `EDID01CP02` | MX / CMX / HMXL / PLA / PRO / HMX-18G matrices | C-series accepts both; MX-family documents **no-space only** |
| HTTP-CGI | `GET /cgi-bin/submit?cmd=out01fr01`, `getxml.cgi?xml=mxsta` | C44-KIT web-GUI class | ❌ (new transport — deferred, see §7) |

**Design implication:** add a `commandStyle: 'spaced' | 'nospace'` field to model defs and have
the command builder format accordingly. Default `spaced` (preserves current behaviour);
matrices in the MX/CMX/HMXL/PLA/PRO families set `nospace`. Verify on real hardware where possible
— C-series is confirmed to accept both.

## 2. Required shared infrastructure (do BEFORE adding 16×16 models)

1. **Generalize the ≤8-output assumption.** `ALL_MODEL_STATES` ([main.js:342](main.js#L342))
   enumerates `output.1..8` literally, and the state-creation / purge loops assume max 8 outputs.
   PRO16HBT and Custom-Pro chassis are 16×16. Replace the literal list with a loop up to
   `MAX_OUTPUTS` (16) or build the purge list from a `for` over the configured/observed max.
2. **`commandStyle` formatting** in the command builder (§1).
3. **New capability flags** (§4).
4. **Variable I/O for modular chassis.** Custom-Pro HUB/HUB16 I/O depends on installed boards.
   Add `configurableIO: true` and admin fields for input/output counts (default to chassis max),
   or parse actual population from `STATUS`. Simplest v1: expose an admin numeric override.

## 3. Complete in-scope model catalogue

Legend — **Reuse**: `M` = existing `isMatrix` crosspoint logic, `S` = MFP/AMF scaling-switch logic,
`VW` = new video-wall/multiview, `KVM` = new USB routing. **✱** = already supported.

### 3a. HDBaseT matrices (Reuse = M, commandStyle nospace)
| Def key | Model | I/O | Flags | Status | Command source |
|---|---|---|---|---|---|
| c44kit | C44-KIT | 4×4 | hasPOC,hasHDBT | EOL | downloadId=395 |
| c44cs | C44CS-KIT | 4×4 | hasPOC,hasHDBT,hasCSC | current | downloadId=395 |
| ✱ c66 | C66 | 6×6 | (have) | EOL→CS | protocols/c66.txt |
| c66cs | C66CS | 6×6 | hasPOC,hasHDBT,hasCSC | current | avmat C66/88CS manual |
| ✱ c88 | C88 | 8×8 | (have) | EOL | protocols/c66.txt |
| c88cs | C88CS | 8×8 | hasPOC,hasHDBT,hasCSC | current | downloadId=86 (QRG) |
| hmxl42arc | HMXL42ARC-KIT | 4×2 | hasHDBT,hasCSC,hasARC | current | HMXL manual |
| hmxl44arc | HMXL44ARC-KIT | 4×4 | hasHDBT,hasCSC,hasARC | current | HMXL manual |
| hmxl44cs | HMXL44CS-KIT | 4×4 | hasHDBT,hasCSC | current | HMXL manual |
| hmxl66arc | HMXL66ARC | 6×6 | hasHDBT,hasCSC,hasARC | current | HMXL manual |
| hmxl88arc | HMXL88ARC | 8×8 | hasHDBT,hasCSC,hasARC | current | QRG downloadId=80 |
| hmxl88v2 | HMXL88-V2 | 8×8 | hasHDBT | legacy | manualslib HMXL88-V2 p.14 |
| hmx44_18g | HMX44-18G-KIT | 4×4 | hasHDBT3,hasARC | current | downloadId=733 (family API) |
| hmx88_18g | HMX88-18G | 8×8 | hasHDBT3,hasARC | current | downloadId=733 (API) |
| pla88cs | PLA88CS | 8×8 | hasHDBT,hasCSC,simulHDMI | current | Chowmain platinum |
| pla88arc | PLA88ARC-V2 | 8×8 | hasHDBT,hasARC | current | Chowmain platinum |
| pla88l | PLA88L-V2 | 8×8 | hasHDBTLite | current | Chowmain platinum |
| pro48hbt | PRO48HBT70 | 4×8 | hasHDBT | legacy | downloadId=647 (Pro-Matrix) |
| pro48hbtcs | PRO48HBT70CS | 4×8 | hasHDBT,hasCSC | current | downloadId=647 |
| pro88hbtcs | PRO88HBT70CS/100CS | 8×8 | hasHDBT,hasCSC | current | downloadId=647 |
| **pro16hbtcs** | PRO16HBT70CS/100CS | **16×16** | hasHDBT,hasCSC | current | downloadId=647 · needs §2.1 |
| **custompro** | CUSTOMPRO-HUB | ≤8×8 | modular,configurableIO | current | downloadId=185 · needs §2.4 |
| **custompro16** | CUSTOMPRO-HUB16 | ≤16×16 | modular,configurableIO | current | downloadId=185 · needs §2.1+2.4 |

### 3b. HDMI matrices (Reuse = M, commandStyle nospace)
| Def key | Model | I/O | Flags | Status | Command source |
|---|---|---|---|---|---|
| mx22ab8k | MX22AB-8K | 2×2 | hdmi21,8K,hasAudioBreakout | current | product page |
| mx44abv2 | MX44AB-V2 | 4×4 | hdmi,hasAudioBreakout | current | manualslib p.12 ✅fetched |
| cmx42cs | CMX42CS | 4×2 | hdmi,hasCSC | current | downloadId=897 |
| cmx44ab | CMX44AB | 4×4 | hdmi,hasAudioBreakout | current | downloadId=192 |
| cmx44cs | CMX44CS(-V2) | 4×4 | hdmi,hasCSC,hasAudioBreakout | current | manualslib CMX |
| cmx88cs | CMX88CS | 8×8 | hdmi,hasCSC | current | downloadId=853 |
| cmx88ab | CMX88AB | 8×8 | hdmi,hasAudioBreakout | current | manualslib p.11 |
| pro88hdmi | PRO88HDMI-V2 | 8×8 | hdmi | current | downloadId=647 |

### 3c. Video wall / multiview (Reuse = VW, new state tree — §5)
| Def key | Model | I/O | Notes | Command source |
|---|---|---|---|---|
| mx44vw | MX44VW | 4×4 | matrix / 2×2·4×1·1×4 VW / quad multiview; HDMI+VGA in, scaling | manualslib p.17-18 ✅fetched |
| mx44avw | MX44AVW | 4×4 | advanced VW: PIP/POP/PBP, rotation, seamless | Chowmain mx44vw / manual |

### 3d. USB / KVM (Reuse = KVM, new state tree — §6)
| Def key | Model | I/O | Notes | Command source |
|---|---|---|---|---|
| mx44kvm | MX44KVM | 4×4 | USB 3.0 KVM; extract exact USB-route cmds first | product manual (fetch) |

### 3f. Basic HDMI / HDBaseT switchers (Reuse = SW, commandStyle nospace)
Simplest devices in the range: single output, input-select + auto-switch + (usually) audio
breakout. Command surface ≈ `OUTxxFRyy` / `OUT AUTO ON/OFF` / `OUTON/OFF` / IR / KEY.
**SW41HDBT reuses the C-series fixed-width status tables** (`INSTA/OUTSTA/CTRLSTA/FWVERSION`) →
its status parser uses the `swHdbt` family of `lib/statusParser.js` (the per-family successor to
`parseC66Response`), not the MFP tab format.
| Def key | Model | I/O | Flags | Notes | Command source |
|---|---|---|---|---|---|
| sw21abv2 | SW21AB-V2 | 2×1 | hasAudioBreakout,hasAutoSwitch | HDMI 4K | manualslib SW21 |
| sw21abv3 | SW21AB-V3 | 2×1 | hasAudioBreakout,hasAutoSwitch | HDMI 4K, +optical/analog | product page |
| sw41abv2 | SW41AB-V2 | 4×1 | hasAudioBreakout,hasAutoSwitch | HDMI 4K | manualslib/1770856, dId=232 |
| sw41ab8k | SW41AB-8K | 4×1 | hasAudioBreakout,hasAutoSwitch,8K | HDMI 2.1 8K | product page |
| sw42da | SW42DA | 4×1 | hasAutoSwitch,dante | Dante de-embed/downmix | product page |
| sw42dav2 | SW42DA-V2 | 4×1 | hasAutoSwitch,dante | Dante | product page |
| sw41hdbt | SW41HDBT | 4×1 | hasHDBT,hasCSC,simulHDMI | HDBaseT+HDMI in → simul HDMI/HDBT out; C-style status tables | dId=652 (cmds), QRG dId=168 |
| sw12usb | SW12USB | 2×1 | hasKVM,hasAutoSwitch | HDMI switch w/ USB2.0/KVM → USB-route cmds (Phase 4 w/ KVM) | product page |
| mv41 | MV41 | 4×1 | hasMultiview | quad multiview switcher → Phase 4 with VW | product page |

### 3e. Presentation / wireless switchers (Reuse = S)
| Def key | Model | I/O | Flags | Status | Command source |
|---|---|---|---|---|---|
| mfp31 | MFP31 | 3×1 | S, no network, RS232/IR only | EOL | product manual |
| ✱ mfp62/72/112 | — | — | (have) | 72/112 EOL | protocols/*.txt |
| amf41w | AMF41W | 4×1 | S + WiFi/wireless hybrid | EOL | API downloadId=450 |
| ✱ amf42au | — | — | (have) | current | protocols/amf42au.txt |
| ✱ wmf51/wmf72 | — | — | (have) | current | protocols/wmf*.txt |

## 4. New capability flags to introduce
- `commandStyle` — `'spaced'` (default) | `'nospace'`
- `hasCSC` — color-space-conversion / down-scaling variant (may expose per-output scaling states)
- `hasARC` — audio return channel (audio.arc.* states)
- `hasAudioBreakout` — de-embedded analog/coax audio outputs → re-enable audio states for matrices
- `hasHDBT3` / `hasHDBTLite` — informational; may affect resolution tables
- `simulHDMI` — output has simultaneous HDMI + HDBaseT (like C66 out-1: `OUTxx EH/ET`)
- `hasVideoWall`, `hasMultiview`, `hasKVM`, `configurableIO`, `modular`

## 5. New state tree — video wall (MX44VW / MX44AVW)
Confirmed commands (no-space): `OUTMODE{MX|MV|VW}`, `OUTMVFRyy` (multiview main src),
`OUTVWFRyy` (VW source), `OUTxxVCL/VCR/VCT/VCB bb` (pixel-shift/bezel 00-100), `INxxFR{HDMI|VGA}`
(input type), `MVAUDaa` (multiview audio src), plus standard `OUTxxFRyy`, `OUTxxON/OFF`, EDID.
Proposed states:
```
videowall.mode            {matrix|multiview|videowall}
videowall.vwSource        input routed across the wall
videowall.multiviewSource main-window input
videowall.audioSource     multiview audio input
videowall.bezel.{left,right,top,bottom}   0-100 pixel shift
input.{n}.type            {HDMI|VGA}     (MX44VW has VGA inputs)
```
MX44AVW adds PIP/POP/PBP + rotation — extract from its manual before coding (superset of MX44VW).

## 6. New state tree — USB/KVM (MX44KVM)
**First task: fetch MX44KVM manual and extract exact USB-route command** (likely `OUTxxUFRyy`
or dedicated `USB`/`KVM` verb). Proposed:
```
usb.output.{n}.source     which host/peripheral set routed to console n
```
Small surface; the video path (if any) reuses matrix logic.

## 7. Phased rollout

> **Status (2026-07-19): Phase 0–2 DONE; Phase 4 mostly DONE; Phase 3 deferred.**
> - **Phase 0–2** — infra (commandStyle/pocCommand/noOutputIndex/routePrefix/
>   noAllSource helpers, 16-output generalization) + 35 matrix/SW defs. Shipped.
> - **Phase 4** — video-wall/multi-view (MX44VW, MX44AVW, MV41) with `videowall.*`
>   + per-output bezel + `input.N.type` states, and the USB/KVM matrix (MX44KVM,
>   `USBOUT` routing + presets). Shipped & unit-tested (47 models total). Deferred:
>   MX44AVW advanced PIP/rotation, MV41 hardware verification, MX44KVM GPIO/USB-power,
>   and **SW12USB** (command doc not sourced).
> - **Phase 3 deferred** — **AMF41W** uses a distinct Linux-CLI API (`config --…`/
>   `layout --set …`), a separate protocol/parser effort (WMF-wireless-adjacent);
>   **MFP31** command doc not sourced. Neither added rather than guessed.
>
> All command forms verified against the vendor RS-232 text docs (downloaded &
> `pdftotext`-parsed) and covered by the `/tmp` unit harness.
>
> **Cross-cutting features DONE (v0.5.3):** per-input **EDID** (`EDID xx DF/CP`) on
> all 35 matrices; **CEC** enable+actions (HMX-18G, SW41HDBT); **audio matrix**
> (HMX-18G: route/vol/mute/ARC) and **audio embed** (Pro-Matrix: `AUD RX`/`MUTE TX`).
> CMX/MX audio follows video (no API command → no states).
>
> **STATUS read-back DONE (unblocked by real captures in `protocols/Status Feedback/`):**
> the CMX/MX/SW STATUS format turned out to be the *same* space-padded fixed-width
> grid as C/HMX (not free text). Rewrote the parser as a per-family, dependency-free
> module `lib/statusParser.js` (`MatrixStatusParser`), grounded and unit-tested against
> every capture (`npm run test:unit`). The old `parseC66Response` layouts were actually
> wrong for the real hardware (C88CS has no `IRPON`; HMX/HMXL use `InputPort`/`OutputPort`
> + `EnableOutput=ON`; HDMI matrices use `OutputEn=Yes`) — those families had no working
> read-back before. Now mapped: system/routing/enable/PoC/CEC/EDID/audio-matrix/network/
> telnet/video-wall-Mode/KVM-routing across `hdbt`/`hdmi`/`swHdbt`/`swBasic`/`videowall`/
> `kvm`. Also added: **KVM GPIO in/out modes + USB cascade** (`gpio.*`/`usb.cascade*`)
> and **SW42DA Dante-DSP master volume/mute + ARC mode** (`hasDanteDsp` → read-only
> `audio.*`), both via bespoke matchers alongside the grid engine. **Still open:**
> SW42DA per-channel Dante/line output lists (20+ dB rows, no write path); MV41 STATUS
> (spaceless headers, not grid-parseable); C-series `CEC<action>` form, CSC scaling,
> modular-I/O discovery, and the deferred families (AMF41W CLI, MFP31, SW12USB) remain.

- **Phase 0 — infra:** `commandStyle` in builder; generalize outputs to 16 (§2.1); add capability
  flags (§4); admin dropdown/help scaffolding for grouped families. Regression-test existing 8.
- **Phase 1 — ≤8×8 matrices (M) + basic switchers (SW):** HMXL, CMX, PLA, C44/CS, C66CS/C88CS,
  HMX-18G, MX22AB/MX44AB-V2, PRO48/PRO88, PRO88HDMI; and the SW-series (SW21/SW41/SW42/SW41HDBT).
  Bulk of shipping product; mostly def entries + `protocols/*.txt`. Add `hasARC` + `hasAudioBreakout`
  state handling here. SW switchers are the cheapest (single output, input-select + auto-switch).
- **Phase 2 — 16×16 + modular:** PRO16HBT, Custom-Pro HUB/HUB16 (depends on §2.1 + §2.4).
- **Phase 3 — switchers (S):** MFP31, AMF41W (AMF41W adds WiFi/wireless states from WMF logic).
- **Phase 4 — new families:** MX44VW → MX44AVW (VW/multiview, §5), MV41 (multiview switcher,
  reuses §5 multiview states), then MX44KVM (§6).
- **Deferred:** HTTP-CGI transport for web-GUI-only C44-KIT class (only if a target model lacks
  telnet — most have it, so likely never needed).

## 8. Per-model checklist (repeat for each new model)
1. Download/verify command set from the source in §3 (prefer official PDF; cross-check the
   `timonbruns/Blustream` HA repo for MFP-family strings, `designer-living/pyblustream` for matrix).
2. Write `protocols/<key>.txt` in the existing house format (connection, dialect note, verified-vs-doc).
3. Add `MODEL_DEFINITIONS[<key>]` with I/O, inputs, resolutions, flags, `commandStyle`.
4. Extend `ALL_MODEL_STATES` only with genuinely new paths.
5. Add admin `jsonConfig.json` dropdown entry (+ optional per-model help `hidden` block).
6. Add any family-specific command build/parse branch (§1, §5, §6).
7. Update `io-package.json` (news entry on release), README model table, CLAUDE.md overview.
8. Test: model-switch state cleanup (purge), routing round-trip, status parse.

## 9. Command-source reference URLs
- Pro-Matrix "Help Info" (space-delimited cmd list): blustream.co.uk `DownloadFile?downloadId=647`
- HMX88-18G API (FW V1.2.0): `downloadId=733`
- Custom Pro Matrix manual: blustream-us.com `downloadId=185`
- CMX88CS `=853`, CMX88AB `=192`, CMX42CS `=897`, C44 `=395`, AMF41W API `=450`, C88CS QRG `=86`, HMXL88ARC QRG `=80`
- MX44AB-V2 cmds: manualslib/1285651 p.12 · HMXL88-V2: manualslib/1226954 p.14 · MX44VW: manualslib/1214144 p.17-18
- General "Controlling Blustream Products via RS232": scribd/566670067
- Driver repos: github.com/timonbruns/Blustream (MFP62, HA), github.com/designer-living/pyblustream (matrix telnet:23)
- `downloadId` scheme is enumerable — API PDFs/QRGs cluster in the 80–900 range.

## 10. Open questions / risks
- **No-space vs spaced** must be verified per family on hardware; docs are inconsistent about
  whether spaced is also accepted outside the C-series.
- **CSC scaling states:** `hasCSC` models may expose per-output resolution/scaling (like MFP) —
  decide whether to surface scaling controls or treat as pure crosspoint. Needs a command-doc check.
- **Custom-Pro modular I/O** discovery from `STATUS` vs admin override — pick one.
- **MX44AVW / MX44KVM** command tables not yet extracted — do that first in Phase 4.
- Telnet **port** differs by family (C-series 23, some 8000) — already configurable; document per model.

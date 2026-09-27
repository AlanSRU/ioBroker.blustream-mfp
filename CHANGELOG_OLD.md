# Older changes

### 0.3.1 (2025-12-21)
* (Alan Paris) Fixed adapter checker warnings; added translations for news entries

### 0.3.0 (2025-12-21)
* (Alan Paris) Initial release with support for AMF42AU, MFP62, MFP72, MFP112, WMF51, WMF72
* (Alan Paris) Added CEC control, preset management, and picture controls
## 0.5.0 (2026-07-16)
* (Alan Paris) Added support for the Blustream C66 (6x6) and C88 (8x8) Contractor HDBaseT matrices: crosspoint routing across up to 8 outputs, route-all (`output.allSource`), per-output enable, per-output PoC, and 9 presets
* (Alan Paris) Added a dedicated parser for the C66/C88 fixed-width STATUS/OUTSTA tables and the `[SUCCESS]`/`[FAIL]` command confirmations, so routing, enable, PoC and network states reflect the device
* (Alan Paris) Scaler, resolution and audio states are no longer created for the C66/C88 crosspoint matrices (they have no scaler/audio path), so the object tree only exposes controls the device actually implements
* (Alan Paris) Added `protocols/c66.txt` documenting the C66/C88 RS-232 / Telnet command set (verified against FW V1.0.1d)

## 0.4.2 (2026-07-04)
* (Alan Paris) WiFi password state is now write-only (`read: false`) so the value cannot be read back from the object tree once set
* (Alan Paris) Removed the accidentally committed npm pack artifact (`.tgz`) from the repository

## 0.4.1 (2026-07-03)
* (Alan Paris) Removed unused state paths that were never created from the internal cleanup list, so it now matches the states the adapter actually creates

## 0.4.0 (2026-07-02)
* (Alan Paris) Writes to all writable states are now processed in onStateChange; previously many controls (picture, CEC, presets, WiFi, standby, sidebar, layout, audio mode, per-LAN DHCP) were silently ignored
* (Alan Paris) WiFi frequency and channel are now sent together as the single command the device requires
* (Alan Paris) Sensitive values (e.g. WiFi password) are masked in the debug state-change log
* (Alan Paris) Polling and reconnect intervals are now clamped to safe bounds in code, not only in the admin UI

## 0.3.8 (2026-07-02)
* (Alan Paris) Fixed CEC output states being created for outputs the model does not have (missing intermediate object, E3009)
* (Alan Paris) Preset save/apply/clear states now have read=true as required by the "level" role (E1010)
* (Alan Paris) Audited every adapter object definition against the ioBroker state-role rules

## 0.3.7 (2026-07-02)
* (Alan Paris) Fixed invalid state roles flagged by the object checker: network IP/gateway/subnet now use role "text" (writable), telnet/TCP ports use read-only "info.port", and LAN1/LAN2 network states are read-only "info.ip" (E1008/E1011)
* (Alan Paris) Added missing JSDoc parameter descriptions

## 0.3.6 (2026-07-02)
* (Alan Paris) Use ioBroker framework timers so they are cleaned up on adapter unload (repochecker E5004/E5005)
* (Alan Paris) Updated @alcalzone/release-script to 5.2.1 and @iobroker/adapter-core to 3.4.1 (repochecker E0036/W0034)
* (Alan Paris) Linked CHANGELOG_OLD.md from the README changelog

## 0.3.5 (2026-05-29)
* (Alan Paris) Raised minimum Node.js to 22 and updated CI workflows to Node.js 24
* (Alan Paris) Removed chai/mocha devDependencies (provided by @iobroker/testing) and migrated tooling to @tsconfig/node22
* (Alan Paris) Cleared remaining repochecker findings: dependabot @types/node ignore rule, cron schedules, auto-merge.yml, manual-review release plugin, and CHANGELOG_OLD.md

## 0.3.4 (2026-05-28)
* (Alan Paris) Cleared repochecker findings and unblocked CI after dependabot conflicts
* (Alan Paris) Added tsconfig.json and @tsconfig/node20 for type checking
* (Alan Paris) Filled in missing admin translations for jsonConfig help texts

## 0.3.3 (2026-05-20)
* (Alan Paris) Now requires Node.js 20+, js-controller 6.0.11+, admin 7.6.20+
* (Alan Paris) Migrated admin UI to jsonConfig
* (Alan Paris) Modernized internal tooling (release-script, ESLint 9, ioBroker testing actions)

## 0.3.2 (2026-03-24)
* (Alan Paris) Improved telnet response parsing

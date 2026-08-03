'use strict';

// =============================================================================
// Blustream fixed-width STATUS table parser (pure, no ioBroker dependency).
//
// Matrix/switcher STATUS output is a sequence of space-padded, fixed-width
// tables. Each table has a header line whose first token identifies it; data
// rows are sliced by the character offset of every header token. Column NAMES
// and ORDER differ across product families (verified against real device
// captures in `protocols/Status Feedback/`):
//
//   C88CS:      Power IR Key LCD Baud IRFV Output1              (no IRPON)
//   HMX88-18G:  Power IR Key Baud IRFV Output1 Output2 LCD DiagPrint
//   HMXL/CMX:   InputPort/OutputPort ...   (vs C-series Input/Output)
//   enable col: OutputEn=ON (C) | EnableOutput=ON (HMX) | OutputEn=Yes (HDMI)
//
// So table layouts are declared PER FAMILY. `resolveFamily(def)` maps a model
// definition to one of the family keys below; `feed(line, def)` is streamed one
// line at a time and returns an array of {id, val} state updates.
//
// Design notes:
//  - Header match: the line's first whitespace token must be in `first`, and
//    every token in `require` must be present. `require` tokens are chosen to
//    be unique to that table so audio-vs-output (both "OutputPort" on HMXL)
//    disambiguate reliably.
//  - Row slicing uses the offsets of ALL header tokens (not just mapped ones)
//    so an unmapped middle column can't bleed into a mapped one, and a
//    space-containing value in the LAST column (e.g. C88 IRInput "1 2 3 4 …")
//    is captured whole.
//  - Multi-row tables (input/output/audio) only emit when the first column is a
//    valid port index; single-row tables (system/network/telnet/mode) emit once
//    then clear, so trailing free-text lines are never mis-sliced.
//  - Writes are gated by model-def capability flags so we never target a state
//    the model didn't create (e.g. audio* only when hasAudioMatrix).
// =============================================================================

// --- value coercions -------------------------------------------------------
const isOn = s => /^(on|yes|enable|enabled)$/i.test((s || '').trim());
const isOff = s => /^(off|no|disable|disabled)$/i.test((s || '').trim());
// ON/YES → true, OFF/NO → false, anything else (including "N/A", which means the
// port has no such capability rather than "switched off") → null: leave the state
// alone. push() drops null, so an inapplicable column never writes a value.
function boolOn(s) {
    if (isOn(s)) {
        return true;
    }
    if (isOff(s)) {
        return false;
    }
    return null;
}
// Trailing digits of a token → zero-padded 2-char port string. "HDBT01"→"01",
// "04"→"04", "1"→"01", "HDMI3"→"03". Returns null if no digits.
function port2(s) {
    const m = (s || '').match(/(\d+)\s*$/);
    return m ? String(parseInt(m[1], 10)).padStart(2, '0') : null;
}
// Trailing digits → integer (EDID "Default_00"→0, volume "68"→68).
function trailingInt(s) {
    const m = (s || '').match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : null;
}
// Normalise a fixed-width IP ("192.168.000.200" → "192.168.0.200").
function normIp(s) {
    const v = (s || '').trim();
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(v)
        ? v
              .split('.')
              .map(o => String(parseInt(o, 10)))
              .join('.')
        : v;
}

// --- family table schemas ---------------------------------------------------
// cols: { HeaderToken: canonicalField }. The first token is mapped to 'idx' on
// multi-row tables. Canonical fields are interpreted centrally in emit().
const SYSTEM_COLS = { Power: 'power', IR: 'ir', Key: 'key', LCD: 'lcd', Beep: 'beep', DiagPrint: 'debug' };
const NETWORK_COLS = { DHCP: 'dhcp', IP: 'ip', Gateway: 'gateway', SubnetMask: 'subnet' };
const TELNET_COLS = { Telnet: 'telnetPort' };

const SYSTEM_TABLE = { kind: 'system', single: true, first: ['Power'], require: ['Power'], cols: SYSTEM_COLS };
const NETWORK_TABLE = { kind: 'network', single: true, first: ['DHCP'], require: ['IP'], cols: NETWORK_COLS };
const TELNET_TABLE = { kind: 'telnet', single: true, first: ['Telnet'], require: ['Port8000'], cols: TELNET_COLS };

// Input/output row tokens across HDBaseT + HDMI matrices and switchers.
const INPUT_COLS = {
    Input: 'idx',
    InputPort: 'idx',
    Edid: 'edid',
    EdidIndex: 'edid',
    CEC: 'cec',
    CECIn: 'cec',
};
const OUTPUT_COLS = {
    Output: 'idx',
    OutputPort: 'idx',
    FromIn: 'source',
    InputPort: 'source',
    SelectInput: 'source',
    OutputEn: 'enabled',
    EnableOutput: 'enabled',
    PoC: 'poc',
    POC: 'poc',
    CEC: 'cec',
    CECOut: 'cec',
};
const AUDIO_COLS = {
    AoutPort: 'idx',
    OutputPort: 'idx',
    AudioFrom: 'audioSource',
    AnalogVol: 'audioVolume',
    AnalogMute: 'audioMute',
};

const HDBT_TABLES = [
    SYSTEM_TABLE,
    { kind: 'input', first: ['Input', 'InputPort'], require: [], cols: INPUT_COLS },
    { kind: 'output', first: ['Output', 'OutputPort'], require: ['OSP'], cols: OUTPUT_COLS },
    { kind: 'audio', first: ['AoutPort', 'OutputPort'], require: ['AudioFrom'], cols: AUDIO_COLS },
    NETWORK_TABLE,
    TELNET_TABLE,
];

// HDMI matrices (CMX / MX audio-breakout): no PoC, no audio-matrix table.
const HDMI_TABLES = [
    SYSTEM_TABLE,
    { kind: 'input', first: ['Input', 'InputPort'], require: [], cols: INPUT_COLS },
    { kind: 'output', first: ['Output', 'OutputPort'], require: ['OSP'], cols: OUTPUT_COLS },
    NETWORK_TABLE,
    TELNET_TABLE,
];

// SW41HDBT (HDBaseT switch): input has a POC column, output uses SelectInput and
// has no enable column (single output). Same token maps cover it.
const SW_HDBT_TABLES = [
    { kind: 'system', single: true, first: ['Power'], require: ['Power'], cols: SYSTEM_COLS },
    { kind: 'input', first: ['InputPort', 'Input'], require: [], cols: INPUT_COLS },
    { kind: 'output', first: ['OutputPort', 'Output'], require: ['OSP'], cols: OUTPUT_COLS },
    NETWORK_TABLE,
    TELNET_TABLE,
];

// Basic HDMI switchers (SW21AB/SW41AB/SW42DA): system + input EDID + routing.
// Deep audio-DSP telemetry (SW42DA Dante/line channels) is intentionally not
// surfaced — those rows map to no adapter state (see CLAUDE.md).
const SW_BASIC_TABLES = [
    SYSTEM_TABLE,
    { kind: 'input', first: ['Input', 'InputPort'], require: [], cols: INPUT_COLS },
    { kind: 'output', first: ['Output', 'OutputPort'], require: ['OSP'], cols: OUTPUT_COLS },
];

// Video-wall processors (MX44VW / MX44AVW). "Mode" is a single-value line.
const VIDEOWALL_TABLES = [
    SYSTEM_TABLE,
    { kind: 'mode', single: true, first: ['Mode'], require: [], cols: {} },
    { kind: 'input', first: ['Input', 'InputPort'], require: [], cols: INPUT_COLS },
    { kind: 'output', first: ['Output', 'OutputPort'], require: ['OSP'], cols: OUTPUT_COLS },
    NETWORK_TABLE,
    TELNET_TABLE,
];

const FAMILIES = {
    hdbt: HDBT_TABLES,
    hdmi: HDMI_TABLES,
    swHdbt: SW_HDBT_TABLES,
    swBasic: SW_BASIC_TABLES,
    videowall: VIDEOWALL_TABLES,
    kvm: null, // handled by a dedicated line matcher, not the grid engine
};

/**
 * Map a model definition to a STATUS-table family key, or null when the model's
 * STATUS is not a space-padded grid (e.g. MV41, whose header columns have no
 * separators, so column offsets can't be derived).
 *
 * @param {object} def - a MODEL_DEFINITIONS entry
 * @returns {('hdbt'|'hdmi'|'swHdbt'|'swBasic'|'videowall'|'kvm'|null)} family key
 */
function resolveFamily(def) {
    if (!def || !def.isMatrix) {
        return null;
    }
    if (def.routePrefix === 'USBOUT') {
        return 'kvm';
    }
    if (def.hasVideoWall) {
        return def.hasVGAInputs ? 'videowall' : null;
    } // MV41 → null
    const cat = def.category;
    if (cat === 'CMX' || cat === 'MX') {
        return 'hdmi';
    }
    if (cat === 'SW') {
        return def.hasHDBT ? 'swHdbt' : 'swBasic';
    }
    return 'hdbt'; // C / HMXL / HMX / PLA / PRO
}

// Tokenise a header line into [{text, start}] using whitespace runs as gaps.
function tokenize(line) {
    const tokens = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line))) {
        tokens.push({ text: m[0], start: m.index });
    }
    return tokens;
}

// Given a matched schema and the header line, build a column descriptor:
// [{field, start, end}] where end is the next header token's start (or EOL).
function buildColumns(schema, tokens) {
    const columns = [];
    for (let i = 0; i < tokens.length; i++) {
        const field = schema.cols[tokens[i].text];
        if (!field) {
            continue;
        }
        const start = tokens[i].start;
        const end = i + 1 < tokens.length ? tokens[i + 1].start : Infinity;
        columns.push({ field, start, end });
    }
    return columns;
}

/**
 * Streaming parser for a device's fixed-width STATUS output. Fed one line at a
 * time (as lines arrive off the socket); holds the active table across calls.
 */
class MatrixStatusParser {
    /** Create a parser with no active table. */
    constructor() {
        this.reset();
    }

    /** Forget the active table (call on a response boundary / divider). */
    reset() {
        this._table = null; // active grid table {kind, single, columns}
        this._kvm = null; // active KVM sub-section: 'gpioOut' | 'gpioIn' | null
        this._dsp = null; // pending SW42DA DSP data row: 'master' | 'arc' | null
    }

    /**
     * Feed one STATUS line and return the state updates it produces.
     *
     * @param {string} line - a single raw line from the device
     * @param {object} def - the active MODEL_DEFINITIONS entry
     * @returns {Array<{id: string, val: (string|number|boolean)}>} state updates (possibly empty)
     */
    feed(line, def) {
        const family = resolveFamily(def);
        if (!family) {
            return [];
        }

        const trimmed = line.trim();
        if (!trimmed) {
            return [];
        }

        // Any divider ("====", "===== RS232 01") ends the current table/section.
        if (/^=/.test(trimmed)) {
            this._table = null;
            this._kvm = null;
            this._dsp = null;
            return [];
        }

        // KVM has no grid tables — routing (HOST), GPIO and cascade rows are
        // matched directly.
        if (family === 'kvm') {
            return this._feedKvm(trimmed, def);
        }

        // SW42DA Dante/DSP telemetry (duplicate/multi-token headers unfit for the
        // grid engine) is matched by dedicated handlers before the grid logic.
        if (family === 'swBasic' && def.hasDanteDsp) {
            const dsp = this._feedDsp(trimmed);
            if (dsp) {
                return dsp;
            }
        }

        const schemas = FAMILIES[family];
        const tokens = tokenize(line);

        // Header detection first, so a new table header is never mis-read as the
        // previous table's data row.
        const firstTok = tokens[0] && tokens[0].text;
        for (const schema of schemas) {
            if (!schema.first.includes(firstTok)) {
                continue;
            }
            const names = new Set(tokens.map(t => t.text));
            if (!schema.require.every(r => names.has(r))) {
                continue;
            }
            this._table = {
                kind: schema.kind,
                single: !!schema.single,
                columns: schema.kind === 'mode' ? null : buildColumns(schema, tokens),
            };
            return [];
        }

        // Data row for the active table.
        if (!this._table) {
            return [];
        }
        const table = this._table;

        if (table.kind === 'mode') {
            this._table = null;
            return this._emitMode(trimmed, def);
        }

        const fields = {};
        for (const c of table.columns) {
            const end = c.end === Infinity ? line.length : c.end;
            fields[c.field] = line.substring(c.start, end).trim();
        }

        const updates = this._emit(table.kind, fields, def);
        if (table.single) {
            this._table = null;
        }
        return updates;
    }

    /**
     * MX44KVM STATUS. Matches the routing, GPIO and cascade rows directly (the
     * output is a mix of crosspoint grids and labelled rows, not a single grid):
     *  - "HOST:  1 1 1 1"   → output.N.source (device N bonded to host value)
     *  - "GPIOOUT:/GPIOIN:" headers then " 1  Close  -" → gpio.{output,input}.N
     *  - "OUT:  00 00 00 00" → usb.cascadeOut.N ; "FR: …" → usb.cascadeFrom.N
     *
     * @param {string} line - a trimmed STATUS line
     * @param {object} def - the active MODEL_DEFINITIONS entry
     * @returns {Array<{id: string, val: (string|number|boolean)}>} state updates
     */
    _feedKvm(line, def) {
        // GPIO section headers set the context for the numeric rows that follow.
        if (/^GPIOOUT:/i.test(line)) {
            this._kvm = 'gpioOut';
            return [];
        }
        if (/^GPIOIN:/i.test(line)) {
            this._kvm = 'gpioIn';
            return [];
        }

        // Routing: each USB device is bonded to a host.
        let m;
        if ((m = line.match(/^HOST:\s+(.+)$/i))) {
            this._kvm = null;
            const hosts = m[1].trim().split(/\s+/);
            const updates = [];
            for (let i = 0; i < hosts.length && i < def.outputs; i++) {
                const p = port2(hosts[i]);
                if (p && parseInt(p, 10) > 0) {
                    updates.push({ id: `output.${i + 1}.source`, val: p });
                }
            }
            return updates;
        }

        // Cascade: OUT: is per-device, FR: is per-host (00 = none).
        if ((m = line.match(/^OUT:\s+(.+)$/i))) {
            this._kvm = null;
            return this._kvmCascade(m[1], 'usb.cascadeOut');
        }
        if ((m = line.match(/^FR:\s+(.+)$/i))) {
            this._kvm = null;
            return this._kvmCascade(m[1], 'usb.cascadeFrom');
        }

        // GPIO data rows (" 1  Close  -") within an active GPIO section. The mode
        // is always a word — this also rejects the numeric Preset rows that follow
        // the GPIO section (e.g. "01  0  0  0  0") while _kvm is still set.
        if (this._kvm) {
            const t = line.split(/\s+/);
            const idx = parseInt(t[0], 10);
            if (idx >= 1 && idx <= 4 && t[1] && /^[A-Za-z]/.test(t[1])) {
                const tree = this._kvm === 'gpioOut' ? 'output' : 'input';
                return [{ id: `gpio.${tree}.${idx}`, val: t[1] }];
            }
        }
        return [];
    }

    /**
     * Parse a KVM cascade row's space-separated values into numbered states.
     *
     * @param {string} rest - the row text after "OUT:"/"FR:"
     * @param {string} prefix - state id prefix (e.g. "usb.cascadeOut")
     * @returns {Array<{id: string, val: (string|number|boolean)}>} state updates
     */
    _kvmCascade(rest, prefix) {
        const vals = rest.trim().split(/\s+/);
        const updates = [];
        for (let i = 0; i < vals.length && i < 4; i++) {
            const n = parseInt(vals[i], 10);
            if (!Number.isNaN(n)) {
                updates.push({ id: `${prefix}.${i + 1}`, val: n });
            }
        }
        return updates;
    }

    /**
     * SW42DA Dante/DSP telemetry. Returns null when the line is not a DSP line
     * (so the caller falls back to the grid engine), [] when a DSP header is
     * consumed, or the updates decoded from a pending DSP data row.
     *
     * @param {string} trimmed - a trimmed STATUS line
     * @returns {?Array<{id: string, val: (string|number|boolean)}>} updates, [] or null
     */
    _feedDsp(trimmed) {
        // Pending data row from a DSP header seen on the previous line.
        if (this._dsp === 'master') {
            this._dsp = null;
            const t = trimmed.split(/\s+/);
            const out = [];
            const vol = trailingInt(t[0]);
            const mute = boolOn(t[1]);
            if (vol !== null) {
                out.push({ id: 'audio.volume', val: vol });
            }
            if (mute !== null) {
                out.push({ id: 'audio.mute', val: mute });
            }
            return out;
        }
        if (this._dsp === 'arc') {
            this._dsp = null;
            // Only a bare token is a value ("Source"); anything else is another
            // header or free text following the table, so leave the state alone.
            const val = trimmed.split(/\s+/)[0];
            return /^[A-Za-z0-9_-]+$/.test(val) ? [{ id: 'audio.arcMode', val }] : [];
        }

        // DSP header detection. "Master Output  Mute  Master Output  …" (the first
        // two columns are the master volume + mute) and "ARC_Mode  …".
        const first = trimmed.split(/\s+/)[0];
        if (first === 'Master' && /\bMute\b/.test(trimmed)) {
            this._dsp = 'master';
            return [];
        }
        if (first === 'ARC_Mode') {
            this._dsp = 'arc';
            return [];
        }
        return null;
    }

    /**
     * Interpret a video-wall "Mode" line (Matrix / VideoWall / Multiview).
     *
     * @param {string} value - the mode value line
     * @param {object} def - the active MODEL_DEFINITIONS entry
     * @returns {Array<{id: string, val: (string|number|boolean)}>} a videowall.mode update, or []
     */
    _emitMode(value, def) {
        if (!def.hasVideoWall) {
            return [];
        }
        const v = value.replace(/\s+/g, '').toLowerCase();
        let mode = null;
        if (v.startsWith('matrix')) {
            mode = 'MX';
        } else if (v.startsWith('videowall')) {
            mode = 'VW';
        } else if (v.startsWith('multiview')) {
            mode = 'MV';
        }
        return mode ? [{ id: 'videowall.mode', val: mode }] : [];
    }

    /**
     * Interpret sliced row fields into state updates, gated by capability flags
     * so a state the model never created is never targeted.
     *
     * @param {string} kind - table kind (system/input/output/audio/network/telnet)
     * @param {object} f - canonical field → sliced value string
     * @param {object} def - the active MODEL_DEFINITIONS entry
     * @returns {Array<{id: string, val: (string|number|boolean)}>} state updates
     */
    _emit(kind, f, def) {
        const out = [];
        const push = (id, val) => {
            if (val !== null && val !== undefined) {
                out.push({ id, val });
            }
        };

        switch (kind) {
            case 'system': {
                push('system.power', boolOn(f.power));
                push('system.ir', boolOn(f.ir));
                push('system.key', boolOn(f.key));
                push('system.lcd', boolOn(f.lcd));
                if (def.hasBeep) {
                    push('system.beep', boolOn(f.beep));
                }
                if (def.hasDebug) {
                    push('system.debug', boolOn(f.debug));
                }
                break;
            }
            case 'input': {
                const idx = parseInt(f.idx, 10);
                const maxIn = Object.keys(def.inputs || {}).length || def.inputCount || 16;
                if (!(idx >= 1 && idx <= maxIn)) {
                    break;
                }
                if (def.hasEDID && f.edid != null) {
                    const e = trailingInt(f.edid);
                    if (e !== null) {
                        push(`input.${idx}.edidProfile`, e);
                    }
                }
                if (def.hasCECActions && f.cec != null) {
                    push(`input.${idx}.cecEnabled`, boolOn(f.cec));
                }
                break;
            }
            case 'output': {
                const idx = parseInt(f.idx, 10);
                if (!(idx >= 1 && idx <= (def.outputs || 16))) {
                    break;
                }
                if (f.source != null) {
                    const p = port2(f.source);
                    if (p) {
                        push(`output.${idx}.source`, p);
                    }
                }
                if (def.hasOutputEnable && f.enabled != null) {
                    push(`output.${idx}.enabled`, boolOn(f.enabled));
                }
                if (def.hasPOC && def.isMatrix && f.poc != null) {
                    const v = boolOn(f.poc); // "N/A" → null, leaves state alone
                    if (v !== null) {
                        push(`output.${idx}.poc`, v);
                    }
                }
                if (def.hasCECActions && f.cec != null) {
                    push(`output.${idx}.cecEnabled`, boolOn(f.cec));
                }
                break;
            }
            case 'audio': {
                if (!def.hasAudioMatrix) {
                    break;
                }
                const idx = parseInt(f.idx, 10);
                if (!(idx >= 1 && idx <= (def.outputs || 16))) {
                    break;
                }
                if (f.audioSource != null) {
                    const p = port2(f.audioSource);
                    if (p) {
                        push(`output.${idx}.audioSource`, p);
                    }
                }
                if (f.audioVolume != null) {
                    const v = trailingInt(f.audioVolume);
                    if (v !== null) {
                        push(`output.${idx}.audioVolume`, v);
                    }
                }
                if (f.audioMute != null) {
                    push(`output.${idx}.audioMute`, boolOn(f.audioMute));
                }
                break;
            }
            case 'network': {
                if (!def.hasNetwork) {
                    break;
                }
                push('network.dhcp', boolOn(f.dhcp));
                if (f.ip) {
                    push('network.ip', normIp(f.ip));
                }
                if (f.gateway) {
                    push('network.gateway', normIp(f.gateway));
                }
                if (f.subnet) {
                    push('network.subnet', normIp(f.subnet));
                }
                break;
            }
            case 'telnet': {
                if (!def.hasNetwork) {
                    break;
                }
                if (f.telnetPort && /^\d+$/.test(f.telnetPort.trim())) {
                    push('network.telnetPort', String(parseInt(f.telnetPort.trim(), 10)));
                }
                break;
            }
        }
        return out;
    }
}

module.exports = { MatrixStatusParser, resolveFamily };

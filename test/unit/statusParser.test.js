'use strict';

// Unit tests for the fixed-width STATUS parser, driven by real device captures
// in protocols/Status Feedback/. Each capture is streamed line-by-line through a
// fresh MatrixStatusParser (exactly as main.js feeds it) and the resulting
// {id: val} state map is asserted against the known device state.

const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');
const { MatrixStatusParser, resolveFamily } = require('../../lib/statusParser');
const { MODEL_DEFINITIONS } = require('../../lib/models');

const SAMPLE_DIR = path.join(__dirname, '..', '..', 'protocols', 'Status Feedback');

// Stream every non-empty line of a capture file through one parser and collapse
// the emitted updates into a last-value-wins map (mirrors setStateAsync).
function parseFile(modelKey, file) {
    const def = MODEL_DEFINITIONS[modelKey];
    expect(def, `model def "${modelKey}" exists`).to.be.an('object');
    const parser = new MatrixStatusParser();
    const text = fs.readFileSync(path.join(SAMPLE_DIR, file), 'utf8');
    const state = {};
    let count = 0;
    for (const raw of text.split(/\r?\n/)) {
        for (const u of parser.feed(raw, def)) {
            state[u.id] = u.val;
            count++;
        }
    }
    return { state, count };
}

describe('statusParser — family resolution', () => {
    const cases = {
        c88cs: 'hdbt',
        hmx88_18g: 'hdbt',
        hmxl42arc: 'hdbt',
        pla88cs: 'hdbt',
        pro88hbtcs: 'hdbt',
        cmx44cs: 'hdmi',
        mx44abv2: 'hdmi',
        sw41hdbt: 'swHdbt',
        sw21abv3: 'swBasic',
        sw41ab8k: 'swBasic',
        sw42da: 'swBasic',
        mx44avw: 'videowall',
        mx44kvm: 'kvm',
        mv41: null, // spaceless STATUS headers — not a parseable grid
    };
    for (const [key, family] of Object.entries(cases)) {
        it(`${key} → ${family}`, () => {
            expect(resolveFamily(MODEL_DEFINITIONS[key])).to.equal(family);
        });
    }
});

describe('statusParser — C88CS (HDBaseT matrix)', () => {
    const { state } = parseFile('c88cs', 'C88CS_STATUS.txt');
    it('system row', () => {
        expect(state['system.power']).to.equal(true);
        expect(state['system.ir']).to.equal(true);
        expect(state['system.key']).to.equal(true);
        expect(state['system.lcd']).to.equal(false); // LCD OFF
    });
    it('routing + enable + PoC (ON, not YES)', () => {
        expect(state['output.1.source']).to.equal('04');
        expect(state['output.8.source']).to.equal('04');
        expect(state['output.1.enabled']).to.equal(true);
        expect(state['output.1.poc']).to.equal(true);
    });
    it('EDID read-back (Default_00 → 0)', () => {
        expect(state['input.1.edidProfile']).to.equal(0);
    });
    it('no CEC states (C-series is not hasCECActions)', () => {
        expect(state).to.not.have.property('input.1.cecEnabled');
        expect(state).to.not.have.property('output.1.cecEnabled');
    });
    it('network', () => {
        expect(state['network.dhcp']).to.equal(false);
        expect(state['network.ip']).to.equal('192.168.0.200');
    });
});

describe('statusParser — HMX88-18G (audio matrix + CEC)', () => {
    const { state } = parseFile('hmx88_18g', 'HMX88-18G_STATUS.txt');
    it('routing: InputPort is the source column, EnableOutput=ON', () => {
        expect(state['output.1.source']).to.equal('01');
        expect(state['output.8.source']).to.equal('08');
        expect(state['output.1.enabled']).to.equal(true);
        expect(state['output.1.poc']).to.equal(false); // PoC OFF
    });
    it('per-input & per-output CEC', () => {
        expect(state['input.1.cecEnabled']).to.equal(true);
        expect(state['output.1.cecEnabled']).to.equal(true);
    });
    it('audio matrix (AoutPort table)', () => {
        expect(state['output.1.audioSource']).to.equal('01'); // HDBT01
        expect(state['output.1.audioVolume']).to.equal(68);
        expect(state['output.1.audioMute']).to.equal(false);
    });
    it('network + telnet port', () => {
        expect(state['network.dhcp']).to.equal(true);
        expect(state['network.subnet']).to.equal('255.255.255.0');
        expect(state['network.telnetPort']).to.equal('23');
    });
});

describe('statusParser — HMXL42ARC', () => {
    const { state } = parseFile('hmxl42arc', 'HMXL42ARC_STATUS.txt');
    it('routing (OutputPort/InputPort layout with a Switch column)', () => {
        expect(state['output.1.source']).to.equal('01');
        expect(state['output.2.source']).to.equal('02');
        expect(state['output.1.enabled']).to.equal(true);
        expect(state['output.1.poc']).to.equal(true);
    });
    it('EDID read-back', () => {
        expect(state['input.1.edidProfile']).to.equal(0);
    });
});

describe('statusParser — CMX44CS-V2 (HDMI matrix, now grounded)', () => {
    const { state } = parseFile('cmx44cs', 'CMX44CS-V2_STATUS.txt');
    it('routing + enable (OutputEn=ON)', () => {
        expect(state['output.1.source']).to.equal('01');
        expect(state['output.4.source']).to.equal('04');
        expect(state['output.1.enabled']).to.equal(true);
    });
    it('EDID + network', () => {
        expect(state['input.1.edidProfile']).to.equal(0);
        expect(state['network.dhcp']).to.equal(true);
        expect(state['network.gateway']).to.equal('192.168.0.1');
        expect(state['network.telnetPort']).to.equal('23');
    });
});

describe('statusParser — SW41HDBT (HDBaseT switch)', () => {
    const { state } = parseFile('sw41hdbt', 'SW41HDBT_STATUS.txt');
    it('system (On) + routing via SelectInput', () => {
        expect(state['system.power']).to.equal(true);
        expect(state['output.1.source']).to.equal('01');
    });
    it('per-input/output CEC + PoC (N/A leaves poc untouched)', () => {
        expect(state['input.1.cecEnabled']).to.equal(true);
        expect(state['output.1.cecEnabled']).to.equal(true);
        expect(state['output.1.poc']).to.equal(true); // output 1 POC=On
    });
    it('EDID', () => {
        expect(state['input.1.edidProfile']).to.equal(0);
    });
});

describe('statusParser — basic HDMI switchers', () => {
    it('SW21AB-V3: routing only (no EDID state, no enable col)', () => {
        const { state } = parseFile('sw21abv3', 'SW21AB-V3_STATUS.txt');
        expect(state['system.power']).to.equal(true);
        expect(state['output.1.source']).to.equal('01');
        expect(state).to.not.have.property('input.1.edidProfile'); // hasEDID false
    });
    it('SW41AB-8K: spaceless system header is skipped, routing still parsed', () => {
        const { state } = parseFile('sw41ab8k', 'SW41AB-8K_STATUS.txt');
        expect(state['output.1.source']).to.equal('01');
        expect(state).to.not.have.property('system.power'); // header "PowerIrIr_Mode" not a grid
    });
    it('SW42DA-V2: system + routing + Dante-DSP master/ARC read-back', () => {
        const { state } = parseFile('sw42da', 'SW42DA-V2_STATUS.txt');
        expect(state['system.power']).to.equal(true);
        expect(state['system.lcd']).to.equal(false); // LCD Off
        expect(state['output.1.source']).to.equal('01');
        // def models 1 output (switch); the device's 2nd output row is a follower
        expect(state).to.not.have.property('output.2.source');
        // Dante/DSP master volume/mute + ARC mode
        expect(state['audio.volume']).to.equal(100);
        expect(state['audio.mute']).to.equal(true); // Master mute On
        expect(state['audio.arcMode']).to.equal('Source');
        // per-channel Dante/line lists remain unmapped (no state explosion)
        expect(Object.keys(state).filter(k => k.startsWith('audio.')).sort()).to.deep.equal([
            'audio.arcMode',
            'audio.mute',
            'audio.volume',
        ]);
    });
});

describe('statusParser — MX44AVW (video wall)', () => {
    const { state } = parseFile('mx44avw', 'MX44AVW_STATUS.txt');
    it('Mode line → videowall.mode', () => {
        expect(state['videowall.mode']).to.equal('MX'); // "Matrix"
    });
    it('routing + enable (OutputEn=Yes) + EDID', () => {
        expect(state['output.1.source']).to.equal('01');
        expect(state['output.4.source']).to.equal('04');
        expect(state['output.1.enabled']).to.equal(true);
        expect(state['input.1.edidProfile']).to.equal(0);
    });
    it('system', () => {
        expect(state['system.power']).to.equal(true);
    });
});

describe('statusParser — MX44KVM (USB crosspoint)', () => {
    const { state } = parseFile('mx44kvm', 'MX44KVM_STATUS.txt');
    it('HOST row → per-device source', () => {
        expect(state['output.1.source']).to.equal('01');
        expect(state['output.4.source']).to.equal('01');
    });
    it('GPIO in/out modes', () => {
        expect(state['gpio.output.1']).to.equal('Close');
        expect(state['gpio.input.4']).to.equal('Close');
    });
    it('cascade OUT/FR (0 = none)', () => {
        expect(state['usb.cascadeOut.1']).to.equal(0);
        expect(state['usb.cascadeFrom.4']).to.equal(0);
    });

    it('GPIOSTATUS capture parses GPIO in isolation', () => {
        const g = parseFile('mx44kvm', 'MX44KVM_GPIOSTATUS.txt').state;
        expect(g['gpio.output.1']).to.equal('Close');
        expect(g['gpio.input.1']).to.equal('Close');
    });
    it('CASCADESTATUS capture parses cascade in isolation', () => {
        const c = parseFile('mx44kvm', 'MX44KVM_CASCADESTATUS.txt').state;
        expect(c['usb.cascadeOut.1']).to.equal(0);
        expect(c['usb.cascadeFrom.1']).to.equal(0);
    });
});

describe('statusParser — MV41 (unparseable, spaceless headers)', () => {
    it('emits nothing (family null)', () => {
        const { count } = parseFile('mv41', 'MV41_STATUS.txt');
        expect(count).to.equal(0);
    });
});

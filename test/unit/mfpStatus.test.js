'use strict';

// Unit test for the MFP presentation-switcher STATUS read-back in main.js, driven
// by the real MFP72/MFP112 captures in protocols/Status Feedback/ (raw bytes from
// info.rawResponse: tab-delimited, short cells followed by two tabs). Each capture
// is replayed through the adapter's own handleData() as captured and with the tabs
// expanded to spaces (as a terminal shows it), and the written states are asserted.

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { expect } = require('chai');
const { MODEL_DEFINITIONS } = require('../../lib/models');

const SAMPLE_DIR = path.join(__dirname, '..', '..', 'protocols', 'Status Feedback');

// Load the adapter class without a js-controller: stub adapter-core so the class
// can be instantiated bare, and export the class instead of the factory.
function loadAdapterClass() {
    const mainPath = path.join(__dirname, '..', '..', 'main.js');
    const src = fs
        .readFileSync(mainPath, 'utf8')
        .replace(/if \(require\.main !== module\)[\s\S]*$/, 'module.exports = BlustreamAdapter;');
    const origLoad = Module._load;
    Module._load = function (request, ...rest) {
        if (request === '@iobroker/adapter-core') {
            return { Adapter: class {} };
        }
        return origLoad.call(this, request, ...rest);
    };
    try {
        const m = new Module(mainPath, module);
        m.filename = mainPath;
        m.paths = Module._nodeModulePaths(path.dirname(mainPath));
        m._compile(src, mainPath);
        return m.exports;
    } finally {
        Module._load = origLoad;
    }
}

function replay(text, modelKey) {
    const Adapter = loadAdapterClass();
    const adapter = Object.create(Adapter.prototype);
    const state = {};
    Object.assign(adapter, {
        receiveBuffer: '',
        modelDef: MODEL_DEFINITIONS[modelKey],
        commandQueue: [],
        log: { debug() {}, info() {}, warn() {}, error() {} },
        setStateAsync: (id, val) => {
            state[id] = val;
            return Promise.resolve();
        },
        clearTimeout() {},
        processCommandQueue() {},
        _matrixParser: { reset() {}, feed: () => [] },
    });
    adapter.handleData(text.replace(/\r?\n/g, '\r\n'));
    return state;
}

// Expand tabs to 8-column stops, as a terminal renders the reply
const expandTabs = text =>
    text
        .split('\n')
        .map(line => line.replace(/[^\t]*\t/g, seg => seg.slice(0, -1).padEnd(Math.floor((seg.length - 1) / 8) * 8 + 8)))
        .join('\n');

const CASES = {
    mfp72: {
        file: 'MFP72_STATUS.txt',
        expected: {
            'output.mode': 'MX',
            'output.resolution': '05', // 1280x1024@60Hz (ScalerAudio row)
            'output.freqMode': 'AUTO',
            'output.1.source': '01',
            'output.2.source': '01',
            'audio.volume': 30,
            'audio.mute': false,
            'audio.source': 'ORG',
            'output.aspectRatio': '02', // 16:9
            'system.power': true,
            'system.key': false,
        },
        // No output-enable states on the MFP72 — the OutputEn column must not be written
        absent: ['output.1.enabled'],
    },
    mfp112: {
        file: 'MFP112_STATUS.txt',
        expected: {
            'output.mode': 'SP',
            'output.resolution': '01', // 1080P@50Hz (ScalerBypass row)
            'output.freqMode': 'AUTO',
            'output.bypass': false,
            'output.1.source': '01',
            'output.1.enabled': true,
            'audio.volume': 30,
            'audio.source': 'ORG',
            'output.aspectRatio': '00', // FullScreen
            'system.ir232': 'RTX',
            'system.key': true,
        },
        absent: [],
    },
};

for (const [model, c] of Object.entries(CASES)) {
    describe(`${model.toUpperCase()} STATUS read-back`, () => {
        const captured = fs.readFileSync(path.join(SAMPLE_DIR, c.file), 'utf8');
        for (const [label, text] of [
            ['tab-delimited (as captured)', captured],
            ['tab-expanded to spaces', expandTabs(captured)],
        ]) {
            it(`maps scaler/output/system states from a ${label} reply`, () => {
                const s = replay(text, model);
                for (const [id, val] of Object.entries(c.expected)) {
                    expect(s[id], id).to.equal(val);
                }
                for (const id of c.absent) {
                    expect(s).to.not.have.property(id);
                }
            });
        }
    });
}

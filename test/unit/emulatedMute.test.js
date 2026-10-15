'use strict';

// Emulated mute for MFP firmware without a MUTE command. MFP72 FW 2.06 answers "MUTE ON" with
// "[ERROR]Command not found" and its STATUS has no Mute column; FW 2.11 has both. The adapter
// detects which from each unit's own STATUS (captures in protocols/Status Feedback/, taken from
// the live units on 15 October 2026) and, without native mute, mutes by storing the volume and
// sending VOL 00.

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { expect } = require('chai');
const { MODEL_DEFINITIONS } = require('../../lib/models');

const SAMPLE_DIR = path.join(__dirname, '..', '..', 'protocols', 'Status Feedback');

// Same loader as mfpStatus.test.js: stub adapter-core and export the class.
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

const Adapter = loadAdapterClass();

function makeAdapter(initialStates = {}) {
    const adapter = Object.create(Adapter.prototype);
    const state = { ...initialStates };
    const sent = [];
    Object.assign(adapter, {
        receiveBuffer: '',
        modelDef: MODEL_DEFINITIONS.mfp72,
        commandQueue: [],
        _nativeMute: null,
        _emulatedMuted: null,
        _emulatedMuteAt: 0,
        log: { debug() {}, info() {}, warn() {}, error() {} },
        setStateAsync: (id, val) => {
            state[id] = val;
            return Promise.resolve();
        },
        getStateAsync: id => Promise.resolve(id in state ? { val: state[id] } : null),
        sendCommand: cmd => sent.push(cmd),
        clearTimeout() {},
        processCommandQueue() {},
        _matrixParser: { reset() {}, feed: () => [] },
    });
    return { adapter, state, sent };
}

function replay(adapter, file) {
    const text = fs.readFileSync(path.join(SAMPLE_DIR, file), 'latin1');
    adapter.handleData(text.replace(/\r?\n/g, '\r\n'));
}

const flush = () => new Promise(resolve => setImmediate(resolve));

describe('MFP mute capability detection from STATUS', () => {
    it('FW 2.06 (no Mute column) is detected as having no native mute', () => {
        const { adapter, state } = makeAdapter();
        replay(adapter, 'MFP72_FW206_STATUS.txt');
        expect(adapter._nativeMute).to.equal(false);
        expect(state['audio.volume']).to.equal(10);
        expect(state).to.not.have.property('audio.mute');
    });

    it('FW 2.11 (Mute column) is detected as native and reports its mute', () => {
        const { adapter, state } = makeAdapter();
        replay(adapter, 'MFP72_FW211_STATUS.txt');
        expect(adapter._nativeMute).to.equal(true);
        expect(state['audio.volume']).to.equal(17);
        expect(state['audio.mute']).to.equal(true);
    });
});

describe('audio.mute command routing', () => {
    it('native firmware still gets MUTE ON / MUTE OFF', async () => {
        const { adapter, sent } = makeAdapter();
        adapter._nativeMute = true;
        await adapter.onStateChange('blustream-mfp.0.audio.mute', { val: true, ack: false });
        await adapter.onStateChange('blustream-mfp.0.audio.mute', { val: false, ack: false });
        expect(sent).to.deep.equal(['MUTE ON', 'MUTE OFF']);
    });

    it('firmware without MUTE never gets a MUTE command', async () => {
        const { adapter, sent } = makeAdapter({ 'audio.volume': 17 });
        adapter._nativeMute = false;
        await adapter.onStateChange('blustream-mfp.3.audio.mute', { val: true, ack: false });
        expect(sent).to.deep.equal(['VOL 00']);
    });
});

describe('emulated mute', () => {
    it('mute stores the volume and sends VOL 00; unmute restores it', async () => {
        const { adapter, state, sent } = makeAdapter({ 'audio.volume': 17 });
        adapter._nativeMute = false;
        await adapter.setEmulatedMute(true);
        expect(sent).to.deep.equal(['VOL 00']);
        expect(state['audio.preMuteVolume']).to.equal(17);
        expect(state['audio.mute']).to.equal(true);

        state['audio.volume'] = 0; // what the next STATUS reports
        await adapter.setEmulatedMute(false);
        expect(sent).to.deep.equal(['VOL 00', 'VOL 17']);
        expect(state['audio.mute']).to.equal(false);
    });

    it('muting an already-silent unit keeps the level to come back to', async () => {
        const { adapter, state, sent } = makeAdapter({ 'audio.volume': 0, 'audio.preMuteVolume': 22 });
        await adapter.setEmulatedMute(true);
        await adapter.setEmulatedMute(false);
        expect(state['audio.preMuteVolume']).to.equal(22);
        expect(sent).to.deep.equal(['VOL 00', 'VOL 22']);
    });

    it('unmute with nothing stored falls back to the default volume', async () => {
        const { adapter, sent } = makeAdapter();
        await adapter.setEmulatedMute(false);
        expect(sent).to.deep.equal(['VOL 10']);
    });

    it('raising the volume while muted clears the mute', async () => {
        const { adapter, state } = makeAdapter({ 'audio.volume': 17 });
        adapter._nativeMute = false;
        await adapter.setEmulatedMute(true);
        await adapter.onStateChange('blustream-mfp.3.audio.volume', { val: 12, ack: false });
        expect(state['audio.mute']).to.equal(false);
    });

    it('a STATUS reply racing the mute does not cancel it', async () => {
        const { adapter, state } = makeAdapter({ 'audio.volume': 17 });
        adapter._nativeMute = false;
        await adapter.setEmulatedMute(true);
        await adapter.reconcileEmulatedMute(17); // old volume, still within the grace period
        expect(state['audio.mute']).to.equal(true);
    });

    it('volume found above zero after the grace period clears the mute', async () => {
        const { adapter, state } = makeAdapter({ 'audio.volume': 17 });
        adapter._nativeMute = false;
        await adapter.setEmulatedMute(true);
        adapter._emulatedMuteAt = Date.now() - 60000; // front panel used a minute later
        await adapter.reconcileEmulatedMute(14);
        expect(state['audio.mute']).to.equal(false);
    });

    it('after a restart, a stored mute is respected by STATUS reconciliation', async () => {
        // _emulatedMuted starts null and is read back from audio.mute
        const { adapter, state } = makeAdapter({ 'audio.mute': true, 'audio.volume': 0 });
        replay(adapter, 'MFP72_FW206_STATUS.txt'); // reports volume 10 > 0
        await flush();
        expect(adapter._emulatedMuted).to.equal(false);
        expect(state['audio.mute']).to.equal(false);
    });
});

'use strict';

const utils = require('@iobroker/adapter-core');
const net = require('node:net');
const { MatrixStatusParser } = require('./lib/statusParser');

// Telnet IAC (Interpret As Command) constants
const IAC = 255; // Interpret As Command
const DONT = 254; // Refuse to perform option
const DO = 253; // Request to perform option
const WONT = 252; // Refuse to perform option
const WILL = 251; // Agree to perform option
const SB = 250; // Subnegotiation Begin
const SE = 240; // Subnegotiation End

// Model definitions (see lib/models.js — kept dependency-free for reuse + tests)
const { MODEL_DEFINITIONS } = require('./lib/models');

// CEC discrete-action option maps (written to output.N.cecAction / input.N.cecAction,
// each write sends `OUT/IN xx CEC <value>`). Superset from the HMX-18G API; SW41HDBT
// implements a subset (unsupported actions are simply ignored by the device).
const CEC_OUTPUT_ACTIONS = {
    PON: 'Power On',
    POFF: 'Power Off',
    VOLUP: 'Volume Up',
    VOLDOWN: 'Volume Down',
    MUTE: 'Mute Toggle',
    OK: 'OK / Enter',
    UP: 'Up',
    DOWN: 'Down',
    LEFT: 'Left',
    RIGHT: 'Right',
    RETURN: 'Return',
    EXIT: 'Exit',
    PLAY: 'Play',
    STOP: 'Stop',
    PAUSE: 'Pause',
    RECORD: 'Record',
};
const CEC_INPUT_ACTIONS = {
    PON: 'Power On',
    POFF: 'Power Off',
    VOLUP: 'Volume Up',
    VOLDOWN: 'Volume Down',
    OK: 'OK / Enter',
    UP: 'Up',
    DOWN: 'Down',
    LEFT: 'Left',
    RIGHT: 'Right',
    MENU: 'Menu',
    RETURN: 'Return',
    EXIT: 'Exit',
    PLAY: 'Play',
    STOP: 'Stop',
    PAUSE: 'Pause',
    RECORD: 'Record',
    REWIND: 'Rewind',
    FF: 'Fast Forward',
    FWD: 'Forward',
    BWD: 'Backward',
};

// Bump whenever the shape of the model-driven state tree changes in a way that
// existing installs must pick up (new states, changed common.states enum lists,
// renamed paths). Every object is created with setObjectNotExistsAsync, which
// never rewrites an object that already exists, so a version bump is the only
// way a running instance rebuilds its tree. Stored in info.stateSchema.
//
// 2 — 0.5.2: forced rebuild. Until 0.5.2 the model-change purge never ran
//     (info.model was overwritten before it was compared), so installs that
//     switched model kept the previous model's states — e.g. an MFP112 left with
//     the default MFP72 input list, missing HDBaseT on output.N.source.
const STATE_SCHEMA_VERSION = 2;

// Upper bound on the lines buffered for info.rawResponse. A model whose reply
// carries no recognised terminator would otherwise accumulate lines for the
// lifetime of the instance; flushing at this size keeps the state useful and the
// memory bounded. A full 16x16 STATUS reply is well under this.
const MAX_RESPONSE_LINES = 200;

// Union of every state path any supported model creates. Used only to purge
// orphaned objects when the configured model changes (each entry is deleted
// recursively). Keep this in sync with the setObjectNotExistsAsync calls in
// setupModelStates(); do not list states that are never created.
const ALL_MODEL_STATES = [
    'system',
    'system.power',
    'system.ir',
    'system.key',
    'system.beep',
    'system.lcd',
    'system.osd',
    'system.debug',
    'system.ir232',
    'system.autoSwitch',
    'system.telnetNegotiation',
    'system.videoMute',
    'system.standbyMode',
    'system.standbyDelay',
    'system.noSignalStandby',
    'system.noSignalDelay',
    'system.pocOutput',
    'system.reboot',
    'output',
    // Per-output channels + every state any model attaches to them, for outputs
    // 1..16 (largest matrix is 16x16: PRO16HBT / CUSTOMPRO-HUB16). Deleting
    // `output.N` recursively also removes its children, but listing them keeps
    // the purge explicit and order-independent.
    ...Array.from({ length: 16 }, (_, k) => k + 1).flatMap(i => [
        `output.${i}`,
        `output.${i}.source`,
        `output.${i}.enabled`,
        `output.${i}.videoMute`,
        `output.${i}.sidebar`,
        `output.${i}.brightness`,
        `output.${i}.contrast`,
        `output.${i}.pictureMode`,
        `output.${i}.colourTemp`,
        `output.${i}.audioMix`,
        `output.${i}.cecEnabled`,
        `output.${i}.poc`,
    ]),
    'output.allSource',
    'output.mode',
    'output.bypass',
    'output.resolution',
    'output.aspectRatio',
    'output.zoom',
    'output.overscan',
    'output.freqMode',
    'output.displayMode',
    'output.layout',
    'videowall',
    'videowall.mode',
    'videowall.vwSource',
    'videowall.audioSource',
    'input',
    // Per-input channels + states any model attaches (up to 16 inputs on 16x16
    // matrices). Recursive delete of `input.N` also removes its children.
    ...Array.from({ length: 16 }, (_, k) => k + 1).flatMap(i => [
        `input.${i}`,
        `input.${i}.type`,
        `input.${i}.edidProfile`,
        `input.${i}.edidCopyFrom`,
        `input.${i}.cecEnabled`,
        `input.${i}.cecAction`,
        `input.${i}.audioEmbed`,
    ]),
    'presets',
    'presets.save',
    'presets.apply',
    'presets.clear',
    'audio',
    'audio.volume',
    'audio.mute',
    'audio.source',
    'audio.pcmMode',
    'audio.mode',
    'audio.output',
    'audio.arcMode',
    'audio.hdmi',
    'audio.hdmi.input1',
    'audio.hdmi.input2',
    'audio.hdmi.input3',
    'audio.hdmi.input4',
    'audio.rx',
    'audio.rx.input1',
    'audio.rx.input2',
    'audio.rx.input3',
    'audio.rx.input4',
    'audio.rx.input5',
    'microphone',
    'microphone.volume',
    'microphone.mute',
    'microphone.mixMode',
    'microphone.autoBg',
    'microphone.bgVolume',
    'microphone.bgDelay',
    'microphone.rampUp',
    'microphone.rampDown',
    'network',
    'network.dhcp',
    'network.ip',
    'network.gateway',
    'network.subnet',
    'network.telnetPort',
    'network.reboot',
    'network.lan1',
    'network.lan1.dhcp',
    'network.lan1.ip',
    'network.lan1.gateway',
    'network.lan1.subnet',
    'network.lan1.tcpPort',
    'network.lan2',
    'network.lan2.dhcp',
    'network.lan2.ip',
    'network.lan2.gateway',
    'network.lan2.subnet',
    'network.lan2.tcpPort',
    'wifi',
    'wifi.enabled',
    'wifi.frequency',
    'wifi.channel',
    'wifi.ssid',
    'wifi.password',
    'cec',
    'cec.input1',
    'cec.input2',
    'cec.input3',
    'cec.input4',
    // KVM (MX44KVM) GPIO + USB cascade telemetry (fixed 4 ports each).
    // Channels first, then the leaf states created under them. (Recursive delete
    // of gpio/usb would purge children anyway, but keep the list in sync.)
    'gpio',
    'gpio.output',
    'gpio.input',
    'usb',
    'usb.cascadeOut',
    'usb.cascadeFrom',
    ...Array.from({ length: 4 }, (_, k) => k + 1).flatMap(i => [
        `gpio.output.${i}`,
        `gpio.input.${i}`,
        `usb.cascadeOut.${i}`,
        `usb.cascadeFrom.${i}`,
    ]),
    'commands.vgaAutoAdjust',
    'commands.homeScreen',
];

class BlustreamAdapter extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: 'blustream-mfp',
        });

        this.socket = null;
        this.serialPort = null;
        this.connected = false;
        this.reconnectTimer = null;
        this.pollingTimer = null;
        this.receiveBuffer = '';
        this.commandQueue = [];
        this.isProcessingQueue = false;
        this.currentCommand = null;
        this.commandTimeout = null;
        this.modelDef = null;
        this._statusHeaders = null;
        this._responseLines = null;
        this._matrixParser = new MatrixStatusParser();

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        this.log.info('Blustream adapter starting...');
        this.log.info(`Connection type: ${this.config.connectionType}`);
        this.log.info(`Device model: ${this.config.deviceModel}`);

        // Get model definition
        this.modelDef = MODEL_DEFINITIONS[this.config.deviceModel] || MODEL_DEFINITIONS.mfp72;

        // Read the previously configured model BEFORE overwriting info.model —
        // setupModelStates() compares against it to decide whether to purge and
        // recreate the state tree.
        const lastModelState = await this.getStateAsync('info.model');
        const lastModel = (lastModelState && lastModelState.val) || null;

        // A tree built by an older schema must be rebuilt even when the model is
        // unchanged (see STATE_SCHEMA_VERSION). Created here as well as in
        // io-package.json instanceObjects, because instances installed before
        // 0.5.2 have no such object.
        await this.setObjectNotExistsAsync('info.stateSchema', {
            type: 'state',
            common: {
                role: 'value',
                name: 'State tree schema version',
                type: 'number',
                read: true,
                write: false,
                def: 0,
            },
            native: {},
        });
        const schemaState = await this.getStateAsync('info.stateSchema');
        const lastSchema = schemaState && typeof schemaState.val === 'number' ? schemaState.val : 0;

        // Clean up states from other models and create current model states
        await this.setupModelStates(lastModel, lastSchema);

        // Both markers are written only once the tree has actually been built. If
        // setupModelStates() throws or the instance is stopped part-way through, the
        // old values survive and the next start retries the rebuild.
        await this.setStateAsync('info.model', this.modelDef.name, true);
        await this.setStateAsync('info.stateSchema', STATE_SCHEMA_VERSION, true);

        await this.setStateAsync('info.connection', false, true);

        this.subscribeStates('*');

        this.connect();
    }

    async setupModelStates(lastModel, lastSchema) {
        const model = this.config.deviceModel || 'mfp72';
        const def = this.modelDef;

        this.log.info(`Setting up states for model: ${def.name}`);

        // Delete and recreate states when the model has changed, or when the tree
        // was built by an older schema version. lastModel is read by onReady
        // before info.model is overwritten with the current model.
        const modelChanged = lastModel !== def.name;
        const schemaStale = lastSchema !== STATE_SCHEMA_VERSION;

        if (modelChanged || schemaStale) {
            if (schemaStale && !modelChanged) {
                this.log.info(
                    `State schema ${lastSchema} is older than ${STATE_SCHEMA_VERSION}, recreating states for ${def.name}`,
                );
            } else {
                this.log.info(`Model changed from ${lastModel || 'none'} to ${def.name}, recreating states`);
            }
            for (const statePath of ALL_MODEL_STATES) {
                try {
                    await this.delObjectAsync(statePath, { recursive: true });
                } catch {
                    // Ignore errors - state might not exist
                }
            }
        }

        // Create system channel and common states
        await this.setObjectNotExistsAsync('system', {
            type: 'channel',
            common: { name: 'System Control' },
            native: {},
        });

        await this.setObjectNotExistsAsync('system.power', {
            type: 'state',
            common: {
                role: 'switch.power',
                name: 'Power',
                type: 'boolean',
                read: true,
                write: true,
                def: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('system.ir', {
            type: 'state',
            common: {
                role: 'switch.enable',
                name: 'IR Control',
                type: 'boolean',
                read: true,
                write: true,
                def: true,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('system.key', {
            type: 'state',
            common: {
                role: 'switch.enable',
                name: 'Key Control',
                type: 'boolean',
                read: true,
                write: true,
                def: true,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('system.lcd', {
            type: 'state',
            common: {
                role: 'switch.enable',
                name: 'LCD Always On',
                type: 'boolean',
                read: true,
                write: true,
                def: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('system.osd', {
            type: 'state',
            common: {
                role: 'switch.enable',
                name: 'OSD Display',
                type: 'boolean',
                read: true,
                write: true,
                def: true,
            },
            native: {},
        });

        // Model-specific system states
        if (def.hasBeep) {
            await this.setObjectNotExistsAsync('system.beep', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'Beep',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: true,
                },
                native: {},
            });
        }

        if (def.hasDebug) {
            await this.setObjectNotExistsAsync('system.debug', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'Debug Mode',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });
        }

        if (def.hasAutoSwitch) {
            await this.setObjectNotExistsAsync('system.autoSwitch', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'Auto Switch Input',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });
        }

        if (def.hasIR232) {
            await this.setObjectNotExistsAsync('system.ir232', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'IR232 Valens Connection',
                    type: 'string',
                    read: true,
                    write: true,
                    states: {
                        OFF: 'Disconnected',
                        RRX: 'Remote RX',
                        RTX: 'Remote TX',
                        BOTH: 'Both RX and TX',
                    },
                    def: 'OFF',
                },
                native: {},
            });
        }

        // Telnet IAC negotiation toggle (runtime-changeable)
        await this.setObjectNotExistsAsync('system.telnetNegotiation', {
            type: 'state',
            common: {
                role: 'switch.enable',
                name: 'Telnet IAC Negotiation',
                type: 'boolean',
                read: true,
                write: true,
                def: true,
            },
            native: {},
        });
        // Use existing state value if available, otherwise fall back to adapter config
        const telnetState = await this.getStateAsync('system.telnetNegotiation');
        if (telnetState && telnetState.val !== null) {
            this.config.telnetNegotiation = !!telnetState.val;
        } else {
            await this.setStateAsync('system.telnetNegotiation', this.config.telnetNegotiation !== false, true);
        }

        // Create output channel and states
        await this.setObjectNotExistsAsync('output', {
            type: 'channel',
            common: { name: 'Output Control' },
            native: {},
        });

        // Create output states for each output
        for (let i = 1; i <= def.outputs; i++) {
            await this.setObjectNotExistsAsync(`output.${i}`, {
                type: 'channel',
                common: { name: `Output ${i}` },
                native: {},
            });

            // Build source list for this output
            let sources = { ...def.inputs };
            if (i === 2 && def.output2ExtraInputs) {
                sources = { ...sources, ...def.output2ExtraInputs };
            }

            await this.setObjectNotExistsAsync(`output.${i}.source`, {
                type: 'state',
                common: {
                    role: 'media.input',
                    name: `Output ${i} Source`,
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: sources,
                },
                native: {},
            });

            if (def.hasOutputEnable) {
                await this.setObjectNotExistsAsync(`output.${i}.enabled`, {
                    type: 'state',
                    common: {
                        role: 'switch.enable',
                        name: `Output ${i} Enabled`,
                        type: 'boolean',
                        read: true,
                        write: true,
                        def: true,
                    },
                    native: {},
                });
            }
        }

        // Route-all control (multi-output matrices): OUT 00 FR yy sets every
        // output to one input. Write-only (there is no single "current" value for
        // all). Single-output switches (SW-series) don't need it, and the KVM
        // matrix (noAllSource) has no "all hosts" route form.
        if (def.isMatrix && def.outputs > 1 && !def.noAllSource) {
            await this.setObjectNotExistsAsync('output.allSource', {
                type: 'state',
                common: {
                    role: 'media.input',
                    name: 'All Outputs Source',
                    type: 'string',
                    read: false,
                    write: true,
                    def: '',
                    states: { ...def.inputs },
                },
                native: {},
            });
        }

        // Video-wall / multi-view controls (MX44VW / MX44AVW / MV41). Matrix-mode
        // and multi-view-window routing reuse output.N.source (OUT xx FR yy); these
        // states add the mode switch, VW source, bezel and multi-view audio.
        if (def.hasVideoWall) {
            await this.setObjectNotExistsAsync('videowall', {
                type: 'channel',
                common: { name: 'Video Wall / Multi-View' },
                native: {},
            });
            await this.setObjectNotExistsAsync('videowall.mode', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Output Mode',
                    type: 'string',
                    read: true,
                    write: true,
                    def: 'MX',
                    states: {
                        MX: 'Matrix',
                        MV: 'Multi-View',
                        VW: 'Video Wall',
                        VW22: 'Video Wall 2x2',
                        VW41: 'Video Wall 4x1',
                        VW14: 'Video Wall 1x4',
                        MV0: 'Multi-View Layout 0',
                        MV1: 'Multi-View Layout 1',
                        MV2: 'Multi-View Layout 2',
                        MV3: 'Multi-View Layout 3',
                    },
                },
                native: {},
            });
            await this.setObjectNotExistsAsync('videowall.vwSource', {
                type: 'state',
                common: {
                    role: 'media.input',
                    name: 'Video Wall Source',
                    type: 'string',
                    read: false,
                    write: true,
                    def: '',
                    states: { ...def.inputs },
                },
                native: {},
            });
            await this.setObjectNotExistsAsync('videowall.audioSource', {
                type: 'state',
                common: {
                    role: 'media.input',
                    name: 'Multi-View Audio Source',
                    type: 'string',
                    read: false,
                    write: true,
                    def: '',
                    states: { '00': 'Follow Window 1', ...def.inputs },
                },
                native: {},
            });
            // Per-output bezel pixel-shift (video-wall mode), 0..100 px each edge
            for (let i = 1; i <= def.outputs; i++) {
                for (const edge of [
                    ['bezelLeft', 'Left', 'VCL'],
                    ['bezelRight', 'Right', 'VCR'],
                    ['bezelTop', 'Top', 'VCT'],
                    ['bezelBottom', 'Bottom', 'VCB'],
                ]) {
                    await this.setObjectNotExistsAsync(`output.${i}.${edge[0]}`, {
                        type: 'state',
                        common: {
                            role: 'level',
                            name: `Output ${i} Bezel ${edge[1]} (px)`,
                            type: 'number',
                            read: true,
                            write: true,
                            def: 0,
                            min: 0,
                            max: 100,
                        },
                        native: {},
                    });
                }
            }
        }

        // Per-input features: signal type (VGA models), EDID management (all
        // matrices), CEC input actions (HMX-18G / SW41HDBT), audio embed (Pro).
        if (def.hasVGAInputs || def.hasEDID || def.hasCECActions || def.hasAudioEmbed) {
            const inCount = def.inputCount || Object.keys(def.inputs || {}).length;
            await this.setObjectNotExistsAsync('input', {
                type: 'channel',
                common: { name: 'Inputs' },
                native: {},
            });
            for (let i = 1; i <= inCount; i++) {
                await this.setObjectNotExistsAsync(`input.${i}`, {
                    type: 'channel',
                    common: { name: `Input ${i}` },
                    native: {},
                });
                if (def.hasVGAInputs) {
                    await this.setObjectNotExistsAsync(`input.${i}.type`, {
                        type: 'state',
                        common: {
                            role: 'state',
                            name: `Input ${i} Signal Type`,
                            type: 'string',
                            read: true,
                            write: true,
                            def: 'HDMI',
                            states: { HDMI: 'HDMI', VGA: 'VGA' },
                        },
                        native: {},
                    });
                }
                if (def.hasEDID) {
                    await this.setObjectNotExistsAsync(`input.${i}.edidProfile`, {
                        type: 'state',
                        common: {
                            role: 'level',
                            name: `Input ${i} EDID Profile (see protocol doc)`,
                            type: 'number',
                            read: true,
                            write: true,
                            def: 0,
                            min: 0,
                            max: 40,
                        },
                        native: {},
                    });
                    await this.setObjectNotExistsAsync(`input.${i}.edidCopyFrom`, {
                        type: 'state',
                        common: {
                            role: 'level',
                            name: `Input ${i} EDID Copy From Output (0 = off)`,
                            type: 'number',
                            read: false,
                            write: true,
                            def: 0,
                            min: 0,
                            max: def.outputs,
                        },
                        native: {},
                    });
                }
                if (def.hasCECActions) {
                    await this.setObjectNotExistsAsync(`input.${i}.cecEnabled`, {
                        type: 'state',
                        common: {
                            role: 'switch.enable',
                            name: `Input ${i} CEC Enabled`,
                            type: 'boolean',
                            read: true,
                            write: true,
                            def: false,
                        },
                        native: {},
                    });
                    await this.setObjectNotExistsAsync(`input.${i}.cecAction`, {
                        type: 'state',
                        common: {
                            role: 'state',
                            name: `Input ${i} CEC Action`,
                            type: 'string',
                            read: false,
                            write: true,
                            def: '',
                            states: CEC_INPUT_ACTIONS,
                        },
                        native: {},
                    });
                }
                if (def.hasAudioEmbed) {
                    await this.setObjectNotExistsAsync(`input.${i}.audioEmbed`, {
                        type: 'state',
                        common: {
                            role: 'state',
                            name: `Input ${i} Audio Embed`,
                            type: 'string',
                            read: true,
                            write: true,
                            def: 'ORG',
                            states: { ORG: 'Original (HDMI)', ANA: 'Analogue L/R', AUTO: 'Auto (analogue on DVI)' },
                        },
                        native: {},
                    });
                }
            }
        }

        // Per-output audio + CEC actions. Audio APIs differ by family:
        //  hasAudioMatrix (HMX-18G): audio route/mute/volume/ARC per output.
        //  hasAudioEmbed  (Pro-Matrix): per-output audio mute only.
        //  hasCECActions  (HMX-18G/SW41HDBT): per-output CEC enable + action.
        if (def.hasCECActions || def.hasAudioMatrix || def.hasAudioEmbed) {
            for (let i = 1; i <= def.outputs; i++) {
                if (def.hasCECActions) {
                    await this.setObjectNotExistsAsync(`output.${i}.cecEnabled`, {
                        type: 'state',
                        common: {
                            role: 'switch.enable',
                            name: `Output ${i} CEC Enabled`,
                            type: 'boolean',
                            read: true,
                            write: true,
                            def: false,
                        },
                        native: {},
                    });
                    await this.setObjectNotExistsAsync(`output.${i}.cecAction`, {
                        type: 'state',
                        common: {
                            role: 'state',
                            name: `Output ${i} CEC Action`,
                            type: 'string',
                            read: false,
                            write: true,
                            def: '',
                            states: CEC_OUTPUT_ACTIONS,
                        },
                        native: {},
                    });
                }
                if (def.hasAudioMatrix) {
                    await this.setObjectNotExistsAsync(`output.${i}.audioSource`, {
                        type: 'state',
                        common: {
                            role: 'media.input',
                            name: `Output ${i} Audio Source`,
                            type: 'string',
                            read: true,
                            write: true,
                            def: '',
                            states: { ...def.inputs },
                        },
                        native: {},
                    });
                    await this.setObjectNotExistsAsync(`output.${i}.audioVolume`, {
                        type: 'state',
                        common: {
                            role: 'level.volume',
                            name: `Output ${i} Audio Volume`,
                            type: 'number',
                            read: true,
                            write: true,
                            def: 0,
                            min: 0,
                            max: 100,
                        },
                        native: {},
                    });
                    await this.setObjectNotExistsAsync(`output.${i}.arcMode`, {
                        type: 'state',
                        common: {
                            role: 'state',
                            name: `Output ${i} ARC Mode`,
                            type: 'string',
                            read: true,
                            write: true,
                            def: '',
                            states: { '01': 'ARC from Optical', '02': 'ARC from HDMI' },
                        },
                        native: {},
                    });
                }
                if (def.hasAudioMatrix || def.hasAudioEmbed) {
                    await this.setObjectNotExistsAsync(`output.${i}.audioMute`, {
                        type: 'state',
                        common: {
                            role: 'media.mute',
                            name: `Output ${i} Audio Mute`,
                            type: 'boolean',
                            read: true,
                            write: true,
                            def: false,
                        },
                        native: {},
                    });
                }
            }
        }

        // Output mode (splitter/matrix) - for MFP72/MFP112. True crosspoint
        // matrices (C66/C88) have no SP/MX toggle, so exclude them.
        if (!def.hasAutoSwitch && !def.isMatrix) {
            await this.setObjectNotExistsAsync('output.mode', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Output Mode',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: {
                        SP: 'Splitter',
                        MX: 'Matrix',
                    },
                },
                native: {},
            });
        }

        // Bypass mode (MFP112 only)
        if (def.hasBypass) {
            await this.setObjectNotExistsAsync('output.bypass', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'HDMI Bypass (skip scaler)',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });
        }

        // Resolution + frequency mode (scaling models only — crosspoint matrices
        // C66/C88 have no scaler and do not implement OUT RES / OUT FREQ).
        if (!def.isMatrix) {
            await this.setObjectNotExistsAsync('output.resolution', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Output Resolution',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: def.resolutions,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('output.freqMode', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Frequency Mode',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: {
                        AUTO: 'Auto',
                        FORCE: 'Force',
                    },
                },
                native: {},
            });
        }

        // Aspect ratio, zoom, overscan (MFP72/MFP112)
        if (def.hasAspectRatio) {
            await this.setObjectNotExistsAsync('output.aspectRatio', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Aspect Ratio',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: {
                        '00': 'Full Screen',
                        '01': 'Keep Aspect Ratio',
                        '02': '16:9',
                        '03': '4:3',
                    },
                },
                native: {},
            });
        }

        if (def.hasZoom) {
            await this.setObjectNotExistsAsync('output.zoom', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Zoom Out',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 0,
                    min: 0,
                    max: 8,
                    states: {
                        0: 'No Zoom',
                        1: '2%',
                        2: '4%',
                        3: '6%',
                        4: '8%',
                        5: '10%',
                        6: '12%',
                        7: '14%',
                        8: '16%',
                    },
                },
                native: {},
            });
        }

        if (def.hasOverscan) {
            await this.setObjectNotExistsAsync('output.overscan', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Overscan',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 0,
                    min: 0,
                    max: 8,
                    states: {
                        0: 'No Overscan',
                        1: '2%',
                        2: '4%',
                        3: '6%',
                        4: '8%',
                        5: '10%',
                        6: '12%',
                        7: '14%',
                        8: '16%',
                    },
                },
                native: {},
            });
        }

        // Audio controls — scaling models only. Crosspoint matrices (C66/C88)
        // have no audio processing path and do not implement VOL/MUTE/AUD.
        if (!def.isMatrix) {
            // Audio channel
            await this.setObjectNotExistsAsync('audio', {
                type: 'channel',
                common: { name: 'Audio Control' },
                native: {},
            });

            await this.setObjectNotExistsAsync('audio.volume', {
                type: 'state',
                common: {
                    role: 'level.volume',
                    name: 'Volume',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 0,
                    min: 0,
                    max: def.volumeMax,
                    unit: '',
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('audio.mute', {
                type: 'state',
                common: {
                    role: 'media.mute',
                    name: 'Mute',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('audio.source', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Audio Source',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: {
                        ORG: 'Follow Video',
                        ANA: 'Analog Input',
                    },
                },
                native: {},
            });

            // MFP62-specific audio PCM mode
            if (model === 'mfp62') {
                await this.setObjectNotExistsAsync('audio.pcmMode', {
                    type: 'state',
                    common: {
                        role: 'state',
                        name: 'PCM Audio Mode',
                        type: 'string',
                        read: true,
                        write: true,
                        def: '',
                        states: {
                            SCA: 'Scaler Process',
                            BYP: 'Bypass',
                        },
                    },
                    native: {},
                });

                // Per-input audio for MFP62 (RX inputs)
                await this.setObjectNotExistsAsync('audio.rx', {
                    type: 'channel',
                    common: { name: 'Input Audio Settings' },
                    native: {},
                });

                const rxInputNames = ['HDMI1', 'HDMI2', 'HDMI3', 'DP', 'USB-C'];
                for (let i = 1; i <= 5; i++) {
                    await this.setObjectNotExistsAsync(`audio.rx.input${i}`, {
                        type: 'state',
                        common: {
                            role: 'state',
                            name: `${rxInputNames[i - 1]} Audio Mode`,
                            type: 'string',
                            read: true,
                            write: true,
                            states: {
                                ORG: 'Original HDMI/DVI',
                                ANA: 'Embed Analog L/R',
                            },
                            def: 'ORG',
                        },
                        native: {},
                    });
                }
            }

            // MFP112-specific per-input audio
            if (def.hasPerInputAudio) {
                await this.setObjectNotExistsAsync('audio.hdmi', {
                    type: 'channel',
                    common: { name: 'HDMI Input Audio Settings' },
                    native: {},
                });

                for (let i = 1; i <= 4; i++) {
                    await this.setObjectNotExistsAsync(`audio.hdmi.input${i}`, {
                        type: 'state',
                        common: {
                            role: 'state',
                            name: `HDMI Input ${i} Audio Mode`,
                            type: 'string',
                            read: true,
                            write: true,
                            states: {
                                ORG: 'Original HDMI/DVI',
                                ANA: 'Embed Analog L/R',
                                AUTO: 'Auto (Analog when DVI)',
                            },
                            def: 'ORG',
                        },
                        native: {},
                    });
                }
            }
        } // end if (!def.isMatrix) audio controls

        // Microphone controls (MFP62 only)
        if (def.hasMicrophone) {
            await this.setObjectNotExistsAsync('microphone', {
                type: 'channel',
                common: { name: 'Microphone Control' },
                native: {},
            });

            await this.setObjectNotExistsAsync('microphone.volume', {
                type: 'state',
                common: {
                    role: 'level.volume',
                    name: 'Microphone Volume',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 0,
                    min: 0,
                    max: 100,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('microphone.mute', {
                type: 'state',
                common: {
                    role: 'media.mute',
                    name: 'Microphone Mute',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('microphone.mixMode', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Mix Mode',
                    type: 'string',
                    read: true,
                    write: true,
                    states: {
                        ON: 'Mix MIC + Background',
                        BGO: 'Background Only',
                        MICO: 'MIC Only',
                    },
                    def: 'ON',
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('microphone.autoBg', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'Auto Decrease Background',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('microphone.bgVolume', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Background Volume Percent',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 0,
                    min: 0,
                    max: 100,
                    unit: '%',
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('microphone.bgDelay', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Background Restore Delay',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 1,
                    min: 1,
                    max: 20,
                    unit: 's',
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('microphone.rampUp', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Ramp Up Time',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 0,
                    min: 0,
                    max: 20,
                    unit: 'x0.5s',
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('microphone.rampDown', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Ramp Down Time',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 0,
                    min: 0,
                    max: 20,
                    unit: 'x0.5s',
                },
                native: {},
            });
        }

        // Network controls (MFP62 only)
        if (def.hasNetwork) {
            await this.setObjectNotExistsAsync('network', {
                type: 'channel',
                common: { name: 'Network Settings' },
                native: {},
            });

            await this.setObjectNotExistsAsync('network.dhcp', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'DHCP Enabled',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('network.ip', {
                type: 'state',
                common: {
                    role: 'text',
                    name: 'IP Address',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('network.gateway', {
                type: 'state',
                common: {
                    role: 'text',
                    name: 'Gateway',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('network.subnet', {
                type: 'state',
                common: {
                    role: 'text',
                    name: 'Subnet Mask',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('network.telnetPort', {
                type: 'state',
                common: {
                    role: 'info.port',
                    name: 'Telnet Port',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('network.reboot', {
                type: 'state',
                common: {
                    role: 'button',
                    name: 'Reboot Network',
                    type: 'boolean',
                    read: false,
                    write: true,
                    def: false,
                },
                native: {},
            });

            // Dual LAN support for WMF series
            if (def.dualLAN) {
                for (const lan of ['lan1', 'lan2']) {
                    const lanNum = lan === 'lan1' ? 1 : 2;
                    await this.setObjectNotExistsAsync(`network.${lan}`, {
                        type: 'channel',
                        common: { name: `LAN ${lanNum}` },
                        native: {},
                    });

                    await this.setObjectNotExistsAsync(`network.${lan}.dhcp`, {
                        type: 'state',
                        common: {
                            role: 'switch.enable',
                            name: 'DHCP',
                            type: 'boolean',
                            read: true,
                            write: true,
                            def: false,
                        },
                        native: {},
                    });

                    await this.setObjectNotExistsAsync(`network.${lan}.ip`, {
                        type: 'state',
                        common: {
                            role: 'info.ip',
                            name: 'IP Address',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        },
                        native: {},
                    });

                    await this.setObjectNotExistsAsync(`network.${lan}.gateway`, {
                        type: 'state',
                        common: { role: 'info.ip', name: 'Gateway', type: 'string', read: true, write: false, def: '' },
                        native: {},
                    });

                    await this.setObjectNotExistsAsync(`network.${lan}.subnet`, {
                        type: 'state',
                        common: {
                            role: 'info.ip',
                            name: 'Subnet Mask',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        },
                        native: {},
                    });

                    await this.setObjectNotExistsAsync(`network.${lan}.tcpPort`, {
                        type: 'state',
                        common: {
                            role: 'info.port',
                            name: 'TCP Port',
                            type: 'string',
                            read: true,
                            write: false,
                            def: '',
                        },
                        native: {},
                    });
                }
            }
        }

        // WiFi controls (WMF series)
        if (def.hasWifi) {
            await this.setObjectNotExistsAsync('wifi', {
                type: 'channel',
                common: { name: 'WiFi Hotspot' },
                native: {},
            });

            await this.setObjectNotExistsAsync('wifi.enabled', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'WiFi Enabled',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('wifi.frequency', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'WiFi Frequency',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: { 2: '2.4GHz', 5: '5GHz' },
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('wifi.channel', {
                type: 'state',
                common: { role: 'state', name: 'WiFi Channel', type: 'string', read: true, write: true, def: '' },
                native: {},
            });

            await this.setObjectNotExistsAsync('wifi.ssid', {
                type: 'state',
                common: { role: 'text', name: 'SSID', type: 'string', read: true, write: true, def: '' },
                native: {},
            });

            await this.setObjectNotExistsAsync('wifi.password', {
                type: 'state',
                common: { role: 'text', name: 'Password', type: 'string', read: false, write: true, def: '' },
                native: {},
            });
        }

        // Video mute (WMF/AMF series)
        if (def.hasVideoMute) {
            await this.setObjectNotExistsAsync('system.videoMute', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'Video Mute',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });
        }

        // Standby controls (WMF series)
        if (def.hasStandby) {
            await this.setObjectNotExistsAsync('system.standbyMode', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'Auto Standby',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('system.standbyDelay', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Standby Delay (min)',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 0,
                    min: 0,
                    max: 30,
                },
                native: {},
            });
        }

        // No signal standby (AMF series)
        if (def.hasNoSignalStandby) {
            await this.setObjectNotExistsAsync('system.noSignalStandby', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'No Signal Standby',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('system.noSignalDelay', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'No Signal Delay (sec)',
                    type: 'number',
                    read: true,
                    write: true,
                    min: 300,
                    max: 10800,
                    def: 600,
                },
                native: {},
            });
        }

        // POC output. AMF series has a single global toggle; matrices (C66/C88)
        // control PoC per HDBaseT output.
        if (def.hasPOC && !def.isMatrix) {
            await this.setObjectNotExistsAsync('system.pocOutput', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'HDBT POC Output',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false,
                },
                native: {},
            });
        }
        if (def.hasPOC && def.isMatrix) {
            for (let i = 1; i <= def.outputs; i++) {
                await this.setObjectNotExistsAsync(`output.${i}.poc`, {
                    type: 'state',
                    common: {
                        role: 'switch.enable',
                        name: `Output ${i} PoC`,
                        type: 'boolean',
                        read: true,
                        write: true,
                        def: true,
                    },
                    native: {},
                });
            }
        }

        // KVM (MX44KVM): GPIO port modes + USB cascade routing. Read-only STATUS
        // telemetry (GPIOSTATUS / CASCADESTATUS), parsed by lib/statusParser.js.
        if (def.routePrefix === 'USBOUT') {
            // Parent channels for every dotted segment (avoids E3009).
            for (const ch of [
                ['gpio', 'GPIO Ports'],
                ['gpio.output', 'GPIO Outputs'],
                ['gpio.input', 'GPIO Inputs'],
                ['usb', 'USB Cascade'],
                ['usb.cascadeOut', 'Cascade Output (per Device)'],
                ['usb.cascadeFrom', 'Cascade From (per Host)'],
            ]) {
                await this.setObjectNotExistsAsync(ch[0], { type: 'channel', common: { name: ch[1] }, native: {} });
            }
            for (let i = 1; i <= 4; i++) {
                await this.setObjectNotExistsAsync(`gpio.output.${i}`, {
                    type: 'state',
                    common: {
                        role: 'text',
                        name: `GPIO Output ${i} Mode`,
                        type: 'string',
                        read: true,
                        write: false,
                        def: '',
                    },
                    native: {},
                });
                await this.setObjectNotExistsAsync(`gpio.input.${i}`, {
                    type: 'state',
                    common: {
                        role: 'text',
                        name: `GPIO Input ${i} Mode`,
                        type: 'string',
                        read: true,
                        write: false,
                        def: '',
                    },
                    native: {},
                });
                await this.setObjectNotExistsAsync(`usb.cascadeOut.${i}`, {
                    type: 'state',
                    common: {
                        role: 'value',
                        name: `Cascade Output (Device ${i}), 0 = none`,
                        type: 'number',
                        read: true,
                        write: false,
                        def: 0,
                    },
                    native: {},
                });
                await this.setObjectNotExistsAsync(`usb.cascadeFrom.${i}`, {
                    type: 'state',
                    common: {
                        role: 'value',
                        name: `Cascade From (Host ${i}), 0 = none`,
                        type: 'number',
                        read: true,
                        write: false,
                        def: 0,
                    },
                    native: {},
                });
            }
        }

        // Dante/audio-DSP telemetry (SW42DA-V2): master volume/mute + ARC mode.
        // Read-only STATUS read-back (write commands not modelled).
        if (def.hasDanteDsp) {
            await this.setObjectNotExistsAsync('audio', {
                type: 'channel',
                common: { name: 'Audio' },
                native: {},
            });
            await this.setObjectNotExistsAsync('audio.volume', {
                type: 'state',
                common: {
                    role: 'level.volume',
                    name: 'Master Output Volume',
                    type: 'number',
                    read: true,
                    write: false,
                    def: 0,
                    min: 0,
                    max: 100,
                },
                native: {},
            });
            await this.setObjectNotExistsAsync('audio.mute', {
                type: 'state',
                common: {
                    role: 'media.mute',
                    name: 'Master Output Mute',
                    type: 'boolean',
                    read: true,
                    write: false,
                    def: false,
                },
                native: {},
            });
            await this.setObjectNotExistsAsync('audio.arcMode', {
                type: 'state',
                common: { role: 'text', name: 'ARC Mode', type: 'string', read: true, write: false, def: '' },
                native: {},
            });
        }

        // Reboot command (WMF series)
        if (def.isWireless) {
            await this.setObjectNotExistsAsync('system.reboot', {
                type: 'state',
                common: {
                    role: 'button',
                    name: 'Reboot System',
                    type: 'boolean',
                    read: false,
                    write: true,
                    def: false,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('commands.homeScreen', {
                type: 'state',
                common: {
                    role: 'button',
                    name: 'Go to Home Screen',
                    type: 'boolean',
                    read: false,
                    write: true,
                    def: false,
                },
                native: {},
            });
        }

        // Sidebar controls (WMF series)
        if (def.hasSidebar) {
            for (let i = 1; i <= def.outputs; i++) {
                await this.setObjectNotExistsAsync(`output.${i}.sidebar`, {
                    type: 'state',
                    common: {
                        role: 'switch.enable',
                        name: `Output ${i} Sidebar`,
                        type: 'boolean',
                        read: true,
                        write: true,
                        def: false,
                    },
                    native: {},
                });
            }
        }

        // Display modes (WMF72)
        if (def.hasDisplayModes) {
            await this.setObjectNotExistsAsync('output.displayMode', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Display Mode',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: def.displayModes,
                },
                native: {},
            });
        }

        // Layouts (WMF72)
        if (def.hasLayouts) {
            await this.setObjectNotExistsAsync('output.layout', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Multiview Layout',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: def.layouts,
                },
                native: {},
            });
        }

        // Audio modes (WMF72)
        if (def.hasAudioModes) {
            await this.setObjectNotExistsAsync('audio.mode', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Audio Mode',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: def.audioModes,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('audio.output', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Audio Output',
                    type: 'string',
                    read: true,
                    write: true,
                    def: '',
                    states: { '00': 'Analog + HDMI', '01': 'HDMI Only', '02': 'Analog Only', '03': 'USB Only' },
                },
                native: {},
            });
        }

        // Picture controls (AMF series)
        if (def.hasPictureControl) {
            for (let i = 1; i <= def.outputs; i++) {
                await this.setObjectNotExistsAsync(`output.${i}.brightness`, {
                    type: 'state',
                    common: {
                        role: 'level',
                        name: `Output ${i} Brightness`,
                        type: 'number',
                        read: true,
                        write: true,
                        def: 0,
                        min: 0,
                        max: 99,
                    },
                    native: {},
                });

                await this.setObjectNotExistsAsync(`output.${i}.contrast`, {
                    type: 'state',
                    common: {
                        role: 'level',
                        name: `Output ${i} Contrast`,
                        type: 'number',
                        read: true,
                        write: true,
                        def: 0,
                        min: 0,
                        max: 99,
                    },
                    native: {},
                });

                await this.setObjectNotExistsAsync(`output.${i}.pictureMode`, {
                    type: 'state',
                    common: {
                        role: 'state',
                        name: `Output ${i} Picture Mode`,
                        type: 'string',
                        read: true,
                        write: true,
                        def: '',
                        states: { '01': 'Soft', '02': 'Standard', '03': 'Vivid', '04': 'User' },
                    },
                    native: {},
                });

                await this.setObjectNotExistsAsync(`output.${i}.colourTemp`, {
                    type: 'state',
                    common: {
                        role: 'state',
                        name: `Output ${i} Colour Temperature`,
                        type: 'string',
                        read: true,
                        write: true,
                        def: '',
                        states: { '01': 'Warm', '02': 'Standard', '03': 'Cool', '04': 'User' },
                    },
                    native: {},
                });

                await this.setObjectNotExistsAsync(`output.${i}.videoMute`, {
                    type: 'state',
                    common: {
                        role: 'switch.enable',
                        name: `Output ${i} Video Mute`,
                        type: 'boolean',
                        read: true,
                        write: true,
                        def: false,
                    },
                    native: {},
                });

                await this.setObjectNotExistsAsync(`output.${i}.audioMix`, {
                    type: 'state',
                    common: {
                        role: 'state',
                        name: `Output ${i} Audio Mix`,
                        type: 'string',
                        read: true,
                        write: true,
                        def: '',
                        states: def.audioMixModes || {},
                    },
                    native: {},
                });
            }
        }

        // Presets (AMF series)
        if (def.hasPresets) {
            await this.setObjectNotExistsAsync('presets', {
                type: 'channel',
                common: { name: 'Presets' },
                native: {},
            });

            await this.setObjectNotExistsAsync('presets.save', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Save to Preset',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 1,
                    min: 1,
                    max: 9,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('presets.apply', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Apply Preset',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 1,
                    min: 1,
                    max: 9,
                },
                native: {},
            });

            await this.setObjectNotExistsAsync('presets.clear', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Clear Preset',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 1,
                    min: 1,
                    max: 9,
                },
                native: {},
            });
        }

        // CEC controls (AMF series)
        if (def.hasCEC) {
            await this.setObjectNotExistsAsync('cec', {
                type: 'channel',
                common: { name: 'CEC Control' },
                native: {},
            });

            // Output CEC (only for outputs this model actually has)
            for (let i = 1; i <= def.outputs; i++) {
                await this.setObjectNotExistsAsync(`output.${i}.cecEnabled`, {
                    type: 'state',
                    common: {
                        role: 'switch.enable',
                        name: `Output ${i} CEC`,
                        type: 'boolean',
                        read: true,
                        write: true,
                        def: false,
                    },
                    native: {},
                });
            }

            // Input CEC
            for (let i = 1; i <= 4; i++) {
                await this.setObjectNotExistsAsync(`cec.input${i}`, {
                    type: 'state',
                    common: {
                        role: 'switch.enable',
                        name: `Input ${i} CEC`,
                        type: 'boolean',
                        read: true,
                        write: true,
                        def: false,
                    },
                    native: {},
                });
            }
        }

        // VGA auto adjust command (not for MFP62 - no VGA auto adjust command)
        if (!def.hasNetwork && !def.isWireless) {
            await this.setObjectNotExistsAsync('commands.vgaAutoAdjust', {
                type: 'state',
                common: {
                    role: 'button',
                    name: 'VGA Auto Adjust',
                    type: 'boolean',
                    read: false,
                    write: true,
                    def: false,
                },
                native: {},
            });
        }

        this.log.info(`States setup complete for ${def.name}`);
    }

    connect() {
        if (this.config.connectionType === 'serial') {
            this.connectSerial();
        } else {
            this.connectIP();
        }
    }

    async connectIP() {
        const host = this.config.ipAddress;
        const port = this.config.ipPort || 8000;

        this.log.info(`Connecting to ${host}:${port}...`);

        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }

        this.socket = new net.Socket();

        this.socket.on('connect', () => {
            this.log.info('Connected to device via IP');
            this.connected = true;
            this.setStateAsync('info.connection', true, true);
            this.startPolling();
            this.processCommandQueue();
        });

        this.socket.on('data', data => {
            this.log.debug(`Raw data received (${data.length} bytes): ${data.toString('hex')}`);
            if (this.config.telnetNegotiation) {
                const cleanedData = this.handleTelnetIAC(data);
                if (cleanedData.length > 0) {
                    this.handleData(cleanedData.toString());
                }
            } else {
                this.handleData(data.toString());
            }
        });

        this.socket.on('error', err => {
            this.log.error(`Socket error: ${err.message}`);
        });

        this.socket.on('close', () => {
            this.log.info('Connection closed');
            this.connected = false;
            this.setStateAsync('info.connection', false, true);
            this.stopPolling();
            this.scheduleReconnect();
        });

        this.socket.on('timeout', () => {
            this.log.warn('Socket timeout');
            this.socket.destroy();
        });

        this.socket.setTimeout(30000);

        try {
            this.socket.connect(port, host);
        } catch (err) {
            this.log.error(`Connection error: ${err.message}`);
            this.scheduleReconnect();
        }
    }

    async connectSerial() {
        const portPath = this.config.serialPort;
        const baudRate = this.config.serialBaudRate || 57600;

        this.log.info(`Opening serial port ${portPath} at ${baudRate} baud...`);

        try {
            const { SerialPort } = require('serialport');

            if (this.serialPort && this.serialPort.isOpen) {
                await this.serialPort.close();
            }

            this.serialPort = new SerialPort({
                path: portPath,
                baudRate: baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                autoOpen: false,
            });

            this.serialPort.on('open', () => {
                this.log.info('Serial port opened');
                this.connected = true;
                this.setStateAsync('info.connection', true, true);
                this.startPolling();
                this.processCommandQueue();
            });

            this.serialPort.on('data', data => {
                this.handleData(data.toString());
            });

            this.serialPort.on('error', err => {
                this.log.error(`Serial port error: ${err.message}`);
                this.connected = false;
                this.setStateAsync('info.connection', false, true);
                this.scheduleReconnect();
            });

            this.serialPort.on('close', () => {
                this.log.info('Serial port closed');
                this.connected = false;
                this.setStateAsync('info.connection', false, true);
                this.stopPolling();
                this.scheduleReconnect();
            });

            this.serialPort.open(err => {
                if (err) {
                    this.log.error(`Error opening serial port: ${err.message}`);
                    this.scheduleReconnect();
                }
            });
        } catch (err) {
            this.log.error(`Serial port initialization error: ${err.message}`);
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimer) {
            this.clearTimeout(this.reconnectTimer);
        }

        // Clamp to sane bounds (UI limits alone are not authoritative)
        const interval = Math.min(Math.max(this.config.reconnectInterval || 10000, 5000), 60000);
        this.log.info(`Scheduling reconnect in ${interval}ms...`);

        this.reconnectTimer = this.setTimeout(() => {
            this.connect();
        }, interval);
    }

    /**
     * Handle Telnet IAC (Interpret As Command) sequences
     * Responds to DO/WILL requests with WONT/DONT to refuse options
     * Returns the data buffer with IAC sequences stripped out
     *
     * @param data Raw buffer received from the socket, possibly containing IAC sequences
     */
    handleTelnetIAC(data) {
        const cleanedBytes = [];
        let i = 0;

        while (i < data.length) {
            if (data[i] === IAC) {
                if (i + 1 >= data.length) {
                    // Incomplete IAC sequence, skip
                    break;
                }

                const command = data[i + 1];

                if (command === IAC) {
                    // Escaped IAC (255 255) = literal 255
                    cleanedBytes.push(IAC);
                    i += 2;
                } else if (command === DO || command === DONT) {
                    // Server asking us to DO/DONT something - respond with WONT
                    if (i + 2 < data.length) {
                        const option = data[i + 2];
                        this.log.debug(
                            `Telnet: Received ${command === DO ? 'DO' : 'DONT'} option ${option}, responding WONT`,
                        );
                        this.sendTelnetResponse(WONT, option);
                        i += 3;
                    } else {
                        i += 2;
                    }
                } else if (command === WILL || command === WONT) {
                    // Server telling us it WILL/WONT do something - respond with DONT
                    if (i + 2 < data.length) {
                        const option = data[i + 2];
                        this.log.debug(
                            `Telnet: Received ${command === WILL ? 'WILL' : 'WONT'} option ${option}, responding DONT`,
                        );
                        this.sendTelnetResponse(DONT, option);
                        i += 3;
                    } else {
                        i += 2;
                    }
                } else if (command === SB) {
                    // Subnegotiation - skip until SE
                    let j = i + 2;
                    while (j < data.length - 1) {
                        if (data[j] === IAC && data[j + 1] === SE) {
                            i = j + 2;
                            break;
                        }
                        j++;
                    }
                    if (j >= data.length - 1) {
                        // Incomplete subnegotiation, skip rest
                        break;
                    }
                } else {
                    // Other 2-byte IAC command (like GA, NOP, etc.)
                    i += 2;
                }
            } else {
                // Regular data byte
                cleanedBytes.push(data[i]);
                i++;
            }
        }

        return Buffer.from(cleanedBytes);
    }

    /**
     * Send a Telnet IAC response
     *
     * @param command Telnet command byte (e.g. WILL, WONT, DO, DONT)
     * @param option Telnet option byte the command refers to
     */
    sendTelnetResponse(command, option) {
        if (this.socket && this.connected) {
            const response = Buffer.from([IAC, command, option]);
            this.socket.write(response);
        }
    }

    handleData(data) {
        this.receiveBuffer += data;

        const lines = this.receiveBuffer.split(/\r\n|\r|\n/);
        this.receiveBuffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim()) {
                // Accumulate lines for full response capture
                if (!this._responseLines) {
                    this._responseLines = [];
                }
                this._responseLines.push(line.trim());
                // When we hit a separator line, flush the full response. Some models
                // (MX44VW/AVW) prefix the divider with their telnet prompt, so allow
                // anything before it rather than anchoring at the start of the line.
                if (/={5,}\s*$/.test(line.trim())) {
                    this.setStateAsync('info.rawResponse', this._responseLines.join('\n'), true);
                    this._responseLines = [];
                } else if (this._responseLines.length > MAX_RESPONSE_LINES) {
                    // A model whose reply has no recognised terminator would otherwise
                    // grow this array for the lifetime of the instance.
                    this.setStateAsync('info.rawResponse', this._responseLines.join('\n'), true);
                    this._responseLines = [];
                }
                this.processResponse(line.trim());
            }
        }
    }

    processResponse(response) {
        this.log.debug(`Received: ${response}`);
        this.setStateAsync('info.lastReceived', response, true);

        // Clear command timeout on response
        if (this.commandTimeout) {
            this.clearTimeout(this.commandTimeout);
            this.commandTimeout = null;
        }

        // Skip separator lines and title lines
        if (
            /={3,}\s*$/.test(response) ||
            /Status$/i.test(response) ||
            /^FW Version/i.test(response) ||
            /^Scaler Version/i.test(response)
        ) {
            // End of STATUS response — release command queue on separator
            if (/={3,}\s*$/.test(response)) {
                this._statusHeaders = null;
                this._matrixParser.reset();
                this.currentCommand = null;
                this.processCommandQueue();
            }
            return;
        }

        // Matrix / switcher: fixed-width STATUS tables + [SUCCESS]/[FAIL] confirmations
        if (this.modelDef && this.modelDef.isMatrix) {
            // Plain-language confirmations are terminal single-line responses
            if (/^\[(SUCCESS|FAIL)\]/i.test(response)) {
                this.handleMatrixConfirmation(response);
                this.currentCommand = null;
                this.processCommandQueue();
                return;
            }
            // Fixed-width status tables — parsed per model family (see lib/statusParser.js)
            const updates = this._matrixParser.feed(response, this.modelDef);
            for (const u of updates) {
                this.setStateAsync(u.id, u.val, true);
            }
            return;
        }

        // STATUS table parsing (MFP72/MFP112). Columns are tab-delimited, or arrive
        // space-padded when the tabs have been expanded on the way in. Header names are
        // single words; space-padded data cells are split on 2+ spaces so values such as
        // "Keep Aspect Ratio" stay whole.
        const headerKeywords = ['Power', 'Input', 'Output', 'ScalerAudio', 'ScalerBypass', 'ScalerAspect'];
        const tabbed = response.includes('\t');
        const words = response.split(/\s+/);
        const spacedHeader =
            !tabbed && headerKeywords.includes(words[0]) && words.length > 1 && words.every(w => /^\w+$/.test(w));
        if (tabbed || spacedHeader || (this._statusHeaders && /\S\s{2,}\S/.test(response))) {
            // Any run of whitespace containing a tab (e.g. "\t\t" padding a short cell)
            // or 2+ spaces is one column break, so mixed tab/space padding still aligns.
            const cols = spacedHeader ? words : response.split(/\s*\t\s*|\s{2,}/);

            // Detect header rows by known header keywords
            if (spacedHeader || (tabbed && headerKeywords.some(h => cols[0] === h || cols.includes(h)))) {
                this._statusHeaders = cols;
                this.log.debug(`Status table headers: ${cols.join(', ')}`);
                return;
            }

            // Data row — parse using stored headers
            if (this._statusHeaders) {
                const headers = this._statusHeaders;
                const data = {};
                for (let i = 0; i < headers.length; i++) {
                    data[headers[i]] = (cols[i] || '').trim();
                }
                this.log.debug(`Status table row: ${JSON.stringify(data)}`);
                this.parseStatusTableRow(headers[0], data);
                return;
            }
        }

        // Single-line command responses (non-STATUS)
        this.parseSingleResponse(response);

        // Continue processing queue for non-STATUS responses
        this.currentCommand = null;
        this.processCommandQueue();
    }

    // Plain-language command confirmations the matrix/switcher returns
    // ("[SUCCESS]…" / "[FAIL]…"). Fixed-width STATUS tables are handled
    // separately by the per-family parser in lib/statusParser.js.
    handleMatrixConfirmation(line) {
        if (/^\[FAIL\]/i.test(line)) {
            this.log.warn(`Device rejected command: ${line}`);
            return;
        }
        let m;
        // The echoed output number is bounded to the model's outputs: the route-all
        // form (OUT 00 FR yy) is confirmed as output 00, and a device may report a
        // physical output the def does not model (e.g. SW41HDBT's HDMI output).
        // Either would otherwise write a state that has no object behind it.
        const inRange = n => n >= 1 && n <= this.modelDef.outputs;
        if ((m = line.match(/Set output (\d+) connect from input (\d+)/i))) {
            const out = parseInt(m[1], 10);
            if (inRange(out)) {
                this.setStateAsync(`output.${out}.source`, m[2].padStart(2, '0'), true);
            }
        } else if ((m = line.match(/Set output (\d+) (ON|OFF)/i))) {
            const out = parseInt(m[1], 10);
            if (inRange(out)) {
                this.setStateAsync(`output.${out}.enabled`, m[2].toUpperCase() === 'ON', true);
            }
        } else if ((m = line.match(/Set POC (ON|OFF) on output (\d+)/i))) {
            const out = parseInt(m[2], 10);
            if (inRange(out)) {
                this.setStateAsync(`output.${out}.poc`, m[1].toUpperCase() === 'ON', true);
            }
        }
    }

    parseStatusTableRow(tableType, data) {
        // Resolution/Frequence sit in the ScalerBypass row on the MFP112 but in the
        // ScalerAudio row on the MFP72, so read them from whichever row carries them.
        if (data.Resolution) {
            // Reverse-lookup resolution code from the display string
            const resDef = this.modelDef && this.modelDef.resolutions;
            if (resDef) {
                const resCode = Object.keys(resDef).find(
                    k => resDef[k].toUpperCase() === data.Resolution.toUpperCase(),
                );
                if (resCode) {
                    this.setStateAsync('output.resolution', resCode, true);
                } else {
                    this.log.debug(`Unknown scaler resolution in STATUS: ${data.Resolution}`);
                }
            }
        }
        if (data.Frequence) {
            this.setStateAsync('output.freqMode', data.Frequence.toUpperCase(), true);
        }

        switch (tableType) {
            case 'Power':
                // System row: Power, IR, Key, DBG, Beep, LCD, IR_RS232
                if (data.Power) {
                    this.setStateAsync('system.power', data.Power.toUpperCase() === 'ON', true);
                }
                if (data.IR) {
                    this.setStateAsync('system.ir', data.IR.toUpperCase() === 'ON', true);
                }
                if (data.Key) {
                    this.setStateAsync('system.key', data.Key.toUpperCase() === 'ON', true);
                }
                if (data.DBG) {
                    this.setStateAsync('system.debug', data.DBG.toUpperCase() === 'ON', true);
                }
                if (data.Beep) {
                    this.setStateAsync('system.beep', data.Beep.toUpperCase() === 'ON', true);
                }
                if (data.LCD) {
                    this.setStateAsync('system.lcd', data.LCD.toUpperCase() === 'ON', true);
                }
                if (data.IR_RS232) {
                    // Map "Remote TX" -> "RTX", "Remote RX" -> "RRX", "Remote RX and TX" -> "BOTH"
                    const ir232Val = data.IR_RS232.toUpperCase();
                    if (ir232Val.includes('BOTH') || (ir232Val.includes('RX') && ir232Val.includes('TX'))) {
                        this.setStateAsync('system.ir232', 'BOTH', true);
                    } else if (ir232Val.includes('TX')) {
                        this.setStateAsync('system.ir232', 'RTX', true);
                    } else if (ir232Val.includes('RX')) {
                        this.setStateAsync('system.ir232', 'RRX', true);
                    } else {
                        this.setStateAsync('system.ir232', 'OFF', true);
                    }
                }
                break;

            case 'Output': {
                // Output row: Output, SelectInput, CableConn, OutputEn, Mode
                const outputNum = parseInt(data.Output, 10);
                if (outputNum >= 1 && outputNum <= 3) {
                    if (data.SelectInput) {
                        // Convert friendly names to command values: HDMI1->01, HDMI2->02, etc.
                        const inputMap = {
                            HDMI1: '01',
                            HDMI2: '02',
                            HDMI3: '03',
                            HDMI4: '04',
                            HDBT: 'HDBT',
                            AV: 'AV',
                            YPbPr: 'YPBPR',
                            YPBPR: 'YPBPR',
                            VGA: 'VGA',
                            VGA1: 'VGA1',
                            VGA2: 'VGA2',
                            VGA3: 'VGA3',
                            VGA4: 'VGA4',
                        };
                        const source = inputMap[data.SelectInput] || data.SelectInput;
                        this.setStateAsync(`output.${outputNum}.source`, source, true);
                    }
                    if (data.OutputEn && this.modelDef.hasOutputEnable) {
                        this.setStateAsync(
                            `output.${outputNum}.enabled`,
                            data.OutputEn.trim().toUpperCase() === 'YES',
                            true,
                        );
                    }
                    if (data.Mode) {
                        const mode = data.Mode.toUpperCase();
                        const modeCode = /SPLIT|^SP$/.test(mode) ? 'SP' : /MATRIX|^MX$/.test(mode) ? 'MX' : null;
                        if (modeCode) {
                            this.setStateAsync('output.mode', modeCode, true);
                        } else {
                            this.log.debug(`Unknown output mode in STATUS: ${data.Mode}`);
                        }
                    }
                }
                break;
            }

            case 'ScalerAudio':
                // Audio row: ScalerAudio, Volume, Mute, Format
                if (data.Volume) {
                    this.setStateAsync('audio.volume', parseInt(data.Volume, 10), true);
                }
                if (data.Mute) {
                    this.setStateAsync('audio.mute', data.Mute.toUpperCase() === 'ON', true);
                }
                if (data.ScalerAudio) {
                    const src = data.ScalerAudio.toUpperCase().trim();
                    this.setStateAsync('audio.source', src === 'ORGINAL' ? 'ORG' : 'ANA', true);
                }
                break;

            case 'ScalerBypass':
                // Bypass row: ScalerBypass, Resolution, Frequence
                if (data.ScalerBypass) {
                    this.setStateAsync('output.bypass', data.ScalerBypass.toUpperCase() === 'ON', true);
                }
                break;

            case 'ScalerAspect':
                // Aspect row: ScalerAspect, OSD, ZoomOut, Overscan
                if (data.ScalerAspect) {
                    const arMap = { FULLSCREEN: '00', KEEPASPECTRATIO: '01', '16:9': '02', '4:3': '03' };
                    const arVal = arMap[data.ScalerAspect.toUpperCase().replace(/\s+/g, '')] || '00';
                    this.setStateAsync('output.aspectRatio', arVal, true);
                }
                if (data.OSD) {
                    this.setStateAsync('system.osd', data.OSD.toUpperCase() === 'ON', true);
                }
                if (data.ZoomOut) {
                    const zoom =
                        data.ZoomOut.toUpperCase() === 'NO'
                            ? 0
                            : parseInt(data.ZoomOut.replace(/[^0-9]/g, ''), 10) || 0;
                    this.setStateAsync('output.zoom', zoom, true);
                }
                if (data.Overscan) {
                    const scan =
                        data.Overscan.toUpperCase() === 'NO'
                            ? 0
                            : parseInt(data.Overscan.replace(/[^0-9]/g, ''), 10) || 0;
                    this.setStateAsync('output.overscan', scan, true);
                }
                break;

            default:
                this.log.debug(`Unhandled status table type: ${tableType}`);
        }
    }

    parseSingleResponse(response) {
        // Handle single-line command acknowledgements and Key:Value responses
        // (used by other models like MFP62/MFP72 and individual command responses)

        if (response.includes('Power:')) {
            const match = response.match(/Power:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('system.power', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('IR:') && !response.includes('IR232:')) {
            const match = response.match(/\bIR:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('system.ir', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('KEY:')) {
            const match = response.match(/KEY:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('system.key', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('BEEP:')) {
            const match = response.match(/BEEP:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('system.beep', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('LCD:')) {
            const match = response.match(/LCD:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('system.lcd', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('OSD:')) {
            const match = response.match(/OSD:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('system.osd', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('DBG:')) {
            const match = response.match(/DBG:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('system.debug', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('AUTO:')) {
            const match = response.match(/AUTO:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('system.autoSwitch', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('MUTE:')) {
            const match = response.match(/MUTE:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('audio.mute', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('VOL:')) {
            const match = response.match(/VOL:\s*(\d+)/i);
            if (match) {
                this.setStateAsync('audio.volume', parseInt(match[1], 10), true);
            }
        }

        if (response.includes('BYP:')) {
            const match = response.match(/BYP:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('output.bypass', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('IR232:')) {
            const match = response.match(/IR232:\s*(OFF|RRX|RTX|BOTH)/i);
            if (match) {
                this.setStateAsync('system.ir232', match[1].toUpperCase(), true);
            }
        }

        // Output routing: OUT 01 FR 02
        const outMatch = response.match(/OUT\s*(\d+)\s*FR\s*(\w+)/i);
        if (outMatch) {
            const output = parseInt(outMatch[1], 10);
            // Bound to the model's outputs: an echo of the route-all form (OUT 00 FR yy)
            // or an out-of-range index would otherwise create a state with no object.
            if (output >= 1 && output <= this.modelDef.outputs) {
                this.setStateAsync(`output.${output}.source`, outMatch[2], true);
            }
        }

        // Output enable: OUT 01: ON
        const outEnMatch = response.match(/OUT\s*(\d+):\s*(ON|OFF)/i);
        if (outEnMatch) {
            const output = parseInt(outEnMatch[1], 10);
            this.setStateAsync(`output.${output}.enabled`, outEnMatch[2].toUpperCase() === 'ON', true);
        }

        if (response.includes('Mode:')) {
            const match = response.match(/Mode:\s*(SP|MX|Splitter|Matrix)/i);
            if (match) {
                const mode = match[1].toUpperCase();
                this.setStateAsync('output.mode', mode === 'SPLITTER' ? 'SP' : mode === 'MATRIX' ? 'MX' : mode, true);
            }
        }

        if (response.includes('RES:')) {
            const match = response.match(/RES:\s*(\d+)/i);
            if (match) {
                this.setStateAsync('output.resolution', match[1].padStart(2, '0'), true);
            }
        }

        if (response.includes('AR:')) {
            const match = response.match(/AR:\s*(\d+)/i);
            if (match) {
                this.setStateAsync('output.aspectRatio', match[1].padStart(2, '0'), true);
            }
        }

        if (response.includes('MIC VOL:')) {
            const match = response.match(/MIC VOL:\s*(\d+)/i);
            if (match) {
                this.setStateAsync('microphone.volume', parseInt(match[1], 10), true);
            }
        }

        if (response.includes('MIC MUTE:')) {
            const match = response.match(/MIC MUTE:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('microphone.mute', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('MIC MIX:')) {
            const match = response.match(/MIC MIX:\s*(ON|BGO|MICO)/i);
            if (match) {
                this.setStateAsync('microphone.mixMode', match[1].toUpperCase(), true);
            }
        }

        if (response.includes('DHCP:')) {
            const match = response.match(/DHCP:\s*(ON|OFF)/i);
            if (match) {
                this.setStateAsync('network.dhcp', match[1].toUpperCase() === 'ON', true);
            }
        }

        if (response.includes('IP:') && !response.includes('DHCP')) {
            const match = response.match(/IP:\s*(\d+\.\d+\.\d+\.\d+)/i);
            if (match) {
                this.setStateAsync('network.ip', match[1], true);
            }
        }
    }

    startPolling() {
        if (this.pollingTimer) {
            this.clearInterval(this.pollingTimer);
        }

        // Clamp to sane bounds (UI limits alone are not authoritative)
        const interval = Math.min(Math.max(this.config.pollingInterval || 30000, 5000), 300000);

        // Initial status request
        this.sendCommand('STATUS');

        this.pollingTimer = this.setInterval(() => {
            if (this.connected) {
                this.sendCommand('STATUS');
            }
        }, interval);
    }

    stopPolling() {
        if (this.pollingTimer) {
            this.clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
    }

    sendCommand(command) {
        this.commandQueue.push(command);
        this.processCommandQueue();
    }

    // Command-form helpers. Blustream firmware uses two spacing dialects for the
    // numeric routing/enable commands: "spaced" (OUT 01 FR 02 — C/HMX/Pro/MFP/AMF,
    // and verified to also accept the unspaced form on C-series) and "nospace"
    // (OUT01FR02 — the CMX/MX HDMI matrices and SW-AB switchers, whose manuals
    // document only that form). Auto-switch (OUT AUTO ON/OFF) and PoC stay spaced
    // for every model, so only route/enable/allSource run through the separator.
    cmdSep() {
        return this.modelDef && this.modelDef.commandStyle === 'nospace' ? '' : ' ';
    }
    // Single-output switches (SW-AB family) route as OUTFRyy with no output index;
    // multi-output matrices route as OUT xx FR yy. Driven by def.noOutputIndex.
    // routePrefix overrides the OUT verb (MX44KVM routes USB as "USBOUT xx FR yy").
    cmdRoute(out, input) {
        const s = this.cmdSep();
        const p = (this.modelDef && this.modelDef.routePrefix) || 'OUT';
        if (this.modelDef && this.modelDef.noOutputIndex) {
            return `${p}${s}FR${s}${input}`;
        }
        return `${p}${s}${out}${s}FR${s}${input}`;
    }
    cmdOutOnOff(out, on) {
        const s = this.cmdSep();
        const st = on ? 'ON' : 'OFF';
        if (this.modelDef && this.modelDef.noOutputIndex) {
            return `OUT${s}${st}`;
        }
        return `OUT${s}${out}${s}${st}`;
    }
    // PoC verb differs by family: POCOUT xx (C-series/HMX), POC OUT xx (SW41HDBT),
    // POC TX yy (Pro-Matrix). Driven by def.pocCommand (default POCOUT). Always spaced.
    cmdPoc(out, on) {
        const verb = (this.modelDef && this.modelDef.pocCommand) || 'POCOUT';
        return `${verb} ${out} ${on ? 'ON' : 'OFF'}`;
    }

    processCommandQueue() {
        if (this.isProcessingQueue || !this.connected || this.currentCommand) {
            return;
        }

        if (this.commandQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;
        const command = this.commandQueue.shift();
        this.currentCommand = command;

        // Redact secrets before they reach the log or info.lastSent — the latter is
        // readable, which would otherwise expose the write-only wifi.password value.
        const loggedCommand = command.replace(/^(WIFI\s+PASS\s+).*/i, '$1***');
        this.log.debug(`Sending command: ${loggedCommand}`);
        this.setStateAsync('info.lastSent', loggedCommand, true);

        const cmdWithCR = `${command}\r`;

        try {
            if (this.config.connectionType === 'serial' && this.serialPort && this.serialPort.isOpen) {
                this.serialPort.write(cmdWithCR, err => {
                    if (err) {
                        this.log.error(`Error writing to serial port: ${err.message}`);
                    }
                });
            } else if (this.socket && this.connected) {
                this.socket.write(cmdWithCR);
            }

            this.commandTimeout = this.setTimeout(() => {
                this.log.warn(`Command timeout for: ${command}`);
                this.currentCommand = null;
                this.processCommandQueue();
            }, 5000);
        } catch (err) {
            this.log.error(`Error sending command: ${err.message}`);
            this.currentCommand = null;
        }

        this.isProcessingQueue = false;
    }

    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }

        const stateId = id.split('.').slice(2).join('.');
        // Avoid logging sensitive values (e.g. WiFi password) in plain text
        const loggedVal = /password/i.test(stateId) ? '***' : state.val;
        this.log.debug(`State change: ${stateId} = ${loggedVal}`);

        // Handle HDMI input audio (MFP112)
        const hdmiAudioMatch = stateId.match(/^audio\.hdmi\.input(\d)$/);
        if (hdmiAudioMatch) {
            const inputNum = hdmiAudioMatch[1];
            this.sendCommand(`AUD HDMI ${inputNum.padStart(2, '0')} ${state.val}`);
            return;
        }

        // Handle RX input audio (MFP62)
        const rxAudioMatch = stateId.match(/^audio\.rx\.input(\d)$/);
        if (rxAudioMatch) {
            const inputNum = rxAudioMatch[1];
            this.sendCommand(`AUD RX ${inputNum.padStart(2, '0')} ${state.val}`);
            return;
        }

        // Handle output source changes (outputs 1..16; 10-16 are two-digit)
        const outputSourceMatch = stateId.match(/^output\.(\d+)\.source$/);
        if (outputSourceMatch) {
            const outputNum = outputSourceMatch[1];
            this.sendCommand(this.cmdRoute(outputNum.padStart(2, '0'), state.val));
            return;
        }

        // Route all outputs to one input (matrices): OUT 00 FR yy
        if (stateId === 'output.allSource') {
            this.sendCommand(this.cmdRoute('00', state.val));
            return;
        }

        // Handle output enable changes
        const outputEnableMatch = stateId.match(/^output\.(\d+)\.enabled$/);
        if (outputEnableMatch) {
            const outputNum = outputEnableMatch[1];
            this.sendCommand(this.cmdOutOnOff(outputNum.padStart(2, '0'), state.val));
            return;
        }

        // Handle per-output PoC (HDBaseT matrices): POCOUT/POC OUT/POC TX xx ON/OFF
        const outputPocMatch = stateId.match(/^output\.(\d+)\.poc$/);
        if (outputPocMatch) {
            const outputNum = outputPocMatch[1];
            this.sendCommand(this.cmdPoc(outputNum.padStart(2, '0'), state.val));
            return;
        }

        // Video-wall / multi-view controls (MX44VW family). Commands are spaced.
        if (stateId === 'videowall.mode') {
            this.sendCommand(`OUT MODE ${state.val}`);
            return;
        }
        if (stateId === 'videowall.vwSource') {
            this.sendCommand(`OUT VW FR ${state.val}`);
            return;
        }
        if (stateId === 'videowall.audioSource') {
            this.sendCommand(`MV AUD ${state.val}`);
            return;
        }
        const bezelMatch = stateId.match(/^output\.(\d+)\.bezel(Left|Right|Top|Bottom)$/);
        if (bezelMatch) {
            const edge = { Left: 'VCL', Right: 'VCR', Top: 'VCT', Bottom: 'VCB' }[bezelMatch[2]];
            const px = String(Math.max(0, Math.min(100, Number(state.val) || 0)));
            this.sendCommand(`OUT ${bezelMatch[1].padStart(2, '0')} ${edge} ${px}`);
            return;
        }
        const inputTypeMatch = stateId.match(/^input\.(\d+)\.type$/);
        if (inputTypeMatch) {
            this.sendCommand(`IN ${inputTypeMatch[1].padStart(2, '0')} FR ${state.val}`);
            return;
        }

        // EDID management (matrices): EDID xx DF zz / EDID xx CP yy
        const edidProfileMatch = stateId.match(/^input\.(\d+)\.edidProfile$/);
        if (edidProfileMatch) {
            const s = this.cmdSep();
            const inp = edidProfileMatch[1].padStart(2, '0');
            this.sendCommand(`EDID${s}${inp}${s}DF${s}${String(state.val).padStart(2, '0')}`);
            return;
        }
        const edidCopyMatch = stateId.match(/^input\.(\d+)\.edidCopyFrom$/);
        if (edidCopyMatch) {
            const out = Number(state.val);
            if (out > 0) {
                const s = this.cmdSep();
                const inp = edidCopyMatch[1].padStart(2, '0');
                this.sendCommand(`EDID${s}${inp}${s}CP${s}${String(out).padStart(2, '0')}`);
            }
            return;
        }

        // CEC input actions (HMX-18G / SW41HDBT): IN xx CEC ENABLE|DISABLE|<action>
        const inCecEnMatch = stateId.match(/^input\.(\d+)\.cecEnabled$/);
        if (inCecEnMatch) {
            this.sendCommand(`IN ${inCecEnMatch[1].padStart(2, '0')} CEC ${state.val ? 'ENABLE' : 'DISABLE'}`);
            return;
        }
        const inCecActMatch = stateId.match(/^input\.(\d+)\.cecAction$/);
        if (inCecActMatch) {
            if (state.val) {
                this.sendCommand(`IN ${inCecActMatch[1].padStart(2, '0')} CEC ${state.val}`);
            }
            return;
        }

        // Per-input audio embed (Pro-Matrix): AUD RX xx ORG|ANA|AUTO
        const audEmbedMatch = stateId.match(/^input\.(\d+)\.audioEmbed$/);
        if (audEmbedMatch) {
            this.sendCommand(`AUD RX ${audEmbedMatch[1].padStart(2, '0')} ${state.val}`);
            return;
        }

        // Per-output CEC action button (HMX-18G / SW41HDBT): OUT xx CEC <action>
        const outCecActMatch = stateId.match(/^output\.(\d+)\.cecAction$/);
        if (outCecActMatch) {
            if (state.val) {
                this.sendCommand(`OUT ${outCecActMatch[1].padStart(2, '0')} CEC ${state.val}`);
            }
            return;
        }

        // Per-output audio (HMX-18G audio matrix): route / volume / ARC / mute
        const outAudSrcMatch = stateId.match(/^output\.(\d+)\.audioSource$/);
        if (outAudSrcMatch) {
            this.sendCommand(`AUDIO ${outAudSrcMatch[1].padStart(2, '0')} FR ${state.val}`);
            return;
        }
        const outAudVolMatch = stateId.match(/^output\.(\d+)\.audioVolume$/);
        if (outAudVolMatch) {
            const vol = Math.max(0, Math.min(100, Number(state.val) || 0));
            this.sendCommand(`VOL ${vol} TX ${outAudVolMatch[1].padStart(2, '0')}`);
            return;
        }
        const outArcMatch = stateId.match(/^output\.(\d+)\.arcMode$/);
        if (outArcMatch) {
            this.sendCommand(`OUT ${outArcMatch[1].padStart(2, '0')} ARC ${state.val}`);
            return;
        }
        const outAudMuteMatch = stateId.match(/^output\.(\d+)\.audioMute$/);
        if (outAudMuteMatch) {
            const out = outAudMuteMatch[1].padStart(2, '0');
            // HMX-18G audio matrix: AUDOUT xx On/Off; Pro-Matrix: MUTE On/Off TX xx
            if (this.modelDef && this.modelDef.hasAudioMatrix) {
                this.sendCommand(`AUDOUT ${out} ${state.val ? 'On' : 'Off'}`);
            } else {
                this.sendCommand(`MUTE ${state.val ? 'ON' : 'OFF'} TX ${out}`);
            }
            return;
        }

        // Handle output sidebar (WMF series)
        const sidebarMatch = stateId.match(/^output\.(\d)\.sidebar$/);
        if (sidebarMatch) {
            // WMF72 has dual outputs (xx=1 Main, 2 Sub); WMF51 is single output (no index)
            if (this.modelDef && this.modelDef.outputs > 1) {
                this.sendCommand(`OUT ${sidebarMatch[1]} SIDEBAR ${state.val ? 'ON' : 'OFF'}`);
            } else {
                this.sendCommand(`OUT SIDEBAR ${state.val ? 'ON' : 'OFF'}`);
            }
            return;
        }

        // Handle output picture / mute / audio-mix / CEC controls (AMF series)
        const outputPictureMatch = stateId.match(
            /^output\.(\d+)\.(brightness|contrast|pictureMode|colourTemp|videoMute|audioMix|cecEnabled)$/,
        );
        if (outputPictureMatch) {
            const out = outputPictureMatch[1].padStart(2, '0');
            switch (outputPictureMatch[2]) {
                case 'brightness':
                    this.sendCommand(`OUT ${out} BRIGHTNESS ${String(state.val).padStart(2, '0')}`);
                    break;
                case 'contrast':
                    this.sendCommand(`OUT ${out} CONTRAST ${String(state.val).padStart(2, '0')}`);
                    break;
                case 'pictureMode':
                    this.sendCommand(`OUT ${out} PICTUREMODE ${state.val}`);
                    break;
                case 'colourTemp':
                    this.sendCommand(`OUT ${out} COLOURTEMP ${state.val}`);
                    break;
                case 'videoMute':
                    this.sendCommand(`OUT ${out} MUTE ${state.val ? 'ON' : 'OFF'}`);
                    break;
                case 'audioMix':
                    this.sendCommand(`OUT ${out} MIX ${state.val}`);
                    break;
                case 'cecEnabled':
                    this.sendCommand(`OUT ${out} CEC ${state.val ? 'ENABLE' : 'DISABLE'}`);
                    break;
            }
            return;
        }

        // Handle input CEC enable/disable (AMF series)
        const cecInputMatch = stateId.match(/^cec\.input(\d)$/);
        if (cecInputMatch) {
            this.sendCommand(`IN ${cecInputMatch[1].padStart(2, '0')} CEC ${state.val ? 'ENABLE' : 'DISABLE'}`);
            return;
        }

        // Handle per-LAN DHCP (WMF series dual LAN)
        const lanDhcpMatch = stateId.match(/^network\.lan(\d)\.dhcp$/);
        if (lanDhcpMatch) {
            this.sendCommand(`LAN ${lanDhcpMatch[1]} DHCP ${state.val ? 'ON' : 'OFF'}`);
            return;
        }

        switch (stateId) {
            case 'system.power':
                this.sendCommand(state.val ? 'PON' : 'POFF');
                break;

            case 'system.ir':
                this.sendCommand(`IR ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'system.key':
                this.sendCommand(`KEY ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'system.beep':
                this.sendCommand(`BEEP ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'system.lcd':
                this.sendCommand(`LCD ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'system.osd':
                this.sendCommand(`OUT OSD ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'system.debug':
                this.sendCommand(`DBG ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'system.autoSwitch':
                this.sendCommand(`OUT AUTO ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'system.ir232':
                this.sendCommand(`IR232 ${state.val}`);
                break;

            case 'system.telnetNegotiation':
                this.config.telnetNegotiation = !!state.val;
                this.log.info(`Telnet IAC negotiation ${state.val ? 'enabled' : 'disabled'}`);
                break;

            case 'output.mode':
                this.sendCommand(`OUT ${state.val}`);
                break;

            case 'output.bypass':
                this.sendCommand(`OUT BYP ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'output.resolution':
                this.sendCommand(`OUT RES ${state.val}`);
                break;

            case 'output.aspectRatio':
                this.sendCommand(`OUT AR ${state.val}`);
                break;

            case 'output.zoom':
                this.sendCommand(`OUT ZOOM ${String(state.val).padStart(2, '0')}`);
                break;

            case 'output.overscan':
                this.sendCommand(`OUT SCAN ${String(state.val).padStart(2, '0')}`);
                break;

            case 'output.freqMode':
                this.sendCommand(`OUT FREQ ${state.val}`);
                break;

            case 'audio.volume':
                this.sendCommand(`VOL ${String(state.val).padStart(2, '0')}`);
                break;

            case 'audio.mute':
                this.sendCommand(`MUTE ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'audio.source':
                this.sendCommand(`AUD SCA ${state.val}`);
                break;

            case 'audio.pcmMode':
                this.sendCommand(`AUD PCM ${state.val}`);
                break;

            // Microphone controls (MFP62)
            case 'microphone.volume':
                this.sendCommand(`MIC VOL ${String(state.val).padStart(2, '0')}`);
                break;

            case 'microphone.mute':
                this.sendCommand(`MIC MUTE ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'microphone.mixMode':
                this.sendCommand(`MIC MIX ${state.val}`);
                break;

            case 'microphone.autoBg':
                this.sendCommand(`MIC AUTOBG ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'microphone.bgVolume':
                this.sendCommand(`MIC BGVOL ${String(state.val).padStart(2, '0')}`);
                break;

            case 'microphone.bgDelay':
                this.sendCommand(`MIC BGR ${String(state.val).padStart(2, '0')}`);
                break;

            case 'microphone.rampUp':
                this.sendCommand(`MIC RUP ${String(state.val).padStart(2, '0')}`);
                break;

            case 'microphone.rampDown':
                this.sendCommand(`MIC RDN ${String(state.val).padStart(2, '0')}`);
                break;

            // Network controls (MFP62)
            case 'network.dhcp':
                this.sendCommand(`NET DHCP ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'network.ip':
                this.sendCommand(`NET IP ${state.val}`);
                break;

            case 'network.gateway':
                this.sendCommand(`NET GW ${state.val}`);
                break;

            case 'network.subnet':
                this.sendCommand(`NET SM ${state.val}`);
                break;

            case 'network.reboot':
                if (state.val) {
                    this.sendCommand('NET RB');
                }
                break;

            case 'commands.raw':
                if (state.val) {
                    this.sendCommand(state.val);
                }
                break;

            case 'commands.vgaAutoAdjust':
                if (state.val) {
                    this.sendCommand('OUT ADJ');
                }
                break;

            case 'commands.getStatus':
                if (state.val) {
                    this.sendCommand('STATUS');
                }
                break;

            // Video mute (WMF: single output; AMF: all outputs)
            case 'system.videoMute':
                this.sendCommand(
                    this.modelDef && this.modelDef.isWireless
                        ? `OUT MUTE ${state.val ? 'ON' : 'OFF'}`
                        : `OUT 00 MUTE ${state.val ? 'ON' : 'OFF'}`,
                );
                break;

            // Auto standby (WMF series)
            case 'system.standbyMode':
                this.sendCommand(state.val ? 'STBYON' : 'STBYOFF');
                break;

            case 'system.standbyDelay':
                this.sendCommand(`STBDLY ${String(state.val).padStart(2, '0')}`);
                break;

            // No-signal standby (AMF series)
            case 'system.noSignalStandby':
                this.sendCommand(`NOSIGSTANDBY ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'system.noSignalDelay':
                this.sendCommand(`NOSIGDLY ${state.val}`);
                break;

            // HDBT POC output (AMF series)
            case 'system.pocOutput':
                this.sendCommand(`POCOUT ${state.val ? 'ON' : 'OFF'}`);
                break;

            // System reboot (WMF series)
            case 'system.reboot':
                if (state.val) {
                    this.sendCommand('REBOOT');
                }
                break;

            // Dual display mode / multiview layout (WMF72)
            case 'output.displayMode':
                this.sendCommand(`OUT DISPLAY MODE ${state.val}`);
                break;

            case 'output.layout':
                this.sendCommand(`OUT LAYOUT ${state.val}`);
                break;

            // Audio mode / output selection (WMF72)
            case 'audio.mode':
                this.sendCommand(`AUDIO MODE ${state.val}`);
                break;

            case 'audio.output':
                this.sendCommand(`AUD OUT ${state.val}`);
                break;

            // Presets (AMF series)
            case 'presets.save':
                this.sendCommand(`PRESET ${String(state.val).padStart(2, '0')} SAVE`);
                break;

            case 'presets.apply':
                this.sendCommand(`PRESET ${String(state.val).padStart(2, '0')} APPLY`);
                break;

            case 'presets.clear':
                this.sendCommand(`PRESET ${String(state.val).padStart(2, '0')} CLR`);
                break;

            // Go to home screen (WMF series)
            case 'commands.homeScreen':
                if (state.val) {
                    this.sendCommand('OSD HOME');
                }
                break;

            // WiFi hotspot controls (WMF series)
            case 'wifi.enabled':
                this.sendCommand(`WIFI ${state.val ? 'ON' : 'OFF'}`);
                break;

            case 'wifi.frequency':
                await this.sendWifiFreqChannel(state.val, null);
                break;

            case 'wifi.channel':
                await this.sendWifiFreqChannel(null, state.val);
                break;

            case 'wifi.ssid':
                this.sendCommand(`WIFI SSID ${state.val}`);
                break;

            case 'wifi.password':
                this.sendCommand(`WIFI PASS ${state.val}`);
                break;

            default:
                this.log.debug(`Unhandled state change: ${stateId}`);
        }
    }

    /**
     * Send the combined WiFi frequency + channel command (WMF series).
     * The device expects both values in a single command, so the value not
     * being changed is read back from its current state.
     *
     * @param freqOverride New frequency value, or null to read the current state
     * @param channelOverride New channel value, or null to read the current state
     */
    async sendWifiFreqChannel(freqOverride, channelOverride) {
        let freq = freqOverride;
        let channel = channelOverride;

        if (freq === null || freq === undefined) {
            const freqState = await this.getStateAsync('wifi.frequency');
            freq = freqState && freqState.val != null ? freqState.val : '2';
        }
        if (channel === null || channel === undefined) {
            const channelState = await this.getStateAsync('wifi.channel');
            channel = channelState && channelState.val != null ? channelState.val : 'auto';
        }

        this.sendCommand(`WIFI FREQ ${freq} CH ${channel}`);
    }

    onUnload(callback) {
        try {
            this.log.info('Blustream adapter stopping...');

            this.stopPolling();

            if (this.reconnectTimer) {
                this.clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            if (this.commandTimeout) {
                this.clearTimeout(this.commandTimeout);
                this.commandTimeout = null;
            }

            if (this.socket) {
                // Detach first: destroy() emits 'close' asynchronously, and that
                // handler would otherwise write states and arm a reconnect timer
                // after unload has finished.
                this.socket.removeAllListeners();
                this.socket.destroy();
                this.socket = null;
            }

            if (this.serialPort && this.serialPort.isOpen) {
                // Same reason as the socket above: the 'close' handler schedules a
                // reconnect, which must not happen once we are shutting down.
                this.serialPort.removeAllListeners();
                this.serialPort.close();
                this.serialPort = null;
            }

            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new BlustreamAdapter(options);
} else {
    new BlustreamAdapter();
}

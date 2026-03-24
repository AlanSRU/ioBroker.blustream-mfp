'use strict';

const utils = require('@iobroker/adapter-core');
const net = require('net');

// Telnet IAC (Interpret As Command) constants
const IAC = 255;   // Interpret As Command
const DONT = 254;  // Refuse to perform option
const DO = 253;    // Request to perform option
const WONT = 252;  // Refuse to perform option
const WILL = 251;  // Agree to perform option
const SB = 250;    // Subnegotiation Begin
const SE = 240;    // Subnegotiation End

// Model definitions with their capabilities and states
const MODEL_DEFINITIONS = {
    // AMF Series - Advanced Multi-Format
    amf42au: {
        name: 'AMF42AU',
        description: '4x2 Advanced Multi-Format Switcher',
        category: 'AMF',
        hasNetwork: true,
        hasBeep: false,
        hasDebug: false,
        hasMicrophone: true,
        hasAutoSwitch: true,
        hasOutputEnable: false,
        hasVideoMute: true,
        hasCEC: true,
        hasPresets: true,
        hasPictureControl: true,
        hasHDBT: true,
        hasPOC: true,
        hasNoSignalStandby: true,
        volumeMax: 100,
        outputs: 2,
        inputs: {
            '01': 'HDMI 1',
            '02': 'HDMI 2',
            '03': 'HDMI 3',
            '04': 'HDMI 4'
        },
        resolutions: {
            '00': '1024x768@60Hz',
            '01': '1280x800@60Hz',
            '02': '1360x768@60Hz',
            '03': '1440x900@60Hz',
            '04': '1680x1050@60Hz',
            '05': '1920x1200@60Hz',
            '06': '720P@50Hz',
            '07': '720P@60Hz',
            '08': '1080P@50Hz',
            '09': '1080P@60Hz',
            '10': '4K2K@30Hz',
            '11': '4K2K@50Hz',
            '12': '4K2K@60Hz'
        },
        audioMixModes: {
            '01': 'HDMI Audio Only',
            '02': 'Mic Audio Only',
            '03': 'AUDEMBED Audio Only',
            '04': 'HDMI + Mic',
            '05': 'AUDEMBED + Mic'
        }
    },
    // MFP Series - Multi-Format Presentation
    mfp62: {
        name: 'MFP62',
        description: '6x2 4K Presentation Switcher',
        category: 'MFP',
        hasNetwork: true,
        hasBeep: false,
        hasDebug: false,
        hasMicrophone: true,
        hasAutoSwitch: true,
        hasOutputEnable: true,
        volumeMax: 100,
        outputs: 2,
        inputs: {
            '01': 'HDMI 1',
            '02': 'HDMI 2',
            '03': 'HDMI 3',
            '04': 'DisplayPort',
            '05': 'USB-C',
            '06': 'VGA'
        },
        resolutions: {
            '00': '1024x768@60Hz',
            '01': '1280x800@60Hz',
            '02': '1360x768@60Hz',
            '03': '1440x900@60Hz',
            '04': '1680x1050@60Hz',
            '05': '1920x1200@60Hz',
            '06': '720P@50Hz',
            '07': '720P@60Hz',
            '08': '1080P@50Hz',
            '09': '1080P@60Hz',
            '10': '4K2K@25Hz',
            '11': '4K2K@30Hz',
            '12': '4K2K@50Hz',
            '13': '4K2K@60Hz',
            '14': 'DCI 4K2K@25Hz',
            '15': 'DCI 4K2K@30Hz',
            '16': 'DCI 4K2K@50Hz',
            '17': 'DCI 4K2K@60Hz',
            '18': 'Auto'
        },
        audioInputs: ['01', '02', '03', '04', '05']  // HDMI1, HDMI2, HDMI3, DP, USB-C
    },
    mfp72: {
        name: 'MFP72',
        description: '4x2 Presentation Switcher',
        category: 'MFP',
        hasNetwork: false,
        hasBeep: true,
        hasDebug: true,
        hasMicrophone: false,
        hasAutoSwitch: false,
        hasOutputEnable: false,
        volumeMax: 30,
        outputs: 2,
        inputs: {
            '01': 'HDMI 1',
            '02': 'HDMI 2',
            '03': 'HDMI 3',
            '04': 'HDMI 4'
        },
        output2ExtraInputs: {
            'AV': 'AV',
            'YPBPR': 'Component',
            'VGA': 'VGA'
        },
        resolutions: {
            '01': '1080P@50Hz',
            '02': '1080P@60Hz',
            '03': '720P@50Hz',
            '04': '720P@60Hz',
            '05': '1280x1024@60Hz',
            '06': '1024x768@60Hz',
            '07': '1360x768@60Hz',
            '08': '1440x900@60Hz',
            '09': '1680x1050@60Hz'
        },
        hasAspectRatio: true,
        hasZoom: true,
        hasOverscan: true
    },
    mfp112: {
        name: 'MFP112',
        description: '5x2 Presentation Switcher with HDBaseT',
        category: 'MFP',
        hasNetwork: true,  // Has built-in TCP port 8000
        hasBeep: true,
        hasDebug: true,
        hasMicrophone: false,
        hasAutoSwitch: false,
        hasOutputEnable: true,
        hasHDBaseT: true,
        hasBypass: true,
        hasIR232: true,
        hasPerInputAudio: true,
        volumeMax: 30,
        outputs: 2,
        inputs: {
            '01': 'HDMI 1',
            '02': 'HDMI 2',
            '03': 'HDMI 3',
            '04': 'HDMI 4',
            'HDBT': 'HDBaseT'
        },
        output2ExtraInputs: {
            'AV': 'AV',
            'YPBPR': 'Component',
            'VGA1': 'VGA 1',
            'VGA2': 'VGA 2',
            'VGA3': 'VGA 3',
            'VGA4': 'VGA 4'
        },
        resolutions: {
            '01': '1080P@50Hz',
            '02': '1080P@60Hz',
            '03': '720P@50Hz',
            '04': '720P@60Hz',
            '05': '1280x1024@60Hz',
            '06': '1024x768@60Hz',
            '07': '1360x768@60Hz',
            '08': '1440x900@60Hz',
            '09': '1680x1050@60Hz'
        },
        hasAspectRatio: true,
        hasZoom: true,
        hasOverscan: true
    },
    // WMF Series - Wireless Media
    wmf51: {
        name: 'WMF51',
        description: 'Wireless Media Presenter',
        category: 'WMF',
        hasNetwork: true,
        hasWifi: true,
        hasBeep: false,
        hasDebug: false,
        hasMicrophone: false,
        hasAutoSwitch: false,
        hasOutputEnable: false,
        hasVideoMute: true,
        hasMultiview: true,
        hasStandby: true,
        hasSidebar: true,
        isWireless: true,
        volumeMax: 100,
        outputs: 1,
        inputs: {},  // Wireless inputs - dynamic
        resolutions: {
            '00': 'Auto',
            '01': '720P@50Hz',
            '02': '720P@60Hz',
            '03': '1080P@30Hz',
            '04': '1080P@50Hz',
            '05': '1080P@60Hz',
            '06': '4K@30Hz',
            '07': '4K@50Hz',
            '08': '4K@60Hz'
        },
        dualLAN: true
    },
    wmf72: {
        name: 'WMF72',
        description: 'Wireless Media Presenter with Dual Display',
        category: 'WMF',
        hasNetwork: true,
        hasWifi: true,
        hasBeep: false,
        hasDebug: false,
        hasMicrophone: false,
        hasAutoSwitch: true,
        hasOutputEnable: false,
        hasVideoMute: true,
        hasMultiview: true,
        hasStandby: true,
        hasSidebar: true,
        hasDualDisplay: true,
        hasDisplayModes: true,
        hasLayouts: true,
        hasAudioModes: true,
        hasSecurity: true,
        hasUSBControl: true,
        isWireless: true,
        volumeMax: 100,
        outputs: 2,
        inputs: {},  // Wireless inputs - dynamic
        resolutions: {
            '00': 'Auto',
            '01': '720P@50Hz',
            '02': '720P@60Hz',
            '03': '1080P@30Hz',
            '04': '1080P@50Hz',
            '05': '1080P@60Hz',
            '06': '3840x2160@30Hz',
            '07': '3840x2160@50Hz',
            '08': '3840x2160@60Hz',
            '09': '4096x2160@30Hz',
            '10': '4096x2160@50Hz',
            '11': '4096x2160@60Hz'
        },
        displayModes: {
            '1': 'Mirroring',
            '2': 'Multiview + Single',
            '3': 'Single + Multiview'
        },
        layouts: {
            '01': 'Single',
            '02': 'Dual',
            '03': 'Triple-T',
            '04': 'Triple-L',
            '05': 'Triple-B',
            '06': 'Triple-R',
            '07': 'Quad',
            '08': 'Quad-B',
            '09': 'Quad-R',
            '10': 'Quad-T',
            '11': 'Quad-L'
        },
        audioModes: {
            '01': 'Audio Mixer',
            '02': 'Single Input Source',
            '03': 'Single Input Window',
            '04': 'First IN',
            '05': 'Last IN'
        },
        dualLAN: true
    }
};

// All possible state paths that could be created by any model
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
    'system.videoMute',
    'system.standbyMode',
    'system.standbyDelay',
    'system.noSignalStandby',
    'system.noSignalDelay',
    'system.pocOutput',
    'system.reboot',
    'output',
    'output.1',
    'output.1.source',
    'output.1.enabled',
    'output.1.resolution',
    'output.1.videoMute',
    'output.1.sidebar',
    'output.1.brightness',
    'output.1.contrast',
    'output.1.pictureMode',
    'output.1.colourTemp',
    'output.1.red',
    'output.1.green',
    'output.1.blue',
    'output.1.audioMix',
    'output.1.cecEnabled',
    'output.2',
    'output.2.source',
    'output.2.enabled',
    'output.2.resolution',
    'output.2.videoMute',
    'output.2.sidebar',
    'output.2.brightness',
    'output.2.contrast',
    'output.2.pictureMode',
    'output.2.colourTemp',
    'output.2.red',
    'output.2.green',
    'output.2.blue',
    'output.2.audioMix',
    'output.2.cecEnabled',
    'output.3',
    'output.3.cecEnabled',
    'output.mode',
    'output.bypass',
    'output.resolution',
    'output.aspectRatio',
    'output.zoom',
    'output.overscan',
    'output.freqMode',
    'output.displayMode',
    'output.layout',
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
    'audio.analogFollow',
    'audio.digitalFollow',
    'audio.embedVolume',
    'audio.hdmiVolume',
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
    'network.lan1.dns',
    'network.lan2',
    'network.lan2.dhcp',
    'network.lan2.ip',
    'network.lan2.gateway',
    'network.lan2.subnet',
    'network.lan2.tcpPort',
    'network.lan2.dns',
    'wifi',
    'wifi.enabled',
    'wifi.frequency',
    'wifi.channel',
    'wifi.ssid',
    'wifi.password',
    'wifi.refreshPassword',
    'cec',
    'cec.output1',
    'cec.output2',
    'cec.output3',
    'cec.input1',
    'cec.input2',
    'cec.input3',
    'cec.input4',
    'commands.vgaAutoAdjust',
    'commands.homeScreen',
    'commands.forceInput'
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

        // Set model info
        await this.setStateAsync('info.model', this.modelDef.name, true);

        // Clean up states from other models and create current model states
        await this.setupModelStates();

        await this.setStateAsync('info.connection', false, true);

        this.subscribeStates('*');

        this.connect();
    }

    async setupModelStates() {
        const model = this.config.deviceModel || 'mfp72';
        const def = this.modelDef;

        this.log.info(`Setting up states for model: ${def.name}`);

        // Only delete and recreate states if the model has changed
        const lastModelState = await this.getStateAsync('info.model');
        const lastModel = lastModelState && lastModelState.val;
        const modelChanged = lastModel !== def.name;

        if (modelChanged) {
            this.log.info(`Model changed from ${lastModel || 'none'} to ${def.name}, recreating states`);
            for (const statePath of ALL_MODEL_STATES) {
                try {
                    await this.delObjectAsync(statePath, { recursive: true });
                } catch (e) {
                    // Ignore errors - state might not exist
                }
            }
        }

        // Create system channel and common states
        await this.setObjectNotExistsAsync('system', {
            type: 'channel',
            common: { name: 'System Control' },
            native: {}
        });

        await this.setObjectNotExistsAsync('system.power', {
            type: 'state',
            common: {
                role: 'switch.power',
                name: 'Power',
                type: 'boolean',
                read: true,
                write: true,
                def: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('system.ir', {
            type: 'state',
            common: {
                role: 'switch.enable',
                name: 'IR Control',
                type: 'boolean',
                read: true,
                write: true,
                def: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('system.key', {
            type: 'state',
            common: {
                role: 'switch.enable',
                name: 'Key Control',
                type: 'boolean',
                read: true,
                write: true,
                def: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('system.lcd', {
            type: 'state',
            common: {
                role: 'switch.enable',
                name: 'LCD Always On',
                type: 'boolean',
                read: true,
                write: true,
                def: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('system.osd', {
            type: 'state',
            common: {
                role: 'switch.enable',
                name: 'OSD Display',
                type: 'boolean',
                read: true,
                write: true,
                def: true
            },
            native: {}
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
                    def: true
                },
                native: {}
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
                    def: false
                },
                native: {}
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
                    def: false
                },
                native: {}
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
                        'OFF': 'Disconnected',
                        'RRX': 'Remote RX',
                        'RTX': 'Remote TX',
                        'BOTH': 'Both RX and TX'
                    },
                    def: 'OFF'
                },
                native: {}
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
                def: true
            },
            native: {}
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
            native: {}
        });

        // Create output states for each output
        for (let i = 1; i <= def.outputs; i++) {
            await this.setObjectNotExistsAsync(`output.${i}`, {
                type: 'channel',
                common: { name: `Output ${i}` },
                native: {}
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
                    states: sources
                },
                native: {}
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
                        def: true
                    },
                    native: {}
                });
            }
        }

        // Output mode (splitter/matrix) - for MFP72/MFP112
        if (!def.hasAutoSwitch) {
            await this.setObjectNotExistsAsync('output.mode', {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Output Mode',
                    type: 'string',
                    read: true,
                    write: true,
                    states: {
                        'SP': 'Splitter',
                        'MX': 'Matrix'
                    }
                },
                native: {}
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
                    def: false
                },
                native: {}
            });
        }

        // Resolution
        await this.setObjectNotExistsAsync('output.resolution', {
            type: 'state',
            common: {
                role: 'state',
                name: 'Output Resolution',
                type: 'string',
                read: true,
                write: true,
                states: def.resolutions
            },
            native: {}
        });

        // Frequency mode
        await this.setObjectNotExistsAsync('output.freqMode', {
            type: 'state',
            common: {
                role: 'state',
                name: 'Frequency Mode',
                type: 'string',
                read: true,
                write: true,
                states: {
                    'AUTO': 'Auto',
                    'FORCE': 'Force'
                }
            },
            native: {}
        });

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
                    states: {
                        '00': 'Full Screen',
                        '01': 'Keep Aspect Ratio',
                        '02': '16:9',
                        '03': '4:3'
                    }
                },
                native: {}
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
                    min: 0,
                    max: 8,
                    states: {
                        0: 'No Zoom', 1: '2%', 2: '4%', 3: '6%', 4: '8%',
                        5: '10%', 6: '12%', 7: '14%', 8: '16%'
                    }
                },
                native: {}
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
                    min: 0,
                    max: 8,
                    states: {
                        0: 'No Overscan', 1: '2%', 2: '4%', 3: '6%', 4: '8%',
                        5: '10%', 6: '12%', 7: '14%', 8: '16%'
                    }
                },
                native: {}
            });
        }

        // Audio channel
        await this.setObjectNotExistsAsync('audio', {
            type: 'channel',
            common: { name: 'Audio Control' },
            native: {}
        });

        await this.setObjectNotExistsAsync('audio.volume', {
            type: 'state',
            common: {
                role: 'level.volume',
                name: 'Volume',
                type: 'number',
                read: true,
                write: true,
                min: 0,
                max: def.volumeMax,
                unit: ''
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('audio.mute', {
            type: 'state',
            common: {
                role: 'media.mute',
                name: 'Mute',
                type: 'boolean',
                read: true,
                write: true,
                def: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('audio.source', {
            type: 'state',
            common: {
                role: 'state',
                name: 'Audio Source',
                type: 'string',
                read: true,
                write: true,
                states: {
                    'ORG': 'Follow Video',
                    'ANA': 'Analog Input'
                }
            },
            native: {}
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
                    states: {
                        'SCA': 'Scaler Process',
                        'BYP': 'Bypass'
                    }
                },
                native: {}
            });

            // Per-input audio for MFP62 (RX inputs)
            await this.setObjectNotExistsAsync('audio.rx', {
                type: 'channel',
                common: { name: 'Input Audio Settings' },
                native: {}
            });

            const rxInputNames = ['HDMI1', 'HDMI2', 'HDMI3', 'DP', 'USB-C'];
            for (let i = 1; i <= 5; i++) {
                await this.setObjectNotExistsAsync(`audio.rx.input${i}`, {
                    type: 'state',
                    common: {
                        role: 'state',
                        name: `${rxInputNames[i-1]} Audio Mode`,
                        type: 'string',
                        read: true,
                        write: true,
                        states: {
                            'ORG': 'Original HDMI/DVI',
                            'ANA': 'Embed Analog L/R'
                        },
                        def: 'ORG'
                    },
                    native: {}
                });
            }
        }

        // MFP112-specific per-input audio
        if (def.hasPerInputAudio) {
            await this.setObjectNotExistsAsync('audio.hdmi', {
                type: 'channel',
                common: { name: 'HDMI Input Audio Settings' },
                native: {}
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
                            'ORG': 'Original HDMI/DVI',
                            'ANA': 'Embed Analog L/R',
                            'AUTO': 'Auto (Analog when DVI)'
                        },
                        def: 'ORG'
                    },
                    native: {}
                });
            }
        }

        // Microphone controls (MFP62 only)
        if (def.hasMicrophone) {
            await this.setObjectNotExistsAsync('microphone', {
                type: 'channel',
                common: { name: 'Microphone Control' },
                native: {}
            });

            await this.setObjectNotExistsAsync('microphone.volume', {
                type: 'state',
                common: {
                    role: 'level.volume',
                    name: 'Microphone Volume',
                    type: 'number',
                    read: true,
                    write: true,
                    min: 0,
                    max: 100
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('microphone.mute', {
                type: 'state',
                common: {
                    role: 'media.mute',
                    name: 'Microphone Mute',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false
                },
                native: {}
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
                        'ON': 'Mix MIC + Background',
                        'BGO': 'Background Only',
                        'MICO': 'MIC Only'
                    },
                    def: 'ON'
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('microphone.autoBg', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'Auto Decrease Background',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('microphone.bgVolume', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Background Volume Percent',
                    type: 'number',
                    read: true,
                    write: true,
                    min: 0,
                    max: 100,
                    unit: '%'
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('microphone.bgDelay', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Background Restore Delay',
                    type: 'number',
                    read: true,
                    write: true,
                    min: 1,
                    max: 20,
                    unit: 's'
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('microphone.rampUp', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Ramp Up Time',
                    type: 'number',
                    read: true,
                    write: true,
                    min: 0,
                    max: 20,
                    unit: 'x0.5s'
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('microphone.rampDown', {
                type: 'state',
                common: {
                    role: 'level',
                    name: 'Ramp Down Time',
                    type: 'number',
                    read: true,
                    write: true,
                    min: 0,
                    max: 20,
                    unit: 'x0.5s'
                },
                native: {}
            });
        }

        // Network controls (MFP62 only)
        if (def.hasNetwork) {
            await this.setObjectNotExistsAsync('network', {
                type: 'channel',
                common: { name: 'Network Settings' },
                native: {}
            });

            await this.setObjectNotExistsAsync('network.dhcp', {
                type: 'state',
                common: {
                    role: 'switch.enable',
                    name: 'DHCP Enabled',
                    type: 'boolean',
                    read: true,
                    write: true,
                    def: false
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('network.ip', {
                type: 'state',
                common: {
                    role: 'info.ip',
                    name: 'IP Address',
                    type: 'string',
                    read: true,
                    write: true
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('network.gateway', {
                type: 'state',
                common: {
                    role: 'info.ip',
                    name: 'Gateway',
                    type: 'string',
                    read: true,
                    write: true
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('network.subnet', {
                type: 'state',
                common: {
                    role: 'info.ip',
                    name: 'Subnet Mask',
                    type: 'string',
                    read: true,
                    write: true
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('network.telnetPort', {
                type: 'state',
                common: {
                    role: 'value.port',
                    name: 'Telnet Port',
                    type: 'number',
                    read: true,
                    write: true,
                    min: 1,
                    max: 65535
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('network.reboot', {
                type: 'state',
                common: {
                    role: 'button',
                    name: 'Reboot Network',
                    type: 'boolean',
                    read: false,
                    write: true
                },
                native: {}
            });

            // Dual LAN support for WMF series
            if (def.dualLAN) {
                for (const lan of ['lan1', 'lan2']) {
                    const lanNum = lan === 'lan1' ? 1 : 2;
                    await this.setObjectNotExistsAsync(`network.${lan}`, {
                        type: 'channel',
                        common: { name: `LAN ${lanNum}` },
                        native: {}
                    });

                    await this.setObjectNotExistsAsync(`network.${lan}.dhcp`, {
                        type: 'state',
                        common: { role: 'switch.enable', name: 'DHCP', type: 'boolean', read: true, write: true },
                        native: {}
                    });

                    await this.setObjectNotExistsAsync(`network.${lan}.ip`, {
                        type: 'state',
                        common: { role: 'info.ip', name: 'IP Address', type: 'string', read: true, write: true },
                        native: {}
                    });

                    await this.setObjectNotExistsAsync(`network.${lan}.gateway`, {
                        type: 'state',
                        common: { role: 'info.ip', name: 'Gateway', type: 'string', read: true, write: true },
                        native: {}
                    });

                    await this.setObjectNotExistsAsync(`network.${lan}.subnet`, {
                        type: 'state',
                        common: { role: 'info.ip', name: 'Subnet Mask', type: 'string', read: true, write: true },
                        native: {}
                    });

                    await this.setObjectNotExistsAsync(`network.${lan}.tcpPort`, {
                        type: 'state',
                        common: { role: 'value.port', name: 'TCP Port', type: 'number', read: true, write: true },
                        native: {}
                    });
                }
            }
        }

        // WiFi controls (WMF series)
        if (def.hasWifi) {
            await this.setObjectNotExistsAsync('wifi', {
                type: 'channel',
                common: { name: 'WiFi Hotspot' },
                native: {}
            });

            await this.setObjectNotExistsAsync('wifi.enabled', {
                type: 'state',
                common: { role: 'switch.enable', name: 'WiFi Enabled', type: 'boolean', read: true, write: true },
                native: {}
            });

            await this.setObjectNotExistsAsync('wifi.frequency', {
                type: 'state',
                common: {
                    role: 'state', name: 'WiFi Frequency', type: 'string', read: true, write: true,
                    states: { '2': '2.4GHz', '5': '5GHz' }
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('wifi.channel', {
                type: 'state',
                common: { role: 'state', name: 'WiFi Channel', type: 'string', read: true, write: true },
                native: {}
            });

            await this.setObjectNotExistsAsync('wifi.ssid', {
                type: 'state',
                common: { role: 'text', name: 'SSID', type: 'string', read: true, write: true },
                native: {}
            });

            await this.setObjectNotExistsAsync('wifi.password', {
                type: 'state',
                common: { role: 'text', name: 'Password', type: 'string', read: true, write: true },
                native: {}
            });
        }

        // Video mute (WMF/AMF series)
        if (def.hasVideoMute) {
            await this.setObjectNotExistsAsync('system.videoMute', {
                type: 'state',
                common: { role: 'switch.enable', name: 'Video Mute', type: 'boolean', read: true, write: true, def: false },
                native: {}
            });
        }

        // Standby controls (WMF series)
        if (def.hasStandby) {
            await this.setObjectNotExistsAsync('system.standbyMode', {
                type: 'state',
                common: { role: 'switch.enable', name: 'Auto Standby', type: 'boolean', read: true, write: true },
                native: {}
            });

            await this.setObjectNotExistsAsync('system.standbyDelay', {
                type: 'state',
                common: { role: 'level', name: 'Standby Delay (min)', type: 'number', read: true, write: true, min: 0, max: 30 },
                native: {}
            });
        }

        // No signal standby (AMF series)
        if (def.hasNoSignalStandby) {
            await this.setObjectNotExistsAsync('system.noSignalStandby', {
                type: 'state',
                common: { role: 'switch.enable', name: 'No Signal Standby', type: 'boolean', read: true, write: true },
                native: {}
            });

            await this.setObjectNotExistsAsync('system.noSignalDelay', {
                type: 'state',
                common: { role: 'level', name: 'No Signal Delay (sec)', type: 'number', read: true, write: true, min: 300, max: 10800, def: 600 },
                native: {}
            });
        }

        // POC output (AMF series)
        if (def.hasPOC) {
            await this.setObjectNotExistsAsync('system.pocOutput', {
                type: 'state',
                common: { role: 'switch.enable', name: 'HDBT POC Output', type: 'boolean', read: true, write: true },
                native: {}
            });
        }

        // Reboot command (WMF series)
        if (def.isWireless) {
            await this.setObjectNotExistsAsync('system.reboot', {
                type: 'state',
                common: { role: 'button', name: 'Reboot System', type: 'boolean', read: false, write: true },
                native: {}
            });

            await this.setObjectNotExistsAsync('commands.homeScreen', {
                type: 'state',
                common: { role: 'button', name: 'Go to Home Screen', type: 'boolean', read: false, write: true },
                native: {}
            });
        }

        // Sidebar controls (WMF series)
        if (def.hasSidebar) {
            for (let i = 1; i <= def.outputs; i++) {
                await this.setObjectNotExistsAsync(`output.${i}.sidebar`, {
                    type: 'state',
                    common: { role: 'switch.enable', name: `Output ${i} Sidebar`, type: 'boolean', read: true, write: true },
                    native: {}
                });
            }
        }

        // Display modes (WMF72)
        if (def.hasDisplayModes) {
            await this.setObjectNotExistsAsync('output.displayMode', {
                type: 'state',
                common: {
                    role: 'state', name: 'Display Mode', type: 'string', read: true, write: true,
                    states: def.displayModes
                },
                native: {}
            });
        }

        // Layouts (WMF72)
        if (def.hasLayouts) {
            await this.setObjectNotExistsAsync('output.layout', {
                type: 'state',
                common: {
                    role: 'state', name: 'Multiview Layout', type: 'string', read: true, write: true,
                    states: def.layouts
                },
                native: {}
            });
        }

        // Audio modes (WMF72)
        if (def.hasAudioModes) {
            await this.setObjectNotExistsAsync('audio.mode', {
                type: 'state',
                common: {
                    role: 'state', name: 'Audio Mode', type: 'string', read: true, write: true,
                    states: def.audioModes
                },
                native: {}
            });

            await this.setObjectNotExistsAsync('audio.output', {
                type: 'state',
                common: {
                    role: 'state', name: 'Audio Output', type: 'string', read: true, write: true,
                    states: { '00': 'Analog + HDMI', '01': 'HDMI Only', '02': 'Analog Only', '03': 'USB Only' }
                },
                native: {}
            });
        }

        // Picture controls (AMF series)
        if (def.hasPictureControl) {
            for (let i = 1; i <= def.outputs; i++) {
                await this.setObjectNotExistsAsync(`output.${i}.brightness`, {
                    type: 'state',
                    common: { role: 'level', name: `Output ${i} Brightness`, type: 'number', read: true, write: true, min: 0, max: 99 },
                    native: {}
                });

                await this.setObjectNotExistsAsync(`output.${i}.contrast`, {
                    type: 'state',
                    common: { role: 'level', name: `Output ${i} Contrast`, type: 'number', read: true, write: true, min: 0, max: 99 },
                    native: {}
                });

                await this.setObjectNotExistsAsync(`output.${i}.pictureMode`, {
                    type: 'state',
                    common: {
                        role: 'state', name: `Output ${i} Picture Mode`, type: 'string', read: true, write: true,
                        states: { '01': 'Soft', '02': 'Standard', '03': 'Vivid', '04': 'User' }
                    },
                    native: {}
                });

                await this.setObjectNotExistsAsync(`output.${i}.colourTemp`, {
                    type: 'state',
                    common: {
                        role: 'state', name: `Output ${i} Colour Temperature`, type: 'string', read: true, write: true,
                        states: { '01': 'Warm', '02': 'Standard', '03': 'Cool', '04': 'User' }
                    },
                    native: {}
                });

                await this.setObjectNotExistsAsync(`output.${i}.videoMute`, {
                    type: 'state',
                    common: { role: 'switch.enable', name: `Output ${i} Video Mute`, type: 'boolean', read: true, write: true },
                    native: {}
                });

                await this.setObjectNotExistsAsync(`output.${i}.audioMix`, {
                    type: 'state',
                    common: {
                        role: 'state', name: `Output ${i} Audio Mix`, type: 'string', read: true, write: true,
                        states: def.audioMixModes || {}
                    },
                    native: {}
                });
            }
        }

        // Presets (AMF series)
        if (def.hasPresets) {
            await this.setObjectNotExistsAsync('presets', {
                type: 'channel',
                common: { name: 'Presets' },
                native: {}
            });

            await this.setObjectNotExistsAsync('presets.save', {
                type: 'state',
                common: { role: 'level', name: 'Save to Preset', type: 'number', read: false, write: true, min: 1, max: 9 },
                native: {}
            });

            await this.setObjectNotExistsAsync('presets.apply', {
                type: 'state',
                common: { role: 'level', name: 'Apply Preset', type: 'number', read: false, write: true, min: 1, max: 9 },
                native: {}
            });

            await this.setObjectNotExistsAsync('presets.clear', {
                type: 'state',
                common: { role: 'level', name: 'Clear Preset', type: 'number', read: false, write: true, min: 1, max: 9 },
                native: {}
            });
        }

        // CEC controls (AMF series)
        if (def.hasCEC) {
            await this.setObjectNotExistsAsync('cec', {
                type: 'channel',
                common: { name: 'CEC Control' },
                native: {}
            });

            // Output CEC
            for (let i = 1; i <= 3; i++) {
                await this.setObjectNotExistsAsync(`output.${i}.cecEnabled`, {
                    type: 'state',
                    common: { role: 'switch.enable', name: `Output ${i} CEC`, type: 'boolean', read: true, write: true },
                    native: {}
                });
            }

            // Input CEC
            for (let i = 1; i <= 4; i++) {
                await this.setObjectNotExistsAsync(`cec.input${i}`, {
                    type: 'state',
                    common: { role: 'switch.enable', name: `Input ${i} CEC`, type: 'boolean', read: true, write: true },
                    native: {}
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
                    write: true
                },
                native: {}
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

        this.socket.on('data', (data) => {
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

        this.socket.on('error', (err) => {
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
                autoOpen: false
            });

            this.serialPort.on('open', () => {
                this.log.info('Serial port opened');
                this.connected = true;
                this.setStateAsync('info.connection', true, true);
                this.startPolling();
                this.processCommandQueue();
            });

            this.serialPort.on('data', (data) => {
                this.handleData(data.toString());
            });

            this.serialPort.on('error', (err) => {
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

            this.serialPort.open((err) => {
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
            clearTimeout(this.reconnectTimer);
        }

        const interval = this.config.reconnectInterval || 10000;
        this.log.info(`Scheduling reconnect in ${interval}ms...`);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, interval);
    }

    /**
     * Handle Telnet IAC (Interpret As Command) sequences
     * Responds to DO/WILL requests with WONT/DONT to refuse options
     * Returns the data buffer with IAC sequences stripped out
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
                        this.log.debug(`Telnet: Received ${command === DO ? 'DO' : 'DONT'} option ${option}, responding WONT`);
                        this.sendTelnetResponse(WONT, option);
                        i += 3;
                    } else {
                        i += 2;
                    }
                } else if (command === WILL || command === WONT) {
                    // Server telling us it WILL/WONT do something - respond with DONT
                    if (i + 2 < data.length) {
                        const option = data[i + 2];
                        this.log.debug(`Telnet: Received ${command === WILL ? 'WILL' : 'WONT'} option ${option}, responding DONT`);
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
                if (!this._responseLines) this._responseLines = [];
                this._responseLines.push(line.trim());
                // When we hit a separator line, flush the full response
                if (/^={5,}$/.test(line.trim())) {
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
            clearTimeout(this.commandTimeout);
            this.commandTimeout = null;
        }

        // Skip separator lines and title lines
        if (/^={3,}$/.test(response) || /Status$/i.test(response) || /^FW Version/i.test(response) || /^Scaler Version/i.test(response)) {
            // End of STATUS response — release command queue on separator
            if (/^={3,}$/.test(response)) {
                this._statusHeaders = null;
                this.currentCommand = null;
                this.processCommandQueue();
            }
            return;
        }

        // Tab-delimited STATUS table parsing (MFP112 format)
        if (response.includes('\t')) {
            const cols = response.split('\t').map(c => c.trim());

            // Detect header rows by known header keywords
            const headerKeywords = ['Power', 'Input', 'Output', 'ScalerAudio', 'ScalerBypass', 'ScalerAspect'];
            if (headerKeywords.some(h => cols[0] === h || cols.includes(h))) {
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

    parseStatusTableRow(tableType, data) {
        switch (tableType) {
            case 'Power':
                // System row: Power, IR, Key, DBG, Beep, LCD, IR_RS232
                if (data.Power) this.setStateAsync('system.power', data.Power.toUpperCase() === 'ON', true);
                if (data.IR) this.setStateAsync('system.ir', data.IR.toUpperCase() === 'ON', true);
                if (data.Key) this.setStateAsync('system.key', data.Key.toUpperCase() === 'ON', true);
                if (data.DBG) this.setStateAsync('system.debug', data.DBG.toUpperCase() === 'ON', true);
                if (data.Beep) this.setStateAsync('system.beep', data.Beep.toUpperCase() === 'ON', true);
                if (data.LCD) this.setStateAsync('system.lcd', data.LCD.toUpperCase() === 'ON', true);
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
                        const inputMap = { 'HDMI1': '01', 'HDMI2': '02', 'HDMI3': '03', 'HDMI4': '04', 'HDBT': 'HDBT', 'AV': 'AV', 'YPbPr': 'YPBPR', 'YPBPR': 'YPBPR', 'VGA': 'VGA', 'VGA1': 'VGA1', 'VGA2': 'VGA2', 'VGA3': 'VGA3', 'VGA4': 'VGA4' };
                        const source = inputMap[data.SelectInput] || data.SelectInput;
                        this.setStateAsync(`output.${outputNum}.source`, source, true);
                    }
                    if (data.OutputEn) {
                        this.setStateAsync(`output.${outputNum}.enabled`, data.OutputEn.trim().toUpperCase() === 'YES', true);
                    }
                    if (data.Mode) {
                        const mode = data.Mode.toUpperCase();
                        this.setStateAsync('output.mode', mode === 'SPLITTER' ? 'SP' : (mode === 'MATRIX' ? 'MX' : mode), true);
                    }
                }
                break;
            }

            case 'ScalerAudio':
                // Audio row: ScalerAudio, Volume, Mute, Format
                if (data.Volume) this.setStateAsync('audio.volume', parseInt(data.Volume, 10), true);
                if (data.Mute) this.setStateAsync('audio.mute', data.Mute.toUpperCase() === 'ON', true);
                if (data.ScalerAudio) {
                    const src = data.ScalerAudio.toUpperCase().trim();
                    this.setStateAsync('audio.source', src === 'ORGINAL' ? 'ORG' : 'ANA', true);
                }
                break;

            case 'ScalerBypass':
                // Bypass row: ScalerBypass, Resolution, Frequence
                if (data.ScalerBypass) this.setStateAsync('output.bypass', data.ScalerBypass.toUpperCase() === 'ON', true);
                if (data.Resolution) {
                    // Reverse-lookup resolution code from the display string
                    const resDef = this.modelDef && this.modelDef.resolutions;
                    if (resDef) {
                        const resCode = Object.keys(resDef).find(k => resDef[k] === data.Resolution);
                        if (resCode) this.setStateAsync('output.resolution', resCode, true);
                    }
                }
                if (data.Frequence) {
                    this.setStateAsync('output.freqMode', data.Frequence.toUpperCase(), true);
                }
                break;

            case 'ScalerAspect':
                // Aspect row: ScalerAspect, OSD, ZoomOut, Overscan
                if (data.ScalerAspect) {
                    const arMap = { 'FULLSCREEN': '00', 'KEEPASPECTRATIO': '01', '16:9': '02', '4:3': '03' };
                    const arVal = arMap[data.ScalerAspect.toUpperCase().replace(/\s+/g, '')] || '00';
                    this.setStateAsync('output.aspectRatio', arVal, true);
                }
                if (data.OSD) this.setStateAsync('system.osd', data.OSD.toUpperCase() === 'ON', true);
                if (data.ZoomOut) {
                    const zoom = data.ZoomOut.toUpperCase() === 'NO' ? 0 : parseInt(data.ZoomOut.replace(/[^0-9]/g, ''), 10) || 0;
                    this.setStateAsync('output.zoom', zoom, true);
                }
                if (data.Overscan) {
                    const scan = data.Overscan.toUpperCase() === 'NO' ? 0 : parseInt(data.Overscan.replace(/[^0-9]/g, ''), 10) || 0;
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
            if (match) this.setStateAsync('system.power', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('IR:') && !response.includes('IR232:')) {
            const match = response.match(/\bIR:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('system.ir', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('KEY:')) {
            const match = response.match(/KEY:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('system.key', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('BEEP:')) {
            const match = response.match(/BEEP:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('system.beep', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('LCD:')) {
            const match = response.match(/LCD:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('system.lcd', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('OSD:')) {
            const match = response.match(/OSD:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('system.osd', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('DBG:')) {
            const match = response.match(/DBG:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('system.debug', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('AUTO:')) {
            const match = response.match(/AUTO:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('system.autoSwitch', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('MUTE:')) {
            const match = response.match(/MUTE:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('audio.mute', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('VOL:')) {
            const match = response.match(/VOL:\s*(\d+)/i);
            if (match) this.setStateAsync('audio.volume', parseInt(match[1], 10), true);
        }

        if (response.includes('BYP:')) {
            const match = response.match(/BYP:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('output.bypass', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('IR232:')) {
            const match = response.match(/IR232:\s*(OFF|RRX|RTX|BOTH)/i);
            if (match) this.setStateAsync('system.ir232', match[1].toUpperCase(), true);
        }

        // Output routing: OUT 01 FR 02
        const outMatch = response.match(/OUT\s*(\d+)\s*FR\s*(\w+)/i);
        if (outMatch) {
            const output = parseInt(outMatch[1], 10);
            this.setStateAsync(`output.${output}.source`, outMatch[2], true);
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
                this.setStateAsync('output.mode', mode === 'SPLITTER' ? 'SP' : (mode === 'MATRIX' ? 'MX' : mode), true);
            }
        }

        if (response.includes('RES:')) {
            const match = response.match(/RES:\s*(\d+)/i);
            if (match) this.setStateAsync('output.resolution', match[1].padStart(2, '0'), true);
        }

        if (response.includes('AR:')) {
            const match = response.match(/AR:\s*(\d+)/i);
            if (match) this.setStateAsync('output.aspectRatio', match[1].padStart(2, '0'), true);
        }

        if (response.includes('MIC VOL:')) {
            const match = response.match(/MIC VOL:\s*(\d+)/i);
            if (match) this.setStateAsync('microphone.volume', parseInt(match[1], 10), true);
        }

        if (response.includes('MIC MUTE:')) {
            const match = response.match(/MIC MUTE:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('microphone.mute', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('MIC MIX:')) {
            const match = response.match(/MIC MIX:\s*(ON|BGO|MICO)/i);
            if (match) this.setStateAsync('microphone.mixMode', match[1].toUpperCase(), true);
        }

        if (response.includes('DHCP:')) {
            const match = response.match(/DHCP:\s*(ON|OFF)/i);
            if (match) this.setStateAsync('network.dhcp', match[1].toUpperCase() === 'ON', true);
        }

        if (response.includes('IP:') && !response.includes('DHCP')) {
            const match = response.match(/IP:\s*(\d+\.\d+\.\d+\.\d+)/i);
            if (match) this.setStateAsync('network.ip', match[1], true);
        }
    }

    startPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
        }

        const interval = this.config.pollingInterval || 30000;

        // Initial status request
        this.sendCommand('STATUS');

        this.pollingTimer = setInterval(() => {
            if (this.connected) {
                this.sendCommand('STATUS');
            }
        }, interval);
    }

    stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
    }

    sendCommand(command) {
        this.commandQueue.push(command);
        this.processCommandQueue();
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

        this.log.debug(`Sending command: ${command}`);
        this.setStateAsync('info.lastSent', command, true);

        const cmdWithCR = command + '\r';

        try {
            if (this.config.connectionType === 'serial' && this.serialPort && this.serialPort.isOpen) {
                this.serialPort.write(cmdWithCR, (err) => {
                    if (err) {
                        this.log.error(`Error writing to serial port: ${err.message}`);
                    }
                });
            } else if (this.socket && this.connected) {
                this.socket.write(cmdWithCR);
            }

            this.commandTimeout = setTimeout(() => {
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
        this.log.debug(`State change: ${stateId} = ${state.val}`);

        const model = this.config.deviceModel || 'mfp72';

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

        // Handle output source changes
        const outputSourceMatch = stateId.match(/^output\.(\d)\.source$/);
        if (outputSourceMatch) {
            const outputNum = outputSourceMatch[1];
            this.sendCommand(`OUT ${outputNum.padStart(2, '0')} FR ${state.val}`);
            return;
        }

        // Handle output enable changes
        const outputEnableMatch = stateId.match(/^output\.(\d)\.enabled$/);
        if (outputEnableMatch) {
            const outputNum = outputEnableMatch[1];
            this.sendCommand(`OUT ${outputNum.padStart(2, '0')} ${state.val ? 'ON' : 'OFF'}`);
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

            case 'network.telnetPort':
                this.sendCommand(`NET TN ${state.val}`);
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

            default:
                this.log.debug(`Unhandled state change: ${stateId}`);
        }
    }

    onUnload(callback) {
        try {
            this.log.info('Blustream adapter stopping...');

            this.stopPolling();

            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            if (this.commandTimeout) {
                clearTimeout(this.commandTimeout);
                this.commandTimeout = null;
            }

            if (this.socket) {
                this.socket.destroy();
                this.socket = null;
            }

            if (this.serialPort && this.serialPort.isOpen) {
                this.serialPort.close();
                this.serialPort = null;
            }

            callback();
        } catch (e) {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options) => new BlustreamAdapter(options);
} else {
    new BlustreamAdapter();
}

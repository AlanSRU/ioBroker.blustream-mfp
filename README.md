# ioBroker.blustream-mfp

[![NPM version](https://img.shields.io/npm/v/iobroker.blustream-mfp.svg)](https://www.npmjs.com/package/iobroker.blustream-mfp)
[![Downloads](https://img.shields.io/npm/dm/iobroker.blustream-mfp.svg)](https://www.npmjs.com/package/iobroker.blustream-mfp)
![Number of Installations](https://iobroker.live/badges/blustream-mfp-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/blustream-mfp-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.blustream-mfp.png?downloads=true)](https://nodei.co/npm/iobroker.blustream-mfp/)

**Tests:** ![Test and Release](https://github.com/AlanSRU/ioBroker.blustream-mfp/workflows/Test%20and%20Release/badge.svg)

## Blustream AV Switcher adapter for ioBroker

Control Blustream AMF/MFP/WMF series AV presentation switchers via RS232 serial or IP/Telnet connection.

### Supported Devices

| Model | Description | Connection |
|-------|-------------|------------|
| **AMF42AU** | 4x2 Advanced Multi-Format Switcher | IP (Telnet) |
| **MFP62** | 6x2 4K Multi-Format Presentation Switcher | IP (Telnet) |
| **MFP72** | 4x2 Multi-Format Presentation Switcher | RS232 / IP |
| **MFP112** | 5x2 Multi-Format Presentation Switcher with HDBaseT | IP (Telnet) |
| **WMF51** | Wireless Media Presenter | IP (Telnet) |
| **WMF72** | Wireless Media Presenter with Dual Display | IP (Telnet) |

For more information about Blustream products, visit [Blustream](https://www.blustream.co.uk/).

## Installation

Install the adapter from the ioBroker admin interface (Adapters → search for "blustream").

## Configuration

### Connection Settings

The adapter supports two connection types:

#### IP Connection (Telnet)
- **IP Address**: The IP address of your Blustream device
- **Port**: TCP port (default: 23 for Telnet)
- **Telnet IAC Negotiation**: Enable if your device uses Telnet protocol negotiation

#### RS232 Serial Connection
- **Serial Port**: Path to serial device (e.g., `/dev/ttyUSB0` on Linux, `COM3` on Windows)
- **Baud Rate**: Serial communication speed (typically 57600 for MFP series)

### Device Model

Select your specific Blustream device model from the dropdown. The adapter will automatically configure the available states and controls based on the selected model's capabilities.

### Polling

- **Polling Interval**: How often to query the device for status updates (in milliseconds, default: 30000)
- **Reconnect Interval**: Time between reconnection attempts if connection is lost (in milliseconds, default: 10000)

## States and Controls

The adapter creates states dynamically based on the selected device model. Common states include:

### Information (`info.*`)
- `info.connection` - Device connection status
- `info.model` - Device model identifier

### Commands (`commands.*`)
- `commands.raw` - Send raw commands to the device
- `commands.getStatus` - Request current device status

### Output Control (`output.*`)
- `output.X.source` - Select input source for output X
- `output.X.volume` - Volume level for output X
- `output.X.mute` - Mute status for output X

### System Control (`system.*`)
- `system.power` - Power on/off
- `system.beep` - Enable/disable button beep
- And more depending on device model...

### Network Settings (`network.*`)
- `network.dhcp` - DHCP enable/disable
- `network.ip` - Device IP address
- `network.gateway` - Gateway address
- `network.subnet` - Subnet mask

## Features by Model

| Feature | AMF42AU | MFP62 | MFP72 | MFP112 | WMF51 | WMF72 |
|---------|---------|-------|-------|--------|-------|-------|
| Network Control | Yes | Yes | Yes | Yes | Yes | Yes |
| RS232 Control | - | - | Yes | - | - | - |
| CEC Control | Yes | - | - | - | - | - |
| Microphone | Yes | Yes | - | - | - | - |
| Presets | Yes | - | - | - | - | - |
| Picture Control | Yes | - | - | - | - | - |
| WiFi Control | - | - | - | - | Yes | Yes |
| Multiview | - | - | - | - | Yes | Yes |
| HDBaseT | - | - | - | Yes | - | - |

## Troubleshooting

### Connection Issues

1. **IP Connection fails**: Verify the IP address and port. Ensure no firewall is blocking the connection. Try disabling Telnet IAC negotiation if your device doesn't support it.

2. **RS232 Connection fails**: Check the serial port path and baud rate. Ensure you have permissions to access the serial port (on Linux, add your user to the `dialout` group).

3. **Commands not working**: Some devices require a brief delay between commands. The adapter handles this automatically with a command queue.

### Debug Mode

Enable debug logging in the ioBroker admin to see detailed communication with the device:

1. Go to Instances
2. Click the adapter instance
3. Set log level to "debug"

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### __WORK IN PROGRESS__
-->
### 0.3.3 (2026-05-20)
* (Alan Paris) Now requires Node.js 20+, js-controller 6.0.11+, admin 7.6.20+
* (Alan Paris) Migrated admin UI to jsonConfig
* (Alan Paris) Modernized internal tooling (release-script, ESLint 9, ioBroker testing actions)

### 0.3.2 (2026-03-24)
* (Alan Paris) Improved telnet response parsing

### 0.3.1 (2025-12-21)
* (Alan Paris) Fixed adapter checker warnings; added translations for news entries

### 0.3.0 (2025-12-21)
* (Alan Paris) Initial release with support for AMF42AU, MFP62, MFP72, MFP112, WMF51, WMF72
* (Alan Paris) Added CEC control, preset management, and picture controls

## License

MIT License

Copyright (c) 2026 Alan Paris <alan.paris@scottish.rugby>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

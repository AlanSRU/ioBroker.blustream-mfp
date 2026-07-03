# Older changes

### 0.3.1 (2025-12-21)
* (Alan Paris) Fixed adapter checker warnings; added translations for news entries

### 0.3.0 (2025-12-21)
* (Alan Paris) Initial release with support for AMF42AU, MFP62, MFP72, MFP112, WMF51, WMF72
* (Alan Paris) Added CEC control, preset management, and picture controls
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

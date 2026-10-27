# Influx — Plug-and-Play Manager (Development Branch)

> **Preview development — not a stable release.** This is the `feat/plug-and-play-manager` branch of [mubeenkh4u/influx](https://github.com/mubeenkh4u/influx). It is being developed independently of `main`. The initial manager and portable preview packages are implemented. Real Fluxer installation testing and production validation are still pending. Back up Fluxer before trying this branch.

**Goal:** Keep Fluxer as the chat client and Influx as its injected mod core, while adding a separate Electron **Influx Manager** for installing and managing plugins stored on disk. Adding or updating a compatible plugin should *not* require rebuilding Influx or repacking Fluxer's `app.asar`.

## Development status

| Area | Status | Notes |
| --- | --- | --- |
| Separate feature branch | Done | `main` is unaffected |
| External plugin manifest and registry | Implemented; unit tests passed | Validates plugin metadata, keeps approved code hashes and enabled state |
| Manual plugin directory and import functions | Implemented; unit tests passed | Supports plugin folders containing `manifest.json` and bundled `index.js` |
| Renderer startup integration | Implemented; live Fluxer testing pending | Loads approved external plugins before Fluxer's webpack patch hook is installed |
| Influx plugin settings integration | Implemented; live Fluxer testing pending | Marks externally managed plugins as manager-controlled |
| Electron Manager user interface | Implemented; Linux dashboard smoke test passed | Install/repair, import, approve, enable/disable, remove, refresh and logs |
| Windows/Linux packages | Portable CI preview archives built | Signed production installers are not available |
| Automated tests / integration testing | Initial CI verification passing | Real Fluxer compatibility and Linux privilege prompts need on-device tests |
| Plugin SDK and real plugin migration | **Pending** | Sample plugin is illustrative; FakePlutonium has not been migrated |

Automated type-checking, unit tests, builds and a Linux virtual-display Electron smoke test have passed. These checks do **not** establish compatibility with a real Fluxer installation.

## Planned experience

1. Install Influx once using the manager.
2. Drop a compatible plugin folder into the external plugins directory, or import it through the manager.
3. Review and explicitly approve the plugin's code fingerprint, then enable it.
4. Restart Fluxer when the plugin requires webpack patches. Most changes will need no Influx rebuild or reinjection.

### Plugin location

Influx uses the user's app-data directory rather than modifying bundled plugin code:

| System | Default external plugin directory |
| --- | --- |
| Windows | `%APPDATA%\\Influx\\plugins` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/Influx/plugins` |
| macOS | `~/Library/Application Support/Influx/plugins` |

Example layout:

```text
Influx/
├── dist/
├── plugins.json                 # approval and enabled state
└── plugins/
    └── hello-influx/
        ├── manifest.json
        └── index.js
```

Each plugin is a self-contained JavaScript bundle plus a manifest. A manifest for API version 1 looks like:

```json
{
  "id": "hello-influx",
  "name": "Hello Influx",
  "version": "1.0.0",
  "main": "index.js",
  "apiVersion": 1
}
```

See [the example plugin](examples/plugins/hello-influx). The plugin's runtime entry registers itself with `window.Influx.registerPlugin(...)` and must supply a matching name, description and authors array. TypeScript source must be compiled to a browser-compatible JS bundle separately; Influx does **not** compile arbitrary `.ts` files when loading plugins.

External plugins are **untrusted until approved**. Modifying a previously approved plugin changes its fingerprint and prevents it from loading until reapproved. Plugin scripts run with access to Fluxer's client context: **only install and approve code from sources you trust**. These protections are integrity checks, not a JavaScript sandbox.

## Important limitations

- Plugin runtime loading only applies to the desktop client. Browser-extension support is not part of this work yet.
- Startup webpack patches must register before the related modules execute; enabling or updating patch-based plugins requires a Fluxer restart.
- Installing a plugin in the directory alone does not authorize execution. Review and approve it in the manager, then restart Fluxer.
- Fluxer updates may replace the shim. Repair and reinjection still need on-device validation. Root-owned Linux installations require a polkit authentication agent for the included elevation helper.
- This fork's updater has been switched to `mubeenkh4u/influx`, but **no verified manager release has been published**. The upstream installer link below is for upstream stable Influx, *not* this experimental branch.

## Build and testing (developer workflow)

Requires [Bun](https://bun.sh/). Development commands from the repository root:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run lint
bun run fmt
bun run build
bun run build:manager
```

To create a portable Windows or Linux preview, download Electron's runtime and run the packaging command:

```sh
node node_modules/electron/install.js
bun run package:manager
```

Packages are written to `dist/manager/packages/`. CI also publishes experimental Windows and Linux preview archives in [Manager checks](https://github.com/mubeenkh4u/influx/actions/workflows/manager-ci.yml). These archives are unsigned; they have not been verified against a live Fluxer installation.
To inject a built development version into a local Fluxer installation:

```sh
bun run inject --development
```

Do not test against your primary client without backups. Source and validation work is ongoing.

## Existing Influx

Influx is a patch-based mod for [Fluxer](https://fluxer.app). For the existing upstream stable installer, see [the original Influx releases](https://github.com/imkylecat/influx/releases/latest); those downloads **do not contain this manager**.

## Contributing

Changes for the plug-and-play initiative belong on this feature branch until its tests, installer, and compatibility checks pass. Follow [AGENTS.md](AGENTS.md) and report reproducible issues with operating system, Fluxer version, Influx build, relevant logs and steps to reproduce.

## License

Influx is licensed under the [GNU General Public License v3.0](LICENSE). It is not affiliated with or endorsed by Fluxer.

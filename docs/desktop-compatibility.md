# Experimental desktop compatibility and FakePlutonium

This branch targets Fluxer's newer Electron desktop packaging and adds a client-side quality preference override.

## Why the desktop archive moves differently

Influx previously renamed Fluxer's original `app.asar` to `_app.asar`. Fluxer's native addon packages derive their unpacked binary paths from an archive literally named `app.asar`, replacing `app.asar` with `app.asar.unpacked`. A renamed archive breaks that assumption.

The installer now stores Fluxer's original archive in `resources/influx-original/app.asar`, with its native files under `resources/influx-original/app.asar.unpacked`. The compatibility shim remains `resources/app.asar`. Existing `_app.asar` installations migrate automatically when the development installer runs. Uninstall restores the original archive. Update recovery scripts were adjusted to this layout.

## Windows development installation

Quit Fluxer fully and run from this source checkout:

```powershell
bun install
bun run typecheck
bun test
bun run build
bun run inject --development
```

Restart Fluxer. If necessary, use an elevated PowerShell for writing to installed resources. To remove the shim, run `bun run uninject`.

## Verification

In Fluxer's developer tools console, check:

```js
window.Influx?.version
window.Influx?.plugins?.FakePlutonium?.getStatus()
```

Enable FakePlutonium in Influx plugins settings and start a stream. Its quality preference changes client-side access to the options; it does not change paid account state, server bitrate policy, or guarantee the recipient's actual resolution.

**Not yet smoke-tested against a released Windows Fluxer binary.** If `window.Influx` is undefined, check preload diagnostics and CSP policies before investigating the plugin. The separate CSP handling and Electron ESM bootstrap may still require adaptation to the installed build.

# Miracon Design Exporter

A local Figma development plugin that exports the selected frame or layer to:

- REST-like Figma JSON (`JSON_REST_V1`)
- per-layer computed CSS from `getCSSAsync()`
- layout, typography, paint, effect, constraint, and bounding-box properties
- an optional 1× PNG preview

The plugin has no network access and does not need a Figma access token.

## Install in Figma Desktop

1. Open the Miracon design file in the Figma desktop app.
2. Open **Figma menu → Plugins → Development → Import plugin from manifest…**
3. Select this file: `figma-plugin/miracon-exporter/manifest.json`.
4. Select one frame on the canvas.
5. Run **Plugins → Development → Miracon Design Exporter**.

The JSON and optional PNG are downloaded locally from the plugin window.

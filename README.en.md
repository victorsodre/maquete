# maquete

[Leia em português](README.md)

Any place on Earth becomes a layered model: land and seafloor, lit like a product shot in the browser, and exported as SVG for laser or paper cutting. Open data, one command, no API key, no build step.

![Rio de Janeiro and Guanabara Bay](docs/rio.jpg)

| ![Florianópolis](docs/floripa.jpg) | ![Salvador and Todos os Santos Bay](docs/salvador.jpg) | ![Fernando de Noronha](docs/noronha.jpg) |
|---|---|---|

## Ready-made places

Four places ship with the terrain downloaded and the layers computed. Every piece is 300 mm wide.

| Place | Demo | Piece (mm) | Layers (land + sea) | Step land / sea | Exaggeration land / sea | Seafloor measured by sonar |
|---|---|---|---|---|---|---|
| Rio de Janeiro and Guanabara Bay | [open](https://victorsodre.github.io/maquete/?lugar=rio) | 300 × 225 | 12 (9 + 3) | 100 m / 20 m | 5.6x / 28.2x | 3.4 % |
| Florianópolis | [open](https://victorsodre.github.io/maquete/?lugar=floripa) | 300 × 406.5 | 17 (13 + 4) | 100 m / 20 m | 4.9x / 24.7x | 1.0 % |
| Salvador and Todos os Santos Bay | [open](https://victorsodre.github.io/maquete/?lugar=salvador) | 300 × 279.9 | 12 (4 + 8) | 50 m / 200 m | 11.9x / 3.0x | 4.0 % |
| Fernando de Noronha | [open](https://victorsodre.github.io/maquete/?lugar=noronha) | 300 × 240.5 | 18 (7 + 11) | 25 m / 250 m | 8.9x / 0.9x | 0 % |

The coastline layer (0 m) counts as land. Each layer is 3 mm (plywood). The numbers come from each place's `laminas.json` and match what the page shows.

## Use it in 30 seconds

Needs Node 22 or newer. No key, no build.

```
git clone https://github.com/victorsodre/maquete.git
cd maquete
npm install

npx maquete --bbox -22.72,-23.1,-43.5,-42.95 --slug my-place --nome "My place"
npx maquete my-place
node cli/laminas.mjs my-place
npm run serve
node cli/svg.mjs my-place --numerar
```

What each step produces:

1. `npx maquete --bbox N,S,W,E --slug my-place --nome "..."` creates `lugares/my-place/lugar.json` with the bounding box (north, south, west, east in degrees) and downloads the terrain right away. `npx maquete my-place` reruns from `lugar.json`, using the cache. Both write `terreno.png` (elevation as Terrain-RGB) and `terreno.json` (sources, resolution, measured fraction).
2. `node cli/laminas.mjs my-place` slices the terrain into levels and writes `laminas.json`: one polygon per layer, in millimetres of the piece, with step, exaggeration and sources. The step is picked automatically and saved to `lugar.json`; override with `--passo-terra`, `--passo-mar`, `--largura-mm` and `--espessura-mm`.
3. `npm run serve` serves the page at `http://localhost:8765/?lugar=my-place`: the model in 3D with studio light, shadows between layers and the acrylic sea plate.
4. `node cli/svg.mjs my-place --numerar` writes one SVG per layer plus a key sheet in `lugares/my-place/svg/`, ready for the cutter.

## The page

`index.html` plus `web/app.js`, static files only. It reads the place's `laminas.json`, never the `terreno.png`.

URL parameters:

| Parameter | Values | What it does |
|---|---|---|
| `lugar` | slug (default `rio`) | which folder in `lugares/` to load |
| `material` | `compensado`, `cartao`, `gesso` | plywood, cardboard or plaster preset (default plywood) |
| `agua` | `0` | removes the acrylic sea plate |
| `levantar` | `0` to `1` | how far the sea plate lifts (up to 25 mm) and tilts, as if lifted by hand |
| `moldura` | `0` | removes the wooden frame around the piece |
| `t` | seconds | point of the 12 s camera orbit the scene opens at |
| `capture` | `1` | capture mode: no UI, no animation, frame fixed at `t` |
| `simples` | `1` | sea plate without refraction (what phones use by default) |

The interface shows the place name, piece size, number of layers and steps in metres; the declared vertical exaggeration ("relief 5.6x higher than real on land (28.2x at sea); each 3 mm layer is 100 m on land and 20 m at sea"); and, when there is sea, the fraction of the seafloor measured by sonar. There is a "Girar" (rotate) button, a material selector, a "Levantar o mar" (lift the sea) slider and the credits in the footer.

The "Baixar SVGs" button generates, in the browser and with the same module as the CLI, one SVG per layer plus the key sheet, numbered. The browser asks once for permission to download several files.

## Cutting for real

Each SVG is one layer, in real millimetres (`width="300mm"`, `viewBox` in mm, no `px`, no `transform`): the cutter opens it at the right size. The red 0.01 mm stroke is the cut; the blue 0.1 mm stroke is engraving and draws the outline of the layer above, so you know where to glue the next one. With `--numerar`, each layer gets its number and level in metres engraved in a corner.

`folha-chave.svg` is the back of the piece: list of layers (number, level, type, area), horizontal scale (1 cm on the piece = X km), thickness, step, exaggeration, sources and licence.

Material: 3 mm plywood is the default. For card stock, generate the layers with `node cli/laminas.mjs my-place --espessura-mm 1.5`; the step in metres adjusts itself to keep the exaggeration within limits.

Kerf: `node cli/svg.mjs my-place --kerf 0.15` only records the value in the SVG and the key sheet; the lines get no offset. Set the compensation in LightBurn or your cutter's software.

Assembly: glue from the bottom up, aligning each layer with the blue outline engraved on the one below. Layer 0 is the full rectangle and serves as the base.

Honest note: the author has not yet cut a piece physically. The conventions (red cuts, blue engraves, real mm) are the usual ones for laser cutters, but run a small test before cutting the whole piece.

## Honesty in the piece

Nothing is hidden in the model.

- Vertical exaggeration follows from layer thickness and step: `exaggeration = (thickness_mm / step_m) / (mm_per_km / 1000)`. It is computed, saved in `laminas.json`, shown on the page and printed on the key sheet. Land stays within 7x (up to 12x in very flat places, so they are not left without relief); the sea may go higher, since the seafloor is stylised by contours like a bathymetric chart, and both values are declared.
- Seafloor: GMRT has multibeam sonar where surveys exist and the GEBCO grid (about 450 m per node) everywhere else. The truly measured fraction comes from the `topo-mask` layer and is shown per place: Rio 3.4 %, Florianópolis 1.0 %, Salvador 4.0 %, Noronha 0 %. Outside that fraction, the seafloor shape is a model, not a measurement.
- Land: Copernicus DEM is a surface model, not a terrain model. Buildings and forest count towards height. That is why land is smoothed by 2 nodes before contouring, otherwise a city turns into confetti.
- Real resolution: Copernicus comes at 30 m per node and each place's grid sits between 22 m (Noronha) and 58 m (Salvador) per node; GMRT returned 54 to 61 m per node for these four places, but where there is no sonar the real detail is GEBCO's. Exact values are in each place's `terreno.json`.
- Vertical datum: Copernicus (EGM2008) and GMRT (mean sea level) differ by a few metres. The merge uses Copernicus above 0.5 m and GMRT elsewhere.

## Capture

`node captura/quadro.mjs rio --t 3` renders one PNG of the scene at time `t`; `node captura/capture.mjs rio --de 0 --ate 12` writes the frame sequence and an MP4. Both use Playwright's Chromium with GPU and the frame is deterministic: same URL and same `t`, same bytes.

## Sources and licences

The code is MIT (see `LICENSE`). Data and assets have their own licences, with full records in `dados/fontes/`.

**Copernicus DEM GLO-30** (land). ESA, Copernicus programme. Free and open licence with mandatory attribution. Since the terrain is adapted data (resampled, merged with GMRT, re-encoded), article 6(b) applies:

> "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved".

And article 6(c), in any notice covering distribution:

> "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30".

**GMRT** (sea). Global Multi-Resolution Topography, CC BY 4.0. Not for navigation. Required citation:

> Ryan, W. B. F., S.M. Carbotte, J. Coplan, S. O'Hara, A. Melkonian, R. Arko, R.A. Weissel, V. Ferrini, A. Goodwillie, F. Nitsche, J. Bonczkowski, and R. Zemsky (2009), Global Multi-Resolution Topography (GMRT) synthesis data set, Geochem. Geophys. Geosyst., 10, Q03014, doi:10.1029/2008GC002332.

**GEBCO** (GMRT's base where there is no sonar). Public domain. Citation:

> GEBCO Bathymetric Compilation Group 2026 (2026). The GEBCO_2026 Grid - a continuous terrain model for oceans and land at 15 arc-second intervals. doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa

**Poly Haven** (light and textures), CC0 1.0: Brown Photostudio 02 (HDRI) by Sergej Majboroda; Plywood by Rob Tuytel; Wood Table 001 by Dimitrios Savva and Rico Cilliers.

**Libraries** vendored in `web/vendor/`: d3-contour, d3-array and internmap (Mike Bostock, ISC); three.js r185 (MIT).

## For anyone touching the code

`AGENTS.md` lists what has already broken and will break again if you do not know about it; `SPEC.md` is the contract between CLI, layers, page, SVG and capture (units, `laminas.json` format, `window.__maquete`). Read both first. `npm test` runs everything and must pass before any commit.

by Victor Sodré · @ovictor

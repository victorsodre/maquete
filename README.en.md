# maquete

[Leia em português](README.md)

Any place on Earth becomes a layered model: land and seafloor, lit like a product shot in the browser, and exported as SVG for laser or paper cutting. Open data, one command, no API key, no build step. From the whole of Brazil down to a bay: five scales (country, region, state, municipality and local), 64 places ready to open.

![Brazil in layers](docs/brasil.jpg)

| ![State of São Paulo](docs/sp.jpg) | ![Municipality of São Paulo](docs/sao-paulo.jpg) | ![Rio de Janeiro and Guanabara Bay](docs/rio.jpg) |
|---|---|---|

| ![Florianópolis](docs/floripa.jpg) | ![Salvador and Todos os Santos Bay](docs/salvador.jpg) | ![Fernando de Noronha](docs/noronha.jpg) |
|---|---|---|

## Five scales

The same piece, 300 mm on its longer side, works for the whole country or for a single bay. What changes is where the outline comes from, where the relief comes from and how many metres each layer stands for.

| Scale | Example | Relief source | Grid nodes | Typical step (land / sea) | Clipping |
|---|---|---|---|---|---|
| Country | `brasil` | GMRT (land and sea), 4.5 km per node | 1024 | 100 m / 1,000 m | box: neighbours flattened to 0 m, sea keeps its bathymetry |
| Region | `regiao-sul` | GMRT, 1 to 3.3 km per node | 1024 | 100 m / same as land | outline: the piece takes the shape of the territory |
| State | `sp` | GMRT, 110 m to 2.1 km per node | 1024 | 20 to 100 m / same as land, at most 2 layers | outline |
| Municipality | `sao-paulo` | Copernicus up to 150 km wide, GMRT beyond that; 16 to 530 m per node | 1024 | 10 to 250 m / 5 to 50 m | outline |
| Local | `rio` | Copernicus on land, GMRT at sea; 22 to 58 m per node | up to 2048 | 25 to 100 m / 20 to 250 m | box: the whole bounding box, as is |

In the first four the outline comes from the IBGE territorial meshes (Brazil's statistics institute; no key; record in `dados/fontes/ibge.md`). The relief still comes from Copernicus and GMRT; IBGE only says where the territory starts and ends. `local` is the free bounding box as before, with `--bbox`.

One command per scale:

```
npx maquete --pais                                   # lugares/brasil (box clipping by default)
npx maquete --regiao sul                             # lugares/regiao-sul (name, abbreviation or number 1..5)
npx maquete --uf SP                                  # lugares/sp (state abbreviation)
npx maquete --municipio "São Paulo" --uf SP          # lugares/sao-paulo (name, accent-insensitive, or 7-digit code)
npx maquete --bbox -22.72,-23.1,-43.5,-42.95 --slug my-place --nome "My place"   # local, free box
```

After any of them, `node cli/laminas.mjs <slug>` cuts the layers and `npm run serve` opens the page. Options for IBGE places: `--recorte contorno|caixa` (outline or box), `--qualidade minima|intermediaria|maxima` (mesh quality), `--margem 0.04` (padding around the polygon) and `--slug` to rename the folder. The CLI picks the relief source, the 1024-node grid and the piece width on its own (the longer side ends at 300 mm); everything is saved to `lugar.json`, and `npx maquete <slug>` reproduces it. A municipality with a repeated name (Bonito exists in four states) needs `--uf`.

Honest note on the large scales. At country, region and state level, and in municipalities wider than 150 km, the vertical exaggeration goes past 100x (Brazil 469x, Acre 437x, Amazonas 425x): a 2,000 km plain fits in 300 mm, and without exaggeration the relief would vanish. The step is chosen from the 99th percentile of elevations, not the maximum, counting layers from the base of the piece (not from 0 m: Distrito Federal, entirely above 735 m, gets 50 m instead of 100 m), and the exaggeration never goes past 500x; when even 500x does not give 8 layers of relief, the smallest allowed step stays and a plain comes out as a plain (Amazonas: 50 m, 4 layers up to the percentile). The cap is the level just above the 99th percentile plus 2 steps, never more than 16 steps above the base: summits above it are flattened into the last layer and the level is saved in `teto_m` (in Brazil, everything above 1,100 m; in Amazonas, Pico da Neblina stops at 350 m). The value is declared in `laminas.json`, on the page ("relief 469x higher than real, country scale") and on the key sheet. The seafloor at these scales is not measured: GMRT at 1 to 4.5 km per node is GEBCO resampled (a model grid of about 450 m per node, not sonar); in Brazil only 0.4 % of the seafloor has multibeam coverage. In regions, states and municipalities with outline clipping the ocean does not even enter the piece: the "sea" is only the pockets below 0 m inside the polygon (estuaries, lagoons, the Amazon riverbed), cut at the land step in at most 2 layers, and the base of the piece is always land, even when the lowest level is negative. On land, GMRT at country and state scale has artefacts near the coast (false peaks of 1,600 to 3,100 m in Alagoas and Sergipe); the cap keeps the look right, but `elev_max_m` carries the artefact.

## Ready-made places

64 places ship with the terrain downloaded and the layers computed; the page opens right away and the "Escala" (scale) and "Lugar" (place) selectors in the bar switch between them. Each layer is 3 mm (plywood). "Layers (land + sea)": layers at 0 m and above (the coastline counts as land) and layers below 0 m; layer 0 is the base (the rectangle) and, with outline clipping, layer 1 is the whole territory at the same level. "Relief" is the grid resolution in metres per node. The numbers come from each place's `laminas.json` and `terreno.json` and match what the page shows.

### Country (1)

| Place | Demo | Piece (mm) | Layers (land + sea) | Step land / sea | Exaggeration land / sea | Cap | Relief (m/node) |
|---|---|---|---|---|---|---|---|
| Brasil | [open](https://victorsodre.github.io/maquete/?lugar=brasil) | 292 × 300 | 20 (12 + 8) | 100 m / 1,000 m | 469.1x / 46.9x | 1,100 m | 4,459 |

### Region (5)

| Place | Demo | Piece (mm) | Layers (land + sea) | Step land / sea | Exaggeration land / sea | Cap | Relief (m/node) |
|---|---|---|---|---|---|---|---|
| Centro-Oeste | [open](https://victorsodre.github.io/maquete/?lugar=regiao-centro-oeste) | 272 × 300.4 | 13 (13 + 0) | 100 m / — | 200.7x / — | 1,100 m | 1,777 |
| Nordeste | [open](https://victorsodre.github.io/maquete/?lugar=regiao-nordeste) | 239 × 300.4 | 15 (15 + 0) | 100 m / — | 207.6x / — | 1,200 m | 1,615 |
| Norte | [open](https://victorsodre.github.io/maquete/?lugar=regiao-norte) | 300 × 201.7 | 12 (11 + 1) | 100 m / 100 m | 339.1x / 339.1x | 800 m | 3,312 |
| Sudeste | [open](https://victorsodre.github.io/maquete/?lugar=regiao-sudeste) | 300 × 262.3 | 18 (18 + 0) | 100 m / — | 152x / — | 1,500 m | 1,485 |
| Sul | [open](https://victorsodre.github.io/maquete/?lugar=regiao-sul) | 224 × 300 | 18 (17 + 1) | 100 m / 100 m | 134.9x / 134.9x | 1,400 m | 983 |

### State (27)

| Place | Demo | Piece (mm) | Layers (land + sea) | Step land / sea | Exaggeration land / sea | Cap | Relief (m/node) |
|---|---|---|---|---|---|---|---|
| Acre | [open](https://victorsodre.github.io/maquete/?lugar=ac) | 300 × 166.4 | 15 (15 + 0) | 20 m / — | 437.2x / — | 380 m | 854 |
| Alagoas | [open](https://victorsodre.github.io/maquete/?lugar=al) | 300 × 166 | 15 (15 + 0) | 50 m / — | 73.1x / — | 600 m | 357 |
| Amapá | [open](https://victorsodre.github.io/maquete/?lugar=ap) | 261 × 300 | 12 (12 + 0) | 50 m / — | 138.1x / — | — | 587 |
| Amazonas | [open](https://victorsodre.github.io/maquete/?lugar=am) | 300 × 204.9 | 12 (10 + 2) | 50 m / 100 m | 424.8x / 212.4x | 350 m | 2,074 |
| Bahia | [open](https://victorsodre.github.io/maquete/?lugar=ba) | 275 × 300.1 | 15 (15 + 0) | 100 m / — | 117.8x / — | 1,200 m | 1,055 |
| Ceará | [open](https://victorsodre.github.io/maquete/?lugar=ce) | 246 × 300.6 | 12 (12 + 0) | 100 m / — | 60.9x / — | — | 488 |
| Distrito Federal | [open](https://victorsodre.github.io/maquete/?lugar=df) | 300 × 174.8 | 14 (14 + 0) | 50 m / — | 22.6x / — | — | 110 |
| Espírito Santo | [open](https://victorsodre.github.io/maquete/?lugar=es) | 183 × 299.4 | 17 (17 + 0) | 100 m / — | 41.1x / — | 1,400 m | 245 |
| Goiás | [open](https://victorsodre.github.io/maquete/?lugar=go) | 298 × 299.8 | 13 (13 + 0) | 100 m / — | 85.4x / — | 1,300 m | 829 |
| Maranhão | [open](https://victorsodre.github.io/maquete/?lugar=ma) | 226 × 300.6 | 14 (14 + 0) | 50 m / — | 221x / — | 550 m | 813 |
| Mato Grosso | [open](https://victorsodre.github.io/maquete/?lugar=mt) | 300 × 288.2 | 17 (17 + 0) | 50 m / — | 267.6x / — | 800 m | 1,307 |
| Mato Grosso do Sul | [open](https://victorsodre.github.io/maquete/?lugar=ms) | 295 × 300.3 | 18 (18 + 0) | 50 m / — | 165.8x / — | — | 796 |
| Minas Gerais | [open](https://victorsodre.github.io/maquete/?lugar=mg) | 300 × 245.8 | 18 (18 + 0) | 100 m / — | 127.5x / — | 1,600 m | 1,245 |
| Pará | [open](https://victorsodre.github.io/maquete/?lugar=pa) | 300 × 291.1 | 15 (14 + 1) | 50 m / 50 m | 308x / 308x | 550 m | 1,504 |
| Paraíba | [open](https://victorsodre.github.io/maquete/?lugar=pb) | 300 × 173.4 | 18 (18 + 0) | 50 m / — | 94.8x / — | 800 m | 463 |
| Paraná | [open](https://victorsodre.github.io/maquete/?lugar=pr) | 300 × 210.1 | 15 (15 + 0) | 100 m / — | 72.1x / — | — | 704 |
| Pernambuco | [open](https://victorsodre.github.io/maquete/?lugar=pe) | 300 × 102.2 | 11 (11 + 0) | 100 m / — | 77.9x / — | — | 761 |
| Piauí | [open](https://victorsodre.github.io/maquete/?lugar=pi) | 206 × 299.9 | 18 (18 + 0) | 50 m / — | 196.7x / — | — | 660 |
| Rio de Janeiro | [open](https://victorsodre.github.io/maquete/?lugar=rj) | 300 × 214.5 | 19 (19 + 0) | 100 m / — | 43.8x / — | 1,600 m | 428 |
| Rio Grande do Norte | [open](https://victorsodre.github.io/maquete/?lugar=rn) | 300 × 179.6 | 16 (16 + 0) | 50 m / — | 86.4x / — | — | 422 |
| Rio Grande do Sul | [open](https://victorsodre.github.io/maquete/?lugar=rs) | 300 × 291.5 | 16 (15 + 1) | 100 m / 100 m | 82.5x / 82.5x | — | 806 |
| Rondônia | [open](https://victorsodre.github.io/maquete/?lugar=ro) | 300 × 248.2 | 15 (15 + 0) | 50 m / — | 166.2x / — | 650 m | 811 |
| Roraima | [open](https://victorsodre.github.io/maquete/?lugar=rr) | 260 × 300.2 | 15 (15 + 0) | 100 m / — | 82.3x / — | 1,300 m | 697 |
| Santa Catarina | [open](https://victorsodre.github.io/maquete/?lugar=sc) | 300 × 210.2 | 18 (18 + 0) | 100 m / — | 58.3x / — | — | 570 |
| São Paulo | [open](https://victorsodre.github.io/maquete/?lugar=sp) | 300 × 200.7 | 17 (17 + 0) | 100 m / — | 99.4x / — | 1,400 m | 970 |
| Sergipe | [open](https://victorsodre.github.io/maquete/?lugar=se) | 266 × 300.4 | 13 (13 + 0) | 50 m / — | 49.3x / — | 500 m | 213 |
| Tocantins | [open](https://victorsodre.github.io/maquete/?lugar=to) | 180 × 300.2 | 18 (18 + 0) | 50 m / — | 199.4x / — | 850 m | 584 |

### Municipality (27)

| Place | Demo | Piece (mm) | Layers (land + sea) | Step land / sea | Exaggeration land / sea | Cap | Relief (m/node) |
|---|---|---|---|---|---|---|---|
| Aracaju (SE) | [open](https://victorsodre.github.io/maquete/?lugar=aracaju) | 138 × 301.1 | 7 (6 + 1) | 20 m / 10 m | 17.9x / 35.9x | — | 16 |
| Belém (PA) | [open](https://victorsodre.github.io/maquete/?lugar=belem) | 194 × 299.6 | 7 (6 + 1) | 10 m / 25 m | 61.1x / 24.4x | — | 39 |
| Belo Horizonte (MG) | [open](https://victorsodre.github.io/maquete/?lugar=belo-horizonte) | 205 × 299.1 | 18 (18 + 0) | 50 m / — | 6.8x / — | — | 23 |
| Boa Vista (RR) | [open](https://victorsodre.github.io/maquete/?lugar=boa-vista) | 182 × 300.4 | 6 (6 + 0) | 50 m / — | 28.3x / — | — | 84 |
| Brasília (DF) | [open](https://victorsodre.github.io/maquete/?lugar=brasilia) | 300 × 174.8 | 5 (5 + 0) | 200 m / — | 5.7x / — | — | 110 |
| Campo Grande (MS) | [open](https://victorsodre.github.io/maquete/?lugar=campo-grande) | 261 × 299.4 | 4 (4 + 0) | 250 m / — | 6.8x / — | — | 145 |
| Cuiabá (MT) | [open](https://victorsodre.github.io/maquete/?lugar=cuiaba) | 231 × 299.8 | 5 (5 + 0) | 250 m / — | 7.1x / — | — | 133 |
| Curitiba (PR) | [open](https://victorsodre.github.io/maquete/?lugar=curitiba) | 184 × 299.2 | 5 (5 + 0) | 50 m / — | 7.2x / — | — | 22 |
| Florianópolis (SC) | [open](https://victorsodre.github.io/maquete/?lugar=florianopolis) | 131 × 300.4 | 8 (7 + 1) | 100 m / 10 m | 7x / 69.6x | — | 30 |
| Fortaleza (CE) | [open](https://victorsodre.github.io/maquete/?lugar=fortaleza) | 300 × 257.7 | 6 (6 + 0) | 25 m / — | 11.4x / — | — | 28 |
| Goiânia (GO) | [open](https://victorsodre.github.io/maquete/?lugar=goiania) | 281 × 300.8 | 5 (5 + 0) | 100 m / — | 4.5x / — | — | 42 |
| João Pessoa (PB) | [open](https://victorsodre.github.io/maquete/?lugar=joao-pessoa) | 281 × 299.4 | 5 (5 + 0) | 20 m / — | 11.4x / — | — | 21 |
| Macapá (AP) | [open](https://victorsodre.github.io/maquete/?lugar=macapa) | 300 × 249.2 | 13 (11 + 2) | 10 m / 20 m | 193.6x / 96.8x | — | 189 |
| Maceió (AL) | [open](https://victorsodre.github.io/maquete/?lugar=maceio) | 221 × 299.8 | 9 (8 + 1) | 50 m / 5 m | 8.2x / 82.3x | — | 30 |
| Manaus (AM) | [open](https://victorsodre.github.io/maquete/?lugar=manaus) | 300 × 237.2 | 17 (15 + 2) | 10 m / 20 m | 197.3x / 98.7x | — | 193 |
| Natal (RN) | [open](https://victorsodre.github.io/maquete/?lugar=natal) | 211 × 300.5 | 8 (7 + 1) | 25 m / 10 m | 9.4x / 23.5x | — | 16 |
| Palmas (TO) | [open](https://victorsodre.github.io/maquete/?lugar=palmas) | 300 × 259.7 | 7 (7 + 0) | 100 m / — | 7.5x / — | — | 73 |
| Porto Alegre (RS) | [open](https://victorsodre.github.io/maquete/?lugar=porto-alegre) | 224 × 299.4 | 6 (5 + 1) | 100 m / 5 m | 4.1x / 81.2x | — | 30 |
| Porto Velho (RO) | [open](https://victorsodre.github.io/maquete/?lugar=porto-velho) | 300 × 134.5 | 10 (10 + 0) | 20 m / — | 271.6x / — | 200 m | 530 |
| Recife (PE) | [open](https://victorsodre.github.io/maquete/?lugar=recife) | 207 × 299.5 | 8 (7 + 1) | 25 m / 5 m | 10.9x / 54.5x | — | 18 |
| Rio Branco (AC) | [open](https://victorsodre.github.io/maquete/?lugar=rio-branco) | 300 × 158.6 | 11 (11 + 0) | 20 m / — | 111.4x / — | — | 218 |
| Rio de Janeiro (RJ) | [open](https://victorsodre.github.io/maquete/?lugar=rio-de-janeiro) | 300 × 157.6 | 8 (7 + 1) | 200 m / 5 m | 3.8x / 153.8x | — | 75 |
| Salvador (BA) | [open](https://victorsodre.github.io/maquete/?lugar=salvador-ba) | 300 × 221 | 7 (5 + 2) | 50 m / 50 m | 9.3x / 9.3x | — | 45 |
| São Luís (MA) | [open](https://victorsodre.github.io/maquete/?lugar=sao-luis) | 232 × 301.1 | 7 (6 + 1) | 20 m / 5 m | 19.5x / 78.1x | — | 30 |
| São Paulo (SP) | [open](https://victorsodre.github.io/maquete/?lugar=sao-paulo) | 194 × 299.4 | 7 (7 + 0) | 200 m / — | 3.9x / — | — | 50 |
| Teresina (PI) | [open](https://victorsodre.github.io/maquete/?lugar=teresina) | 139 × 300.5 | 4 (4 + 0) | 100 m / — | 9.6x / — | — | 44 |
| Vitória (ES) | [open](https://victorsodre.github.io/maquete/?lugar=vitoria) | 300 × 218.7 | 16 (14 + 2) | 25 m / 10 m | 6.6x / 16.6x | — | 16 |

### Local (4)

| Place | Demo | Piece (mm) | Layers (land + sea) | Step land / sea | Exaggeration land / sea | Cap | Relief (m/node) |
|---|---|---|---|---|---|---|---|
| Fernando de Noronha | [open](https://victorsodre.github.io/maquete/?lugar=noronha) | 300 × 240.5 | 18 (7 + 11) | 25 m / 250 m | 8.9x / 0.9x | — | 22 |
| Florianópolis | [open](https://victorsodre.github.io/maquete/?lugar=floripa) | 300 × 406.5 | 17 (13 + 4) | 100 m / 20 m | 4.9x / 24.7x | — | 48 |
| Rio de Janeiro e Baía de Guanabara | [open](https://victorsodre.github.io/maquete/?lugar=rio) | 300 × 225 | 12 (9 + 3) | 100 m / 20 m | 5.6x / 28.2x | — | 55 |
| Salvador e Baía de Todos-os-Santos | [open](https://victorsodre.github.io/maquete/?lugar=salvador) | 300 × 279.9 | 12 (4 + 8) | 50 m / 200 m | 11.9x / 3x | — | 58 |

Four small, flat capitals (Boa Vista, Aracaju, São Luís and Belém) came out with 0 or 1 layer under the municipality rule (exaggeration up to 12x) and carry a hand-picked step in `lugar.json`; the resulting exaggeration (18x to 61x) is declared. The four municipalities too wide for Copernicus (Rio Branco, Macapá, Manaus and Porto Velho, GMRT land) follow the large-scale rules: step from the 99th percentile, exaggeration of 111x to 272x declared. Four others (Salvador, Campo Grande, Teresina and Porto Alegre) got 2 land layers above the coast by the rule. Oceanic islands stay out of the piece: the IBGE mesh includes Trindade and Martim Vaz, 1,200 km out at sea, in Espírito Santo and in Vitória, and the CLI only takes into the `bbox` the polygons near the largest one (the ones left out are counted in `ilhas_fora_do_bbox`, in `terreno.json`); Pernambuco loses Fernando de Noronha the same way and fills the piece (779 km wide). The municipality of Salvador lives in `salvador-ba`, because `salvador` was already the local place of the bay.

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

1. `npx maquete --bbox N,S,W,E --slug my-place --nome "..."` creates `lugares/my-place/lugar.json` with the bounding box (north, south, west, east in degrees) and downloads the terrain right away. `--pais`, `--regiao`, `--uf` and `--municipio` do the same from an IBGE territory. `npx maquete my-place` reruns from `lugar.json`, using the cache. Both write `terreno.png` (elevation as Terrain-RGB; outside the clipping it is -10000 m) and `terreno.json` (sources, resolution, measured fraction, clipping).
2. `node cli/laminas.mjs my-place` slices the terrain into levels and writes `laminas.json`: one polygon per layer, in millimetres of the piece, with step, exaggeration, scale, clipping and sources. The step is picked automatically: at `local` scale and in municipalities up to 150 km wide it is saved to `lugar.json`; at country, region and state scale and in wide municipalities it comes from the rule on every run and is not saved (a step already present in `lugar.json` beats the rule). Override with `--passo-terra`, `--passo-mar`, `--largura-mm`, `--espessura-mm`, `--escala` and `--recorte`.
3. `npm run serve` serves the page at `http://localhost:8765/?lugar=my-place`: the model in 3D with studio light, shadows between layers and the acrylic sea plate. `npm run indice` regenerates `lugares/index.json`, which feeds the scale and place selectors.
4. `node cli/svg.mjs my-place --numerar` writes one SVG per layer plus a key sheet in `lugares/my-place/svg/`, ready for the cutter.

## The page

`index.html` plus `web/app.js`, static files only. It reads the place's `laminas.json` and `lugares/index.json` (for the selectors), never the `terreno.png`.

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

The bar has two selectors, "Escala" (scale) and "Lugar" (place, filtered by scale; states and municipalities show the state abbreviation): changing either navigates to `?lugar=<slug>`, keeping material, water, frame and `simples`. The title shows the place name and, below it, the scale, the real width, the piece and the layers ("Estado · 994 km de largura · 300 × 200,7 mm · 17 lâminas de 3 mm"); then the declared vertical exaggeration with its scale ("relevo 99x mais alto que o real, escala estado; cada lâmina de 3 mm vale 100 m na terra", that is, relief 99x higher than real, state scale; each 3 mm layer is 100 m on land, plus "e 20 m no mar" when there is sea); when there is a cap, "cumes achatados acima de 1.400 m" (summits flattened above 1,400 m); and, when there is sea, the fraction of the seafloor measured by sonar. There is a "Girar" (rotate) button, a material selector, a "Levantar o mar" (lift the sea) slider and the credits in the footer. The interface is in Portuguese.

The "Baixar SVGs" button generates, in the browser and with the same module as the CLI, one SVG per layer plus the key sheet, numbered. The browser asks once for permission to download several files.

## Cutting for real

Each SVG is one layer, in real millimetres (`width="300mm"`, `viewBox` in mm, no `px`, no `transform`): the cutter opens it at the right size. The red 0.01 mm stroke is the cut; the blue 0.1 mm stroke is engraving and draws the outline of the layer above, so you know where to glue the next one. With `--numerar`, each layer gets its number and level in metres engraved in a corner.

`folha-chave.svg` is the back of the piece: list of layers (number, level, type, area), horizontal scale (1 cm on the piece = X km), thickness, step, exaggeration, sources and licence.

Material: 3 mm plywood is the default. For card stock, generate the layers with `node cli/laminas.mjs my-place --espessura-mm 1.5`; the step in metres adjusts itself to keep the exaggeration within limits.

Kerf: `node cli/svg.mjs my-place --kerf 0.15` only records the value in the SVG and the key sheet; the lines get no offset. Set the compensation in LightBurn or your cutter's software.

Assembly: glue from the bottom up, aligning each layer with the blue outline engraved on the one below. Layer 0 is the full rectangle and serves as the base; with outline clipping, layer 1 is the whole territory and the following ones only exist inside it.

Honest note: the author has not yet cut a piece physically. The conventions (red cuts, blue engraves, real mm) are the usual ones for laser cutters, but run a small test before cutting the whole piece.

## Honesty in the piece

Nothing is hidden in the model.

- Vertical exaggeration follows from layer thickness and step: `exaggeration = (thickness_mm / step_m) / (mm_per_km / 1000)`. It is computed, saved in `laminas.json`, shown on the page and printed on the key sheet. At `local` and `municipio` scale, land stays within 7x (up to 12x in very flat places, so they are not left without relief); the sea may go higher, since the seafloor is stylised by contours like a bathymetric chart, and both values are declared. At `estado`, `regiao` and `pais` scale, and in municipalities wider than 150 km, the exaggeration goes past 100x, never past 500x, and is declared together with the scale; the level at which summits were flattened goes in `teto_m`.
- Seafloor: GMRT has multibeam sonar where surveys exist and the GEBCO grid (about 450 m per node) everywhere else. The truly measured fraction comes from the `topo-mask` layer and is shown per place: Rio 3.4 %, Florianópolis 1.0 %, Salvador 4.0 %, Noronha 0 %, Brazil 0.4 %. Outside that fraction, the seafloor shape is a model, not a measurement. At country, region and state scale the grid itself (1 to 4.5 km per node) is coarser than GEBCO.
- Land: Copernicus DEM is a surface model, not a terrain model. Buildings and forest count towards height. That is why land is smoothed by 1 or 2 nodes before contouring, otherwise a city turns into confetti. At the large scales land comes from GMRT, not Copernicus: GMRT includes land, but coarsely (GEBCO at about 450 m per node, resampled), so the smoothing rises to `ceil(450 / metres_per_node)` nodes, as at sea (Manaus, at 193 m per node, uses 3; with 1 node the top came out as confetti); false peaks showed up near the coast (Alagoas 1,643 m, Sergipe 3,119 m), and the layer cap keeps the look right.
- Real resolution: Copernicus comes at 30 m per node and the local places' grids sit between 22 m (Noronha) and 58 m (Salvador) per node; GMRT returned 54 to 61 m per node for those four, but where there is no sonar the real detail is GEBCO's. States go from 110 m (Distrito Federal) to 2.1 km (Amazonas) per node; Brazil, 4.5 km. Exact values are in each place's `terreno.json`.
- Vertical datum: Copernicus (EGM2008) and GMRT (mean sea level) differ by a few metres. The merge uses Copernicus above 0.5 m and GMRT elsewhere.
- Outline: the IBGE mesh defines what is territory; neighbouring land and sea outside it are "outside" (outline clipping) or flattened to 0 m (box clipping). A polygon whose centroid sits more than 0.75 times the diagonal of the largest polygon away (an oceanic island) stays out of the `bbox` and of the piece; `terreno.json` counts those in `ilhas_fora_do_bbox`. The fraction of nodes inside the polygon and the API call are recorded in `terreno.json`.

## Capture

`node captura/quadro.mjs rio --t 3` renders one PNG of the scene at time `t`; `node captura/capture.mjs rio --de 0 --ate 12` writes the frame sequence and an MP4. Both use Playwright's Chromium with GPU and the frame is deterministic: same URL and same `t`, same bytes.

## Sources and licences

The code is MIT (see `LICENSE`). Data and assets have their own licences, with full records in `dados/fontes/`.

**Copernicus DEM GLO-30** (land at `local` and `municipio` scale). ESA, Copernicus programme. Free and open licence with mandatory attribution. Since the terrain is adapted data (resampled, merged with GMRT, re-encoded), article 6(b) applies:

> "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved".

And article 6(c), in any notice covering distribution:

> "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30".

**GMRT** (sea; land at `pais`, `regiao`, `estado` scale and in wide municipalities). Global Multi-Resolution Topography, CC BY 4.0. Not for navigation. Required citation:

> Ryan, W. B. F., S.M. Carbotte, J. Coplan, S. O'Hara, A. Melkonian, R. Arko, R.A. Weissel, V. Ferrini, A. Goodwillie, F. Nitsche, J. Bonczkowski, and R. Zemsky (2009), Global Multi-Resolution Topography (GMRT) synthesis data set, Geochem. Geophys. Geosyst., 10, Q03014, doi:10.1029/2008GC002332.

**GEBCO** (GMRT's base where there is no sonar). Public domain. Citation:

> GEBCO Bathymetric Compilation Group 2026 (2026). The GEBCO_2026 Grid - a continuous terrain model for oceans and land at 15 arc-second intervals. doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa

**IBGE** (territory outlines at country, region, state and municipality scale). Territorial meshes and localities list, public API without key. Attribution used: "IBGE, Malhas Territoriais". The portal's terms of use are still to be confirmed (the page answered 403 to the robot); the record in `dados/fontes/ibge.md` lists the calls made.

**Poly Haven** (light and textures), CC0 1.0: Brown Photostudio 02 (HDRI) by Sergej Majboroda; Plywood by Rob Tuytel; Wood Table 001 by Dimitrios Savva and Rico Cilliers.

**Libraries** vendored in `web/vendor/`: d3-contour, d3-array and internmap (Mike Bostock, ISC); three.js r185 (MIT).

## For anyone touching the code

`AGENTS.md` lists what has already broken and will break again if you do not know about it; `SPEC.md` is the contract between CLI, layers, page, SVG and capture (units, `laminas.json` format, scales and clipping, `window.__maquete`). Read both first. `npm test` runs everything and must pass before any commit.

by Victor Sodré · @ovictor

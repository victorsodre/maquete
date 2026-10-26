# SPEC.md: contrato do maquete

maquete: qualquer lugar do mundo vira uma maquete em lâminas (terra e fundo do mar no mesmo passo), no navegador com luz de estúdio e em SVG para cortar a laser ou em papel. Dado aberto (Copernicus DEM GLO-30 na terra, GMRT no mar), um comando, sem chave de API, sem build. Node 22 ou mais, ESM, Three.js r185 vendorizado.

Este arquivo é o contrato entre os módulos. Quem constrói uma parte obedece ao que está aqui e não muda o contrato sem avisar o orquestrador.

## Pastas

```
cli/            dados (herdado, já funciona): index.mjs baixa e funde; terrain.mjs, copernicus.mjs, gmrt.mjs, rede.mjs
cli/laminas.mjs NOVO: terreno.png -> laminas.json (contornos por nível, em mm da peça)
cli/svg.mjs     NOVO: laminas.json -> um SVG por lâmina + folha-chave (corte a laser / papel)
cli/svg-lamina.mjs NOVO: módulo puro (sem fs) que gera o texto SVG de uma lâmina; usado pela CLI e pela página
web/app.js      NOVO: a cena (Three.js): lâminas extrudadas, materiais PBR, HDRI, sombras, acrílico do mar, câmera de produto
web/trilha.js   herdado: interpolação da trilha de câmera (Catmull-Rom + Hermite monótona)
web/style.css   NOVO
web/vendor/three/ three.module.min.js, three.core.min.js, addons (OrbitControls, RGBELoader, HDRLoader, EffectComposer, RenderPass, ShaderPass, OutputPass, BokehPass, SMAAPass + shaders)
web/vendor/d3/  d3-contour, d3-array, internmap (fonte ESM em src/, ISC); importar por caminho relativo, ex. ../web/vendor/d3/d3-contour/src/index.js
web/assets/     estudio.hdr (Poly Haven brown_photostudio_02, 1k, CC0), compensado_{diff,rough,nor_gl}.jpg (Poly Haven plywood 1k, CC0), mesa_{diff,rough,nor_gl}.jpg (Poly Haven wood_table_001 1k, CC0)
lugares/<slug>/ lugar.json, terreno.png, terreno.json, laminas.json, camera.json (opcional), svg/ (gerado, gitignored)
captura/        herdado: capture.mjs, quadro.mjs, comum.mjs (contrato window.__maquete)
scripts/        serve.mjs (servidor estático em 8765)
dados/fontes/   fichas de licença (copernicus, gmrt, gebco + NOVAS: polyhaven.md, d3.md); cristo.md e core-vtrcc.md saem
index.html      a página
```

## Unidades e eixos

- A peça é física: tudo na cena em **milímetros da maquete**. `largura_mm` (padrão 300) é a largura leste-oeste da peça; a escala horizontal é `mm_por_km = largura_mm / km.largura` (do `terreno.json`).
- Origem no centro da peça. `x` cresce para leste, `y` cresce para o norte (no laminas.json, 2D). Na cena Three.js: `x` = x, `z` = -y (norte para o fundo da tela), `y` = altura (para cima).
- Cada lâmina tem `espessura_mm` (padrão 3, compensado; 1,5 papel) e representa um passo vertical em metros (`passo_terra_m` na terra, `passo_mar_m` no mar). O exagero vertical é consequência: `exagero = (espessura_mm / passo_m) / (mm_por_km / 1000)`. É calculado, gravado no laminas.json e mostrado na página. Não existe exagero escondido.
- Lâmina de índice `k` (de baixo para cima): topo em `z_mm = (k + 1) * espessura_mm`, base em `k * espessura_mm`. A lâmina 0 é o fundo inteiro (retângulo), sempre.

## laminas.json (saída de cli/laminas.mjs, entrada da página e do SVG)

```json
{
  "slug": "rio", "nome": "Rio de Janeiro e Baía de Guanabara",
  "bbox": { "norte": -22.72, "sul": -23.1, "oeste": -43.5, "leste": -42.95 },
  "km": { "largura": 56.5, "altura": 42.3 },
  "largura_mm": 300, "altura_mm": 224.6, "mm_por_km": 5.31,
  "espessura_mm": 3, "passo_terra_m": 40, "passo_mar_m": 10,
  "exagero": 14.1,
  "elev_min_m": -45.2, "elev_max_m": 1021.0,
  "suavizar": { "terra_nos": 2, "mar_nos": 8 },
  "area_min_mm2": 8,
  "laminas": [
    { "k": 0, "nivel_m": -50, "tipo": "mar", "z_mm": 3, "aneis": [ { "ext": [[x,y],[x,y],...], "furos": [ [[x,y],...] ] } ] },
    { "k": 1, "nivel_m": -40, "tipo": "mar", ... },
    { "k": 6, "nivel_m": 0,   "tipo": "costa", ... },
    { "k": 7, "nivel_m": 40,  "tipo": "terra", ... }
  ],
  "agua": { "nivel_m": 0, "aneis": [ ... ] },
  "fontes": [ ...copiado do terreno.json... ],
  "mascara": { "pct_medido": 3.4 },
  "gerado_por": "maquete 0.1.0", "gerado_em": "2026-10-26T15:30:00-03:00"
}
```

Regras:
- `laminas[k].aneis` é a região `h >= nivel_m` (depois da suavização), como polígonos: `ext` anel externo (sentido anti-horário no plano x-y com y para o norte), `furos` anéis internos (horário). Coordenadas em mm, com 2 casas decimais, fechadas implicitamente (o primeiro ponto NÃO se repete no fim).
- Lâmina 0: `nivel_m` = o nível mais baixo da pilha, `aneis` = o retângulo inteiro `[[-L/2,-A/2],[L/2,-A/2],[L/2,A/2],[-L/2,A/2]]`.
- Níveis: do mar, múltiplos de `passo_mar_m` de `floor(elev_min/passo_mar)*passo_mar` até `-passo_mar_m`; depois `0` (tipo `costa`); depois múltiplos de `passo_terra_m` de `passo_terra_m` até o último abaixo de `elev_max_m`. Lugares sem mar (elev_min >= 0) não têm lâminas de mar nem `agua`.
- Passos padrão (se o `lugar.json` não trouxer `maquete.passo_terra_m` / `passo_mar_m`), escolhidos entre {5, 10, 20, 25, 50, 100, 200, 250, 500}. Terra: o menor passo cujo exagero fique em no máximo 7x; se com ele saírem mais de 24 lâminas de terra, sobe o passo até caber. Lugar muito plano (terra com menos de 3 lâminas) pode usar exagero maior, até 12x, para não ficar sem relevo (o maior passo dentro de 12x que chega a 3 lâminas ou, se nenhum chega, o que dá mais lâminas). Mar: o menor passo com no máximo 8 lâminas de mar; se o exagero do mar passar de 30x, sobe o passo até cumprir, mantendo ao menos 2 lâminas de mar quando houver mar. O mar de uma carta batimétrica é estilizado por contornos, então o exagero do mar pode ser maior que o da terra, e os dois ficam declarados no JSON (`exagero`, `exagero_mar`). Gravar o passo escolhido.
- Suavização antes de contornar: blur gaussiano (d3-array `blur2`) com raio `suavizar.terra_nos` nos nós de terra (padrão 2 quando `metros_por_no < 60`, senão 1; o Copernicus é modelo de superfície e prédio vira confete) e `suavizar.mar_nos` nos nós de mar (padrão = `ceil(450 / metros_por_no)`, porque o GMRT fora do multifeixe é GEBCO a ~450 m por nó reamostrado em blocos). Implementação aceita: dois campos borrados e mistura por máscara `h >= 0`, ou um único blur por nó com raio por tipo. A costa (nível 0) usa o campo da terra.
- Contornos: d3-contour `contours().size([w, h]).smooth(true).thresholds(niveis)(valores)`; cada resultado é um GeoJSON MultiPolygon em coordenadas de célula; converter para mm (`x_mm = (cx / w - 0.5) * largura_mm`, `y_mm = (0.5 - cy / h) * altura_mm`), simplificar (Douglas-Peucker, tolerância 0,15 mm), descartar anéis com área menor que `area_min_mm2` (padrão 8 mm² para externos, 10 mm² para furos), e nunca deixar anel com menos de 3 pontos nem pontos repetidos consecutivos.
- `agua.aneis`: a região `h <= 0` (complemento da costa dentro do retângulo), com a mesma convenção; é a placa de acrílico do mar. Calcular contornando `-h` no nível 0 (ou a partir do retângulo menos a costa).
- O teste da CLI (`cli/laminas.test.mjs`) usa um terreno sintético (cone com uma ilha e uma lagoa dentro, mais mar ao redor) e confere: todo anel fecha e tem 3 ou mais pontos; orientação (ext anti-horário, furos horário, área com sinal); todo furo está dentro do seu ext; lâmina 0 é o retângulo; níveis crescentes; nenhuma lâmina vazia no meio da pilha (uma lâmina pode ter `aneis: []` só se for acima do máximo, o que não deve acontecer).

## lugar.json (herdado, com um bloco novo)

```json
{ "slug": "rio", "nome": "...", "bbox": {...}, "largura_max_nos": 1024, "terra": "copernicus", "mar": "gmrt", "mascara": true,
  "maquete": { "largura_mm": 300, "espessura_mm": 3, "passo_terra_m": 40, "passo_mar_m": 10, "material": "compensado" } }
```
Campos antigos (`exagero_vertical`, `regua`, `clipe_referencia`, `frase_de_vida`, `nivel_minimo_m`) são ignorados e podem ser removidos.

## Página (index.html + web/app.js)

URL: `index.html?lugar=<slug>[&t=<s>][&capture=1][&material=compensado|cartao|gesso][&agua=0|1][&levantar=<0..1>]`

- `lugar`: padrão `rio`. Carrega `lugares/<slug>/laminas.json` e, se existir, `lugares/<slug>/camera.json`. Nunca carrega o terreno.png.
- `capture=1`: sem UI, sem animação automática, `devicePixelRatio` 1, sem controles de órbita; o quadro é função pura de `t` (e do material, da água). Nada de `Date.now`, `performance.now`, `Math.random` na cena. Texturas e HDRI carregam antes de `ready` resolver.
- Contrato `window.__maquete` (igual ao que `captura/comum.mjs` espera): `ready` (Promise que resolve com a cena montada e o primeiro quadro desenhado), `setTime(t)` (desenha o quadro de `t` segundos; devolve Promise), `duration()` (segundos da trilha), `getState()` (`{ t, levantar, material, pos, alvo }`), `metrics()` (`{ calls, triangles, renderizador }`; `renderizador` vem de `WEBGL_debug_renderer_info`).
- Modo interativo: OrbitControls com damping, órbita limitada (nunca abaixo da mesa: `maxPolarAngle` ≈ 80 graus; distâncias entre 0,6 e 3 larguras), botão "Girar" (gira sozinha, avançando `t` de fora via `setTime`), seletor de material (compensado, cartão, gesso), slider "Levantar o mar" (0 a 1: a placa de acrílico sobe até 25 mm e flutua), botão "Baixar SVGs" (gera no navegador com `cli/svg-lamina.mjs`, um download por lâmina ou um único SVG com todas as lâminas em páginas lado a lado; escolha do construtor, documentar), créditos no rodapé montados do `laminas.json.fontes` + Poly Haven + d3 (DOM, sem innerHTML com dado externo).
- Textos da interface em português. Mostrar: nome do lugar, `largura_mm` x `altura_mm`, número de lâminas, passo de terra e de mar em metros, exagero ("relevo 14x mais alto que o real; cada lâmina de 3 mm vale 40 m na terra e 10 m no mar"), fração medida do mar quando houver mar ("fundo do mar: 3 % medido por sonar, o resto é modelo GEBCO").

### Cena e look (o que faz a diferença; o construtor pode ajustar valores, não o espírito)

- Geometria: cada lâmina = `THREE.Shape` por anel ext com `holes` dos furos → `ExtrudeGeometry({ depth: espessura_mm, bevelEnabled: false })`, deitada no plano x-z (rotação -90° em x) com a base em `k * espessura_mm`. Dois grupos de material: tampo (índice 0) e parede (índice 1). Deduplicar pontos consecutivos antes de criar o Shape; descartar anel degenerado (área < 0,5 mm²). `castShadow` e `receiveShadow` ligados. Reusar materiais por tipo (não um material por lâmina).
- Materiais (`MeshPhysicalMaterial`), três presets:
  - `compensado` (padrão): tampo com `compensado_diff` (sRGB), `compensado_rough`, `compensado_nor_gl` (normal, escala 0,6), repeat de forma que 1 textura cubra ~150 mm, rotação do UV por lâmina (`k * 37°`) para não repetir; `clearcoat` 0,15, `clearcoatRoughness` 0,5. Parede: mesma textura com cor multiplicada por 0,55 (queima do laser), roughness 0,9, sem normal map. Lâminas de mar: o mesmo compensado com `color` tingido por uma rampa de azul por profundidade (da mais rasa para a mais funda: #9fc4d8, #7fb0cc, #5e97bb, #4379a3, #2f5d87, #1f4468, #163553, #0f2740; interpolar por índice), roughness 0,6. A lâmina "costa" (nível 0) é terra.
  - `cartao`: tampo e parede creme (#ece4d2 / #d9cfb8), roughness 0,95, sem textura de cor, com o normal map do compensado a 0,25 só como grão; mar em azul-ardósia por profundidade (#a9c3cf → #2b4b63).
  - `gesso`: branco (#f2f0ea / #d8d5cc), roughness 0,9, `sheen` 0,3; mar em cinza-azulado (#c9d2d6 → #6f8794).
- Placa de acrílico do mar (`agua`): `ExtrudeGeometry` de `agua.aneis` com `depth` 2 mm, topo em `z_mm` da lâmina costa (nível 0) + 0,2 mm; `MeshPhysicalMaterial` `transmission` 0,9, `thickness` 2, `roughness` 0,08, `ior` 1,49, `color` #bfe3ef, `attenuationColor` #7fb8d6, `attenuationDistance` 60; sem sombra projetada (castShadow false) para não escurecer o fundo; `receiveShadow` false. `levantar` (0..1) sobe a placa `levantar * 25 mm` e inclina 2° (como quem levanta com a mão). Fallback (celular, `dpr >= 2` ou `?simples=1`): mesmo material sem `transmission`, `transparent` true, `opacity` 0,45. Toggle `agua=0` tira a placa.
- Mesa: plano de 6 x 6 larguras com `mesa_diff/rough/nor_gl` (repeat ~ a cada 600 mm), `receiveShadow` true; a peça fica sobre a mesa com uma base de 2 mm (lâmina 0 já é essa base). Sem fundo preto.
- Luz: HDRI `estudio.hdr` via `RGBELoader` + `PMREMGenerator` como `scene.environment` (`environmentIntensity` ~0,9) e `scene.background` com `backgroundBlurriness` 0,7 e `backgroundIntensity` 0,5 (cinza quente desfocado; se ficar ruim, trocar por `Color(#d9d4cc)`). Mais uma `DirectionalLight` quente (#fff1dc, intensidade ~2,2) de cima-esquerda a 35° de elevação, `castShadow` com `shadow.mapSize` 2048, `PCFSoftShadowMap`, frustum justo à peça, `shadow.bias` -0,0003 e `normalBias` 0,02 (afinar até não ter acne nem sombra descolada). A sombra entre lâminas é o efeito principal: tem de ser real.
- Renderer: `antialias: true`, `toneMapping: ACESFilmicToneMapping`, `toneMappingExposure` ~1,0, `outputColorSpace` sRGB, `shadowMap.enabled`. Sem bloom. Vinheta leve por `div` com `radial-gradient` por cima do canvas (presente também no capture). BokehPass (tilt-shift) é opcional e desligado por padrão (`?bokeh=1`); se usar, SMAAPass no composer, senão o antialias do renderer basta.
- Câmera: perspectiva, fov 32 (produto), `near` 1, `far` 20 larguras. Trilha padrão (sem camera.json): volta completa de 12 s a 35° de elevação, raio 1,7 x `largura_mm`, alvo no centro da peça a `espessura_mm * n_laminas / 2`; `levantar` sobe de 0 a 1 entre 4 s e 7 s e desce de 9 s a 11,5 s. Com `camera.json`: keyframes `{ "t", "pos": [x,y,z], "alvo": [x,y,z], "fov", "levantar" }` em mm da cena, interpolados por `web/trilha.js` (adaptar: `nivel_agua_m` vira `levantar`).
- Orçamento: até 300 mil triângulos no total (ExtrudeGeometry de 40 lâminas com anéis simplificados a 0,15 mm fica bem abaixo); se passar, avisar no console e simplificar mais. Texturas 1k. Tudo roda no celular.

## SVG de corte (cli/svg.mjs + cli/svg-lamina.mjs)

- `node cli/svg.mjs <slug> [--saida lugares/<slug>/svg] [--kerf 0.15] [--numerar]`: um arquivo por lâmina `lamina-00.svg` … e `folha-chave.svg`.
- Cada SVG: `width="<largura_mm>mm" height="<altura_mm>mm" viewBox="0 0 <largura_mm> <altura_mm>"`, y para baixo (y_svg = altura_mm/2 - y_mm). Camada `corte`: anéis (ext e furos) como `<path>` com `fill="none" stroke="#ff0000" stroke-width="0.01"` (convenção de corte a laser). Camada `gravar`: o contorno da lâmina de cima (k+1) em `stroke="#0000ff" stroke-width="0.1"` como guia de colagem; e, com `--numerar`, o número da lâmina e o nível em metros (texto pequeno, 4 mm) num canto que esteja dentro do anel maior. Lâmina 0 recebe o retângulo e o contorno da lâmina 1.
- `folha-chave.svg`: lista das lâminas (k, nível, tipo, área em cm²), escala (1 cm na peça = X km), espessura, passo, exagero, fontes e licença em texto; serve de verso da peça.
- `cli/svg-lamina.mjs` é puro: `svgDaLamina(laminas, k, opcoes) -> string` e `svgFolhaChave(laminas, opcoes) -> string`; a página importa o mesmo arquivo. Teste: XML bem formado (parse simples), unidades em mm, número de paths = número de anéis.

## Captura

Herdada e intacta: `node captura/quadro.mjs <slug> --t 3` (um PNG) e `node captura/capture.mjs <slug> --de 0 --ate 12` (sequência + MP4), 1080x1920 por padrão; `--largura 1920 --altura 1080` para o README. Usa `window.__maquete`. Cadeados: `/tmp/ovictorlab-pesado.lock` (esteira) e `/tmp/maquete-quadro.lock` (mutex do headless). Só Chromium do Playwright com Metal; SwiftShader aborta.

## Regras da casa

- Textos de interface e docs em pt-BR ("sério mesmo", nunca "seriamente"); identifiers novos em inglês são bem-vindos, mas o código herdado está em português e não se renomeia agora. Markdown clássico (sem callouts, sem wikilinks, tabelas simples).
- Nenhuma menção a empresa. Assinatura "Victor Sodré · @ovictor".
- Nunca CDN; nunca chave de API; nunca inventar número ou fonte. Cada asset tem ficha em `dados/fontes/`.
- Um processo pesado por vez no Mac; captura só pelo `captura/` (que pega os cadeados). Testes nunca esperam a esteira (usar `BSM_LOCK_DIR`).
- `npm test` tem de passar antes de qualquer commit. Quem commita é o orquestrador.

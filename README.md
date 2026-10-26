# maquete

Qualquer lugar do mundo vira uma maquete em lâminas, terra e fundo do mar, com luz de estúdio no navegador e SVG para cortar a laser ou em papel. Dado aberto, um comando, sem chave de API, sem build.

[Read this in English](README.en.md)

![Rio de Janeiro e Baía de Guanabara](docs/rio.jpg)

| ![Florianópolis](docs/floripa.jpg) | ![Salvador e Baía de Todos-os-Santos](docs/salvador.jpg) | ![Fernando de Noronha](docs/noronha.jpg) |
|---|---|---|

## Lugares prontos

Quatro lugares já vêm com o relevo baixado e as lâminas calculadas. A demo abre direto no navegador; a peça tem 300 mm de largura em todos.

| Lugar | Demo | Peça (mm) | Lâminas (terra + mar) | Passo terra / mar | Exagero terra / mar | Fundo do mar medido por sonar |
|---|---|---|---|---|---|---|
| Rio de Janeiro e Baía de Guanabara | [abrir](https://victorsodre.github.io/maquete/?lugar=rio) | 300 × 225 | 12 (9 + 3) | 100 m / 20 m | 5,6x / 28,2x | 3,4 % |
| Florianópolis | [abrir](https://victorsodre.github.io/maquete/?lugar=floripa) | 300 × 406,5 | 17 (13 + 4) | 100 m / 20 m | 4,9x / 24,7x | 1,0 % |
| Salvador e Baía de Todos-os-Santos | [abrir](https://victorsodre.github.io/maquete/?lugar=salvador) | 300 × 279,9 | 12 (4 + 8) | 50 m / 200 m | 11,9x / 3,0x | 4,0 % |
| Fernando de Noronha | [abrir](https://victorsodre.github.io/maquete/?lugar=noronha) | 300 × 240,5 | 18 (7 + 11) | 25 m / 250 m | 8,9x / 0,9x | 0 % |

A lâmina da costa (nível 0 m) conta como terra. Cada lâmina tem 3 mm (compensado). Os números saem do `laminas.json` de cada lugar e são os mesmos que a página mostra.

## Usar em 30 segundos

Precisa de Node 22 ou mais. Nada de chave, nada de build.

```
git clone https://github.com/victorsodre/maquete.git
cd maquete
npm install

npx maquete --bbox -22.72,-23.1,-43.5,-42.95 --slug meu-lugar --nome "Meu lugar"
npx maquete meu-lugar
node cli/laminas.mjs meu-lugar
npm run serve
node cli/svg.mjs meu-lugar --numerar
```

O que cada passo produz:

1. `npx maquete --bbox N,S,O,L --slug meu-lugar --nome "..."` cria `lugares/meu-lugar/lugar.json` com a caixa (norte, sul, oeste, leste em graus) e já baixa o relevo. `npx maquete meu-lugar` repete a rodada a partir do que está em `lugar.json`, usando o cache. Os dois gravam `terreno.png` (altura em Terrain-RGB) e `terreno.json` (fontes, resolução, fração medida).
2. `node cli/laminas.mjs meu-lugar` corta o terreno em níveis e grava `laminas.json`: um polígono por lâmina, em milímetros da peça, com passo, exagero e fontes. O passo é escolhido sozinho e fica gravado no `lugar.json`; dá para forçar com `--passo-terra`, `--passo-mar`, `--largura-mm` e `--espessura-mm`.
3. `npm run serve` sobe a página em `http://localhost:8765/?lugar=meu-lugar`: a maquete montada em 3D, com luz de estúdio, sombra entre lâminas e a placa de acrílico do mar.
4. `node cli/svg.mjs meu-lugar --numerar` grava um SVG por lâmina mais a folha-chave em `lugares/meu-lugar/svg/`, prontos para a cortadora.

## A página

A página é `index.html` com `web/app.js`; não precisa de servidor especial, só de arquivos estáticos. Ela lê o `laminas.json` do lugar e nunca o `terreno.png`.

Parâmetros de URL:

| Parâmetro | Valores | O que faz |
|---|---|---|
| `lugar` | slug (padrão `rio`) | qual pasta de `lugares/` carregar |
| `material` | `compensado`, `cartao`, `gesso` | preset de material das lâminas (padrão compensado) |
| `agua` | `0` | tira a placa de acrílico do mar |
| `levantar` | `0` a `1` | quanto a placa do mar sobe (até 25 mm) e inclina, como quem levanta com a mão |
| `moldura` | `0` | tira a moldura de madeira em volta da peça |
| `t` | segundos | ponto da volta de câmera (12 s por volta) em que a cena abre |
| `capture` | `1` | modo de captura: sem interface, sem animação, quadro fixo em `t` |
| `simples` | `1` | placa do mar sem refração (o que o celular usa sozinho) |

A interface mostra o nome do lugar, o tamanho da peça, o número de lâminas e os passos em metros; o exagero vertical declarado ("relevo 5,6x mais alto que o real na terra (28,2x no mar); cada lâmina de 3 mm vale 100 m na terra e 20 m no mar"); e, quando há mar, a fração do fundo medida por sonar. Tem botão "Girar" (a peça dá a volta sozinha), seletor de material, slider "Levantar o mar" e os créditos com as fontes no rodapé.

O botão "Baixar SVGs" gera, no próprio navegador e com o mesmo módulo da CLI, um SVG por lâmina mais a folha-chave, numerados. O navegador pede permissão uma vez para vários downloads.

## Cortar de verdade

Cada SVG é uma lâmina, em milímetros de verdade (`width="300mm"`, `viewBox` em mm, sem `px`, sem `transform`): a cortadora abre no tamanho certo. O traço vermelho de 0,01 mm é corte; o traço azul de 0,1 mm é gravação e desenha o contorno da lâmina de cima, para você saber onde colar a próxima. Com `--numerar`, cada lâmina leva o número e o nível em metros gravados num canto.

A `folha-chave.svg` é o verso da peça: lista das lâminas (número, nível, tipo, área), escala horizontal (1 cm na peça = X km), espessura, passo, exagero, fontes e licença.

Material: compensado de 3 mm é o padrão. Para papel-cartão, gere as lâminas com `node cli/laminas.mjs meu-lugar --espessura-mm 1.5`; o passo em metros se ajusta sozinho para manter o exagero no limite.

Kerf (a largura que o laser come): `node cli/svg.mjs meu-lugar --kerf 0.15` só registra o valor no SVG e na folha-chave; as linhas não recebem offset. Configure a compensação no LightBurn ou no software da sua cortadora.

Montagem: cole de baixo para cima, alinhando cada lâmina pelo contorno azul gravado na de baixo. A lâmina 0 é o retângulo inteiro e serve de base.

Aviso honesto: o corte físico ainda não foi feito pelo autor. As convenções (vermelho corta, azul grava, mm de verdade) são as das cortadoras a laser comuns, mas confira um teste pequeno antes de cortar a peça toda.

## Honestidade na peça

Nada fica escondido na maquete.

- Exagero vertical: é consequência da espessura da lâmina e do passo em metros, `exagero = (espessura_mm / passo_m) / (mm_por_km / 1000)`. É calculado, gravado no `laminas.json`, mostrado na página e impresso na folha-chave. A terra fica em até 7x (até 12x em lugar muito plano, para não sair sem relevo); o mar pode ir mais alto, porque o fundo é estilizado por contornos como numa carta batimétrica, e os dois valores ficam declarados.
- Fundo do mar: o GMRT tem sonar multifeixe onde existe levantamento e, no resto, a grade GEBCO a cerca de 450 m por nó. A fração medida de verdade vem da camada `topo-mask` e é mostrada por lugar: Rio 3,4 %, Florianópolis 1,0 %, Salvador 4,0 %, Noronha 0 %. Fora dessa fração, a forma do fundo é modelo, não medição.
- Terra: o Copernicus DEM é modelo de superfície, não de terreno. Prédio e mata entram na altura. Por isso a terra passa por uma suavização de 2 nós antes de contornar, senão cidade vira confete de lâminas.
- Resolução real: o Copernicus vem a 30 m por nó e a grade de cada lugar fica entre 22 m (Noronha) e 58 m (Salvador) por nó; o GMRT devolveu entre 54 e 61 m por nó nestes quatro lugares, mas onde não há sonar o detalhe de verdade é o do GEBCO. Os valores exatos estão no `terreno.json` de cada lugar.
- Datum vertical: Copernicus (EGM2008) e GMRT (nível médio do mar) diferem em poucos metros. A fusão usa o Copernicus acima de 0,5 m e o GMRT no resto.

## Captura

`node captura/quadro.mjs rio --t 3` tira um PNG da cena no tempo `t`; `node captura/capture.mjs rio --de 0 --ate 12` grava a sequência e um MP4. As duas usam o Chromium do Playwright com GPU e o quadro é determinístico: a mesma URL e o mesmo `t` dão os mesmos bytes.

## Fontes e licenças

O código é MIT (veja `LICENSE`). Os dados e os assets têm licenças próprias, com ficha completa em `dados/fontes/`.

**Copernicus DEM GLO-30** (terra). ESA, programa Copernicus. Licença livre e aberta com atribuição obrigatória. Como o terreno é dado adaptado (reamostrado, fundido com o GMRT, recodificado), vale o aviso do artigo 6(b):

> "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved".

E o artigo 6(c), em qualquer aviso que cubra a distribuição:

> "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30".

**GMRT** (mar). Global Multi-Resolution Topography, CC BY 4.0. Não serve para navegação. Citação exigida:

> Ryan, W. B. F., S.M. Carbotte, J. Coplan, S. O'Hara, A. Melkonian, R. Arko, R.A. Weissel, V. Ferrini, A. Goodwillie, F. Nitsche, J. Bonczkowski, and R. Zemsky (2009), Global Multi-Resolution Topography (GMRT) synthesis data set, Geochem. Geophys. Geosyst., 10, Q03014, doi:10.1029/2008GC002332.

**GEBCO** (base do GMRT onde não há sonar). Domínio público. Citação:

> GEBCO Bathymetric Compilation Group 2026 (2026). The GEBCO_2026 Grid - a continuous terrain model for oceans and land at 15 arc-second intervals. doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa

**Poly Haven** (luz e texturas), CC0 1.0: Brown Photostudio 02 (HDRI) por Sergej Majboroda; Plywood (compensado) por Rob Tuytel; Wood Table 001 (mesa) por Dimitrios Savva e Rico Cilliers.

**Bibliotecas** vendorizadas em `web/vendor/`: d3-contour, d3-array e internmap (Mike Bostock, ISC); three.js r185 (MIT).

## Para quem for mexer no código

`AGENTS.md` lista o que já quebrou e vai quebrar de novo se você não souber; `SPEC.md` é o contrato entre CLI, lâminas, página, SVG e captura (unidades, formato do `laminas.json`, `window.__maquete`). Leia os dois antes. `npm test` roda tudo e tem de passar antes de qualquer commit.

por Victor Sodré · @ovictor

# Copernicus DEM GLO-30 (terra)

Modelo digital de superfície (DSM) global com 30 m de amostragem, derivado da missão TanDEM-X (WorldDEM, Airbus/DLR), distribuído pela ESA no programa Copernicus. É a fonte da terra em todo lugar com `"terra": "copernicus"`.

## URLs

| O quê | URL |
|---|---|
| Tile (COG) | `https://copernicus-dem-30m.s3.amazonaws.com/<tile>/<tile>.tif` |
| Lista de tiles | `https://copernicus-dem-30m.s3.amazonaws.com/tileList.txt` (26.450 tiles; 1.238 dentro do bbox do Brasil) |
| Readme do bucket | https://copernicus-dem-30m.s3.amazonaws.com/readme.html |
| Registro na AWS Open Data | https://registry.opendata.aws/copernicus-dem/ (bucket `copernicus-dem-30m`, região `eu-central-1`, mantido por Sinergise) |
| STAC | https://copernicus-dem-30m-stac.s3.amazonaws.com/ |
| Coleção na ESA (DOI) | https://doi.org/10.5270/ESA-c5d3d65 (redireciona para a página COP-DEM do Copernicus Data Space) |
| Licença (PDF) | https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf |

Nome do tile: `Copernicus_DSM_COG_10_S21_00_W041_00_DEM`. O `10` é a amostragem em segundos de arco (GLO-30); a latitude e a longitude são o canto sul-oeste do tile de 1 grau.

## Licença e atribuição

"Licence for Copernicus DEM instance COP-DEM-GLO-30-F Global 30m Full, Free & Open" (ESA, PDF acima, lido em 13/10/2026). Direitos concedidos (artigo 4): reprodução, distribuição, comunicação ao público, adaptação, modificação e combinação com outros dados; grátis (artigo 5), mundiais e sem limite de tempo (artigo 3).

Obrigações (artigo 6), texto exato:

(a) Ao distribuir ou comunicar ao público o dado como está:

> © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

(b) Quando o dado foi adaptado ou modificado (o nosso caso: reamostrado, fundido com o GMRT e recodificado em Terrain-RGB):

> "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved".

(c) Em qualquer licença ou aviso que cubra a distribuição, esta frase (ou tradução):

> "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30".

(d) Não dar a impressão de endosso oficial do provedor, do licenciante ou do programa Copernicus. (e) Quem redistribui tem de passar estas obrigações adiante.

Onde a atribuição aparece: README, página (créditos), `terreno.json` (campo `atribuicao`) e descrição de todo vídeo que use o terreno.

## Formato (fatos medidos em 13/10/2026)

- GeoTIFF otimizado para nuvem (COG), Float32, 3600 x 3600 nós por grau, DEFLATE com predictor 3 (readme). Nodata `-32767`.
- 4 níveis no arquivo: 3600, 1800, 900, 450 nós por grau (cerca de 31, 62, 124, 247 m por nó). Os overviews não têm transformação afim própria: use o bbox da imagem 0 e a largura do overview.
- Ler o overview 2 (900 x 900) de um tile por HTTP range (`geotiff` `fromUrl`) levou 3,8 s.
- Oceano dentro de um tile = 0. Tiles só de oceano não existem: HTTP 404 é normal ("ocean areas do not have tiles, there one can assume height values equal to zero", readme).
- Versões publicadas no Copernicus Data Space: 2019_1 a 2024_1 (julho de 2024). Qual versão está no bucket da AWS: a confirmar no readme/STAC.
- É DSM: árvores e prédios entram na altura.

## Chamadas registradas

| Quando | Chamada | Resposta |
|---|---|---|
| 13/10/2026, 18h (nota) | `Copernicus_DSM_COG_10_S21_00_W030_00_DEM` (Ilha da Trindade) | HTTP 200, 149.742 bytes |
| 13/10/2026, 21h (SPEC) | overview 2 (900 x 900) de um tile, por range | 3,8 s |
| 13/10/2026 | `tileList.txt` | 26.450 tiles; 1.238 no bbox do Brasil |
| 13/10/2026, 21h35 (CLI, 002) | overview 3 (450 nós por grau, 0,00222 grau por nó) de 6 tiles de terra: S20/W040, S20/W041, S21/W029, S21/W030, S21/W041, S22/W041 (janelas e sha256 por tile em `terreno.json`) | 1.798.779 bytes no total, 1 a 2 pedidos por tile (94.835 a 655.362 bytes cada), 0 nós nodata |
| 13/10/2026, 21h35 (CLI, 002) | os outros 33 tiles do bbox (lista `tiles_oceano` em `terreno.json`) | 404: só oceano, altura zero |

A 001 não usa Copernicus (`"terra": "gmrt"`).

## Onde quebra

- Costura entre tiles lidos em níveis diferentes (ONDE-QUEBRA 1).
- DSM, não DTM: na mata e na cidade o "chão" é o dossel.
- Datum vertical EGM2008; o GMRT usa nível médio do mar aproximado. Diferença de poucos metros, mas existe.
- Um tile de oceano pedido por engano é 404; a CLI tem de tratar 404 como "zero", não como falha (na 002 foram 33 dos 39 tiles do bbox).
- Para caixa grande a CLI lê um overview, não os 30 m: a 002 (1.300 km) usou o overview 3, cerca de 247 m por nó, reamostrado para 636 m. Os 30 m só aparecem em caixa de uns 40 km.
- O `terreno.json` gerado às 21h35 de 13/10/2026 gravou o aviso 6(a) no campo `atribuicao`; como o terreno é dado adaptado, a CLI passou a gravar o 6(b) mais a frase 6(c) na mesma noite, e o `terreno.json` da 002 foi regravado do cache (PNG idêntico). Em 14/10/2026 o campo `licenca` passou a apontar para o PDF da licença (`documentation.dataspace.copernicus.eu`), porque `spacedata.copernicus.eu` não responde (timeout de 25 s na revisão).

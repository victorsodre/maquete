# GMRT GridServer (mar)

Global Multi-Resolution Topography: síntese de batimetria multifeixe (cerca de 100 m por nó onde existe) sobre uma base global GEBCO (15 segundos de arco, cerca de 400 m). O GridServer devolve um grid por bbox, sem chave. É a fonte do mar em todo lugar (`"mar": "gmrt"`) e também da terra na 001 (`"terra": "gmrt"`).

## URLs

| O quê | URL |
|---|---|
| GridServer | `https://www.gmrt.org/services/GridServer?north=&south=&west=&east=&layer=topo&format=geotiff[&mresolution=N]` |
| Documentação do GridServer | https://www.gmrt.org/services/gridserverinfo.php |
| Termos de uso | https://www.gmrt.org/about/terms_of_use.php |
| Notícias e versões | https://www.gmrt.org/about/news.php |
| Fontes que compõem o GMRT | https://www.gmrt.org/contributors/index.php |

Parâmetros (documentação, lida em 13/10/2026): `north`/`south`/`west`/`east` (ou `maxlatitude` etc.); `layer=topo` (grid sem máscara: multifeixe onde há, base GEBCO no resto) ou `layer=topo-mask` (só o multifeixe, NaN no resto); `format` em `netcdf`, `coards`, `esriascii` ou `geotiff`; `resolution` em `default`, `med`, `high`, `max` (`max` é a resolução mais perto de 100 m por nó sem passar de 2 GB; `default` é a maior resolução com menos de 1.000 nós de largura, o que bate com os 713 x 141 medidos sem o parâmetro); `mresolution` em metros por nó (a documentação usa 200 só como exemplo e não declara um padrão; se vier, `resolution` é ignorado). Limite: 2 GB por pedido, cerca de 20 por 20 graus a 100 m por nó; a CLI recusa antes de pedir um GeoTIFF estimado acima de 200 MB.

A documentação do GridServer ainda cita "GEBCO_08" como base do grid sem máscara; a página de notícias diz que a versão 4.5.0 (junho de 2026) usa a base GEBCO 2026. Veja `gebco.md`.

## Licença e atribuição

CC BY 4.0 (termos de uso: "Site licensed under Creative Commons Attribution 4.0 International"). Exigências: crédito com byline/link ao GMRT, e a citação abaixo em qualquer material publicado com o dado. "The data should not be used for navigation."

Citação exigida (termos de uso, texto como publicado):

> Ryan, W. B. F., S.M. Carbotte, J. Coplan, S. O'Hara, A. Melkonian, R. Arko, R.A. Weissel, V. Ferrini, A. Goodwillie, F. Nitsche, J. Bonczkowski, and R. Zemsky (2009), Global Multi-Resolution Topography (GMRT) synthesis data set, Geochem. Geophys. Geosyst., 10, Q03014, doi:10.1029/2008GC002332.

DOI do conjunto de dados: 10.1594/IEDA.100001. Em `terreno.json` o campo `atribuicao` leva a citação exata acima (desde 14/10/2026; o `terreno.json` de 13/10 trazia uma forma curta, com "J.O. Coplan" e "e R. Zemsky"). A página mostra "GMRT" com link para https://www.gmrt.org/ (os termos pedem byline/link) e o texto inteiro em "fontes e licenças".

## Versões (página de notícias, lida em 13/10/2026)

| Versão | Quando | Base |
|---|---|---|
| 4.0 | janeiro de 2022 | GEBCO 2021 (base passou de 30" para 15") |
| 4.1.0 | outubro de 2022 | GEBCO 2022 |
| 4.2.0 | novembro de 2023 | GEBCO 2023 (10,98 % do oceano a ~100 m) |
| 4.3.0 | outubro de 2024 | GEBCO 2024 |
| 4.4.0 | agosto de 2025 | GEBCO 2025 (11,9 % do oceano a ~100 m) |
| 4.5.0 | junho de 2026 | GEBCO 2026 (23 levantamentos novos integrados) |

A resposta do GridServer não diz a versão; registre a data da chamada em `terreno.json` (`obtido_em`).

## Chamadas registradas

| Quando | Chamada | Resposta |
|---|---|---|
| 13/10/2026, 18h (nota) | caixa do Banco Besnard, `layer=topo`, `format=geotiff` | HTTP 200, 930 KB, 3,5 s |
| 13/10/2026, 18h (nota) | caixa do Banco Besnard (20,2 a 21,0 S, 38,9 a 37,6 W), `layer=topo-mask` | 594 x 391 = 232.254 nós, todos NaN (0 % medido) |
| 13/10/2026, 18h (nota) | cadeia inteira (19,5 a 21,8 S, 41 a 28,5 W), sem `mresolution` | 712 x 141 nós, 1.957 m por nó, 402 KB |
| 13/10/2026, 18h (nota) | cadeia inteira, `mresolution=245`, NetCDF | 5.690 x 1.119 nós, 244,6 m por nó, 6,37 milhões de nós, 25,5 MB |
| 13/10/2026, 21h (SPEC) | cadeia inteira, sem `mresolution` | 713 x 141, ~1,8 km por nó |
| 13/10/2026, 21h30 (fixture da 002, substituída às 21h35) | `north=-19.5&south=-21.8&west=-41.0&east=-28.5&layer=topo&format=geotiff&mresolution=600` | 2847 x 561, 458 m por nó, 6.393.522 bytes |
| 13/10/2026, 21h34 (CLI, 002) | `north=-19.5&south=-21.8&west=-41&east=-28.5&layer=topo&format=geotiff&mresolution=636` | 2847 x 561, 457,9 x 458,6 m por nó, 6.393.522 bytes, sha256 `4cabc002…`, 5.694 NaN |
| 13/10/2026, 21h34 (CLI, 002) | mesma caixa, `layer=topo-mask`, `mresolution=636` | 2847 x 561, 6.393.522 bytes, sha256 `0a2e280e…`; na grade de saída, 8,4 % dos nós de mar medidos (66.900 de 792.363) |
| 13/10/2026, 21h36 (CLI, 001) | `north=6&south=-34&west=-74.5&east=-28&layer=topo&format=geotiff&mresolution=2452` | 2.648 x 2.402, 1.899,3 x 1.855,3 m por nó, 25.461.566 bytes, sha256 `29e0db51…`, 5.296 NaN |

As duas leituras da chamada sem `mresolution` divergem em uma coluna (712 x 141 às 18h, 713 x 141 às 21h); ficam as duas até alguém reconferir com a mesma caixa exata.

## Onde quebra

- `mresolution` é aproximado: o servidor devolve o nível mais próximo que tem (600 e 636 viraram 458; 245 virou 244,6; 2.452 virou 1.899 x 1.855). Grave o que voltou.
- Sem `mresolution` vem ~1,8 km por nó. Para uma caixa de 600 km use algo entre 200 e 250; para 40 km, o mínimo que o servidor der (60 a 100 m).
- `layer=topo` tem NaN esparsos mesmo onde há dado: preencher pelo vizinho e contar (`nodata_preenchidos`).
- `topo-mask` é a única prova de medido x interpolado; sem ela, não dá para dizer na tela o que é forma real.
- Inclui terra, mas grosseira: use só quando o lugar inteiro cabe a ~1 km por nó (001).
- 2 GB por pedido: o país inteiro só cabe a ~1 km por nó.
- Unidade: metros, negativo no mar. Não é carta náutica; não serve para navegação.

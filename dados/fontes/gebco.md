# GEBCO (base do GMRT onde não há multifeixe)

A General Bathymetric Chart of the Oceans publica uma grade global de terreno (mar e terra) a 15 segundos de arco (cerca de 450 m no equador). O repositório não baixa o GEBCO diretamente: ele chega pelo GMRT, que usa a grade GEBCO como base e a cobre com multifeixe onde existe. Onde a `topo-mask` do GMRT é NaN, a forma na tela é a do GEBCO.

## URLs

| O quê | URL |
|---|---|
| Grade atual (GEBCO_2026) | https://www.gebco.net/data_and_products/gridded_bathymetry_data/ |
| DOI da GEBCO_2026 | https://doi.org/10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa |
| GEBCO_08 no Google Earth 5.0 (01/02/2009) | https://gebco.net/news_and_media/gebco_08_google.html |

## Licença e atribuição

Termos (página da grade, lida em 13/10/2026): "The GEBCO Grid is placed in the public domain and may be used free of charge."

Citação pedida (texto como extraído da página em 13/10/2026; a página traz o texto completo, com a editora):

> GEBCO Bathymetric Compilation Group 2026 (2026). The GEBCO_2026 Grid - a continuous terrain model for oceans and land at 15 arc-second intervals. doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa

## Qual GEBCO está por baixo do GMRT

Pela página de notícias do GMRT (lida em 13/10/2026): 4.0 (jan/2022) GEBCO 2021; 4.1.0 (out/2022) GEBCO 2022; 4.2.0 (nov/2023) GEBCO 2023; 4.3.0 (out/2024) GEBCO 2024; 4.4.0 (ago/2025) GEBCO 2025; 4.5.0 (jun/2026) GEBCO 2026. A documentação do GridServer ainda fala em GEBCO_08 (texto antigo). O que a nota de 13/10 marcava "a confirmar" (versão da base) está confirmado: GEBCO 2026 na versão 4.5.0. A resposta do GridServer não carimba a versão; vale a data da chamada.

## Chamadas registradas

Nenhuma chamada direta ao GEBCO: tudo passa pelo GridServer (veja `gmrt.md`).

## Onde quebra

- 15 segundos de arco é cerca de 450 m por nó: costa serrilhada e topo de monte suavizado (ONDE-QUEBRA 2 e 3). O topo do Banco Besnard no render é forma do GEBCO; a profundidade de 30 m é da Marinha.
- A grade é um modelo contínuo: onde não houve sonda, é interpolação de altimetria por satélite com os dados esparsos. Não dá para dizer "medido" sem a `topo-mask`.
- Foi a base do fundo do mar do Google Earth desde 2009 (GEBCO_08, 30 segundos de arco): tudo que já se viu "sem água" no Google Earth é esse tipo de forma.

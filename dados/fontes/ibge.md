# IBGE: localidades e malhas territoriais (recorte por território)

Listas de regiões, estados e municípios (API de localidades, v1) e polígonos dos territórios (API de malhas, v3), em GeoJSON, sem chave. É a fonte do recorte nas escalas país, região, estado e município (`lugar.json` com bloco `ibge`). O relevo continua vindo do GMRT e do Copernicus; o IBGE só diz onde o território começa e termina.

## URLs

| O quê | URL |
|---|---|
| Regiões | `https://servicodados.ibge.gov.br/api/v1/localidades/regioes` |
| Estados | `https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome` |
| Municípios | `https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome` |
| Malha do país | `https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=<q>` |
| Malha de região | `https://servicodados.ibge.gov.br/api/v3/malhas/regioes/<1..5>?formato=application/vnd.geo+json&qualidade=<q>` |
| Malha de estado | `https://servicodados.ibge.gov.br/api/v3/malhas/estados/<código de 2 dígitos>?formato=application/vnd.geo+json&qualidade=<q>` |
| Malha de município | `https://servicodados.ibge.gov.br/api/v3/malhas/municipios/<código de 7 dígitos>?formato=application/vnd.geo+json&qualidade=<q>` |
| Documentação (localidades) | https://servicodados.ibge.gov.br/api/docs/localidades |
| Documentação (malhas v3) | https://servicodados.ibge.gov.br/api/docs/malhas?versao=3 |

`qualidade` aceita `minima`, `intermediaria` e `maxima`. A resposta é um `FeatureCollection` com uma feature, `properties.codarea` igual ao código pedido e geometria `Polygon` (Sergipe) ou `MultiPolygon` (Brasil, Noronha): o leitor aceita as duas. Anéis vêm fechados (primeiro ponto repetido no fim).

## Licença e atribuição

Dado público do IBGE, servido pela API sem chave e sem cadastro. Atribuição usada no `terreno.json`, no `laminas.json` e na página: "IBGE, Malhas Territoriais". A página de termos de uso do portal ibge.gov.br respondeu 403 ao `curl` da CLI em 26/10/2026 (bloqueio a robôs), então o texto exato dos termos fica **a confirmar** por leitura no navegador; até lá a ficha registra só o que a API declara (nada) e a atribuição acima.

## Chamadas registradas

| Quando | Chamada | Resposta |
|---|---|---|
| 26/10/2026, 22h30 (sonda) | regiões | HTTP 200, 194 B, 5 itens `{id, sigla, nome}` |
| 26/10/2026, 22h30 (sonda) | estados | HTTP 200, 2.446 B, 27 itens `{id, sigla, nome, regiao}` em 0,2 s |
| 26/10/2026, 22h30 (sonda) | municípios | HTTP 200, 2.470.036 B, 5.571 itens em 3,2 s; 240 nomes repetidos (Bom Jesus aparece 5 vezes); Boa Esperança do Norte (MT, 5101837) veio com `microrregiao` nulo |
| 26/10/2026, 22h30 (sonda) | estados/28 (Sergipe), `minima` | 1.531 B, Polygon, 1 anel, 64 pontos |
| 26/10/2026, 22h30 (sonda) | estados/28, `intermediaria` | 3.184 B, 1 anel, 141 pontos (um lado a cada ~6 km) |
| 26/10/2026, 22h30 (sonda) | estados/28, `maxima` | 10.673 B, 1 anel, 490 pontos; bbox 11,5685 S a 9,515 S, 38,245 O a 36,3959 O |
| 26/10/2026, 22h30 (sonda) | estados/35 (São Paulo), `maxima` | 51.727 B |
| 26/10/2026, 22h30 (sonda) | estados/13 (Amazonas), `maxima` | 76.685 B |
| 26/10/2026, 22h30 (sonda) | paises/BR, `intermediaria` | 22.750 B, MultiPolygon, 10 polígonos, 13 anéis, 1.185 pontos; bbox 33,7439 S a 5,2718 N, 73,9833 O a 34,8027 O |
| 26/10/2026, 22h30 (sonda) | paises/BR, `maxima` | 65.655 B |
| 26/10/2026, 22h30 (sonda) | municipios/2605459 (Fernando de Noronha), `maxima` | 3.790 B, MultiPolygon, 5 polígonos, 174 pontos; bbox 3,88 S a 3,8048 S, 32,4755 O a 32,3778 O |
| 26 e 27/10/2026 (lote) | paises/BR e regioes/1..5 em `intermediaria`; estados (27) e municipios das 27 capitais em `maxima` | 60 malhas, HTTP 200 em todas, nenhuma falha; viraram os lugares pré-gerados (`lugares/brasil`, `regiao-*`, siglas e capitais em kebab) |

## Como a CLI usa

- Cache em `dados/cache-ibge/` (gitignored): `regioes.json`, `estados.json`, `municipios.json` e `malha-<nivel>-<codigo>-<qualidade>.json`, cada um com sidecar `.json` de metadados (URL, bytes, sha256, data). Nada é baixado duas vezes sem `--forcar`.
- Qualidade padrão: `intermediaria` no país e na região, `maxima` no estado e no município (`--qualidade` muda). Em `intermediaria` um estado como Sergipe tem 141 pontos e o contorno sai poligonal numa peça de 300 mm; em `maxima` são 490 pontos por 10 KB.
- O bbox do lugar é o bbox do polígono mais `margem` (fração, padrão 0,04) de cada lado, arredondado a 4 casas.
- O polígono é rasterizado na grade de saída (`cli/recorte.mjs`, par-ímpar, centro do nó) e o recorte (`contorno` ou `caixa`) é aplicado antes de gravar o `terreno.png`. O `terreno.json` guarda a chamada em `fontes` (id `ibge-malha`) e o resultado em `recorte`.

## Onde quebra

- A malha inclui ilhas oceânicas e o bbox vai junto: Espírito Santo com Trindade e Martim Vaz (leste em 28,80 O, bbox de 1.425 km para um estado que ocupa ~17 % dessa largura), Pernambuco com Fernando de Noronha (leste em 32,04 O, 1.070 km), Vitória com Trindade (1.298 km para um município de 17 km). ES e PE ficaram como saíram; Vitória teve o `bbox` fechado à mão no `lugar.json`. Falta a CLI ignorar polígono isolado a mais de N km ao calcular o bbox.

- O nome do município não é único: 240 nomes repetem (Bonito existe em MS, PE, PA e BA). Sem `--uf` a CLI para e lista os homônimos com UF e código.
- `--uf SE` é Sergipe; `--regiao SE` é Sudeste. O mesmo texto muda de sentido pela opção.
- Território que cruza o antimeridiano ou o polo: não existe no Brasil; a CLI continua sem suportar (`validarBbox`).
- `codarea` diferente do pedido derruba a rodada (sinal de resposta trocada ou cache corrompido; `--forcar` refaz).

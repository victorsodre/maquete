# Poly Haven (HDRI do estúdio e texturas de madeira)

Três assets do Poly Haven fazem a luz e o material da maquete na página: um HDRI de estúdio fotográfico (`scene.environment` e fundo desfocado) e duas texturas PBR (compensado das lâminas, madeira envernizada da mesa). Todos em 1k, baixados como JPG (texturas) e `.hdr` (HDRI); ficam em `web/assets/` com nome em português. Nenhum deles entra no SVG de corte nem no `laminas.json`.

## URLs

| O quê | Arquivo local | Página | Download usado |
|---|---|---|---|
| HDRI Brown Photostudio 02, 1k | `web/assets/estudio.hdr` | https://polyhaven.com/a/brown_photostudio_02 | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/brown_photostudio_02_1k.hdr |
| Textura Plywood, 1k, cor (Diffuse) | `web/assets/compensado_diff.jpg` | https://polyhaven.com/a/plywood | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plywood/plywood_diff_1k.jpg |
| Textura Plywood, 1k, rugosidade (Rough) | `web/assets/compensado_rough.jpg` | https://polyhaven.com/a/plywood | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plywood/plywood_rough_1k.jpg |
| Textura Plywood, 1k, normal OpenGL (nor_gl) | `web/assets/compensado_nor_gl.jpg` | https://polyhaven.com/a/plywood | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plywood/plywood_nor_gl_1k.jpg |
| Textura Wood Table 001, 1k, cor (Diffuse) | `web/assets/mesa_diff.jpg` | https://polyhaven.com/a/wood_table_001 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_table_001/wood_table_001_diff_1k.jpg |
| Textura Wood Table 001, 1k, rugosidade (Rough) | `web/assets/mesa_rough.jpg` | https://polyhaven.com/a/wood_table_001 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_table_001/wood_table_001_rough_1k.jpg |
| Textura Wood Table 001, 1k, normal OpenGL (nor_gl) | `web/assets/mesa_nor_gl.jpg` | https://polyhaven.com/a/wood_table_001 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_table_001/wood_table_001_nor_gl_1k.jpg |
| API pública (metadados) | | https://api.polyhaven.com/info/<id> e https://api.polyhaven.com/files/<id> | |
| Licença do site | | https://polyhaven.com/license | |
| Texto da CC0 1.0 | | https://creativecommons.org/publicdomain/zero/1.0/ | |

## Autores (pela API, `https://api.polyhaven.com/info/<id>`, lida em 26/10/2026)

| Asset | Autores | Publicado | Tamanho real |
|---|---|---|---|
| `brown_photostudio_02` (HDRI) | Sergej Majboroda (tudo) | 19/05/2022 | panorama; sem dimensão física |
| `plywood` (textura) | Rob Tuytel (tudo) | 22/06/2020 | 50 x 50 cm por repetição |
| `wood_table_001` (textura) | Dimitrios Savva (fotografia), Rico Cilliers (processamento) | 16/07/2021 | 150 x 150 cm por repetição |

Os tamanhos reais vêm do campo `dimensions` da API (em mm). Na cena, o compensado repete a cada ~150 mm da maquete e a mesa a cada ~600 mm (SPEC): a escala da textura é escolha de look, não a física do asset.

## Licença e atribuição

Página de licença do Poly Haven (lida em 26/10/2026): "All assets (HDRIs, textures and 3D models) on this site are the original work of Poly Haven staff, or artists who willingly and directly donate/sell their work to Poly Haven. Our assets are all licensed as CC0". Uso livre para qualquer fim, inclusive comercial; redistribuição permitida; crédito não é exigido ("although it is appreciated").

Crédito que a página mostra mesmo assim (rodapé, montado no DOM):

> Luz e texturas: Poly Haven (Brown Photostudio 02 por Sergej Majboroda; Plywood por Rob Tuytel; Wood Table 001 por Dimitrios Savva e Rico Cilliers), CC0 1.0.

A `folha-chave.svg` repete o crédito em texto. Como é CC0, não há aviso obrigatório a passar adiante.

## Formato (fatos medidos em 26/10/2026)

- HDRI: Radiance `.hdr` (RGBE), 1024 x 512, 1.648.130 bytes. Carregado por `RGBELoader` e convertido por `PMREMGenerator`; é a única fonte de luz ambiente da cena.
- Texturas: JPG 1024 x 1024. `diff` em sRGB (cor), `rough` e `nor_gl` são dado linear (sem `SRGBColorSpace`). O normal map é na convenção OpenGL (`nor_gl`, Y para cima), a que o Three.js espera; o `nor_dx` do mesmo asset (Y invertido) não serve sem trocar o sinal de `normalScale.y`.
- Tamanhos locais conferidos por `Content-Length` do download em 26/10/2026 (byte a byte iguais): `estudio.hdr` 1.648.130; `compensado_diff.jpg` 882.059; `compensado_rough.jpg` 729.997; `compensado_nor_gl.jpg` 648.222; `mesa_diff.jpg` 215.573; `mesa_rough.jpg` 237.261; `mesa_nor_gl.jpg` 51.927.
- sha256 dos arquivos locais: `estudio.hdr` `469abc5e…`, `compensado_diff.jpg` `800905650…`, `compensado_rough.jpg` `c4600551…`, `compensado_nor_gl.jpg` `a0d8459e…`, `mesa_diff.jpg` `460dd08d…`, `mesa_rough.jpg` `a2ca9ae8…`, `mesa_nor_gl.jpg` `9bf7ddf5…`.
- Total em `web/assets/`: 4,4 MB, dentro do orçamento da página no Pages.

## Chamadas registradas

| Quando | Chamada | Resposta |
|---|---|---|
| 26/10/2026, ~15h20 (vendorização) | os 7 downloads da tabela de URLs | arquivos em `web/assets/` com os tamanhos acima |
| 26/10/2026, ~16h (esta ficha) | `api.polyhaven.com/info/wood_table_001`, `/info/plywood`, `/info/brown_photostudio_02` | autores, categorias, `date_published` e `dimensions` da tabela de autores |
| 26/10/2026, ~16h (esta ficha) | `api.polyhaven.com/files/<id>` (os três) | URLs de download 1k em `jpg` e `hdr` (as usadas acima) |
| 26/10/2026, ~16h (esta ficha) | `HEAD` nos 7 downloads | `Content-Length` igual ao tamanho local em todos |

## Onde quebra

- 1k é o teto da página (orçamento de celular e de 10 MB por lugar). O 2k do compensado tem 4x os bytes e não muda nada numa lâmina de 300 mm vista inteira.
- O HDRI tem janelas e luminárias: reflexo no acrílico do mar é a cena do estúdio, de propósito. Se parecer "sujo", baixar `environmentIntensity`, não trocar o HDRI sem nova ficha.
- A API não devolve a licença por asset (não há campo `license`); a CC0 vale pela página de licença do site, que cobre todos os assets.
- `dimensions` vem em mm com ruído de ponto flutuante (`1500.0001192092896`); a tabela arredonda.
- Nome do arquivo local é em português e não traz o id do asset: esta ficha é o único vínculo entre `compensado_*.jpg` e `plywood`. Ao trocar um asset, trocar a ficha junto.

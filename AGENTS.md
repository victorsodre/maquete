# AGENTS.md: armadilhas para quem mexe neste repositório

Leia `SPEC.md` antes de tudo: é o contrato entre CLI, lâminas, página, SVG e captura, com unidades, formato do `laminas.json` e `window.__maquete`. Este arquivo é a lista do que já quebrou ou vai quebrar se você não souber.

## Regras da casa

- Uma pilha: Node 22 ou mais, ESM (`.mjs` na CLI e nos scripts, `.js` em `web/`), sem Python, sem build, sem chave de API, nunca CDN. Dependências só as do `package.json` (`geotiff`, `pngjs`; dev: `playwright`, `three`). d3 e three.js vivem vendorizados em `web/vendor/` com `LICENSE`; o d3 é importado por caminho relativo também no Node. Precisa de algo a mais? Resolva com Node puro.
- Textos de interface e documentação em português do Brasil ("sério mesmo", nunca "seriamente"); identifiers novos em inglês, o código herdado em português fica como está. Markdown clássico: sem callouts, sem wikilinks, tabelas simples, linha em branco entre blocos.
- Nenhuma menção a empresa. Assinatura "Victor Sodré · @ovictor".
- Cada fonte de dado e cada asset tem ficha em `dados/fontes/` (Copernicus, GMRT, GEBCO, Poly Haven, d3/three) com URL, licença, atribuição, chamadas registradas e onde quebra. Nunca inventar número nem fonte; o que não foi conferido fica "a confirmar".
- Comandos: `npx maquete <slug>` lê `./lugares/<slug>/lugar.json` e grava `terreno.png` + `terreno.json`; `npx maquete --bbox N,S,O,L --slug <slug> --nome "Nome"` cria o lugar; `node cli/laminas.mjs <slug>` gera `laminas.json`; `node cli/svg.mjs <slug>` gera os SVGs de corte; `npm run serve` sobe a página em 8765. O `bin` é detectado por `realpath` (`ehPrincipal` em `cli/rede.mjs`): comparar `process.argv[1]` por `path.resolve` falha pelo symlink do npm e o comando sai mudo.
- Testes: `npm test` (`node --test cli/*.test.mjs scripts/*.test.mjs captura/*.test.mjs`). Tem de passar antes de qualquer commit, e quem commita é o orquestrador.

## O Mac é compartilhado

- A máquina roda outras produções ao mesmo tempo. Um processo pesado por vez, nunca laço de espera ativa, nunca `watch`, nunca captura de sequência longa fora do cadeado.
- Cadeado grande: `/tmp/ovictorlab-pesado.lock` (diretório criado com `mkdir` atômico, arquivo `pid` dentro). Não é nosso. Só `captura/capture.mjs` o pega, pelo `pegarCadeadoEsteira()` de `captura/comum.mjs`: dono vivo, espera (poll de 30 s, `--espera-max` em minutos, padrão 120); dono morto, remove; solta ao fim, em erro e em SIGINT. Nunca apague esse diretório na mão. Para testes, `BSM_LOCK_DIR` troca o caminho (o nome da variável é herdado e fica): um teste nunca pode esperar um render de verdade.
- Um headless por vez na máquina inteira: mutex `/tmp/maquete-quadro.lock` (mesmo esquema; poll de 5 s, até 10 min). Vale para `quadro.mjs` e para qualquer teste que abra o Chromium.
- Download sempre com cache em `lugares/<slug>/cache/` (gitignored). Nunca baixar o mesmo tile duas vezes.
- Ao terminar, confira com `ps` que não ficou servidor nem Chromium seu rodando.

## Headless e GPU

- Só o Chromium do Playwright 1.61.0, `chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })`, `deviceScaleFactor` 1.
- SwiftShader é proibido: sem os args de GPU o headless cai em renderização por software, come os 8 núcleos e o resultado não vale. A captura lê `window.__maquete.metrics().renderizador` (`WEBGL_debug_renderer_info`): renderização por software aborta; sem "Metal" só avisa. Neste Mac tem de dizer `ANGLE Metal Renderer: AMD Radeon Pro Vega 56`.

## Determinismo da cena

- Nada de `Date.now`, `performance.now` nem `Math.random` na cena. O quadro é função pura de `t`, `material`, `agua` e `levantar`, e só muda por `window.__maquete.setTime(t)`. O botão "Girar" avança `t` de fora; em `capture=1` não há laço de animação, UI nem órbita. A captura prova isso recapturando 3 quadros e comparando bytes: a diferença tem de ser 0.
- Texturas e HDRI carregam antes de `ready` resolver; um quadro capturado com material ainda cinza é bug, não variação.

## Copernicus DEM GLO-30 (terra), resumido

- Tile `Copernicus_DSM_COG_10_S21_00_W041_00_DEM`: lat/lon do nome são o canto sul-oeste do tile de 1 grau. Float32, 3600 x 3600 por grau, COG. Tiles só de oceano não existem: 404 é normal e vale altura zero; dentro do tile o oceano já é 0.
- Overviews (3600, 1800, 900, 450 nós por grau) não têm transformação afim própria: posicione pelo bbox da imagem 0 e pela largura do overview. Caixa grande lê overview, não os 30 m.
- É DSM: árvore e prédio entram na altura. Por isso o blur de 1 nó na terra antes de contornar; sem ele, cidade vira confete de lâminas.
- Licença exige o aviso exato do artigo 6(b) para dado adaptado (texto em `dados/fontes/copernicus.md`); vai no `terreno.json`, no `laminas.json`, na página e na folha-chave.

## GMRT GridServer (mar), resumido

- `layer=topo&format=geotiff[&mresolution=N]`; `mresolution` é aproximado e o servidor devolve o nível que tem: grave o que voltou, não o que pediu. Sem `mresolution` vem ~1,8 km por nó. Teto de 2 GB por pedido.
- `layer=topo` tem NaN esparsos: preencher pelo vizinho e contar. `layer=topo-mask` é a única prova de medido x interpolado (NaN = base GEBCO a ~450 m por nó); a fração vai em `mascara.pct_medido` e na tela.
- Fora do multifeixe o fundo é GEBCO reamostrado em blocos: daí o blur de `ceil(450 / metros_por_no)` nós no mar, senão as lâminas de mar saem com degraus quadrados.
- Metros nos dois (Copernicus e GMRT); datum vertical difere em poucos metros (EGM2008 x nível médio do mar). Fusão em `cli/terrain.mjs`: Copernicus acima de 0,5 m vence; senão `min(gmrt, 0)`.

## Lâminas (cli/laminas.mjs, cli/svg*.mjs, web/app.js)

- d3-contour devolve coordenadas de célula, não de nó: o valor do nó `(i, j)` fica em `(i + 0,5; j + 0,5)`, os anéis vão de 0 a `w` e de 0 a `h`, y cresce para baixo (linha 0 = norte). Converter sempre por `x_mm = (cx / w - 0,5) * largura_mm` e `y_mm = (0,5 - cy / h) * altura_mm`; sem o 0,5 a maquete sai deslocada meio nó e a costa não bate com a placa de água.
- Orientação dos anéis: a inversão de y (tela para norte-para-cima) inverte o sentido de todo anel. Nunca confie na ordem que o d3 entrega: recalcule a área com sinal depois de converter para mm e force ext anti-horário, furos horário (o teste de `laminas.test.mjs` confere). `THREE.Shape` com `holes` aceita qualquer sentido, mas a triangulação (earcut) e o `ExtrudeGeometry` ficam mais estáveis com ext e furos em sentidos opostos.
- ExtrudeGeometry e anéis degenerados: anel com menos de 3 pontos, pontos consecutivos repetidos ou área abaixo de 0,5 mm² derruba o earcut (NaN nas normais, triângulos de área zero, parede com furo). Deduplicar pontos, descartar o degenerado e nunca repetir o primeiro ponto no fim (o `laminas.json` fecha implicitamente). Um furo que encosta no ext vira dois anéis depois da simplificação: tratar como ext separado.
- Sombra entre lâminas é o efeito principal e é frágil: com `shadow.bias` zero aparece acne no tampo; com bias alto a sombra descola da parede e a lâmina parece flutuar. Partir de `bias` -0,0003 e `normalBias` 0,02, frustum da luz justo à peça (não à mesa inteira), `mapSize` 2048, `PCFSoftShadowMap`. Afinar olhando um quadro com `captura/quadro.mjs`, nunca a olho no celular.
- `transmission` no celular: `MeshPhysicalMaterial` com `transmission` renderiza a cena duas vezes e, com `dpr` 2 ou 3, derruba o fps e estoura memória em telefone. Fallback obrigatório (`dpr >= 2` ou `?simples=1`): mesmo material sem `transmission`, `transparent` + `opacity` 0,45. A placa nunca projeta sombra (`castShadow` false), senão escurece o fundo do mar.
- Orçamento no Pages: 10 MB por lugar (`terreno.png` + `terreno.json` + `laminas.json`), `laminas.json` com 2 casas decimais e anéis simplificados a 0,15 mm; `web/assets/` já pesa 4,4 MB e é compartilhado. Até 300 mil triângulos no total; passou, avise no console e simplifique mais, não suba o orçamento.
- SVG de corte é em mm de verdade: `width="300mm"`, `viewBox="0 0 300 224.6"`, y para baixo (`y_svg = altura_mm / 2 - y_mm`). Traço de corte `stroke="#ff0000" stroke-width="0.01"` e `fill="none"` (convenção das cortadoras a laser: vermelho fino corta, azul 0,1 mm grava). Sem `transform`, sem unidades mistas, sem `px`: uma cortadora que lê `px` escala a peça em 96 dpi e a lâmina sai do tamanho errado. O `kerf` entra no corte, não no `laminas.json`.
- Página: o `importmap` vem antes de qualquer `<link rel="modulepreload">`, senão `three` não resolve. Lâmina 0 é o retângulo inteiro, sempre; a placa de água só existe quando há mar (`elev_min_m < 0`).

## Git e posse

- Construtores paralelos mexem só nos arquivos do próprio papel; não "arrumam" o resto. Quem commita é o orquestrador.
- `.gitignore` exclui `node_modules/`, `lugares/*/cache/`, `lugares/*/svg/`, `captura/saida/`, `*.tif`, `*.tiff`, `*.nc`. Dado bruto nunca entra no git; `terreno.png` e `laminas.json` entram (orçamento de 10 MB por lugar).

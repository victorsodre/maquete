# Captura determinística

Exporta a cena da página (`window.__maquete`) como sequência PNG no tamanho do Short e como MP4, sempre pelo relógio da cena (`setTime(t)`), nunca pelo relógio de parede. Mesmo `t`, mesmo quadro: o próprio comando prova isso recapturando 3 quadros numa página nova e comparando os bytes.

Uma pilha só: Node 22+, Playwright 1.61.0 (Chromium com Metal) e `ffmpeg` no PATH. Sem build, sem chave.


## Arquivos

| Arquivo | O que faz |
|---------|-----------|
| `capture.mjs` | sequência `q_000001.png...`, MP4 e `relatorio.json`; pega o cadeado da máquina e o mutex do headless |
| `quadro.mjs` | um quadro só (prévia rápida); só o mutex do headless |
| `comum.mjs` | peças compartilhadas: argumentos, cadeados, servidor, navegador, espera da cena |
| `comum.test.mjs` | testes dos cadeados, argumentos e URL (`node --test captura/comum.test.mjs`, sem navegador) |
| `stub/index.html` | página mínima com a API `window.__maquete` (quadrado neon que anda com `t`) para testar a captura sem a cena de verdade |
| `saida/` | o que sai (gitignored) |


## Uso

```
node captura/capture.mjs <slug> [--fps 30] [--de 0] [--ate 10] [--largura 1080] [--altura 1920]
                                [--saida captura/saida/<slug>] [--url ...] [--espera-max 120] [--timeout 180]
node captura/quadro.mjs  <slug> [--t 0] [--largura 1080] [--altura 1920] [--saida arquivo.png] [--url ...] [--timeout 180]
```

- `--de` e `--ate` em segundos; o intervalo é meio-aberto: `--de 0 --ate 1 --fps 10` dá 10 quadros (t = 0,0 a 0,9), e segmentos emendam sem repetir quadro. `--ate fim` vai até `window.__maquete.duration()`.
- `--url` aponta para outra página do repo ou para a própria página com parâmetros: um caminho dentro do repo (`/captura/stub/index.html`, ou `/index.html?camada=1`, servido pelo `scripts/serve.mjs` que o comando sobe sozinho numa porta livre) ou um `http(s)://...` de um servidor já no ar (aí nenhum servidor é aberto). Sem `--url`, a página é `/index.html`. Os parâmetros `lugar=<slug>` (se não vier na URL), `t=<de>` e `capture=1` entram sempre; os que já vêm na URL (como `camada=1`) ficam.
- `--t` do `quadro.mjs` aceita lista (`0,12,30`); aí `--saida` é uma pasta e sai um `quadro-<t>s.png` por tempo.
- Viewport 1080x1920 com `deviceScaleFactor` 1; `--largura` e `--altura` têm de ser pares (yuv420p).
- Saída do `capture.mjs`: `q_000001.png` em diante, `<slug>-<de>s-<ate>s.mp4` e `relatorio.json`. Quadros `q_*.png` antigos na pasta são apagados antes (senão o ffmpeg emendaria a sequência velha), mas só dentro de `captura/saida/`: um `--saida` fora dela com `q_*.png` dentro faz o comando parar e pedir para esvaziar a pasta.
- Código de saída do `capture.mjs`: 0 tudo certo; 2 se o determinismo falhou ou o MP4 não bate com o pedido (erros de página ficam em `erros_pagina` no relatório e no terminal); 1 erro de execução (inclusive renderizador por software). Do `quadro.mjs`: 0 tudo certo; 2 se a página registrou erro; 1 erro de execução.

Exemplos:

```
node captura/quadro.mjs 002-vitoria-trindade --t 12
node captura/capture.mjs 002-vitoria-trindade --de 0 --ate fim
node captura/capture.mjs 002-vitoria-trindade --de 0 --ate 1 --fps 10 --url http://127.0.0.1:8765/
node captura/capture.mjs 002-vitoria-trindade --de 0 --ate 12 --url '/index.html?camada=1' --saida captura/saida/002-vitoria-trindade/camada
```


## Chromium

`chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })`: GPU de verdade, nunca SwiftShader. O renderizador WebGL de verdade é lido da página depois de `window.__maquete.ready` (`metrics().renderizador`, via `WEBGL_debug_renderer_info`), impresso no log e gravado em `ambiente.webgl_renderer`: SwiftShader, llvmpipe ou qualquer renderização por software aborta o comando com erro; sem "Metal" só avisa (noutra máquina pode ser outra GPU). Playwright não trata SIGINT por conta própria aqui (`handleSIGINT: false`): o comando fecha navegador, servidor e cadeados na ordem certa e sai com 130. Se o contexto ou a página falharem logo depois do `launch`, o Chromium é fechado antes de o erro subir.

Erros da página (`pageerror`, `console.error`, requisição que falhou, HTTP 4xx/5xx) vão para `erros_pagina` no relatório e para o terminal. O `favicon.ico` que o Chromium pede sozinho é ignorado, e o 404 de `lugares/<slug>/camera.json` (arquivo opcional: sem ele a página usa a trilha padrão) vira aviso em `avisos_pagina`, não erro.


## Cadeados

Dois diretórios em `/tmp`, cada um com um arquivo `pid` dentro. `mkdir` é atômico, por isso serve de cadeado.

| Cadeado | Quem usa | Espera |
|---------|----------|--------|
| `/tmp/ovictorlab-pesado.lock` | esteira dos Shorts (`produzir.py`) e `capture.mjs` | poll de 30 s, `--espera-max` minutos (default 120) |
| `/tmp/maquete-quadro.lock` | `capture.mjs` e `quadro.mjs` (um headless por vez na máquina) | poll de 5 s, até 10 min |

Regras, iguais ao `pesado()` do `produzir.py`: se o diretório existe e o `pid` está vivo, espera; se o `pid` morreu, confirma 1 s depois e remove; diretório sem `pid` há mais de 1 min é resto de processo que caiu e também sai. Ao fim, em erro e em SIGINT/SIGTERM o comando remove só o cadeado cujo `pid` é o dele. O `capture.mjs` pega primeiro o da máquina, depois o mutex; o `quadro.mjs` só o mutex.

`BSM_LOCK_DIR=/tmp/maquete-teste.lock` troca o caminho do cadeado da máquina. É SÓ para testes: um teste nunca pode ficar esperando a esteira de verdade terminar um render. Nunca use a variável para pular a fila num render de verdade.


## relatorio.json

Campos principais: `quadros`, `fps`, `de`, `ate`, `duracao_s`, `url`, `tempos_ms` (`carga_pagina`, `cena_pronta`, `sequencia`, `ffmpeg`, `total` e `por_quadro` com média, mediana, p95 e máximo de `set_time` e `screenshot`), `lista` (um registro por quadro: `t`, arquivo, tempos, bytes, sha256), `determinismo` (`quadros` recapturados, `bytes_diferentes`, `ok`, `comparacoes` com `pixels_diferentes` quando os bytes diferem), `metrics` (da cena: draw calls, triângulos, malha, reflexo, textura, `renderizador`, `nevoa_por_km`, `trilha_padrao`) e `estado_final` da cena, `erros_pagina`, `avisos_pagina` (camera.json ausente, renderizador sem Metal), `mp4` (comando do ffmpeg, bytes, `ffprobe` com largura, altura, quadros, pix_fmt e duração), `cadeado` (caminhos, `de_teste`, quanto esperou) e `ambiente` (Node, Chromium, args de GPU, `webgl_renderer`).


## Teste

```
node --test scripts/serve.test.mjs captura/comum.test.mjs
node captura/quadro.mjs stub --t 5 --url /captura/stub/index.html
BSM_LOCK_DIR=/tmp/maquete-teste.lock node captura/capture.mjs stub --url /captura/stub/index.html --de 0 --ate 1 --fps 10
ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=width,height,nb_read_frames -of default=nw=1 captura/saida/stub/stub-0s-1s.mp4
```

Esperado: 1080x1920, 10 quadros, `determinismo.bytes_diferentes` = 0 no `relatorio.json`, nenhum diretório em `/tmp/maquete-teste.lock` nem `/tmp/maquete-quadro.lock` depois.

#!/usr/bin/env node
// Um quadro só (prévia rápida) da cena, no tempo t, em PNG do tamanho do Short.
// Não pega o cadeado grande da esteira; pega só o mutex do headless (nunca dois Chromium ao mesmo tempo).
//
// Uso: node captura/quadro.mjs <slug> [--t 0] [--largura 1080] [--altura 1920]
//        [--saida captura/saida/<slug>/quadro-<t>s.png] [--url /captura/stub/index.html | http://...]
//        [--timeout 180]
//   --t aceita uma lista ("0,12,30"): aí --saida é uma pasta e sai um quadro-<t>s.png por tempo.
import fs from 'node:fs';
import path from 'node:path';
import {
  RAIZ, MUTEX_QUADRO, log, fmt, arred, agora, lerArgs, numero, criarLimpeza, pegarMutexQuadro,
  subirServidor, precisaServidor, montarUrl, abrirNavegador, abrirCena, capturarQuadro, lerMetricas,
  lerRenderizador, conferirRenderizador,
} from './comum.mjs';

const USO = `uso: node captura/quadro.mjs <slug> [--t 0] [--largura 1080] [--altura 1920] [--saida arquivo.png] [--url caminho-ou-http] [--timeout 180]
  --t         segundos (pode ser lista: 0,12,30; aí --saida é uma pasta)
  --url       caminho dentro do repo (sobe o servidor sozinho) ou http(s) de um servidor já no ar
  mutex: ${MUTEX_QUADRO} (um headless por vez; espera até 10 min)`;

async function main() {
  const { posicionais, opcoes } = lerArgs(process.argv.slice(2));
  if (opcoes.ajuda || !posicionais[0]) { console.log(USO); process.exit(opcoes.ajuda ? 0 : 1); }
  const slug = posicionais[0];
  const tempos = String(opcoes.t ?? '0').split(',').map((s) => numero(s.trim(), 0, 't'));
  const largura = numero(opcoes.largura, 1080, 'largura');
  const altura = numero(opcoes.altura, 1920, 'altura');
  const timeout_ms = numero(opcoes.timeout, 180, 'timeout') * 1000;
  const varios = tempos.length > 1;
  const nome = (t) => `quadro-${String(t)}s.png`;
  const saida = opcoes.saida && opcoes.saida !== true
    ? path.resolve(RAIZ, String(opcoes.saida))
    : path.join(RAIZ, 'captura', 'saida', slug, varios ? '' : nome(tempos[0]));
  const pasta = varios ? saida : path.dirname(saida);
  fs.mkdirSync(pasta, { recursive: true });

  const limpeza = criarLimpeza();
  const inicio = agora();
  try {
    limpeza.adicionar(await pegarMutexQuadro());
    let base = null;
    if (precisaServidor(opcoes.url)) {
      const srv = await subirServidor();
      limpeza.adicionar(srv.fechar);
      base = srv.url;
      log(`servidor: ${base}`);
    }
    const url = montarUrl({ url: opcoes.url, base, slug, t: tempos[0] });
    const nav = await abrirNavegador({ largura, altura });
    limpeza.adicionar(() => nav.browser.close());
    log(`Chromium ${nav.versao} · ${largura}x${altura} dpr 1 · ${url}`);
    const tempo = await abrirCena(nav.page, url, { timeout_ms });
    const renderizador = await lerRenderizador(nav.page);
    const avisoGpu = conferirRenderizador(renderizador);   // SwiftShader aborta aqui
    log(`renderizador WebGL: ${renderizador || '?'}${avisoGpu ? ' · ATENÇÃO: ' + avisoGpu : ''}`);
    log(`cena pronta em ${fmt(tempo.pronto_ms)} ms (página carregada em ${fmt(tempo.carga_ms)} ms)`);

    const resultados = [];
    for (const t of tempos) {
      const q = await capturarQuadro(nav.page, t);
      const arquivo = varios ? path.join(saida, nome(t)) : saida;
      fs.writeFileSync(arquivo, q.png);
      const m = await lerMetricas(nav.page);
      resultados.push({ t, arquivo, bytes: q.png.length, set_time_ms: arred(q.set_time_ms), screenshot_ms: arred(q.screenshot_ms), metrics: m.metrics, estado: m.estado });
      const met = m.metrics ? ` · ${fmt(m.metrics.calls)} draw calls · ${fmt(m.metrics.triangles)} triângulos` : '';
      log(`quadro t=${fmt(t, 2)} s → ${path.relative(RAIZ, arquivo)} (${fmt(q.png.length / 1024)} KiB; setTime ${fmt(q.set_time_ms)} ms, screenshot ${fmt(q.screenshot_ms)} ms)${met}`);
    }
    if (nav.erros.length) {
      log(`ATENÇÃO: ${nav.erros.length} erro(s) na página:`);
      for (const e of nav.erros.slice(0, 10)) log('  ! ' + e.slice(0, 300));
    }
    const avisos = [...nav.avisos, ...(avisoGpu ? [avisoGpu] : [])];
    for (const a of avisos) log(`aviso: ${a.slice(0, 300)}`);
    console.log(JSON.stringify({ slug, url, largura, altura, renderizador, quadros: resultados, erros_pagina: nav.erros, avisos_pagina: avisos, total_ms: arred(agora() - inicio) }));
    process.exitCode = nav.erros.length ? 2 : 0;
  } finally {
    await limpeza.limpar();
  }
}

main().catch((e) => { log('ERRO:', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); process.exitCode = 1; });

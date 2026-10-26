#!/usr/bin/env node
// Captura determinística da cena: sequência PNG (q_000001.png...) no tamanho do Short, MP4 (libx264,
// yuv420p, crf 18, faststart) e relatorio.json com tempos por quadro, prova de determinismo e métricas.
//
// Uso: node captura/capture.mjs <slug> [--fps 30] [--de 0] [--ate 10 | fim] [--largura 1080] [--altura 1920]
//        [--saida captura/saida/<slug>] [--url /captura/stub/index.html | http://...] [--espera-max 120] [--timeout 180]
//
// Cadeados: primeiro o da máquina (/tmp/ovictorlab-pesado.lock, o mesmo da esteira; espera a esteira acabar),
// depois o mutex do headless (/tmp/maquete-quadro.lock). Ambos soltos ao fim, em erro e em SIGINT/SIGTERM.
// BSM_LOCK_DIR troca o caminho do cadeado da máquina SÓ para testes.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  RAIZ, CADEADO_ESTEIRA, CADEADO_EH_DE_TESTE, MUTEX_QUADRO, ARGS_GPU, log, fmt, arred, agora, sha256, nomeQuadro,
  lerArgs, numero, criarLimpeza, pegarCadeadoEsteira, pegarMutexQuadro, subirServidor, precisaServidor, montarUrl,
  abrirNavegador, prepararPagina, abrirCena, capturarQuadro, lerMetricas, lerRenderizador, conferirRenderizador,
  bytesDiferentes, pixelsDiferentes,
} from './comum.mjs';

const USO = `uso: node captura/capture.mjs <slug> [--fps 30] [--de 0] [--ate 10] [--largura 1080] [--altura 1920] [--saida captura/saida/<slug>] [--url caminho-ou-http] [--espera-max 120] [--timeout 180]
  --ate fim      vai até window.__maquete.duration() (o Short inteiro)
  --url          caminho dentro do repo (sobe o servidor sozinho numa porta livre) ou http(s) de um servidor já no ar
  --espera-max   minutos esperando a esteira soltar ${CADEADO_ESTEIRA} (poll de 30 s)
  saída: q_000001.png em diante, <slug>-<de>s-<ate>s.mp4 e relatorio.json na pasta --saida`;

function rodar(cmd, args, { aoLinha } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; if (aoLinha) for (const l of String(d).split('\n')) if (l) aoLinha(l); });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error(`${cmd} não rodou: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} saiu com código ${code}: ${err.trim().split('\n').slice(-6).join(' | ')}`))));
  });
}

async function codificar({ saida, fps, n, mp4 }) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
    '-framerate', String(fps), '-start_number', '1', '-i', 'q_%06d.png', '-frames:v', String(n),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', path.basename(mp4)];
  const comando = `ffmpeg ${args.join(' ')}`;
  log(`ffmpeg: ${n} quadros a ${fps} fps → ${path.relative(RAIZ, mp4)}`);
  const t0 = agora();
  let ultimoAviso = agora();
  // ffmpeg lê os quadros da pasta de saída (cwd), por isso o spawn roda lá dentro.
  await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { cwd: saida, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', (d) => {
      const m = String(d).match(/frame=(\d+)/g);
      if (m && agora() - ultimoAviso >= 10000) {
        ultimoAviso = agora();
        log(`ffmpeg: ${m[m.length - 1].slice(6)} de ${n} quadros codificados`);
      }
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error(`ffmpeg não rodou (está instalado?): ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com código ${code}: ${err.trim().split('\n').slice(-6).join(' | ')}`))));
  });
  const ms = agora() - t0;
  const { out } = await rodar('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt,nb_frames,r_frame_rate:format=duration,size', '-of', 'json', mp4]);
  const info = JSON.parse(out);
  const s = (info.streams || [])[0] || {};
  const f = info.format || {};
  return {
    arquivo: path.relative(RAIZ, mp4), comando, ms: arred(ms), bytes: Number(f.size || 0),
    ffprobe: { codec: s.codec_name, largura: s.width, altura: s.height, pix_fmt: s.pix_fmt, quadros: Number(s.nb_frames || 0), fps: s.r_frame_rate, duracao_s: Number(f.duration || 0) },
  };
}

function estatisticas(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { media: arred(v.reduce((a, b) => a + b, 0) / v.length), mediana: arred(q(0.5)), p95: arred(q(0.95)), max: arred(v[v.length - 1]), min: arred(v[0]) };
}

async function main() {
  const { posicionais, opcoes } = lerArgs(process.argv.slice(2));
  if (opcoes.ajuda || !posicionais[0]) { console.log(USO); process.exit(opcoes.ajuda ? 0 : 1); }
  const slug = posicionais[0];
  const fps = numero(opcoes.fps, 30, 'fps');
  const de = numero(opcoes.de, 0, 'de');
  const largura = numero(opcoes.largura, 1080, 'largura');
  const altura = numero(opcoes.altura, 1920, 'altura');
  const espera_max_min = numero(opcoes['espera-max'], 120, 'espera-max');
  const timeout_ms = numero(opcoes.timeout, 180, 'timeout') * 1000;
  const ateFim = opcoes.ate === 'fim';
  let ate = ateFim ? null : numero(opcoes.ate, 10, 'ate');
  if (!(fps > 0)) throw new Error('--fps tem de ser maior que zero');
  if (de < 0) throw new Error('--de não pode ser negativo');
  if (largura % 2 || altura % 2 || largura < 2 || altura < 2) throw new Error('--largura e --altura têm de ser pares (yuv420p)');
  const saida = path.resolve(RAIZ, opcoes.saida && opcoes.saida !== true ? String(opcoes.saida) : path.join('captura', 'saida', slug));

  const limpeza = criarLimpeza();
  const inicio = agora();
  const relatorio = {
    slug, comando: ['node', ...process.argv.slice(1).map((a) => (a.startsWith(RAIZ + path.sep) ? path.relative(RAIZ, a) : a))].join(' '),
    largura, altura, fps, de, ate, quadros: 0, duracao_s: 0, url: null, saida: path.relative(RAIZ, saida),
    cadeado: { esteira: CADEADO_ESTEIRA, de_teste: CADEADO_EH_DE_TESTE, mutex: MUTEX_QUADRO, esperou_ms: 0 },
    ambiente: { node: process.version, chromium: null, args_gpu: ARGS_GPU, webgl_renderer: null },
    tempos_ms: {}, determinismo: null, metrics: null, estado_final: null, erros_pagina: [], avisos_pagina: [], mp4: null, lista: [],
    gerado_em: null,
  };
  let diffTotal = -1;
  try {
    // 1. cadeado da máquina (espera a esteira), 2. mutex do headless
    const t_cad = agora();
    limpeza.adicionar(await pegarCadeadoEsteira({ espera_max_min }));
    limpeza.adicionar(await pegarMutexQuadro());
    relatorio.cadeado.esperou_ms = arred(agora() - t_cad);
    log(`cadeados pegos (${CADEADO_ESTEIRA} e ${MUTEX_QUADRO}) depois de ${fmt(relatorio.cadeado.esperou_ms / 1000, 1)} s`);

    // 3. servidor estático numa porta livre (só se --url não aponta para um servidor no ar)
    let base = null;
    let servidor = null;
    if (precisaServidor(opcoes.url)) {
      servidor = await subirServidor();
      limpeza.adicionar(servidor.fechar);
      base = servidor.url;
      log(`servidor: ${base}`);
    }
    const url = montarUrl({ url: opcoes.url, base, slug, t: de });
    relatorio.url = url;

    // 4. navegador e cena
    const nav = await abrirNavegador({ largura, altura });
    limpeza.adicionar(() => nav.browser.close());
    relatorio.ambiente.chromium = nav.versao;
    log(`Chromium ${nav.versao} · ${largura}x${altura} dpr 1 · ${url}`);
    const tempo = await abrirCena(nav.page, url, { timeout_ms });
    relatorio.tempos_ms.carga_pagina = arred(tempo.carga_ms);
    relatorio.tempos_ms.cena_pronta = arred(tempo.pronto_ms);
    // o renderizador de verdade, medido na página: SwiftShader aborta, sem Metal avisa
    relatorio.ambiente.webgl_renderer = await lerRenderizador(nav.page);
    const avisoGpu = conferirRenderizador(relatorio.ambiente.webgl_renderer);
    log(`renderizador WebGL: ${relatorio.ambiente.webgl_renderer || '?'}${avisoGpu ? ' · ATENÇÃO: ' + avisoGpu : ''}`);
    if (avisoGpu) relatorio.avisos_pagina.push(avisoGpu);
    const duracao = await nav.page.evaluate(() => (window.__maquete.duration ? window.__maquete.duration() : null));
    log(`cena pronta em ${fmt(tempo.pronto_ms)} ms · duração declarada ${duracao === null ? '?' : fmt(duracao, 2) + ' s'}`);
    if (ateFim) {
      if (!(duracao > 0)) throw new Error('--ate fim precisa de window.__maquete.duration() válido');
      ate = duracao;
    } else if (duracao > 0 && ate > duracao) log(`aviso: --ate ${fmt(ate, 2)} s passa da duração da cena (${fmt(duracao, 2)} s)`);
    relatorio.ate = ate;
    const n = Math.round((ate - de) * fps);
    if (n < 1) throw new Error(`nada a capturar: de ${de} s a ${ate} s a ${fps} fps dá ${n} quadros`);
    relatorio.quadros = n;
    relatorio.duracao_s = arred(n / fps, 3);

    // 5. sequência (quadros antigos com o mesmo nome saem antes, senão o ffmpeg emenda).
    // Só apaga dentro de captura/saida/: um --saida /tmp apagaria q_*.png de terceiros.
    fs.mkdirSync(saida, { recursive: true });
    const antigos = fs.readdirSync(saida).filter((f) => /^q_\d{6}\.png$/.test(f));
    if (antigos.length) {
      const dentro = path.resolve(saida).startsWith(path.join(RAIZ, 'captura', 'saida') + path.sep);
      if (!dentro) throw new Error(`${saida} já tem ${antigos.length} quadro(s) q_*.png e fica fora de captura/saida/: esvazie a pasta você mesmo (não apago q_*.png fora de captura/saida/)`);
      for (const f of antigos) fs.unlinkSync(path.join(saida, f));
      log(`${antigos.length} quadros antigos apagados em ${path.relative(RAIZ, saida)}`);
    }
    log(`capturando ${n} quadros: t de ${fmt(de, 2)} s a ${fmt(ate, 2)} s a ${fps} fps → ${path.relative(RAIZ, saida)}`);
    const lista = [];
    const t_seq = agora();
    let ultimoAviso = agora();
    for (let i = 1; i <= n; i++) {
      const t = Math.round((de + (i - 1) / fps) * 1e6) / 1e6;
      const q = await capturarQuadro(nav.page, t);
      const arquivo = nomeQuadro(i);
      fs.writeFileSync(path.join(saida, arquivo), q.png);
      lista.push({ i, t, arquivo, set_time_ms: arred(q.set_time_ms), screenshot_ms: arred(q.screenshot_ms), bytes: q.png.length, sha256: sha256(q.png) });
      if (i === n || i === 1 || agora() - ultimoAviso >= 10000) {
        ultimoAviso = agora();
        const porQuadro = (agora() - t_seq) / i;
        const faltam = porQuadro * (n - i) / 1000;
        log(`quadro ${fmt(i)}/${fmt(n)} (t=${fmt(t, 2)} s) · ${fmt(porQuadro)} ms/quadro · faltam ~${faltam >= 90 ? fmt(faltam / 60, 1) + ' min' : fmt(faltam) + ' s'}`);
      }
    }
    relatorio.tempos_ms.sequencia = arred(agora() - t_seq);
    relatorio.lista = lista;
    relatorio.tempos_ms.por_quadro = {
      total: estatisticas(lista.map((q) => q.set_time_ms + q.screenshot_ms)),
      set_time: estatisticas(lista.map((q) => q.set_time_ms)),
      screenshot: estatisticas(lista.map((q) => q.screenshot_ms)),
    };
    const m = await lerMetricas(nav.page);
    relatorio.metrics = m.metrics;
    relatorio.estado_final = m.estado;
    relatorio.duracao_declarada_s = m.duracao_s;

    // 6. determinismo: 3 quadros de novo, numa página nova, bytes iguais
    const escolhidos = [...new Set([1, Math.ceil(n / 2), n])];
    const t_det = agora();
    const pagina2 = await prepararPagina(nav.context);
    await abrirCena(pagina2.page, url, { timeout_ms });
    const comparacoes = [];
    for (const i of escolhidos) {
      const q = lista[i - 1];
      const r = await capturarQuadro(pagina2.page, q.t);
      const original = fs.readFileSync(path.join(saida, q.arquivo));
      const bytes_diferentes = bytesDiferentes(original, r.png);
      const pixels_diferentes = bytes_diferentes ? pixelsDiferentes(original, r.png) : 0;
      comparacoes.push({ i, t: q.t, arquivo: q.arquivo, bytes_diferentes, pixels_diferentes, sha256_primeira: q.sha256, sha256_segunda: sha256(r.png) });
    }
    await pagina2.page.close();
    diffTotal = comparacoes.reduce((a, c) => a + c.bytes_diferentes, 0);
    relatorio.determinismo = { quadros: escolhidos, bytes_diferentes: diffTotal, ok: diffTotal === 0, pagina_nova: true, comparacoes, ms: arred(agora() - t_det) };
    relatorio.erros_pagina = [...nav.erros, ...pagina2.erros];
    relatorio.avisos_pagina.push(...nav.avisos, ...pagina2.avisos);
    if (diffTotal === 0) log(`determinismo: ${escolhidos.length} quadros recapturados em página nova, 0 bytes diferentes`);
    else log(`ATENÇÃO determinismo: ${fmt(diffTotal)} bytes diferentes (${comparacoes.map((c) => `q${c.i}: ${fmt(c.pixels_diferentes)} px`).join(', ')})`);
    if (relatorio.erros_pagina.length) {
      log(`ATENÇÃO: ${relatorio.erros_pagina.length} erro(s) na página:`);
      for (const e of relatorio.erros_pagina.slice(0, 10)) log('  ! ' + e.slice(0, 300));
    }
    for (const a of relatorio.avisos_pagina) log(`aviso: ${a.slice(0, 300)}`);

    // navegador e servidor fechados antes do ffmpeg: um processo pesado por vez
    await nav.browser.close();
    if (servidor) await servidor.fechar();

    // 7. MP4
    const mp4 = path.join(saida, `${slug}-${de}s-${ate}s.mp4`);
    relatorio.mp4 = await codificar({ saida, fps, n, mp4 });
    relatorio.tempos_ms.ffmpeg = relatorio.mp4.ms;
    const pr = relatorio.mp4.ffprobe;
    log(`mp4: ${relatorio.mp4.arquivo} · ${pr.largura}x${pr.altura} · ${fmt(pr.quadros)} quadros · ${fmt(pr.duracao_s, 2)} s · ${fmt(relatorio.mp4.bytes / 1048576, 2)} MB · ${fmt(relatorio.mp4.ms / 1000, 1)} s de codificação`);
    if (pr.quadros !== n || pr.largura !== largura || pr.altura !== altura) {
      log(`ATENÇÃO: o MP4 não bate com o pedido (${pr.largura}x${pr.altura}, ${pr.quadros} quadros; esperava ${largura}x${altura}, ${n})`);
    }
  } finally {
    relatorio.tempos_ms.total = arred(agora() - inicio);
    relatorio.gerado_em = new Date().toISOString();
    try {
      fs.mkdirSync(saida, { recursive: true });
      fs.writeFileSync(path.join(saida, 'relatorio.json'), JSON.stringify(relatorio, null, 2) + '\n');
      log(`relatório: ${path.relative(RAIZ, path.join(saida, 'relatorio.json'))} · total ${fmt(relatorio.tempos_ms.total / 1000, 1)} s`);
    } catch (e) { log('não consegui gravar o relatório:', e.message); }
    await limpeza.limpar();
  }
  const mp4ok = relatorio.mp4 && relatorio.mp4.ffprobe.quadros === relatorio.quadros;
  process.exitCode = diffTotal === 0 && mp4ok ? 0 : 2;
}

main().catch((e) => { log('ERRO:', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); process.exitCode = 1; });

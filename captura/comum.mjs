// Peças comuns da captura: argumentos, cadeados, servidor, navegador e espera pela cena.
// Usado por capture.mjs (sequência + MP4) e quadro.mjs (um quadro só).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { criarServidor } from '../scripts/serve.mjs';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Cadeado grande da máquina: o mesmo diretório que o pesado() do produzir.py da esteira usa
// (mkdir atômico + arquivo pid; uma tarefa pesada por vez no Mac).
// BSM_LOCK_DIR troca o caminho SÓ para testes: um teste nunca pode ficar esperando a esteira de verdade.
export const CADEADO_ESTEIRA = process.env.BSM_LOCK_DIR || '/tmp/ovictorlab-pesado.lock';
export const CADEADO_EH_DE_TESTE = Boolean(process.env.BSM_LOCK_DIR);

// Mutex dos headless: nunca dois Chromium ao mesmo tempo na máquina, nem para prévia.
export const MUTEX_QUADRO = '/tmp/maquete-quadro.lock';

// GPU de verdade (Metal), nunca SwiftShader; sem os args o Chromium headless cai em renderização por software.
export const ARGS_GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

export function log(...a) { console.log('[captura]', ...a); }
export function fmt(n, casas = 0) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
export const agora = () => performance.now();
export const arred = (x, casas = 1) => Math.round(x * 10 ** casas) / 10 ** casas;
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const nomeQuadro = (i) => `q_${String(i).padStart(6, '0')}.png`;

// --chave valor | --chave=valor | --flag ; o resto é posicional.
export function lerArgs(argv) {
  const posicionais = [];
  const opcoes = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { opcoes.ajuda = true; continue; }
    if (!a.startsWith('--')) { posicionais.push(a); continue; }
    const igual = a.indexOf('=');
    if (igual > 0) { opcoes[a.slice(2, igual)] = a.slice(igual + 1); continue; }
    const k = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opcoes[k] = argv[++i];
    else opcoes[k] = true;
  }
  return { posicionais, opcoes };
}

export function numero(valor, padrao, nome) {
  if (valor === undefined || valor === true) return padrao;
  const n = Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`--${nome} precisa ser um número; veio "${valor}"`);
  return n;
}

// ── cadeados ───────────────────────────────────────────────────────────────────────────────────

function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function lerPid(dir) {
  try { return fs.readFileSync(path.join(dir, 'pid'), 'utf8').trim(); } catch { return ''; }
}
function idadeMs(dir) {
  try { return Date.now() - fs.statSync(dir).mtimeMs; } catch { return 0; }
}

// Pega um cadeado-diretório do jeito do pesado() do produzir.py: tenta mkdir; se já existe, lê o pid;
// dono morto é retirado (confirmado 1 s depois, para não brigar com quem acabou de criar);
// dono vivo = espera com poll até espera_max_ms. Um diretório sem pid há mais de 60 s é resto de
// processo que caiu entre o mkdir e o pid (também é retirado). Devolve a função que solta:
// idempotente, e só remove se o pid gravado for o nosso.
export async function pegarCadeado(dir, { rotulo, poll_ms, espera_max_ms, aoEsperar }) {
  const inicio = agora();
  for (;;) {
    try { fs.mkdirSync(dir); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const dono = lerPid(dir);
      if (dono && !pidVivo(Number(dono))) {
        await dormir(1000);
        if (lerPid(dir) === dono) {
          fs.rmSync(dir, { recursive: true, force: true });
          log(`${rotulo}: dono ${dono} já morreu, ${dir} removido`);
        }
        continue;
      }
      if (!dono && idadeMs(dir) > 60000) {
        fs.rmSync(dir, { recursive: true, force: true });
        log(`${rotulo}: ${dir} sem pid há mais de 1 min, removido`);
        continue;
      }
      const esperado = agora() - inicio;
      if (esperado >= espera_max_ms) {
        throw new Error(`${rotulo}: ${dir} continua ocupado (pid ${dono || 'sem pid'}) depois de ${fmt(esperado / 60000, 1)} min; desisti`);
      }
      if (aoEsperar) aoEsperar(dono, esperado);
      await dormir(poll_ms);
    }
  }
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
  let solto = false;
  return function soltar() {
    if (solto) return;
    solto = true;
    if (lerPid(dir) === String(process.pid)) fs.rmSync(dir, { recursive: true, force: true });
  };
}

// Cadeado da esteira: poll de 30 s, --espera-max em minutos (default 120).
export async function pegarCadeadoEsteira({ espera_max_min = 120 } = {}) {
  if (CADEADO_EH_DE_TESTE) log(`cadeado de TESTE (BSM_LOCK_DIR): ${CADEADO_ESTEIRA}`);
  return pegarCadeado(CADEADO_ESTEIRA, {
    rotulo: 'cadeado da máquina', poll_ms: 30000, espera_max_ms: espera_max_min * 60000,
    aoEsperar: (dono, ms) => log(`esperando a esteira (pid ${dono || '?'}) soltar ${CADEADO_ESTEIRA}: ${fmt(ms / 60000, 1)} de ${espera_max_min} min`),
  });
}

// Mutex do headless: poll de 5 s, até 10 min; aviso a cada 30 s.
export async function pegarMutexQuadro() {
  let vez = 0;
  return pegarCadeado(MUTEX_QUADRO, {
    rotulo: 'mutex do headless', poll_ms: 5000, espera_max_ms: 10 * 60000,
    aoEsperar: (dono, ms) => { if (vez++ % 6 === 0) log(`esperando outro headless (pid ${dono || '?'}) soltar ${MUTEX_QUADRO}: ${fmt(ms / 1000)} s`); },
  });
}

// ── limpeza ordenada (fim normal, erro, SIGINT, SIGTERM) ─────────────────────────────────────────

export function criarLimpeza() {
  const pilha = [];
  let rodando = null;
  const limpar = () => {
    if (rodando) return rodando;
    rodando = (async () => {
      while (pilha.length) {
        const f = pilha.pop();
        try { await f(); } catch (e) { log('ao limpar:', e.message); }
      }
      rodando = null;
    })();
    return rodando;
  };
  const aoSinal = (sinal) => async () => {
    log(`recebi ${sinal}: fechando navegador, servidor e cadeados`);
    await limpar();
    process.exit(130);
  };
  process.once('SIGINT', aoSinal('SIGINT'));
  process.once('SIGTERM', aoSinal('SIGTERM'));
  // Última linha de defesa: no exit só dá para rodar o que é síncrono (soltar cadeado é).
  process.on('exit', () => { for (const f of pilha.splice(0).reverse()) { try { f(); } catch {} } });
  return { adicionar: (f) => pilha.push(f), limpar };
}

// ── servidor e URL ─────────────────────────────────────────────────────────────────────────────

export async function subirServidor() {
  const srv = criarServidor(RAIZ);
  await new Promise((res, rej) => { srv.once('error', rej); srv.listen(0, '127.0.0.1', res); });
  const { port } = srv.address();
  return {
    url: `http://127.0.0.1:${port}`, porta: port,
    fechar: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); }),
  };
}

// --url pode ser um endereço http(s) completo (servidor de fora, uma variante) ou um caminho dentro
// do repo (ex.: /captura/stub/index.html), servido pelo nosso serve.mjs numa porta livre.
export function precisaServidor(url) { return !(url && /^https?:\/\//i.test(String(url))); }

export function montarUrl({ url, base, slug, t }) {
  const u = precisaServidor(url) ? new URL(url && url !== true ? String(url) : '/index.html', base) : new URL(String(url));
  if (!u.searchParams.has('lugar')) u.searchParams.set('lugar', slug);
  u.searchParams.set('t', String(t));
  u.searchParams.set('capture', '1');
  return u.toString();
}

// ── navegador ──────────────────────────────────────────────────────────────────────────────────

export async function abrirNavegador({ largura, altura }) {
  const browser = await chromium.launch({
    channel: 'chromium', headless: true, args: ARGS_GPU, timeout: 120000,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
  });
  // se o contexto ou a página falharem, o Chromium não pode ficar órfão (ainda não está na pilha de limpeza)
  try {
    const context = await browser.newContext({
      viewport: { width: largura, height: altura }, deviceScaleFactor: 1,
      locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    });
    const { page, erros, avisos } = await prepararPagina(context);
    return { browser, context, page, erros, avisos, versao: browser.version() };
  } catch (e) {
    try { await browser.close(); } catch { /* já caiu */ }
    throw e;
  }
}

// O favicon que o Chromium pede sozinho e o camera.json (opcional: sem ele a página usa a trilha
// padrão, web/app.js) não são erros da cena; o 404 do camera.json vira aviso.
const favicon = (url) => /\/favicon\.ico$/i.test(String(url || ''));
const cameraOpcional = (url) => /\/lugares\/[^/]+\/camera\.json(\?.*)?$/i.test(String(url || ''));

export async function prepararPagina(context) {
  const page = await context.newPage();
  const erros = [];
  const avisos = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() || {}).url;
    if (favicon(url) || cameraOpcional(url)) return;
    erros.push('console: ' + m.text());
  });
  page.on('requestfailed', (r) => { if (!favicon(r.url())) erros.push(`rede: ${r.url()} ${(r.failure() || {}).errorText || ''}`); });
  page.on('response', (r) => {
    if (r.status() < 400 || favicon(r.url())) return;
    if (r.status() === 404 && cameraOpcional(r.url())) { avisos.push(`sem camera.json (http 404: ${r.url()}); a página usa a trilha padrão`); return; }
    erros.push(`http ${r.status()}: ${r.url()}`);
  });
  return { page, erros, avisos };
}

// Renderizador WebGL de verdade (WEBGL_debug_renderer_info, lido pela própria página em metrics()).
export async function lerRenderizador(page) {
  try {
    return await page.evaluate(() => (window.__maquete && window.__maquete.metrics ? window.__maquete.metrics().renderizador : null) || null);
  } catch { return null; }
}

// SwiftShader (renderização por software) é proibido: come os 8 núcleos e o fps não vale nada.
// Devolve um aviso (string) quando o renderizador não diz Metal, e lança erro em software.
export function conferirRenderizador(renderizador) {
  const r = String(renderizador || '');
  if (!r) return 'renderizador WebGL não informado pela página (metrics().renderizador vazio)';
  if (/swiftshader|software|llvmpipe|basic render/i.test(r)) throw new Error(`renderizador WebGL por software: "${r}". SwiftShader é proibido (AGENTS.md); confira os args de GPU do Chromium (${ARGS_GPU.join(' ')})`);
  if (!/metal/i.test(r)) return `renderizador WebGL sem Metal: "${r}" (neste Mac tem de dizer Metal; noutra máquina confira que é GPU de verdade)`;
  return null;
}

// Abre a URL e espera window.__maquete.ready (terreno, régua e primeiro quadro). Devolve tempos.
export async function abrirCena(page, url, { timeout_ms = 180000 } = {}) {
  const t0 = agora();
  await page.goto(url, { waitUntil: 'load', timeout: timeout_ms });
  const carga_ms = agora() - t0;
  await page.waitForFunction(() => Boolean(window.__maquete && window.__maquete.ready), null, { timeout: timeout_ms });
  await page.evaluate((ms) => Promise.race([
    Promise.resolve(window.__maquete.ready),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`window.__maquete.ready não resolveu em ${ms} ms`)), ms)),
  ]), timeout_ms);
  return { carga_ms, pronto_ms: agora() - t0 };
}

// Um quadro: setTime(t) (espera o render) e screenshot PNG do viewport inteiro.
export async function capturarQuadro(page, t) {
  const t0 = agora();
  await page.evaluate((t) => window.__maquete.setTime(t), t);
  const t1 = agora();
  const png = await page.screenshot({ type: 'png', timeout: 60000 });
  return { png, set_time_ms: t1 - t0, screenshot_ms: agora() - t1 };
}

export async function lerMetricas(page) {
  return page.evaluate(() => ({
    metrics: window.__maquete.metrics ? window.__maquete.metrics() : null,
    estado: window.__maquete.getState ? window.__maquete.getState() : null,
    duracao_s: window.__maquete.duration ? window.__maquete.duration() : null,
  }));
}

// ── comparação de quadros ──────────────────────────────────────────────────────────────────────

export function bytesDiferentes(a, b) {
  const n = Math.min(a.length, b.length);
  let d = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d;
}

export function pixelsDiferentes(a, b) {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return A.width * A.height;
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) n++;
  }
  return n;
}

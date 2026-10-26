// Rede: download com timeout, duas tentativas, erro em português e cache por hash da URL.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { agoraIso } from './terrain.mjs';

export const PACOTE = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const USER_AGENT = `maquete/${PACOTE.version} (https://github.com/victorsodre/maquete)`;
export const TIMEOUT_PADRAO_MS = 10 * 60 * 1000;
export const TENTATIVAS_PADRAO = 2;

// Verdadeiro quando o módulo é o programa principal, também quando chamado por symlink
// (o npm instala o bin como node_modules/.bin/maquete -> ../maquete/cli/index.mjs:
// process.argv[1] traz o caminho do link, import.meta.url o caminho real; comparar por path.resolve
// nunca batia e `npx maquete` saía mudo com código 0).
export function ehPrincipal(metaUrl, argv1 = process.argv[1]) {
  try {
    return Boolean(argv1) && fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

export function hashCurto(texto, n = 12) {
  return crypto.createHash('sha256').update(String(texto)).digest('hex').slice(0, n);
}

export function sha256DoArquivo(caminho) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(caminho));
  return hash.digest('hex');
}

export class ErroHttp extends Error {
  constructor(status, url, corpo = '') {
    super(`HTTP ${status} em ${url}${corpo ? `: ${corpo}` : ''}`);
    this.name = 'ErroHttp';
    this.status = status;
    this.url = url;
    this.corpo = corpo;
  }
}

function hostDe(url) {
  try { return new URL(url).host; } catch { return String(url); }
}

// Traduz o erro do fetch/undici para uma frase clara.
export function descreverErroRede(e, url) {
  const host = hostDe(url);
  const causa = e && e.cause ? e.cause : e;
  const code = causa && causa.code ? String(causa.code) : '';
  const nome = e && e.name ? e.name : '';
  if (nome === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return `tempo esgotado esperando ${host} (servidor lento ou fora do ar)`;
  }
  if (nome === 'AbortError') return `pedido a ${host} abortado (tempo esgotado)`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NONAME') return `sem rede ou DNS não resolve ${host}`;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) {
    return `${host} não respondeu (${code}): servidor fora do ar ou sem rede`;
  }
  if (code.startsWith('ERR_TLS') || code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return `problema de certificado em ${host} (${code})`;
  const msg = causa && causa.message ? causa.message : (e && e.message) || String(e);
  return `falha de rede em ${host}: ${msg}`;
}

export function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Repete fn até `tentativas` vezes; só repete em erro de rede, tempo esgotado, 429 ou 5xx (nunca em 4xx comum).
export async function tentar(fn, { tentativas = TENTATIVAS_PADRAO, esperaMs = 3000, log, rotulo } = {}) {
  let ultimo;
  for (let t = 1; t <= tentativas; t++) {
    try {
      return await fn(t);
    } catch (e) {
      ultimo = e;
      const repete = !(e instanceof ErroHttp) || e.status >= 500 || e.status === 429;
      if (!repete || t === tentativas) throw e;
      if (log) log(`  tentativa ${t}/${tentativas}${rotulo ? ` (${rotulo})` : ''} falhou: ${e.message}; de novo em ${esperaMs / 1000} s`);
      await esperar(esperaMs);
    }
  }
  throw ultimo;
}

// Baixa `url` para `destino` (gravação atômica via .part). Devolve { bytes, sha256, ms, status, contentType }.
// `validar(caminhoParcial)` pode devolver uma mensagem de erro para rejeitar o conteúdo (ex.: não é GeoTIFF).
export async function baixarParaArquivo(url, destino, { timeoutMs = TIMEOUT_PADRAO_MS, tentativas = TENTATIVAS_PADRAO, log, rotulo, validar } = {}) {
  return tentar(async () => {
    const t0 = performance.now();
    const signal = AbortSignal.timeout(timeoutMs);
    let res;
    try {
      res = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT } });
    } catch (e) {
      throw new Error(descreverErroRede(e, url));
    }
    if (!res.ok) {
      let corpo = '';
      try { corpo = (await res.text()).replace(/\s+/g, ' ').slice(0, 300); } catch { /* sem corpo */ }
      throw new ErroHttp(res.status, url, corpo);
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const parcial = `${destino}.part`;
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const contador = new Transform({
      transform(chunk, _enc, cb) { bytes += chunk.length; hash.update(chunk); cb(null, chunk); },
    });
    try {
      await pipeline(Readable.fromWeb(res.body, { signal }), contador, fs.createWriteStream(parcial));
    } catch (e) {
      try { fs.unlinkSync(parcial); } catch { /* já não existe */ }
      throw new Error(descreverErroRede(e, url));
    }
    if (validar) {
      const problema = validar(parcial);
      if (problema) {
        try { fs.unlinkSync(parcial); } catch { /* já não existe */ }
        throw new Error(problema);
      }
    }
    fs.renameSync(parcial, destino);
    return { bytes, sha256: hash.digest('hex'), ms: performance.now() - t0, status: res.status, contentType: res.headers.get('content-type') || '' };
  }, { tentativas, log, rotulo });
}

export function lerJson(caminho) {
  try { return JSON.parse(fs.readFileSync(caminho, 'utf8')); } catch { return null; }
}

export function escreverJson(caminho, obj) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, `${JSON.stringify(obj, null, 2)}\n`);
}

// Metadados de um arquivo de cache: sidecar .json ou, na falta dele, o que dá para medir do arquivo.
export function metaDoCache(caminho, url) {
  const meta = lerJson(`${caminho}.json`);
  if (meta && meta.sha256 && meta.bytes) return { ...meta, url: meta.url || url };
  const st = fs.statSync(caminho);
  return { url, bytes: st.size, sha256: sha256DoArquivo(caminho), obtido_em: agoraIso(st.mtime), content_type: '' };
}

// Baixa com cache: nome = `${prefixo}-${hash12(url)}${extensao}` em cacheDir (ou `nomeFixo`). Reaproveita se existir.
export async function obterComCache(url, cacheDir, { prefixo = 'arquivo', extensao = '', nomeFixo, forcar = false, timeoutMs, tentativas, log, rotulo, validar } = {}) {
  const nome = nomeFixo || `${prefixo}-${hashCurto(url)}${extensao}`;
  const caminho = path.join(cacheDir, nome);
  if (!forcar && fs.existsSync(caminho)) {
    return { caminho, cache: true, ...metaDoCache(caminho, url) };
  }
  const r = await baixarParaArquivo(url, caminho, { timeoutMs, tentativas, log, rotulo, validar });
  const meta = { url, bytes: r.bytes, sha256: r.sha256, obtido_em: agoraIso(), ms: Math.round(r.ms), content_type: r.contentType };
  escreverJson(`${caminho}.json`, meta);
  return { caminho, cache: false, ...meta };
}

// Roda fn sobre os itens com no máximo `n` em voo; preserva a ordem do resultado.
export async function emParalelo(itens, n, fn) {
  const saida = new Array(itens.length);
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.max(1, Math.min(n, itens.length)) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      saida[i] = await fn(itens[i], i);
    }
  });
  await Promise.all(trabalhadores);
  return saida;
}

// Copernicus DEM GLO-30: tiles COG no S3 lidos por HTTP range (geotiff fromCustomClient), overview escolhido
// pelo alvo da grade, janela recortada ao bbox e cache local por tile. Tiles fora do tileList.txt = oceano.
// Fatos medidos (SPEC): 3600x3600 por grau, 4 níveis (3600, 1800, 900, 450), oceano = 0, pixel-is-point,
// overviews sem transformação afim (usa-se o bbox da imagem 0 e a largura do overview).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fromCustomClient, BaseClient, BaseResponse } from 'geotiff';
import { COPERNICUS_NODATA, escolherOverview, misturar4, agoraIso, fmtBytes, fmtSegundos } from './terrain.mjs';
import { ErroHttp, USER_AGENT, descreverErroRede, hashCurto, obterComCache, tentar, lerJson, escreverJson, emParalelo, TIMEOUT_PADRAO_MS, TENTATIVAS_PADRAO } from './rede.mjs';

export const BUCKET = 'https://copernicus-dem-30m.s3.amazonaws.com';
export const COPERNICUS_LICENCA = 'Licence for Copernicus DEM instance COP-DEM-GLO-30-F Global 30m Full, Free & Open (ESA; texto em https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf)';
// Aviso 6(b) da licença (dado adaptado: reamostrado, fundido com o GMRT e recodificado em Terrain-RGB)
// mais a frase 6(c) de não responsabilidade; texto em dados/fontes/copernicus.md.
export const COPERNICUS_ATRIBUICAO = 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.';
export const TIMEOUT_TILE_MS = 2 * 60 * 1000;

// Nome do tile pelo canto sul-oeste: Copernicus_DSM_COG_10_S21_00_W041_00_DEM
export function nomeTile(latSW, lonSW) {
  const la = Math.floor(latSW);
  const lo = Math.floor(lonSW);
  const ns = la >= 0 ? 'N' : 'S';
  const ew = lo >= 0 ? 'E' : 'W';
  return `Copernicus_DSM_COG_10_${ns}${String(Math.abs(la)).padStart(2, '0')}_00_${ew}${String(Math.abs(lo)).padStart(3, '0')}_00_DEM`;
}

export function urlTile(nome) { return `${BUCKET}/${nome}/${nome}.tif`; }

// Todos os tiles de 1 grau que intersectam o bbox, do norte para o sul e do oeste para o leste.
export function tilesDoBbox(bbox) {
  const lat0 = Math.floor(bbox.sul);
  const lat1 = Math.ceil(bbox.norte) - 1;
  const lon0 = Math.floor(bbox.oeste);
  const lon1 = Math.ceil(bbox.leste) - 1;
  const lista = [];
  for (let la = lat1; la >= lat0; la--) {
    for (let lo = lon0; lo <= lon1; lo++) lista.push({ nome: nomeTile(la, lo), lat: la, lon: lo });
  }
  return lista;
}

export function lerTileList(texto) {
  return new Set(String(texto).split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
}

export function chaveTile(lat, lon) { return `${Math.floor(lat)},${Math.floor(lon)}`; }

// ---------------------------------------------------------------------------
// Cliente HTTP do geotiff que conta bytes, aplica timeout e traduz 404
// ---------------------------------------------------------------------------

class RespostaContada extends BaseResponse {
  constructor(res, contador) { super(); this.res = res; this.contador = contador; }
  get status() { return this.res.status; }
  getHeader(nome) { return this.res.headers.get(nome); }
  async getData() {
    const ab = await this.res.arrayBuffer();
    this.contador.bytes += ab.byteLength;
    return ab;
  }
}

export class ClienteContado extends BaseClient {
  constructor(url, contador, timeoutMs = TIMEOUT_TILE_MS) { super(url); this.contador = contador; this.timeoutMs = timeoutMs; }
  async request({ headers, signal } = {}) {
    const sinais = [AbortSignal.timeout(this.timeoutMs)];
    if (signal) sinais.push(signal);
    let res;
    try {
      res = await fetch(this.url, { headers: { ...(headers || {}), 'User-Agent': USER_AGENT }, signal: AbortSignal.any(sinais) });
    } catch (e) {
      throw new Error(descreverErroRede(e, this.url));
    }
    this.contador.pedidos++;
    if (res.status === 404) throw new ErroHttp(404, this.url, 'tile não existe no bucket');
    if (!res.ok) throw new ErroHttp(res.status, this.url, '');
    return new RespostaContada(res, this.contador);
  }
}

export function abrirTileRemoto(url, contador, timeoutMs) {
  return fromCustomClient(new ClienteContado(url, contador, timeoutMs), { blockSize: 128 * 1024, allowFullFile: false, cache: false });
}

// Estrutura do COG: dimensões da imagem 0, bbox, pixel-is-point, níveis (índice, largura, altura, graus por nó).
export async function estruturaTile(tiff) {
  const n = await tiff.getImageCount();
  const im0 = await tiff.getImage(0);
  const bb = im0.getBoundingBox();
  const W0 = im0.getWidth();
  const H0 = im0.getHeight();
  const ponto = !im0.pixelIsArea();
  const grausLon = bb[2] - bb[0];
  const grausLat = bb[3] - bb[1];
  const niveis = [];
  for (let i = 0; i < n; i++) {
    const im = await tiff.getImage(i);
    niveis.push({ indice: i, largura: im.getWidth(), altura: im.getHeight(), graus_por_no: Math.max(grausLon / im.getWidth(), grausLat / im.getHeight()) });
  }
  // pixel-is-point: o tiepoint é o centro do pixel 0, logo a área do raster começa meio pixel antes
  const deslocamento = ponto ? [grausLon / W0 / 2, grausLat / H0 / 2] : [0, 0];
  return { W0, H0, bbox0: { oeste: bb[0], sul: bb[1], leste: bb[2], norte: bb[3] }, ponto, niveis, deslocamento, grausLon, grausLat };
}

// Janela (em pixels do overview) que cobre bbox ∩ tile com 1 pixel de margem para o bilinear.
export function janelaDoTile({ tileLat, tileLon, bbox, ovW, ovH, deslocamento }) {
  const oesteArea = tileLon - deslocamento[0];
  const norteArea = tileLat + 1 + deslocamento[1];
  const gx = (lon) => (lon - oesteArea) * ovW;
  const gy = (lat) => (norteArea - lat) * ovH;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const x0 = clamp(Math.floor(gx(Math.max(bbox.oeste, tileLon))) - 1, 0, ovW);
  const x1 = clamp(Math.ceil(gx(Math.min(bbox.leste, tileLon + 1))) + 1, 0, ovW);
  const y0 = clamp(Math.floor(gy(Math.min(bbox.norte, tileLat + 1))) - 1, 0, ovH);
  const y1 = clamp(Math.ceil(gy(Math.max(bbox.sul, tileLat))) + 1, 0, ovH);
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------------------
// Mosaico: janelas de vários tiles no mesmo overview, com bilinear contínuo entre tiles
// ---------------------------------------------------------------------------

export class Mosaico {
  // ovW/ovH: tamanho do overview por tile; deslocamento: [dx, dy] em graus (meio pixel base se pixel-is-point)
  constructor({ ovW, ovH, deslocamento = [0, 0] }) {
    this.ovW = ovW;
    this.ovH = ovH;
    this.deslocamento = deslocamento;
    this.existentes = new Set();   // chaves "lat,lon" dos tiles que existem no bucket
    this.janelas = new Map();      // chave -> { x0, y0, x1, y1, largura, altura, dados }
  }

  marcarExistente(lat, lon) { this.existentes.add(chaveTile(lat, lon)); }
  existe(lon, lat) { return this.existentes.has(chaveTile(lat, lon)); }

  adicionar({ lat, lon, janela, largura, altura, dados }) {
    const [x0, y0, x1, y1] = janela;
    if (largura !== x1 - x0 || altura !== y1 - y0) throw new Error(`janela ${janela} não bate com ${largura}x${altura}`);
    this.marcarExistente(lat, lon);
    this.janelas.set(chaveTile(lat, lon), { x0, y0, x1, y1, largura, altura, dados });
  }

  // Valor do pixel global (col, row) do overview: 0 fora de tile existente (oceano), NaN fora das janelas ou nodata.
  valor(col, row) {
    const ti = Math.floor(col / this.ovW);
    const tj = Math.floor(row / this.ovH);
    const lon = ti - 180;
    const lat = 89 - tj;
    const chave = `${lat},${lon}`;
    if (!this.existentes.has(chave)) return 0;
    const j = this.janelas.get(chave);
    if (!j) return NaN;
    const i = col - ti * this.ovW;
    const r = row - tj * this.ovH;
    if (i < j.x0 || i >= j.x1 || r < j.y0 || r >= j.y1) return NaN;
    const v = j.dados[(r - j.y0) * j.largura + (i - j.x0)];
    return v <= COPERNICUS_NODATA + 1 || v !== v ? NaN : v;
  }

  // Bilinear em lon/lat (centros de pixel), contínuo entre tiles; NaN só se os 4 vizinhos faltarem.
  bilinear(lon, lat) {
    const x = (lon + 180 + this.deslocamento[0]) * this.ovW - 0.5;
    const y = (90 + this.deslocamento[1] - lat) * this.ovH - 0.5;
    const c0 = Math.floor(x);
    const r0 = Math.floor(y);
    const tx = x - c0;
    const ty = y - r0;
    return misturar4(this.valor(c0, r0), this.valor(c0 + 1, r0), this.valor(c0, r0 + 1), this.valor(c0 + 1, r0 + 1), tx, ty);
  }
}

// ---------------------------------------------------------------------------
// Leitura de um tile (com cache) e coleta de todos os tiles do bbox
// ---------------------------------------------------------------------------

function lerF32(caminho) {
  const buf = fs.readFileSync(caminho);
  const f = new Float32Array(buf.length >> 2);
  new Uint8Array(f.buffer).set(buf.subarray(0, f.length * 4));
  return f;
}

// Lê a janela do overview de um tile (ou do cache). Devolve o que o mosaico precisa mais a proveniência.
export async function lerJanelaTile({ tile, bbox, alvoGrausPorNo, cacheDir, forcar = false, timeoutMs = TIMEOUT_TILE_MS, tentativas = TENTATIVAS_PADRAO, log }) {
  const url = urlTile(tile.nome);
  // a chave só depende do tile, do alvo e do bbox: o overview sai sempre da mesma escolha, em qualquer ordem de leitura
  const chaveCache = `${url}#alvo=${alvoGrausPorNo.toFixed(9)}&bbox=${[bbox.norte, bbox.sul, bbox.oeste, bbox.leste].map((v) => Number(v).toFixed(6)).join(',')}`;
  const base = path.join(cacheDir, `copernicus-${tile.nome.replace('Copernicus_DSM_COG_10_', '').replace('_DEM', '')}-${hashCurto(chaveCache, 10)}`);
  const caminhoF32 = `${base}.f32`;
  const caminhoMeta = `${base}.json`;
  if (!forcar && fs.existsSync(caminhoF32)) {
    const meta = lerJson(caminhoMeta);
    if (meta && meta.janela && meta.overview != null) {
      const dados = lerF32(caminhoF32);
      if (dados.length === meta.largura * meta.altura) {
        return { ...meta, dados, cache: true, caminho: caminhoF32 };
      }
    }
  }
  const contador = { bytes: 0, pedidos: 0 };
  const t0 = performance.now();
  return tentar(async () => {
    contador.bytes = 0;
    contador.pedidos = 0;
    const tiff = await abrirTileRemoto(url, contador, timeoutMs);
    const est = await estruturaTile(tiff);
    const nivel = escolherOverview(est.niveis, alvoGrausPorNo);
    const ovW = nivel.largura;
    const ovH = nivel.altura;
    const janela = janelaDoTile({ tileLat: tile.lat, tileLon: tile.lon, bbox, ovW, ovH, deslocamento: est.deslocamento });
    const largura = janela[2] - janela[0];
    const altura = janela[3] - janela[1];
    if (largura <= 0 || altura <= 0) throw new Error(`janela vazia no tile ${tile.nome}: ${janela}`);
    const im = await tiff.getImage(nivel.indice);
    const raster = await im.readRasters({ window: janela });
    let dados = raster[0];
    if (!(dados instanceof Float32Array)) dados = Float32Array.from(dados);
    if (dados.length !== largura * altura) throw new Error(`tile ${tile.nome}: esperava ${largura}x${altura}, veio ${raster.width}x${raster.height}`);
    let nodata = 0;
    let terra = 0;
    for (let k = 0; k < dados.length; k++) {
      const v = dados[k];
      if (v !== v || v <= COPERNICUS_NODATA + 1) nodata++;
      else if (v > 0.5) terra++;
    }
    const buf = Buffer.from(dados.buffer, dados.byteOffset, dados.byteLength);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(`${caminhoF32}.part`, buf);
    fs.renameSync(`${caminhoF32}.part`, caminhoF32);
    const meta = {
      url, tile: tile.nome, lat: tile.lat, lon: tile.lon,
      overview: nivel.indice, overview_largura: ovW, overview_altura: ovH, graus_por_no: nivel.graus_por_no,
      janela, largura, altura, W0: est.W0, H0: est.H0, pixel_is_point: est.ponto, deslocamento: est.deslocamento,
      nodata_nos: nodata, terra_nos: terra,
      bytes: contador.bytes, pedidos: contador.pedidos, ms: Math.round(performance.now() - t0), obtido_em: agoraIso(), sha256,
    };
    escreverJson(caminhoMeta, meta);
    return { ...meta, dados, cache: false, caminho: caminhoF32 };
  }, { tentativas, log, rotulo: tile.nome });
}

// Baixa (ou reaproveita) o tileList.txt do bucket em cache/tileList.txt.
export async function obterTileList({ cacheDir, forcar = false, timeoutMs = TIMEOUT_PADRAO_MS, tentativas = TENTATIVAS_PADRAO, log }) {
  const r = await obterComCache(`${BUCKET}/tileList.txt`, cacheDir, {
    nomeFixo: 'tileList.txt', forcar, timeoutMs, tentativas, log, rotulo: 'tileList.txt',
    validar: (p) => (fs.statSync(p).size < 1000 || !fs.readFileSync(p, 'utf8').includes('Copernicus_DSM_COG_10_') ? 'tileList.txt veio vazio ou estranho' : null),
  });
  const conjunto = lerTileList(fs.readFileSync(r.caminho, 'utf8'));
  return { ...r, conjunto };
}

// Coleta todos os tiles Copernicus que intersectam o bbox e monta o mosaico. Devolve { mosaico, fonte, resumo }.
export async function coletarCopernicus({ bbox, alvoGrausPorNo, cacheDir, forcar = false, paralelo = 3, timeoutMs = TIMEOUT_TILE_MS, tentativas = TENTATIVAS_PADRAO, log = () => {} }) {
  const t0 = performance.now();
  const lista = await obterTileList({ cacheDir, forcar, tentativas, log });
  log(`Copernicus: tileList.txt com ${lista.conjunto.size} tiles (${fmtBytes(lista.bytes)}${lista.cache ? ', cache' : `, ${fmtSegundos(lista.ms || 0)}`})`);
  const candidatos = tilesDoBbox(bbox);
  const existentes = candidatos.filter((t) => lista.conjunto.has(t.nome));
  const ausentes = candidatos.filter((t) => !lista.conjunto.has(t.nome)).map((t) => t.nome);
  log(`Copernicus: ${candidatos.length} tiles no bbox, ${existentes.length} existem (${ausentes.length} só oceano)`);

  let feitos = 0;
  let bytes = 0;
  let pedidos = 0;
  const falhas404 = [];
  const leituras = await emParalelo(existentes, paralelo, async (tile) => {
    let r;
    try {
      r = await lerJanelaTile({ tile, bbox, alvoGrausPorNo, cacheDir, forcar, timeoutMs, tentativas, log });
    } catch (e) {
      if (e instanceof ErroHttp && e.status === 404) {
        falhas404.push(tile.nome);
        log(`  tile ${tile.nome}: 404 no bucket apesar do tileList; tratado como oceano`);
        return null;
      }
      throw new Error(`tile ${tile.nome}: ${e.message}`);
    }
    feitos++;
    if (!r.cache) { bytes += r.bytes || 0; pedidos += r.pedidos || 0; }
    log(`  tile ${feitos}/${existentes.length} ${tile.nome}: overview ${r.overview} (${r.overview_largura}x${r.overview_altura}), janela ${r.largura}x${r.altura}, ${r.cache ? 'cache' : `${fmtBytes(r.bytes)} em ${r.pedidos} pedidos, ${fmtSegundos(r.ms)}`}`);
    return r;
  });

  const lidos = leituras.filter(Boolean);
  if (existentes.length && !lidos.length) throw new Error('Copernicus: nenhum tile pôde ser lido');
  const primeiro = lidos[0];
  const mosaico = new Mosaico(primeiro
    ? { ovW: primeiro.overview_largura, ovH: primeiro.overview_altura, deslocamento: primeiro.deslocamento }
    : { ovW: 450, ovH: 450, deslocamento: [0, 0] });
  for (const r of lidos) {
    if (r.overview_largura !== mosaico.ovW || r.overview_altura !== mosaico.ovH) {
      throw new Error(`tile ${r.tile}: overview ${r.overview_largura}x${r.overview_altura} diferente dos outros (${mosaico.ovW}x${mosaico.ovH}); a v1 só funde tiles do mesmo tamanho`);
    }
    mosaico.adicionar({ lat: r.lat, lon: r.lon, janela: r.janela, largura: r.largura, altura: r.altura, dados: r.dados });
  }
  const hash = crypto.createHash('sha256');
  const ordenados = [...lidos].sort((a, b) => a.tile.localeCompare(b.tile));
  for (const r of ordenados) hash.update(Buffer.from(r.dados.buffer, r.dados.byteOffset, r.dados.byteLength));
  const obtidoEm = ordenados.map((r) => r.obtido_em).sort().pop() || agoraIso();
  const bytesCache = ordenados.reduce((s, r) => s + (r.bytes || 0), 0);
  const fonte = {
    id: 'copernicus-glo30',
    url: BUCKET,
    tiles: ordenados.map((r) => r.tile),
    tiles_oceano: [...ausentes, ...falhas404].sort(),
    overview: primeiro ? primeiro.overview : null,
    overview_nos: primeiro ? primeiro.overview_largura : null,
    graus_por_no: primeiro ? primeiro.graus_por_no : null,
    licenca: COPERNICUS_LICENCA,
    atribuicao: COPERNICUS_ATRIBUICAO,
    obtido_em: obtidoEm,
    bytes: bytesCache,
    sha256: hash.digest('hex'),
    detalhe: ordenados.map((r) => ({ tile: r.tile, janela: r.janela, bytes: r.bytes, pedidos: r.pedidos, sha256: r.sha256, obtido_em: r.obtido_em, cache: r.cache, nodata_nos: r.nodata_nos })),
  };
  const resumo = { tiles_lidos: lidos.length, tiles_cache: lidos.filter((r) => r.cache).length, bytes_baixados: bytes, pedidos, ms: performance.now() - t0, tiles_oceano: ausentes.length + falhas404.length };
  return { mosaico, fonte, resumo };
}

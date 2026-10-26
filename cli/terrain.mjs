// Grade comum, fusão terra/mar, Terrain-RGB, preenchimento de buracos e terreno.json.
// Só funções puras e leitura/gravação local: nada de rede aqui (os testes rodam offline).
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

export const KM_POR_GRAU = 111.32;          // mesma aproximação esférica da cena (SPEC)
export const COPERNICUS_NODATA = -32767;    // valor de vazio do Copernicus GLO-30
export const TERRAIN_RGB_BASE = -10000;
export const TERRAIN_RGB_PASSO = 0.1;

// ---------------------------------------------------------------------------
// bbox e grade de saída
// ---------------------------------------------------------------------------

export function validarBbox(bbox) {
  if (!bbox || typeof bbox !== 'object') throw new Error('bbox ausente: esperado { norte, sul, oeste, leste } em graus');
  const { norte, sul, oeste, leste } = bbox;
  for (const [nome, v] of Object.entries({ norte, sul, oeste, leste })) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`bbox inválido: "${nome}" precisa ser um número em graus (veio ${JSON.stringify(v)})`);
  }
  if (norte > 90 || sul < -90) throw new Error(`bbox inválido: latitude fora de -90..90 (norte ${norte}, sul ${sul})`);
  if (oeste < -180 || leste > 180) throw new Error(`bbox inválido: longitude fora de -180..180 (oeste ${oeste}, leste ${leste})`);
  if (!(norte > sul)) throw new Error(`bbox inválido: norte (${norte}) tem de ser maior que sul (${sul})`);
  if (!(leste > oeste)) throw new Error(`bbox inválido: leste (${leste}) tem de ser maior que oeste (${oeste}); a v1 não cruza o antimeridiano`);
  return bbox;
}

export function kmDoBbox(bbox) {
  const latC = (bbox.norte + bbox.sul) / 2;
  const largura = (bbox.leste - bbox.oeste) * KM_POR_GRAU * Math.cos(latC * Math.PI / 180);
  const altura = (bbox.norte - bbox.sul) * KM_POR_GRAU;
  return { largura, altura, lat_centro: latC };
}

// Teto da grade de saída: a altura sai da proporção do bbox e, sem teto, uma caixa alta e estreita
// (um erro de digitação no --bbox basta) virava centenas de milhões de nós e um pedido de gigabytes
// ao GridServer. Acima de ALTURA_MAX_NOS a largura é reduzida na mesma proporção.
export const ALTURA_MAX_NOS = 4096;
export const KM_MIN_CAIXA = 1;

// Largura = largura_max_nos; altura pela proporção do bbox em km (no centro do bbox).
// Os nós são centros de célula: nó (i, j) fica em lon = oeste + (i + 0,5) * dlon, lat = norte - (j + 0,5) * dlat.
export function calcularGrade(bbox, larguraMax) {
  validarBbox(bbox);
  let largura = Math.floor(Number(larguraMax));
  if (!Number.isFinite(largura) || largura < 2) throw new Error(`largura inválida: ${larguraMax} (mínimo 2 nós)`);
  const km = kmDoBbox(bbox);
  if (!(km.largura > 0)) throw new Error('bbox inválido: largura em km deu zero (bbox no polo?)');
  if (km.largura < KM_MIN_CAIXA || km.altura < KM_MIN_CAIXA) throw new Error(`bbox inválido: caixa de ${km.largura.toFixed(3)} x ${km.altura.toFixed(3)} km; o mínimo é ${KM_MIN_CAIXA} km em cada eixo`);
  let altura = Math.max(2, Math.round(largura * km.altura / km.largura));
  if (altura > ALTURA_MAX_NOS) {
    largura = Math.max(2, Math.floor(largura * ALTURA_MAX_NOS / altura));
    altura = Math.max(2, Math.min(ALTURA_MAX_NOS, Math.round(largura * km.altura / km.largura)));
  }
  const dLon = (bbox.leste - bbox.oeste) / largura;
  const dLat = (bbox.norte - bbox.sul) / altura;
  return {
    largura,
    altura,
    graus_por_no: { lon: dLon, lat: dLat },
    metros_por_no: { x: km.largura * 1000 / largura, y: km.altura * 1000 / altura },
    km: { largura: km.largura, altura: km.altura },
    lat_centro: km.lat_centro,
  };
}

export function lonDoNo(bbox, grade, i) { return bbox.oeste + (i + 0.5) * grade.graus_por_no.lon; }
export function latDoNo(bbox, grade, j) { return bbox.norte - (j + 0.5) * grade.graus_por_no.lat; }

// ---------------------------------------------------------------------------
// Terrain-RGB (codificação Mapbox): h = -10000 + (R*65536 + G*256 + B) * 0,1
// ---------------------------------------------------------------------------

export function codificarAltura(h) {
  let v = Math.round((h - TERRAIN_RGB_BASE) / TERRAIN_RGB_PASSO);
  if (v < 0) v = 0; else if (v > 0xffffff) v = 0xffffff;
  return v;
}

export function decodificarAltura(r, g, b) {
  return TERRAIN_RGB_BASE + (r * 65536 + g * 256 + b) * TERRAIN_RGB_PASSO;
}

// Limites do Terrain-RGB: abaixo de -10.000 m e acima de 1.667.721,5 m o valor prende (clamp silencioso).
export const TERRAIN_RGB_MIN_M = TERRAIN_RGB_BASE;
export const TERRAIN_RGB_MAX_M = TERRAIN_RGB_BASE + 0xffffff * TERRAIN_RGB_PASSO;

// Float32Array (linha 0 = norte, coluna 0 = oeste) -> Buffer RGB sem alpha, 3 bytes por nó.
// `clampados` (opcional): objeto onde entram as contagens { abaixo, acima } dos nós presos no limite.
export function codificarTerrainRgb(alturas, largura, altura, clampados = null) {
  const n = largura * altura;
  if (alturas.length !== n) throw new Error(`codificarTerrainRgb: ${alturas.length} valores para uma grade ${largura}x${altura}`);
  const rgb = Buffer.alloc(n * 3);
  let abaixo = 0, acima = 0;
  for (let k = 0; k < n; k++) {
    const h = alturas[k];
    if (h !== h) throw new Error(`codificarTerrainRgb: NaN no nó ${k}; preencha os buracos antes de codificar`);
    if (h < TERRAIN_RGB_MIN_M - TERRAIN_RGB_PASSO / 2) abaixo++;
    else if (h > TERRAIN_RGB_MAX_M + TERRAIN_RGB_PASSO / 2) acima++;
    const v = codificarAltura(h);
    rgb[k * 3] = (v >>> 16) & 255;
    rgb[k * 3 + 1] = (v >>> 8) & 255;
    rgb[k * 3 + 2] = v & 255;
  }
  if (clampados) { clampados.abaixo = abaixo; clampados.acima = acima; }
  return rgb;
}

export function escreverTerrenoPng(caminho, alturas, largura, altura, clampados = null) {
  const rgb = codificarTerrainRgb(alturas, largura, altura, clampados);
  const png = PNG.sync.write({ width: largura, height: altura, data: rgb }, { colorType: 2, inputColorType: 2, inputHasAlpha: false, deflateLevel: 9 });
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, png);
  return png.length;
}

// Lê um terreno.png de volta: { largura, altura, alturas: Float32Array }.
export function lerTerrenoPng(caminhoOuBuffer) {
  const buf = Buffer.isBuffer(caminhoOuBuffer) ? caminhoOuBuffer : fs.readFileSync(caminhoOuBuffer);
  const png = PNG.sync.read(buf);
  const n = png.width * png.height;
  const alturas = new Float32Array(n);
  for (let k = 0; k < n; k++) alturas[k] = decodificarAltura(png.data[k * 4], png.data[k * 4 + 1], png.data[k * 4 + 2]);
  return { largura: png.width, altura: png.height, alturas, colorType: png.colorType };
}

// ---------------------------------------------------------------------------
// Amostragem
// ---------------------------------------------------------------------------

// Bilinear que ignora NaN: (px, py) em pixels contínuos da fonte, com o centro do pixel i em i + 0,5.
// Fora da fonte, prende na borda. Se os 4 vizinhos forem NaN, devolve NaN.
export function amostrarBilinear(dados, w, h, px, py) {
  let x = px - 0.5, y = py - 0.5;
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const tx = x - x0, ty = y - y0;
  return misturar4(dados[y0 * w + x0], dados[y0 * w + x1], dados[y1 * w + x0], dados[y1 * w + x1], tx, ty);
}

export function misturar4(v00, v10, v01, v11, tx, ty) {
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  let soma = 0, peso = 0;
  if (v00 === v00) { soma += v00 * w00; peso += w00; }
  if (v10 === v10) { soma += v10 * w10; peso += w10; }
  if (v01 === v01) { soma += v01 * w01; peso += w01; }
  if (v11 === v11) { soma += v11 * w11; peso += w11; }
  return peso > 0 ? soma / peso : NaN;
}

// Vizinho mais próximo (para a máscara): mesmo sistema de coordenadas do bilinear.
export function amostrarVizinho(dados, w, h, px, py) {
  let x = Math.floor(px), y = Math.floor(py);
  if (x < 0) x = 0; else if (x >= w) x = w - 1;
  if (y < 0) y = 0; else if (y >= h) y = h - 1;
  return dados[y * w + x];
}

// Reamostra um raster geográfico regular (pixel-is-area: origem = canto NO do pixel 0) para a grade de saída.
// fonte: { dados, largura, altura, origem: [lon, lat], res: [dlon, dlat] } com dlat negativo (linhas descem).
export function reamostrarParaGrade(fonte, bbox, grade, metodo = 'bilinear') {
  const { dados, largura: w, altura: h, origem, res } = fonte;
  const saida = new Float32Array(grade.largura * grade.altura);
  const rx = res[0], ry = Math.abs(res[1]);
  const amostra = metodo === 'vizinho' ? amostrarVizinho : amostrarBilinear;
  for (let j = 0; j < grade.altura; j++) {
    const lat = latDoNo(bbox, grade, j);
    const py = (origem[1] - lat) / ry;
    for (let i = 0; i < grade.largura; i++) {
      const lon = lonDoNo(bbox, grade, i);
      const px = (lon - origem[0]) / rx;
      saida[j * grade.largura + i] = amostra(dados, w, h, px, py);
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Fusão terra/mar
// ---------------------------------------------------------------------------

// Regra do SPEC: Copernicus > 0,5 m vence; senão min(gmrt, 0); se o tile não existe, gmrt.
// Copernicus NaN (nodata) dentro de tile existente: vale o GMRT (melhor que vizinho mais próximo).
export function fundirNo(cop, gmrt, tileExiste) {
  if (!tileExiste) return gmrt;
  if (cop !== cop) return gmrt;
  if (cop > 0.5) return cop;
  if (gmrt !== gmrt) return gmrt;
  return gmrt < 0 ? gmrt : 0;
}

// Aplica a regra em toda a grade. existe: Uint8Array (1 = o tile Copernicus do nó existe) ou null (sem Copernicus).
export function fundirGrade(cop, gmrt, existe) {
  const n = gmrt.length;
  const saida = new Float32Array(n);
  let copNodata = 0, nosCop = 0;
  for (let k = 0; k < n; k++) {
    if (!existe || !existe[k] || !cop) { saida[k] = gmrt[k]; continue; }
    const c = cop[k];
    if (c !== c) copNodata++;
    else if (c > 0.5) nosCop++;
    saida[k] = fundirNo(c, gmrt[k], true);
  }
  return { alturas: saida, copernicus_nodata: copNodata, nos_copernicus: nosCop };
}

// ---------------------------------------------------------------------------
// Preenchimento de NaN pelo vizinho válido mais próximo (BFS de várias fontes, 8 vizinhos)
// ---------------------------------------------------------------------------

export function preencherNaN(a, w, h) {
  const n = w * h;
  const fila = new Int32Array(n);
  let ini = 0, fim = 0, buracos = 0;
  for (let k = 0; k < n; k++) {
    if (a[k] === a[k]) fila[fim++] = k; else buracos++;
  }
  if (buracos === 0) return 0;
  if (fim === 0) throw new Error('grade sem nenhum valor válido: nada para preencher os buracos');
  let preenchidos = 0;
  while (ini < fim) {
    const p = fila[ini++];
    const x = p % w, y = (p - x) / w;
    const v = a[p];
    const y0 = y > 0 ? y - 1 : y, y1 = y < h - 1 ? y + 1 : y;
    const x0 = x > 0 ? x - 1 : x, x1 = x < w - 1 ? x + 1 : x;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const q = yy * w + xx;
        if (a[q] !== a[q]) { a[q] = v; fila[fim++] = q; preenchidos++; }
      }
    }
  }
  return preenchidos;
}

export function minMax(a) {
  let mn = Infinity, mx = -Infinity;
  for (let k = 0; k < a.length; k++) { const v = a[k]; if (v === v) { if (v < mn) mn = v; if (v > mx) mx = v; } }
  return { min: mn, max: mx };
}

// ---------------------------------------------------------------------------
// Escolha do overview Copernicus
// ---------------------------------------------------------------------------

// niveis: [{ indice, largura, altura }] da imagem 0 em diante, com graus por nó = grausTile / largura.
// Devolve o nível cujo m/nó é o mais próximo do alvo sem ser mais grosseiro; se todos forem mais grosseiros, o mais fino.
export function escolherOverview(niveis, alvoGrausPorNo) {
  if (!niveis.length) throw new Error('escolherOverview: tile sem níveis');
  let melhor = null;
  for (const nv of niveis) {
    const gpn = nv.graus_por_no;
    if (gpn <= alvoGrausPorNo * (1 + 1e-9) && (!melhor || gpn > melhor.graus_por_no)) melhor = nv;
  }
  if (!melhor) melhor = niveis.reduce((a, b) => (a.graus_por_no <= b.graus_por_no ? a : b));
  return melhor;
}

// ---------------------------------------------------------------------------
// Utilidades de formatação (log em português)
// ---------------------------------------------------------------------------

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} kB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2).replace('.', ',')} GB`;
}

export function fmtSegundos(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

export function fmtNum(x, casas = 1) {
  return Number(x).toFixed(casas).replace('.', ',');
}

// ISO 8601 com o fuso local (2026-10-13T21:40:00-03:00).
export function agoraIso(data = new Date()) {
  const p = (n, c = 2) => String(n).padStart(c, '0');
  const off = -data.getTimezoneOffset();
  const sinal = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}T${p(data.getHours())}:${p(data.getMinutes())}:${p(data.getSeconds())}${sinal}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

export function arredondar(x, casas = 1) {
  const f = 10 ** casas;
  return Math.round(x * f) / f;
}

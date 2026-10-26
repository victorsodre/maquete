// GMRT GridServer: GeoTIFF por bbox (layer topo e topo-mask), com cache por hash da URL.
// Fatos medidos (SPEC): Float32, inclui terra, NaN esparsos; topo-mask: NaN = interpolado, valor = medido.
import fs from 'node:fs';
import { fromFile } from 'geotiff';
import { kmDoBbox, validarBbox } from './terrain.mjs';
import { obterComCache } from './rede.mjs';

export const GRIDSERVER = 'https://www.gmrt.org/services/GridServer';
export const GMRT_LICENCA = 'CC BY 4.0';
export const GMRT_ATRIBUICAO = 'Ryan, W. B. F., S.M. Carbotte, J. Coplan, S. O\'Hara, A. Melkonian, R. Arko, R.A. Weissel, V. Ferrini, A. Goodwillie, F. Nitsche, J. Bonczkowski, and R. Zemsky (2009), Global Multi-Resolution Topography (GMRT) synthesis data set, Geochem. Geophys. Geosyst., 10, Q03014, doi:10.1029/2008GC002332';

// Grau em decimal fixo, sem notação científica (|v| < 1e-6 sairia como "1e-7" na URL) e sem zeros
// à direita: -41 fica "-41" e -19.5 fica "-19.5", iguais às URLs já gravadas (o cache é por hash da URL).
export function grauNaUrl(v) {
  return Number(v).toFixed(6).replace(/\.?0+$/, '').replace(/^-0$/, '0');
}

// Chamada exata ao GridServer (a URL vai inteira para o terreno.json).
export function urlGridServer({ bbox, layer = 'topo', mresolution = null }) {
  validarBbox(bbox);
  if (!['topo', 'topo-mask'].includes(layer)) throw new Error(`layer do GMRT desconhecido: ${layer} (use topo ou topo-mask)`);
  let url = `${GRIDSERVER}?north=${grauNaUrl(bbox.norte)}&south=${grauNaUrl(bbox.sul)}&west=${grauNaUrl(bbox.oeste)}&east=${grauNaUrl(bbox.leste)}&layer=${layer}&format=geotiff`;
  if (mresolution != null) {
    const m = Math.round(Number(mresolution));
    if (!Number.isFinite(m) || m < 1) throw new Error(`mresolution inválido: ${mresolution} (metros por nó, inteiro positivo)`);
    url += `&mresolution=${m}`;
  }
  return url;
}

// Default do SPEC: largura do bbox em metros / largura_max_nos.
export function mresolutionPadrao(bbox, larguraNos) {
  const km = kmDoBbox(bbox);
  return Math.max(1, Math.round(km.largura * 1000 / larguraNos));
}

// Tamanho estimado do GeoTIFF que o GridServer devolveria (Float32, sem compressão): a CLI recusa
// acima de GMRT_BYTES_MAX antes de pedir, para um --mresolution pequeno numa caixa grande não virar
// um download de gigabytes (o servidor aceita até 2 GB por pedido).
export const GMRT_BYTES_MAX = 200 * 1024 * 1024;
export function estimarBytesGmrt(bbox, mresolution) {
  const km = kmDoBbox(bbox);
  const m = Math.max(1, Number(mresolution));
  return Math.round((km.largura * 1000 / m) * (km.altura * 1000 / m) * 4);
}

// Rejeita o que não começa com a assinatura TIFF (o GridServer responde texto quando erra).
export function validarGeoTiff(caminho) {
  const st = fs.statSync(caminho);
  if (st.size < 8) return `GridServer devolveu um arquivo vazio (${st.size} bytes)`;
  const fd = fs.openSync(caminho, 'r');
  const b = Buffer.alloc(4);
  fs.readSync(fd, b, 0, 4, 0);
  fs.closeSync(fd);
  const ii = b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0;
  const mm = b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42;
  if (ii || mm) return null;
  const texto = fs.readFileSync(caminho, { encoding: 'latin1' }).slice(0, 200).replace(/\s+/g, ' ').trim();
  return `GridServer não devolveu GeoTIFF (${st.size} bytes): "${texto}"`;
}

// Baixa (ou reaproveita do cache) o GeoTIFF do GridServer. Devolve { url, caminho, cache, bytes, sha256, obtido_em }.
export async function baixarGmrt({ bbox, layer = 'topo', mresolution = null, cacheDir, forcar = false, timeoutMs, tentativas, log }) {
  const url = urlGridServer({ bbox, layer, mresolution });
  const r = await obterComCache(url, cacheDir, {
    prefixo: `gmrt-${layer}`, extensao: '.tif', forcar, timeoutMs, tentativas, log, rotulo: `GMRT ${layer}`, validar: validarGeoTiff,
  });
  return { url, layer, ...r };
}

// Lê um GeoTIFF local inteiro (imagem 0) como Float32 com NaN no nodata.
// Devolve a origem já na convenção de área (canto NO do pixel 0), mesmo se o arquivo for pixel-is-point.
export async function lerGeoTiffLocal(caminho) {
  const tiff = await fromFile(caminho);
  try {
    const im = await tiff.getImage(0);
    const largura = im.getWidth();
    const altura = im.getHeight();
    const origem = im.getOrigin();
    const res = im.getResolution();
    const nodata = im.getGDALNoData();
    const raster = await im.readRasters();
    let dados = raster[0];
    if (!(dados instanceof Float32Array)) dados = Float32Array.from(dados);
    let nan = 0;
    for (let k = 0; k < dados.length; k++) {
      if (nodata !== null && dados[k] === nodata) dados[k] = NaN;
      if (dados[k] !== dados[k]) nan++;
    }
    const area = im.pixelIsArea();
    const origemArea = area ? [origem[0], origem[1]] : [origem[0] - res[0] / 2, origem[1] - res[1] / 2];
    return {
      dados, largura, altura, nan, nodata,
      origem: origemArea,
      res: [res[0], res[1]],
      bbox: { oeste: origemArea[0], norte: origemArea[1], leste: origemArea[0] + res[0] * largura, sul: origemArea[1] + res[1] * altura },
      pixelIsArea: area,
      geokeys: im.getGeoKeys(),
    };
  } finally {
    await tiff.close();
  }
}

// Metros por nó do raster devolvido (no centro do bbox).
export function metrosPorNoDoRaster(raster) {
  const latC = (raster.bbox.norte + raster.bbox.sul) / 2;
  return {
    x: Math.abs(raster.res[0]) * 111320 * Math.cos(latC * Math.PI / 180),
    y: Math.abs(raster.res[1]) * 111320,
  };
}

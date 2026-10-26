#!/usr/bin/env node
// Confere um terreno.png contra o GeoTIFF do GMRT que está no cache, em 20 pontos fixos (seed fixa).
// Uso: node cli/conferir.mjs <slug> [--pontos 20] [--seed 20261013] [--saida <pasta>]
// Nos nós de mar (h <= 0) o PNG tem de bater com min(gmrt, 0) até 0,05 m (meio passo do Terrain-RGB);
// nos nós de terra com Copernicus a diferença é esperada e é só mostrada.
import fs from 'node:fs';
import path from 'node:path';
import { lerTerrenoPng, calcularGrade, lonDoNo, latDoNo, amostrarBilinear, fmtNum } from './terrain.mjs';
import { lerGeoTiffLocal } from './gmrt.mjs';
import { hashCurto, ehPrincipal } from './rede.mjs';
import { raizDosLugares } from './index.mjs';

// PRNG determinístico (mulberry32), só para escolher os pontos de conferência.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function conferir({ slug, pontos = 20, seed = 20261013, saida, log = console.log }) {
  const raiz = raizDosLugares(process.cwd(), slug);
  const pasta = path.join(raiz, 'lugares', slug);
  const dir = saida ? path.resolve(saida) : pasta;
  const terreno = JSON.parse(fs.readFileSync(path.join(dir, 'terreno.json'), 'utf8'));
  const png = lerTerrenoPng(path.join(dir, 'terreno.png'));
  if (png.largura !== terreno.largura || png.altura !== terreno.altura) throw new Error(`PNG ${png.largura}x${png.altura} não bate com terreno.json ${terreno.largura}x${terreno.altura}`);
  if (png.colorType !== 2) throw new Error(`PNG com colorType ${png.colorType}; esperado 2 (RGB sem alpha)`);
  const fonteGmrt = terreno.fontes.find((f) => f.id === 'gmrt');
  if (!fonteGmrt) throw new Error('terreno.json sem fonte gmrt');
  const caminhoTif = path.join(pasta, 'cache', `gmrt-topo-${hashCurto(fonteGmrt.url)}.tif`);
  if (!fs.existsSync(caminhoTif)) throw new Error(`GeoTIFF do GMRT não está no cache: ${caminhoTif}`);
  const gmrt = await lerGeoTiffLocal(caminhoTif);
  const grade = calcularGrade(terreno.bbox, terreno.largura);
  if (grade.altura !== terreno.altura) throw new Error(`altura recalculada ${grade.altura} difere de ${terreno.altura}`);
  const rnd = mulberry32(seed);
  const linhas = [];
  let okMar = 0, mar = 0, terra = 0, maxDifMar = 0;
  for (let p = 0; p < pontos; p++) {
    const i = Math.floor(rnd() * grade.largura);
    const j = Math.floor(rnd() * grade.altura);
    const lon = lonDoNo(terreno.bbox, grade, i);
    const lat = latDoNo(terreno.bbox, grade, j);
    const hPng = png.alturas[j * grade.largura + i];
    const px = (lon - gmrt.origem[0]) / gmrt.res[0];
    const py = (gmrt.origem[1] - lat) / Math.abs(gmrt.res[1]);
    const hGmrt = amostrarBilinear(gmrt.dados, gmrt.largura, gmrt.altura, px, py);
    const esperadoMar = hGmrt === hGmrt ? Math.min(hGmrt, 0) : NaN;
    const dif = hPng - (terreno.terra === 'gmrt' ? hGmrt : esperadoMar);
    let veredito;
    if (hPng > 0 && terreno.terra !== 'gmrt') { terra++; veredito = 'terra (Copernicus; GMRT só de referência)'; }
    else if (hGmrt !== hGmrt) { veredito = 'GMRT NaN aqui (nó preenchido pelo vizinho)'; }
    else { mar++; const d = Math.abs(dif); maxDifMar = Math.max(maxDifMar, d); if (d <= 0.05 + 1e-6) { okMar++; veredito = 'ok'; } else { veredito = `DIFERENÇA ${fmtNum(d, 2)} m`; } }
    linhas.push(`${String(p + 1).padStart(2)}  col ${String(i).padStart(4)} lin ${String(j).padStart(4)}  lon ${fmtNum(lon, 4)} lat ${fmtNum(lat, 4)}  png ${fmtNum(hPng, 1).padStart(8)} m  gmrt ${fmtNum(hGmrt, 1).padStart(8)} m  ${veredito}`);
  }
  for (const l of linhas) log(l);
  log(`resumo: ${okMar}/${mar} nós de mar/gmrt batem até 0,05 m (maior diferença ${fmtNum(maxDifMar, 3)} m); ${terra} nós de terra do Copernicus; PNG ${png.largura}x${png.altura}, colorType ${png.colorType}`);
  return { okMar, mar, terra, maxDifMar, linhas };
}

if (ehPrincipal(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (nome, def) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : def; };
  const slug = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
  if (!slug) { console.error('uso: node cli/conferir.mjs <slug> [--pontos 20] [--seed 20261013] [--saida <pasta>]'); process.exitCode = 2; }
  else {
    conferir({ slug, pontos: Number(opt('--pontos', 20)), seed: Number(opt('--seed', 20261013)), saida: opt('--saida') })
      .then((r) => { process.exitCode = r.okMar === r.mar ? 0 : 1; })
      .catch((e) => { console.error(`erro: ${e.message}`); process.exitCode = 1; });
  }
}

#!/usr/bin/env node
// npx maquete <slug> [opções]
// Lê lugares/<slug>/lugar.json, baixa GMRT (mar e, se pedido, terra) e Copernicus GLO-30 (terra),
// funde na grade de saída e grava terreno.png (Terrain-RGB) e terreno.json (proveniência).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validarBbox, calcularGrade, kmDoBbox, reamostrarParaGrade, fundirGrade, preencherNaN, minMax, escreverTerrenoPng,
  lonDoNo, latDoNo, fmtBytes, fmtSegundos, fmtNum, agoraIso, arredondar,
} from './terrain.mjs';
import { baixarGmrt, lerGeoTiffLocal, mresolutionPadrao, metrosPorNoDoRaster, estimarBytesGmrt, GMRT_BYTES_MAX, GMRT_LICENCA, GMRT_ATRIBUICAO } from './gmrt.mjs';
import { coletarCopernicus } from './copernicus.mjs';
import { PACOTE, escreverJson, TIMEOUT_PADRAO_MS, ehPrincipal } from './rede.mjs';

const RAIZ_PACOTE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const AJUDA = `maquete ${PACOTE.version}: baixa o relevo (Copernicus na terra, GMRT no mar) e grava terreno.png + terreno.json

Uso:
  npx maquete <slug> [opções]
  npx maquete --bbox N,S,O,L --slug <slug> --nome "Nome do lugar" [opções]

Opções:
  --largura N       largura da grade em nós (padrão: largura_max_nos do lugar.json, 2048)
  --so-gmrt         ignora o Copernicus e usa só o GMRT (terra mais grosseira)
  --sem-mascara     não baixa a camada topo-mask (fração medida fica nula)
  --mresolution N   metros por nó pedidos ao GridServer (padrão: largura do bbox em m / largura)
  --saida <pasta>   onde gravar terreno.png e terreno.json (padrão: lugares/<slug>)
  --forcar          ignora o cache e baixa tudo de novo
  --silencioso      só erros
  --timeout <min>   tempo máximo por download (padrão 10 min)
  --ajuda, -h       esta ajuda

Os lugares ficam em ./lugares/<slug>/ (pasta atual). Com --bbox, a CLI cria ./lugares/<slug>/lugar.json
e grava nele as opções da criação (--largura, --mresolution, --so-gmrt, --sem-mascara), para as rodadas
seguintes refazerem a mesma grade sem repetir as opções. Cache: lugares/<slug>/cache/ (gitignored).`;

export function parseArgs(argv) {
  const o = { _: [], forcar: false, silencioso: false, soGmrt: false, semMascara: false, ajuda: false };
  const pegaValor = (i, nome) => {
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new Error(`opção ${nome} precisa de um valor`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--largura': o.largura = Number(pegaValor(i, a)); i++; break;
      case '--so-gmrt': o.soGmrt = true; break;
      case '--sem-mascara': o.semMascara = true; break;
      case '--mresolution': o.mresolution = Number(pegaValor(i, a)); i++; break;
      case '--saida': o.saida = pegaValor(i, a); i++; break;
      case '--forcar': o.forcar = true; break;
      case '--silencioso': o.silencioso = true; break;
      case '--timeout': o.timeoutMin = Number(pegaValor(i, a)); i++; break;
      case '--bbox': o.bbox = pegaValor(i, a); i++; break;
      case '--slug': o.slug = pegaValor(i, a); i++; break;
      case '--nome': o.nome = pegaValor(i, a); i++; break;
      case '--ajuda': case '-h': case '--help': o.ajuda = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`opção desconhecida: ${a} (veja --ajuda)`);
        o._.push(a);
    }
  }
  if (o.largura !== undefined && (!Number.isInteger(o.largura) || o.largura < 2)) throw new Error(`--largura precisa ser inteiro >= 2 (veio ${o.largura})`);
  if (o.mresolution !== undefined && (!Number.isFinite(o.mresolution) || o.mresolution < 1)) throw new Error(`--mresolution precisa ser número >= 1 (veio ${o.mresolution})`);
  if (o.timeoutMin !== undefined && (!Number.isFinite(o.timeoutMin) || o.timeoutMin <= 0)) throw new Error(`--timeout em minutos, > 0 (veio ${o.timeoutMin})`);
  return o;
}

export function parseBboxTexto(texto) {
  const partes = String(texto).split(',').map((s) => Number(s.trim()));
  if (partes.length !== 4 || partes.some((v) => !Number.isFinite(v))) throw new Error(`--bbox precisa de 4 números N,S,O,L em graus (veio "${texto}")`);
  const [norte, sul, oeste, leste] = partes;
  return validarBbox({ norte, sul, oeste, leste });
}

// Exagero vertical sugerido pela largura da caixa: 15x numa caixa de 500 km ou mais (a 002 tem
// 1.300 km), 5x em ~100 km, 2x em 30 km ou menos. Numa caixa de 20 km, morros de 300 m a 15x
// viram espigões de 4,5 km e a trilha padrão voa entre eles.
export function exageroSugerido(kmLargura) {
  const km = Number(kmLargura);
  if (!Number.isFinite(km) || km >= 500) return 15;
  if (km >= 100) return Math.round(5 + (km - 100) / 400 * 10);
  if (km >= 30) return Math.round(2 + (km - 30) / 70 * 3);
  return 2;
}

// lugar.json com os defaults do SPEC; as opções da criação (largura, mresolution, terra, máscara)
// ficam gravadas, senão a rodada seguinte refaz tudo em 2048 nós e baixa de novo.
export function lugarPadrao({ slug, nome, bbox, exagero_vertical = 15, largura_max_nos = 2048, mresolution, terra = 'copernicus', mascara = true }) {
  return {
    slug,
    nome: nome || slug,
    bbox,
    exagero_vertical,
    largura_max_nos,
    ...(Number.isFinite(mresolution) ? { mresolution } : {}),
    terra,
    mar: 'gmrt',
    mascara,
    nivel_minimo_m: -5500,
    regua: null,
    clipe_referencia: '',
    frase_de_vida: '',
  };
}

function validarSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`slug inválido: "${slug}" (use só letras minúsculas, números e hífen, ex.: 002-vitoria-trindade)`);
  return slug;
}

// Onde ficam os lugares: a pasta atual. A raiz do pacote só vale para ler um lugar que já existe
// lá (clone do repositório rodado de uma subpasta); criar é sempre em ./lugares/<slug>/, senão
// `npx maquete --bbox ...` numa pasta vazia gravava dentro de node_modules ou do cache do npx.
export function raizDosLugares(cwd = process.cwd(), slug = null) {
  if (slug && !fs.existsSync(path.join(cwd, 'lugares', slug, 'lugar.json')) && fs.existsSync(path.join(RAIZ_PACOTE, 'lugares', slug, 'lugar.json'))) {
    return RAIZ_PACOTE;
  }
  return cwd;
}

export function lerLugar(raiz, slug) {
  validarSlug(slug);
  const caminho = path.join(raiz, 'lugares', slug, 'lugar.json');
  if (!fs.existsSync(caminho)) {
    const procurado = [path.join(process.cwd(), 'lugares', slug, 'lugar.json')];
    if (RAIZ_PACOTE !== process.cwd()) procurado.push(path.join(RAIZ_PACOTE, 'lugares', slug, 'lugar.json'));
    throw new Error(`lugar não encontrado: ${slug}\n  procurei em: ${procurado.join(' e ')}\n  crie com: npx maquete --bbox N,S,O,L --slug ${slug} --nome "Nome" (grava ./lugares/${slug}/lugar.json)`);
  }
  let lugar;
  try { lugar = JSON.parse(fs.readFileSync(caminho, 'utf8')); } catch (e) { throw new Error(`lugar.json inválido em ${caminho}: ${e.message}`); }
  if (lugar.slug && lugar.slug !== slug) throw new Error(`lugar.json diz slug "${lugar.slug}", mas a pasta é "${slug}"`);
  validarBbox(lugar.bbox);
  if (lugar.terra && !['copernicus', 'gmrt'].includes(lugar.terra)) throw new Error(`terra desconhecida em lugar.json: "${lugar.terra}" (copernicus ou gmrt)`);
  if (lugar.mar && lugar.mar !== 'gmrt') throw new Error(`mar desconhecido em lugar.json: "${lugar.mar}" (a v1 só tem gmrt)`);
  const largura = lugar.largura_max_nos ?? 2048;
  if (!Number.isInteger(largura) || largura < 2) throw new Error(`largura_max_nos inválido em lugar.json: ${largura}`);
  return { ...lugar, slug, largura_max_nos: largura, caminho, pasta: path.dirname(caminho) };
}

export async function gerarTerreno({ lugar, opcoes = {}, log = () => {} }) {
  const t0 = performance.now();
  const bbox = lugar.bbox;
  const largura = opcoes.largura ?? lugar.largura_max_nos;
  const terra = opcoes.soGmrt ? 'gmrt' : (lugar.terra || 'copernicus');
  const mascara = opcoes.semMascara ? false : lugar.mascara !== false;
  const cacheDir = path.join(lugar.pasta, 'cache');
  const saidaDir = opcoes.saida ? path.resolve(opcoes.saida) : lugar.pasta;
  const timeoutMs = opcoes.timeoutMin ? opcoes.timeoutMin * 60 * 1000 : TIMEOUT_PADRAO_MS;
  const forcar = !!opcoes.forcar;
  fs.mkdirSync(cacheDir, { recursive: true });

  const grade = calcularGrade(bbox, largura);
  log(`${lugar.slug} (${lugar.nome}): bbox N ${bbox.norte} S ${bbox.sul} O ${bbox.oeste} L ${bbox.leste}`);
  if (grade.largura !== largura) log(`grade: largura reduzida de ${largura} para ${grade.largura} nós para a altura não passar de ${grade.altura} (caixa ${fmtNum(grade.km.altura / grade.km.largura, 1)} vezes mais alta que larga)`);
  log(`grade de saída: ${grade.largura}x${grade.altura} nós, ${fmtNum(grade.km.largura)} x ${fmtNum(grade.km.altura)} km, ${Math.round(grade.metros_por_no.x)} x ${Math.round(grade.metros_por_no.y)} m/nó; terra = ${terra}, mar = gmrt, máscara = ${mascara ? 'sim' : 'não'}`);

  // 1) GMRT topo (sempre: mar e, no modo gmrt, também a terra)
  const mresolution = opcoes.mresolution ?? lugar.mresolution ?? mresolutionPadrao(bbox, grade.largura);
  const estimativa = estimarBytesGmrt(bbox, mresolution);
  if (estimativa > GMRT_BYTES_MAX) {
    throw new Error(`o pedido ao GridServer sairia com ~${fmtBytes(estimativa)} (caixa de ${fmtNum(grade.km.largura)} x ${fmtNum(grade.km.altura)} km a ${mresolution} m/nó); o teto desta CLI é ${fmtBytes(GMRT_BYTES_MAX)}: peça --mresolution maior (ex.: ${Math.ceil(mresolution * Math.sqrt(estimativa / GMRT_BYTES_MAX) / 10) * 10}) ou uma caixa menor`);
  }
  log(`GMRT: pedindo layer=topo com mresolution=${mresolution} m/nó (~${fmtBytes(estimativa)} estimados)`);
  const gm = await baixarGmrt({ bbox, layer: 'topo', mresolution, cacheDir, forcar, timeoutMs, log });
  const gmrt = await lerGeoTiffLocal(gm.caminho);
  const gmRes = metrosPorNoDoRaster(gmrt);
  log(`GMRT: ${gmrt.largura}x${gmrt.altura} nós, ${Math.round(gmRes.x)} x ${Math.round(gmRes.y)} m/nó devolvidos, ${fmtBytes(gm.bytes)}${gm.cache ? ' (cache)' : ` em ${fmtSegundos(gm.ms || 0)}`}, ${gmrt.nan} NaN`);
  if (Math.round(gmRes.x) > mresolution * 1.5) log(`GMRT: aviso, o GridServer devolveu mais grosseiro que o pedido (${Math.round(gmRes.x)} > ${mresolution} m/nó); limite do servidor por tamanho de arquivo`);
  const fontes = [{
    id: 'gmrt', url: gm.url, camada: 'topo', mresolution_pedido: mresolution,
    largura: gmrt.largura, altura: gmrt.altura, metros_por_no_devolvido: { x: arredondar(gmRes.x, 1), y: arredondar(gmRes.y, 1) },
    bbox_devolvido: { norte: gmrt.bbox.norte, sul: gmrt.bbox.sul, oeste: gmrt.bbox.oeste, leste: gmrt.bbox.leste }, nan: gmrt.nan,
    licenca: GMRT_LICENCA, atribuicao: GMRT_ATRIBUICAO, obtido_em: gm.obtido_em, bytes: gm.bytes, sha256: gm.sha256, cache: gm.cache,
  }];

  // 2) GMRT topo-mask (fração medida de verdade)
  let mascaraRaster = null;
  if (mascara) {
    log('GMRT: pedindo layer=topo-mask (medido x interpolado)');
    const mk = await baixarGmrt({ bbox, layer: 'topo-mask', mresolution, cacheDir, forcar, timeoutMs, log });
    mascaraRaster = await lerGeoTiffLocal(mk.caminho);
    log(`GMRT máscara: ${mascaraRaster.largura}x${mascaraRaster.altura} nós, ${fmtBytes(mk.bytes)}${mk.cache ? ' (cache)' : ` em ${fmtSegundos(mk.ms || 0)}`}, ${mascaraRaster.nan} nós interpolados no raster`);
    fontes.push({
      id: 'gmrt-topo-mask', url: mk.url, camada: 'topo-mask', mresolution_pedido: mresolution, largura: mascaraRaster.largura, altura: mascaraRaster.altura,
      licenca: GMRT_LICENCA, atribuicao: GMRT_ATRIBUICAO, obtido_em: mk.obtido_em, bytes: mk.bytes, sha256: mk.sha256, cache: mk.cache,
    });
  }

  // 3) Copernicus na terra
  let cop = null;
  if (terra === 'copernicus') {
    const alvo = Math.min(grade.graus_por_no.lon, grade.graus_por_no.lat);
    cop = await coletarCopernicus({ bbox, alvoGrausPorNo: alvo, cacheDir, forcar, paralelo: 3, tentativas: 2, timeoutMs, log });
    log(`Copernicus: ${cop.resumo.tiles_lidos} tiles lidos (${cop.resumo.tiles_cache} do cache), ${fmtBytes(cop.resumo.bytes_baixados)} baixados em ${cop.resumo.pedidos} pedidos, ${fmtSegundos(cop.resumo.ms)}`);
    fontes.push(cop.fonte);
  }

  // 4) Reamostragem bilinear para a grade de saída
  const tR = performance.now();
  const gmrtGrade = reamostrarParaGrade(gmrt, bbox, grade, 'bilinear');
  let copGrade = null;
  let existe = null;
  if (cop) {
    const n = grade.largura * grade.altura;
    copGrade = new Float32Array(n);
    existe = new Uint8Array(n);
    for (let j = 0; j < grade.altura; j++) {
      const lat = latDoNo(bbox, grade, j);
      for (let i = 0; i < grade.largura; i++) {
        const lon = lonDoNo(bbox, grade, i);
        const k = j * grade.largura + i;
        if (cop.mosaico.existe(lon, lat)) { existe[k] = 1; copGrade[k] = cop.mosaico.bilinear(lon, lat); } else { copGrade[k] = NaN; }
      }
    }
  }

  // 5) Fusão e preenchimento
  const fusao = fundirGrade(copGrade, gmrtGrade, existe);
  const alturas = fusao.alturas;
  const nodataPreenchidos = preencherNaN(alturas, grade.largura, grade.altura);
  const { min, max } = minMax(alturas);
  log(`fusão: ${fmtSegundos(performance.now() - tR)}; ${fusao.nos_copernicus} nós de terra do Copernicus, ${fusao.copernicus_nodata} nodata do Copernicus cobertos pelo GMRT, ${nodataPreenchidos} buracos preenchidos pelo vizinho; elevação ${fmtNum(min)} a ${fmtNum(max)} m`);

  // 6) Máscara: fração dos nós de mar (h <= 0) com medição direta
  let mascaraJson = { pct_medido: null, nos: 0 };
  if (mascaraRaster) {
    const mk = reamostrarParaGrade(mascaraRaster, bbox, grade, 'vizinho');
    let medidos = 0;
    let mar = 0;
    for (let k = 0; k < alturas.length; k++) {
      if (alturas[k] <= 0) { mar++; if (mk[k] === mk[k]) medidos++; }
    }
    mascaraJson = { pct_medido: mar ? arredondar(100 * medidos / mar, 1) : 0, nos: medidos, nos_mar: mar, base: 'nós com elevação <= 0 m' };
    log(`máscara: ${medidos} de ${mar} nós de mar medidos de verdade (${fmtNum(mascaraJson.pct_medido)} %)`);
  }

  // 7) Gravação
  const caminhoPng = path.join(saidaDir, 'terreno.png');
  const caminhoJson = path.join(saidaDir, 'terreno.json');
  const tP = performance.now();
  const clampados = { abaixo: 0, acima: 0 };
  const bytesPng = escreverTerrenoPng(caminhoPng, alturas, grade.largura, grade.altura, clampados);
  if (clampados.abaixo || clampados.acima) log(`aviso: ${clampados.abaixo} nós abaixo de -10.000 m e ${clampados.acima} acima do teto do Terrain-RGB foram presos no limite`);
  const terreno = {
    slug: lugar.slug,
    largura: grade.largura,
    altura: grade.altura,
    bbox: { norte: bbox.norte, sul: bbox.sul, oeste: bbox.oeste, leste: bbox.leste },
    graus_por_no: { lon: grade.graus_por_no.lon, lat: grade.graus_por_no.lat },
    metros_por_no: { x: arredondar(grade.metros_por_no.x, 1), y: arredondar(grade.metros_por_no.y, 1) },
    km: { largura: arredondar(grade.km.largura, 1), altura: arredondar(grade.km.altura, 1) },
    elev_min_m: arredondar(min, 1),
    elev_max_m: arredondar(max, 1),
    fontes,
    mascara: mascaraJson,
    nodata_preenchidos: nodataPreenchidos,
    clampados,
    fixture: false,
    terra,
    mar: 'gmrt',
    convencao: 'nó = centro de célula; linha 0 = norte, coluna 0 = oeste; Terrain-RGB h = -10000 + (R*65536 + G*256 + B) * 0,1',
    png: { bytes: bytesPng },
    gerado_por: `maquete ${PACOTE.version}`,
    gerado_em: agoraIso(),
  };
  escreverJson(caminhoJson, terreno);
  log(`gravado: ${path.relative(process.cwd(), caminhoPng)} (${fmtBytes(bytesPng)}, ${fmtSegundos(performance.now() - tP)}) e terreno.json`);
  log(`pronto em ${fmtSegundos(performance.now() - t0)}`);
  return { terreno, caminhoPng, caminhoJson, ms: performance.now() - t0 };
}

export async function main(argv = process.argv.slice(2)) {
  const opcoes = parseArgs(argv);
  if (opcoes.ajuda || (!opcoes._.length && !opcoes.bbox)) {
    console.log(AJUDA);
    return opcoes.ajuda ? 0 : 2;
  }
  const log = opcoes.silencioso ? () => {} : (m) => console.log(m);
  let slug = opcoes._[0];
  let raiz;
  if (opcoes.bbox) {
    if (!opcoes.slug) throw new Error('--bbox precisa de --slug <slug> (e, de preferência, --nome "...")');
    slug = validarSlug(opcoes.slug);
    const bbox = parseBboxTexto(opcoes.bbox);
    raiz = process.cwd();   // criar é sempre na pasta atual
    const pasta = path.join(raiz, 'lugares', slug);
    const caminho = path.join(pasta, 'lugar.json');
    if (fs.existsSync(caminho)) throw new Error(`${path.relative(process.cwd(), caminho)} já existe; rode sem --bbox para usar o que está lá`);
    const km = kmDoBbox(bbox);
    const exagero = exageroSugerido(km.largura);
    const novo = lugarPadrao({
      slug, nome: opcoes.nome, bbox, exagero_vertical: exagero, largura_max_nos: opcoes.largura ?? 2048,
      mresolution: opcoes.mresolution, terra: opcoes.soGmrt ? 'gmrt' : 'copernicus', mascara: !opcoes.semMascara,
    });
    fs.mkdirSync(pasta, { recursive: true });
    escreverJson(caminho, novo);
    log(`criado ${path.relative(process.cwd(), caminho)}: caixa de ${fmtNum(km.largura)} x ${fmtNum(km.altura)} km, exagero vertical ${exagero}x (sugerido pela largura; mude no lugar.json), ${novo.largura_max_nos} nós${novo.mresolution ? `, mresolution ${novo.mresolution}` : ''}, terra ${novo.terra}, máscara ${novo.mascara ? 'sim' : 'não'}`);
  } else if (opcoes._.length > 1) {
    throw new Error(`um lugar por vez (veio ${opcoes._.join(', ')})`);
  } else {
    raiz = raizDosLugares(process.cwd(), slug);
  }
  const lugar = lerLugar(raiz, slug);
  await gerarTerreno({ lugar, opcoes, log });
  return 0;
}

if (ehPrincipal(import.meta.url)) {
  main().then((codigo) => { process.exitCode = codigo; }).catch((e) => {
    console.error(`erro: ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  });
}

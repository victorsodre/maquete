// IBGE: listas de localidades (regiões, estados, municípios) e malhas territoriais (GeoJSON) sem chave,
// com cache em disco. Resolve nome, sigla ou código para um território e devolve o polígono (com furos)
// e o bbox com margem. Nada aqui toca o terreno: quem rasteriza é cli/recorte.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obterComCache, lerJson, TIMEOUT_PADRAO_MS } from './rede.mjs';
import { validarBbox, arredondar } from './terrain.mjs';

export const IBGE_LOCALIDADES = 'https://servicodados.ibge.gov.br/api/v1/localidades';
export const IBGE_MALHAS = 'https://servicodados.ibge.gov.br/api/v3/malhas';
export const IBGE_ATRIBUICAO = 'IBGE, Malhas Territoriais';
export const IBGE_LICENCA = 'dado público do IBGE (API de localidades e malhas, sem chave); termos de uso do portal a confirmar';
export const IBGE_DOCS = { localidades: 'https://servicodados.ibge.gov.br/api/docs/localidades', malhas: 'https://servicodados.ibge.gov.br/api/docs/malhas?versao=3' };

export const NIVEIS = ['paises', 'regioes', 'estados', 'municipios'];
export const QUALIDADES = ['minima', 'intermediaria', 'maxima'];
export const ESCALA_DO_NIVEL = { paises: 'pais', regioes: 'regiao', estados: 'estado', municipios: 'municipio' };
export const MARGEM_PADRAO = 0.04;
// Ilha oceânica fora do bbox: só entram no bbox do lugar os polígonos cujo centróide fica a até este
// fator vezes a diagonal do bbox do maior polígono (medida do centro desse bbox). Os demais continuam
// na malha (o recorte os respeita), mas caem fora da grade: Trindade (ES, Vitória) a 1.200 km.
// 0,75: Noronha fica a ~5,5 graus do centro de Pernambuco (diagonal 6,85), Trindade a ~12 do ES; ilha
// costeira (Ilhabela, Marajó) fica a menos de meia diagonal. Com 1,5 Noronha entrava e PE virava lasca.
export const FATOR_ILHA_FORA = 0.75;

// Cache compartilhado entre lugares: as listas servem para todos e uma malha serve a qualquer slug.
export const CACHE_IBGE_PADRAO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dados', 'cache-ibge');

// ---------------------------------------------------------------------------
// Texto: acento-insensível e slug em kebab ASCII
// ---------------------------------------------------------------------------

export function normalizarNome(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function kebab(s) {
  return normalizarNome(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Qualidade padrão por nível: país e região em intermediaria (13 anéis e 1.185 pontos para o Brasil,
// de sobra numa grade de 1024 nós a ~4 km por nó); estado e município em maxima. Para estado o
// contrato sugeria intermediaria, mas Sergipe nessa qualidade tem 141 pontos (um lado a cada ~6 km,
// 9 mm numa peça de 300 mm: o contorno sai poligonal); em maxima são 490 pontos e 10 KB.
export function qualidadePadrao(nivel) {
  if (nivel === 'paises' || nivel === 'regioes') return 'intermediaria';
  return 'maxima';
}

export function validarQualidade(q) {
  if (!QUALIDADES.includes(q)) throw new Error(`qualidade desconhecida: "${q}" (use ${QUALIDADES.join(', ')})`);
  return q;
}

export function validarNivel(n) {
  if (!NIVEIS.includes(n)) throw new Error(`nível do IBGE desconhecido: "${n}" (use ${NIVEIS.join(', ')})`);
  return n;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export function urlLista(tipo) {
  if (tipo === 'regioes') return `${IBGE_LOCALIDADES}/regioes`;
  if (tipo === 'estados') return `${IBGE_LOCALIDADES}/estados?orderBy=nome`;
  if (tipo === 'municipios') return `${IBGE_LOCALIDADES}/municipios?orderBy=nome`;
  throw new Error(`lista do IBGE desconhecida: ${tipo}`);
}

export function urlMalha(nivel, codigo, qualidade) {
  validarNivel(nivel);
  validarQualidade(qualidade);
  if (!/^[A-Z0-9]+$/.test(String(codigo))) throw new Error(`código do IBGE inválido: "${codigo}"`);
  return `${IBGE_MALHAS}/${nivel}/${codigo}?formato=application/vnd.geo+json&qualidade=${qualidade}`;
}

// ---------------------------------------------------------------------------
// Download com cache (listas e malhas)
// ---------------------------------------------------------------------------

function validarJson(caminho) {
  const j = lerJson(caminho);
  if (j === null) return 'o IBGE devolveu algo que não é JSON';
  if (j && typeof j === 'object' && !Array.isArray(j) && j.message && !j.type) return `o IBGE respondeu com erro: ${j.message}`;
  return null;
}

async function obterJson(url, { cacheDir = CACHE_IBGE_PADRAO, nomeFixo, forcar = false, timeoutMs = TIMEOUT_PADRAO_MS, log, rotulo } = {}) {
  const r = await obterComCache(url, cacheDir, { nomeFixo, forcar, timeoutMs, log, rotulo, validar: validarJson });
  const dados = lerJson(r.caminho);
  if (dados === null) throw new Error(`cache do IBGE corrompido em ${r.caminho}; rode com --forcar`);
  return { dados, ...r };
}

export async function listarRegioes(opcoes = {}) {
  return (await obterJson(urlLista('regioes'), { ...opcoes, nomeFixo: 'regioes.json', rotulo: 'IBGE regiões' })).dados;
}

export async function listarEstados(opcoes = {}) {
  return (await obterJson(urlLista('estados'), { ...opcoes, nomeFixo: 'estados.json', rotulo: 'IBGE estados' })).dados;
}

// 5.571 itens, ~2,4 MB: fica em cache e nunca é baixada duas vezes sem --forcar.
export async function listarMunicipios(opcoes = {}) {
  return (await obterJson(urlLista('municipios'), { ...opcoes, nomeFixo: 'municipios.json', rotulo: 'IBGE municípios' })).dados;
}

// Malha de um território. Devolve { poligonos, bbox, url, bytes, sha256, obtido_em, cache, geojson }.
export async function obterMalha({ nivel, codigo, qualidade, cacheDir, forcar, timeoutMs, log } = {}) {
  validarNivel(nivel);
  const q = qualidade || qualidadePadrao(nivel);
  const url = urlMalha(nivel, codigo, q);
  const r = await obterJson(url, { cacheDir, nomeFixo: `malha-${nivel}-${codigo}-${q}.json`, forcar, timeoutMs, log, rotulo: `IBGE malha ${nivel}/${codigo}` });
  const poligonos = poligonosDoGeoJson(r.dados, String(codigo));
  const principal = bboxPrincipal(poligonos);
  return {
    poligonos, bbox: principal.bbox, bbox_completo: bboxDosPoligonos(poligonos), ilhas_fora_do_bbox: principal.ignorados,
    qualidade: q, url: r.url, bytes: r.bytes, sha256: r.sha256, obtido_em: r.obtido_em, cache: r.cache, geojson: r.dados,
  };
}

// ---------------------------------------------------------------------------
// GeoJSON -> polígonos
// ---------------------------------------------------------------------------

// Aceita FeatureCollection, Feature, Polygon ou MultiPolygon. Devolve uma lista de polígonos; cada
// polígono é uma lista de anéis [[lon, lat], ...] (o primeiro é o externo, os demais são furos).
// Anéis fechados (primeiro ponto repetido no fim) ficam como vieram: o rasterizador trata o fecho.
export function poligonosDoGeoJson(geojson, codigoEsperado = null) {
  if (!geojson || typeof geojson !== 'object') throw new Error('malha do IBGE vazia ou inválida');
  let geometrias = [];
  let props = null;
  if (geojson.type === 'FeatureCollection') {
    if (!Array.isArray(geojson.features) || !geojson.features.length) throw new Error('malha do IBGE sem features');
    geometrias = geojson.features.map((f) => f.geometry);
    props = geojson.features[0].properties || null;
  } else if (geojson.type === 'Feature') {
    geometrias = [geojson.geometry];
    props = geojson.properties || null;
  } else {
    geometrias = [geojson];
  }
  if (codigoEsperado !== null && props && props.codarea !== undefined && String(props.codarea) !== String(codigoEsperado)) {
    throw new Error(`malha do IBGE veio com codarea "${props.codarea}", esperado "${codigoEsperado}"`);
  }
  const poligonos = [];
  for (const g of geometrias) {
    if (!g) continue;
    if (g.type === 'Polygon') poligonos.push(g.coordinates);
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) poligonos.push(p);
    else throw new Error(`geometria do IBGE não suportada: ${g.type} (esperado Polygon ou MultiPolygon)`);
  }
  let pontos = 0;
  for (const p of poligonos) {
    if (!Array.isArray(p) || !p.length) throw new Error('polígono do IBGE sem anéis');
    for (const anel of p) {
      if (!Array.isArray(anel) || anel.length < 3) throw new Error('anel do IBGE com menos de 3 pontos');
      for (const pt of anel) {
        if (!Array.isArray(pt) || pt.length < 2 || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) throw new Error('ponto do IBGE inválido');
        pontos++;
      }
    }
  }
  if (!poligonos.length || !pontos) throw new Error('malha do IBGE sem polígonos');
  return poligonos;
}

export function contarPontos(poligonos) {
  let n = 0;
  for (const p of poligonos) for (const anel of p) n += anel.length;
  return n;
}

export function bboxDosPoligonos(poligonos) {
  let norte = -Infinity, sul = Infinity, oeste = Infinity, leste = -Infinity;
  for (const p of poligonos) {
    for (const anel of p) {
      for (const [lon, lat] of anel) {
        if (lat > norte) norte = lat;
        if (lat < sul) sul = lat;
        if (lon < oeste) oeste = lon;
        if (lon > leste) leste = lon;
      }
    }
  }
  if (!Number.isFinite(norte)) throw new Error('bbox do polígono: sem pontos');
  return { norte, sul, oeste, leste };
}

// Área com sinal (shoelace) e centróide de um anel [[lon, lat], ...], em graus; o fecho repetido não atrapalha.
export function centroideDoAnel(anel) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = anel.length, j = n - 1; i < n; j = i++) {
    const [xi, yi] = anel[i], [xj, yj] = anel[j];
    const c = xj * yi - xi * yj;
    a += c; cx += (xj + xi) * c; cy += (yj + yi) * c;
  }
  if (a === 0) {   // anel degenerado: média dos pontos
    let sx = 0, sy = 0;
    for (const [x, y] of anel) { sx += x; sy += y; }
    return { lon: sx / anel.length, lat: sy / anel.length, area: 0 };
  }
  return { lon: cx / (3 * a), lat: cy / (3 * a), area: Math.abs(a) / 2 };
}

// Quais polígonos entram no bbox do lugar: o maior (área do anel externo, lon escalado pelo cosseno
// da latitude) e todo polígono cujo centróide fica a até `fator` x a diagonal do bbox do maior,
// medida do centro desse bbox. Devolve { usados: [índices], ignorados: [índices] }.
export function poligonosDoBbox(poligonos, fator = FATOR_ILHA_FORA) {
  if (!Array.isArray(poligonos) || !poligonos.length) throw new Error('bbox do polígono: sem polígonos');
  if (!(fator >= 0)) throw new Error(`fator de ilha fora do bbox inválido: ${fator}`);
  const info = poligonos.map((p) => ({ c: centroideDoAnel(p[0]), bbox: bboxDosPoligonos([p]) }));
  let maior = 0;
  for (let i = 1; i < info.length; i++) {
    const k = Math.cos((info[i].c.lat * Math.PI) / 180), kM = Math.cos((info[maior].c.lat * Math.PI) / 180);
    if (info[i].c.area * k > info[maior].c.area * kM) maior = i;
  }
  const b = info[maior].bbox;
  const latCentro = (b.norte + b.sul) / 2, lonCentro = (b.oeste + b.leste) / 2;
  const k = Math.cos((latCentro * Math.PI) / 180);
  const diagonal = Math.hypot((b.leste - b.oeste) * k, b.norte - b.sul);
  const limite = fator * diagonal;
  const usados = [], ignorados = [];
  info.forEach((p, i) => {
    const d = Math.hypot((p.c.lon - lonCentro) * k, p.c.lat - latCentro);
    (i === maior || d <= limite ? usados : ignorados).push(i);
  });
  return { usados, ignorados, maior, diagonal_graus: diagonal };
}

// bbox do lugar: só dos polígonos que poligonosDoBbox aprova. Devolve { bbox, usados, ignorados } com as contagens.
export function bboxPrincipal(poligonos, fator = FATOR_ILHA_FORA) {
  const { usados, ignorados } = poligonosDoBbox(poligonos, fator);
  return { bbox: bboxDosPoligonos(usados.map((i) => poligonos[i])), usados: usados.length, ignorados: ignorados.length };
}

// Quantos polígonos ficam inteiramente fora de um bbox (nenhum ponto do anel externo dentro dele).
export function poligonosForaDoBbox(poligonos, bbox) {
  validarBbox(bbox);
  let n = 0;
  for (const p of poligonos) {
    const b = bboxDosPoligonos([p]);
    if (b.sul > bbox.norte || b.norte < bbox.sul || b.oeste > bbox.leste || b.leste < bbox.oeste) n++;
  }
  return n;
}

// Acrescenta `margem` (fração do tamanho do bbox) em volta e arredonda a 4 casas (~11 m), para o
// lugar.json ficar legível e a URL do GMRT estável. Prende em -90..90 e -180..180.
export function bboxComMargem(bbox, margem = MARGEM_PADRAO) {
  validarBbox(bbox);
  if (!Number.isFinite(margem) || margem < 0 || margem > 1) throw new Error(`margem inválida: ${margem} (fração do bbox entre 0 e 1)`);
  const dLat = (bbox.norte - bbox.sul) * margem;
  const dLon = (bbox.leste - bbox.oeste) * margem;
  const r = {
    norte: Math.min(90, arredondar(bbox.norte + dLat, 4)),
    sul: Math.max(-90, arredondar(bbox.sul - dLat, 4)),
    oeste: Math.max(-180, arredondar(bbox.oeste - dLon, 4)),
    leste: Math.min(180, arredondar(bbox.leste + dLon, 4)),
  };
  return validarBbox(r);
}

// ---------------------------------------------------------------------------
// Resolução de nome, sigla ou código
// ---------------------------------------------------------------------------

function ehCodigo(texto, digitos) {
  return new RegExp(`^\\d{${digitos}}$`).test(String(texto).trim());
}

// --regiao: 1..5, sigla (N, NE, SE, S, CO) ou nome (acento-insensível). Devolve { nivel, codigo, nome, sigla, slug }.
export function resolverRegiao(texto, regioes) {
  const t = normalizarNome(texto);
  if (!t) throw new Error('--regiao precisa de um nome, sigla ou número (1 a 5)');
  const achada = regioes.find((r) => String(r.id) === t || normalizarNome(r.sigla) === t || normalizarNome(r.nome) === t || kebab(r.nome) === kebab(t));
  if (!achada) throw new Error(`região não encontrada: "${texto}"; opções: ${regioes.map((r) => `${r.id} ${r.nome} (${r.sigla})`).join(', ')}`);
  return { nivel: 'regioes', codigo: String(achada.id), nome: achada.nome, sigla: achada.sigla, slug: `regiao-${kebab(achada.nome)}` };
}

// --uf: sigla (SP), código (35) ou nome (São Paulo). Devolve { nivel, codigo, nome, sigla, slug, regiao }.
export function resolverEstado(texto, estados) {
  const t = normalizarNome(texto);
  if (!t) throw new Error('--uf precisa de uma sigla, código ou nome de estado');
  const achado = estados.find((e) => String(e.id) === t || normalizarNome(e.sigla) === t || normalizarNome(e.nome) === t);
  if (!achado) throw new Error(`estado não encontrado: "${texto}"; use a sigla (ex.: SP), o código (35) ou o nome`);
  return { nivel: 'estados', codigo: String(achado.id), nome: achado.nome, sigla: achado.sigla, slug: achado.sigla.toLowerCase(), regiao: achado.regiao ? achado.regiao.sigla : null };
}

// UF de um município: pela microrregião, pela região imediata ou, na falta das duas (Boa Esperança
// do Norte, MT, veio sem microrregião em 26/10/2026), pelos 2 primeiros dígitos do código.
export function ufDoMunicipio(m, estados = []) {
  const a = m && m.microrregiao && m.microrregiao.mesorregiao && m.microrregiao.mesorregiao.UF;
  if (a && a.sigla) return a.sigla;
  const b = m && m['regiao-imediata'] && m['regiao-imediata']['regiao-intermediaria'] && m['regiao-imediata']['regiao-intermediaria'].UF;
  if (b && b.sigla) return b.sigla;
  const prefixo = String(m && m.id).slice(0, 2);
  const e = estados.find((x) => String(x.id) === prefixo);
  return e ? e.sigla : null;
}

// --municipio: código de 7 dígitos ou nome (acento-insensível); --uf desempata homônimos.
// Devolve { nivel, codigo, nome, sigla (UF), slug }.
export function resolverMunicipio(texto, municipios, { uf = null, estados = [] } = {}) {
  const t = normalizarNome(texto);
  if (!t) throw new Error('--municipio precisa de um nome ou código de 7 dígitos');
  const ufNorm = uf ? normalizarNome(uf) : null;
  let candidatos;
  if (ehCodigo(t, 7)) {
    candidatos = municipios.filter((m) => String(m.id) === t);
    if (!candidatos.length) throw new Error(`município com código ${t} não existe na lista do IBGE`);
  } else {
    candidatos = municipios.filter((m) => normalizarNome(m.nome) === t);
    if (!candidatos.length) {
      const parecidos = municipios.filter((m) => normalizarNome(m.nome).includes(t)).slice(0, 8);
      throw new Error(`município não encontrado: "${texto}"${parecidos.length ? `; parecidos: ${parecidos.map((m) => `${m.nome} (${ufDoMunicipio(m, estados)}, ${m.id})`).join(', ')}` : ''}`);
    }
    if (ufNorm) candidatos = candidatos.filter((m) => normalizarNome(ufDoMunicipio(m, estados)) === ufNorm);
    if (!candidatos.length) throw new Error(`município "${texto}" não existe em ${uf}`);
  }
  if (candidatos.length > 1) {
    throw new Error(`"${texto}" é nome de ${candidatos.length} municípios: ${candidatos.map((m) => `${m.nome} (${ufDoMunicipio(m, estados)}, ${m.id})`).join(', ')}; desempate com --uf <sigla> ou use o código`);
  }
  const m = candidatos[0];
  const sigla = ufDoMunicipio(m, estados);
  return { nivel: 'municipios', codigo: String(m.id), nome: m.nome, sigla, slug: kebab(m.nome) };
}

export function resolverPais() {
  return { nivel: 'paises', codigo: 'BR', nome: 'Brasil', sigla: 'BR', slug: 'brasil' };
}

// Bloco "ibge" do lugar.json a partir do território resolvido.
export function blocoIbge(territorio, qualidade) {
  const q = qualidade || qualidadePadrao(territorio.nivel);
  validarQualidade(q);
  const bloco = { nivel: territorio.nivel, codigo: territorio.codigo, nome: territorio.nome };
  if (territorio.sigla) bloco.sigla = territorio.sigla;
  bloco.qualidade = q;
  return bloco;
}

export function validarBlocoIbge(ibge) {
  if (!ibge || typeof ibge !== 'object') throw new Error('bloco "ibge" inválido no lugar.json');
  validarNivel(ibge.nivel);
  if (!ibge.codigo || !/^[A-Z0-9]+$/.test(String(ibge.codigo))) throw new Error(`ibge.codigo inválido: "${ibge.codigo}"`);
  if (ibge.qualidade !== undefined) validarQualidade(ibge.qualidade);
  return ibge;
}

// Fonte para o terreno.json (mesma forma das fontes do GMRT e do Copernicus).
export function fonteIbge(malha, ibge) {
  return {
    id: 'ibge-malha',
    url: malha.url,
    nivel: ibge.nivel,
    codigo: ibge.codigo,
    nome: ibge.nome,
    qualidade: malha.qualidade,
    poligonos: malha.poligonos.length,
    aneis: malha.poligonos.reduce((a, p) => a + p.length, 0),
    pontos: contarPontos(malha.poligonos),
    bbox_malha: { norte: arredondar(malha.bbox.norte, 4), sul: arredondar(malha.bbox.sul, 4), oeste: arredondar(malha.bbox.oeste, 4), leste: arredondar(malha.bbox.leste, 4) },
    poligonos_fora_do_bbox: malha.ilhas_fora_do_bbox ?? 0,
    licenca: IBGE_LICENCA,
    atribuicao: IBGE_ATRIBUICAO,
    obtido_em: malha.obtido_em,
    bytes: malha.bytes,
    sha256: malha.sha256,
    cache: malha.cache,
  };
}

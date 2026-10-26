#!/usr/bin/env node
// node cli/laminas.mjs <slug> [opções]
// Lê lugares/<slug>/terreno.png + terreno.json (+ bloco "maquete" do lugar.json), suaviza, contorna
// por nível (d3-contour) e grava lugares/<slug>/laminas.json: um polígono por lâmina, em milímetros
// da peça, pronto para a cena e para o SVG de corte. Contrato: SPEC.md, seção "laminas.json".
//
// Convenções: origem no centro da peça, x cresce para leste, y cresce para o norte; anel externo
// anti-horário, furos horários, fechados implicitamente, 2 casas decimais. Lâmina 0 é o retângulo.
import fs from 'node:fs';
import path from 'node:path';
import { lerTerrenoPng, agoraIso, fmtBytes, fmtSegundos, fmtNum, minMax, arredondar } from './terrain.mjs';
import { lerLugar, raizDosLugares } from './index.mjs';
import { PACOTE, escreverJson, ehPrincipal } from './rede.mjs';
import { contours } from '../web/vendor/d3/d3-contour/src/index.js';
import { blur2 } from '../web/vendor/d3/d3-array/src/blur.js';

export const PASSOS_M = [5, 10, 20, 25, 50, 100, 200, 250, 500];
export const MAX_LAMINAS_TERRA = 24;
export const MAX_LAMINAS_MAR = 8;
export const MIN_LAMINAS_MAR = 2;
// Terra com menos lâminas que isso é "lugar plano": pode exagerar mais para não ficar sem relevo.
export const MIN_LAMINAS_TERRA_PLANA = 3;
// Exagero vertical: na terra o teto é o que ainda parece maquete (montanha, não torre); no mar a carta
// batimétrica é estilizada por contornos e aceita mais. Tudo declarado no laminas.json.
export const EXAGERO_TERRA_MAX = 7;
export const EXAGERO_TERRA_PLANA_MAX = 12;
export const EXAGERO_MAR_MAX = 30;
// O GMRT fora do multifeixe é GEBCO a ~450 m por nó, reamostrado em blocos: o raio do mar cobre um bloco.
export const METROS_BLOCO_GEBCO = 450;

export const PADROES = Object.freeze({
  largura_mm: 300,
  espessura_mm: 3,
  suavizar_terra_nos: 1,        // grade grossa (metros_por_no >= metros_por_no_fino)
  suavizar_terra_nos_fino: 2,   // grade fina: o Copernicus a 30 m traz prédio e mata, que viram confete
  metros_por_no_fino: 60,
  area_min_mm2: 8,
  area_min_furo_mm2: 10,
  tolerancia_mm: 0.15,
  material: 'compensado',
});

// Exagero vertical de um passo: (espessura / passo) dividido pela escala horizontal (mm por metro).
export function exageroDe(espessuraMm, passoM, mmPorKm) {
  return (espessuraMm / passoM) / (mmPorKm / 1000);
}

// Raio padrão do blur da terra: 2 nós em grade fina (menos de 60 m por nó), senão 1.
export function suavizarTerraPadrao(metrosPorNo) {
  return metrosPorNo < PADROES.metros_por_no_fino ? PADROES.suavizar_terra_nos_fino : PADROES.suavizar_terra_nos;
}

export const AJUDA = `maquete ${PACOTE.version}: terreno.png -> laminas.json (contornos por nível, em mm da peça)

Uso:
  node cli/laminas.mjs <slug> [opções]

Opções (a linha de comando vence o bloco "maquete" do lugar.json, que vence o padrão):
  --largura-mm N       largura leste-oeste da peça em mm (padrão ${PADROES.largura_mm})
  --espessura-mm N     espessura de cada lâmina em mm (padrão ${PADROES.espessura_mm}; 1,5 para papel)
  --passo-terra N      metros por lâmina na terra (padrão: o menor de ${PASSOS_M.join(', ')} com exagero até ${EXAGERO_TERRA_MAX}x
                       e até ${MAX_LAMINAS_TERRA} lâminas; lugar plano, com menos de ${MIN_LAMINAS_TERRA_PLANA} lâminas, aceita até ${EXAGERO_TERRA_PLANA_MAX}x)
  --passo-mar N        metros por lâmina no mar (padrão: o menor que dê até ${MAX_LAMINAS_MAR} lâminas, subindo até o
                       exagero do mar ficar em ${EXAGERO_MAR_MAX}x, sem descer de ${MIN_LAMINAS_MAR} lâminas)
  --suavizar-terra N   raio do blur na terra, em nós (padrão ${PADROES.suavizar_terra_nos_fino} abaixo de ${PADROES.metros_por_no_fino} m por nó, senão ${PADROES.suavizar_terra_nos})
  --suavizar-mar N     raio do blur no mar, em nós (padrão ceil(${METROS_BLOCO_GEBCO} / metros por nó))
  --area-min N         área mínima de um anel externo em mm² (padrão ${PADROES.area_min_mm2}; furos: ${PADROES.area_min_furo_mm2})
  --tolerancia-mm N    tolerância do Douglas-Peucker em mm (padrão ${PADROES.tolerancia_mm})
  --silencioso         só erros
  --ajuda, -h          esta ajuda

Sem --passo-terra/--passo-mar e sem passos no lugar.json, os passos escolhidos são gravados no bloco
"maquete" do lugar.json, para a rodada seguinte sair igual. Antes, rode: node cli/index.mjs <slug>.`;

// ---------------------------------------------------------------------------
// Passos e níveis
// ---------------------------------------------------------------------------

// Lâminas de terra que um passo dá: múltiplos de `passo` acima da base até o último abaixo de elevMax.
// Com mar (elevMin < 0) a base é 0; sem mar, a base é floor(elevMin / passo) * passo (a lâmina 0).
export function contarNiveisTerra(elevMax, passo, elevMin = 0) {
  const base = elevMin < 0 ? 0 : Math.floor(elevMin / passo);
  const n = Math.ceil(elevMax / passo) - 1 - base;
  return n > 0 ? n : 0;
}

// Lâminas de mar que um passo dá: múltiplos de `passo` de floor(elevMin / passo) * passo até -passo
// (inclui a lâmina 0, o retângulo, que fica no nível mais baixo).
export function contarNiveisMar(elevMin, passo) {
  if (!(elevMin < 0)) return 0;
  return -Math.floor(elevMin / passo);
}

// O menor passo da lista cuja contagem cabe em `maximo`; se nenhum cabe, o maior (e quem chama avisa).
export function escolherPasso(contar, maximo, passos = PASSOS_M) {
  for (const p of passos) if (contar(p) <= maximo) return p;
  return passos[passos.length - 1];
}

// Passo da terra: o menor passo cujo exagero fica em no máximo `exageroMax`; se der mais de `maximo`
// lâminas, sobe até caber. Lugar plano (menos de `minimoPlano` lâminas) pode descer o passo, com exagero
// até `exageroPlano`: o maior passo (menor exagero) que chega a `minimoPlano` lâminas ou, se nenhum chega,
// o que dá mais lâminas. Se nenhum passo da lista cumpre o exagero, fica o maior (quem chama avisa).
export function escolherPassoTerra({ elevMax, elevMin = 0, espessuraMm = PADROES.espessura_mm, mmPorKm }, {
  maximo = MAX_LAMINAS_TERRA, exageroMax = EXAGERO_TERRA_MAX, exageroPlano = EXAGERO_TERRA_PLANA_MAX,
  minimoPlano = MIN_LAMINAS_TERRA_PLANA, passos = PASSOS_M,
} = {}) {
  if (!(mmPorKm > 0)) throw new Error('escolherPassoTerra: mmPorKm precisa ser > 0');
  const contar = (p) => contarNiveisTerra(elevMax, p, elevMin);
  const exagero = (p) => exageroDe(espessuraMm, p, mmPorKm);
  const ultimo = passos.length - 1;
  let i = passos.findIndex((p) => exagero(p) <= exageroMax);
  if (i < 0) i = ultimo;
  while (i < ultimo && contar(passos[i]) > maximo) i++;
  if (contar(passos[i]) >= minimoPlano) return passos[i];
  // lugar plano: desce o passo enquanto o exagero couber em exageroPlano
  let melhor = i, melhorN = contar(passos[i]);
  for (let j = i - 1; j >= 0 && exagero(passos[j]) <= exageroPlano; j--) {
    const n = contar(passos[j]);
    if (n >= minimoPlano) return passos[j];
    if (n > melhorN) { melhor = j; melhorN = n; }
  }
  return passos[melhor];
}

// Passo do mar: o menor passo com até `maximo` lâminas de mar; se o exagero do mar passar de `exageroMax`,
// sobe o passo até cumprir, sem deixar o mar com menos de `minimo` lâminas (a lâmina 0 conta).
export function escolherPassoMar({ elevMin, espessuraMm = PADROES.espessura_mm, mmPorKm }, {
  maximo = MAX_LAMINAS_MAR, minimo = MIN_LAMINAS_MAR, exageroMax = EXAGERO_MAR_MAX, passos = PASSOS_M,
} = {}) {
  if (!(mmPorKm > 0)) throw new Error('escolherPassoMar: mmPorKm precisa ser > 0');
  const contar = (p) => contarNiveisMar(elevMin, p);
  const exagero = (p) => exageroDe(espessuraMm, p, mmPorKm);
  const ultimo = passos.length - 1;
  let i = passos.findIndex((p) => contar(p) <= maximo);
  if (i < 0) i = ultimo;
  while (i < ultimo && exagero(passos[i]) > exageroMax && contar(passos[i + 1]) >= minimo) i++;
  return passos[i];
}

// Lista de níveis da pilha, de baixo para cima: [{ nivel_m, tipo }].
// Com mar (elevMin < 0): múltiplos de passoMar de floor(elevMin/passoMar)*passoMar até -passoMar,
// depois 0 (costa, se houver terra), depois múltiplos de passoTerra abaixo de elevMax.
// Sem mar: a base é floor(elevMin/passoTerra)*passoTerra (retângulo) e sobe em passoTerra.
export function niveisDe({ elevMin, elevMax, passoTerra, passoMar }) {
  if (!(passoTerra > 0)) throw new Error(`passo de terra inválido: ${passoTerra}`);
  const niveis = [];
  if (elevMin < 0) {
    if (!(passoMar > 0)) throw new Error(`passo de mar inválido: ${passoMar}`);
    const base = Math.floor(elevMin / passoMar) * passoMar;
    for (let n = base; n <= -passoMar; n += passoMar) niveis.push({ nivel_m: n, tipo: 'mar' });
    if (elevMax >= 0) niveis.push({ nivel_m: 0, tipo: 'costa' });
    for (let n = passoTerra; n < elevMax; n += passoTerra) niveis.push({ nivel_m: n, tipo: 'terra' });
  } else {
    const base = Math.floor(elevMin / passoTerra) * passoTerra;
    niveis.push({ nivel_m: base, tipo: 'terra' });
    for (let n = base + passoTerra; n < elevMax; n += passoTerra) niveis.push({ nivel_m: n, tipo: 'terra' });
  }
  return niveis;
}

// ---------------------------------------------------------------------------
// Geometria de anéis (mm, y para o norte)
// ---------------------------------------------------------------------------

// Área com sinal (shoelace): positiva = anti-horário com y para cima. Anel fechado implicitamente.
export function areaComSinal(anel) {
  let s = 0;
  for (let i = 0, n = anel.length, j = n - 1; i < n; j = i++) s += anel[j][0] * anel[i][1] - anel[i][0] * anel[j][1];
  return s / 2;
}

// Ponto dentro do anel (ray casting). Pontos na borda podem cair de qualquer lado.
export function pontoDentro(anel, [x, y]) {
  let dentro = false;
  for (let i = 0, n = anel.length, j = n - 1; i < n; j = i++) {
    const [xi, yi] = anel[i], [xj, yj] = anel[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// Tira pontos consecutivos iguais e o fecho explícito (último igual ao primeiro).
export function semRepetidos(anel) {
  const saida = [];
  for (const p of anel) {
    const q = saida[saida.length - 1];
    if (q && q[0] === p[0] && q[1] === p[1]) continue;
    saida.push(p);
  }
  while (saida.length > 1 && saida[0][0] === saida[saida.length - 1][0] && saida[0][1] === saida[saida.length - 1][1]) saida.pop();
  return saida;
}

function distancia2AoSegmento(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1];
  return ex * ex + ey * ey;
}

// Douglas-Peucker para anel fechado: ancora no ponto 0 e no ponto mais distante dele, e simplifica
// as duas metades. Devolve um anel novo (sem o fecho repetido). Com tolerância 0 devolve só sem repetidos.
export function simplificar(anel, toleranciaMm) {
  const pontos = semRepetidos(anel);
  const n = pontos.length;
  if (n < 3 || !(toleranciaMm > 0)) return pontos;
  let longe = 0, dMax = -1;
  for (let i = 1; i < n; i++) {
    const dx = pontos[i][0] - pontos[0][0], dy = pontos[i][1] - pontos[0][1];
    const d = dx * dx + dy * dy;
    if (d > dMax) { dMax = d; longe = i; }
  }
  if (longe === 0) return [pontos[0]];
  const tol2 = toleranciaMm * toleranciaMm;
  const manter = new Uint8Array(n + 1);
  manter[0] = manter[longe] = manter[n] = 1;    // índice n = ponto 0 de novo (fecho)
  const pt = (i) => pontos[i === n ? 0 : i];
  const pilha = [[0, longe], [longe, n]];
  while (pilha.length) {
    const [a, b] = pilha.pop();
    if (b - a < 2) continue;
    let melhor = -1, dm = tol2;
    const pa = pt(a), pb = pt(b);
    for (let i = a + 1; i < b; i++) {
      const d = distancia2AoSegmento(pt(i), pa, pb);
      if (d > dm) { dm = d; melhor = i; }
    }
    if (melhor >= 0) { manter[melhor] = 1; pilha.push([a, melhor], [melhor, b]); }
  }
  const saida = [];
  for (let i = 0; i < n; i++) if (manter[i]) saida.push(pontos[i]);
  return saida;
}

// Garante o sentido: anti-horário (área > 0) para externos, horário para furos.
export function orientar(anel, horario = false) {
  const a = areaComSinal(anel);
  if (a === 0) return anel;
  return (a > 0) === horario ? anel.slice().reverse() : anel;
}

export function arredondarPonto([x, y]) {
  const r = (v) => { const q = Math.round(v * 100) / 100; return q === 0 ? 0 : q; };
  return [r(x), r(y)];
}

// Célula do d3-contour (x de 0 a w, y de 0 a h, linha 0 no norte) -> mm da peça (origem no centro, y para o norte).
export function celulaParaMm([cx, cy], { w, h, larguraMm, alturaMm }) {
  return [(cx / w - 0.5) * larguraMm, (0.5 - cy / h) * alturaMm];
}

// Anel do d3 -> anel do laminas.json: converte, simplifica, arredonda, limpa e orienta. null se degenerou.
export function prepararAnel(anelCelula, grade, { toleranciaMm, horario = false }) {
  const mm = anelCelula.map((p) => celulaParaMm(p, grade));
  let anel = simplificar(mm, toleranciaMm);
  anel = semRepetidos(anel.map(arredondarPonto));
  if (anel.length < 3) return null;
  anel = orientar(anel, horario);
  return anel;
}

// MultiPolygon do d3-contour (coordenadas de célula) -> [{ ext, furos }] em mm, filtrado por área.
export function aneisDoMultiPolygon(multi, grade, { toleranciaMm = PADROES.tolerancia_mm, areaMinMm2 = PADROES.area_min_mm2, areaMinFuroMm2 = PADROES.area_min_furo_mm2 } = {}) {
  const aneis = [];
  for (const poligono of multi.coordinates) {
    const ext = prepararAnel(poligono[0], grade, { toleranciaMm, horario: false });
    if (!ext || areaComSinal(ext) < areaMinMm2) continue;
    const furos = [];
    for (let i = 1; i < poligono.length; i++) {
      const furo = prepararAnel(poligono[i], grade, { toleranciaMm, horario: true });
      if (!furo || -areaComSinal(furo) < areaMinFuroMm2) continue;
      furos.push(furo);
    }
    aneis.push({ ext, furos });
  }
  return aneis;
}

export function retanguloDaPeca(larguraMm, alturaMm) {
  const x = Math.round(larguraMm * 50) / 100, y = Math.round(alturaMm * 50) / 100;
  return [[-x, -y], [x, -y], [x, y], [-x, y]];
}

// ---------------------------------------------------------------------------
// Campos e contornos
// ---------------------------------------------------------------------------

// Dois campos borrados: terra (raio pequeno; o Copernicus é modelo de superfície e prédio vira confete)
// e mar (raio grande, um bloco do GEBCO). O campo do mar recebe, nos nós de terra (terra >= 0), o
// máximo entre os dois, para a costa caber dentro de toda lâmina de mar: a pilha fica encaixada.
export function suavizarCampos(alturas, w, h, raioTerra, raioMar) {
  const n = w * h;
  if (alturas.length !== n) throw new Error(`suavizarCampos: ${alturas.length} valores para uma grade ${w}x${h}`);
  const terra = new Float32Array(alturas);
  if (raioTerra > 0) blur2({ data: terra, width: w, height: h }, raioTerra);
  const borradoMar = new Float32Array(alturas);
  if (raioMar > 0) blur2({ data: borradoMar, width: w, height: h }, raioMar);
  const mar = new Float32Array(n);
  for (let k = 0; k < n; k++) mar[k] = terra[k] >= 0 ? Math.max(borradoMar[k], terra[k]) : borradoMar[k];
  return { terra, mar };
}

// d3-contour: um MultiPolygon por nível, em coordenadas de célula. Devolve Map nível -> MultiPolygon.
export function contornar(campo, w, h, niveis) {
  const saida = new Map();
  if (!niveis.length) return saida;
  const resultados = contours().size([w, h]).smooth(true).thresholds(niveis)(campo);
  for (const r of resultados) saida.set(r.value, r);
  return saida;
}

function metrosPorNoDe(metrosPorNo) {
  if (typeof metrosPorNo === 'number') return metrosPorNo;
  if (metrosPorNo && Number.isFinite(metrosPorNo.x) && Number.isFinite(metrosPorNo.y)) return (metrosPorNo.x + metrosPorNo.y) / 2;
  throw new Error('metrosPorNo precisa ser número ou { x, y }');
}

function conferirPasso(nome, v) {
  if (v === undefined || v === null) return undefined;
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${nome} precisa ser um número > 0 em metros (veio ${JSON.stringify(v)})`);
  return v;
}

// Puro, sem fs: terreno (alturas, linha 0 = norte) -> corpo do laminas.json (sem slug, bbox, fontes).
export function gerarLaminas({ alturas, w, h, metrosPorNo, km, opcoes = {} }) {
  if (!(w >= 2 && h >= 2)) throw new Error(`grade inválida: ${w}x${h}`);
  if (!alturas || alturas.length !== w * h) throw new Error(`gerarLaminas: ${alturas ? alturas.length : 0} valores para uma grade ${w}x${h}`);
  if (!km || !(km.largura > 0) || !(km.altura > 0)) throw new Error('km.largura e km.altura precisam ser > 0');
  const larguraPedida = opcoes.largura_mm ?? PADROES.largura_mm;
  const espessuraMm = opcoes.espessura_mm ?? PADROES.espessura_mm;
  if (!(larguraPedida > 0) || !(espessuraMm > 0)) throw new Error('largura_mm e espessura_mm precisam ser > 0');
  const toleranciaMm = opcoes.tolerancia_mm ?? PADROES.tolerancia_mm;
  const areaMinMm2 = opcoes.area_min_mm2 ?? PADROES.area_min_mm2;
  const areaMinFuroMm2 = opcoes.area_min_furo_mm2 ?? Math.max(areaMinMm2, PADROES.area_min_furo_mm2);
  // largura e altura em múltiplos de 0,02 mm: a metade (a borda, com origem no centro) cai exata nas
  // 2 casas decimais dos pontos, e nenhum ponto arredondado sai do retângulo da lâmina 0
  const larguraMm = Math.round(larguraPedida * 50) / 50;
  const mmPorKm = larguraMm / km.largura;
  const alturaMm = Math.round(km.altura * mmPorKm * 50) / 50;
  const mpn = metrosPorNoDe(metrosPorNo);
  const suavizar = {
    terra_nos: opcoes.suavizar_terra_nos ?? suavizarTerraPadrao(mpn),
    mar_nos: opcoes.suavizar_mar_nos ?? Math.ceil(METROS_BLOCO_GEBCO / mpn),
  };
  const avisos = [];

  // 1) suavização por tipo
  const bruta = minMax(alturas);
  const campos = suavizarCampos(alturas, w, h, suavizar.terra_nos, suavizar.mar_nos);
  const exTerra = minMax(campos.terra), exMar = minMax(campos.mar);
  // os níveis saem dos campos contornados: o mínimo do campo do mar e o máximo do campo da terra,
  // senão a lâmina de cima (ou a de baixo) podia sair vazia ou repetir o retângulo
  const elevMin = Math.min(exTerra.min, exMar.min);
  const elevMax = exTerra.max;
  const temMar = elevMin < 0;

  // 2) passos: o exagero é consequência da espessura, do passo e da escala; os tetos valem só para
  // o passo escolhido aqui (passo vindo do lugar.json ou da linha de comando só gera aviso)
  const passoTerra = conferirPasso('passo_terra_m', opcoes.passo_terra_m) ?? escolherPassoTerra({ elevMax, elevMin, espessuraMm, mmPorKm });
  const passoMar = temMar ? (conferirPasso('passo_mar_m', opcoes.passo_mar_m) ?? escolherPassoMar({ elevMin, espessuraMm, mmPorKm })) : null;
  const escolhidos = { passo_terra_m: opcoes.passo_terra_m == null, passo_mar_m: temMar && opcoes.passo_mar_m == null };
  const nTerra = contarNiveisTerra(elevMax, passoTerra, elevMin);
  const nMar = temMar ? contarNiveisMar(elevMin, passoMar) : 0;
  const exagero = arredondar(exageroDe(espessuraMm, passoTerra, mmPorKm), 1);
  const exageroMar = temMar ? arredondar(exageroDe(espessuraMm, passoMar, mmPorKm), 1) : null;
  if (nTerra > MAX_LAMINAS_TERRA) avisos.push(`terra com ${nTerra} lâminas (mais que ${MAX_LAMINAS_TERRA}) no passo ${passoTerra} m`);
  if (temMar && nMar > MAX_LAMINAS_MAR) avisos.push(`mar com ${nMar} lâminas (mais que ${MAX_LAMINAS_MAR}) no passo ${passoMar} m`);
  if (exagero > EXAGERO_TERRA_MAX) {
    if (escolhidos.passo_terra_m && exagero <= EXAGERO_TERRA_PLANA_MAX) avisos.push(`lugar plano: terra com ${nTerra} lâminas no passo ${passoTerra} m, exagero ${fmtNum(exagero)}x (acima de ${EXAGERO_TERRA_MAX}x, dentro de ${EXAGERO_TERRA_PLANA_MAX}x)`);
    else avisos.push(`exagero da terra ${fmtNum(exagero)}x (acima de ${EXAGERO_TERRA_MAX}x) no passo ${passoTerra} m`);
  }
  if (temMar && exageroMar > EXAGERO_MAR_MAX) avisos.push(`exagero do mar ${fmtNum(exageroMar)}x (acima de ${EXAGERO_MAR_MAX}x) no passo ${passoMar} m`);
  const niveis = niveisDe({ elevMin, elevMax, passoTerra, passoMar });

  // 3) contornos: terra e costa no campo da terra, mar no campo do mar; lâmina 0 é o retângulo
  const grade = { w, h, larguraMm, alturaMm };
  const filtros = { toleranciaMm, areaMinMm2, areaMinFuroMm2 };
  const nvTerra = niveis.filter((n, k) => k > 0 && n.tipo !== 'mar').map((n) => n.nivel_m);
  const nvMar = niveis.filter((n, k) => k > 0 && n.tipo === 'mar').map((n) => n.nivel_m);
  const cTerra = contornar(campos.terra, w, h, nvTerra);
  const cMar = contornar(campos.mar, w, h, nvMar);
  const laminas = niveis.map((n, k) => {
    let aneis;
    if (k === 0) aneis = [{ ext: retanguloDaPeca(larguraMm, alturaMm), furos: [] }];
    else aneis = aneisDoMultiPolygon((n.tipo === 'mar' ? cMar : cTerra).get(n.nivel_m), grade, filtros);
    return { k, nivel_m: n.nivel_m, tipo: n.tipo, z_mm: Math.round((k + 1) * espessuraMm * 100) / 100, aneis };
  });
  // lâmina vazia só pode existir acima do máximo: tira do topo e avisa
  while (laminas.length > 1 && laminas[laminas.length - 1].aneis.length === 0) {
    const l = laminas.pop();
    avisos.push(`lâmina ${l.k} (${l.nivel_m} m) ficou sem anel acima de ${areaMinMm2} mm² e foi removida do topo`);
  }
  for (const l of laminas) if (l.aneis.length === 0) avisos.push(`lâmina ${l.k} (${l.nivel_m} m) ficou vazia no meio da pilha`);

  // 4) água: região terra <= 0 (complemento da costa), contornando -terra no nível 0
  let agua = null;
  if (temMar) {
    const neg = new Float32Array(w * h);
    for (let k = 0; k < neg.length; k++) neg[k] = -campos.terra[k];
    const c = contornar(neg, w, h, [0]).get(0);
    agua = { nivel_m: 0, aneis: aneisDoMultiPolygon(c, grade, filtros) };
  }

  // 5) exagero: calculado no passo 2, gravado aqui, nunca escondido
  const resumo = resumirLaminas(laminas, agua);
  return {
    largura_mm: larguraMm,
    altura_mm: alturaMm,
    mm_por_km: arredondar(mmPorKm, 4),
    espessura_mm: espessuraMm,
    passo_terra_m: passoTerra,
    passo_mar_m: passoMar,
    exagero,
    exagero_mar: exageroMar,
    elev_min_m: arredondar(elevMin, 1),
    elev_max_m: arredondar(elevMax, 1),
    elev_bruta_m: { min: arredondar(bruta.min, 1), max: arredondar(bruta.max, 1) },
    suavizar,
    area_min_mm2: areaMinMm2,
    area_min_furo_mm2: areaMinFuroMm2,
    tolerancia_mm: toleranciaMm,
    laminas,
    agua,
    resumo,
    escolhidos,
    avisos,
  };
}

export function resumirLaminas(laminas, agua = null) {
  let nAneis = 0, maior = 0, pontos = 0;
  const conta = (anel) => { nAneis++; pontos += anel.length; if (anel.length > maior) maior = anel.length; };
  for (const l of laminas) for (const a of l.aneis) { conta(a.ext); for (const f of a.furos) conta(f); }
  if (agua) for (const a of agua.aneis) { conta(a.ext); for (const f of a.furos) conta(f); }
  return {
    laminas: laminas.length,
    terra: laminas.filter((l) => l.tipo === 'terra').length,
    costa: laminas.filter((l) => l.tipo === 'costa').length,
    mar: laminas.filter((l) => l.tipo === 'mar').length,
    aneis: nAneis,
    maior_anel_pontos: maior,
    pontos,
  };
}

// ---------------------------------------------------------------------------
// Gravação: anéis compactos (uma lâmina por linha), resto legível
// ---------------------------------------------------------------------------

export function serializarLaminas(obj) {
  const chaves = Object.keys(obj);
  const linhas = ['{'];
  chaves.forEach((chave, i) => {
    const v = obj[chave];
    let texto;
    if (chave === 'laminas' && Array.isArray(v)) texto = v.length ? `[\n${v.map((l) => `    ${JSON.stringify(l)}`).join(',\n')}\n  ]` : '[]';
    else if (chave === 'agua' && v) texto = JSON.stringify(v);
    else texto = JSON.stringify(v === undefined ? null : v, null, 2).replace(/\n/g, '\n  ');
    linhas.push(`  ${JSON.stringify(chave)}: ${texto}${i < chaves.length - 1 ? ',' : ''}`);
  });
  linhas.push('}');
  return `${linhas.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const o = { _: [], silencioso: false, ajuda: false };
  const numero = (i, nome) => {
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new Error(`opção ${nome} precisa de um valor`);
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) throw new Error(`opção ${nome} precisa de um número > 0 (veio "${v}")`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--largura-mm': o.largura_mm = numero(i, a); i++; break;
      case '--espessura-mm': o.espessura_mm = numero(i, a); i++; break;
      case '--passo-terra': o.passo_terra_m = numero(i, a); i++; break;
      case '--passo-mar': o.passo_mar_m = numero(i, a); i++; break;
      case '--suavizar-terra': o.suavizar_terra_nos = numero(i, a); i++; break;
      case '--suavizar-mar': o.suavizar_mar_nos = numero(i, a); i++; break;
      case '--area-min': o.area_min_mm2 = numero(i, a); i++; break;
      case '--tolerancia-mm': o.tolerancia_mm = numero(i, a); i++; break;
      case '--silencioso': o.silencioso = true; break;
      case '--ajuda': case '-h': case '--help': o.ajuda = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`opção desconhecida: ${a} (veja --ajuda)`);
        o._.push(a);
    }
  }
  for (const c of ['suavizar_terra_nos', 'suavizar_mar_nos']) {
    if (o[c] !== undefined && !Number.isInteger(o[c])) throw new Error(`--${c.replace('_nos', '').replace('_', '-')} precisa ser inteiro em nós (veio ${o[c]})`);
  }
  return o;
}

// Opções efetivas: linha de comando > lugar.json (bloco maquete) > padrão (resolvido em gerarLaminas).
export function opcoesDoLugar(maquete = {}, cli = {}) {
  const m = maquete && typeof maquete === 'object' ? maquete : {};
  return {
    largura_mm: cli.largura_mm ?? m.largura_mm,
    espessura_mm: cli.espessura_mm ?? m.espessura_mm,
    passo_terra_m: cli.passo_terra_m ?? m.passo_terra_m,
    passo_mar_m: cli.passo_mar_m ?? m.passo_mar_m,
    suavizar_terra_nos: cli.suavizar_terra_nos ?? m.suavizar?.terra_nos,
    suavizar_mar_nos: cli.suavizar_mar_nos ?? m.suavizar?.mar_nos,
    area_min_mm2: cli.area_min_mm2 ?? m.area_min_mm2,
    area_min_furo_mm2: m.area_min_furo_mm2,
    tolerancia_mm: cli.tolerancia_mm ?? m.tolerancia_mm,
  };
}

// Lê o lugar e o terreno, gera e grava lugares/<slug>/laminas.json. Devolve { caminho, bytes, saida }.
export async function gerarArquivo({ raiz, slug, opcoes = {}, log = () => {} }) {
  const t0 = performance.now();
  const lugar = lerLugar(raiz, slug);
  const caminhoPng = path.join(lugar.pasta, 'terreno.png');
  const caminhoTerreno = path.join(lugar.pasta, 'terreno.json');
  for (const c of [caminhoPng, caminhoTerreno]) {
    if (!fs.existsSync(c)) throw new Error(`${path.relative(process.cwd(), c)} não existe; gere o terreno antes: node cli/index.mjs ${slug}`);
  }
  let terreno;
  try { terreno = JSON.parse(fs.readFileSync(caminhoTerreno, 'utf8')); } catch (e) { throw new Error(`terreno.json inválido: ${e.message}`); }
  const png = lerTerrenoPng(caminhoPng);
  if (png.largura !== terreno.largura || png.altura !== terreno.altura) {
    throw new Error(`terreno.png (${png.largura}x${png.altura}) não bate com terreno.json (${terreno.largura}x${terreno.altura}); rode node cli/index.mjs ${slug} de novo`);
  }
  if (!terreno.km || !terreno.metros_por_no) throw new Error('terreno.json sem km ou metros_por_no');
  log(`${slug} (${lugar.nome}): grade ${png.largura}x${png.altura} nós, ${fmtNum(terreno.km.largura)} x ${fmtNum(terreno.km.altura)} km, ${fmtNum(terreno.metros_por_no.x, 1)} m/nó, elevação bruta ${fmtNum(terreno.elev_min_m)} a ${fmtNum(terreno.elev_max_m)} m`);

  const opcoesGerar = opcoesDoLugar(lugar.maquete, opcoes);
  const tG = performance.now();
  const r = gerarLaminas({ alturas: png.alturas, w: png.largura, h: png.altura, metrosPorNo: terreno.metros_por_no, km: terreno.km, opcoes: opcoesGerar });
  const { resumo, escolhidos, avisos, ...corpo } = r;
  for (const a of avisos) log(`aviso: ${a}`);

  const saida = {
    slug,
    nome: lugar.nome,
    bbox: terreno.bbox,
    km: terreno.km,
    ...corpo,
    fontes: terreno.fontes || [],
    mascara: { pct_medido: terreno.mascara && Number.isFinite(terreno.mascara.pct_medido) ? terreno.mascara.pct_medido : null },
    gerado_por: `${PACOTE.name} ${PACOTE.version}`,
    gerado_em: agoraIso(),
  };
  const caminho = path.join(lugar.pasta, 'laminas.json');
  const texto = serializarLaminas(saida);
  fs.writeFileSync(caminho, texto);
  const bytes = Buffer.byteLength(texto);

  // passos escolhidos pelo algoritmo vão para o lugar.json, para a rodada seguinte sair igual
  const gravados = gravarPassosNoLugar(lugar.caminho, r, escolhidos);
  if (gravados.length) log(`lugar.json: gravado ${gravados.join(', ')} no bloco "maquete"`);

  log(`lâminas: ${resumo.laminas} (${resumo.mar} mar, ${resumo.costa} costa, ${resumo.terra} terra); passo terra ${r.passo_terra_m} m${r.passo_mar_m ? `, mar ${r.passo_mar_m} m` : ''}; exagero ${fmtNum(r.exagero)}x na terra${r.exagero_mar ? ` e ${fmtNum(r.exagero_mar)}x no mar` : ''}; suavizar terra ${r.suavizar.terra_nos} / mar ${r.suavizar.mar_nos} nós; ${fmtSegundos(performance.now() - tG)}`);
  log(`anéis: ${resumo.aneis} (maior com ${resumo.maior_anel_pontos} pontos, ${resumo.pontos} no total); tolerância ${fmtNum(r.tolerancia_mm, 2)} mm`);
  log(`gravado: ${path.relative(process.cwd(), caminho)} (${fmtBytes(bytes)}) em ${fmtSegundos(performance.now() - t0)}`);
  return { caminho, bytes, saida, resumo, avisos };
}

// Grava no lugar.json os passos que o algoritmo escolheu (só os que não estavam lá) e os padrões de
// largura e espessura, sem mexer no resto do arquivo. Devolve a lista do que gravou.
export function gravarPassosNoLugar(caminhoLugar, r, escolhidos) {
  let bruto;
  try { bruto = JSON.parse(fs.readFileSync(caminhoLugar, 'utf8')); } catch { return []; }
  const m = bruto.maquete && typeof bruto.maquete === 'object' ? { ...bruto.maquete } : {};
  const gravados = [];
  const poe = (chave, valor) => { if (m[chave] === undefined && valor != null) { m[chave] = valor; gravados.push(`${chave} = ${valor}`); } };
  poe('largura_mm', r.largura_mm);
  poe('espessura_mm', r.espessura_mm);
  if (escolhidos.passo_terra_m) poe('passo_terra_m', r.passo_terra_m);
  if (escolhidos.passo_mar_m) poe('passo_mar_m', r.passo_mar_m);
  poe('material', PADROES.material);
  if (!gravados.length) return [];
  escreverJson(caminhoLugar, { ...bruto, maquete: m });
  return gravados;
}

export async function main(argv = process.argv.slice(2)) {
  const opcoes = parseArgs(argv);
  if (opcoes.ajuda || !opcoes._.length) {
    console.log(AJUDA);
    return opcoes.ajuda ? 0 : 2;
  }
  if (opcoes._.length > 1) throw new Error(`um lugar por vez (veio ${opcoes._.join(', ')})`);
  const slug = opcoes._[0];
  const log = opcoes.silencioso ? () => {} : (m) => console.log(m);
  const raiz = raizDosLugares(process.cwd(), slug);
  await gerarArquivo({ raiz, slug, opcoes, log });
  return 0;
}

if (ehPrincipal(import.meta.url)) {
  main().then((codigo) => { process.exitCode = codigo; }).catch((e) => {
    console.error(`erro: ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  });
}

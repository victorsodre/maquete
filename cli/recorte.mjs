// Recorte do terreno pelo polígono do IBGE: rasteriza o MultiPolygon (com furos) na grade de saída
// (scanline por linha, regra par-ímpar, centro do nó em lonDoNo/latDoNo) e aplica um dos dois recortes:
//   contorno: tudo fora do polígono (terra vizinha e mar) vira FORA (h = -10000 exato, R=G=B=0);
//   caixa:    nada é FORA; terra fora do polígono (h > 0) é chapada em 0 m, o mar continua com batimetria.
// Quem lê o terreno.png trata h <= FORA_LIMIAR_M como fora (não é terra nem mar).
import { lonDoNo, latDoNo, arredondar } from './terrain.mjs';

export const FORA_M = -10000;
export const FORA_LIMIAR_M = -9999;
export const RECORTES = ['contorno', 'caixa'];

export function ehFora(h) { return h <= FORA_LIMIAR_M; }

export function validarRecorte(tipo) {
  if (!RECORTES.includes(tipo)) throw new Error(`recorte desconhecido: "${tipo}" (use ${RECORTES.join(' ou ')})`);
  return tipo;
}

// Máscara Uint8Array (1 = dentro) com um byte por nó da grade, linha 0 = norte.
// Todos os anéis de todos os polígonos entram no mesmo teste par-ímpar: furos e ilhas saem certos
// sem saber qual anel é externo. Aresta meio-aberta ([y0, y1)) para o vértice exato não contar duas vezes.
export function rasterizarPoligonos(poligonos, bbox, grade) {
  const w = grade.largura, h = grade.altura;
  const dentro = new Uint8Array(w * h);
  const arestas = [];
  for (const poligono of poligonos) {
    for (const anel of poligono) {
      const n = anel.length;
      for (let a = 0; a < n; a++) {
        const p = anel[a], q = anel[(a + 1) % n];
        if (p[1] === q[1]) continue;                        // horizontal: nunca cruza uma linha de varredura
        if (p[0] === q[0] && p[1] === q[1]) continue;
        arestas.push(p[1] < q[1] ? [p[0], p[1], q[0], q[1]] : [q[0], q[1], p[0], p[1]]);   // y0 < y1
      }
    }
  }
  if (!arestas.length) return { dentro, nos_dentro: 0 };
  // Arestas ordenadas por y0 e varridas com um índice que só avança: as linhas vão do norte (lat alta)
  // para o sul, então varremos em lat decrescente com as arestas ordenadas por y1 decrescente.
  arestas.sort((a, b) => b[3] - a[3]);
  const ativas = [];
  let proxima = 0;
  const cruzamentos = [];
  let nosDentro = 0;
  const dLon = grade.graus_por_no.lon;
  for (let j = 0; j < h; j++) {
    const lat = latDoNo(bbox, grade, j);
    while (proxima < arestas.length && arestas[proxima][3] > lat) ativas.push(arestas[proxima++]);
    cruzamentos.length = 0;
    for (let k = ativas.length - 1; k >= 0; k--) {
      const e = ativas[k];
      if (e[1] > lat) { ativas[k] = ativas[ativas.length - 1]; ativas.pop(); continue; }   // já passou (y0 > lat)
      // regra meio-aberta: cruza quando y0 <= lat < y1
      if (e[1] <= lat && lat < e[3]) cruzamentos.push(e[0] + (lat - e[1]) * (e[2] - e[0]) / (e[3] - e[1]));
    }
    if (cruzamentos.length < 2) continue;
    cruzamentos.sort((a, b) => a - b);
    const base = j * w;
    for (let c = 0; c + 1 < cruzamentos.length; c += 2) {
      // nó i está em lon = oeste + (i + 0,5) * dLon; dentro quando xa <= lon < xb
      let i0 = Math.ceil((cruzamentos[c] - bbox.oeste) / dLon - 0.5);
      let i1 = Math.ceil((cruzamentos[c + 1] - bbox.oeste) / dLon - 0.5) - 1;
      if (i0 < 0) i0 = 0;
      if (i1 > w - 1) i1 = w - 1;
      for (let i = i0; i <= i1; i++) {
        if (!dentro[base + i]) { dentro[base + i] = 1; nosDentro++; }
      }
    }
  }
  return { dentro, nos_dentro: nosDentro };
}

// Aplica o recorte sobre `alturas` (Float32Array, no lugar) usando a máscara. Devolve as contagens.
export function aplicarRecorte(alturas, dentro, tipo) {
  validarRecorte(tipo);
  if (alturas.length !== dentro.length) throw new Error(`aplicarRecorte: ${alturas.length} alturas para ${dentro.length} nós da máscara`);
  let nosDentro = 0, nosFora = 0, nosChapados = 0;
  for (let k = 0; k < alturas.length; k++) {
    if (dentro[k]) { nosDentro++; continue; }
    if (tipo === 'contorno') { alturas[k] = FORA_M; nosFora++; } else if (alturas[k] > 0) { alturas[k] = 0; nosChapados++; }
  }
  return { nos_dentro: nosDentro, nos_fora: nosFora, nos_chapados: nosChapados, nos: alturas.length };
}

// Rasteriza e aplica de uma vez. Devolve { dentro, resumo } com o bloco "recorte" do terreno.json.
export function recortarTerreno({ alturas, poligonos, bbox, grade, tipo, ibge }) {
  validarRecorte(tipo);
  const { dentro } = rasterizarPoligonos(poligonos, bbox, grade);
  const c = aplicarRecorte(alturas, dentro, tipo);
  return { dentro, resumo: resumoRecorte({ tipo, ibge, contagens: c }) };
}

export function resumoRecorte({ tipo, ibge, contagens }) {
  return {
    tipo,
    ibge_nivel: ibge ? ibge.nivel : null,
    ibge_codigo: ibge ? String(ibge.codigo) : null,
    nos_dentro: contagens.nos_dentro,
    fracao_dentro: contagens.nos ? arredondar(contagens.nos_dentro / contagens.nos, 4) : 0,
    nos_fora: contagens.nos_fora,
    nos_chapados: contagens.nos_chapados,
  };
}

// Mínimo e máximo ignorando os nós FORA (e NaN).
export function minMaxDentro(alturas) {
  let mn = Infinity, mx = -Infinity;
  for (let k = 0; k < alturas.length; k++) {
    const v = alturas[k];
    if (v !== v || ehFora(v)) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return { min: mn, max: mx };
}

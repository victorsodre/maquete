// pilha.js — geometria da maquete a partir do laminas.json (puro: só three, sem DOM).
// Roda no navegador (importmap "three") e no Node (devDependency three, mesma r185) para teste.
//
// Cada lâmina k vira uma ExtrudeGeometry (Shape por anel externo com holes dos furos, depth =
// espessura_mm, sem bevel) deitada no plano x-z com a base em k * espessura_mm. A tampa de baixo
// nunca aparece (encosta na lâmina de baixo ou na mesa) e é descartada. Tudo da mesma família
// (terra = terra + costa; mar) é fundido numa geometria só com dois grupos de material:
// 0 = tampo, 1 = parede. A rampa de azul do mar vai em cor por vértice (atributo "color"), com a
// fração de profundidade guardada em userData.fracao para retingir ao trocar o material.
//
// Eixos (SPEC): laminas.json em mm, x leste, y norte. Cena: x = x, z = -y, y = altura.
import * as THREE from 'three';

export const AREA_MIN_MM2 = 0.5;        // anel menor que isso derruba o earcut; descartado
export const ESCALA_TEXTURA_MM = 150;    // 1 textura cobre ~150 mm do tampo
export const GRAUS_POR_LAMINA = 37;      // rotação do UV por lâmina, para a madeira não repetir

// Rampas do mar por material (da mais rasa para a mais funda), interpoladas por índice da lâmina.
export const RAMPAS = {
  compensado: ['#9fc4d8', '#7fb0cc', '#5e97bb', '#4379a3', '#2f5d87', '#1f4468', '#163553', '#0f2740'],
  cartao: ['#a9c3cf', '#2b4b63'],
  gesso: ['#c9d2d6', '#6f8794'],
};

export function areaComSinal(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// Deduplica pontos consecutivos (e o fecho repetido), exige 3+ pontos e área >= AREA_MIN_MM2.
// Devolve a lista limpa ou null (anel degenerado).
export function limparAnel(pontos) {
  if (!Array.isArray(pontos)) return null;
  const out = [];
  for (const p of pontos) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const u = out[out.length - 1];
    if (u && Math.abs(u[0] - p[0]) < 1e-6 && Math.abs(u[1] - p[1]) < 1e-6) continue;
    out.push([p[0], p[1]]);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop(); else break;
  }
  if (out.length < 3) return null;
  if (Math.abs(areaComSinal(out)) < AREA_MIN_MM2) return null;
  return out;
}

const v2 = (pts) => pts.map((p) => new THREE.Vector2(p[0], p[1]));

// Shapes (com holes) de uma lista de anéis { ext, furos }. Conta o que descartou.
export function shapesDosAneis(aneis, contagem = { descartados: 0 }) {
  const shapes = [];
  for (const anel of aneis || []) {
    const ext = limparAnel(anel && anel.ext);
    if (!ext) { contagem.descartados++; continue; }
    const shape = new THREE.Shape(v2(ext));
    for (const furo of (anel.furos || [])) {
      const f = limparAnel(furo);
      if (!f) { contagem.descartados++; continue; }
      shape.holes.push(new THREE.Path(v2(f)));
    }
    shapes.push(shape);
  }
  return shapes;
}

function fracoesDoMar(laminas) {
  const niveis = laminas.filter((l) => l.tipo === 'mar').map((l) => l.nivel_m).sort((a, b) => b - a); // rasa primeiro
  const n = niveis.length;
  const mapa = new Map();
  niveis.forEach((nivel, i) => mapa.set(nivel, n > 1 ? i / (n - 1) : 0));
  return (l) => (mapa.has(l.nivel_m) ? mapa.get(l.nivel_m) : 0);
}

class Balde {
  constructor(comCor) { this.pos = []; this.nor = []; this.uv = []; this.cor = comCor ? [] : null; this.fracao = comCor ? [] : null; this.tampo = 0; this.parede = 0; }
  get vertices() { return this.pos.length / 3; }
}

// Copia a faixa [inicio, inicio+n) de vértices da ExtrudeGeometry (espaço do Shape: x leste,
// y norte, z = altura dentro da lâmina) para o balde, já no espaço da cena.
function copiar(balde, geom, inicio, n, { k, espessura, tampo, fracao }) {
  const P = geom.attributes.position, N = geom.attributes.normal, UV = geom.attributes.uv;
  const ang = (k * GRAUS_POR_LAMINA) * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang);
  const S = ESCALA_TEXTURA_MM;
  const yBase = k * espessura;
  for (let i = inicio; i < inicio + n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    balde.pos.push(x, z + yBase, -y);
    balde.nor.push(N.getX(i), N.getZ(i), -N.getY(i));
    if (tampo) balde.uv.push((x * c - y * s) / S, (x * s + y * c) / S);
    else balde.uv.push(UV.getX(i) / S, (1 - UV.getY(i)) / S);
    if (balde.fracao) { balde.fracao.push(fracao); balde.cor.push(1, 1, 1); }
  }
}

function geometriaDoBalde(balde) {
  if (!balde.vertices) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(balde.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(balde.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(balde.uv, 2));
  if (balde.cor) {
    g.setAttribute('color', new THREE.Float32BufferAttribute(balde.cor, 3));
    g.userData.fracao = Float32Array.from(balde.fracao);
  }
  g.addGroup(0, balde.tampo, 0);
  g.addGroup(balde.tampo, balde.parede, 1);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// laminas.json -> { terra, mar } (BufferGeometry ou null), mais contagens para o console.
export function construirPilha(laminas, { espessura_mm }) {
  const e = Number(espessura_mm) || 3;
  const fracaoDe = fracoesDoMar(laminas);
  const terra = new Balde(false), mar = new Balde(true);
  const contagem = { descartados: 0, vazias: 0, triangulos: 0 };
  // primeiro os tampos (grupo 0), depois as paredes (grupo 1), para cada família
  const faixas = { terra: { tampo: [], parede: [] }, mar: { tampo: [], parede: [] } };
  for (const l of laminas) {
    const shapes = shapesDosAneis(l.aneis, contagem);
    if (!shapes.length) { contagem.vazias++; continue; }
    const geom = new THREE.ExtrudeGeometry(shapes, { depth: e, bevelEnabled: false, steps: 1 });
    const fam = l.tipo === 'mar' ? 'mar' : 'terra';
    for (const gr of geom.groups) {
      if (gr.materialIndex === 0) {
        const metade = gr.count / 2;          // primeira metade = tampa de baixo (descartada)
        faixas[fam].tampo.push({ geom, inicio: gr.start + metade, n: metade, k: l.k, fracao: fracaoDe(l) });
      } else {
        faixas[fam].parede.push({ geom, inicio: gr.start, n: gr.count, k: l.k, fracao: fracaoDe(l) });
      }
    }
  }
  for (const [fam, balde] of [['terra', terra], ['mar', mar]]) {
    for (const f of faixas[fam].tampo) { copiar(balde, f.geom, f.inicio, f.n, { k: f.k, espessura: e, tampo: true, fracao: f.fracao }); balde.tampo += f.n; }
    for (const f of faixas[fam].parede) { copiar(balde, f.geom, f.inicio, f.n, { k: f.k, espessura: e, tampo: false, fracao: f.fracao }); balde.parede += f.n; }
  }
  for (const f of [...faixas.terra.tampo, ...faixas.mar.tampo]) f.geom.dispose();
  contagem.triangulos = (terra.vertices + mar.vertices) / 3;
  return { terra: geometriaDoBalde(terra), mar: geometriaDoBalde(mar), ...contagem };
}

// Moldura: anel retangular (4 paredes de `parede` mm) em volta da peça, da mesa (y = 0) até yTopo,
// com as lâminas e a placa encaixadas por dentro (vão interno = largura x altura, mais `folga` por
// lado). Uma carta batimétrica de verdade vem numa caixa: sem ela, as lâminas de mar descem em
// degraus escuros até a mesa e a placa parece flutuar. A tampa de baixo encosta na mesa e é
// descartada (z-fighting com o plano). Grupos: 0 = tampo (UV = x, y / 150 mm), 1 = paredes.
export function geometriaMoldura({ largura, altura, parede = 6, yTopo, folga = 0 }) {
  const L = Number(largura), A = Number(altura), p = Number(parede), h = Number(yTopo), f = Math.max(0, Number(folga) || 0);
  if (!(L > 0) || !(A > 0) || !(p > 0) || !(h > 0)) return null;
  const retangulo = (w, a) => [new THREE.Vector2(-w / 2, -a / 2), new THREE.Vector2(w / 2, -a / 2), new THREE.Vector2(w / 2, a / 2), new THREE.Vector2(-w / 2, a / 2)];
  const shape = new THREE.Shape(retangulo(L + 2 * (p + f), A + 2 * (p + f)));          // anti-horário
  shape.holes.push(new THREE.Path(retangulo(L + 2 * f, A + 2 * f).reverse()));          // horário
  const geom = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
  const balde = new Balde(false);
  const opts = { k: 0, espessura: 0, tampo: true, fracao: 0 };
  for (const gr of geom.groups) {
    if (gr.materialIndex !== 0) continue;
    const metade = gr.count / 2;              // primeira metade = tampa de baixo (descartada)
    copiar(balde, geom, gr.start + metade, metade, opts);
    balde.tampo += metade;
  }
  for (const gr of geom.groups) {
    if (gr.materialIndex === 0) continue;
    copiar(balde, geom, gr.start, gr.count, { ...opts, tampo: false });
    balde.parede += gr.count;
  }
  geom.dispose();
  return geometriaDoBalde(balde);
}

// Placa de acrílico do mar: agua.aneis extrudados em `espessura` (2 mm), topo em yTopo.
export function geometriaPlaca(agua, { espessura = 2, yTopo }) {
  const contagem = { descartados: 0 };
  const shapes = shapesDosAneis(agua && agua.aneis, contagem);
  if (!shapes.length) return null;
  const g = new THREE.ExtrudeGeometry(shapes, { depth: espessura, bevelEnabled: false, steps: 1 });
  g.clearGroups();                       // um material só: uma chamada de desenho
  g.rotateX(-Math.PI / 2);               // z da extrusão vira y (altura); y (norte) vira -z
  g.translate(0, yTopo - espessura, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Pinta o atributo "color" da geometria do mar pela rampa (fração 0 = rasa, 1 = funda).
export function tintarMar(geom, rampa) {
  if (!geom || !geom.userData.fracao) return;
  const cores = rampa.map((h) => new THREE.Color(h));
  const n = cores.length;
  const cor = geom.attributes.color;
  const fr = geom.userData.fracao;
  const tmp = new THREE.Color();
  for (let i = 0; i < fr.length; i++) {
    const p = fr[i] * (n - 1);
    const a = Math.min(n - 1, Math.floor(p)), b = Math.min(n - 1, a + 1);
    tmp.lerpColors(cores[a], cores[b], p - a);
    cor.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  cor.needsUpdate = true;
}

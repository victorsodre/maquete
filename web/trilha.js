// trilha.js — interpolação determinística da trilha de câmera (sem three, roda no
// navegador e no Node). Posições e alvos: Catmull-Rom centrípeta por todos os
// keyframes, com o tempo mapeado ao parâmetro da curva por Hermite monótona
// (Fritsch–Carlson, extremos em repouso): cada keyframe é atingido no seu `t`
// e a velocidade é contínua, sem solavanco. `levantar` (placa do mar, 0..1) e fov:
// Hermite monótona com extremos em repouso.
//
// Herdado do projeto anterior; adaptado para a maquete: o campo `nivel_agua_m` virou
// `levantar` e a trilha padrão (sem camera.json) é uma volta de produto analítica.

function hermiteMonotona(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = new Array(n - 1), m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || Math.sign(d[i - 1]) !== Math.sign(d[i])) { m[i] = 0; continue; }
    const h1 = xs[i] - xs[i - 1], h2 = xs[i + 1] - xs[i];
    m[i] = 3 * (h1 + h2) / ((2 * h2 + h1) / d[i - 1] + (h2 + 2 * h1) / d[i]);
  }
  m[0] = 0; m[n - 1] = 0; // extremos em repouso
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x >= xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], s = (x - xs[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i]
         + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// Catmull-Rom não uniforme (Barry–Goldman) com nós centrípetos (alpha = 0,5)
function curvaCentripeta(pontos) {
  const n = pontos.length;
  if (n === 1) return { nos: [0], em: () => pontos[0].slice() };
  const P = [add(pontos[0], sub(pontos[0], pontos[1])), ...pontos, add(pontos[n - 1], sub(pontos[n - 1], pontos[n - 2]))];
  const nos = [0];
  for (let i = 1; i < n; i++) nos.push(nos[i - 1] + Math.sqrt(Math.max(len(sub(pontos[i], pontos[i - 1])), 1e-6)));
  const tramo = (i) => {
    const p0 = P[i], p1 = P[i + 1], p2 = P[i + 2], p3 = P[i + 3];
    const t0 = 0, t1 = Math.sqrt(Math.max(len(sub(p1, p0)), 1e-6)), t2 = t1 + Math.sqrt(Math.max(len(sub(p2, p1)), 1e-6)), t3 = t2 + Math.sqrt(Math.max(len(sub(p3, p2)), 1e-6));
    return (s) => {
      const t = t1 + s * (t2 - t1);
      const A1 = add(mul(p0, (t1 - t) / (t1 - t0)), mul(p1, (t - t0) / (t1 - t0)));
      const A2 = add(mul(p1, (t2 - t) / (t2 - t1)), mul(p2, (t - t1) / (t2 - t1)));
      const A3 = add(mul(p2, (t3 - t) / (t3 - t2)), mul(p3, (t - t2) / (t3 - t2)));
      const B1 = add(mul(A1, (t2 - t) / (t2 - t0)), mul(A2, (t - t0) / (t2 - t0)));
      const B2 = add(mul(A2, (t3 - t) / (t3 - t1)), mul(A3, (t - t1) / (t3 - t1)));
      return add(mul(B1, (t2 - t) / (t2 - t1)), mul(B2, (t - t1) / (t2 - t1)));
    };
  };
  const tramos = []; for (let i = 0; i < n - 1; i++) tramos.push(tramo(i));
  return {
    nos,
    em: (u) => {
      if (u <= 0) return pontos[0].slice();
      if (u >= nos[n - 1]) return pontos[n - 1].slice();
      let i = 0; while (i < n - 2 && u >= nos[i + 1]) i++;
      return tramos[i]((u - nos[i]) / (nos[i + 1] - nos[i]));
    },
  };
}

export const FOV_PADRAO = 32;

// camera.json: { "duracao_s"?, "fps"?, "keyframes": [{ "t", "pos": [x,y,z], "alvo": [x,y,z], "fov"?, "levantar"? }] }
// em mm da cena (x leste, y para cima, z sul). Devolve { duracao, fps, keyframes, padrao: false, amostrar(t) }.
export function prepararTrilha(trilha) {
  if (!trilha || !Array.isArray(trilha.keyframes) || trilha.keyframes.length === 0) {
    throw new Error('camera.json precisa de "keyframes": lista com pelo menos 1 keyframe {t, pos, alvo}');
  }
  const ks = [...trilha.keyframes].sort((a, b) => a.t - b.t);
  const ts = ks.map((k) => k.t);
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    const vetor = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    if (!Number.isFinite(k.t) || !vetor(k.pos) || !vetor(k.alvo)) throw new Error(`camera.json: keyframe ${i} precisa de t numérico, pos [x, y, z] e alvo [x, y, z]`);
    if (i > 0 && !(ts[i] > ts[i - 1])) throw new Error(`camera.json: os t dos keyframes têm de ser crescentes (t=${ts[i - 1]} e t=${ts[i]} repetidos ou fora de ordem)`);
  }
  const cPos = curvaCentripeta(ks.map((k) => k.pos));
  const cAlvo = curvaCentripeta(ks.map((k) => k.alvo));
  const uPos = hermiteMonotona(ts, cPos.nos);
  const uAlvo = hermiteMonotona(ts, cAlvo.nos);
  // levantar e fov: só os keyframes que declaram o campo viram nós da curva
  const curvaCampo = (campo, padrao) => {
    const sel = ks.filter((k) => Number.isFinite(k[campo]));
    if (!sel.length) return () => padrao;
    return hermiteMonotona(sel.map((k) => k.t), sel.map((k) => k[campo]));
  };
  const levantar = curvaCampo('levantar', 0);
  const fov = curvaCampo('fov', FOV_PADRAO);
  const duracao = trilha.duracao_s ?? ts[ts.length - 1];
  return {
    duracao, fps: trilha.fps ?? 30, keyframes: ks, padrao: false,
    amostrar: (t) => ({
      t, pos: cPos.em(uPos(t)), alvo: cAlvo.em(uAlvo(t)), levantar: Math.min(1, Math.max(0, levantar(t))), fov: fov(t),
    }),
  };
}

const prender01 = (x) => Math.min(1, Math.max(0, x));
const suave = (a, b, x) => { const s = prender01((x - a) / (b - a)); return s * s * (3 - 2 * s); };

// Trilha padrão (sem camera.json): volta de produto, 12 s, 35° de elevação, raio 1,7 x largura
// (largura = o maior lado da peça, já com a moldura; mais longe em tela estreita, para a peça caber
// inteira), alvo no centro da pilha. A placa do mar sobe de 0 a 1 entre 4 s e 7 s e desce entre 9 s
// e 11,5 s. Função pura de t.
export function trilhaPadrao({ largura_mm, altura_mm, espessura_mm, n_laminas, aspecto = 16 / 9, duracao = 12 } = {}) {
  const L = Math.max(Number(largura_mm) || 300, Number(altura_mm) || 0);   // o maior lado manda no raio (Floripa é mais alta que larga)
  const yAlvo = (Number(espessura_mm) || 3) * (Number(n_laminas) || 1) / 2;
  const elev = 35 * Math.PI / 180;
  const fator = Math.min(3.2, Math.max(1, Math.pow(1.6 / (Number(aspecto) || 16 / 9), 0.92)));   // 9:16 → 2,6x mais longe (a diagonal da peça com moldura e a placa levantada cabem com margem)
  const r = 1.7 * L * fator;
  const a0 = -0.55;   // começa um pouco à esquerda da frente (sul), vendo a costa de frente
  return {
    duracao, fps: 30, keyframes: null, padrao: true,
    amostrar: (t) => {
      const a = a0 + (2 * Math.PI) * (t / duracao);
      const tl = ((t % duracao) + duracao) % duracao;
      return {
        t,
        pos: [r * Math.cos(elev) * Math.sin(a), yAlvo + r * Math.sin(elev), r * Math.cos(elev) * Math.cos(a)],
        alvo: [0, yAlvo, 0],
        levantar: suave(4, 7, tl) * (1 - suave(9, 11.5, tl)),
        fov: FOV_PADRAO,
      };
    },
  };
}

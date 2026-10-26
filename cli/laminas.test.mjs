// Testes offline do laminas.mjs: terreno sintético (cone com ilha, lagoa com ilhota dentro, mar ao
// redor com fundo inclinado), funções puras e a CLI numa pasta temporária.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  gerarLaminas, gerarArquivo, parseArgs, opcoesDoLugar, serializarLaminas, resumirLaminas,
  contarNiveisTerra, contarNiveisMar, escolherPasso, escolherPassoTerra, escolherPassoMar, niveisDe,
  areaComSinal, pontoDentro, semRepetidos, simplificar, orientar, arredondarPonto, celulaParaMm,
  retanguloDaPeca, suavizarCampos, contornar, aneisDoMultiPolygon, exageroDe, suavizarTerraPadrao,
  PASSOS_M, MAX_LAMINAS_TERRA, MAX_LAMINAS_MAR, MIN_LAMINAS_MAR, MIN_LAMINAS_TERRA_PLANA,
  EXAGERO_TERRA_MAX, EXAGERO_TERRA_PLANA_MAX, EXAGERO_MAR_MAX, PADROES, AJUDA,
} from './laminas.mjs';
import { escreverTerrenoPng } from './terrain.mjs';

// ---------------------------------------------------------------------------
// Terreno sintético: 160x120 nós a 100 m/nó (16 x 12 km). Ilha cônica (raio 40 nós, 300 m no topo)
// com lagoa (-5 m) entre os raios 5 e 12 e uma ilhota (30 m) no meio da lagoa; mar ao redor com o
// fundo inclinado de -60 m (oeste) a -100 m (leste).
// ---------------------------------------------------------------------------
const W = 160, H = 120, R = 40, R_LAGOA = 12, R_ILHOTA = 5;
const KM = { largura: 16, altura: 12 };

function terrenoSintetico() {
  const a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2);
      let v = -60 - 40 * (x / W);
      if (d < R_ILHOTA) v = 30;
      else if (d < R_LAGOA) v = -5;
      else if (d < R) v = 300 * (1 - (d - R_LAGOA) / (R - R_LAGOA));
      a[y * W + x] = v;
    }
  }
  return a;
}

function gerar(opcoes = {}) {
  return gerarLaminas({ alturas: terrenoSintetico(), w: W, h: H, metrosPorNo: 100, km: KM, opcoes });
}

function todosAneis(r) {
  const lista = [];
  for (const l of r.laminas) for (const a of l.aneis) { lista.push({ anel: a.ext, tipo: 'ext', k: l.k }); for (const f of a.furos) lista.push({ anel: f, tipo: 'furo', k: l.k }); }
  if (r.agua) for (const a of r.agua.aneis) { lista.push({ anel: a.ext, tipo: 'ext', k: 'agua' }); for (const f of a.furos) lista.push({ anel: f, tipo: 'furo', k: 'agua' }); }
  return lista;
}

function areaDaLamina(l) {
  let s = 0;
  for (const a of l.aneis) { s += areaComSinal(a.ext); for (const f of a.furos) s += areaComSinal(f); }
  return s;
}

const R_SINT = gerar();

test('sintético: passos escolhidos, exagero, dimensões e suavização', () => {
  const r = R_SINT;
  assert.equal(r.largura_mm, 300);
  assert.equal(r.altura_mm, 225);
  assert.equal(r.mm_por_km, 18.75);
  assert.equal(r.espessura_mm, 3);
  assert.equal(r.passo_terra_m, 25, 'exagero 160 / passo: 20 m daria 8x (> 7), 25 m dá 6,4x e 10 lâminas');
  assert.equal(r.passo_mar_m, 20, 'min -100 m: 10 m daria 10 lâminas (> 8), 20 m dá 5 e 8x (<= 30)');
  assert.equal(r.exagero, 6.4, '(3 / 25) / (18,75 / 1000) = 6,4');
  assert.equal(r.exagero_mar, 8);
  assert.ok(r.exagero <= EXAGERO_TERRA_MAX && r.exagero_mar <= EXAGERO_MAR_MAX);
  assert.deepEqual(r.suavizar, { terra_nos: 1, mar_nos: 5 }, '100 m por nó: terra 1 (grade grossa), mar ceil(450 / 100) = 5');
  assert.deepEqual(r.escolhidos, { passo_terra_m: true, passo_mar_m: true });
  assert.equal(r.area_min_mm2, 8);
  assert.equal(r.area_min_furo_mm2, 10);
  assert.equal(r.tolerancia_mm, 0.15);
  assert.ok(r.elev_bruta_m.min < -99 && r.elev_bruta_m.max > 299);
  assert.ok(r.elev_max_m < r.elev_bruta_m.max, 'o máximo usado é o do campo suavizado');
  assert.deepEqual(r.avisos, []);
  assert.ok(r.resumo.mar <= MAX_LAMINAS_MAR && r.resumo.terra <= MAX_LAMINAS_TERRA);
  assert.equal(r.resumo.laminas, r.laminas.length);
});

test('sintético: todo anel fecha implicitamente, tem 3+ pontos, sem repetidos, 2 casas, dentro da peça', () => {
  const r = R_SINT;
  const aneis = todosAneis(r);
  assert.ok(aneis.length > 30);
  for (const { anel, tipo, k } of aneis) {
    assert.ok(anel.length >= 3, `anel ${tipo} da lâmina ${k} com ${anel.length} pontos`);
    const [p0, pn] = [anel[0], anel[anel.length - 1]];
    assert.ok(!(p0[0] === pn[0] && p0[1] === pn[1]), `anel ${tipo} da lâmina ${k} repete o primeiro ponto no fim`);
    for (let i = 0; i < anel.length; i++) {
      const p = anel[i], q = anel[(i + 1) % anel.length];
      assert.ok(!(p[0] === q[0] && p[1] === q[1]), `ponto repetido em ${tipo} da lâmina ${k}`);
      assert.equal(p.length, 2);
      for (const v of p) {
        assert.ok(Number.isFinite(v));
        assert.equal(Math.round(v * 100) / 100, v, `coordenada ${v} com mais de 2 casas`);
      }
      assert.ok(p[0] >= -150 && p[0] <= 150 && p[1] >= -112.5 && p[1] <= 112.5, `ponto fora da peça: ${p}`);
    }
  }
});

test('sintético: orientação (ext anti-horário, furo horário) e furo dentro do seu ext', () => {
  const r = R_SINT;
  for (const { anel, tipo, k } of todosAneis(r)) {
    const a = areaComSinal(anel);
    if (tipo === 'ext') assert.ok(a >= 8, `ext da lâmina ${k} com área ${a} (esperado >= 8, anti-horário)`);
    else assert.ok(a <= -10, `furo da lâmina ${k} com área ${a} (esperado <= -10, horário)`);
  }
  const poligonos = [...r.laminas.flatMap((l) => l.aneis), ...r.agua.aneis];
  for (const { ext, furos } of poligonos) {
    for (const f of furos) {
      for (const p of f) assert.ok(pontoDentro(ext, p), `vértice do furo ${p} fora do ext`);
      assert.ok(-areaComSinal(f) < areaComSinal(ext));
    }
  }
});

test('sintético: lâmina 0 é o retângulo, níveis crescentes, k sequencial, z_mm, tipos e nenhuma vazia', () => {
  const r = R_SINT;
  const l0 = r.laminas[0];
  assert.equal(l0.k, 0);
  assert.equal(l0.tipo, 'mar');
  assert.equal(l0.nivel_m, -100);
  assert.deepEqual(l0.aneis, [{ ext: [[-150, -112.5], [150, -112.5], [150, 112.5], [-150, 112.5]], furos: [] }]);
  assert.equal(areaComSinal(l0.aneis[0].ext), 300 * 225);
  r.laminas.forEach((l, i) => {
    assert.equal(l.k, i);
    assert.equal(l.z_mm, (i + 1) * 3);
    if (i > 0) assert.ok(l.nivel_m > r.laminas[i - 1].nivel_m, `nível ${l.nivel_m} não cresce`);
    assert.equal(l.tipo, l.nivel_m < 0 ? 'mar' : l.nivel_m === 0 ? 'costa' : 'terra');
    assert.ok(l.aneis.length > 0, `lâmina ${i} vazia`);
    if (l.tipo === 'mar') assert.equal(Math.abs(l.nivel_m % r.passo_mar_m), 0, `${l.nivel_m} não é múltiplo de ${r.passo_mar_m}`);
    if (l.tipo === 'terra') assert.equal(Math.abs(l.nivel_m % r.passo_terra_m), 0, `${l.nivel_m} não é múltiplo de ${r.passo_terra_m}`);
  });
  const niveis = r.laminas.map((l) => l.nivel_m);
  assert.deepEqual(niveis.slice(0, 6), [-100, -80, -60, -40, -20, 0]);
  assert.equal(niveis[6], 25);
  assert.ok(niveis[niveis.length - 1] < r.elev_max_m && niveis[niveis.length - 1] + 25 >= r.elev_max_m, 'última lâmina é o último múltiplo abaixo do máximo');
});

test('sintético: pilha encaixada (área nunca cresce de uma lâmina para a de cima)', () => {
  const r = R_SINT;
  for (let i = 1; i < r.laminas.length; i++) {
    const abaixo = areaDaLamina(r.laminas[i - 1]), acima = areaDaLamina(r.laminas[i]);
    assert.ok(acima <= abaixo + 1, `lâmina ${i} (${acima.toFixed(0)} mm²) maior que a de baixo (${abaixo.toFixed(0)} mm²)`);
  }
  // a lâmina de mar mais rasa cobre a ilha inteira (lagoa a -5 m fica dentro): um polígono, sem furo
  const rasa = r.laminas.find((l) => l.nivel_m === -20);
  assert.equal(rasa.aneis.length, 1);
  assert.equal(rasa.aneis[0].furos.length, 0);
  assert.ok(areaDaLamina(rasa) > areaDaLamina(r.laminas.find((l) => l.tipo === 'costa')), 'a lâmina de -20 m é maior que a costa');
  // a lâmina 1 (fundo a -80 m) não repete o retângulo: o leste é mais fundo que -80
  assert.ok(areaDaLamina(r.laminas[1]) < 300 * 225 * 0.9);
  assert.ok(areaDaLamina(r.laminas[1]) > 300 * 225 * 0.5);
});

test('sintético: costa com lagoa (furo) e ilhota (polígono dentro do furo); ilhota some acima de 30 m', () => {
  const r = R_SINT;
  const costa = r.laminas.find((l) => l.tipo === 'costa');
  assert.equal(costa.aneis.length, 2, 'ilha + ilhota');
  const ilha = costa.aneis.find((a) => a.furos.length === 1);
  const ilhota = costa.aneis.find((a) => a.furos.length === 0);
  assert.ok(ilha && ilhota);
  assert.ok(areaComSinal(ilha.ext) > areaComSinal(ilhota.ext) * 10);
  for (const p of ilhota.ext) {
    assert.ok(pontoDentro(ilha.furos[0], p), 'ilhota dentro da lagoa');
    assert.ok(pontoDentro(ilha.ext, p), 'ilhota dentro da ilha');
  }
  // raios em mm (1 nó = 1,875 mm): ilha 40 nós = 75 mm; a lagoa (12 nós = 22,5 mm) encolhe porque o blur
  // espalha a parede de 300 m sobre a água a -5 m; a ilhota (5 nós = 9,4 mm) cresce pelo mesmo motivo
  const raio = (anel) => Math.sqrt(Math.abs(areaComSinal(anel)) / Math.PI);
  assert.ok(Math.abs(raio(ilha.ext) - 75) < 4, `raio da ilha ${raio(ilha.ext)}`);
  assert.ok(raio(ilha.furos[0]) > 12 && raio(ilha.furos[0]) < 23, `raio da lagoa ${raio(ilha.furos[0])}`);
  assert.ok(raio(ilhota.ext) > 8 && raio(ilhota.ext) < 15, `raio da ilhota ${raio(ilhota.ext)}`);
  const t25 = r.laminas.find((l) => l.nivel_m === 25);
  assert.equal(t25.aneis.length, 2, 'a 25 m a ilhota (30 m) ainda existe');
  const t50 = r.laminas.find((l) => l.nivel_m === 50);
  assert.equal(t50.aneis.length, 1, 'a 50 m só sobra o cone');
  assert.equal(t50.aneis[0].furos.length, 1, 'e a lagoa continua furo');
});

test('sintético: água é o complemento da costa (lagoa com a ilhota como furo; mar com a ilha como furo)', () => {
  const r = R_SINT;
  assert.equal(r.agua.nivel_m, 0);
  assert.equal(r.agua.aneis.length, 2);
  const mar = r.agua.aneis.reduce((a, b) => (areaComSinal(a.ext) > areaComSinal(b.ext) ? a : b));
  const lagoa = r.agua.aneis.find((a) => a !== mar);
  assert.equal(mar.furos.length, 1, 'a ilha é o furo do mar');
  assert.equal(lagoa.furos.length, 1, 'a ilhota é o furo da lagoa');
  const costa = r.laminas.find((l) => l.tipo === 'costa');
  const total = areaDaLamina(costa) + areaDaLamina(r.agua);
  assert.ok(Math.abs(total - 300 * 225) < 300 * 225 * 0.002, `costa + água = ${total.toFixed(0)} mm², esperado ~67500`);
  // o anel externo da água toca as quatro bordas da peça
  const xs = mar.ext.map((p) => p[0]), ys = mar.ext.map((p) => p[1]);
  assert.equal(Math.min(...xs), -150); assert.equal(Math.max(...xs), 150);
  assert.equal(Math.min(...ys), -112.5); assert.equal(Math.max(...ys), 112.5);
});

test('sintético: passos e largura vindos das opções valem e não contam como escolhidos', () => {
  const r = gerar({ passo_terra_m: 50, passo_mar_m: 25, largura_mm: 400, espessura_mm: 1.5, tolerancia_mm: 0.25, area_min_mm2: 10 });
  assert.equal(r.passo_terra_m, 50);
  assert.equal(r.passo_mar_m, 25);
  assert.equal(r.largura_mm, 400);
  assert.equal(r.altura_mm, 300);
  assert.equal(r.espessura_mm, 1.5);
  assert.equal(r.tolerancia_mm, 0.25);
  assert.equal(r.area_min_mm2, 10);
  assert.equal(r.area_min_furo_mm2, 10, 'furo nunca abaixo do mínimo dos externos');
  assert.deepEqual(r.escolhidos, { passo_terra_m: false, passo_mar_m: false });
  assert.deepEqual(r.laminas.map((l) => l.nivel_m).slice(0, 6), [-100, -75, -50, -25, 0, 50]);
  assert.equal(r.exagero, 1.2, '(1,5 / 50) / (25 / 1000)');
  assert.equal(r.exagero_mar, 2.4);
  assert.deepEqual(r.laminas[0].aneis[0].ext, [[-200, -150], [200, -150], [200, 150], [-200, 150]]);
  assert.ok(r.laminas.every((l) => l.z_mm === (l.k + 1) * 1.5));
  assert.ok(r.laminas.length < R_SINT.laminas.length, 'passos maiores, menos lâminas');
});

test('peça com altura de centésimo ímpar: arredonda para 0,02 mm e nenhum ponto sai do retângulo', () => {
  // 12,6 km * 18,75 mm/km = 236,25 mm: a metade (118,125) não cabe em 2 casas; vira 236,26 (metade 118,13)
  const r = gerarLaminas({ alturas: terrenoSintetico(), w: W, h: H, metrosPorNo: 100, km: { largura: 16, altura: 12.6 }, opcoes: { largura_mm: 300.01 } });
  assert.equal(r.largura_mm, 300.02);
  assert.equal(r.altura_mm, 236.26);
  assert.deepEqual(r.laminas[0].aneis[0].ext, [[-150.01, -118.13], [150.01, -118.13], [150.01, 118.13], [-150.01, 118.13]]);
  for (const { anel } of todosAneis(r)) {
    for (const [x, y] of anel) assert.ok(Math.abs(x) <= 150.01 && Math.abs(y) <= 118.13, `ponto fora da peça: ${x}, ${y}`);
  }
});

test('sintético: passo forçado grande demais vira aviso, não erro', () => {
  const r = gerar({ passo_terra_m: 5 });
  assert.ok(r.avisos.some((a) => a.includes('mais que 24')));
  assert.ok(r.resumo.terra > MAX_LAMINAS_TERRA);
});

test('sem mar: lâmina 0 no múltiplo abaixo do mínimo, sem mar, sem costa, sem água', () => {
  const w = 60, h = 40;
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = 800 + 700 * Math.exp(-(((x - 30) ** 2) + ((y - 20) ** 2)) / 200);
  const r = gerarLaminas({ alturas: a, w, h, metrosPorNo: 100, km: { largura: 6, altura: 4 }, opcoes: {} });
  assert.equal(r.passo_mar_m, null);
  assert.equal(r.exagero_mar, null);
  assert.equal(r.agua, null);
  assert.equal(r.passo_terra_m, 50, 'de 800 a ~1480 a 50 mm/km: 10 m (6x) daria 67 lâminas, 25 m 27 (> 24), 50 m dá 13');
  assert.ok(r.laminas.every((l) => l.tipo === 'terra'));
  assert.equal(r.laminas[0].nivel_m, 800);
  assert.deepEqual(r.laminas[0].aneis[0].ext, retanguloDaPeca(300, 200));
  assert.ok(r.laminas.length >= 3 && r.laminas.length <= MAX_LAMINAS_TERRA + 1);
  assert.ok(r.laminas.every((l) => l.aneis.length > 0));
  assert.equal(r.resumo.mar, 0);
  assert.equal(r.resumo.costa, 0);
});

test('terreno todo mar: sem costa nem terra, água é a peça inteira', () => {
  const w = 40, h = 30;
  const a = new Float32Array(w * h);
  for (let k = 0; k < a.length; k++) a[k] = -200 - 300 * ((k % w) / w);
  const r = gerarLaminas({ alturas: a, w, h, metrosPorNo: 100, km: { largura: 4, altura: 3 }, opcoes: {} });
  assert.ok(r.laminas.every((l) => l.tipo === 'mar'));
  assert.ok(r.laminas.every((l) => l.aneis.length > 0));
  assert.equal(r.agua.aneis.length, 1);
  // o d3 chanfra os quatro cantos em meia célula (7,5 mm / 2): uns 30 mm² a menos que o retângulo
  assert.ok(Math.abs(areaComSinal(r.agua.aneis[0].ext) - 300 * 225) < 100);
  assert.equal(r.passo_mar_m, 100, '50 m daria 10 lâminas (> 8); 100 m dá 5');
  assert.ok(r.avisos.some((a) => a.includes('removida do topo')), 'os níveis de cima (-100 m e talvez -200 m) ficaram vazios e saíram');
});

// ---------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------

test('contagem de níveis e escolha de passo', () => {
  assert.equal(contarNiveisTerra(1018.3, 50), 20);
  assert.equal(contarNiveisTerra(1018.3, 25), 40);
  assert.equal(contarNiveisTerra(1000, 50), 19, 'máximo exato no múltiplo: a última fica abaixo');
  assert.equal(contarNiveisTerra(30, 50), 0);
  assert.equal(contarNiveisTerra(0, 50), 0);
  assert.equal(contarNiveisMar(-109.6, 10), 11);
  assert.equal(contarNiveisMar(-45.2, 10), 5);
  assert.equal(contarNiveisMar(-100, 10), 10);
  assert.equal(contarNiveisMar(0, 10), 0);
  assert.equal(contarNiveisMar(5, 10), 0);
  assert.equal(escolherPasso(() => 100, 24), PASSOS_M[PASSOS_M.length - 1]);
  assert.equal(escolherPasso((p) => (p >= 20 ? 1 : 99), 5), 20);
});

test('exageroDe e suavizarTerraPadrao', () => {
  assert.equal(exageroDe(3, 20, 18.75), 8);
  assert.equal(exageroDe(1.5, 50, 25), 1.2);
  assert.ok(Math.abs(exageroDe(3, 50, 5.3191) - 11.28) < 0.01, 'Rio no passo 50: 11,3x');
  assert.equal(suavizarTerraPadrao(30), 2, 'Copernicus a 30 m por nó: prédio e mata viram confete');
  assert.equal(suavizarTerraPadrao(59.9), 2);
  assert.equal(suavizarTerraPadrao(60), 1);
  assert.equal(suavizarTerraPadrao(100), 1);
  const fino = gerarLaminas({ alturas: terrenoSintetico(), w: W, h: H, metrosPorNo: 50, km: { largura: 8, altura: 6 }, opcoes: {} });
  assert.deepEqual(fino.suavizar, { terra_nos: 2, mar_nos: 9 }, '50 m por nó: terra 2, mar ceil(450 / 50) = 9');
  assert.equal(gerar({ suavizar_terra_nos: 3 }).suavizar.terra_nos, 3, 'opção vence o padrão');
});

test('escolherPassoTerra: o menor passo com exagero até 7x, até 24 lâminas, lugar plano até 12x', () => {
  assert.equal(EXAGERO_TERRA_MAX, 7);
  assert.equal(EXAGERO_TERRA_PLANA_MAX, 12);
  assert.equal(MIN_LAMINAS_TERRA_PLANA, 3);
  // peça de 300 mm para 56,4 km (5,32 mm/km, compensado de 3 mm): exagero = 564 / passo
  const rio = { espessuraMm: 3, mmPorKm: 5.3191 };
  assert.equal(escolherPassoTerra({ elevMax: 985.3, elevMin: -73.1, ...rio }), 100, 'Rio: 50 m daria 11,3x; 100 m dá 5,6x e 9 lâminas');
  assert.equal(escolherPassoTerra({ elevMax: 1270.9, elevMin: -72.1, espessuraMm: 3, mmPorKm: 6.0852 }), 100, 'Florianópolis: 4,9x, 12 lâminas');
  assert.equal(escolherPassoTerra({ elevMax: 202.4, elevMin: -2517.5, espessuraMm: 3, mmPorKm: 13.5135 }), 50, 'Noronha: 25 m daria 8,9x; 50 m dá 4,4x e 4 lâminas');
  // lugar plano: 100 m (6x) daria 1 lâmina; desce para 50 m (11,9x, dentro de 12x) e chega a 3
  assert.equal(escolherPassoTerra({ elevMax: 189.5, elevMin: -1494.2, espessuraMm: 3, mmPorKm: 5.0251 }), 50, 'Salvador');
  // plano e nenhum passo dentro de 12x chega a 3 lâminas: fica o que dá mais lâminas
  assert.equal(escolherPassoTerra({ elevMax: 120, elevMin: -10, ...rio }), 50, '100 m dá 1 lâmina, 50 m dá 2 (11,3x), 25 m já passa de 12x');
  assert.equal(escolherPassoTerra({ elevMax: 40, elevMin: -10, ...rio }), 100, 'descer não aumenta nada (0 lâminas nos dois): fica o de 7x');
  // mais de 24 lâminas no passo de 7x: sobe até caber
  assert.equal(escolherPassoTerra({ elevMax: 2600, elevMin: -10, ...rio }), 200, '100 m daria 25 lâminas; 200 m dá 12');
  // espessura e escala entram no exagero: papel de 1,5 mm na mesma peça deixa descer o passo
  assert.equal(escolherPassoTerra({ elevMax: 985.3, elevMin: -73.1, espessuraMm: 1.5, mmPorKm: 5.3191 }), 50, '(1,5 / 50) / 0,00532 = 5,6x');
  // sem mar: a base é o múltiplo abaixo do mínimo
  assert.equal(escolherPassoTerra({ elevMax: 1480, elevMin: 800, espessuraMm: 3, mmPorKm: 50 }), 50);
  // nenhum passo da lista cumpre 7x (peça minúscula para um continente): fica o maior
  assert.equal(escolherPassoTerra({ elevMax: 3000, elevMin: 0, espessuraMm: 3, mmPorKm: 0.1 }), 500);
  assert.throws(() => escolherPassoTerra({ elevMax: 100 }), /mmPorKm/);
  // tetos e lista são parâmetros
  assert.equal(escolherPassoTerra({ elevMax: 985.3, elevMin: -73.1, ...rio }, { exageroMax: 12 }), 50);
  assert.equal(escolherPassoTerra({ elevMax: 985.3, elevMin: -73.1, ...rio }, { passos: [10, 500] }), 500);
});

test('escolherPassoMar: até 8 lâminas, exagero do mar até 30x, nunca menos de 2 lâminas', () => {
  assert.equal(MAX_LAMINAS_MAR, 8);
  assert.equal(MIN_LAMINAS_MAR, 2);
  assert.equal(EXAGERO_MAR_MAX, 30);
  const rio = { espessuraMm: 3, mmPorKm: 5.3191 };
  assert.equal(escolherPassoMar({ elevMin: -73.1, ...rio }), 20, 'Rio: 10 m dá 8 lâminas mas 56x; 20 m dá 4 e 28x');
  assert.equal(escolherPassoMar({ elevMin: -109.6, ...rio }), 20, '10 m daria 11 lâminas; 20 m dá 6 e 28x');
  assert.equal(escolherPassoMar({ elevMin: -72.1, espessuraMm: 3, mmPorKm: 6.0852 }), 20, 'Florianópolis: 4 lâminas, 24,6x');
  assert.equal(escolherPassoMar({ elevMin: -1494.2, espessuraMm: 3, mmPorKm: 5.0251 }), 200, 'Salvador: 8 lâminas, 3x');
  assert.equal(escolherPassoMar({ elevMin: -2517.5, espessuraMm: 3, mmPorKm: 13.5135 }), 500, 'Noronha: 250 m daria 11 lâminas; 500 m dá 6');
  assert.equal(escolherPassoMar({ elevMin: -9000, ...rio }), 500, 'nenhum cabe em 8: fica o maior');
  // piso de 2 lâminas: a 10 mm/km, 5 m é 60x e 10 m é 30x
  assert.equal(escolherPassoMar({ elevMin: -12, espessuraMm: 3, mmPorKm: 10 }), 10, '5 m dá 3 lâminas e 60x; 10 m dá 2 e 30x');
  assert.equal(escolherPassoMar({ elevMin: -8, espessuraMm: 3, mmPorKm: 10 }), 5, 'subir para 10 m deixaria 1 lâmina: fica em 5 m, com 60x e aviso');
  assert.equal(escolherPassoMar({ elevMin: 5, ...rio }), PASSOS_M[0], 'sem mar: o primeiro da lista (quem chama não usa)');
  assert.throws(() => escolherPassoMar({ elevMin: -10 }), /mmPorKm/);
  assert.equal(escolherPassoMar({ elevMin: -73.1, ...rio }, { exageroMax: 100 }), 10);
  // na pilha inteira: mar raso demais para 30x gera aviso, não erro
  const r = gerarLaminas({ alturas: terrenoSintetico().map((v) => (v < 0 ? -8 : v)), w: W, h: H, metrosPorNo: 100, km: KM, opcoes: {} });
  assert.equal(r.passo_mar_m, 5);
  assert.equal(r.resumo.mar, 2);
  assert.ok(r.avisos.some((a) => a.includes('exagero do mar')));
});

test('lugar plano na pilha inteira: exagero entre 7x e 12x vira aviso explicado, não erro', () => {
  // ilha baixa (topo a ~75 m) em 300 mm para 16 km: 25 m (6,4x) daria 2 lâminas; 20 m (8x) dá 3
  const baixa = terrenoSintetico().map((v) => (v > 0 ? v / 4 : v));
  const r = gerarLaminas({ alturas: baixa, w: W, h: H, metrosPorNo: 100, km: KM, opcoes: {} });
  assert.equal(r.passo_terra_m, 20);
  assert.equal(r.exagero, 8);
  assert.equal(r.resumo.terra, 3);
  assert.ok(r.avisos.some((a) => a.includes('lugar plano')), r.avisos.join('; '));
  assert.ok(!r.avisos.some((a) => a.includes('removida')));
});

test('niveisDe: exemplo do SPEC e casos de borda', () => {
  const n = niveisDe({ elevMin: -45.2, elevMax: 1021, passoTerra: 40, passoMar: 10 });
  assert.deepEqual(n.map((x) => x.nivel_m), [-50, -40, -30, -20, -10, 0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480, 520, 560, 600, 640, 680, 720, 760, 800, 840, 880, 920, 960, 1000]);
  assert.deepEqual(n.slice(0, 7).map((x) => x.tipo), ['mar', 'mar', 'mar', 'mar', 'mar', 'costa', 'terra']);
  // mínimo exato no múltiplo
  assert.deepEqual(niveisDe({ elevMin: -100, elevMax: 25, passoTerra: 20, passoMar: 50 }).map((x) => x.nivel_m), [-100, -50, 0, 20]);
  // sem mar
  assert.deepEqual(niveisDe({ elevMin: 812, elevMax: 1001, passoTerra: 50 }).map((x) => x.nivel_m), [800, 850, 900, 950, 1000]);
  assert.deepEqual(niveisDe({ elevMin: 10, elevMax: 12, passoTerra: 50 }).map((x) => x.nivel_m), [0]);
  // só mar: sem costa
  assert.deepEqual(niveisDe({ elevMin: -30, elevMax: -1, passoTerra: 50, passoMar: 10 }).map((x) => x.tipo), ['mar', 'mar', 'mar']);
  assert.throws(() => niveisDe({ elevMin: -1, elevMax: 10, passoTerra: 10, passoMar: 0 }), /passo de mar/);
  assert.throws(() => niveisDe({ elevMin: 1, elevMax: 10, passoTerra: 0 }), /passo de terra/);
});

test('areaComSinal, orientar, pontoDentro, semRepetidos, arredondarPonto', () => {
  const quadrado = [[0, 0], [1, 0], [1, 1], [0, 1]];
  assert.equal(areaComSinal(quadrado), 1);
  assert.equal(areaComSinal(quadrado.slice().reverse()), -1);
  assert.deepEqual(orientar(quadrado.slice().reverse()), quadrado);
  assert.deepEqual(orientar(quadrado, true), quadrado.slice().reverse());
  assert.deepEqual(orientar(quadrado), quadrado);
  assert.ok(pontoDentro(quadrado, [0.5, 0.5]));
  assert.ok(!pontoDentro(quadrado, [1.5, 0.5]));
  assert.ok(!pontoDentro(quadrado, [0.5, -0.5]));
  assert.deepEqual(semRepetidos([[0, 0], [0, 0], [1, 0], [1, 1], [1, 1], [0, 1], [0, 0]]), quadrado);
  assert.deepEqual(semRepetidos([[2, 2]]), [[2, 2]]);
  assert.deepEqual(arredondarPonto([1.234, -0.001]), [1.23, 0]);
  assert.deepEqual(arredondarPonto([-12.345678, 99.999]), [-12.35, 100]);
  assert.ok(Object.is(arredondarPonto([-0.001, 0])[0], 0), 'nunca -0');
});

test('simplificar: Douglas-Peucker em anel fechado respeita a tolerância e mantém o quadrado', () => {
  const quadrado = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(simplificar(quadrado, 0.15), quadrado);
  // pontos colineares e um desvio pequeno somem; um desvio grande fica
  const anel = [[0, 0], [5, 0.05], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5]];
  assert.deepEqual(simplificar(anel, 0.15), quadrado);
  const comBico = [[0, 0], [5, 2], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(simplificar(comBico, 0.15), comBico);
  assert.deepEqual(simplificar(comBico, 3), [[0, 0], [10, 0], [10, 10], [0, 10]]);
  // tolerância 0 só limpa repetidos
  assert.deepEqual(simplificar([[0, 0], [0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]], 0), [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]]);
  // degenerados
  assert.deepEqual(simplificar([[1, 1], [1, 1]], 0.15), [[1, 1]]);
  assert.equal(simplificar([[0, 0], [1, 0]], 0.15).length, 2);
  // círculo denso: cada ponto que sobrou está a menos de tol de… nenhum ponto original fica a mais de tol do anel simplificado
  const circulo = [];
  for (let i = 0; i < 720; i++) circulo.push([50 * Math.cos(i * Math.PI / 360), 50 * Math.sin(i * Math.PI / 360)]);
  const s = simplificar(circulo, 0.15);
  assert.ok(s.length < 120 && s.length > 20, `círculo simplificado com ${s.length} pontos`);
  assert.ok(Math.abs(areaComSinal(s) - Math.PI * 2500) / (Math.PI * 2500) < 0.01);
});

test('celulaParaMm: cantos, centro e inversão de y (linha 0 é o norte)', () => {
  const g = { w: 100, h: 50, larguraMm: 300, alturaMm: 150 };
  assert.deepEqual(celulaParaMm([0, 0], g), [-150, 75]);
  assert.deepEqual(celulaParaMm([100, 50], g), [150, -75]);
  assert.deepEqual(celulaParaMm([50, 25], g), [0, 0]);
  assert.deepEqual(celulaParaMm([25, 0], g), [-75, 75]);
});

test('contornar + aneisDoMultiPolygon: quadrado alto no meio vira ext anti-horário; furo vira horário; área mínima filtra', () => {
  const w = 20, h = 20;
  const v = new Float32Array(w * h);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) v[y * w + x] = 10;
  const g = { w, h, larguraMm: 200, alturaMm: 200 };
  const c = contornar(v, w, h, [5]);
  const aneis = aneisDoMultiPolygon(c.get(5), g, { toleranciaMm: 0.15 });
  assert.equal(aneis.length, 1);
  assert.ok(areaComSinal(aneis[0].ext) > 0);
  assert.ok(Math.abs(areaComSinal(aneis[0].ext) - 100 * 100) < 100 * 100 * 0.03);
  // furo: tudo alto menos o centro
  const u = new Float32Array(w * h).fill(10);
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) u[y * w + x] = 0;
  const f = aneisDoMultiPolygon(contornar(u, w, h, [5]).get(5), g, {});
  assert.equal(f.length, 1);
  assert.equal(f[0].furos.length, 1);
  assert.ok(areaComSinal(f[0].furos[0]) < 0);
  assert.ok(Math.abs(areaComSinal(f[0].furos[0]) + 40 * 40) < 40 * 40 * 0.05);
  // furo de um nó (losango de meia célula, ~50 mm²) fica; com área mínima de furo 200 mm² some
  const p = new Float32Array(w * h).fill(10); p[10 * w + 10] = 0;
  assert.equal(aneisDoMultiPolygon(contornar(p, w, h, [5]).get(5), g, {})[0].furos.length, 1);
  assert.equal(aneisDoMultiPolygon(contornar(p, w, h, [5]).get(5), g, { areaMinFuroMm2: 200 })[0].furos.length, 0);
  // ext pequeno some
  const q = new Float32Array(w * h); q[3 * w + 3] = 10;
  assert.equal(aneisDoMultiPolygon(contornar(q, w, h, [5]).get(5), g, { areaMinMm2: 200 }).length, 0);
  assert.equal(aneisDoMultiPolygon(contornar(q, w, h, [5]).get(5), g, { areaMinMm2: 4 }).length, 1);
  assert.equal(contornar(v, w, h, []).size, 0);
});

test('suavizarCampos: o campo do mar cobre a terra (costa cabe em toda lâmina de mar)', () => {
  const w = 30, h = 10;
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = x < 10 ? 50 : -200;
  const { terra, mar } = suavizarCampos(a, w, h, 1, 6);
  assert.equal(terra.length, w * h);
  for (let k = 0; k < w * h; k++) {
    if (terra[k] >= 0) assert.ok(mar[k] >= terra[k], `nó ${k}: mar ${mar[k]} < terra ${terra[k]}`);
  }
  assert.ok(terra[5] > 49 && terra[25] < -199, 'raio 1 quase não mexe longe da borda');
  assert.ok(mar[5 * w + 15] > -200 && mar[5 * w + 15] < 0, 'raio 6 espalha a terra sobre o mar');
  assert.throws(() => suavizarCampos(new Float32Array(5), 2, 2, 1, 1), /valores/);
  const { terra: t0 } = suavizarCampos(a, w, h, 0, 0);
  assert.deepEqual(Array.from(t0), Array.from(a), 'raio 0 não mexe');
});

test('serializarLaminas: JSON válido, uma lâmina por linha, anéis compactos', () => {
  const obj = { slug: 'x', km: { largura: 1, altura: 2 }, laminas: R_SINT.laminas, agua: R_SINT.agua, fontes: [{ id: 'a' }], fim: null };
  const texto = serializarLaminas(obj);
  const volta = JSON.parse(texto);
  assert.deepEqual(volta, obj);
  const linhas = texto.split('\n');
  assert.equal(linhas.filter((l) => l.startsWith('    {"k":')).length, R_SINT.laminas.length);
  assert.ok(texto.includes('"ext":[[-150,-112.5],[150,-112.5],[150,112.5],[-150,112.5]]'));
  assert.ok(texto.includes('"km": {\n    "largura": 1,'));
  assert.ok(texto.endsWith('}\n'));
  assert.equal(serializarLaminas({ laminas: [], agua: null }), '{\n  "laminas": [],\n  "agua": null\n}\n');
});

test('resumirLaminas conta anéis e pontos', () => {
  const r = resumirLaminas([{ tipo: 'mar', aneis: [{ ext: [[0, 0], [1, 0], [1, 1]], furos: [] }] }, { tipo: 'costa', aneis: [{ ext: [[0, 0], [2, 0], [2, 2], [0, 2]], furos: [[[1, 1], [1, 1.5], [1.5, 1.5]]] }] }], { aneis: [{ ext: [[0, 0], [1, 0], [1, 1]], furos: [] }] });
  assert.deepEqual(r, { laminas: 2, terra: 0, costa: 1, mar: 1, aneis: 4, maior_anel_pontos: 4, pontos: 13 });
});

test('parseArgs e opcoesDoLugar', () => {
  const o = parseArgs(['rio', '--largura-mm', '400', '--espessura-mm', '1,5', '--passo-terra', '40', '--passo-mar', '10', '--suavizar-terra', '2', '--suavizar-mar', '8', '--area-min', '3', '--tolerancia-mm', '0.25', '--silencioso']);
  assert.deepEqual(o, { _: ['rio'], silencioso: true, ajuda: false, largura_mm: 400, espessura_mm: 1.5, passo_terra_m: 40, passo_mar_m: 10, suavizar_terra_nos: 2, suavizar_mar_nos: 8, area_min_mm2: 3, tolerancia_mm: 0.25 });
  assert.equal(parseArgs(['-h']).ajuda, true);
  assert.throws(() => parseArgs(['--largura-mm']), /precisa de um valor/);
  assert.throws(() => parseArgs(['--largura-mm', 'x']), /número > 0/);
  assert.throws(() => parseArgs(['--passo-terra', '-5']), /número > 0/);
  assert.throws(() => parseArgs(['--suavizar-mar', '2.5']), /inteiro/);
  assert.throws(() => parseArgs(['--foo']), /desconhecida/);
  assert.ok(AJUDA.includes('--passo-terra') && AJUDA.includes('laminas.json'));

  const m = { largura_mm: 250, passo_terra_m: 40, passo_mar_m: 10, suavizar: { terra_nos: 2, mar_nos: 9 }, tolerancia_mm: 0.2 };
  assert.deepEqual(opcoesDoLugar(m, {}), { largura_mm: 250, espessura_mm: undefined, passo_terra_m: 40, passo_mar_m: 10, suavizar_terra_nos: 2, suavizar_mar_nos: 9, area_min_mm2: undefined, area_min_furo_mm2: undefined, tolerancia_mm: 0.2 });
  assert.equal(opcoesDoLugar(m, { passo_terra_m: 20 }).passo_terra_m, 20, 'linha de comando vence');
  assert.equal(opcoesDoLugar(undefined, {}).largura_mm, undefined);
  assert.equal(opcoesDoLugar('errado', {}).largura_mm, undefined);
});

// ---------------------------------------------------------------------------
// CLI de ponta a ponta numa pasta temporária
// ---------------------------------------------------------------------------

test('gerarArquivo: grava laminas.json com o contrato do SPEC e devolve os passos ao lugar.json', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-laminas-'));
  try {
    const pasta = path.join(raiz, 'lugares', 'ilha');
    fs.mkdirSync(pasta, { recursive: true });
    const bbox = { norte: -3.8, sul: -3.908, oeste: -32.5, leste: -32.356 };
    const lugar = { slug: 'ilha', nome: 'Ilha de teste', bbox, exagero_vertical: 2, largura_max_nos: W, terra: 'copernicus', mar: 'gmrt', mascara: true, regua: null };
    fs.writeFileSync(path.join(pasta, 'lugar.json'), `${JSON.stringify(lugar, null, 2)}\n`);
    escreverTerrenoPng(path.join(pasta, 'terreno.png'), terrenoSintetico(), W, H);
    const terreno = { slug: 'ilha', largura: W, altura: H, bbox, metros_por_no: { x: 100, y: 100 }, km: KM, elev_min_m: -99.7, elev_max_m: 299.8, fontes: [{ id: 'gmrt', licenca: 'teste' }], mascara: { pct_medido: 12.5, nos: 1, nos_mar: 8 } };
    fs.writeFileSync(path.join(pasta, 'terreno.json'), JSON.stringify(terreno));

    const log = [];
    const r = await gerarArquivo({ raiz, slug: 'ilha', opcoes: {}, log: (m) => log.push(m) });
    assert.equal(r.caminho, path.join(pasta, 'laminas.json'));
    const texto = fs.readFileSync(r.caminho, 'utf8');
    assert.equal(Buffer.byteLength(texto), r.bytes);
    const j = JSON.parse(texto);
    assert.deepEqual(Object.keys(j).slice(0, 4), ['slug', 'nome', 'bbox', 'km']);
    for (const chave of ['largura_mm', 'altura_mm', 'mm_por_km', 'espessura_mm', 'passo_terra_m', 'passo_mar_m', 'exagero', 'elev_min_m', 'elev_max_m', 'suavizar', 'area_min_mm2', 'laminas', 'agua', 'fontes', 'mascara', 'gerado_por', 'gerado_em']) {
      assert.ok(chave in j, `falta ${chave}`);
    }
    assert.ok(!('resumo' in j) && !('avisos' in j) && !('escolhidos' in j));
    assert.equal(j.slug, 'ilha');
    assert.equal(j.nome, 'Ilha de teste');
    assert.deepEqual(j.bbox, bbox);
    assert.deepEqual(j.km, KM);
    assert.deepEqual(j.fontes, terreno.fontes);
    assert.deepEqual(j.mascara, { pct_medido: 12.5 });
    assert.equal(j.gerado_por, 'maquete 0.1.0');
    assert.match(j.gerado_em, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.equal(j.passo_terra_m, 25);
    assert.equal(j.passo_mar_m, 20);
    assert.equal(j.exagero, 6.4);
    assert.equal(j.exagero_mar, 8);
    // o PNG quantiza em 0,1 m: a mesma pilha, os mesmos níveis
    assert.deepEqual(j.laminas.map((l) => [l.k, l.nivel_m, l.tipo, l.z_mm]), R_SINT.laminas.map((l) => [l.k, l.nivel_m, l.tipo, l.z_mm]));
    assert.deepEqual(j.laminas[0].aneis[0].ext, [[-150, -112.5], [150, -112.5], [150, 112.5], [-150, 112.5]]);
    assert.equal(j.agua.aneis.length, 2);
    assert.ok(r.bytes < 200 * 1024);

    const lugarDepois = JSON.parse(fs.readFileSync(path.join(pasta, 'lugar.json'), 'utf8'));
    assert.deepEqual(lugarDepois.maquete, { largura_mm: 300, espessura_mm: 3, passo_terra_m: 25, passo_mar_m: 20, material: 'compensado' });
    assert.equal(lugarDepois.exagero_vertical, 2, 'o resto do lugar.json fica como estava');
    assert.ok(log.some((m) => m.includes('passo_terra_m = 25')));

    // segunda rodada: lugar.json já tem os passos, nada a gravar; opção da linha de comando vence
    const log2 = [];
    const r2 = await gerarArquivo({ raiz, slug: 'ilha', opcoes: { passo_terra_m: 50, silencioso: false }, log: (m) => log2.push(m) });
    assert.equal(r2.saida.passo_terra_m, 50);
    assert.equal(r2.saida.passo_mar_m, 20, 'passo do mar veio do lugar.json');
    assert.ok(!log2.some((m) => m.includes('lugar.json: gravado')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(pasta, 'lugar.json'), 'utf8')).maquete.passo_terra_m, 25, 'a opção da linha de comando não sobrescreve o lugar.json');
    assert.equal(JSON.parse(fs.readFileSync(r2.caminho, 'utf8')).passo_terra_m, 50);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('gerarArquivo: erros claros sem terreno e com grade diferente', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-laminas-erro-'));
  try {
    const pasta = path.join(raiz, 'lugares', 'vazio');
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, 'lugar.json'), JSON.stringify({ slug: 'vazio', nome: 'Vazio', bbox: { norte: 1, sul: 0, oeste: 0, leste: 1 } }));
    await assert.rejects(gerarArquivo({ raiz, slug: 'vazio' }), /terreno\.png não existe; gere o terreno antes/);
    escreverTerrenoPng(path.join(pasta, 'terreno.png'), new Float32Array(12).fill(5), 4, 3);
    fs.writeFileSync(path.join(pasta, 'terreno.json'), JSON.stringify({ largura: 5, altura: 3, km: { largura: 1, altura: 1 }, metros_por_no: { x: 1, y: 1 } }));
    await assert.rejects(gerarArquivo({ raiz, slug: 'vazio' }), /não bate com terreno\.json/);
    await assert.rejects(gerarArquivo({ raiz, slug: 'nao-existe' }), /lugar não encontrado/);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('PADROES do SPEC', () => {
  assert.equal(PADROES.largura_mm, 300);
  assert.equal(PADROES.espessura_mm, 3);
  assert.equal(PADROES.suavizar_terra_nos, 1);
  assert.equal(PADROES.suavizar_terra_nos_fino, 2);
  assert.equal(PADROES.metros_por_no_fino, 60);
  assert.equal(PADROES.area_min_mm2, 8);
  assert.equal(PADROES.area_min_furo_mm2, 10);
  assert.equal(MAX_LAMINAS_TERRA, 24);
  assert.equal(PADROES.tolerancia_mm, 0.15);
  assert.deepEqual(PASSOS_M, [5, 10, 20, 25, 50, 100, 200, 250, 500]);
});

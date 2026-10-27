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
  escolherPassoTerraEscala, escolherPassoMarContorno, tetoDaTerra, percentil, mascaraFora, minMaxDentro,
  ESCALAS, ESCALAS_GRANDES, RECORTES, FORA_M, MIN_LAMINAS_TERRA_ESCALA, MAX_LAMINAS_TERRA_ESCALA,
  TETO_LAMINAS_TERRA_ESCALA, MAX_LAMINAS_MAR_ESCALA, PERCENTIL_TERRA_ESCALA,
  LAMINAS_ACIMA_P99, EXAGERO_TERRA_ESCALA_MAX, MAX_LAMINAS_MAR_CONTORNO, KM_MUNICIPIO_GRANDE, AGUA_EPS_M,
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
  assert.equal(r.escala, 'local', 'sem escala no lugar.json é local');
  assert.equal(r.recorte, 'caixa', 'sem nó fora é caixa');
  assert.equal(r.teto_m, null, 'local não tem teto');
  assert.equal(r.elev_p99_m, null, 'local não mede percentil');
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
  assert.equal(escolherPassoTerra({ elevMax: 3000, elevMin: 0, espessuraMm: 3, mmPorKm: 0.1 }), 1000);
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
  assert.equal(escolherPassoMar({ elevMin: -9000, ...rio }), 1000, 'nenhum cabe em 8: fica o maior');
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
  const o = parseArgs(['rio', '--largura-mm', '400', '--espessura-mm', '1,5', '--passo-terra', '40', '--passo-mar', '10', '--suavizar-terra', '2', '--suavizar-mar', '8', '--area-min', '3', '--tolerancia-mm', '0.25', '--escala', 'estado', '--recorte', 'contorno', '--silencioso']);
  assert.deepEqual(o, { _: ['rio'], silencioso: true, ajuda: false, largura_mm: 400, espessura_mm: 1.5, passo_terra_m: 40, passo_mar_m: 10, suavizar_terra_nos: 2, suavizar_mar_nos: 8, area_min_mm2: 3, tolerancia_mm: 0.25, escala: 'estado', recorte: 'contorno' });
  assert.throws(() => parseArgs(['--escala', 'cidade']), /aceita pais, regiao, estado, municipio, local/);
  assert.throws(() => parseArgs(['--recorte']), /precisa de um valor/);
  assert.equal(parseArgs(['x']).escala, undefined);
  assert.equal(parseArgs(['-h']).ajuda, true);
  assert.throws(() => parseArgs(['--largura-mm']), /precisa de um valor/);
  assert.throws(() => parseArgs(['--largura-mm', 'x']), /número > 0/);
  assert.throws(() => parseArgs(['--passo-terra', '-5']), /número > 0/);
  assert.throws(() => parseArgs(['--suavizar-mar', '2.5']), /inteiro/);
  assert.throws(() => parseArgs(['--foo']), /desconhecida/);
  assert.ok(AJUDA.includes('--passo-terra') && AJUDA.includes('laminas.json'));

  const m = { largura_mm: 250, passo_terra_m: 40, passo_mar_m: 10, suavizar: { terra_nos: 2, mar_nos: 9 }, tolerancia_mm: 0.2 };
  assert.deepEqual(opcoesDoLugar(m, {}), { escala: undefined, recorte: undefined, terra: undefined, largura_mm: 250, espessura_mm: undefined, passo_terra_m: 40, passo_mar_m: 10, suavizar_terra_nos: 2, suavizar_mar_nos: 9, area_min_mm2: undefined, area_min_furo_mm2: undefined, tolerancia_mm: 0.2 });
  assert.equal(opcoesDoLugar(m, { passo_terra_m: 20 }).passo_terra_m, 20, 'linha de comando vence');
  assert.equal(opcoesDoLugar(m, {}, { escala: 'pais', recorte: 'contorno' }).escala, 'pais', 'escala vem da raiz do lugar.json');
  assert.equal(opcoesDoLugar(m, {}, { escala: 'pais', recorte: 'contorno' }).recorte, 'contorno');
  assert.equal(opcoesDoLugar(m, { escala: 'local' }, { escala: 'pais' }).escala, 'local', 'linha de comando vence a escala');
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
  assert.deepEqual(PASSOS_M, [5, 10, 20, 25, 50, 100, 200, 250, 500, 750, 1000]);
  assert.deepEqual(ESCALAS, ['pais', 'regiao', 'estado', 'municipio', 'local']);
  assert.deepEqual(ESCALAS_GRANDES, ['pais', 'regiao', 'estado']);
  assert.deepEqual(RECORTES, ['contorno', 'caixa']);
  assert.equal(FORA_M, -9999);
  assert.equal(MIN_LAMINAS_TERRA_ESCALA, 8);
  assert.equal(MAX_LAMINAS_TERRA_ESCALA, 14);
  assert.equal(TETO_LAMINAS_TERRA_ESCALA, 16);
  assert.equal(MAX_LAMINAS_MAR_ESCALA, 6);
  assert.equal(PERCENTIL_TERRA_ESCALA, 0.99);
  assert.equal(LAMINAS_ACIMA_P99, 2);
  assert.equal(EXAGERO_TERRA_ESCALA_MAX, 500);
  assert.equal(MAX_LAMINAS_MAR_CONTORNO, 2);
  assert.equal(KM_MUNICIPIO_GRANDE, 150);
  assert.equal(AGUA_EPS_M, 0.01);
  assert.match(AJUDA, /exagero até 500x/);
  assert.match(AJUDA, /2 lâminas de mar/);
  assert.match(AJUDA, /ceil\(450 \/ metros por nó\), como no mar/);
});

// ---------------------------------------------------------------------------
// Escalas (pais, regiao, estado) e recorte (contorno com nós FORA; caixa com vizinhos chapados em 0 m)
// ---------------------------------------------------------------------------

// Nó fora do recorte: tudo fora do círculo da ilha (o mar inteiro) vira -10000 m exato.
function terrenoContorno() {
  const a = terrenoSintetico();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2) >= R) a[y * W + x] = -10000;
  }
  return a;
}

// Escala grande: planície ondulada (100 ± 50 m) dentro de um círculo de raio 50 nós, com um pico isolado
// de 3000 m em 4 nós; fora do círculo, vizinhos chapados em 0 m exato (recorte caixa). Grade a 1 km/nó.
const KM_ESTADO = { largura: 160, altura: 120 };
function terrenoEstado() {
  const a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2);
    a[y * W + x] = d < 50 ? 100 + 50 * Math.sin(x / 7) * Math.cos(y / 5) : 0;
  }
  for (const [x, y] of [[80, 60], [81, 60], [80, 61], [81, 61]]) a[y * W + x] = 3000;
  return a;
}

// O mesmo estado com mar fundo à direita (x >= 120: de -3000 a -5500 m).
function terrenoEstadoComMar() {
  const a = terrenoEstado();
  for (let y = 0; y < H; y++) for (let x = 120; x < W; x++) a[y * W + x] = -3000 - 2500 * ((x - 120) / 40);
  return a;
}

function nosValidos(alturas) {
  let n = 0;
  for (const v of alturas) if (v > FORA_M) n++;
  return n;
}

test('mascaraFora, minMaxDentro e percentil', () => {
  assert.equal(mascaraFora(terrenoSintetico()), null, 'sem nó fora: null');
  const a = terrenoContorno();
  const fora = mascaraFora(a);
  assert.ok(fora instanceof Uint8Array && fora.length === W * H);
  let n = 0; for (const f of fora) n += f;
  assert.equal(n, W * H - nosValidos(a));
  assert.ok(n > W * H / 2, 'o mar é mais da metade da grade');
  assert.equal(mascaraFora(new Float32Array([-9999, -9998.9, 0]))[0], 1, '-9999 é fora');
  assert.equal(mascaraFora(new Float32Array([-9999, -9998.9, 0]))[1], 0, '-9998,9 é dentro');
  const mm = minMaxDentro(a, fora);
  assert.ok(mm.min >= -5 && mm.min < 0, `mínimo dentro é a lagoa, veio ${mm.min}`);
  assert.ok(mm.max > 299 && mm.max <= 300);
  assert.deepEqual(minMaxDentro(new Float32Array([3, 1, 2]), null), { min: 1, max: 3 });
  assert.equal(percentil(new Float32Array([1, 2, 3, NaN, 4, 100]), 0.99), 100);
  assert.equal(percentil(Float32Array.from({ length: 1000 }, (_, i) => i + 1), 0.99), 990);
  assert.equal(percentil(Float32Array.from({ length: 1000 }, (_, i) => i + 1), 0.5), 500);
  assert.equal(percentil(new Float32Array([NaN, NaN]), 0.5), null);
  assert.equal(percentil(new Float32Array([7]), 0.99), 7);
});

test('suavizarCampos com máscara: o -10000 não vaza para dentro e os nós fora voltam NaN', () => {
  const a = terrenoContorno();
  const fora = mascaraFora(a);
  const { terra, mar } = suavizarCampos(a, W, H, 2, 5, fora);
  const semMascara = suavizarCampos(terrenoSintetico(), W, H, 2, 5);
  for (let k = 0; k < W * H; k++) {
    if (fora[k]) { assert.ok(Number.isNaN(terra[k]) && Number.isNaN(mar[k]), `nó fora ${k} deveria ser NaN`); continue; }
    assert.ok(terra[k] > -6 && mar[k] > -6, `nó ${k} dentro do polígono contaminado: terra ${terra[k]}, mar ${mar[k]}`);
    // longe da borda (o blur2 de raio 2 são três caixas separáveis: alcance 6 nós por eixo, 8,5 na diagonal), o campo é o mesmo com ou sem máscara
    const x = k % W, y = (k - x) / W;
    if (Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2) < R - 10) assert.ok(Math.abs(terra[k] - semMascara.terra[k]) < 1e-3, `nó ${k}: ${terra[k]} x ${semMascara.terra[k]}`);
  }
  // na borda da ilha, sem máscara o mar (-60 m) puxa a costa para baixo; com máscara a borda fica perto de 0
  const borda = 60 * W + Math.round(W / 2 + R - 1.5);
  assert.ok(semMascara.terra[borda] < terra[borda], 'com máscara a borda não desce com o mar vizinho');
  assert.throws(() => suavizarCampos(a, W, H, 1, 1, new Uint8Array(3)), /máscara/);
});

test('recorte contorno: lâmina 1 é o território, lâminas 1+ só dentro do polígono, sem água', () => {
  const a = terrenoContorno();
  const r = gerarLaminas({ alturas: a, w: W, h: H, metrosPorNo: 100, km: KM, opcoes: {} });
  assert.equal(r.escala, 'local');
  assert.equal(r.recorte, 'contorno', 'nó fora no terreno força contorno');
  assert.equal(r.agua, null, 'contorno não tem placa de água');
  assert.equal(r.teto_m, null);
  assert.ok(r.elev_bruta_m.min >= -5 && r.elev_min_m >= -5, `nó fora não entra no mínimo: bruta ${r.elev_bruta_m.min}, suavizado ${r.elev_min_m}`);
  assert.ok(r.elev_max_m > 250);
  // lâmina 0 é o retângulo; lâmina 1 repete o nível e é a ilha inteira (raio 40 nós = 75 mm)
  assert.deepEqual(r.laminas[0].aneis, [{ ext: [[-150, -112.5], [150, -112.5], [150, 112.5], [-150, 112.5]], furos: [] }]);
  assert.equal(r.laminas[1].nivel_m, r.laminas[0].nivel_m, 'a lâmina 1 repete o nível da base');
  assert.equal(r.laminas[1].tipo, r.laminas[0].tipo);
  assert.equal(r.laminas[0].tipo, 'terra', 'a base é terra mesmo com a lagoa abaixo de 0 m (senão sai no material do mar)');
  assert.ok(r.laminas[0].nivel_m < 0, 'a lagoa (-5 m) põe a base abaixo de 0');
  assert.ok(r.laminas.every((l) => l.tipo !== 'mar' || (l.k >= 2 && l.nivel_m < 0)), 'mar só em lâminas 2+ com nível negativo');
  assert.equal(r.passo_mar_m, r.passo_terra_m, 'em contorno o mar segue o passo da terra');
  assert.equal(r.resumo.mar, 0, 'lagoa de -5 m não chega a uma lâmina de mar no passo da terra');
  assert.deepEqual(r.escolhidos, { passo_terra_m: true, passo_mar_m: false }, 'o passo do mar em contorno sai da regra e não vai para o lugar.json');
  assert.equal(r.laminas[1].aneis.length, 1);
  assert.equal(r.laminas[1].aneis[0].furos.length, 0, 'o território inteiro, lagoa inclusa');
  const raio = Math.sqrt(areaComSinal(r.laminas[1].aneis[0].ext) / Math.PI);
  assert.ok(raio > 73 && raio <= 75.5, `raio do território ${raio} mm (esperado ~74, meio nó para dentro)`);
  // níveis sobem a partir da lâmina 1; nenhum vértice de lâmina 1+ cai num nó fora
  for (let i = 2; i < r.laminas.length; i++) assert.ok(r.laminas[i].nivel_m > r.laminas[i - 1].nivel_m);
  for (const l of r.laminas.slice(1)) {
    assert.ok(l.aneis.length > 0, `lâmina ${l.k} vazia`);
    for (const an of l.aneis) for (const anel of [an.ext, ...an.furos]) for (const [x, y] of anel) {
      const d = Math.hypot(x, y);
      assert.ok(d <= 75 + 0.01, `vértice da lâmina ${l.k} fora do polígono: ${x}, ${y} (${d.toFixed(1)} mm do centro)`);
    }
  }
  // os níveis de terra batem com a versão caixa (mesmo passo, mesmas áreas longe da borda)
  const caixa = R_SINT;
  assert.equal(r.passo_terra_m, caixa.passo_terra_m);
  const area = (l) => l.aneis.reduce((s, an) => s + areaComSinal(an.ext) + an.furos.reduce((t, f) => t + areaComSinal(f), 0), 0);
  const a100 = area(r.laminas.find((l) => l.nivel_m === 100)), c100 = area(caixa.laminas.find((l) => l.nivel_m === 100));
  assert.ok(Math.abs(a100 - c100) < 5, `nível 100 m: ${a100} x ${c100}`);
  // a costa no contorno é um pouco maior que na caixa: o mar vizinho (-60 m) não puxa mais a borda para baixo
  const costa = r.laminas.find((l) => l.tipo === 'costa'), costaCaixa = caixa.laminas.find((l) => l.tipo === 'costa');
  assert.ok(area(costa) > area(costaCaixa) && area(costa) < area(costaCaixa) * 1.1);
  assert.equal(costa.aneis.length, 2, 'ilha com lagoa (furo) + ilhota');
  // recorte "caixa" declarado com nós fora no terreno: vira contorno com aviso
  const r2 = gerarLaminas({ alturas: a, w: W, h: H, metrosPorNo: 100, km: KM, opcoes: { recorte: 'caixa' } });
  assert.equal(r2.recorte, 'contorno');
  assert.ok(r2.avisos.some((m) => m.includes('tratado como "contorno"')));
  // contorno declarado sem nó fora: sem água, lâmina 1 repete a base (o retângulo inteiro está acima da base)
  const r3 = gerar({ recorte: 'contorno' });
  assert.equal(r3.recorte, 'contorno');
  assert.equal(r3.agua, null);
  assert.equal(r3.laminas[1].nivel_m, r3.laminas[0].nivel_m);
  assert.throws(() => gerarLaminas({ alturas: new Float32Array(W * H).fill(-10000), w: W, h: H, metrosPorNo: 100, km: KM, opcoes: {} }), /todos os nós estão fora/);
  assert.throws(() => gerar({ escala: 'cidade' }), /escala desconhecida/);
  assert.throws(() => gerar({ recorte: 'redondo' }), /recorte desconhecido/);
});

test('escolherPassoTerraEscala: 8 a 14 lâminas pelo percentil 99, nunca pelo máximo', () => {
  assert.equal(escolherPassoTerraEscala({ elevP99: 1200 }), 100, '12 lâminas');
  assert.equal(escolherPassoTerraEscala({ elevP99: 2900 }), 200, '250 m daria 11, mas 200 m dá 14 e é o menor que cabe');
  assert.equal(escolherPassoTerraEscala({ elevP99: 146 }), 10, '14 lâminas');
  assert.equal(escolherPassoTerraEscala({ elevP99: 60 }), 5, '11 lâminas');
  assert.equal(escolherPassoTerraEscala({ elevP99: 380 }), 25, '25 m dá 15 (1 acima de 14), 50 m dá 7 (1 abaixo de 8): empate, fica o menor passo');
  assert.equal(escolherPassoTerraEscala({ elevP99: 360 }), 25, '25 m dá 14: cabe');
  assert.equal(escolherPassoTerraEscala({ elevP99: 390 }), 25, '25 m dá 15, 50 m dá 7: empate de novo, menor passo');
  assert.equal(escolherPassoTerraEscala({ elevP99: 1600 }), 100, '100 m dá 15 (1 acima), 200 m dá 7 (1 abaixo): empate, menor');
  assert.equal(escolherPassoTerraEscala({ elevP99: 1700 }), 200, '100 m dá 16 (2 acima), 200 m dá 8: cabe');
  assert.equal(escolherPassoTerraEscala({ elevP99: 20000 }), 1000, 'nenhum cabe em 14: fica o maior');
  assert.equal(escolherPassoTerraEscala({ elevP99: 3 }), 5, 'terra baixíssima: o menor passo, poucas lâminas');
  assert.equal(escolherPassoTerraEscala({ elevP99: 1200 }, { maximo: 6 }), 200, 'teto de 6: 200 m dá 5 (3 abaixo de 8), 100 m dá 11 (5 acima de 6)');
  assert.throws(() => escolherPassoTerraEscala({ elevP99: 0 }), /elevP99/);
  // o máximo não entra: Amazonas com Neblina (2995 m) e P99 em ~300 m fica no passo 20 (14 lâminas), não em 250
  assert.equal(escolherPassoTerraEscala({ elevP99: 300 }), 20);
  assert.notEqual(escolherPassoTerra({ elevMax: 2995, elevMin: 0, espessuraMm: 3, mmPorKm: 0.2 }), 25);
});

test('escolherPassoTerraEscala conta a partir da base (DF: piso 735 m, P99 1274 m)', () => {
  assert.equal(escolherPassoTerraEscala({ elevP99: 1274, elevMin: 735 }), 50, '50 m: 11 lâminas da base (700 m) ao P99; 100 m daria só 5');
  assert.equal(escolherPassoTerraEscala({ elevP99: 1274 }), 100, 'da base 0 seriam 12 lâminas de 100 m');
  assert.equal(escolherPassoTerraEscala({ elevP99: 1274, elevMin: -30 }), 100, 'com mar a base é 0');
  assert.equal(contarNiveisTerra(1274, 50, 735), 11);
  assert.throws(() => escolherPassoTerraEscala({ elevP99: 100, elevMin: 200 }), /abaixo da base/);
});

test('escolherPassoTerraEscala: exagero até 500x nas escalas grandes (Amazonas desce de 1.062x para 425x)', () => {
  const am = { elevP99: 249, elevMin: -226, espessuraMm: 3, mmPorKm: 300 / 2124 };
  assert.equal(escolherPassoTerraEscala(am), 50, '20 m dá 12 lâminas mas 1.062x; 25 m 850x; 50 m é o primeiro com até 500x (425x), 4 lâminas: planície é planície');
  assert.ok(exageroDe(3, 50, 300 / 2124) < 500 && exageroDe(3, 25, 300 / 2124) > 500);
  assert.equal(escolherPassoTerraEscala({ ...am, mmPorKm: null }), 20, 'sem mmPorKm não há teto de exagero (compatível com as chamadas antigas)');
  assert.equal(escolherPassoTerraEscala({ ...am }, { exageroMax: Infinity }), 20);
  assert.equal(escolherPassoTerraEscala({ elevP99: 592, elevMin: -100, espessuraMm: 3, mmPorKm: 300 / 3400 }), 100, 'Norte: 50 m daria 11 lâminas a 680x; 100 m, 5 lâminas a 340x');
  assert.equal(escolherPassoTerraEscala({ elevP99: 1051, elevMin: -7566, espessuraMm: 3, mmPorKm: 300 / 4566 }), 100, 'Brasil fica em 100 m (469x, 10 lâminas)');
  assert.equal(escolherPassoTerraEscala({ elevP99: 20000, elevMin: 0, espessuraMm: 3, mmPorKm: 0.0001 }), 1000, 'nenhum passo cumpre 500x: fica o maior');
  // o desempate pela proximidade da faixa vale só entre os passos permitidos
  assert.equal(escolherPassoTerraEscala({ elevP99: 1600, elevMin: 0, espessuraMm: 3, mmPorKm: 1 }), 100, '100 m dá 15, 200 m dá 7: empate, menor (3x e 15x, ambos permitidos)');
});

test('escolherPassoMarContorno: passo do mar = passo da terra, subindo até caber em 2 lâminas de mar', () => {
  assert.equal(escolherPassoMarContorno({ elevMin: -30, passoTerra: 50 }), 50, 'base -50: nenhuma lâmina de mar acima da base');
  assert.equal(escolherPassoMarContorno({ elevMin: -226, passoTerra: 50 }), 100, '50 m daria 4 lâminas de mar acima da base; 100 m dá 2');
  assert.equal(escolherPassoMarContorno({ elevMin: -226, passoTerra: 20 }), 100, '20 m daria 11; sobe 25 (9), 50 (4), 100 (2)');
  assert.equal(escolherPassoMarContorno({ elevMin: -5000, passoTerra: 1000 }), 1000, 'nem o maior passo cabe: fica o maior');
  assert.equal(escolherPassoMarContorno({ elevMin: 5, passoTerra: 10 }), 10, 'sem mar: o passo da terra');
  assert.equal(escolherPassoMarContorno({ elevMin: -226, passoTerra: 30 }), 100, 'passo fora da lista: 30 m daria 7, sobe pela lista (50 dá 4, 100 dá 2)');
  assert.throws(() => escolherPassoMarContorno({ elevMin: -1, passoTerra: 0 }), /passo de terra/);
});

test('tetoDaTerra: null até 16 lâminas; acima, o nível da 16ª (base + 16 passos)', () => {
  assert.equal(tetoDaTerra({ elevMax: 1500, elevMin: -5, passo: 100 }), null, '14 lâminas');
  assert.equal(tetoDaTerra({ elevMax: 1700, elevMin: -5, passo: 100 }), null, '16 lâminas cabem');
  assert.equal(tetoDaTerra({ elevMax: 1701, elevMin: -5, passo: 100 }), 1600, '17 lâminas: teto na 16ª');
  assert.equal(tetoDaTerra({ elevMax: 2995, elevMin: -5, passo: 100 }), 1600);
  assert.equal(tetoDaTerra({ elevMax: 2995, elevMin: 812, passo: 100 }), 2400, 'sem mar: base 800 + 1600');
  assert.equal(tetoDaTerra({ elevMax: 2995, elevMin: 0, passo: 25, teto: 10 }), 250);
  assert.throws(() => tetoDaTerra({ elevMax: 100, elevMin: 0, passo: 0 }), /passo de terra/);
  // com o P99: o nível logo acima dele + 2 passos, nunca acima de base + 16 passos
  assert.equal(tetoDaTerra({ elevMax: 2995, elevMin: -226, passo: 50, elevP99: 249 }), 350, 'Amazonas: 250 + 2 x 50; a Neblina sobe 2 lâminas acima da planície');
  assert.equal(tetoDaTerra({ elevMax: 2245, elevMin: -5, passo: 100, elevP99: 1194 }), 1400, 'SP: 1200 + 200');
  assert.equal(tetoDaTerra({ elevMax: 5000, elevMin: 0, passo: 100, elevP99: 1500 }), 1600, '1600 + 200 = 1800 passa de base + 16 passos: fica 1600');
  assert.equal(tetoDaTerra({ elevMax: 330, elevMin: 0, passo: 50, elevP99: 249 }), null, 'último nível natural (300) não passa do teto (350): sem achatar');
  assert.equal(tetoDaTerra({ elevMax: 351, elevMin: 0, passo: 50, elevP99: 249 }), null, 'último nível natural é o próprio teto (350)');
  assert.equal(tetoDaTerra({ elevMax: 401, elevMin: 0, passo: 50, elevP99: 249 }), 350);
  assert.equal(tetoDaTerra({ elevMax: 2995, elevMin: 735, passo: 50, elevP99: 1274 }), 1400, 'sem mar: (25 + 1 + 2) x 50; base 700 + 800 = 1500 é maior');
  assert.equal(tetoDaTerra({ elevMax: 2995, elevMin: 0, passo: 50, elevP99: 249, acima: 0 }), 250);
  assert.throws(() => tetoDaTerra({ elevMax: 100, elevMin: 0, passo: 10, elevP99: 0 }), /elevP99/);
  // niveisDe para no teto, inclusive
  const n = niveisDe({ elevMin: -5, elevMax: 2995, passoTerra: 100, passoMar: 5, tetoM: 1600 });
  assert.deepEqual(n.map((x) => x.nivel_m), [-5, 0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600]);
  assert.equal(niveisDe({ elevMin: -5, elevMax: 2995, passoTerra: 100, passoMar: 5 }).length, 31, 'sem teto vai até 2900');
  assert.deepEqual(niveisDe({ elevMin: 812, elevMax: 2995, passoTerra: 100, tetoM: 2400 }).map((x) => x.nivel_m).slice(-2), [2300, 2400]);
  assert.deepEqual(niveisDe({ elevMin: 0, elevMax: 150, passoTerra: 100, tetoM: 1600 }).map((x) => x.nivel_m), [0, 100], 'teto acima do máximo não cria nível vazio');
});

test('escala estado (caixa, vizinhos chapados em 0 m): passo pelo P99, pico isolado achatado no teto, exagero declarado', () => {
  const r = gerarLaminas({ alturas: terrenoEstado(), w: W, h: H, metrosPorNo: 1000, km: KM_ESTADO, opcoes: { escala: 'estado' } });
  assert.equal(r.escala, 'estado');
  assert.equal(r.recorte, 'caixa');
  assert.equal(r.agua, null, 'sem mar');
  assert.equal(r.passo_mar_m, null);
  assert.ok(r.elev_p99_m > 140 && r.elev_p99_m < 152, `P99 da terra ${r.elev_p99_m} (planície a 100 ± 50 m)`);
  assert.ok(r.elev_max_m > 600, `o pico (suavizado) continua no máximo declarado: ${r.elev_max_m}`);
  assert.equal(r.passo_terra_m, 10, 'pelo P99 (~146 m): 14 lâminas; pelo máximo (~750 m) seria 50 m');
  assert.equal(r.teto_m, 160, '16 lâminas de 10 m a partir da base 0');
  assert.equal(r.laminas[r.laminas.length - 1].nivel_m, 160, 'a última lâmina é o teto');
  assert.equal(r.resumo.terra, 17, 'base + 16 lâminas de terra');
  assert.equal(r.laminas.length, 17);
  assert.equal(r.exagero, 160, '(3 / 10) / (1,875 / 1000)');
  assert.ok(r.avisos.some((m) => m.includes('percentil 99')) && r.avisos.some((m) => m.includes('achatados')), r.avisos.join('; '));
  assert.ok(!r.avisos.some((m) => m.includes('acima de 7x')), 'escala grande não reclama do exagero: declara');
  // a chapada a 0 m exato: a lâmina 0 (base a 0 m) é o retângulo; a 10 m só a planície (um anel, sem confete)
  assert.equal(r.laminas[0].nivel_m, 0);
  assert.equal(r.laminas[1].aneis.length, 1, 'a chapada não vira confete na lâmina de 10 m');
  assert.ok(r.laminas.every((l) => l.aneis.length > 0));
  // o pico é 4 nós (2 x 2 km = 3,75 x 3,75 mm = 14 mm²): acima de 150 m sobra só ele, pequeno mas acima dos 8 mm²
  const topo = r.laminas[r.laminas.length - 1];
  assert.equal(topo.aneis.length, 1);
  assert.ok(areaComSinal(topo.aneis[0].ext) < 200, 'o teto é o pico isolado, achatado');
  // passo forçado na escala grande ainda respeita o teto
  const forcado = gerarLaminas({ alturas: terrenoEstado(), w: W, h: H, metrosPorNo: 1000, km: KM_ESTADO, opcoes: { escala: 'estado', passo_terra_m: 25 } });
  assert.equal(forcado.passo_terra_m, 25);
  assert.equal(forcado.teto_m, 200, 'P99 ~146 m: nível acima (150) + 2 x 25');
  assert.equal(forcado.laminas[forcado.laminas.length - 1].nivel_m, 200);
  assert.deepEqual(r.escolhidos, { passo_terra_m: false, passo_mar_m: false }, 'passo pelo percentil não vai para o lugar.json');
  // escala grande com terra toda abaixo de 0 (só mar): cai nas regras de local, com aviso
  const soMar = new Float32Array(W * H).fill(-500);
  const rm = gerarLaminas({ alturas: soMar, w: W, h: H, metrosPorNo: 1000, km: KM_ESTADO, opcoes: { escala: 'regiao' } });
  assert.equal(rm.elev_p99_m, null);
  assert.ok(rm.avisos.some((m) => m.includes('sem terra acima de 0 m')));
});

test('escala estado com mar: até 6 lâminas de mar (passo 1000 m), costa cobre a chapada num anel só', () => {
  const r = gerarLaminas({ alturas: terrenoEstadoComMar(), w: W, h: H, metrosPorNo: 1000, km: KM_ESTADO, opcoes: { escala: 'estado' } });
  assert.equal(r.passo_mar_m, 1000, 'mínimo -5391 m: 750 m daria 8 lâminas, 1000 m dá 6');
  assert.equal(r.resumo.mar, 6);
  assert.ok(r.resumo.mar <= MAX_LAMINAS_MAR_ESCALA);
  assert.equal(r.passo_terra_m, 10);
  assert.equal(r.teto_m, 160);
  assert.ok(r.exagero_mar < 2, `exagero do mar ${r.exagero_mar}x (1,6x): declarado, sem aviso de 30x`);
  assert.ok(!r.avisos.some((m) => m.includes('exagero do mar')));
  assert.ok(r.agua && r.agua.aneis.length === 1, 'caixa com mar tem a placa de água');
  // a placa só onde a terra fica abaixo de 0: o mar (x >= 120, um quarto da peça), não a chapada em 0 m exato
  const areaAgua = areaComSinal(r.agua.aneis[0].ext);
  const areaMar = 300 * 225 / 4;
  assert.ok(areaAgua > areaMar * 0.95 && areaAgua < areaMar * 1.08, `água ${areaAgua.toFixed(0)} mm² para ${areaMar.toFixed(0)} de mar; a chapada (${(300 * 225 * 0.75 - Math.PI * 50 * 50 * 1.875 * 1.875).toFixed(0)} mm²) não entra`);
  assert.deepEqual(r.escolhidos, { passo_terra_m: false, passo_mar_m: false }, 'na escala grande nem o passo do mar vai para o lugar.json');
  const costa = r.laminas.find((l) => l.tipo === 'costa');
  assert.equal(costa.aneis.length, 1, 'planície + chapada num anel só, sem confete');
  assert.equal(costa.aneis[0].furos.length, 0);
  const areaCosta = areaComSinal(costa.aneis[0].ext);
  const esperada = 300 * 225 * (120 / 160);
  assert.ok(areaCosta > esperada * 0.95 && areaCosta <= esperada, `costa ${areaCosta.toFixed(0)} mm² para ${esperada.toFixed(0)} de terra + chapada (o blur recua uns nós na costa)`);
  for (const l of r.laminas) assert.ok(l.aneis.length > 0, `lâmina ${l.k} vazia`);
  for (let i = 1; i < r.laminas.length; i++) assert.ok(r.laminas[i].nivel_m > r.laminas[i - 1].nivel_m);
  // o mesmo terreno em escala local: passo da terra pelo exagero, mar até 8 lâminas, sem teto
  const local = gerarLaminas({ alturas: terrenoEstadoComMar(), w: W, h: H, metrosPorNo: 1000, km: KM_ESTADO, opcoes: {} });
  assert.equal(local.teto_m, null);
  assert.ok(local.passo_terra_m >= 100, `local: passo ${local.passo_terra_m} m pelo exagero (até 7x)`);
  assert.ok(local.resumo.mar <= MAX_LAMINAS_MAR);
});

test('água: platô em 0 m exato fica fora da placa; nó a 0 m isolado não cria furo (o blur o tira do 0)', () => {
  // metade oeste: terra a 0 m exato (chapada); metade leste: mar a -20 m; faixa de terra a 50 m no norte
  const a = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = y < 20 ? 50 : (x < W / 2 ? 0 : -20);
  const r = gerarLaminas({ alturas: a, w: W, h: H, metrosPorNo: 100, km: KM, opcoes: {} });
  assert.ok(r.agua && r.agua.aneis.length === 1);
  const agua = r.agua.aneis[0];
  assert.equal(agua.furos.length, 0);
  for (const [x] of agua.ext) assert.ok(x >= -4 * 1.875, `a placa entrou na chapada além da borda que o blur recua (até 3 nós e meio): x = ${x}`);
  const areaAgua = areaComSinal(agua.ext);
  const areaMar = 150 * 225 * (100 / 120);
  assert.ok(areaAgua > areaMar * 0.9 && areaAgua < areaMar * 1.06, `água ${areaAgua.toFixed(0)} mm² para ${areaMar.toFixed(0)} de mar`);
  // a costa (h >= 0) cobre a chapada e a terra: complemento da placa (menos a borda que o blur recua)
  const costa = r.laminas.find((l) => l.tipo === 'costa');
  const areaCosta = areaDaLamina(costa);
  assert.ok(areaCosta + areaAgua > 300 * 225 * 0.97 && areaCosta + areaAgua <= 300 * 225 + 1, `costa ${areaCosta.toFixed(0)} + água ${areaAgua.toFixed(0)} cobrem a peça`);
  // o mesmo terreno com a chapada a -0,5 m: a placa cobre tudo que não é a faixa de 50 m
  const b = Float32Array.from(a, (v) => (v === 0 ? -0.5 : v));
  const r2 = gerarLaminas({ alturas: b, w: W, h: H, metrosPorNo: 100, km: KM, opcoes: {} });
  assert.ok(areaComSinal(r2.agua.aneis[0].ext) > areaAgua * 1.8, 'abaixo de 0 a placa cobre os dois lados');
});

test('recorte contorno na escala estado: mar só nos bolsões, até 2 lâminas no passo da terra; base é terra', () => {
  // o estado sintético com o lado de fora do círculo como nó FORA e um bolsão de -120 m no meio da planície
  const a = terrenoEstado();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2);
    if (d >= 50) a[y * W + x] = -10000;
    else if (d < 8 && d >= 3) a[y * W + x] = -120;
  }
  for (const [x, y] of [[80, 60], [81, 60], [80, 61], [81, 61]]) a[y * W + x] = 3000;
  const r = gerarLaminas({ alturas: a, w: W, h: H, metrosPorNo: 1000, km: KM_ESTADO, opcoes: { escala: 'estado' } });
  assert.equal(r.recorte, 'contorno');
  assert.equal(r.agua, null);
  assert.equal(r.passo_terra_m, 10, 'P99 da planície ~146 m');
  assert.equal(r.passo_mar_m, 50, 'bolsão a -120 m: 10 m daria 11 lâminas de mar, 20 m 5, 25 m 4, 50 m 2');
  assert.equal(r.resumo.mar, 2);
  assert.ok(r.resumo.mar <= MAX_LAMINAS_MAR_CONTORNO);
  assert.equal(r.laminas[0].tipo, 'terra');
  assert.equal(r.laminas[1].tipo, 'terra');
  assert.equal(r.laminas[0].nivel_m, -150, 'base no múltiplo do passo do mar abaixo do mínimo');
  assert.equal(r.laminas[1].nivel_m, -150);
  assert.deepEqual(r.laminas.slice(2, 5).map((l) => [l.nivel_m, l.tipo]), [[-100, 'mar'], [-50, 'mar'], [0, 'costa']]);
  assert.equal(r.laminas[1].aneis.length, 1, 'o território inteiro, bolsão incluso');
  assert.equal(r.laminas[1].aneis[0].furos.length, 0);
  assert.equal(r.laminas[4].aneis.length, 2, 'a costa: o território com o bolsão como furo + a ilha dentro do bolsão');
  assert.equal(r.laminas[4].aneis.reduce((t, an) => t + an.furos.length, 0), 1);
  assert.equal(r.teto_m, 160, 'min(150 + 2 x 10 = 170, base 0 + 16 x 10)');
  assert.ok(r.avisos.some((m) => m.includes('mar') === false || !m.includes('mais que')), r.avisos.join('; '));
  // passo do mar forçado vence a regra
  const f = gerarLaminas({ alturas: a, w: W, h: H, metrosPorNo: 1000, km: KM_ESTADO, opcoes: { escala: 'estado', passo_mar_m: 20 } });
  assert.equal(f.passo_mar_m, 20);
  assert.equal(f.resumo.mar, 5);
  assert.ok(f.avisos.some((m) => m.includes('mar em contorno com 5 lâminas')));
});

test('teto desce para a lâmina mais alta que sobrou quando a do teto some no filtro de área', () => {
  // planície com um pico de 2 nós a 1.000 m: suavizado passa de 160 m (teto = base + 16 x 10), mas acima de
  // 150 m sobra menos de 30 mm² (área mínima pedida): as lâminas 150 e 160 somem e o teto desce para 140
  const a = terrenoEstado();
  for (const [x, y] of [[80, 61], [81, 61]]) a[y * W + x] = 100;
  for (const [x, y] of [[80, 60], [81, 60]]) a[y * W + x] = 1000;
  const r = gerarLaminas({ alturas: a, w: W, h: H, metrosPorNo: 1000, km: KM_ESTADO, opcoes: { escala: 'estado', area_min_mm2: 30 } });
  assert.equal(r.passo_terra_m, 10);
  assert.ok(r.elev_max_m > 160, `o pico suavizado continua acima do teto: ${r.elev_max_m}`);
  assert.equal(r.teto_m, 140, 'teto desceu de 160 para a lâmina mais alta que sobrou');
  assert.equal(r.laminas[r.laminas.length - 1].nivel_m, 140, 'o teto é a lâmina que existe');
  assert.ok(r.avisos.some((m) => m.includes('teto 160 m sem lâmina depois do filtro de área: teto_m passa a 140 m')), r.avisos.join('; '));
  // com a área mínima padrão (8 mm²) vale a regra de torre: acima do P99 um anel de terra precisa de
  // AREA_MIN_TORRE_MM2 (30 mm²), então o pico de 2 nós some do mesmo jeito e o teto desce igual
  const r8 = gerarLaminas({ alturas: a, w: W, h: H, metrosPorNo: 1000, km: KM_ESTADO, opcoes: { escala: 'estado' } });
  assert.equal(r8.area_min_mm2, 8);
  assert.equal(r8.teto_m, 140, 'regra de torre: anel acima do P99 com menos de 30 mm² não entra');
  assert.equal(r8.laminas[r8.laminas.length - 1].nivel_m, 140);
});

test('município com mais de 150 km de largura segue as regras de escala (percentil 99, teto, exagero até 500x)', () => {
  const r = gerarLaminas({ alturas: terrenoEstado(), w: W, h: H, metrosPorNo: 1000, km: KM_ESTADO, opcoes: { escala: 'municipio' } });
  assert.equal(r.escala, 'municipio');
  assert.ok(r.elev_p99_m > 140 && r.elev_p99_m < 152);
  assert.equal(r.passo_terra_m, 10);
  assert.equal(r.teto_m, 160, 'min(150 + 2 x 10 = 170, base 0 + 16 x 10)');
  assert.deepEqual(r.escolhidos, { passo_terra_m: false, passo_mar_m: false });
  assert.ok(r.avisos.some((m) => m.includes('escala municipio: passo da terra 10 m pelo percentil 99')));
  // o mesmo terreno como município pequeno (caixa de 16 km): regras de local, sem percentil
  const p = gerarLaminas({ alturas: terrenoEstado(), w: W, h: H, metrosPorNo: 100, km: KM, opcoes: { escala: 'municipio' } });
  assert.equal(p.elev_p99_m, null);
  assert.equal(p.teto_m, null);
  assert.equal(p.escolhidos.passo_terra_m, true);
});

test('suavização da terra vinda do GMRT: raio ceil(450 / metros por nó), como no mar', () => {
  assert.deepEqual(gerar({ terra: 'gmrt' }).suavizar, { terra_nos: 5, mar_nos: 5 }, '100 m por nó: 5 nós');
  assert.deepEqual(gerar({}).suavizar, { terra_nos: 1, mar_nos: 5 }, 'Copernicus a 100 m por nó: 1 nó');
  assert.deepEqual(gerar({ terra: 'copernicus' }).suavizar, { terra_nos: 1, mar_nos: 5 });
  assert.deepEqual(gerar({ terra: 'gmrt', suavizar_terra_nos: 2 }).suavizar, { terra_nos: 2, mar_nos: 5 }, 'opção explícita vence');
  const fino = gerarLaminas({ alturas: terrenoSintetico(), w: W, h: H, metrosPorNo: 55, km: { largura: 8.8, altura: 6.6 }, opcoes: { terra: 'gmrt' } });
  assert.equal(fino.suavizar.terra_nos, 9, 'Manaus a 55 m por nó: 9 nós, não o blur de 1 que vira confete');
  assert.equal(opcoesDoLugar({}, {}, { terra: 'gmrt' }).terra, 'gmrt');
  assert.equal(opcoesDoLugar({}, {}, { terra: 'copernicus' }).terra, 'copernicus');
});

test('gerarArquivo: escala e recorte do lugar.json vão para o laminas.json (terreno com nós fora)', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-laminas-escala-'));
  try {
    const pasta = path.join(raiz, 'lugares', 'ilha-estado');
    fs.mkdirSync(pasta, { recursive: true });
    const bbox = { norte: -3.8, sul: -3.908, oeste: -32.5, leste: -32.356 };
    const lugar = { slug: 'ilha-estado', nome: 'Ilha como estado', bbox, escala: 'estado', recorte: 'contorno', ibge: { nivel: 'estados', codigo: '99', nome: 'Ilha', sigla: 'IL', qualidade: 'intermediaria' }, largura_max_nos: W };
    fs.writeFileSync(path.join(pasta, 'lugar.json'), `${JSON.stringify(lugar, null, 2)}\n`);
    escreverTerrenoPng(path.join(pasta, 'terreno.png'), terrenoContorno(), W, H);
    const terreno = { slug: 'ilha-estado', largura: W, altura: H, bbox, metros_por_no: { x: 100, y: 100 }, km: KM, elev_min_m: -5, elev_max_m: 299.8, fontes: [], mascara: null, recorte: { tipo: 'contorno', ibge_nivel: 'estados', ibge_codigo: '99', nos_dentro: 1, fracao_dentro: 0.26 } };
    fs.writeFileSync(path.join(pasta, 'terreno.json'), JSON.stringify(terreno));
    const log = [];
    const r = await gerarArquivo({ raiz, slug: 'ilha-estado', opcoes: {}, log: (m) => log.push(m) });
    const j = JSON.parse(fs.readFileSync(r.caminho, 'utf8'));
    assert.equal(j.escala, 'estado');
    assert.equal(j.recorte, 'contorno');
    assert.equal(j.agua, null);
    assert.ok('teto_m' in j && 'elev_p99_m' in j);
    assert.ok(j.elev_p99_m > 200, `P99 da ilha cônica ${j.elev_p99_m}`);
    assert.equal(j.passo_terra_m, 20, 'P99 ~ 255 m: 20 m dá 12 lâminas');
    assert.ok(j.elev_bruta_m.min >= -5, 'o -10000 do PNG não entra no bruto');
    assert.equal(j.passo_mar_m, 20, 'contorno: mar no passo da terra');
    assert.equal(j.laminas[0].tipo, 'terra');
    const lugarDepois = JSON.parse(fs.readFileSync(path.join(pasta, 'lugar.json'), 'utf8'));
    assert.equal('passo_terra_m' in lugarDepois.maquete, false, 'passo pelo percentil não vai para o lugar.json');
    assert.equal('passo_mar_m' in lugarDepois.maquete, false, 'passo do mar em contorno não vai para o lugar.json');
    assert.equal(lugarDepois.maquete.largura_mm, 300, 'largura e espessura padrão continuam gravadas');
    assert.equal(j.laminas[1].nivel_m, j.laminas[0].nivel_m);
    assert.ok(log.some((m) => m.includes('escala estado, recorte contorno')));
    // a opção da linha de comando vence a escala do lugar.json
    const r2 = await gerarArquivo({ raiz, slug: 'ilha-estado', opcoes: { escala: 'local' }, log: () => {} });
    assert.equal(r2.saida.escala, 'local');
    assert.equal(r2.saida.recorte, 'contorno', 'o recorte continua vindo dos nós fora');
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

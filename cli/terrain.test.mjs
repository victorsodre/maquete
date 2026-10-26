// Testes offline do terrain.mjs: Terrain-RGB, grade, fusão, preenchimento, amostragem, overview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  codificarAltura, decodificarAltura, codificarTerrainRgb, escreverTerrenoPng, lerTerrenoPng,
  calcularGrade, validarBbox, lonDoNo, latDoNo, fundirNo, fundirGrade, preencherNaN, amostrarBilinear, amostrarVizinho,
  reamostrarParaGrade, escolherOverview, minMax, agoraIso, fmtBytes, fmtSegundos,
} from './terrain.mjs';

const BBOX_002 = { norte: -19.5, sul: -21.8, oeste: -41.0, leste: -28.5 };

test('Terrain-RGB: ida e volta com erro < 0,1 m', () => {
  const valores = [-10000, -5500.3, -5369.3, -1234.56, -0.05, 0, 0.04, 0.5, 1.3, 12.345, 1812.3, 2995.1, 8848.86, 1667721.5];
  for (const h of valores) {
    const v = codificarAltura(h);
    const r = (v >>> 16) & 255, g = (v >>> 8) & 255, b = v & 255;
    const volta = decodificarAltura(r, g, b);
    assert.ok(Math.abs(volta - h) < 0.1, `h=${h} voltou ${volta}`);
    assert.ok(Math.abs(volta - h) <= 0.05 + 1e-9, `h=${h} erro ${Math.abs(volta - h)} maior que meio passo`);
  }
  // varredura determinística
  for (let k = 0; k < 5000; k++) {
    const h = -10000 + k * 2.3457;
    const v = codificarAltura(h);
    assert.ok(Math.abs(decodificarAltura((v >>> 16) & 255, (v >>> 8) & 255, v & 255) - h) < 0.1);
  }
  assert.equal(codificarAltura(-12000), 0, 'abaixo do mínimo prende em 0');
  assert.equal(codificarAltura(1e9), 0xffffff, 'acima do máximo prende no teto');
  // o 0 da codificação é exatamente -10000; o nível do mar é 100000 = 0x0186A0
  assert.equal(codificarAltura(0), 100000);
  assert.deepEqual([(100000 >>> 16) & 255, (100000 >>> 8) & 255, 100000 & 255], [1, 134, 160]);
});

test('Terrain-RGB: buffer RGB e PNG gravado voltam iguais (< 0,1 m)', () => {
  const w = 7, h = 5;
  const alturas = new Float32Array(w * h);
  for (let k = 0; k < alturas.length; k++) alturas[k] = -6000 + k * 311.7;
  const rgb = codificarTerrainRgb(alturas, w, h);
  assert.equal(rgb.length, w * h * 3);
  assert.throws(() => codificarTerrainRgb(new Float32Array([1, NaN]), 2, 1), /NaN/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-'));
  const caminho = path.join(dir, 'terreno.png');
  const bytes = escreverTerrenoPng(caminho, alturas, w, h);
  assert.ok(bytes > 50);
  const volta = lerTerrenoPng(caminho);
  assert.equal(volta.largura, w);
  assert.equal(volta.altura, h);
  assert.equal(volta.colorType, 2, 'RGB sem alpha');
  for (let k = 0; k < alturas.length; k++) assert.ok(Math.abs(volta.alturas[k] - alturas[k]) < 0.1, `nó ${k}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('grade: largura, altura pela proporção em km, graus e metros por nó', () => {
  const g = calcularGrade(BBOX_002, 2048);
  assert.equal(g.largura, 2048);
  const latC = -20.65;
  const kmL = 12.5 * 111.32 * Math.cos(latC * Math.PI / 180);
  const kmA = 2.3 * 111.32;
  assert.ok(Math.abs(g.km.largura - kmL) < 1e-9);
  assert.ok(Math.abs(g.km.altura - kmA) < 1e-9);
  assert.equal(g.altura, Math.round(2048 * kmA / kmL));
  assert.equal(g.altura, 403);
  assert.ok(Math.abs(g.graus_por_no.lon - 12.5 / 2048) < 1e-12);
  assert.ok(Math.abs(g.graus_por_no.lat - 2.3 / 403) < 1e-12);
  assert.ok(Math.abs(g.metros_por_no.x - kmL * 1000 / 2048) < 1e-6);
  assert.ok(Math.abs(g.metros_por_no.y - kmA * 1000 / 403) < 1e-6);
  // m/nó quase iguais nos dois eixos (é o objetivo da altura pela proporção)
  assert.ok(Math.abs(g.metros_por_no.x - g.metros_por_no.y) < 2);
  // nós = centro de célula
  assert.ok(Math.abs(lonDoNo(BBOX_002, g, 0) - (-41 + 12.5 / 2048 / 2)) < 1e-12);
  assert.ok(Math.abs(latDoNo(BBOX_002, g, g.altura - 1) - (-21.8 + 2.3 / 403 / 2)) < 1e-12);
  // Brasil inteiro
  const gb = calcularGrade({ norte: 6.0, sul: -34.0, oeste: -74.5, leste: -28.0 }, 2048);
  assert.equal(gb.largura, 2048);
  assert.equal(gb.altura, Math.round(2048 * (40 * 111.32) / (46.5 * 111.32 * Math.cos(-14 * Math.PI / 180))));
  assert.equal(gb.altura, 1816);
  assert.throws(() => calcularGrade(BBOX_002, 1), /largura inválida/);
  // teto: caixa alta e estreita (1 x 40 graus) não vira 2048 x 84.428 nós; a largura cai na proporção
  const alta = calcularGrade({ norte: 6, sul: -34, oeste: -40, leste: -39 }, 2048);
  assert.ok(alta.altura <= 4096 && alta.altura >= 4000, `altura ${alta.altura}`);
  assert.ok(alta.largura >= 90 && alta.largura <= 100, `largura ${alta.largura}`);
  assert.ok(alta.largura * alta.altura <= 2048 * 2048);
  assert.ok(Math.abs(alta.metros_por_no.x - alta.metros_por_no.y) / alta.metros_por_no.x < 0.05, 'proporção mantida');
  // caixa menor que 1 km não faz sentido
  assert.throws(() => calcularGrade({ norte: -20.0, sul: -20.001, oeste: -40.001, leste: -40.0 }, 2048), /mínimo é 1 km/);
  assert.throws(() => calcularGrade({ norte: -20.0, sul: -21.0, oeste: -40.001, leste: -40.0 }, 2048), /mínimo é 1 km/);
});

test('Terrain-RGB: nós fora da faixa são contados ao codificar', () => {
  const stats = {};
  codificarTerrainRgb(new Float32Array([-10050, -10000, 0, 1667721.5, 1700000, 5]), 3, 2, stats);
  assert.deepEqual(stats, { abaixo: 1, acima: 1 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-'));
  const c = {};
  escreverTerrenoPng(path.join(dir, 't.png'), new Float32Array([1, 2, 3, 4]), 2, 2, c);
  assert.deepEqual(c, { abaixo: 0, acima: 0 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bbox: validação com mensagens claras', () => {
  assert.throws(() => validarBbox(null), /bbox ausente/);
  assert.throws(() => validarBbox({ norte: 'a', sul: 0, oeste: 0, leste: 1 }), /norte/);
  assert.throws(() => validarBbox({ norte: -22, sul: -19, oeste: -41, leste: -28 }), /norte .* maior que sul/);
  assert.throws(() => validarBbox({ norte: -19, sul: -22, oeste: -28, leste: -41 }), /leste .* maior que oeste/);
  assert.throws(() => validarBbox({ norte: 95, sul: -22, oeste: -41, leste: -28 }), /latitude/);
  assert.throws(() => validarBbox({ norte: -19, sul: -22, oeste: -190, leste: -28 }), /longitude/);
  assert.equal(validarBbox(BBOX_002), BBOX_002);
});

test('fusão: Copernicus > 0,5 m vence; senão min(gmrt, 0); sem tile, gmrt', () => {
  assert.equal(fundirNo(10, -50, true), 10);
  assert.equal(fundirNo(0.6, 3, true), 0.6);
  assert.equal(fundirNo(0.5, 3, true), 0, 'exatamente 0,5 não vence');
  assert.equal(fundirNo(0.2, 5, true), 0, 'terra baixa no Copernicus com GMRT positivo vira 0');
  assert.equal(fundirNo(0, -30, true), -30, 'oceano no Copernicus: vale o GMRT negativo');
  assert.equal(fundirNo(0, 12, true), 0, 'oceano no Copernicus com GMRT positivo prende em 0');
  assert.equal(fundirNo(0, 7, false), 7, 'tile ausente: GMRT manda, mesmo positivo');
  assert.equal(fundirNo(NaN, -12, true), -12, 'nodata do Copernicus: vale o GMRT');
  assert.ok(Number.isNaN(fundirNo(0, NaN, true)), 'GMRT NaN no oceano fica NaN para preencher depois');
  const cop = new Float32Array([10, 0, NaN, 0.2]);
  const gmrt = new Float32Array([-5, -40, 3, 9]);
  const existe = new Uint8Array([1, 1, 1, 0]);
  const r = fundirGrade(cop, gmrt, existe);
  assert.deepEqual(Array.from(r.alturas), [10, -40, 3, 9]);
  assert.equal(r.copernicus_nodata, 1);
  assert.equal(r.nos_copernicus, 1);
  const soGmrt = fundirGrade(null, gmrt, null);
  assert.deepEqual(Array.from(soGmrt.alturas), Array.from(gmrt));
});

test('preenchimento: NaN recebe o vizinho válido mais próximo e a contagem bate', () => {
  const w = 5, h = 3;
  const a = new Float32Array([
    1, NaN, NaN, NaN, 9,
    NaN, NaN, NaN, NaN, NaN,
    NaN, NaN, NaN, NaN, NaN,
  ]);
  const n = preencherNaN(a, w, h);
  assert.equal(n, 13);
  for (const v of a) assert.ok(v === v, 'sem NaN depois');
  assert.equal(a[1], 1, 'vizinho do 1');
  assert.equal(a[3], 9, 'vizinho do 9');
  assert.equal(a[w * 2 + 0], 1);
  assert.equal(a[w * 2 + 4], 9);
  // o meio fica com um dos dois (distância igual), nunca outro valor
  assert.ok(a[2] === 1 || a[2] === 9);
  assert.equal(preencherNaN(a, w, h), 0, 'nada a preencher na segunda passada');
  assert.throws(() => preencherNaN(new Float32Array([NaN, NaN]), 2, 1), /nenhum valor válido/);
});

test('amostragem bilinear ignora NaN e prende na borda', () => {
  const w = 3, h = 2;
  const d = new Float32Array([0, 10, 20, 100, 110, 120]);
  assert.equal(amostrarBilinear(d, w, h, 0.5, 0.5), 0, 'centro do pixel 0');
  assert.equal(amostrarBilinear(d, w, h, 1.0, 0.5), 5, 'meio entre 0 e 10');
  assert.ok(Math.abs(amostrarBilinear(d, w, h, 1.5, 1.0) - 60) < 1e-6, 'meio vertical entre 10 e 110');
  assert.equal(amostrarBilinear(d, w, h, -4, -4), 0, 'fora: prende na borda');
  assert.equal(amostrarBilinear(d, w, h, 99, 99), 120);
  const comNaN = new Float32Array([NaN, 10, 20, 100, 110, 120]);
  assert.equal(amostrarBilinear(comNaN, w, h, 1.0, 0.5), 10, 'NaN sai da média');
  assert.ok(Number.isNaN(amostrarBilinear(new Float32Array([NaN, NaN, NaN, NaN]), 2, 2, 1, 1)));
  assert.equal(amostrarVizinho(d, w, h, 2.9, 1.2), 120);
  assert.equal(amostrarVizinho(d, w, h, -1, 0), 0);
});

test('reamostragem de um raster geográfico para a grade de saída', () => {
  // raster 4x2 cobrindo lon -41..-29 (3 graus por pixel), lat -19.5..-21.8 (1,15 por linha), valores = coluna
  const fonte = { dados: new Float32Array([0, 1, 2, 3, 0, 1, 2, 3]), largura: 4, altura: 2, origem: [-41, -19.5], res: [3, -1.15] };
  const grade = calcularGrade(BBOX_002, 8);
  const s = reamostrarParaGrade(fonte, BBOX_002, grade, 'bilinear');
  assert.equal(s.length, 8 * grade.altura);
  // coluna 0 da saída (lon -40,22) cai no pixel 0 (prende na borda): 0; coluna 7 (lon -29,28) no pixel 3: 3
  assert.ok(Math.abs(s[0] - 0) < 1e-6);
  assert.ok(Math.abs(s[7] - 3) < 1e-6);
  // monotônico ao longo da linha
  for (let i = 1; i < 8; i++) assert.ok(s[i] >= s[i - 1]);
});

test('escolha do overview: o mais próximo sem ser mais grosseiro que o alvo', () => {
  const niveis = [3600, 1800, 900, 450].map((n, i) => ({ indice: i, largura: n, altura: n, graus_por_no: 1 / n }));
  const grade = calcularGrade(BBOX_002, 2048);
  const alvo = Math.min(grade.graus_por_no.lon, grade.graus_por_no.lat);
  assert.equal(escolherOverview(niveis, alvo).indice, 3, '636 m/nó pede o overview de 247 m/nó');
  assert.equal(escolherOverview(niveis, 1 / 900).indice, 2, 'igual ao alvo serve');
  assert.equal(escolherOverview(niveis, 1 / 1000).indice, 1, 'um pouco mais fino que 900 cai no 1800');
  assert.equal(escolherOverview(niveis, 1 / 50000).indice, 0, 'alvo mais fino que tudo: a imagem cheia');
});

test('utilidades: minMax, agoraIso, formatação em português', () => {
  assert.deepEqual(minMax(new Float32Array([3, NaN, -7, 2])), { min: -7, max: 3 });
  const iso = agoraIso(new Date(2026, 9, 13, 21, 40, 0));
  assert.match(iso, /^2026-10-13T21:40:00[+-]\d\d:\d\d$/);
  assert.equal(fmtBytes(6393522), '6,1 MB');
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtSegundos(1500), '1,5 s');
  assert.equal(fmtSegundos(125000), '2 min 5 s');
});

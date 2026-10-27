// Testes offline do recorte: rasterização par-ímpar (quadrado com furo, duas ilhas) e os dois recortes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularGrade, lonDoNo, latDoNo, codificarAltura, decodificarAltura, escreverTerrenoPng, lerTerrenoPng } from './terrain.mjs';
import { rasterizarPoligonos, aplicarRecorte, recortarTerreno, minMaxDentro, ehFora, validarRecorte, FORA_M } from './recorte.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// bbox 0..1 grau nos dois eixos, grade 100 x ~100 (altura pela proporção em km: na linha do equador dá 100).
const BBOX = { norte: 1, sul: 0, oeste: 0, leste: 1 };
const GRADE = calcularGrade(BBOX, 100);

// Quadrado de 0,2 a 0,8 (36 % da área) com furo de 0,4 a 0,6 (4 %): 32 % dentro.
const QUADRADO_COM_FURO = [[
  [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]],       // externo fechado (como o IBGE manda)
  [[0.4, 0.4], [0.4, 0.6], [0.6, 0.6], [0.6, 0.4]],                   // furo aberto (sem repetir o primeiro ponto)
]];

function contarPorRegra(fn) {
  let n = 0;
  for (let j = 0; j < GRADE.altura; j++) {
    const lat = latDoNo(BBOX, GRADE, j);
    for (let i = 0; i < GRADE.largura; i++) if (fn(lonDoNo(BBOX, GRADE, i), lat)) n++;
  }
  return n;
}

test('rasterização par-ímpar: quadrado com furo, contado nó a nó', () => {
  assert.equal(GRADE.largura, 100);
  const { dentro, nos_dentro } = rasterizarPoligonos(QUADRADO_COM_FURO, BBOX, GRADE);
  const esperado = contarPorRegra((lon, lat) => lon >= 0.2 && lon < 0.8 && lat >= 0.2 && lat < 0.8 && !(lon >= 0.4 && lon < 0.6 && lat >= 0.4 && lat < 0.6));
  assert.equal(nos_dentro, esperado);
  assert.equal(nos_dentro, 60 * 60 - 20 * 20, 'o nó (i, j) está em (i + 0,5)/100: 60 colunas e 60 linhas no quadrado, 20 x 20 no furo');
  // o centro do furo fica fora, um canto do quadrado fica dentro, fora do quadrado fica fora
  const k = (lon, lat) => Math.floor((BBOX.norte - lat) / GRADE.graus_por_no.lat) * GRADE.largura + Math.floor((lon - BBOX.oeste) / GRADE.graus_por_no.lon);
  assert.equal(dentro[k(0.5, 0.5)], 0, 'centro do furo é fora');
  assert.equal(dentro[k(0.25, 0.25)], 1, 'dentro do quadrado, fora do furo');
  assert.equal(dentro[k(0.1, 0.9)], 0, 'fora do quadrado');
  assert.equal(dentro[k(0.705, 0.305)], 1);
});

test('rasterização: duas ilhas (MultiPolygon) e polígono fora do bbox', () => {
  const duas = [
    [[[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]],
    [[[0.6, 0.6], [0.9, 0.6], [0.9, 0.9], [0.6, 0.9]]],
  ];
  const r = rasterizarPoligonos(duas, BBOX, GRADE);
  assert.equal(r.nos_dentro, 20 * 20 + 30 * 30);
  const fora = rasterizarPoligonos([[[[2, 2], [3, 2], [3, 3], [2, 3]]]], BBOX, GRADE);
  assert.equal(fora.nos_dentro, 0);
  // polígono que extrapola o bbox: prende nas bordas da grade, sem estourar o índice
  const maior = rasterizarPoligonos([[[[-1, -1], [2, -1], [2, 2], [-1, 2]]]], BBOX, GRADE);
  assert.equal(maior.nos_dentro, GRADE.largura * GRADE.altura);
  // triângulo: área 0,5 * base * altura; conta aproximada (tolerância de uma linha de nós)
  const tri = rasterizarPoligonos([[[[0, 0], [1, 0], [0, 1]]]], BBOX, GRADE);
  assert.ok(Math.abs(tri.nos_dentro - 5000) <= 100, `triângulo: ${tri.nos_dentro} nós`);
});

function terrenoSintetico() {
  // terra (+100 m) em todo lugar menos uma faixa de mar (-50 m) no sul (lat < 0,15)
  const a = new Float32Array(GRADE.largura * GRADE.altura);
  for (let j = 0; j < GRADE.altura; j++) {
    const lat = latDoNo(BBOX, GRADE, j);
    for (let i = 0; i < GRADE.largura; i++) a[j * GRADE.largura + i] = lat < 0.15 ? -50 : 100;
  }
  return a;
}

test('recorte contorno: fora vira -10000 exato; dentro fica igual; min/max ignoram o fora', () => {
  const a = terrenoSintetico();
  const { dentro, resumo } = recortarTerreno({ alturas: a, poligonos: QUADRADO_COM_FURO, bbox: BBOX, grade: GRADE, tipo: 'contorno', ibge: { nivel: 'estados', codigo: '28' } });
  assert.equal(resumo.tipo, 'contorno');
  assert.equal(resumo.ibge_nivel, 'estados');
  assert.equal(resumo.ibge_codigo, '28');
  assert.equal(resumo.nos_dentro, 3200);
  assert.equal(resumo.fracao_dentro, 0.32);
  assert.equal(resumo.nos_fora, 10000 - 3200);
  assert.equal(resumo.nos_chapados, 0);
  let fora = 0, dentroOk = 0;
  for (let k = 0; k < a.length; k++) {
    if (dentro[k]) { assert.equal(a[k], 100); dentroOk++; } else { assert.equal(a[k], FORA_M); fora++; }
  }
  assert.equal(fora, 6800);
  assert.equal(dentroOk, 3200);
  assert.deepEqual(minMaxDentro(a), { min: 100, max: 100 }, 'o mar ficou todo fora do quadrado');
  assert.equal(ehFora(FORA_M), true);
  assert.equal(ehFora(-9999), true);
  assert.equal(ehFora(-9998.9), false);
  assert.equal(ehFora(-50), false);
});

test('recorte caixa: terra fora do polígono chapada em 0; mar fica; nada é fora', () => {
  const a = terrenoSintetico();
  const r = recortarTerreno({ alturas: a, poligonos: QUADRADO_COM_FURO, bbox: BBOX, grade: GRADE, tipo: 'caixa', ibge: null });
  assert.equal(r.resumo.tipo, 'caixa');
  assert.equal(r.resumo.ibge_nivel, null);
  assert.equal(r.resumo.nos_dentro, 3200);
  assert.equal(r.resumo.nos_fora, 0);
  // terra fora do quadrado: 100 - 15 = 85 linhas de terra x 100 colunas = 8500 nós de terra; 3200 dentro (o quadrado está todo na terra)
  assert.equal(r.resumo.nos_chapados, 8500 - 3200);
  let zeros = 0, mar = 0, cem = 0, outros = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] === 0) zeros++; else if (a[k] === -50) mar++; else if (a[k] === 100) cem++; else outros++;
  }
  assert.equal(outros, 0);
  assert.equal(zeros, 5300);
  assert.equal(mar, 1500);
  assert.equal(cem, 3200);
  assert.deepEqual(minMaxDentro(a), { min: -50, max: 100 });
});

test('aplicarRecorte valida tipo e tamanhos', () => {
  assert.throws(() => validarRecorte('oval'), /recorte desconhecido/);
  assert.throws(() => aplicarRecorte(new Float32Array(4), new Uint8Array(3), 'caixa'), /4 alturas para 3/);
});

test('FORA sobrevive ao Terrain-RGB: -10000 vira R=G=B=0 e volta exato', () => {
  assert.equal(codificarAltura(FORA_M), 0);
  assert.equal(decodificarAltura(0, 0, 0), FORA_M);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-fora-'));
  const caminho = path.join(temp, 'terreno.png');
  const a = new Float32Array([FORA_M, -50, 0, 100]);
  const clampados = {};
  escreverTerrenoPng(caminho, a, 2, 2, clampados);
  assert.equal(clampados.abaixo, 0, 'FORA não conta como clampado');
  const lido = lerTerrenoPng(caminho);
  assert.deepEqual(Array.from(lido.alturas), [FORA_M, -50, 0, 100]);
  assert.equal(ehFora(lido.alturas[0]), true);
  fs.rmSync(temp, { recursive: true, force: true });
});

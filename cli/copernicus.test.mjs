// Testes offline do copernicus.mjs: nomes de tile, bbox → tiles, tileList, janela e mosaico (sem rede).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeTile, urlTile, tilesDoBbox, lerTileList, janelaDoTile, Mosaico, BUCKET } from './copernicus.mjs';

const BBOX_002 = { norte: -19.5, sul: -21.8, oeste: -41.0, leste: -28.5 };

test('nome do tile pelo canto sul-oeste', () => {
  assert.equal(nomeTile(-21, -41), 'Copernicus_DSM_COG_10_S21_00_W041_00_DEM');
  assert.equal(nomeTile(-20.32, -40.29), 'Copernicus_DSM_COG_10_S21_00_W041_00_DEM', 'Vitória cai no tile S21 W041');
  assert.equal(nomeTile(0, 0), 'Copernicus_DSM_COG_10_N00_00_E000_00_DEM');
  assert.equal(nomeTile(5.2, -60.7), 'Copernicus_DSM_COG_10_N05_00_W061_00_DEM');
  assert.equal(nomeTile(-0.5, -50.5), 'Copernicus_DSM_COG_10_S01_00_W051_00_DEM');
  assert.equal(urlTile('X'), `${BUCKET}/X/X.tif`);
});

test('bbox → tiles: todos os tiles de 1 grau que intersectam', () => {
  const t = tilesDoBbox(BBOX_002);
  assert.equal(t.length, 3 * 13, 'S22..S20 x W041..W029');
  assert.equal(t[0].nome, 'Copernicus_DSM_COG_10_S20_00_W041_00_DEM', 'começa no norte-oeste');
  assert.equal(t[t.length - 1].nome, 'Copernicus_DSM_COG_10_S22_00_W029_00_DEM', 'termina no sul-leste');
  assert.ok(t.some((x) => x.nome === 'Copernicus_DSM_COG_10_S21_00_W030_00_DEM'), 'Trindade');
  // bordas inteiras não puxam o tile seguinte
  const b = tilesDoBbox({ norte: -20, sul: -22, oeste: -41, leste: -40 });
  assert.deepEqual(b.map((x) => x.nome), ['Copernicus_DSM_COG_10_S21_00_W041_00_DEM', 'Copernicus_DSM_COG_10_S22_00_W041_00_DEM']);
  // cruzando o equador e o meridiano de Greenwich
  const c = tilesDoBbox({ norte: 0.5, sul: -0.5, oeste: -0.5, leste: 0.5 });
  assert.deepEqual(c.map((x) => x.nome), [
    'Copernicus_DSM_COG_10_N00_00_W001_00_DEM', 'Copernicus_DSM_COG_10_N00_00_E000_00_DEM',
    'Copernicus_DSM_COG_10_S01_00_W001_00_DEM', 'Copernicus_DSM_COG_10_S01_00_E000_00_DEM',
  ]);
});

test('tileList.txt vira conjunto', () => {
  const s = lerTileList('Copernicus_DSM_COG_10_S21_00_W041_00_DEM\r\nCopernicus_DSM_COG_10_S21_00_W030_00_DEM\n\n');
  assert.equal(s.size, 2);
  assert.ok(s.has('Copernicus_DSM_COG_10_S21_00_W030_00_DEM'));
});

test('janela do overview cobre bbox ∩ tile com margem de 1 pixel', () => {
  const ovW = 450, ovH = 450;
  const desl = [1 / 7200, 1 / 7200];
  // tile S21 W041 (lat -21..-20, lon -41..-40) inteiro dentro do bbox: janela inteira
  assert.deepEqual(janelaDoTile({ tileLat: -21, tileLon: -41, bbox: BBOX_002, ovW, ovH, deslocamento: desl }), [0, 0, 450, 450]);
  // tile S20 W041 (lat -20..-19): só até -19,5 → metade de cima fora, janela começa perto da linha 225
  const j = janelaDoTile({ tileLat: -20, tileLon: -41, bbox: BBOX_002, ovW, ovH, deslocamento: desl });
  assert.equal(j[0], 0);
  assert.equal(j[2], 450);
  assert.ok(j[1] >= 223 && j[1] <= 225, `y0=${j[1]}`);
  assert.equal(j[3], 450);
  // tile S21 W029 (lon -29..-28): bbox vai até -28,5 → metade de leste fora
  const k = janelaDoTile({ tileLat: -21, tileLon: -29, bbox: BBOX_002, ovW, ovH, deslocamento: desl });
  assert.equal(k[0], 0);
  assert.ok(k[2] >= 225 && k[2] <= 227, `x1=${k[2]}`);
});

test('mosaico: bilinear contínuo entre tiles, oceano = 0 fora dos tiles, NaN fora das janelas', () => {
  const ovW = 4, ovH = 4; // tiles de 1 grau com 4x4 pixels (0,25 grau por pixel), sem deslocamento
  const m = new Mosaico({ ovW, ovH, deslocamento: [0, 0] });
  // tile A: lat -21..-20, lon -41..-40, valor = 100 em tudo
  m.adicionar({ lat: -21, lon: -41, janela: [0, 0, 4, 4], largura: 4, altura: 4, dados: new Float32Array(16).fill(100) });
  // tile B à direita: lon -40..-39, valor = 200
  m.adicionar({ lat: -21, lon: -40, janela: [0, 0, 4, 4], largura: 4, altura: 4, dados: new Float32Array(16).fill(200) });
  // tile C ao sul (lat -22..-21) existe mas só tem janela parcial (linhas 0..1)
  m.adicionar({ lat: -22, lon: -41, janela: [0, 0, 4, 2], largura: 4, altura: 2, dados: new Float32Array(8).fill(300) });
  assert.ok(m.existe(-40.5, -20.5));
  assert.ok(!m.existe(-38.5, -20.5), 'tile que não existe');
  // centro de um pixel de A
  assert.equal(m.bilinear(-40.875, -20.125), 100);
  // exatamente na emenda A|B (lon -40): média entre o último pixel de A e o primeiro de B
  assert.ok(Math.abs(m.bilinear(-40, -20.5) - 150) < 1e-6, 'emenda contínua');
  // um quarto de pixel antes da emenda
  const v = m.bilinear(-40.0625, -20.5);
  assert.ok(v > 100 && v < 150, `gradiente na emenda: ${v}`);
  // borda leste de B com o tile ausente ao lado: mistura 200 com 0 (oceano)
  assert.ok(Math.abs(m.bilinear(-39, -20.5) - 100) < 1e-6, 'oceano = 0 fora dos tiles');
  // dentro da janela parcial de C
  assert.equal(m.bilinear(-40.5, -21.125), 300);
  // fora da janela de C (linha 3): só NaN em volta → NaN
  assert.ok(Number.isNaN(m.bilinear(-40.5, -21.875)));
  // nodata do Copernicus vira NaN e sai da média
  const n = new Mosaico({ ovW, ovH, deslocamento: [0, 0] });
  const d = new Float32Array(16).fill(50);
  d[0] = -32767;
  n.adicionar({ lat: -21, lon: -41, janela: [0, 0, 4, 4], largura: 4, altura: 4, dados: d });
  assert.ok(Number.isNaN(n.bilinear(-40.875, -20.125)), 'no centro exato do pixel nodata não há vizinho válido com peso: NaN (a fusão cai no GMRT)');
  assert.equal(n.bilinear(-40.75, -20.125), 50, 'um quarto de pixel para o leste: o nodata sai da média e sobra o vizinho válido');
  assert.equal(n.bilinear(-40.8125, -20.1875), 50, 'entre os quatro: só os válidos pesam');
});

test('mosaico com deslocamento de meio pixel base (pixel-is-point)', () => {
  // overview 2x2 de um tile 4x4 pixel-is-point: deslocamento = meio pixel base = 1/8 grau
  const m = new Mosaico({ ovW: 2, ovH: 2, deslocamento: [1 / 8, 1 / 8] });
  m.adicionar({ lat: -21, lon: -41, janela: [0, 0, 2, 2], largura: 2, altura: 2, dados: new Float32Array([1, 2, 3, 4]) });
  // centro do pixel (0,0) do overview: lon = -41 - 1/8 + 0,25 = -40,875; lat = -20 + 1/8 - 0,25 = -20,125
  assert.equal(m.bilinear(-40.875, -20.125), 1);
  assert.equal(m.bilinear(-40.375, -20.625), 4);
});

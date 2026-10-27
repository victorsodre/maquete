// Testes offline da CLI: opções, --bbox, defaults do lugar.json, leitura e erros de lugar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseBboxTexto, lugarPadrao, lugarIbge, lerLugar, raizDosLugares, exageroSugerido, larguraMmPorProporcao, terraPorEscala, cacheIbgeDe, AJUDA } from './index.mjs';
import { ehPrincipal } from './rede.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

test('opções da linha de comando', () => {
  const o = parseArgs(['002-vitoria-trindade', '--largura', '1024', '--so-gmrt', '--sem-mascara', '--saida', '/tmp/x', '--forcar', '--silencioso', '--timeout', '3']);
  assert.deepEqual(o._, ['002-vitoria-trindade']);
  assert.equal(o.largura, 1024);
  assert.equal(o.soGmrt, true);
  assert.equal(o.semMascara, true);
  assert.equal(o.saida, '/tmp/x');
  assert.equal(o.forcar, true);
  assert.equal(o.silencioso, true);
  assert.equal(o.timeoutMin, 3);
  assert.equal(parseArgs(['-h']).ajuda, true);
  assert.throws(() => parseArgs(['--largura']), /precisa de um valor/);
  assert.throws(() => parseArgs(['--largura', '1']), /inteiro >= 2/);
  assert.throws(() => parseArgs(['--xyz']), /opção desconhecida/);
  assert.throws(() => parseArgs(['--mresolution', 'abc']), /mresolution/);
  const b = parseArgs(['--bbox', '-19.5,-21.8,-41,-28.5', '--slug', 'teste-x', '--nome', 'Teste X']);
  assert.equal(b.bbox, '-19.5,-21.8,-41,-28.5');
  assert.equal(b.slug, 'teste-x');
  assert.equal(b.nome, 'Teste X');
  assert.match(AJUDA, /npx maquete <slug>/);
});

test('opções do IBGE: --pais, --regiao, --uf, --municipio, --recorte, --qualidade, --margem', () => {
  const a = parseArgs(['--uf', 'SE', '--recorte', 'contorno']);
  assert.equal(a.ibge, true);
  assert.equal(a.uf, 'SE');
  assert.equal(a.recorte, 'contorno');
  const b = parseArgs(['--municipio', 'Fernando de Noronha', '--uf', 'PE', '--qualidade', 'maxima', '--margem', '0.1']);
  assert.equal(b.municipio, 'Fernando de Noronha');
  assert.equal(b.uf, 'PE');
  assert.equal(b.qualidade, 'maxima');
  assert.equal(b.margem, 0.1);
  assert.equal(parseArgs(['--pais']).ibge, true);
  assert.equal(parseArgs(['--regiao', '5']).regiao, '5');
  assert.equal(parseArgs(['rio']).ibge, false);
  assert.equal(parseArgs(['sp', '--recorte', 'caixa']).recorte, 'caixa', 'slug de lugar do IBGE aceita --recorte');
  assert.throws(() => parseArgs(['--pais', '--regiao', 'sul']), /um território por vez/);
  assert.throws(() => parseArgs(['--pais', '--uf', 'SP']), /--uf não combina/);
  assert.throws(() => parseArgs(['--pais', '--bbox', '1,0,0,1']), /--bbox não combina/);
  assert.throws(() => parseArgs(['--recorte', 'oval']), /recorte desconhecido/);
  assert.throws(() => parseArgs(['--qualidade', 'alta']), /qualidade desconhecida/);
  assert.throws(() => parseArgs(['--uf', 'SE', '--margem', '3']), /--margem é fração/);
  assert.throws(() => parseArgs(['--bbox', '1,0,0,1', '--slug', 'x', '--recorte', 'caixa']), /só valem com --pais/);
  assert.match(AJUDA, /--municipio <v>/);
  assert.match(AJUDA, /--recorte <tipo>/);
});

test('lugar.json de um território do IBGE: escala, ibge, recorte, margem, terra e peça', () => {
  const se = { nivel: 'estados', codigo: '28', nome: 'Sergipe', sigla: 'SE', slug: 'se' };
  const bboxMalha = { norte: -9.515, sul: -11.5685, oeste: -38.245, leste: -36.3959 };
  const l = lugarIbge({ slug: 'se', territorio: se, bboxMalha, recorte: 'contorno' });
  assert.equal(l.slug, 'se');
  assert.equal(l.nome, 'Sergipe');
  assert.equal(l.escala, 'estado');
  assert.deepEqual(l.ibge, { nivel: 'estados', codigo: '28', nome: 'Sergipe', sigla: 'SE', qualidade: 'maxima' });
  assert.deepEqual(l.bbox, { norte: -9.4329, sul: -11.6506, oeste: -38.319, leste: -36.3219 });
  assert.equal(l.margem, 0.04);
  assert.equal(l.recorte, 'contorno');
  assert.equal(l.largura_max_nos, 1024);
  assert.equal(l.terra, 'gmrt', 'estado é sempre GMRT');
  assert.equal(l.mar, 'gmrt');
  assert.equal(l.mascara, true);
  assert.equal(l.maquete.largura_mm, 266, 'Sergipe é um pouco mais alto (228 km) que largo (202 km): altura em 300 mm, largura 266 mm');
  assert.equal(l.maquete.espessura_mm, 3);
  assert.equal('passo_terra_m' in l.maquete, false, 'o passo fica para o cli/laminas.mjs escolher pela escala');
  assert.deepEqual(Object.keys(l), ['slug', 'nome', 'escala', 'ibge', 'bbox', 'margem', 'recorte', 'largura_max_nos', 'terra', 'mar', 'mascara', 'maquete']);
  // país: intermediaria e recorte caixa por padrão
  const br = lugarIbge({ slug: 'brasil', territorio: { nivel: 'paises', codigo: 'BR', nome: 'Brasil', sigla: 'BR' }, bboxMalha: { norte: 5.2718, sul: -33.7439, oeste: -73.9833, leste: -34.8027 } });
  assert.equal(br.escala, 'pais');
  assert.equal(br.recorte, 'caixa');
  assert.equal(br.ibge.qualidade, 'intermediaria');
  assert.equal(br.terra, 'gmrt');
  assert.ok(br.maquete.largura_mm < 300 && br.maquete.largura_mm > 250, `Brasil é um pouco mais alto que largo: ${br.maquete.largura_mm} mm`);
  // município pequeno: Copernicus; município largo: GMRT
  const nor = lugarIbge({ slug: 'fernando-de-noronha', territorio: { nivel: 'municipios', codigo: '2605459', nome: 'Fernando de Noronha', sigla: 'PE' }, bboxMalha: { norte: -3.8048, sul: -3.88, oeste: -32.4755, leste: -32.3778 } });
  assert.equal(nor.escala, 'municipio');
  assert.equal(nor.terra, 'copernicus');
  assert.equal(nor.ibge.sigla, 'PE');
  const alt = lugarIbge({ slug: 'altamira', territorio: { nivel: 'municipios', codigo: '1500602', nome: 'Altamira', sigla: 'PA' }, bboxMalha: { norte: -2.5, sul: -9.5, oeste: -55.5, leste: -51.5 } });
  assert.equal(alt.terra, 'gmrt', 'município de 400 km de largura vai de GMRT');
  assert.equal(alt.maquete.largura_mm, 170, 'mais alto que largo: lado maior (altura) em 300 mm');
  assert.throws(() => lugarIbge({ slug: 'x', territorio: se, bboxMalha, recorte: 'oval' }), /recorte desconhecido/);
  assert.equal(larguraMmPorProporcao({ largura: 100, altura: 50 }), 300);
  assert.equal(larguraMmPorProporcao({ largura: 50, altura: 100 }), 150);
  assert.equal(terraPorEscala('municipio', 150), 'copernicus');
  assert.equal(terraPorEscala('municipio', 150.1), 'gmrt');
  assert.equal(terraPorEscala('regiao', 10), 'gmrt');
  assert.equal(cacheIbgeDe('/x'), path.join('/x', 'dados', 'cache-ibge'));
});

test('lerLugar valida escala, ibge e recorte (lugar antigo sem escala = local)', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-escala-'));
  const pasta = path.join(raiz, 'lugares', 'se');
  fs.mkdirSync(pasta, { recursive: true });
  const bbox = { norte: 1, sul: 0, oeste: 0, leste: 1 };
  const grava = (obj) => fs.writeFileSync(path.join(pasta, 'lugar.json'), JSON.stringify({ slug: 'se', bbox, ...obj }));
  grava({});
  assert.equal(lerLugar(raiz, 'se').escala, 'local', 'sem escala é local');
  grava({ escala: 'estado', ibge: { nivel: 'estados', codigo: '28', nome: 'Sergipe', sigla: 'SE', qualidade: 'maxima' }, recorte: 'contorno', margem: 0.04 });
  const l = lerLugar(raiz, 'se');
  assert.equal(l.escala, 'estado');
  assert.equal(l.recorte, 'contorno');
  grava({ escala: 'cidade' });
  assert.throws(() => lerLugar(raiz, 'se'), /escala desconhecida/);
  grava({ escala: 'estado' });
  assert.throws(() => lerLugar(raiz, 'se'), /precisa do bloco "ibge"/);
  grava({ recorte: 'caixa' });
  assert.throws(() => lerLugar(raiz, 'se'), /"recorte" precisa do bloco "ibge"/);
  grava({ escala: 'estado', ibge: { nivel: 'estados', codigo: '28' }, recorte: 'oval' });
  assert.throws(() => lerLugar(raiz, 'se'), /recorte desconhecido/);
  grava({ escala: 'estado', ibge: { nivel: 'estados', codigo: '28' }, margem: 5 });
  assert.throws(() => lerLugar(raiz, 'se'), /margem inválida/);
  fs.rmSync(raiz, { recursive: true, force: true });
});

test('--bbox N,S,O,L vira bbox validado', () => {
  assert.deepEqual(parseBboxTexto('-19.5, -21.8, -41, -28.5'), { norte: -19.5, sul: -21.8, oeste: -41, leste: -28.5 });
  assert.throws(() => parseBboxTexto('1,2,3'), /4 números/);
  assert.throws(() => parseBboxTexto('a,b,c,d'), /4 números/);
  assert.throws(() => parseBboxTexto('-21.8,-19.5,-41,-28.5'), /norte .* maior que sul/);
});

test('lugar.json com defaults do SPEC', () => {
  const l = lugarPadrao({ slug: 'teste-x', nome: 'Teste X', bbox: { norte: 1, sul: 0, oeste: 0, leste: 1 } });
  assert.equal(l.slug, 'teste-x');
  assert.equal(l.nome, 'Teste X');
  assert.equal(l.exagero_vertical, 15);
  assert.equal(l.largura_max_nos, 2048);
  assert.equal(l.terra, 'copernicus');
  assert.equal(l.mar, 'gmrt');
  assert.equal(l.mascara, true);
  assert.equal(l.nivel_minimo_m, -5500);
  assert.equal(l.regua, null);
  assert.equal('mresolution' in l, false, 'sem --mresolution o campo não entra');
  assert.equal(lugarPadrao({ slug: 's', bbox: { norte: 1, sul: 0, oeste: 0, leste: 1 } }).nome, 's');
  // as opções da criação ficam gravadas (senão a rodada seguinte refaz em 2048 e baixa tudo de novo)
  const c = lugarPadrao({ slug: 's', bbox: { norte: 1, sul: 0, oeste: 0, leste: 1 }, largura_max_nos: 256, mresolution: 120, terra: 'gmrt', mascara: false, exagero_vertical: 5 });
  assert.equal(c.largura_max_nos, 256);
  assert.equal(c.mresolution, 120);
  assert.equal(c.terra, 'gmrt');
  assert.equal(c.mascara, false);
  assert.equal(c.exagero_vertical, 5);
  assert.deepEqual(Object.keys(c).slice(0, 7), ['slug', 'nome', 'bbox', 'exagero_vertical', 'largura_max_nos', 'mresolution', 'terra']);
});

test('exagero sugerido pela largura da caixa', () => {
  assert.equal(exageroSugerido(1302), 15);
  assert.equal(exageroSugerido(500), 15);
  assert.equal(exageroSugerido(100), 5);
  assert.equal(exageroSugerido(300), 10);
  assert.equal(exageroSugerido(30), 2);
  assert.equal(exageroSugerido(21), 2);
  assert.equal(exageroSugerido(NaN), 15);
});

test('bin por symlink (como o npm instala em node_modules/.bin) imprime a ajuda', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-bin-'));
  const link = path.join(temp, 'maquete');
  fs.symlinkSync(path.join(AQUI, 'index.mjs'), link);
  const r = spawnSync(process.execPath, [link, '--ajuda'], { encoding: 'utf8', cwd: temp });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Uso:/, 'via symlink a ajuda tem de sair');
  assert.equal(ehPrincipal(new URL('./index.mjs', import.meta.url).href, link), true);
  assert.equal(ehPrincipal(new URL('./index.mjs', import.meta.url).href, path.join(temp, 'nao-existe')), false);
  assert.equal(ehPrincipal(new URL('./index.mjs', import.meta.url).href, undefined), false);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('lerLugar: lê, valida e explica o que falta', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-'));
  fs.mkdirSync(path.join(raiz, 'lugares', 'ok-1'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'lugares', 'ok-1', 'lugar.json'), JSON.stringify({ slug: 'ok-1', nome: 'Ok', bbox: { norte: 1, sul: 0, oeste: 0, leste: 1 }, terra: 'gmrt' }));
  const l = lerLugar(raiz, 'ok-1');
  assert.equal(l.largura_max_nos, 2048, 'default quando falta');
  assert.equal(l.terra, 'gmrt');
  assert.equal(l.pasta, path.join(raiz, 'lugares', 'ok-1'));
  assert.throws(() => lerLugar(raiz, 'nao-existe'), /lugar não encontrado/);
  assert.throws(() => lerLugar(raiz, 'Maiusculo'), /slug inválido/);
  fs.mkdirSync(path.join(raiz, 'lugares', 'ruim-1'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'lugares', 'ruim-1', 'lugar.json'), '{ nao é json');
  assert.throws(() => lerLugar(raiz, 'ruim-1'), /lugar.json inválido/);
  fs.writeFileSync(path.join(raiz, 'lugares', 'ruim-1', 'lugar.json'), JSON.stringify({ slug: 'ruim-1', bbox: { norte: 0, sul: 1, oeste: 0, leste: 1 } }));
  assert.throws(() => lerLugar(raiz, 'ruim-1'), /bbox inválido/);
  fs.writeFileSync(path.join(raiz, 'lugares', 'ruim-1', 'lugar.json'), JSON.stringify({ slug: 'outro', bbox: { norte: 1, sul: 0, oeste: 0, leste: 1 } }));
  assert.throws(() => lerLugar(raiz, 'ruim-1'), /slug "outro"/);
  fs.writeFileSync(path.join(raiz, 'lugares', 'ruim-1', 'lugar.json'), JSON.stringify({ slug: 'ruim-1', bbox: { norte: 1, sul: 0, oeste: 0, leste: 1 }, terra: 'srtm' }));
  assert.throws(() => lerLugar(raiz, 'ruim-1'), /terra desconhecida/);
  assert.throws(() => lerLugar(raiz, 'nao-existe'), /procurei em/);
  // raiz dos lugares: a pasta atual; a raiz do pacote só para um lugar que já existe lá
  assert.equal(raizDosLugares(raiz), raiz);
  assert.equal(raizDosLugares(raiz, 'ok-1'), raiz);
  const vazia = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-vazia-'));
  assert.equal(raizDosLugares(vazia), vazia, 'sem lugares/ a raiz continua sendo a pasta atual (criação é sempre nela)');
  assert.equal(raizDosLugares(vazia, 'nao-existe-em-lugar-nenhum'), vazia);
  assert.equal(raizDosLugares(vazia, 'rio'), path.resolve(AQUI, '..'), 'lugar que só existe no pacote: lê de lá');
  fs.rmSync(vazia, { recursive: true, force: true });
  fs.rmSync(raiz, { recursive: true, force: true });
});

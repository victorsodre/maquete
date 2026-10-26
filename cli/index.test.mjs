// Testes offline da CLI: opções, --bbox, defaults do lugar.json, leitura e erros de lugar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseBboxTexto, lugarPadrao, lerLugar, raizDosLugares, exageroSugerido, AJUDA } from './index.mjs';
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

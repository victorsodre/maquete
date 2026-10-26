// Testes das peças comuns da captura: argumentos, URL, cadeados (dono morto, dono vivo, estouro, soltar).
// Roda com: node --test captura/comum.test.mjs   (não abre navegador)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { lerArgs, numero, montarUrl, precisaServidor, pegarCadeado, bytesDiferentes, nomeQuadro, conferirRenderizador } from './comum.mjs';

test('renderizador: SwiftShader aborta, sem Metal avisa, Metal passa', () => {
  assert.throws(() => conferirRenderizador('Google SwiftShader'), /por software/);
  assert.throws(() => conferirRenderizador('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), /SwiftShader/);
  assert.throws(() => conferirRenderizador('llvmpipe (LLVM 15.0.7, 256 bits)'), /por software/);
  assert.equal(conferirRenderizador('ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro Vega 56, Unspecified Version)'), null);
  assert.match(conferirRenderizador('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'), /sem Metal/);
  assert.match(conferirRenderizador(null), /não informado/);
});

test('lerArgs: posicionais, --chave valor, --chave=valor e flags', () => {
  const { posicionais, opcoes } = lerArgs(['002', '--fps', '30', '--ate=fim', '--url', '/captura/stub/index.html', '--ajuda']);
  assert.deepEqual(posicionais, ['002']);
  assert.equal(opcoes.fps, '30');
  assert.equal(opcoes.ate, 'fim');
  assert.equal(opcoes.url, '/captura/stub/index.html');
  assert.equal(opcoes.ajuda, true);
  assert.equal(numero(opcoes.fps, 24, 'fps'), 30);
  assert.equal(numero(undefined, 24, 'fps'), 24);
  assert.equal(numero('2,5', 0, 'de'), 2.5);
  assert.throws(() => numero('x', 0, 'de'), /--de precisa ser um número/);
});

test('montarUrl: caminho no repo usa o servidor próprio; http de fora não', () => {
  assert.equal(precisaServidor(undefined), true);
  assert.equal(precisaServidor('/captura/stub/index.html'), true);
  assert.equal(precisaServidor('http://127.0.0.1:8765/index.html'), false);
  assert.equal(montarUrl({ url: undefined, base: 'http://127.0.0.1:1234', slug: '002', t: 0 }), 'http://127.0.0.1:1234/index.html?lugar=002&t=0&capture=1');
  assert.equal(montarUrl({ url: 'captura/stub/index.html', base: 'http://127.0.0.1:1234', slug: 'stub', t: 2.5 }), 'http://127.0.0.1:1234/captura/stub/index.html?lugar=stub&t=2.5&capture=1');
  assert.equal(montarUrl({ url: 'http://127.0.0.1:8765/variante/?lugar=001', base: null, slug: '002', t: 1 }), 'http://127.0.0.1:8765/variante/?lugar=001&t=1&capture=1');
});

test('nomeQuadro e bytesDiferentes', () => {
  assert.equal(nomeQuadro(1), 'q_000001.png');
  assert.equal(nomeQuadro(1830), 'q_001830.png');
  assert.equal(bytesDiferentes(Buffer.from('abc'), Buffer.from('abc')), 0);
  assert.equal(bytesDiferentes(Buffer.from('abc'), Buffer.from('abd')), 1);
  assert.equal(bytesDiferentes(Buffer.from('abc'), Buffer.from('abcde')), 2);
});

test('cadeado: pega, grava o pid e solta só o próprio', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-cadeado-'));
  const dir = path.join(temp, 'lock');
  const soltar = await pegarCadeado(dir, { rotulo: 'teste', poll_ms: 50, espera_max_ms: 1000 });
  assert.equal(fs.readFileSync(path.join(dir, 'pid'), 'utf8'), String(process.pid));
  soltar();
  assert.equal(fs.existsSync(dir), false);
  soltar(); // idempotente
  // se outro processo já tomou o lugar, soltar não derruba o dele
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pid'), '1');
  soltar();
  assert.equal(fs.existsSync(dir), true);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('cadeado: dono morto é retirado (confirmado 1 s depois) e o cadeado é tomado', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-cadeado-'));
  const dir = path.join(temp, 'lock');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pid'), '2147483000'); // pid que não existe
  const t0 = performance.now();
  const soltar = await pegarCadeado(dir, { rotulo: 'teste', poll_ms: 50, espera_max_ms: 5000 });
  const ms = performance.now() - t0;
  assert.ok(ms >= 900 && ms < 4000, `levou ${ms} ms`);
  assert.equal(fs.readFileSync(path.join(dir, 'pid'), 'utf8'), String(process.pid));
  soltar();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('cadeado: dono vivo faz esperar; estoura em espera_max; libera quando o dono sai', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-cadeado-'));
  const dir = path.join(temp, 'lock');
  const dono = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'pid'), String(dono.pid));
    let esperas = 0;
    await assert.rejects(
      pegarCadeado(dir, { rotulo: 'teste', poll_ms: 50, espera_max_ms: 300, aoEsperar: () => { esperas++; } }),
      /continua ocupado/,
    );
    assert.ok(esperas >= 2, `esperou ${esperas} vezes`);
    assert.equal(fs.readFileSync(path.join(dir, 'pid'), 'utf8'), String(dono.pid));
    // o dono some no meio da espera: o próximo poll retira o cadeado e toma
    const promessa = pegarCadeado(dir, { rotulo: 'teste', poll_ms: 50, espera_max_ms: 10000 });
    setTimeout(() => dono.kill('SIGKILL'), 150);
    const soltar = await promessa;
    assert.equal(fs.readFileSync(path.join(dir, 'pid'), 'utf8'), String(process.pid));
    soltar();
  } finally {
    if (dono.exitCode === null) dono.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('cadeado: diretório sem pid há mais de 1 min é resto e sai', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-cadeado-'));
  const dir = path.join(temp, 'lock');
  fs.mkdirSync(dir);
  const velho = new Date(Date.now() - 120000);
  fs.utimesSync(dir, velho, velho);
  const soltar = await pegarCadeado(dir, { rotulo: 'teste', poll_ms: 50, espera_max_ms: 2000 });
  assert.equal(fs.readFileSync(path.join(dir, 'pid'), 'utf8'), String(process.pid));
  soltar();
  fs.rmSync(temp, { recursive: true, force: true });
});

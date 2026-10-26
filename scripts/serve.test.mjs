// Teste do servidor estático (scripts/serve.mjs): porta efêmera, arquivo, 404 e proteção de caminho.
// Roda com: node --test scripts/serve.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarServidor } from './serve.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pedir(porta, caminho, { metodo = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, agent: false }, (res) => {
      const partes = [];
      res.on('data', (d) => partes.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes).toString() }));
    });
    req.setTimeout(3000, () => req.destroy(new Error('sem resposta em 3 s')));
    req.on('error', reject);
    req.end();
  });
}

// Pedido cru pelo socket: o request-target vai como está, sem o parser de URL do cliente normalizar.
function pedirCru(porta, alvo) {
  return new Promise((resolve, reject) => {
    const s = net.connect(porta, '127.0.0.1', () => s.write(`GET ${alvo} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    let dados = '';
    s.setTimeout(3000, () => s.destroy(new Error('sem resposta em 3 s')));
    s.on('data', (d) => { dados += d; });
    s.on('error', reject);
    s.on('close', () => resolve({ status: Number((dados.match(/^HTTP\/1\.[01] (\d{3})/) || [])[1]), corpo: dados.split('\r\n\r\n').slice(1).join('\r\n\r\n') }));
  });
}

async function subir(raiz) {
  const srv = criarServidor(raiz);
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  return { srv, porta: srv.address().port, fechar: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); }) };
}

test('serve arquivos de uma raiz em porta efêmera e protege o que está fora dela', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-serve-'));
  const raiz = path.join(temp, 'site');
  fs.mkdirSync(path.join(raiz, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'index.html'), '<h1>PAGINA_PUBLICA</h1>');
  fs.writeFileSync(path.join(raiz, 'dados.json'), '{"ok":true}');
  fs.writeFileSync(path.join(raiz, 'sub', 'index.html'), 'SUB_PUBLICA');
  fs.writeFileSync(path.join(temp, 'fora.txt'), 'SEGREDO_FORA_DA_RAIZ');
  const { porta, fechar } = await subir(raiz);
  t.after(async () => { await fechar(); fs.rmSync(temp, { recursive: true, force: true }); });

  await t.test('porta efêmera e index.html na raiz', async () => {
    assert.ok(porta > 0);
    const r = await pedir(porta, '/');
    assert.equal(r.status, 200);
    assert.equal(r.corpo, '<h1>PAGINA_PUBLICA</h1>');
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.equal(r.headers['cache-control'], 'no-cache');
  });

  await t.test('arquivo com MIME e Content-Length', async () => {
    const r = await pedir(porta, '/dados.json');
    assert.equal(r.status, 200);
    assert.equal(r.corpo, '{"ok":true}');
    assert.match(r.headers['content-type'], /^application\/json/);
    assert.equal(Number(r.headers['content-length']), Buffer.byteLength('{"ok":true}'));
  });

  await t.test('HEAD responde sem corpo', async () => {
    const r = await pedir(porta, '/dados.json', { metodo: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo, '');
  });

  await t.test('pasta redireciona para a barra e serve o index dela', async () => {
    const r = await pedir(porta, '/sub');
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, '/sub/');
    const r2 = await pedir(porta, '/sub/');
    assert.equal(r2.status, 200);
    assert.equal(r2.corpo, 'SUB_PUBLICA');
  });

  await t.test('404 para o que não existe', async () => {
    const r = await pedir(porta, '/nao-existe.png');
    assert.equal(r.status, 404);
    assert.match(r.corpo, /não achei/);
    assert.equal((await pedir(porta, '/sub/nada/')).status, 404);
  });

  await t.test('../ nunca sai da raiz (normalizado, codificado, duplo e cru)', async () => {
    const alvos = ['/../fora.txt', '/sub/../../fora.txt', '/..%2ffora.txt', '/sub/..%2f..%2ffora.txt', '/%2e%2e/fora.txt', '/%2e%2e%2ffora.txt', '/sub/%2e%2e/%2e%2e/fora.txt'];
    for (const alvo of alvos) {
      const r = await pedir(porta, alvo);
      assert.ok(r.status === 403 || r.status === 404, `${alvo}: status ${r.status}`);
      assert.ok(!r.corpo.includes('SEGREDO_FORA_DA_RAIZ'), `${alvo} vazou o arquivo de fora`);
    }
    // o caminho codificado passa pelo decodeURIComponent e cai na checagem da raiz: 403
    assert.equal((await pedir(porta, '/..%2ffora.txt')).status, 403);
    for (const alvo of ['/../fora.txt', '/../../fora.txt', '/sub/../../fora.txt']) {
      const r = await pedirCru(porta, alvo);
      assert.ok(r.status === 403 || r.status === 404 || r.status === 400, `cru ${alvo}: status ${r.status}`);
      assert.ok(!r.corpo.includes('SEGREDO_FORA_DA_RAIZ'), `cru ${alvo} vazou o arquivo de fora`);
    }
  });

  await t.test('symlink dentro da raiz apontando para fora não é servido', async () => {
    fs.symlinkSync(path.join(temp, 'fora.txt'), path.join(raiz, 'link-para-fora.txt'));
    fs.symlinkSync(path.join(raiz, 'dados.json'), path.join(raiz, 'link-para-dentro.json'));
    const r = await pedir(porta, '/link-para-fora.txt');
    assert.equal(r.status, 403);
    assert.ok(!r.corpo.includes('SEGREDO_FORA_DA_RAIZ'));
    const ok = await pedir(porta, '/link-para-dentro.json');
    assert.equal(ok.status, 200, 'symlink para dentro da raiz continua servido');
    assert.equal(ok.corpo, '{"ok":true}');
  });

  await t.test('URL com percent inválido não derruba o servidor', async () => {
    const r = await pedir(porta, '/%zz');
    assert.ok(r.status >= 400 && r.status < 600);
    assert.equal((await pedir(porta, '/')).status, 200);
  });
});

test('raiz padrão é o repo: package.json e a página do stub da captura respondem', async (t) => {
  const { porta, fechar } = await subir();
  t.after(fechar);
  const r = await pedir(porta, '/package.json');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.corpo).name, 'maquete');
  assert.equal(path.resolve(REPO, 'package.json'), path.join(REPO, 'package.json'));
  const stub = await pedir(porta, '/captura/stub/index.html');
  assert.equal(stub.status, 200);
  assert.match(stub.corpo, /window\.__maquete/);
});

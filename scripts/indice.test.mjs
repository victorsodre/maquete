// Teste do índice dos lugares (scripts/indice.mjs): pasta temporária com lugares de várias escalas,
// um sem laminas.json (fica de fora com aviso), ordem por escala e nome sem acento, formato do contrato.
// Roda com: node --test scripts/indice.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ESCALAS, entradaDe, escalaDe, ufDe, ordenar, gerarIndice, gravarIndice } from './indice.mjs';

const laminasFalso = (n, kmLargura, extra = {}) => ({
  km: { largura: kmLargura, altura: kmLargura * 0.75 },
  largura_mm: 300, altura_mm: 225, espessura_mm: 3,
  laminas: Array.from({ length: n }, (_, k) => ({ k, nivel_m: k * 100, tipo: k ? 'terra' : 'costa', aneis: [] })),
  ...extra,
});

function criarLugar(raiz, slug, lugar, laminas) {
  const pasta = path.join(raiz, slug);
  fs.mkdirSync(pasta, { recursive: true });
  if (lugar !== null) fs.writeFileSync(path.join(pasta, 'lugar.json'), typeof lugar === 'string' ? lugar : JSON.stringify(lugar));
  if (laminas !== null) fs.writeFileSync(path.join(pasta, 'laminas.json'), typeof laminas === 'string' ? laminas : JSON.stringify(laminas));
  return pasta;
}

test('índice: varre a pasta, pula quem não tem laminas.json e ordena por escala e nome', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-indice-'));
  const raiz = path.join(temp, 'lugares');
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  criarLugar(raiz, 'rio', { slug: 'rio', nome: 'Rio de Janeiro e Baía de Guanabara' }, laminasFalso(12, 56.44));
  criarLugar(raiz, 'floripa', { slug: 'floripa', nome: 'Florianópolis' }, laminasFalso(17, 49.3));
  criarLugar(raiz, 'brasil', { slug: 'brasil', nome: 'Brasil', escala: 'pais', ibge: { nivel: 'paises', codigo: 'BR', nome: 'Brasil', qualidade: 'intermediaria' }, recorte: 'caixa' }, laminasFalso(16, 4300, { escala: 'pais', exagero: 180, teto_m: 2000 }));
  criarLugar(raiz, 'sp', { slug: 'sp', nome: 'São Paulo', escala: 'estado', ibge: { nivel: 'estados', codigo: '35', nome: 'São Paulo', sigla: 'SP' } }, laminasFalso(14, 1000));
  criarLugar(raiz, 'ac', { slug: 'ac', nome: 'Acre', escala: 'estado', ibge: { nivel: 'estados', codigo: '12', nome: 'Acre', sigla: 'ac' } }, laminasFalso(9, 800));
  criarLugar(raiz, 'am', { slug: 'am', nome: 'Amazonas', escala: 'estado', ibge: { nivel: 'estados', codigo: '13', nome: 'Amazonas', sigla: 'AM' } }, laminasFalso(10, 1500));
  criarLugar(raiz, 'sao-paulo', { slug: 'sao-paulo', nome: 'São Paulo', escala: 'municipio', ibge: { nivel: 'municipios', codigo: '3550308', nome: 'São Paulo', sigla: 'SP' } }, laminasFalso(11, 80));
  criarLugar(raiz, 'regiao-sul', { slug: 'regiao-sul', nome: 'Sul', escala: 'regiao', ibge: { nivel: 'regioes', codigo: '4', nome: 'Sul', sigla: 'S' } }, laminasFalso(12, 1200));
  criarLugar(raiz, 'sem-laminas', { slug: 'sem-laminas', nome: 'Ainda não gerado' }, null);
  criarLugar(raiz, 'sem-lugar', null, laminasFalso(3, 10));
  criarLugar(raiz, 'quebrado', '{ nome: sem aspas', laminasFalso(3, 10));
  criarLugar(raiz, 'escala-errada', { slug: 'escala-errada', nome: 'Zona', escala: 'galaxia' }, laminasFalso(4, 20));
  criarLugar(raiz, 'Maiúsculo', { slug: 'Maiúsculo', nome: 'Pasta fora do padrão' }, laminasFalso(4, 20));
  fs.writeFileSync(path.join(raiz, 'index.json'), '{}');   // arquivo solto na pasta não é lugar

  const avisos = [];
  const fixo = new Date('2026-10-26T18:00:00.000Z');
  const indice = gerarIndice(raiz, { avisar: (m) => avisos.push(m), agora: () => fixo });

  await t.test('formato do contrato', () => {
    assert.deepEqual(Object.keys(indice), ['gerado_em', 'escalas', 'lugares']);
    assert.equal(indice.gerado_em, '2026-10-26T18:00:00.000Z');
    assert.deepEqual(indice.escalas, [
      { id: 'pais', nome: 'País' }, { id: 'regiao', nome: 'Região' }, { id: 'estado', nome: 'Estado' },
      { id: 'municipio', nome: 'Município' }, { id: 'local', nome: 'Local' },
    ]);
    assert.deepEqual(indice.escalas, ESCALAS);
    for (const l of indice.lugares) {
      assert.deepEqual(Object.keys(l), ['slug', 'nome', 'escala', 'uf', 'km_largura', 'laminas']);
      assert.ok(ESCALAS.some((e) => e.id === l.escala), `escala ${l.escala}`);
      assert.ok(Number.isInteger(l.laminas) && l.laminas > 0);
      assert.ok(l.km_largura > 0);
      assert.ok(l.uf === null || /^[A-Z]{2}$/.test(l.uf));
    }
  });

  await t.test('quem entra e quem fica de fora, com aviso', () => {
    const slugs = indice.lugares.map((l) => l.slug);
    assert.ok(!slugs.includes('sem-laminas'));
    assert.ok(!slugs.includes('sem-lugar'));
    assert.ok(!slugs.includes('quebrado'));
    assert.ok(!slugs.includes('Maiúsculo'));
    assert.ok(slugs.includes('escala-errada'), 'escala desconhecida entra como local');
    assert.ok(avisos.some((m) => m.startsWith('sem-laminas:') && /laminas\.json/.test(m)), avisos.join('\n'));
    assert.ok(avisos.some((m) => m.startsWith('sem-lugar:')));
    assert.ok(avisos.some((m) => m.startsWith('quebrado:')));
    assert.ok(avisos.some((m) => m.startsWith('escala-errada:') && /galaxia/.test(m)));
    assert.ok(avisos.some((m) => m.startsWith('Maiúsculo:')));
    assert.equal(indice.lugares.length, 9);
  });

  await t.test('ordem: escalas do contrato, depois nome em pt-BR sem acento', () => {
    assert.deepEqual(indice.lugares.map((l) => l.slug), [
      'brasil',                       // país
      'regiao-sul',                   // região
      'ac', 'am', 'sp',               // estados por nome: Acre, Amazonas, São Paulo
      'sao-paulo',                    // município
      'floripa', 'rio', 'escala-errada',   // local: Florianópolis, Rio..., Zona
    ]);
  });

  await t.test('campos de cada entrada', () => {
    const por = Object.fromEntries(indice.lugares.map((l) => [l.slug, l]));
    assert.deepEqual(por.rio, { slug: 'rio', nome: 'Rio de Janeiro e Baía de Guanabara', escala: 'local', uf: null, km_largura: 56.4, laminas: 12 });
    assert.deepEqual(por.brasil, { slug: 'brasil', nome: 'Brasil', escala: 'pais', uf: null, km_largura: 4300, laminas: 16 });
    assert.deepEqual(por.sp, { slug: 'sp', nome: 'São Paulo', escala: 'estado', uf: 'SP', km_largura: 1000, laminas: 14 });
    assert.equal(por.ac.uf, 'AC', 'sigla minúscula no lugar.json vira maiúscula');
    assert.deepEqual(por['sao-paulo'], { slug: 'sao-paulo', nome: 'São Paulo', escala: 'municipio', uf: 'SP', km_largura: 80, laminas: 11 });
    assert.equal(por['regiao-sul'].uf, null, 'região não tem UF');
  });

  await t.test('gravarIndice escreve o arquivo e devolve o mesmo índice', () => {
    const saida = path.join(temp, 'saida', 'index.json');
    const gravado = gravarIndice(raiz, saida, { agora: () => fixo });
    assert.deepEqual(JSON.parse(fs.readFileSync(saida, 'utf8')), gravado);
    assert.deepEqual(gravado, indice);
    assert.ok(fs.readFileSync(saida, 'utf8').endsWith('\n'));
  });
});

test('índice: pasta inexistente ou vazia dá índice vazio, sem erro', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-indice-vazio-'));
  try {
    const nada = gerarIndice(path.join(temp, 'nao-existe'));
    assert.deepEqual(nada.lugares, []);
    assert.equal(nada.escalas.length, 5);
    assert.ok(!Number.isNaN(Date.parse(nada.gerado_em)));
    const vazia = gerarIndice(temp);
    assert.deepEqual(vazia.lugares, []);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('peças puras: escalaDe, ufDe, entradaDe e ordenar', () => {
  assert.equal(escalaDe({}), 'local');
  assert.equal(escalaDe({ escala: 'regiao' }), 'regiao');
  assert.equal(escalaDe({ escala: 'bairro' }), 'local');
  assert.equal(ufDe({ ibge: { nivel: 'estados', sigla: 'rj' } }), 'RJ');
  assert.equal(ufDe({ ibge: { nivel: 'paises', sigla: 'BR' } }), null);
  assert.equal(ufDe({ ibge: { nivel: 'municipios', sigla: 'XYZ' } }), null);
  assert.equal(ufDe({}), null);
  assert.equal(entradaDe('/caminho/que/nao/existe'), null);
  const ordem = ordenar([
    { slug: 'b', nome: 'Água', escala: 'local' }, { slug: 'a', nome: 'Abacate', escala: 'local' },
    { slug: 'c', nome: 'Étnico', escala: 'local' }, { slug: 'd', nome: 'Zebra', escala: 'pais' },
    { slug: 'e', nome: 'agua', escala: 'local' },
  ]).map((l) => l.slug);
  assert.deepEqual(ordem, ['d', 'a', 'b', 'e', 'c']);
});

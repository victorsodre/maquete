// Testes offline do IBGE: nomes, slugs, URLs, resolução por nome/sigla/código com listas fixas,
// GeoJSON -> polígonos, bbox e margem. Nada aqui toca a rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarNome, kebab, qualidadePadrao, urlLista, urlMalha, poligonosDoGeoJson, contarPontos, bboxDosPoligonos, bboxComMargem,
  resolverPais, resolverRegiao, resolverEstado, resolverMunicipio, ufDoMunicipio, blocoIbge, validarBlocoIbge, fonteIbge,
  centroideDoAnel, poligonosDoBbox, bboxPrincipal, poligonosForaDoBbox,
  IBGE_ATRIBUICAO, ESCALA_DO_NIVEL, MARGEM_PADRAO, FATOR_ILHA_FORA,
} from './ibge.mjs';

const REGIOES = [
  { id: 1, sigla: 'N', nome: 'Norte' }, { id: 2, sigla: 'NE', nome: 'Nordeste' }, { id: 3, sigla: 'SE', nome: 'Sudeste' },
  { id: 4, sigla: 'S', nome: 'Sul' }, { id: 5, sigla: 'CO', nome: 'Centro-Oeste' },
];
const ESTADOS = [
  { id: 28, sigla: 'SE', nome: 'Sergipe', regiao: { id: 2, sigla: 'NE', nome: 'Nordeste' } },
  { id: 35, sigla: 'SP', nome: 'São Paulo', regiao: { id: 3, sigla: 'SE', nome: 'Sudeste' } },
  { id: 26, sigla: 'PE', nome: 'Pernambuco', regiao: { id: 2, sigla: 'NE', nome: 'Nordeste' } },
  { id: 50, sigla: 'MS', nome: 'Mato Grosso do Sul', regiao: { id: 5, sigla: 'CO', nome: 'Centro-Oeste' } },
  { id: 51, sigla: 'MT', nome: 'Mato Grosso', regiao: { id: 5, sigla: 'CO', nome: 'Centro-Oeste' } },
];
const uf = (sigla) => ({ microrregiao: { mesorregiao: { UF: { sigla } } } });
const MUNICIPIOS = [
  { id: 3550308, nome: 'São Paulo', ...uf('SP') },
  { id: 2605459, nome: 'Fernando de Noronha', ...uf('PE') },
  { id: 5002209, nome: 'Bonito', ...uf('MS') },
  { id: 2602506, nome: 'Bonito', ...uf('PE') },
  { id: 5101837, nome: 'Boa Esperança do Norte', microrregiao: null, 'regiao-imediata': { 'regiao-intermediaria': { UF: { sigla: 'MT' } } } },
  { id: 5101838, nome: 'Sem Nada', microrregiao: null },
];

test('normalizar e kebab: acento-insensível, ASCII', () => {
  assert.equal(normalizarNome('  São   Paulo '), 'sao paulo');
  assert.equal(normalizarNome('CENTRO-OESTE'), 'centro-oeste');
  assert.equal(kebab('São Paulo'), 'sao-paulo');
  assert.equal(kebab('Centro-Oeste'), 'centro-oeste');
  assert.equal(kebab("Santa Bárbara d'Oeste"), 'santa-barbara-d-oeste');
  assert.equal(kebab('Fernando de Noronha'), 'fernando-de-noronha');
  assert.equal(kebab('Belo Horizonte'), 'belo-horizonte');
});

test('qualidade padrão por nível, escalas e URLs', () => {
  assert.equal(qualidadePadrao('paises'), 'intermediaria');
  assert.equal(qualidadePadrao('regioes'), 'intermediaria');
  assert.equal(qualidadePadrao('estados'), 'maxima');
  assert.equal(qualidadePadrao('municipios'), 'maxima');
  assert.deepEqual(ESCALA_DO_NIVEL, { paises: 'pais', regioes: 'regiao', estados: 'estado', municipios: 'municipio' });
  assert.equal(urlLista('estados'), 'https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome');
  assert.equal(urlLista('municipios'), 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome');
  assert.equal(urlLista('regioes'), 'https://servicodados.ibge.gov.br/api/v1/localidades/regioes');
  assert.equal(urlMalha('paises', 'BR', 'intermediaria'), 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=intermediaria');
  assert.equal(urlMalha('municipios', '3304557', 'maxima'), 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios/3304557?formato=application/vnd.geo+json&qualidade=maxima');
  assert.throws(() => urlMalha('bairros', '1', 'maxima'), /nível do IBGE desconhecido/);
  assert.throws(() => urlMalha('estados', '35', 'alta'), /qualidade desconhecida/);
  assert.throws(() => urlMalha('estados', '35/../x', 'maxima'), /código do IBGE inválido/);
  assert.equal(IBGE_ATRIBUICAO, 'IBGE, Malhas Territoriais');
});

test('resolver país, região e estado por nome, sigla ou código', () => {
  assert.deepEqual(resolverPais(), { nivel: 'paises', codigo: 'BR', nome: 'Brasil', sigla: 'BR', slug: 'brasil' });
  assert.equal(resolverRegiao('sul', REGIOES).slug, 'regiao-sul');
  assert.equal(resolverRegiao('Centro-Oeste', REGIOES).slug, 'regiao-centro-oeste');
  assert.equal(resolverRegiao('centro oeste', REGIOES).codigo, '5', 'sem hífen também bate');
  assert.equal(resolverRegiao('5', REGIOES).codigo, '5');
  assert.equal(resolverRegiao('NE', REGIOES).nome, 'Nordeste');
  assert.equal(resolverRegiao('se', REGIOES).nome, 'Sudeste', 'em --regiao, SE é Sudeste');
  assert.throws(() => resolverRegiao('leste', REGIOES), /região não encontrada: "leste"; opções: 1 Norte \(N\)/);
  const sp = resolverEstado('sp', ESTADOS);
  assert.deepEqual(sp, { nivel: 'estados', codigo: '35', nome: 'São Paulo', sigla: 'SP', slug: 'sp', regiao: 'SE' });
  assert.equal(resolverEstado('35', ESTADOS).sigla, 'SP');
  assert.equal(resolverEstado('sao paulo', ESTADOS).sigla, 'SP');
  assert.equal(resolverEstado('SE', ESTADOS).nome, 'Sergipe', 'em --uf, SE é Sergipe');
  assert.throws(() => resolverEstado('ZZ', ESTADOS), /estado não encontrado/);
  assert.throws(() => resolverEstado('', ESTADOS), /--uf precisa/);
});

test('resolver município: nome, código, --uf e homônimos', () => {
  const sp = resolverMunicipio('são paulo', MUNICIPIOS, { estados: ESTADOS });
  assert.deepEqual(sp, { nivel: 'municipios', codigo: '3550308', nome: 'São Paulo', sigla: 'SP', slug: 'sao-paulo' });
  assert.equal(resolverMunicipio('SAO PAULO', MUNICIPIOS).codigo, '3550308');
  assert.equal(resolverMunicipio('2605459', MUNICIPIOS).slug, 'fernando-de-noronha');
  assert.equal(resolverMunicipio('Fernando de Noronha', MUNICIPIOS, { uf: 'pe' }).sigla, 'PE');
  assert.throws(() => resolverMunicipio('bonito', MUNICIPIOS), /"bonito" é nome de 2 municípios: Bonito \(MS, 5002209\), Bonito \(PE, 2602506\); desempate com --uf/);
  assert.equal(resolverMunicipio('bonito', MUNICIPIOS, { uf: 'MS' }).codigo, '5002209');
  assert.throws(() => resolverMunicipio('bonito', MUNICIPIOS, { uf: 'SP' }), /não existe em SP/);
  assert.throws(() => resolverMunicipio('Noronha', MUNICIPIOS), /não encontrado: "Noronha"; parecidos: Fernando de Noronha \(PE, 2605459\)/);
  assert.throws(() => resolverMunicipio('9999999', MUNICIPIOS), /código 9999999 não existe/);
  assert.throws(() => resolverMunicipio('', MUNICIPIOS), /--municipio precisa/);
  // UF sem microrregião: pela região imediata; sem nada: pelos 2 primeiros dígitos do código
  assert.equal(ufDoMunicipio(MUNICIPIOS[4], ESTADOS), 'MT');
  assert.equal(ufDoMunicipio(MUNICIPIOS[5], ESTADOS), 'MT');
  assert.equal(ufDoMunicipio(MUNICIPIOS[5], []), null);
  assert.equal(resolverMunicipio('boa esperanca do norte', MUNICIPIOS, { uf: 'mt', estados: ESTADOS }).sigla, 'MT');
});

test('GeoJSON -> polígonos: FeatureCollection, Polygon e MultiPolygon, codarea conferido', () => {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { codarea: '28' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }] };
  const p = poligonosDoGeoJson(fc, '28');
  assert.equal(p.length, 1);
  assert.equal(p[0].length, 1);
  assert.equal(contarPontos(p), 5);
  assert.throws(() => poligonosDoGeoJson(fc, '35'), /codarea "28", esperado "35"/);
  const mp = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { codarea: 'BR' }, geometry: { type: 'MultiPolygon', coordinates: [
    [[[0, 0], [2, 0], [2, 2], [0, 2]], [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]]],
    [[[3, 3], [4, 3], [4, 4]]],
  ] } }] };
  const q = poligonosDoGeoJson(mp, 'BR');
  assert.equal(q.length, 2);
  assert.equal(q[0].length, 2, 'externo + furo');
  assert.equal(contarPontos(q), 11);
  assert.deepEqual(bboxDosPoligonos(q), { norte: 4, sul: 0, oeste: 0, leste: 4 });
  assert.deepEqual(poligonosDoGeoJson({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] }).length, 1);
  assert.throws(() => poligonosDoGeoJson({ type: 'FeatureCollection', features: [] }), /sem features/);
  assert.throws(() => poligonosDoGeoJson({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }), /não suportada: Point/);
  assert.throws(() => poligonosDoGeoJson({ type: 'Polygon', coordinates: [[[0, 0], [1, 0]]] }), /menos de 3 pontos/);
  assert.throws(() => poligonosDoGeoJson(null), /vazia ou inválida/);
});

test('ilha oceânica fora do bbox: só polígonos com centróide a até 0,75 x a diagonal do maior', () => {
  assert.equal(FATOR_ILHA_FORA, 0.75);
  // "continente" 2 x 2 graus com furo, ilha costeira a 2 graus do centro (diagonal 2,83: limite 2,12), ilha oceânica a 12,7
  const continente = [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1], [0.5, 0.5]]];
  const costeira = [[[2.3, 2.3], [2.5, 2.3], [2.5, 2.5], [2.3, 2.5], [2.3, 2.3]]];
  const oceanica = [[[9.9, 9.9], [10.1, 9.9], [10.1, 10.1], [9.9, 10.1], [9.9, 9.9]]];
  const c = centroideDoAnel(continente[0]);
  assert.ok(Math.abs(c.lon - 1) < 1e-9 && Math.abs(c.lat - 1) < 1e-9 && Math.abs(c.area - 4) < 1e-9, JSON.stringify(c));
  const co = centroideDoAnel(oceanica[0]);
  assert.ok(Math.abs(co.lon - 10) < 1e-9 && Math.abs(co.lat - 10) < 1e-9);
  assert.deepEqual(centroideDoAnel([[1, 1], [1, 1], [1, 1]]), { lon: 1, lat: 1, area: 0 }, 'anel degenerado: média');
  const r = poligonosDoBbox([oceanica, continente, costeira]);
  assert.equal(r.maior, 1);
  assert.deepEqual(r.usados, [1, 2]);
  assert.deepEqual(r.ignorados, [0]);
  assert.ok(Math.abs(r.diagonal_graus - Math.hypot(2 * Math.cos(Math.PI / 180), 2)) < 1e-9);
  const b = bboxPrincipal([oceanica, continente, costeira]);
  assert.deepEqual(b.bbox, { norte: 2.5, sul: 0, oeste: 0, leste: 2.5 });
  assert.equal(b.usados, 2);
  assert.equal(b.ignorados, 1);
  assert.deepEqual(bboxDosPoligonos([oceanica, continente, costeira]), { norte: 10.1, sul: 0, oeste: 0, leste: 10.1 }, 'o bbox completo continua existindo');
  // fator maior inclui tudo; fator 0 só o maior
  assert.equal(bboxPrincipal([oceanica, continente, costeira], 10).ignorados, 0);
  assert.deepEqual(bboxPrincipal([oceanica, continente, costeira], 0).bbox, { norte: 2, sul: 0, oeste: 0, leste: 2 });
  assert.equal(bboxPrincipal([continente]).ignorados, 0, 'um polígono só');
  assert.throws(() => poligonosDoBbox([]), /sem polígonos/);
  assert.throws(() => poligonosDoBbox([continente], -1), /fator/);
  // o maior é por área, não pela ordem: a ilha oceânica primeiro na lista não vira referência
  assert.equal(poligonosDoBbox([oceanica, costeira, continente]).maior, 2);
  // polígonos inteiramente fora de um bbox (o que o terreno.json grava em ilhas_fora_do_bbox)
  assert.equal(poligonosForaDoBbox([oceanica, continente, costeira], { norte: 3.7, sul: -0.1, oeste: -0.1, leste: 3.7 }), 1);
  assert.equal(poligonosForaDoBbox([oceanica, continente, costeira], { norte: 11, sul: -1, oeste: -1, leste: 11 }), 0);
  assert.equal(poligonosForaDoBbox([oceanica, continente, costeira], { norte: 2.1, sul: -0.1, oeste: -0.1, leste: 2.1 }), 2);
  assert.equal(poligonosForaDoBbox([costeira], { norte: 2.4, sul: 2, oeste: 2, leste: 2.4 }), 0, 'polígono que cruza a borda não está fora');
});

test('bbox com margem: fração do tamanho, 4 casas, preso nos limites', () => {
  const b = { norte: -9.515, sul: -11.5685, oeste: -38.245, leste: -36.3959 };
  const m = bboxComMargem(b, 0.04);
  assert.deepEqual(m, { norte: -9.4329, sul: -11.6506, oeste: -38.319, leste: -36.3219 });
  assert.deepEqual(bboxComMargem(b, 0), { norte: -9.515, sul: -11.5685, oeste: -38.245, leste: -36.3959 });
  assert.equal(MARGEM_PADRAO, 0.04);
  assert.deepEqual(bboxComMargem({ norte: 89, sul: -89, oeste: -179, leste: 179 }, 0.5), { norte: 90, sul: -90, oeste: -180, leste: 180 });
  assert.throws(() => bboxComMargem(b, 2), /margem inválida/);
  assert.throws(() => bboxComMargem(b, -0.1), /margem inválida/);
});

test('bloco ibge do lugar.json e fonte do terreno.json', () => {
  const t = resolverEstado('SE', ESTADOS);
  assert.deepEqual(blocoIbge(t), { nivel: 'estados', codigo: '28', nome: 'Sergipe', sigla: 'SE', qualidade: 'maxima' });
  assert.deepEqual(blocoIbge(resolverPais(), 'minima'), { nivel: 'paises', codigo: 'BR', nome: 'Brasil', sigla: 'BR', qualidade: 'minima' });
  assert.throws(() => blocoIbge(t, 'alta'), /qualidade desconhecida/);
  assert.throws(() => validarBlocoIbge({ nivel: 'estados' }), /ibge.codigo inválido/);
  assert.throws(() => validarBlocoIbge({ nivel: 'cidades', codigo: '1' }), /nível do IBGE desconhecido/);
  assert.throws(() => validarBlocoIbge(null), /bloco "ibge" inválido/);
  const malha = { url: 'u', qualidade: 'maxima', poligonos: [[[[0, 0], [1, 0], [1, 1]]]], bbox: { norte: 1, sul: 0, oeste: 0, leste: 1 }, obtido_em: 'x', bytes: 1, sha256: 'h', cache: false };
  const f = fonteIbge(malha, blocoIbge(t));
  assert.equal(f.id, 'ibge-malha');
  assert.equal(f.poligonos_fora_do_bbox, 0);
  assert.equal(fonteIbge({ ...malha, ilhas_fora_do_bbox: 2 }, blocoIbge(t)).poligonos_fora_do_bbox, 2);
  assert.equal(f.atribuicao, 'IBGE, Malhas Territoriais');
  assert.equal(f.pontos, 3);
  assert.equal(f.aneis, 1);
  assert.equal(f.codigo, '28');
});

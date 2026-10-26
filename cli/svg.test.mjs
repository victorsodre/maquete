// Testes offline do svg-lamina.mjs e do svg.mjs: XML bem formado (parser simples de tags balanceadas),
// unidades em mm, y para baixo, camadas corte/gravar, contagem de paths = anéis, numeração só com
// --numerar, kerf registrado, folha-chave, CLI de ponta a ponta numa pasta temporária e, se o
// laminas.json real existir, os 4 lugares inteiros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  svgDaLamina, svgFolhaChave, escaparXml, num, numPt, areaComSinal, areaDaLamina, pontoDentro,
  bboxDoAnel, paraSvg, dDoAnel, aneisDaLamina, poligonoMaior, encaixarCaixa, posicaoDoNumero,
  textoDoNumero, quebrarLinhas, larguraDoTexto, linhasDaFolhaChave, nomeDoArquivo, NOME_FOLHA_CHAVE,
  COR_CORTE, TRACO_CORTE, COR_GRAVAR, TRACO_GRAVAR, FONTE_NUMERO_MM, ASSINATURA,
} from './svg-lamina.mjs';
import { parseArgs, lerLaminas, gerarSvgs, AJUDA } from './svg.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(RAIZ, 'cli', 'svg.mjs');

// ---------------------------------------------------------------------------
// Parser XML mínimo: tags balanceadas, atributos entre aspas e sem repetição, texto sem < ou & cru.
// Devolve { tags: [{ nome, attrs, auto, caminho }], texto: [...] } ou lança.
// ---------------------------------------------------------------------------
const desescapar = (t) => t.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]);

export function parseXml(xml) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'declaração XML no início');
  const pilha = [];
  const tags = [];
  const textos = [];
  let i = 0;
  const n = xml.length;
  const reAttr = /\s+([A-Za-z_:][\w:.-]*)="([^"<]*)"/g;
  while (i < n) {
    if (xml[i] !== '<') {
      const fim = xml.indexOf('<', i);
      const t = xml.slice(i, fim === -1 ? n : fim);
      assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(t), `& cru no texto: ${t.slice(0, 40)}`);
      if (t.trim()) textos.push({ texto: desescapar(t), caminho: pilha.join('/') });
      i = fim === -1 ? n : fim;
      continue;
    }
    if (xml.startsWith('<?', i)) { const f = xml.indexOf('?>', i); assert.ok(f > 0, '<? sem fechar'); i = f + 2; continue; }
    if (xml.startsWith('<!--', i)) {
      const f = xml.indexOf('-->', i);
      assert.ok(f > 0, 'comentário sem fechar');
      assert.ok(!xml.slice(i + 4, f).includes('--'), 'comentário com -- dentro');
      i = f + 3; continue;
    }
    const f = xml.indexOf('>', i);
    assert.ok(f > 0, 'tag sem fechar');
    const corpo = xml.slice(i + 1, f);
    if (corpo.startsWith('/')) {
      const nome = corpo.slice(1).trim();
      assert.equal(pilha.pop(), nome, `fechamento de ${nome} não bate`);
    } else {
      const auto = corpo.endsWith('/');
      const semBarra = auto ? corpo.slice(0, -1) : corpo;
      const m = /^([A-Za-z_][\w:.-]*)/.exec(semBarra);
      assert.ok(m, `tag sem nome: ${corpo.slice(0, 30)}`);
      const nome = m[1];
      const resto = semBarra.slice(nome.length);
      const attrs = {};
      let consumido = 0;
      for (const a of resto.matchAll(reAttr)) {
        assert.ok(!(a[1] in attrs), `atributo ${a[1]} repetido em <${nome}>`);
        attrs[a[1]] = a[2];
        consumido += a[0].length;
      }
      assert.equal(resto.trim().length, resto.slice(0, consumido).trim().length, `atributos malformados em <${nome}${resto.slice(0, 60)}>`);
      tags.push({ nome, attrs, auto, caminho: pilha.join('/') });
      if (!auto) pilha.push(nome);
    }
    i = f + 1;
  }
  assert.deepEqual(pilha, [], `tags sem fechar: ${pilha.join(', ')}`);
  return { tags, textos };
}

const pathsEm = (parse, camada) => parse.tags.filter((t) => t.nome === 'path' && t.caminho === 'svg/g' && camadaDe(parse, t) === camada);
function camadaDe(parse, tag) {
  // a tag <g> mais recente antes desta no fluxo
  const idx = parse.tags.indexOf(tag);
  for (let i = idx - 1; i >= 0; i--) if (parse.tags[i].nome === 'g') return parse.tags[i].attrs.id;
  return null;
}
const svgTag = (parse) => parse.tags.find((t) => t.nome === 'svg');
const contarAneis = (lamina) => lamina.aneis.reduce((s, p) => s + 1 + p.furos.length, 0);

// ---------------------------------------------------------------------------
// laminas.json sintético: peça 100 x 80 mm; lâmina 0 retângulo; lâmina 1 quadrado com furo;
// lâmina 2 duas ilhas pequenas (uma dentro do furo da 1, como uma ilhota na lagoa).
// ---------------------------------------------------------------------------
function laminasSinteticas(extra = {}) {
  const L = 100, A = 80;
  return {
    slug: 'teste', nome: 'Ilha & Lagoa <teste>',
    bbox: { norte: -1, sul: -1.5, oeste: -40, leste: -39.3 },
    km: { largura: 77.9, altura: 55.7 },
    largura_mm: L, altura_mm: A, mm_por_km: 1.2837,
    espessura_mm: 3, passo_terra_m: 10, passo_mar_m: 20, exagero: 2.3, exagero_mar: 1.2,
    elev_min_m: -35, elev_max_m: 27,
    suavizar: { terra_nos: 1, mar_nos: 4 }, area_min_mm2: 4,
    laminas: [
      { k: 0, nivel_m: -40, tipo: 'mar', z_mm: 3, aneis: [{ ext: [[-50, -40], [50, -40], [50, 40], [-50, 40]], furos: [] }] },
      { k: 1, nivel_m: -20, tipo: 'mar', z_mm: 6, aneis: [{ ext: [[-30, -20], [30, -20], [30, 20], [-30, 20]], furos: [[[-10, -10], [-10, 10], [10, 10], [10, -10]]] }] },
      { k: 2, nivel_m: 0, tipo: 'costa', z_mm: 9, aneis: [
        { ext: [[-2, -2], [2, -2], [2, 2], [-2, 2]], furos: [] },
        { ext: [[15, -15], [25, -15], [25, 15], [15, 15]], furos: [] },
      ] },
      { k: 3, nivel_m: 10, tipo: 'terra', z_mm: 12, aneis: [{ ext: [[18, -12], [22, -12], [22, 12], [18, 12]], furos: [] }] },
    ],
    agua: { nivel_m: 0, aneis: [] },
    fontes: [
      { id: 'gmrt', url: 'https://www.gmrt.org/services/GridServer?north=1', licenca: 'CC BY 4.0', atribuicao: 'Ryan, W. B. F. e outros (2009), GMRT synthesis data set, doi:10.1029/2008GC002332' },
      { id: 'copernicus-glo30', url: 'https://copernicus-dem-30m.s3.amazonaws.com', licenca: 'Licence for Copernicus DEM instance COP-DEM-GLO-30-F', atribuicao: 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.' },
    ],
    mascara: { pct_medido: 12.5 },
    gerado_por: 'maquete 0.1.0', gerado_em: '2026-10-26T15:30:00-03:00',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------

test('escaparXml, num e numPt', () => {
  assert.equal(escaparXml('a & b < c > "d" \'e\''), 'a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
  assert.equal(num(3), '3');
  assert.equal(num(3.1), '3.1');
  assert.equal(num(3.14159), '3.14');
  assert.equal(num(-80, 1), '-80');
  assert.equal(num(406.5), '406.5');
  assert.equal(numPt(5.3191, 2), '5,32');
});

test('área com sinal, área da lâmina, ponto dentro, bbox', () => {
  const quad = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(areaComSinal(quad), 100);
  assert.equal(areaComSinal([...quad].reverse()), -100);
  const l = { aneis: [{ ext: quad, furos: [[[2, 2], [2, 4], [4, 4], [4, 2]]] }] };
  assert.equal(areaDaLamina(l), 96);
  assert.ok(pontoDentro(quad, [5, 5]));
  assert.ok(!pontoDentro(quad, [15, 5]));
  assert.deepEqual(bboxDoAnel(quad), { x0: 0, y0: 0, x1: 10, y1: 10 });
});

test('paraSvg inverte y e desloca a origem para o canto', () => {
  assert.deepEqual(paraSvg([-50, -40], 100, 80), [0, 80]);   // sudoeste -> canto inferior esquerdo
  assert.deepEqual(paraSvg([50, 40], 100, 80), [100, 0]);    // nordeste -> canto superior direito
  assert.deepEqual(paraSvg([0, 0], 100, 80), [50, 40]);
});

test('dDoAnel fecha com Z, começa com M e não repete o primeiro ponto', () => {
  const d = dDoAnel([[-50, -40], [50, -40], [50, 40], [-50, 40]], 100, 80);
  assert.equal(d, 'M0 80 L100 80 L100 0 L0 0 Z');
  assert.equal(dDoAnel([[0, 0], [1, 1]], 100, 80), '');
});

test('aneisDaLamina lista ext e furos na ordem e ignora anel degenerado', () => {
  const l = laminasSinteticas().laminas[1];
  assert.deepEqual(aneisDaLamina(l).map((a) => a.tipo), ['ext', 'furo']);
  assert.deepEqual(aneisDaLamina({ aneis: [{ ext: [[0, 0], [1, 1]], furos: [[[0, 0], [1, 0], [1, 1]]] }] }).map((a) => a.tipo), ['furo']);
});

test('quebrarLinhas respeita a largura, corta URL comprida e preserva parágrafos', () => {
  const linhas = quebrarLinhas('uma frase com várias palavras que não cabe numa linha só', 30, 3);
  assert.ok(linhas.length > 1);
  for (const l of linhas) assert.ok(l.length <= Math.floor(30 / (3 * 0.62)), l);
  assert.equal(quebrarLinhas('curta', 100, 3).length, 1);
  assert.ok(quebrarLinhas('https://um.endereco.muito.comprido.sem.espaco/que/nao/cabe', 30, 3).length > 1);
  assert.equal(quebrarLinhas('a\nb', 100, 3).length, 2);
});

test('nomeDoArquivo com 2 dígitos e 3 a partir de 100 lâminas', () => {
  assert.equal(nomeDoArquivo(0, 27), 'lamina-00.svg');
  assert.equal(nomeDoArquivo(9, 27), 'lamina-09.svg');
  assert.equal(nomeDoArquivo(26, 27), 'lamina-26.svg');
  assert.equal(nomeDoArquivo(5, 120), 'lamina-005.svg');
  assert.equal(NOME_FOLHA_CHAVE, 'folha-chave.svg');
});

// ---------------------------------------------------------------------------
// svgDaLamina
// ---------------------------------------------------------------------------

test('SVG da lâmina: XML bem formado, mm, viewBox, sem transform nem px', () => {
  const j = laminasSinteticas();
  for (const l of j.laminas) {
    const svg = svgDaLamina(j, l.k);
    const p = parseXml(svg);
    const s = svgTag(p);
    assert.equal(s.attrs.xmlns, 'http://www.w3.org/2000/svg');
    assert.equal(s.attrs.width, '100mm');
    assert.equal(s.attrs.height, '80mm');
    assert.equal(s.attrs.viewBox, '0 0 100 80');
    assert.ok(!/transform=|px/.test(svg), 'sem transform nem px');
    assert.ok(svg.includes('<title>Ilha &amp; Lagoa &lt;teste&gt;'), 'nome escapado no título');
  }
});

test('camada corte: um path por anel (ext + furos), vermelho 0,01, fill none', () => {
  const j = laminasSinteticas();
  for (const l of j.laminas) {
    const p = parseXml(svgDaLamina(j, l.k));
    const corte = pathsEm(p, 'corte');
    assert.equal(corte.length, contarAneis(l), `lâmina ${l.k}`);
    for (const t of corte) {
      assert.ok(t.attrs.d && t.attrs.d.startsWith('M') && t.attrs.d.endsWith('Z'), 'd= com M…Z');
      assert.equal(t.attrs.fill, 'none');
      assert.equal(t.attrs.stroke, COR_CORTE);
      assert.equal(Number(t.attrs['stroke-width']), TRACO_CORTE);
    }
    assert.deepEqual(corte.map((t) => t.attrs['data-anel']), aneisDaLamina(l).map((a) => a.tipo));
  }
});

test('camada gravar: contorno da lâmina de cima em azul 0,1; lâmina 0 recebe a 1; a de cima não tem guia', () => {
  const j = laminasSinteticas();
  const n = j.laminas.length;
  for (const l of j.laminas) {
    const p = parseXml(svgDaLamina(j, l.k));
    const gravar = pathsEm(p, 'gravar');
    const deCima = j.laminas[l.k + 1];
    assert.equal(gravar.length, deCima ? contarAneis(deCima) : 0, `lâmina ${l.k}`);
    for (const t of gravar) {
      assert.equal(t.attrs.fill, 'none');
      assert.equal(t.attrs.stroke, COR_GRAVAR);
      assert.equal(Number(t.attrs['stroke-width']), TRACO_GRAVAR);
    }
    if (l.k === n - 1) assert.equal(gravar.length, 0);
  }
  // lâmina 0: retângulo no corte, contorno da lâmina 1 (ext + furo) no gravar
  const p0 = parseXml(svgDaLamina(j, 0));
  assert.equal(pathsEm(p0, 'corte')[0].attrs.d, 'M0 80 L100 80 L100 0 L0 0 Z');
  assert.equal(pathsEm(p0, 'gravar').length, 2);
  assert.equal(pathsEm(p0, 'gravar')[0].attrs.d, 'M20 60 L80 60 L80 20 L20 20 Z');
  // guia desligada por opção
  assert.equal(pathsEm(parseXml(svgDaLamina(j, 0, { guia: false })), 'gravar').length, 0);
});

test('numeração só com numerar: texto de 4 mm com número e nível, dentro do anel maior e fora do furo', () => {
  const j = laminasSinteticas();
  for (const l of j.laminas) {
    assert.ok(!svgDaLamina(j, l.k).includes('<text'), `sem --numerar não há texto (lâmina ${l.k})`);
    const p = parseXml(svgDaLamina(j, l.k, { numerar: true }));
    const textos = p.tags.filter((t) => t.nome === 'text');
    assert.equal(textos.length, 1);
    const t = textos[0];
    assert.equal(camadaDe(p, t), 'gravar');
    assert.equal(t.attrs.fill, COR_GRAVAR);
    assert.ok(t.attrs['data-posicao'].startsWith('dentro'), `lâmina ${l.k}: ${t.attrs['data-posicao']}`);
    const conteudo = p.textos.find((x) => x.caminho === 'svg/g/text').texto;
    if (l.k <= 1) { // anéis grandes: texto inteiro a 4 mm
      assert.equal(t.attrs['data-posicao'], 'dentro');
      assert.equal(Number(t.attrs['font-size']), FONTE_NUMERO_MM);
      assert.equal(conteudo, `${l.k} · ${l.nivel_m} m`);
    } else { // anéis de 4 x 4 e 10 x 30 mm: só o número cabe
      assert.equal(t.attrs['data-posicao'], 'dentro-so-numero');
      assert.equal(conteudo, String(l.k));
    }
    // o canto inferior esquerdo (x, y do <text>) convertido de volta para mm da peça está dentro do ext maior
    const maior = poligonoMaior(l);
    const xMm = Number(t.attrs.x) - j.largura_mm / 2;
    const yMm = j.altura_mm / 2 - Number(t.attrs.y);
    assert.ok(pontoDentro(maior.ext, [xMm, yMm]), `lâmina ${l.k}: texto fora do anel maior`);
    for (const f of maior.furos) assert.ok(!pontoDentro(f, [xMm, yMm]), 'texto dentro de furo');
  }
  // lâmina 1: o anel maior tem furo no centro; o texto vai para um canto
  const pos = posicaoDoNumero(j.laminas[1], textoDoNumero(j.laminas[1]));
  assert.equal(pos.posicao, 'dentro');
  assert.ok(Math.abs(pos.x) > 10 || Math.abs(pos.y) > 10, 'fora do furo central');
  assert.equal(textoDoNumero({ k: 7, nivel_m: -10 }), '7 · -10 m');
});

test('numeração: cascata (menor, só número) e fora do anel quando nem o número cabe', () => {
  const laminaMedia = { k: 12, nivel_m: 120, tipo: 'terra', aneis: [{ ext: [[0, 0], [12, 0], [12, 9], [0, 9]], furos: [] }] };
  const pos = posicaoDoNumero(laminaMedia, textoDoNumero(laminaMedia), { larguraMm: 100, alturaMm: 80 });
  assert.equal(pos.posicao, 'dentro-so-numero');
  assert.equal(pos.texto, '12');
  const laminaMinima = { k: 29, nivel_m: 180, tipo: 'terra', aneis: [{ ext: [[0, 0], [2, 0], [2, 3], [0, 3]], furos: [] }] };
  const fora = posicaoDoNumero(laminaMinima, textoDoNumero(laminaMinima), { larguraMm: 100, alturaMm: 80 });
  assert.equal(fora.posicao, 'fora');
  assert.equal(fora.texto, '29 · 180 m');
  assert.ok(fora.x >= 2 + 1.5 - 1e-9, 'à direita do anel');
  assert.ok(fora.x + larguraDoTexto(fora.texto, fora.fonteMm) <= 50, 'dentro da peça');
  const j = laminasSinteticas({ laminas: [laminasSinteticas().laminas[0], { ...laminaMinima, k: 1, z_mm: 6 }] });
  const p = parseXml(svgDaLamina(j, 1, { numerar: true }));
  assert.equal(p.tags.find((t) => t.nome === 'text').attrs['data-posicao'], 'fora');
  assert.equal(encaixarCaixa({ ext: [[0, 0], [1, 0], [1, 1], [0, 1]], furos: [] }, 10, 4), null);
});

test('kerf: registrado em comentário só quando > 0; nunca mexe nas linhas', () => {
  const j = laminasSinteticas();
  const sem = svgDaLamina(j, 1);
  const com = svgDaLamina(j, 1, { kerf: 0.15 });
  assert.ok(sem.includes('sem kerf'));
  assert.ok(com.includes('kerf 0.15 mm: NÃO aplicado às linhas'));
  const dSem = pathsEm(parseXml(sem), 'corte').map((t) => t.attrs.d);
  const dCom = pathsEm(parseXml(com), 'corte').map((t) => t.attrs.d);
  assert.deepEqual(dSem, dCom);
});

test('svgDaLamina: erros claros', () => {
  const j = laminasSinteticas();
  assert.throws(() => svgDaLamina(j, 99), /lâmina 99 não existe/);
  assert.throws(() => svgDaLamina({ laminas: [] }, 0), /largura_mm/);
  assert.throws(() => svgDaLamina({ largura_mm: 10, altura_mm: 10, laminas: [] }, 0), /sem lâminas/);
  assert.throws(() => svgDaLamina(null, 0), /não é objeto/);
});

// ---------------------------------------------------------------------------
// Folha-chave
// ---------------------------------------------------------------------------

test('folha-chave: XML bem formado, tamanho da peça, lista das lâminas com área, escala, fontes, licença, assinatura', () => {
  // peça de 300 x 225 mm (a de 100 x 80 das lâminas sintéticas é pequena demais para o verso)
  const j = laminasSinteticas({ largura_mm: 300, altura_mm: 225 });
  const svg = svgFolhaChave(j, { kerf: 0.2 });
  const p = parseXml(svg);
  const s = svgTag(p);
  assert.equal(s.attrs.width, '300mm');
  assert.equal(s.attrs.height, '225mm');
  assert.equal(s.attrs.viewBox, '0 0 300 225');
  assert.equal(pathsEm(p, 'corte').length, 1, 'retângulo da folha no corte');
  const texto = p.textos.map((t) => t.texto).join('\n');
  assert.ok(texto.includes('Ilha & Lagoa <teste>'), 'nome sem escapar no texto parseado');
  assert.ok(texto.includes('1 cm na peça = 7,79 km'), texto);
  assert.ok(texto.includes('3,0 mm cada'));
  assert.ok(texto.includes('10 m na terra e 20 m no mar'));
  assert.ok(texto.includes('2,3x na terra'));
  assert.ok(texto.includes('12,5 % medido por sonar'));
  assert.ok(texto.includes('Kerf: 0,20 mm'));
  assert.ok(texto.includes('CC BY 4.0'));
  assert.ok(texto.includes('produced using Copernicus WorldDEM-30'));
  assert.ok(texto.includes('do not incur any liability'));
  assert.ok(texto.includes(ASSINATURA));
  const { tabela, cabecalho } = linhasDaFolhaChave(j, { kerf: 0.2 });
  assert.equal(tabela.length, 4);
  assert.match(tabela[0].texto, /^ 0  mar\s+-40 m\s+80,0 cm²$/);           // 100 x 80 mm = 80 cm²
  assert.match(tabela[1].texto, /^ 1  mar\s+-20 m\s+20,0 cm²$/);           // 60 x 40 - 20 x 20 = 2000 mm²
  assert.match(tabela[2].texto, /^ 2  costa\s+0 m\s+3,2 cm²$/);            // 16 + 300 = 316 mm²
  for (const l of tabela) assert.ok(texto.includes(l.texto.replace(/\s+/g, ' ').trim().split(' ')[0]));
  assert.ok(cabecalho.some((c) => c.startsWith('Peça: 300,0 x 225,0 mm; 4 lâminas (2 de mar, 1 de costa, 1 de terra)')));
  // todo texto da folha começa dentro da folha e termina antes da margem direita (largura estimada)
  for (const t of p.tags.filter((x) => x.nome === 'text')) {
    const conteudo = p.textos.find((x) => x.caminho === 'svg/g/text' && svg.indexOf(escaparXml(x.texto)) > 0);
    assert.ok(Number(t.attrs.x) >= 0 && Number(t.attrs.x) < 300 && Number(t.attrs.y) > 0 && Number(t.attrs.y) <= 225, `texto fora da folha em (${t.attrs.x}, ${t.attrs.y})`);
    assert.ok(conteudo);
  }
});

test('folha-chave cresce para baixo (e avisa) quando o texto não cabe na peça', () => {
  const j = laminasSinteticas({ altura_mm: 30 });
  const svg = svgFolhaChave(j);
  const s = svgTag(parseXml(svg));
  assert.ok(parseFloat(s.attrs.height) > 30);
  assert.ok(svg.includes('O texto não coube em 30 mm'));
  assert.equal(s.attrs.viewBox, `0 0 100 ${parseFloat(s.attrs.height)}`);
});

test('lugar sem mar: folha sem passo de mar nem fração medida', () => {
  const j = laminasSinteticas({ passo_mar_m: null, exagero_mar: undefined, mascara: { pct_medido: null }, laminas: laminasSinteticas().laminas.map((l) => ({ ...l, tipo: l.k === 0 ? 'terra' : l.tipo })) });
  const { cabecalho } = linhasDaFolhaChave(j);
  assert.ok(cabecalho.some((c) => c === 'Passo vertical: cada lâmina vale 10 m na terra.'));
  assert.ok(!cabecalho.some((c) => c.includes('medido por sonar')));
  parseXml(svgFolhaChave(j));
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('parseArgs: saída, kerf, numerar, erros', () => {
  assert.deepEqual(parseArgs(['rio']), { _: ['rio'], kerf: 0, numerar: false, silencioso: false, ajuda: false, saida: null });
  const o = parseArgs(['rio', '--saida', 'x/y', '--kerf', '0,15', '--numerar', '--silencioso']);
  assert.equal(o.saida, 'x/y');
  assert.equal(o.kerf, 0.15);
  assert.equal(o.numerar, true);
  assert.equal(o.silencioso, true);
  assert.equal(parseArgs(['-h']).ajuda, true);
  assert.throws(() => parseArgs(['rio', '--kerf']), /--kerf precisa/);
  assert.throws(() => parseArgs(['rio', '--kerf', '5']), /entre 0 e 2/);
  assert.throws(() => parseArgs(['rio', '--saida']), /--saida precisa/);
  assert.throws(() => parseArgs(['--xyz']), /opção desconhecida/);
  assert.ok(AJUDA.includes('--numerar') && AJUDA.includes('--kerf'));
});

test('gerarSvgs grava um arquivo por lâmina + folha-chave e apaga os antigos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-svg-'));
  try {
    const j = laminasSinteticas();
    fs.writeFileSync(path.join(dir, 'lamina-07.svg'), 'velho');
    const logs = [];
    const r = gerarSvgs({ laminas: j, saida: dir, kerf: 0.1, numerar: true, log: (m) => logs.push(m) });
    assert.equal(r.length, 5);
    const arquivos = fs.readdirSync(dir).sort();
    assert.deepEqual(arquivos, ['folha-chave.svg', 'lamina-00.svg', 'lamina-01.svg', 'lamina-02.svg', 'lamina-03.svg']);
    for (const a of arquivos) parseXml(fs.readFileSync(path.join(dir, a), 'utf8'));
    assert.ok(logs.some((l) => l.includes('apagados 1')));
    assert.ok(logs.some((l) => l.includes('4 lâminas + folha-chave') && l.includes('numeradas') && l.includes('kerf 0,1 mm')));
    assert.ok(fs.readFileSync(path.join(dir, 'lamina-02.svg'), 'utf8').includes('<text'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lerLaminas: erro claro sem arquivo ou com JSON ruim', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-svg-'));
  try {
    assert.throws(() => lerLaminas(path.join(dir, 'laminas.json'), 'x'), /node cli\/laminas.mjs x/);
    fs.writeFileSync(path.join(dir, 'laminas.json'), '{');
    assert.throws(() => lerLaminas(path.join(dir, 'laminas.json')), /laminas.json inválido/);
    fs.writeFileSync(path.join(dir, 'laminas.json'), '{"laminas":[]}');
    assert.throws(() => lerLaminas(path.join(dir, 'laminas.json')), /sem lâminas/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI de ponta a ponta numa pasta temporária (saída padrão lugares/<slug>/svg e --saida)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maquete-svg-cli-'));
  try {
    const j = laminasSinteticas();
    const pasta = path.join(dir, 'lugares', 'teste');
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, 'lugar.json'), JSON.stringify({ slug: 'teste', nome: j.nome, bbox: j.bbox }));
    fs.writeFileSync(path.join(pasta, 'laminas.json'), JSON.stringify(j));
    const saida1 = execFileSync(process.execPath, [CLI, 'teste', '--numerar'], { cwd: dir, encoding: 'utf8' });
    assert.ok(saida1.includes('4 lâminas + folha-chave'), saida1);
    assert.deepEqual(fs.readdirSync(path.join(pasta, 'svg')).sort(), ['folha-chave.svg', 'lamina-00.svg', 'lamina-01.svg', 'lamina-02.svg', 'lamina-03.svg']);
    const saida2 = execFileSync(process.execPath, [CLI, 'teste', '--saida', 'outra/pasta', '--kerf', '0.15', '--silencioso'], { cwd: dir, encoding: 'utf8' });
    assert.equal(saida2, '');
    assert.ok(fs.existsSync(path.join(dir, 'outra', 'pasta', 'folha-chave.svg')));
    assert.ok(fs.readFileSync(path.join(dir, 'outra', 'pasta', 'lamina-01.svg'), 'utf8').includes('kerf 0.15 mm'));
    // sem argumento: ajuda e código 2; lugar inexistente: erro e código 1
    let codigo = 0;
    try { execFileSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { codigo = e.status; }
    assert.equal(codigo, 2);
    codigo = 0;
    let erro = '';
    try { execFileSync(process.execPath, [CLI, 'naoexiste'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { codigo = e.status; erro = String(e.stderr); }
    assert.equal(codigo, 1);
    assert.ok(erro.includes('lugar não encontrado'), erro);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Lugares reais (só se o laminas.json estiver no repositório): tudo em memória, nada gravado.
// ---------------------------------------------------------------------------

for (const slug of ['rio', 'floripa', 'salvador', 'noronha']) {
  const caminho = path.join(RAIZ, 'lugares', slug, 'laminas.json');
  test(`lugar real ${slug}: todos os SVGs bem formados, paths = anéis, guia = anéis da lâmina de cima`, { skip: !fs.existsSync(caminho) && 'laminas.json ausente' }, () => {
    const j = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    let bytes = 0;
    for (const l of j.laminas) {
      const svg = svgDaLamina(j, l.k, { numerar: true, kerf: 0.15 });
      bytes += Buffer.byteLength(svg);
      const p = parseXml(svg);
      const s = svgTag(p);
      assert.equal(s.attrs.width, `${num(j.largura_mm)}mm`);
      assert.equal(s.attrs.height, `${num(j.altura_mm)}mm`);
      assert.equal(pathsEm(p, 'corte').length, contarAneis(l), `${slug} lâmina ${l.k}`);
      const deCima = j.laminas.find((x) => x.k === l.k + 1);
      assert.equal(pathsEm(p, 'gravar').length, deCima ? contarAneis(deCima) : 0);
      assert.equal(p.tags.filter((t) => t.nome === 'text').length, 1);
      // todo ponto de corte dentro do viewBox
      for (const t of pathsEm(p, 'corte')) {
        for (const m of t.attrs.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
          const x = Number(m[1]), y = Number(m[2]);
          assert.ok(x >= -1e-9 && x <= j.largura_mm + 1e-9 && y >= -1e-9 && y <= j.altura_mm + 1e-9, `${slug} lâmina ${l.k}: ponto fora da peça (${x}, ${y})`);
        }
      }
    }
    const folha = svgFolhaChave(j, { kerf: 0.15 });
    bytes += Buffer.byteLength(folha);
    const pf = parseXml(folha);
    assert.equal(svgTag(pf).attrs.height, `${num(j.altura_mm)}mm`, 'a folha-chave coube na peça');
    assert.ok(pf.textos.some((t) => t.texto.includes('do not incur any liability')), 'aviso do Copernicus na folha');
    assert.ok(bytes < 2 * 1024 * 1024, `${slug}: ${bytes} bytes no total`);
  });
}

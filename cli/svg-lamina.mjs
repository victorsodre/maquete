// cli/svg-lamina.mjs: texto SVG de uma lâmina de corte e da folha-chave, a partir do laminas.json.
// Módulo puro: sem fs, sem Node-only; a página (web/) importa este mesmo arquivo para "Baixar SVGs".
// Contrato: SPEC.md, seção "SVG de corte".
//
// Convenções do SVG (uma cortadora que lê px escala a peça a 96 dpi; aqui é mm de verdade):
// - width="<largura_mm>mm" height="<altura_mm>mm" viewBox="0 0 <largura_mm> <altura_mm>"; unidade do
//   usuário = 1 mm; sem transform, sem px.
// - y para baixo: x_svg = x_mm + largura_mm / 2; y_svg = altura_mm / 2 - y_mm (y_mm cresce para o norte).
// - Camada <g id="corte">: um <path> por anel (ext e cada furo), fill="none" stroke="#ff0000"
//   stroke-width="0.01" (vermelho fino = corta). Número de paths = número de anéis da lâmina.
// - Camada <g id="gravar">: o contorno da lâmina de cima (k + 1) em stroke="#0000ff" stroke-width="0.1",
//   guia de colagem (azul = grava/risca). Com numerar, o número da lâmina e o nível em metros, texto de
//   4 mm, num canto que caiba dentro do anel maior (se não cabe: 3 mm; depois só o número a 4, 3 e
//   2 mm; por último o texto inteiro fora do anel, no refugo da chapa, com data-posicao="fora");
//   o texto vai preenchido em azul (fill="#0000ff"),
//   para a cortadora gravar por área (texto de 4 mm só riscado no contorno fica ilegível). Quem precisa
//   de curvas converte o texto em caminhos na cortadora (não dá para fazer sem fonte aqui).
// - Lâmina 0 recebe o retângulo inteiro e o contorno da lâmina 1. A lâmina de cima não tem guia.
// - Kerf: NÃO é aplicado às linhas (offset de polígono com furos é complicado e a cortadora compensa
//   melhor: LightBurn "Kerf offset", Lightburn/RDWorks/Inkscape). O valor pedido fica registrado num
//   comentário no topo de cada SVG e na folha-chave, para quem corta configurar a compensação.
// - Textos escapados para XML; nada de innerHTML, nada de dado externo sem escapar.

export const COR_CORTE = '#ff0000';
export const TRACO_CORTE = 0.01;
export const COR_GRAVAR = '#0000ff';
export const TRACO_GRAVAR = 0.1;
export const FONTE_NUMERO_MM = 4;
export const FONTE = 'Helvetica, Arial, sans-serif';
// largura média de um caractere em relação ao tamanho da fonte (sans-serif; chute conservador)
export const LARGURA_CHAR = 0.62;
export const ASSINATURA = 'Victor Sodré · @ovictor';

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------

export function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Número com até 2 casas, sem zeros à direita, ponto decimal (é SVG, não texto de interface).
export function num(x, casas = 2) {
  const s = Number(x).toFixed(casas);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

// Número para texto em português (vírgula), com `casas` fixas.
export function numPt(x, casas = 1) {
  return Number(x).toFixed(casas).replace('.', ',');
}

// Área com sinal (mm²): positiva anti-horária com y para o norte.
export function areaComSinal(anel) {
  let s = 0;
  for (let i = 0, n = anel.length; i < n; i++) {
    const [x1, y1] = anel[i];
    const [x2, y2] = anel[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

// Área líquida de uma lâmina em mm²: soma de |ext| menos |furos| de cada polígono.
export function areaDaLamina(lamina) {
  let a = 0;
  for (const p of lamina.aneis || []) {
    a += Math.abs(areaComSinal(p.ext));
    for (const f of p.furos || []) a -= Math.abs(areaComSinal(f));
  }
  return a;
}

// Ponto dentro do anel (par-ímpar), em mm no plano x-y da peça.
export function pontoDentro(anel, [x, y]) {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i];
    const [xj, yj] = anel[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

export function bboxDoAnel(anel) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of anel) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// mm da peça (origem no centro, y para o norte) -> coordenadas do SVG (origem no canto, y para baixo).
export function paraSvg([x, y], larguraMm, alturaMm) {
  return [x + larguraMm / 2, alturaMm / 2 - y];
}

// Atributo d de um anel fechado implicitamente, já em coordenadas do SVG.
export function dDoAnel(anel, larguraMm, alturaMm) {
  if (!anel || anel.length < 3) return '';
  const partes = [];
  for (let i = 0; i < anel.length; i++) {
    const [x, y] = paraSvg(anel[i], larguraMm, alturaMm);
    partes.push(`${i === 0 ? 'M' : 'L'}${num(x)} ${num(y)}`);
  }
  partes.push('Z');
  return partes.join(' ');
}

// Todos os anéis de uma lâmina (ext e furos), na ordem: ext do polígono 0, seus furos, ext do 1...
export function aneisDaLamina(lamina) {
  const lista = [];
  for (const p of lamina.aneis || []) {
    if (p.ext && p.ext.length >= 3) lista.push({ anel: p.ext, tipo: 'ext' });
    for (const f of p.furos || []) if (f && f.length >= 3) lista.push({ anel: f, tipo: 'furo' });
  }
  return lista;
}

function pathCorte(anel, L, A, tipo) {
  return `    <path d="${dDoAnel(anel, L, A)}" fill="none" stroke="${COR_CORTE}" stroke-width="${TRACO_CORTE}" data-anel="${tipo}"/>`;
}

function pathGravar(anel, L, A, tipo) {
  return `    <path d="${dDoAnel(anel, L, A)}" fill="none" stroke="${COR_GRAVAR}" stroke-width="${TRACO_GRAVAR}" data-anel="${tipo}"/>`;
}

// ---------------------------------------------------------------------------
// Onde escrever o número: um canto dentro do anel maior, fora dos furos
// ---------------------------------------------------------------------------

// Largura estimada de um texto em mm.
export function larguraDoTexto(texto, fonteMm) {
  return String(texto).length * fonteMm * LARGURA_CHAR;
}

// Devolve o polígono (ext + furos) de maior área da lâmina, ou null.
export function poligonoMaior(lamina) {
  let melhor = null, melhorArea = -1;
  for (const p of lamina.aneis || []) {
    if (!p.ext || p.ext.length < 3) continue;
    const a = Math.abs(areaComSinal(p.ext));
    if (a > melhorArea) { melhorArea = a; melhor = p; }
  }
  return melhor;
}

// A caixa do texto (canto inferior esquerdo em (x, y), em mm da peça, y para o norte) cabe no polígono?
// Confere os 4 cantos e o centro, dentro do ext e fora de todo furo.
function caixaCabe(poligono, x, y, w, h) {
  const pontos = [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y + h / 2]];
  for (const pt of pontos) {
    if (!pontoDentro(poligono.ext, pt)) return false;
    for (const f of poligono.furos || []) if (pontoDentro(f, pt)) return false;
  }
  return true;
}

// Posição de uma caixa de texto (w x h mm) dentro do polígono maior: tenta os cantos do bbox
// (sudoeste, sudeste, noroeste, nordeste), andando para dentro numa grade de `passo` mm, até caber.
// Devolve { x, y } (canto inferior esquerdo, mm da peça, y para o norte) ou null.
export function encaixarCaixa(poligono, w, h, { margem = 2, passo = 2 } = {}) {
  const b = bboxDoAnel(poligono.ext);
  const cantos = [
    { x: b.x0 + margem, y: b.y0 + margem, dx: 1, dy: 1 },          // sudoeste
    { x: b.x1 - margem - w, y: b.y0 + margem, dx: -1, dy: 1 },     // sudeste
    { x: b.x0 + margem, y: b.y1 - margem - h, dx: 1, dy: -1 },     // noroeste
    { x: b.x1 - margem - w, y: b.y1 - margem - h, dx: -1, dy: -1 }, // nordeste
  ];
  const nx = Math.floor((b.x1 - b.x0 - w - 2 * margem) / passo) + 1;
  const ny = Math.floor((b.y1 - b.y0 - h - 2 * margem) / passo) + 1;
  if (nx < 1 || ny < 1) return null;
  // por distância do canto (i + j crescente), para o texto ficar o mais perto possível do canto
  for (let d = 0; d < nx + ny; d++) {
    for (const c of cantos) {
      for (let i = 0; i <= d; i++) {
        const j = d - i;
        if (i >= nx || j >= ny) continue;
        const x = c.x + c.dx * i * passo;
        const y = c.y + c.dy * j * passo;
        if (caixaCabe(poligono, x, y, w, h)) return { x, y };
      }
    }
  }
  return null;
}

// O número da lâmina: tenta, nesta ordem, o texto inteiro ("9 · 50 m") a 4 mm, a 3 mm, só o número
// a 4, 3 e 2 mm, sempre dentro do anel maior e fora dos furos. Se nem o número cabe (pico de 2 x 4 mm
// no topo da pilha), o texto inteiro vai para fora do anel, no refugo da chapa, encostado ao bbox
// (à direita se couber na peça, senão à esquerda), com data-posicao="fora". Devolve
// { x, y, texto, fonteMm, posicao } em mm da peça (canto inferior esquerdo da caixa de texto).
export function posicaoDoNumero(lamina, texto, { fonteMm = FONTE_NUMERO_MM, larguraMm = Infinity, alturaMm = Infinity } = {}) {
  const p = poligonoMaior(lamina);
  const soNumero = String(lamina.k);
  const tentativas = [
    { texto, fonteMm, margem: 2 },
    { texto, fonteMm: fonteMm * 0.75, margem: 1.5 },
    { texto: soNumero, fonteMm, margem: 1.5 },
    { texto: soNumero, fonteMm: fonteMm * 0.75, margem: 1 },
    { texto: soNumero, fonteMm: fonteMm * 0.5, margem: 0.6 },
  ];
  if (p) {
    for (const t of tentativas) {
      const w = larguraDoTexto(t.texto, t.fonteMm);
      const pos = encaixarCaixa(p, w, t.fonteMm, { margem: t.margem, passo: Math.max(0.5, t.margem) });
      if (pos) return { ...pos, texto: t.texto, fonteMm: t.fonteMm, posicao: t.texto === texto ? 'dentro' : 'dentro-so-numero' };
    }
  }
  const w = larguraDoTexto(texto, fonteMm);
  if (!p) return { x: -w / 2, y: -fonteMm / 2, texto, fonteMm, posicao: 'fora' };
  const b = bboxDoAnel(p.ext);
  const folga = 1.5;
  const y = Math.min(Math.max((b.y0 + b.y1) / 2 - fonteMm / 2, -alturaMm / 2 + folga), alturaMm / 2 - fonteMm - folga);
  const x = b.x1 + folga + w <= larguraMm / 2 ? b.x1 + folga : Math.max(-larguraMm / 2 + folga, b.x0 - folga - w);
  return { x, y, texto, fonteMm, posicao: 'fora' };
}

export function textoDoNumero(lamina) {
  return `${lamina.k} · ${num(lamina.nivel_m, 1)} m`;
}

// ---------------------------------------------------------------------------
// SVG de uma lâmina
// ---------------------------------------------------------------------------

function cabecalho(laminas, L, A, titulo, descricao, { kerf = 0 } = {}) {
  const linhas = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- maquete: ${escaparXml(laminas.nome || laminas.slug || '')}. ${escaparXml(descricao)} -->`,
    `<!-- unidades em mm (1 unidade do viewBox = 1 mm); peça ${num(L)} x ${num(A)} mm; ${kerf > 0 ? `kerf ${num(kerf)} mm: NÃO aplicado às linhas, configure a compensação na cortadora` : 'sem kerf (configure a compensação na cortadora, se precisar)'} -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(L)}mm" height="${num(A)}mm" viewBox="0 0 ${num(L)} ${num(A)}">`,
    `  <title>${escaparXml(titulo)}</title>`,
    `  <desc>${escaparXml(descricao)}</desc>`,
  ];
  return linhas;
}

function validarLaminas(laminas) {
  if (!laminas || typeof laminas !== 'object') throw new Error('laminas.json inválido: não é objeto');
  const L = Number(laminas.largura_mm), A = Number(laminas.altura_mm);
  if (!(L > 0) || !(A > 0)) throw new Error('laminas.json sem largura_mm/altura_mm');
  if (!Array.isArray(laminas.laminas) || !laminas.laminas.length) throw new Error('laminas.json sem lâminas');
  return { L, A };
}

// SVG da lâmina k (0 = base). opcoes: { kerf (mm, só registrado), numerar (bool), guia (bool, padrão true) }.
export function svgDaLamina(laminas, k, opcoes = {}) {
  const { L, A } = validarLaminas(laminas);
  const { kerf = 0, numerar = false, guia = true } = opcoes;
  const lamina = laminas.laminas.find((l) => l.k === k) ?? laminas.laminas[k];
  if (!lamina) throw new Error(`lâmina ${k} não existe (há ${laminas.laminas.length})`);
  const n = laminas.laminas.length;
  const deCima = guia ? (laminas.laminas.find((l) => l.k === k + 1) ?? null) : null;
  const titulo = `${laminas.nome || laminas.slug} — lâmina ${lamina.k} de ${n - 1} (${lamina.tipo}, ${num(lamina.nivel_m, 1)} m)`;
  const descricao = `Lâmina ${lamina.k} de 0 a ${n - 1}, tipo ${lamina.tipo}, nível ${num(lamina.nivel_m, 1)} m, topo em ${num(lamina.z_mm ?? (lamina.k + 1) * (laminas.espessura_mm || 0))} mm; vermelho 0,01 mm corta, azul 0,1 mm grava (guia: contorno da lâmina ${deCima ? deCima.k : 'nenhuma, é a de cima'}).`;
  const out = cabecalho(laminas, L, A, titulo, descricao, { kerf });

  out.push(`  <g id="corte" data-camada="corte" data-lamina="${lamina.k}" data-nivel-m="${num(lamina.nivel_m, 1)}" data-tipo="${escaparXml(lamina.tipo)}">`);
  for (const { anel, tipo } of aneisDaLamina(lamina)) out.push(pathCorte(anel, L, A, tipo));
  out.push('  </g>');

  out.push(`  <g id="gravar" data-camada="gravar"${deCima ? ` data-guia-lamina="${deCima.k}"` : ''}>`);
  if (deCima) for (const { anel, tipo } of aneisDaLamina(deCima)) out.push(pathGravar(anel, L, A, tipo));
  if (numerar) {
    const pos = posicaoDoNumero(lamina, textoDoNumero(lamina), { larguraMm: L, alturaMm: A });
    const [x, y] = paraSvg([pos.x, pos.y], L, A); // canto inferior esquerdo -> baseline do texto
    out.push(`    <text x="${num(x)}" y="${num(y)}" font-family="${FONTE}" font-size="${num(pos.fonteMm)}" fill="${COR_GRAVAR}" stroke="none" data-numero="${lamina.k}" data-posicao="${pos.posicao}">${escaparXml(pos.texto)}</text>`);
  }
  out.push('  </g>');
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Folha-chave (verso da peça)
// ---------------------------------------------------------------------------

// Quebra um texto em linhas que caibam em `larguraMm` com fonte `fonteMm` (largura estimada).
export function quebrarLinhas(texto, larguraMm, fonteMm) {
  const maxChars = Math.max(8, Math.floor(larguraMm / (fonteMm * LARGURA_CHAR)));
  const linhas = [];
  for (const paragrafo of String(texto).split(/\r?\n/)) {
    const palavras = paragrafo.split(/\s+/).filter(Boolean);
    let atual = '';
    for (let p of palavras) {
      while (p.length > maxChars) { // palavra maior que a linha (URL): corta na força
        if (atual) { linhas.push(atual); atual = ''; }
        linhas.push(p.slice(0, maxChars));
        p = p.slice(maxChars);
      }
      if (!atual) atual = p;
      else if ((atual + ' ' + p).length <= maxChars) atual += ' ' + p;
      else { linhas.push(atual); atual = p; }
    }
    if (atual || !palavras.length) linhas.push(atual);
  }
  return linhas;
}

export const FONTE_MONO = 'Menlo, Courier New, monospace';

function textoSvg(x, y, texto, fonteMm, extra = '', familia = FONTE) {
  return `    <text x="${num(x)}" y="${num(y)}" font-family="${familia}" font-size="${num(fonteMm)}" fill="${COR_GRAVAR}" stroke="none"${extra}>${escaparXml(texto)}</text>`;
}

// Linhas de texto da folha-chave (sem SVG): usadas pela folha e testáveis.
export function linhasDaFolhaChave(laminas, { kerf = 0 } = {}) {
  const ls = laminas.laminas;
  const n = ls.length;
  const mar = ls.filter((l) => l.tipo === 'mar').length;
  const terra = ls.filter((l) => l.tipo === 'terra').length;
  const costa = ls.filter((l) => l.tipo === 'costa').length;
  const kmPorCm = laminas.mm_por_km > 0 ? 10 / laminas.mm_por_km : null;
  const e = laminas.espessura_mm;
  const cabecalhoLinhas = [];
  if (laminas.bbox) {
    const b = laminas.bbox;
    cabecalhoLinhas.push(`Caixa: ${numPt(b.norte, 2)} a ${numPt(b.sul, 2)} de latitude, ${numPt(b.oeste, 2)} a ${numPt(b.leste, 2)} de longitude${laminas.km ? ` (${numPt(laminas.km.largura, 1)} x ${numPt(laminas.km.altura, 1)} km)` : ''}.`);
  }
  cabecalhoLinhas.push(`Peça: ${numPt(laminas.largura_mm, 1)} x ${numPt(laminas.altura_mm, 1)} mm; ${n} lâminas (${mar} de mar, ${costa} de costa, ${terra} de terra), ${numPt(e, 1)} mm cada, pilha de ${numPt(e * n, 1)} mm.`);
  if (kmPorCm != null) cabecalhoLinhas.push(`Escala horizontal: 1 cm na peça = ${numPt(kmPorCm, 2)} km (${numPt(laminas.mm_por_km, 2)} mm por km).`);
  const passos = [];
  if (laminas.passo_terra_m) passos.push(`cada lâmina vale ${numPt(laminas.passo_terra_m, 0)} m na terra`);
  if (laminas.passo_mar_m) passos.push(`${numPt(laminas.passo_mar_m, 0)} m no mar`);
  if (passos.length) cabecalhoLinhas.push(`Passo vertical: ${passos.join(' e ')}.`);
  const exageros = [];
  if (Number.isFinite(laminas.exagero)) exageros.push(`${numPt(laminas.exagero, 1)}x na terra`);
  if (Number.isFinite(laminas.exagero_mar)) exageros.push(`${numPt(laminas.exagero_mar, 1)}x no mar`);
  if (exageros.length) cabecalhoLinhas.push(`Exagero vertical (relevo mais alto que o real): ${exageros.join(', ')}.`);
  if (Number.isFinite(laminas.elev_min_m) && Number.isFinite(laminas.elev_max_m)) {
    cabecalhoLinhas.push(`Elevação (depois da suavização): de ${numPt(laminas.elev_min_m, 0)} a ${numPt(laminas.elev_max_m, 0)} m.`);
  }
  if (laminas.mascara && Number.isFinite(laminas.mascara.pct_medido) && mar > 0) {
    cabecalhoLinhas.push(`Fundo do mar: ${numPt(laminas.mascara.pct_medido, 1)} % medido por sonar, o resto é modelo GEBCO.`);
  }
  cabecalhoLinhas.push(`Corte: vermelho 0,01 mm corta, azul 0,1 mm grava (guia de colagem = contorno da lâmina de cima). Kerf: ${kerf > 0 ? `${numPt(kerf, 2)} mm, não aplicado às linhas; compense na cortadora` : 'não informado; compense na cortadora se precisar'}.`);

  const tabela = ls.map((l) => ({
    k: l.k,
    texto: `${String(l.k).padStart(2, ' ')}  ${l.tipo.padEnd(5, ' ')}  ${numPt(l.nivel_m, 0).padStart(6, ' ')} m  ${numPt(areaDaLamina(l) / 100, 1).padStart(7, ' ')} cm²`,
  }));

  const fontes = [];
  for (const f of laminas.fontes || []) {
    if (!f || !f.id) continue;
    const partes = [`${f.id}`];
    if (f.licenca) partes.push(`licença: ${f.licenca}`);
    if (f.url) partes.push(f.url.split('?')[0]);
    fontes.push({ titulo: partes.join(' — '), atribuicao: f.atribuicao || '' });
  }
  const rodape = [
    `Gerado por ${laminas.gerado_por || 'maquete'}${laminas.gerado_em ? ` em ${String(laminas.gerado_em).slice(0, 10)}` : ''}. Dado aberto: Copernicus DEM GLO-30 na terra, GMRT no mar. Não serve para navegação.`,
    ASSINATURA,
  ];
  return { cabecalho: cabecalhoLinhas, tabela, fontes, rodape };
}

// Folha-chave: mesmo tamanho da peça (é o verso). Tudo na camada gravar, retângulo na camada corte.
export function svgFolhaChave(laminas, opcoes = {}) {
  const { L, A } = validarLaminas(laminas);
  const { kerf = 0 } = opcoes;
  const margem = 8;
  const larguraUtil = L - 2 * margem;
  const fTitulo = 7, fTexto = 3, fTabela = 2.8, fFontes = 2.4;
  const alt = (f) => f * 1.35;
  const { cabecalho: cab, tabela, fontes, rodape } = linhasDaFolhaChave(laminas, { kerf });

  const corpo = [];
  let y = margem + fTitulo;
  corpo.push(textoSvg(margem, y, laminas.nome || laminas.slug || 'maquete', fTitulo, ' font-weight="bold"'));
  y += alt(fTitulo) * 0.6;
  corpo.push(textoSvg(margem, y, 'Folha-chave da maquete em lâminas (verso da peça)', fTexto));
  y += alt(fTexto) * 1.4;
  for (const linha of cab) {
    for (const l of quebrarLinhas(linha, larguraUtil, fTexto)) { corpo.push(textoSvg(margem, y, l, fTexto)); y += alt(fTexto); }
  }
  y += alt(fTexto) * 0.6;

  // tabela em colunas: quantas linhas cabem antes de reservar espaço para fontes e rodapé
  const linhasFontes = fontes.reduce((s, f) => s + 1 + quebrarLinhas(f.atribuicao, larguraUtil, fFontes).length, 0) + rodape.length + 1;
  const reservado = linhasFontes * alt(fFontes) + 2 * alt(fTexto);
  const disponivel = Math.max(alt(fTabela) * 4, A - margem - y - reservado - alt(fTabela));
  const larguraColuna = larguraDoTexto('00  costa  -0000 m  0000,0 cm²', fTabela) + 6;
  const maxColunas = Math.max(1, Math.floor(larguraUtil / larguraColuna));
  const linhasQueCabem = Math.max(1, Math.floor(disponivel / alt(fTabela)));
  const colunas = Math.min(maxColunas, Math.ceil(tabela.length / linhasQueCabem));
  const porColuna = Math.ceil(tabela.length / colunas);
  corpo.push(textoSvg(margem, y, 'Lâminas (número, tipo, nível, área líquida):', fTexto, ' font-weight="bold"'));
  y += alt(fTexto);
  const yTabela = y;
  // de cima para baixo na pilha = de baixo para cima na tabela? Não: a ordem natural de montagem é k crescente.
  for (let c = 0; c < colunas; c++) {
    const x = margem + c * larguraColuna;
    let yy = yTabela;
    for (const linha of tabela.slice(c * porColuna, (c + 1) * porColuna)) {
      corpo.push(textoSvg(x, yy, linha.texto, fTabela, ' xml:space="preserve"', FONTE_MONO));
      yy += alt(fTabela);
    }
  }
  y = yTabela + Math.min(porColuna, tabela.length) * alt(fTabela) + alt(fTexto) * 0.6;

  corpo.push(textoSvg(margem, y, 'Fontes e licenças:', fTexto, ' font-weight="bold"'));
  y += alt(fTexto);
  for (const f of fontes) {
    for (const l of quebrarLinhas(f.titulo, larguraUtil, fFontes)) { corpo.push(textoSvg(margem, y, l, fFontes, ' font-weight="bold"')); y += alt(fFontes); }
    for (const l of quebrarLinhas(f.atribuicao, larguraUtil, fFontes)) { corpo.push(textoSvg(margem, y, l, fFontes)); y += alt(fFontes); }
  }
  y += alt(fFontes) * 0.5;
  for (const r of rodape) {
    for (const l of quebrarLinhas(r, larguraUtil, fFontes)) { corpo.push(textoSvg(margem, y, l, fFontes)); y += alt(fFontes); }
  }
  // se o texto não coube, a folha cresce para baixo (o verso fica maior que a peça; avisado no <desc>)
  const alturaFinal = Math.max(A, Math.ceil((y + margem) * 100) / 100);
  const cresceu = alturaFinal > A;

  const titulo = `${laminas.nome || laminas.slug} — folha-chave`;
  const descricao = `Folha-chave (verso da peça): lista das lâminas, escala, espessura, passo, exagero, fontes e licença.${cresceu ? ` O texto não coube em ${num(A)} mm: a folha tem ${num(alturaFinal)} mm de altura.` : ''}`;
  const out = cabecalho(laminas, L, alturaFinal, titulo, descricao, { kerf });
  out.push('  <g id="corte" data-camada="corte">');
  out.push(`    <path d="M0 0 L${num(L)} 0 L${num(L)} ${num(alturaFinal)} L0 ${num(alturaFinal)} Z" fill="none" stroke="${COR_CORTE}" stroke-width="${TRACO_CORTE}" data-anel="ext"/>`);
  out.push('  </g>');
  out.push('  <g id="gravar" data-camada="gravar">');
  out.push(...corpo);
  out.push('  </g>');
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

// Nome de arquivo de uma lâmina: lamina-00.svg, lamina-01.svg… (3 dígitos a partir de 100 lâminas).
export function nomeDoArquivo(k, total = 0) {
  const digitos = Math.max(2, String(Math.max(0, total - 1)).length);
  return `lamina-${String(k).padStart(digitos, '0')}.svg`;
}

export const NOME_FOLHA_CHAVE = 'folha-chave.svg';

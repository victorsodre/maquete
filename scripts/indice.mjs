#!/usr/bin/env node
// Índice dos lugares para a página: varre lugares/*/lugar.json (+ laminas.json) e grava lugares/index.json.
// A página lê esse arquivo para montar os seletores de escala e de lugar; sem ele, a barra fica sem os seletores.
//
// Uso: node scripts/indice.mjs [--raiz lugares] [--saida lugares/index.json] [--quieto]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ESCALAS = [
  { id: 'pais', nome: 'País' },
  { id: 'regiao', nome: 'Região' },
  { id: 'estado', nome: 'Estado' },
  { id: 'municipio', nome: 'Município' },
  { id: 'local', nome: 'Local' },
];
const ORDEM_ESCALA = new Map(ESCALAS.map((e, i) => [e.id, i]));
const SLUG_OK = /^[a-z0-9_-]+$/;   // o mesmo filtro da página (web/app.js) aplica em ?lugar=

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const colador = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

function lerJson(arquivo) {
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

// Escala declarada no lugar.json (ausente = "local"); fora da lista vale como "local", com aviso.
export function escalaDe(lugar, avisar = () => {}) {
  const e = lugar && lugar.escala;
  if (e === undefined || e === null || e === '') return 'local';
  if (!ORDEM_ESCALA.has(e)) { avisar(`escala "${e}" desconhecida; fica como "local"`); return 'local'; }
  return e;
}

// UF (sigla) só faz sentido em estado e município; nos outros níveis é null.
export function ufDe(lugar) {
  const ibge = lugar && lugar.ibge;
  if (!ibge || typeof ibge !== 'object') return null;
  if (ibge.nivel !== 'estados' && ibge.nivel !== 'municipios') return null;
  const sigla = String(ibge.sigla || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(sigla) ? sigla : null;
}

// Uma entrada do índice a partir de uma pasta lugares/<slug>/; devolve null (com aviso) se não dá para indexar.
export function entradaDe(pasta, { avisar = () => {} } = {}) {
  const slug = path.basename(pasta);
  const aviso = (m) => avisar(`${slug}: ${m}`);
  if (!SLUG_OK.test(slug)) { aviso('nome de pasta fora do padrão (só a-z, 0-9, "-" e "_"); fica de fora'); return null; }
  const arqLugar = path.join(pasta, 'lugar.json');
  const arqLaminas = path.join(pasta, 'laminas.json');
  if (!fs.existsSync(arqLugar)) { aviso('sem lugar.json; fica de fora'); return null; }
  if (!fs.existsSync(arqLaminas)) { aviso('sem laminas.json (rode node cli/laminas.mjs); fica de fora'); return null; }
  let lugar, laminas;
  try { lugar = lerJson(arqLugar); } catch (e) { aviso(`lugar.json inválido (${e.message}); fica de fora`); return null; }
  try { laminas = lerJson(arqLaminas); } catch (e) { aviso(`laminas.json inválido (${e.message}); fica de fora`); return null; }
  if (!laminas || !Array.isArray(laminas.laminas)) { aviso('laminas.json sem "laminas"; fica de fora'); return null; }
  const kmLargura = Number(laminas.km && laminas.km.largura);
  if (!(kmLargura > 0)) { aviso('laminas.json sem km.largura; fica de fora'); return null; }
  const nome = String(lugar.nome || laminas.nome || slug).trim() || slug;
  const escala = escalaDe(lugar, aviso);
  if (laminas.escala && laminas.escala !== escala) aviso(`escala "${laminas.escala}" no laminas.json difere da do lugar.json ("${escala}"); vale a do lugar.json`);
  return {
    slug,
    nome,
    escala,
    uf: ufDe(lugar),
    km_largura: Math.round(kmLargura * 10) / 10,
    laminas: laminas.laminas.length,
  };
}

// Ordena: escalas na ordem do contrato (país, região, estado, município, local), depois nome em pt-BR sem acento.
export function ordenar(lugares) {
  return [...lugares].sort((a, b) =>
    (ORDEM_ESCALA.get(a.escala) - ORDEM_ESCALA.get(b.escala)) || colador.compare(a.nome, b.nome) || colador.compare(a.slug, b.slug));
}

// Monta o índice inteiro a partir da pasta de lugares. `agora` é a data gravada em gerado_em (injetável nos testes).
export function gerarIndice(raizLugares, { avisar = () => {}, agora = () => new Date() } = {}) {
  const pastas = fs.existsSync(raizLugares)
    ? fs.readdirSync(raizLugares, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(raizLugares, d.name))
    : [];
  const lugares = [];
  for (const pasta of pastas.sort()) {
    const e = entradaDe(pasta, { avisar });
    if (e) lugares.push(e);
  }
  return {
    gerado_em: agora().toISOString(),
    escalas: ESCALAS.map((e) => ({ ...e })),
    lugares: ordenar(lugares),
  };
}

export function gravarIndice(raizLugares, saida, opcoes = {}) {
  const indice = gerarIndice(raizLugares, opcoes);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, JSON.stringify(indice, null, 2) + '\n');
  return indice;
}

const ehPrincipal = (() => {
  try { return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (ehPrincipal) {
  const args = process.argv.slice(2);
  const opt = (nome, def) => { const i = args.indexOf(nome); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  const quieto = args.includes('--quieto');
  const raiz = path.resolve(REPO, opt('--raiz', 'lugares'));
  const saida = path.resolve(REPO, opt('--saida', path.join('lugares', 'index.json')));
  const avisar = (m) => { if (!quieto) console.warn(`[indice] aviso: ${m}`); };
  const indice = gravarIndice(raiz, saida, { avisar });
  if (!quieto) {
    const porEscala = ESCALAS.map((e) => `${e.nome.toLowerCase()} ${indice.lugares.filter((l) => l.escala === e.id).length}`).join(' · ');
    console.log(`[indice] ${indice.lugares.length} lugar(es) em ${path.relative(REPO, saida)} (${porEscala})`);
  }
}

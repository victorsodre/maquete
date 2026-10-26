#!/usr/bin/env node
// node cli/svg.mjs <slug> [--saida lugares/<slug>/svg] [--kerf 0.15] [--numerar]
// Lê lugares/<slug>/laminas.json e grava um SVG por lâmina (lamina-00.svg, lamina-01.svg…) mais a
// folha-chave.svg (verso da peça), prontos para a cortadora a laser ou para imprimir e cortar em papel.
// O texto SVG vem de cli/svg-lamina.mjs (módulo puro, o mesmo que a página usa). Contrato: SPEC.md,
// seção "SVG de corte".
//
// Kerf: --kerf só registra o valor (comentário no topo de cada SVG e na folha-chave); as linhas não
// recebem offset. A cortadora compensa (LightBurn: "Kerf offset" por camada).
import fs from 'node:fs';
import path from 'node:path';
import { lerLugar, raizDosLugares } from './index.mjs';
import { PACOTE, ehPrincipal } from './rede.mjs';
import { fmtBytes, fmtSegundos } from './terrain.mjs';
import { svgDaLamina, svgFolhaChave, nomeDoArquivo, NOME_FOLHA_CHAVE } from './svg-lamina.mjs';

export const AJUDA = `maquete ${PACOTE.version}: laminas.json -> um SVG por lâmina + folha-chave (corte a laser / papel)

Uso:
  node cli/svg.mjs <slug> [opções]

Opções:
  --saida DIR      pasta de saída (padrão lugares/<slug>/svg, gitignored)
  --kerf N         largura do corte do laser em mm (ex. 0.15); só registrada no SVG e na folha-chave,
                   as linhas não recebem offset: compense na cortadora
  --numerar        grava em cada lâmina o número e o nível em metros (texto de 4 mm, dentro do anel maior)
  --silencioso     só erros
  --ajuda, -h      esta ajuda

Cada SVG é em mm de verdade (width="300mm", viewBox em mm). Camada "corte": vermelho 0,01 mm;
camada "gravar": azul 0,1 mm com o contorno da lâmina de cima (guia de colagem). Antes, rode:
node cli/laminas.mjs <slug>.`;

export function parseArgs(argv) {
  const o = { _: [], kerf: 0, numerar: false, silencioso: false, ajuda: false, saida: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--saida': {
        const v = argv[i + 1];
        if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new Error('opção --saida precisa de uma pasta');
        o.saida = v; i++; break;
      }
      case '--kerf': {
        const v = argv[i + 1];
        if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new Error('opção --kerf precisa de um valor em mm');
        const n = Number(String(v).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0 || n > 2) throw new Error(`opção --kerf precisa de um número entre 0 e 2 mm (veio "${v}")`);
        o.kerf = n; i++; break;
      }
      case '--numerar': o.numerar = true; break;
      case '--silencioso': o.silencioso = true; break;
      case '--ajuda': case '-h': case '--help': o.ajuda = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`opção desconhecida: ${a} (veja --ajuda)`);
        o._.push(a);
    }
  }
  return o;
}

// Lê o laminas.json do lugar (ou de um caminho dado) com erro claro.
export function lerLaminas(caminho, slug = null) {
  if (!fs.existsSync(caminho)) {
    throw new Error(`${path.relative(process.cwd(), caminho)} não existe; gere as lâminas antes: node cli/laminas.mjs ${slug || '<slug>'}`);
  }
  let laminas;
  try { laminas = JSON.parse(fs.readFileSync(caminho, 'utf8')); } catch (e) { throw new Error(`laminas.json inválido: ${e.message}`); }
  if (!Array.isArray(laminas.laminas) || !laminas.laminas.length) throw new Error('laminas.json sem lâminas');
  return laminas;
}

// Gera todos os SVGs de um laminas.json já lido numa pasta. Devolve a lista { arquivo, bytes, k }.
// Apaga antes os lamina-*.svg que já estavam lá (uma pilha que encolheu não pode deixar lâmina velha).
export function gerarSvgs({ laminas, saida, kerf = 0, numerar = false, log = () => {} }) {
  const t0 = performance.now();
  fs.mkdirSync(saida, { recursive: true });
  const velhos = fs.readdirSync(saida).filter((f) => /^lamina-\d+\.svg$/.test(f) || f === NOME_FOLHA_CHAVE);
  for (const f of velhos) fs.unlinkSync(path.join(saida, f));
  if (velhos.length) log(`apagados ${velhos.length} SVG antigos em ${path.relative(process.cwd(), saida) || '.'}`);

  const total = laminas.laminas.length;
  const gravados = [];
  let bytesTotal = 0;
  for (const lamina of laminas.laminas) {
    const texto = svgDaLamina(laminas, lamina.k, { kerf, numerar });
    const arquivo = path.join(saida, nomeDoArquivo(lamina.k, total));
    fs.writeFileSync(arquivo, texto);
    const bytes = Buffer.byteLength(texto);
    bytesTotal += bytes;
    gravados.push({ arquivo, bytes, k: lamina.k });
  }
  const folha = svgFolhaChave(laminas, { kerf });
  const arquivoFolha = path.join(saida, NOME_FOLHA_CHAVE);
  fs.writeFileSync(arquivoFolha, folha);
  const bytesFolha = Buffer.byteLength(folha);
  bytesTotal += bytesFolha;
  gravados.push({ arquivo: arquivoFolha, bytes: bytesFolha, k: null });

  const maior = gravados.reduce((m, g) => (g.bytes > m.bytes ? g : m), gravados[0]);
  log(`${total} lâminas + folha-chave em ${path.relative(process.cwd(), saida) || '.'}: ${fmtBytes(bytesTotal)} no total, maior ${path.basename(maior.arquivo)} (${fmtBytes(maior.bytes)}); ${numerar ? 'numeradas' : 'sem numeração'}; kerf ${kerf > 0 ? `${String(kerf).replace('.', ',')} mm (registrado, não aplicado)` : 'não informado'}; ${fmtSegundos(performance.now() - t0)}`);
  return gravados;
}

export async function main(argv = process.argv.slice(2)) {
  const opcoes = parseArgs(argv);
  if (opcoes.ajuda || !opcoes._.length) {
    console.log(AJUDA);
    return opcoes.ajuda ? 0 : 2;
  }
  if (opcoes._.length > 1) throw new Error(`um lugar por vez (veio ${opcoes._.join(', ')})`);
  const slug = opcoes._[0];
  const log = opcoes.silencioso ? () => {} : (m) => console.log(m);
  const raiz = raizDosLugares(process.cwd(), slug);
  const lugar = lerLugar(raiz, slug);
  const laminas = lerLaminas(path.join(lugar.pasta, 'laminas.json'), slug);
  const saida = opcoes.saida ? path.resolve(process.cwd(), opcoes.saida) : path.join(lugar.pasta, 'svg');
  log(`${slug} (${laminas.nome || lugar.nome}): ${laminas.laminas.length} lâminas, peça ${String(laminas.largura_mm).replace('.', ',')} x ${String(laminas.altura_mm).replace('.', ',')} mm`);
  gerarSvgs({ laminas, saida, kerf: opcoes.kerf, numerar: opcoes.numerar, log });
  return 0;
}

if (ehPrincipal(import.meta.url)) {
  main().then((codigo) => { process.exitCode = codigo; }).catch((e) => {
    console.error(`erro: ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  });
}

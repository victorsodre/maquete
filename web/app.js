// maquete: a cena (Three.js, módulo). Uma maquete em lâminas sobre uma mesa, com luz de estúdio:
// cada lâmina do laminas.json vira uma extrusão de compensado (ou cartão, ou gesso), o fundo do
// mar em lâminas tingidas de azul por profundidade, uma placa de acrílico translúcido no nível do
// mar, HDRI de estúdio como luz e fundo desfocado, uma luz direcional quente com sombra suave
// (a sombra fina entre as lâminas é o efeito principal), ACES e vinheta leve.
//
// Contrato: window.__maquete (SPEC.md). Nada de Date.now/Math.random/performance.now na cena:
// o quadro é função pura de t (e do material, da água e do levantar) e só muda por setTime(t).
//
// URL: index.html?lugar=<slug>[&t=<s>][&capture=1][&material=compensado|cartao|gesso][&agua=0|1]
//                             [&levantar=<0..1>][&simples=1][&moldura=0|1]
//   capture=1   sem UI, sem animação automática, dpr 1, sem órbita.
//   levantar=x  fixa a placa do mar nessa altura (0..1), ignorando a trilha.
//   simples=1   placa sem transmission (o mesmo fallback do celular com dpr >= 2).
//   moldura=0   tira a moldura de nogueira (a caixa de 6 mm em volta da peça, da mesa ao topo da placa).
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { prepararTrilha, trilhaPadrao, FOV_PADRAO } from './trilha.js';
import { construirPilha, geometriaPlaca, geometriaMoldura, tintarMar, RAMPAS } from './pilha.js';

// ---------------------------------------------------------------- parâmetros de look
const LOOK = {
  exposicao: 1.0,
  ambiente: 1.15,                // environmentIntensity (sobe o preenchimento: parede na sombra não pode ficar preta)
  fundoDesfoque: 0.7,            // backgroundBlurriness
  fundoIntensidade: 0.5,         // backgroundIntensity
  luzCor: '#fff1dc', luzForca: 2.2,
  luzElevacaoGraus: 35, luzAzimuteGraus: -95,   // de cima-esquerda para a câmera do início da volta
  sombraMapa: 2048, sombraBias: -0.0003, sombraNormalBias: 0.02, sombraRaio: 1.5,
  queima: 0.62,                  // cor da parede (borda queimada pelo laser) = tampo x 0,62
  queimaMar: 0.8,                // parede das lâminas de mar: menos queima, senão a lâmina funda fica preta
  mesaLarguras: 10, mesaRepeteMm: 600,
  mesaSaturacao: 0.62, mesaGama: 0.74,   // textura reprocessada: menos mogno, um pouco mais clara (a peça é o foco, a mesa fica atrás)
  mesaCor: [1.5, 1.5, 1.42],     // e ainda um multiplicador quase neutro por cima (clareia sem puxar para o azul)
  mesaRoughness: 0.85,           // sem roughnessMap: o verniz do asset vira um hotspot do softbox
  // moldura: caixa de nogueira em volta da peça (compensado_diff tingido), da mesa ao topo da placa
  // (cor escura, roughness alta, clearcoat baixo e ambiente contido: com clearcoat 0,25 e cor 0,45/0,32/0,22
  //  o tampo visto de raspão lavava em bege e parecia outra madeira)
  moldura: { parede: 6, cor: [0.34, 0.22, 0.14], roughness: 0.7, clearcoat: 0.08, clearcoatRoughness: 0.55, reflexo: 0.5, grao: 0.3 },
  placa: { espessura: 2, folga: 0.2, transmission: 0.9, roughness: 0.1, ior: 1.49, cor: '#bfe3ef', atenuacaoCor: '#7fb8d6', atenuacaoDist: 60, opacidadeSimples: 0.45, reflexo: 0.7 },
  levantarMm: 25, inclinarGraus: 2,
  fov: FOV_PADRAO,
  orcamentoTriangulos: 300000,
};
const MATERIAIS = ['compensado', 'cartao', 'gesso'];
const NOME_MATERIAL = { compensado: 'compensado', cartao: 'cartão', gesso: 'gesso' };

// ---------------------------------------------------------------- URL e modos
const url = new URL(location.href);
const slug = (url.searchParams.get('lugar') || 'rio').replace(/[^a-z0-9_-]/gi, '');
const CAPTURA = url.searchParams.get('capture') === '1';
const SIMPLES = url.searchParams.get('simples') === '1';
const SEM_AGUA = url.searchParams.get('agua') === '0';
const SEM_MOLDURA = url.searchParams.get('moldura') === '0';
const materialInicial = MATERIAIS.includes(url.searchParams.get('material')) ? url.searchParams.get('material') : 'compensado';
const tInicial = Number.isFinite(Number(url.searchParams.get('t'))) ? Number(url.searchParams.get('t')) : 0;
const levantarUrl = (() => {
  const v = url.searchParams.get('levantar');
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
})();
const BASE = './';                       // fetch resolve contra o documento (index.html na raiz)
const dirLugar = `${BASE}lugares/${slug}/`;

const $ = (id) => document.getElementById(id);
const canvas = $('cena');

// ---------------------------------------------------------------- __maquete (contrato)
let resolveReady, rejectReady;
const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
const maquete = {
  ready,
  setTime: async () => {},
  duration: () => 0,
  getState: () => ({ t: 0, levantar: 0, material: materialInicial, pos: [0, 0, 0], alvo: [0, 0, 0] }),
  metrics: () => ({ calls: 0, triangles: 0, renderizador: null }),
};
window.__maquete = maquete;

function avisar(msg) {
  console.error(msg);
  const el = $('aviso');
  if (el && !CAPTURA) { el.textContent = msg; el.hidden = false; }
}

const fmt = (v, casas = 0) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });

// ---------------------------------------------------------------- carga de dados
async function carregarJson(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`não achei ${u} (HTTP ${r.status})`);
  return r.json();
}

async function carregarTexturas(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const nomes = ['compensado_diff', 'compensado_rough', 'compensado_nor_gl', 'mesa_diff', 'mesa_rough', 'mesa_nor_gl'];
  const texs = await Promise.all(nomes.map((n) => loader.loadAsync(`${BASE}web/assets/${n}.jpg`)));
  const out = {};
  nomes.forEach((n, i) => {
    const t = texs[i];
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.colorSpace = n.endsWith('_diff') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    out[n] = t;
  });
  return out;
}

// A mesa: o wood_table_001 é mogno escuro e saturado, e multiplicar a cor não desatura. Aqui a
// textura é reprocessada pixel a pixel (mistura com a luminância, depois clareia por gama) antes de
// virar textura. Determinístico (só aritmética sobre a imagem carregada).
function ajustarMadeiraMesa(tex, { saturacao, gama }) {
  const img = tex.image;
  if (!img || !img.width || typeof document === 'undefined') return tex;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return tex;
  ctx.drawImage(img, 0, 0);
  const dados = ctx.getImageData(0, 0, c.width, c.height);
  const p = dados.data;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, gama));
  const prender = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    p[i] = lut[prender(l + (r - l) * saturacao)];
    p[i + 1] = lut[prender(l + (g - l) * saturacao)];
    p[i + 2] = lut[prender(l + (b - l) * saturacao)];
  }
  ctx.putImageData(dados, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = tex.anisotropy;
  t.colorSpace = THREE.SRGBColorSpace;
  tex.dispose();
  return t;
}

async function carregarHdr() {
  const tex = await new HDRLoader().loadAsync(`${BASE}web/assets/estudio.hdr`);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

function validarLaminas(j) {
  if (!j || !Array.isArray(j.laminas) || !j.laminas.length) throw new Error('laminas.json sem "laminas"');
  for (const c of ['largura_mm', 'altura_mm', 'espessura_mm']) if (!(Number(j[c]) > 0)) throw new Error(`laminas.json sem ${c}`);
}

// ---------------------------------------------------------------- materiais
const cinza = (v) => new THREE.Color(v, v, v);   // multiplicador linear (new Color(r,g,b) é linear)

function criarMateriais(nome, tex) {
  const diff = tex.compensado_diff, rough = tex.compensado_rough, nor = tex.compensado_nor_gl;
  const M = (o) => new THREE.MeshPhysicalMaterial({ metalness: 0, ...o });
  if (nome === 'cartao') {
    return {
      terraTampo: M({ color: '#ece4d2', roughness: 0.95, normalMap: nor, normalScale: new THREE.Vector2(0.25, 0.25) }),
      terraParede: M({ color: '#d9cfb8', roughness: 0.95 }),
      marTampo: M({ vertexColors: true, roughness: 0.95, normalMap: nor, normalScale: new THREE.Vector2(0.25, 0.25) }),
      marParede: M({ vertexColors: true, color: cinza(0.85), roughness: 0.95 }),
    };
  }
  if (nome === 'gesso') {
    const sheen = { sheen: 0.3, sheenColor: new THREE.Color(1, 1, 1), sheenRoughness: 0.9 };
    return {
      terraTampo: M({ color: '#f2f0ea', roughness: 0.9, ...sheen }),
      terraParede: M({ color: '#d8d5cc', roughness: 0.9, ...sheen }),
      marTampo: M({ vertexColors: true, roughness: 0.9, ...sheen }),
      marParede: M({ vertexColors: true, color: cinza(0.88), roughness: 0.9, ...sheen }),
    };
  }
  // compensado (padrão): madeira de verdade no tampo, borda queimada na parede
  const tampo = { map: diff, roughnessMap: rough, roughness: 1, normalMap: nor, normalScale: new THREE.Vector2(0.6, 0.6), clearcoat: 0.15, clearcoatRoughness: 0.5 };
  return {
    terraTampo: M(tampo),
    terraParede: M({ map: diff, color: cinza(LOOK.queima), roughness: 0.9 }),
    marTampo: M({ ...tampo, vertexColors: true, roughness: 0.6 }),
    marParede: M({ map: diff, vertexColors: true, color: cinza(LOOK.queimaMar), roughness: 0.9 }),
  };
}

function criarMaterialPlaca(simples) {
  const p = LOOK.placa;
  if (simples) {
    return new THREE.MeshPhysicalMaterial({ color: p.cor, roughness: p.roughness, metalness: 0, ior: p.ior, envMapIntensity: p.reflexo, transparent: true, opacity: p.opacidadeSimples, depthWrite: false });
  }
  return new THREE.MeshPhysicalMaterial({
    color: p.cor, roughness: p.roughness, metalness: 0, ior: p.ior, envMapIntensity: p.reflexo,
    transmission: p.transmission, thickness: p.espessura, attenuationColor: new THREE.Color(p.atenuacaoCor), attenuationDistance: p.atenuacaoDist,
  });
}

// ---------------------------------------------------------------- cena
async function iniciar() {
  // sem relógio aqui: o tempo até ready quem mede é a captura (pronto_ms), de fora da página
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURA });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposicao;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // no r185 PCFSoftShadowMap está obsoleto e cai neste (com aviso); a suavidade vem de shadow.radius
  renderer.info.autoReset = false;
  const dpr = CAPTURA ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  const tamanho = () => ({ w: Math.max(1, Math.floor(window.innerWidth)), h: Math.max(1, Math.floor(window.innerHeight)) });
  let { w: W, h: H } = tamanho();
  renderer.setSize(W, H, false);

  // dados, HDRI e texturas em paralelo; tudo carregado antes de ready (quadro com material cinza é bug)
  const [laminas, hdr, tex] = await Promise.all([carregarJson(dirLugar + 'laminas.json'), carregarHdr(), carregarTexturas(renderer)]);
  validarLaminas(laminas);
  const L = Number(laminas.largura_mm), A = Number(laminas.altura_mm), E = Number(laminas.espessura_mm);
  const n = laminas.laminas.length;
  const alturaPilha = E * n;
  const temMar = Boolean(laminas.agua && Array.isArray(laminas.agua.aneis) && laminas.agua.aneis.length);
  const costa = laminas.laminas.find((l) => l.tipo === 'costa');
  const zDe = (l) => (Number(l.z_mm) > 0 ? Number(l.z_mm) : (Number(l.k) + 1) * E);   // topo da lâmina, em mm
  const M = SEM_MOLDURA ? 0 : LOOK.moldura.parede;   // a peça toda (moldura por fora) mede L + 2M por A + 2M

  // trilha: lugares/<slug>/camera.json; sem o arquivo, a volta de produto padrão (12 s), enquadrando a peça com a moldura
  let trilha = null;
  let trilhaPadraoUsada = false;
  const montarTrilhaPadrao = () => trilhaPadrao({ largura_mm: L + 2 * M, altura_mm: A + 2 * M, espessura_mm: E, n_laminas: n, aspecto: W / H });
  try { trilha = prepararTrilha(await carregarJson(dirLugar + 'camera.json')); } catch (e) {
    console.warn(`sem camera.json em lugares/${slug}/ (${e?.message || e}); uso a trilha padrão`);
    trilha = montarTrilhaPadrao();
    trilhaPadraoUsada = true;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(LOOK.fov, W / H, 1, 20 * L);

  // luz de estúdio: HDRI filtrado (PMREM) como ambiente e, desfocado, como fundo
  const pmrem = new THREE.PMREMGenerator(renderer);
  const ambiente = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose(); pmrem.dispose();
  scene.environment = ambiente;
  scene.environmentIntensity = LOOK.ambiente;
  scene.background = ambiente;
  scene.backgroundBlurriness = LOOK.fundoDesfoque;
  scene.backgroundIntensity = LOOK.fundoIntensidade;

  // mesa
  const mesaLado = LOOK.mesaLarguras * L;
  tex.mesa_diff = ajustarMadeiraMesa(tex.mesa_diff, { saturacao: LOOK.mesaSaturacao, gama: LOOK.mesaGama });
  for (const t of [tex.mesa_diff, tex.mesa_rough, tex.mesa_nor_gl]) t.repeat.set(mesaLado / LOOK.mesaRepeteMm, mesaLado / LOOK.mesaRepeteMm);
  tex.mesa_rough.dispose();   // carregada (ficha do asset), mas o verniz do mapa de roughness vira hotspot: mesa com roughness fixa
  const mesa = new THREE.Mesh(
    new THREE.PlaneGeometry(mesaLado, mesaLado).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex.mesa_diff, color: new THREE.Color(...LOOK.mesaCor), roughness: LOOK.mesaRoughness, normalMap: tex.mesa_nor_gl, normalScale: new THREE.Vector2(0.35, 0.35), metalness: 0 }),
  );
  mesa.receiveShadow = true;
  scene.add(mesa);

  // a pilha de lâminas
  const pilha = construirPilha(laminas.laminas, { espessura_mm: E });
  if (pilha.vazias) console.warn(`${pilha.vazias} lâmina(s) sem anel válido`);
  if (pilha.descartados) console.warn(`${pilha.descartados} anel(is) degenerado(s) descartado(s)`);
  const peca = new THREE.Group();
  scene.add(peca);
  const materiais = new Map();
  const materiaisDe = (nome) => { if (!materiais.has(nome)) materiais.set(nome, criarMateriais(nome, tex)); return materiais.get(nome); };
  const meshTerra = pilha.terra ? new THREE.Mesh(pilha.terra, []) : null;
  const meshMar = pilha.mar ? new THREE.Mesh(pilha.mar, []) : null;
  for (const m of [meshTerra, meshMar]) if (m) { m.castShadow = true; m.receiveShadow = true; peca.add(m); }

  // placa de acrílico do mar: 2 mm, topo 0,2 mm acima do tampo da costa (ou do topo da pilha de mar)
  const placaSimples = SIMPLES || dpr >= 2;
  let placa = null;
  const yTopoPlaca = (costa ? zDe(costa) : E * laminas.laminas.filter((l) => l.tipo === 'mar').length) + LOOK.placa.folga;
  if (temMar && !SEM_AGUA) {
    const g = geometriaPlaca(laminas.agua, { espessura: LOOK.placa.espessura, yTopo: yTopoPlaca });
    if (g) {
      placa = new THREE.Mesh(g, criarMaterialPlaca(placaSimples));
      placa.castShadow = false; placa.receiveShadow = false;
      placa.renderOrder = 10;
      peca.add(placa);
    }
  }

  // moldura: caixa de nogueira (compensado tingido) em volta da peça, da mesa ao topo da placa de
  // acrílico; sem placa, até o topo da lâmina mais alta do mar ou da costa (sem mar: a lâmina 0).
  // A placa fica encaixada por dentro (agua.aneis vive dentro do retângulo da peça; nunca atravessa).
  let moldura = null;
  if (M > 0) {
    const zMar = Math.max(0, ...laminas.laminas.filter((l) => l.tipo === 'mar' || l.tipo === 'costa').map(zDe));
    const yTopo = placa ? yTopoPlaca : (zMar > 0 ? zMar : zDe(laminas.laminas[0]));
    const g = geometriaMoldura({ largura: L, altura: A, parede: M, yTopo });
    if (g) {
      const mm = LOOK.moldura;
      const mat = new THREE.MeshPhysicalMaterial({
        map: tex.compensado_diff, color: new THREE.Color(...mm.cor), roughness: mm.roughness, metalness: 0,
        clearcoat: mm.clearcoat, clearcoatRoughness: mm.clearcoatRoughness, envMapIntensity: mm.reflexo,
        normalMap: tex.compensado_nor_gl, normalScale: new THREE.Vector2(mm.grao, mm.grao),
      });
      moldura = new THREE.Mesh(g, [mat, mat]);
      moldura.castShadow = true; moldura.receiveShadow = true;
      peca.add(moldura);
    }
  }
  const triangulosDe = (mesh) => (mesh ? mesh.geometry.attributes.position.count / 3 : 0);
  const triangulosPilha = pilha.triangulos + triangulosDe(placa) + triangulosDe(moldura);
  if (triangulosPilha > LOOK.orcamentoTriangulos) console.warn(`pilha com ${fmt(triangulosPilha)} triângulos, acima do orçamento de ${fmt(LOOK.orcamentoTriangulos)}: simplifique mais o laminas.json`);

  // luz quente de cima-esquerda com sombra suave; frustum justo à peça e à sombra dela na mesa
  const luz = new THREE.DirectionalLight(LOOK.luzCor, LOOK.luzForca);
  const el = LOOK.luzElevacaoGraus * Math.PI / 180, az = LOOK.luzAzimuteGraus * Math.PI / 180;
  const dirLuz = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const centro = new THREE.Vector3(0, alturaPilha / 2, 0);
  luz.position.copy(centro).addScaledVector(dirLuz, 2 * Math.max(L, A));
  luz.target.position.copy(centro);
  luz.castShadow = true;
  luz.shadow.mapSize.set(LOOK.sombraMapa, LOOK.sombraMapa);
  luz.shadow.bias = LOOK.sombraBias;
  luz.shadow.normalBias = LOOK.sombraNormalBias;
  luz.shadow.radius = LOOK.sombraRaio;
  scene.add(luz, luz.target);
  {
    const alturaMax = alturaPilha + LOOK.levantarMm + LOOK.placa.espessura;
    const cantos = [];
    for (const x of [-L / 2 - M, L / 2 + M]) for (const z of [-A / 2 - M, A / 2 + M]) for (const y of [0, alturaMax]) cantos.push(new THREE.Vector3(x, y, z));
    // onde a sombra do topo cai na mesa (raio paralelo à luz até y = 0)
    for (const c of cantos.filter((p) => p.y > 0)) cantos.push(c.clone().addScaledVector(dirLuz, -c.y / dirLuz.y));
    const olho = new THREE.Object3D();
    olho.position.copy(luz.position); olho.lookAt(centro); olho.updateMatrixWorld(true);
    const inv = olho.matrixWorld.clone().invert();
    const caixa = new THREE.Box3();
    for (const c of cantos) caixa.expandByPoint(c.applyMatrix4(inv));
    const folga = 0.03 * Math.max(L, A);
    const cam = luz.shadow.camera;
    cam.left = caixa.min.x - folga; cam.right = caixa.max.x + folga;
    cam.bottom = caixa.min.y - folga; cam.top = caixa.max.y + folga;
    cam.near = -caixa.max.z - folga; cam.far = -caixa.min.z + folga;
    cam.updateProjectionMatrix();
  }

  // ---- estado e aplicação
  const estado = { t: 0, levantar: 0, levantarManual: null, material: null, pos: [0, 0, 0], alvo: [0, centro.y, 0], fov: LOOK.fov };
  const alvoVec = new THREE.Vector3();
  let ultimas = { calls: 0, triangles: 0 };
  let controls = null;   // OrbitControls, só fora do modo captura

  function aplicarMaterial(nome) {
    if (!MATERIAIS.includes(nome) || nome === estado.material) return;
    const m = materiaisDe(nome);
    if (meshTerra) meshTerra.material = [m.terraTampo, m.terraParede];
    if (meshMar) { meshMar.material = [m.marTampo, m.marParede]; tintarMar(meshMar.geometry, RAMPAS[nome]); }
    estado.material = nome;
  }
  function aplicarLevantar(v) {
    estado.levantar = Math.min(1, Math.max(0, Number(v) || 0));
    if (!placa) return;
    placa.position.y = estado.levantar * LOOK.levantarMm;
    placa.rotation.z = estado.levantar * LOOK.inclinarGraus * Math.PI / 180;
  }
  function desenhar() {
    renderer.info.reset();
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    ultimas = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }
  function aplicarTempo(t) {
    const a = trilha.amostrar(t);
    estado.t = t; estado.pos = a.pos; estado.alvo = a.alvo; estado.fov = a.fov;
    camera.position.set(a.pos[0], a.pos[1], a.pos[2]);
    alvoVec.set(a.alvo[0], a.alvo[1], a.alvo[2]);
    camera.lookAt(alvoVec);
    if (camera.fov !== a.fov) { camera.fov = a.fov; camera.updateProjectionMatrix(); }
    aplicarLevantar(levantarUrl ?? estado.levantarManual ?? a.levantar);
    if (controls) controls.target.copy(alvoVec);
  }
  const proximoQuadro = () => new Promise((res) => requestAnimationFrame(() => res()));

  function redimensionar() {
    const s = tamanho();
    if (s.w === W && s.h === H) return false;
    W = s.w; H = s.h;
    camera.aspect = W / H; camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
    if (trilhaPadraoUsada) trilha = montarTrilhaPadrao();   // o raio da volta depende da tela
    return true;
  }

  // ---- contrato
  maquete.duration = () => trilha.duracao;
  maquete.setTime = async (t) => {
    aplicarTempo(Number(t) || 0);
    desenhar();
    await proximoQuadro();
  };
  maquete.setMaterial = async (nome) => { aplicarMaterial(nome); desenhar(); await proximoQuadro(); };
  maquete.getState = () => ({
    t: estado.t, levantar: estado.levantar, material: estado.material,
    pos: [camera.position.x, camera.position.y, camera.position.z],
    alvo: controls && controls.enabled ? controls.target.toArray() : estado.alvo.slice(),
  });
  // renderizador WebGL de verdade (AGENTS.md: a captura tem de dizer Metal, nunca SwiftShader)
  const renderizador = (() => {
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch { return null; }
  })();
  maquete.metrics = () => ({
    calls: ultimas.calls, triangles: ultimas.triangles, renderizador,
    dpr, largura: W, altura: H, material: estado.material, laminas: n, triangulos_pilha: triangulosPilha,
    placa: placa ? (placaSimples ? 'simples' : 'transmission') : 'sem', moldura: moldura ? M : 0, trilha_padrao: trilhaPadraoUsada,
  });

  aplicarMaterial(materialInicial);

  // ---- interativo
  let sincronizarUi = () => {};
  if (!CAPTURA) {
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 0.6 * L; controls.maxDistance = 3 * L;
    controls.maxPolarAngle = 80 * Math.PI / 180;
    controls.enabled = false;
    montarUi();
  }

  function montarUi() {
    const ui = $('ui'); ui.hidden = false;
    $('nome').textContent = laminas.nome || slug;
    $('sub').textContent = `${fmt(L, 1)} × ${fmt(A, 1)} mm · ${n} lâminas de ${fmt(E, 1)} mm · passo de ${fmt(laminas.passo_terra_m)} m na terra${temMar ? ` e ${fmt(laminas.passo_mar_m)} m no mar` : ''}`;
    const exTerra = Number(laminas.exagero), exMar = Number(laminas.exagero_mar);
    const exTxt = temMar && Number.isFinite(exMar) && Math.round(exMar) !== Math.round(exTerra)
      ? `relevo ${fmt(exTerra)}x mais alto que o real na terra (${fmt(exMar)}x no mar)`
      : `relevo ${fmt(exTerra)}x mais alto que o real`;
    $('exagero').textContent = `${exTxt}; cada lâmina de ${fmt(E, 1)} mm vale ${fmt(laminas.passo_terra_m)} m na terra${temMar ? ` e ${fmt(laminas.passo_mar_m)} m no mar` : ''}`;
    const pMar = $('mar');
    if (temMar) {
      const pct = laminas.mascara && Number.isFinite(Number(laminas.mascara.pct_medido)) ? Number(laminas.mascara.pct_medido) : null;
      pMar.textContent = pct === null ? 'fundo do mar: fração medida por sonar não informada' : `fundo do mar: ${fmt(pct, 1)} % medido por sonar, o resto é modelo GEBCO`;
      pMar.hidden = false;
    }
    montarCreditos();
    const toque = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    $('dica').textContent = toque ? 'arraste para girar · pince para aproximar' : 'arraste para girar · roda do mouse para aproximar';

    const bGirar = $('girar'), sel = $('material'), sLev = $('levantar'), oLev = $('levantar-val'), bBaixar = $('baixar');
    sel.value = estado.material;
    if (!placa) { sLev.disabled = true; oLev.value = temMar ? 'sem placa' : 'sem mar'; }
    const atualizarUi = () => {
      if (placa) { sLev.value = String(estado.levantar); oLev.value = `${fmt(estado.levantar * LOOK.levantarMm)} mm`; }
    };
    sincronizarUi = atualizarUi;

    // laço de amortecimento da órbita: só enquanto o usuário mexe (nada de RAF eterno)
    let lacoOrbita = false, paradosOrbita = 0;
    const orbitar = () => {
      if (!lacoOrbita) return;
      if (controls.update()) { paradosOrbita = 0; desenhar(); } else paradosOrbita++;
      if (paradosOrbita > 30) { lacoOrbita = false; return; }
      requestAnimationFrame(orbitar);
    };
    const acordarOrbita = () => { paradosOrbita = 0; if (!lacoOrbita) { lacoOrbita = true; requestAnimationFrame(orbitar); } };
    controls.addEventListener('start', acordarOrbita);
    controls.addEventListener('change', acordarOrbita);

    // "Girar": avança t de fora da cena (relógio do navegador só aqui, nunca no quadro)
    let girando = false, ultimoTs = null;
    const laco = (ts) => {
      if (!girando) return;
      if (ultimoTs !== null) {
        const dt = Math.min(0.1, (ts - ultimoTs) / 1000);
        const d = trilha.duracao;
        aplicarTempo(((estado.t + dt) % d + d) % d); desenhar(); atualizarUi();
      }
      ultimoTs = ts;
      requestAnimationFrame(laco);
    };
    const girar = () => {
      girando = true; ultimoTs = null; estado.levantarManual = null;
      controls.enabled = false; lacoOrbita = false;
      bGirar.textContent = 'Parar'; bGirar.setAttribute('aria-pressed', 'true');
      requestAnimationFrame(laco);
    };
    const parar = () => {
      girando = false;
      bGirar.textContent = 'Girar'; bGirar.setAttribute('aria-pressed', 'false');
      controls.target.copy(alvoVec); controls.enabled = true; controls.update();
    };
    bGirar.addEventListener('click', () => (girando ? parar() : girar()));
    canvas.addEventListener('pointerdown', () => { if (girando) parar(); $('dica').classList.add('off'); }, { passive: true });
    sel.addEventListener('change', () => { aplicarMaterial(sel.value); desenhar(); });
    sLev.addEventListener('input', () => { estado.levantarManual = Number(sLev.value); aplicarLevantar(estado.levantarManual); desenhar(); atualizarUi(); });
    bBaixar.addEventListener('click', () => baixarSvgs(bBaixar));
    window.addEventListener('resize', () => { if (redimensionar()) { if (!controls.enabled) aplicarTempo(estado.t); desenhar(); } });
    controls.enabled = true;
    atualizarUi();
    setTimeout(() => $('dica').classList.add('off'), 9000);
  }

  // créditos: nós do DOM (os textos vêm do laminas.json; nada de HTML por string)
  function montarCreditos() {
    const texto = (s) => document.createTextNode(s);
    const link = (href, rotulo) => { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = rotulo; return a; };
    const fontes = Array.isArray(laminas.fontes) ? laminas.fontes : [];
    const ids = fontes.map((f) => String(f.id || ''));
    const temCop = ids.some((id) => id.startsWith('copernicus'));
    const temGmrt = ids.some((id) => id.startsWith('gmrt'));
    const outras = fontes.filter((f) => { const id = String(f.id || ''); return !id.startsWith('copernicus') && !id.startsWith('gmrt'); });
    const creditos = $('creditos');
    creditos.textContent = '';
    const detalhes = document.createElement('details');
    const resumo = document.createElement('summary');
    resumo.append(texto('Relevo: '));
    const partes = [];
    if (temCop) partes.push([link('https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM', 'Copernicus DEM GLO-30'), ' (ESA/Airbus)']);
    if (temGmrt) partes.push([link('https://www.gmrt.org/', 'GMRT'), ' (Ryan et al. 2009), CC BY 4.0']);
    for (const f of outras) partes.push([texto(String(f.id)), f.licenca ? `, ${String(f.licenca)}` : '']);
    if (!partes.length) partes.push([texto('fonte não declarada'), '']);
    partes.forEach(([no, resto], i) => { if (i) resumo.append(texto(' · ')); resumo.append(no); resumo.append(texto(resto)); });
    resumo.append(texto(' · Estúdio, compensado e mesa: '));
    resumo.append(link('https://polyhaven.com/', 'Poly Haven'));
    resumo.append(texto(', CC0 · Contornos: '));
    resumo.append(link('https://d3js.org/d3-contour', 'd3-contour'));
    resumo.append(texto(', ISC · 3D: '));
    resumo.append(link('https://threejs.org/', 'three.js'));
    resumo.append(texto(', MIT · Código: MIT · Victor Sodré · '));
    resumo.append(link('https://x.com/ovictor', '@ovictor'));
    resumo.append(texto(' · '));
    const mais = document.createElement('span'); mais.className = 'mais'; mais.textContent = 'fontes e licenças';
    resumo.append(mais);
    detalhes.append(resumo);
    const cheias = document.createElement('div');
    cheias.className = 'fontes';
    for (const f of fontes) {
      if (!f.atribuicao) continue;
      const p = document.createElement('p');
      p.textContent = `${f.id}: ${f.atribuicao}${f.licenca ? ` (${f.licenca})` : ''}`;
      cheias.append(p);
    }
    for (const s of [
      'Poly Haven: HDRI "brown_photostudio_02", texturas "plywood" e "wood_table_001", todos CC0 (polyhaven.com).',
      'd3-contour, d3-array e internmap: ISC (Mike Bostock). three.js r185: MIT.',
    ]) { const p = document.createElement('p'); p.textContent = s; cheias.append(p); }
    detalhes.append(cheias);
    creditos.append(detalhes);
  }

  // "Baixar SVGs": um arquivo por lâmina + folha-chave, gerados no navegador pelo mesmo módulo da CLI.
  // Escolha: um download por lâmina (o SVG de cada lâmina sai em mm de verdade, igual ao da CLI; sem
  // transform nem página composta). O navegador pede uma vez a permissão para vários downloads.
  async function baixarSvgs(botao) {
    if (botao.disabled) return;
    botao.disabled = true;
    const rotulo = botao.textContent;
    try {
      const mod = await import('../cli/svg-lamina.mjs');
      if (typeof mod.svgDaLamina !== 'function' || typeof mod.svgFolhaChave !== 'function') throw new Error('módulo sem svgDaLamina/svgFolhaChave');
      const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
      const baixar = (nome, texto) => {
        const blob = new Blob([texto], { type: 'image/svg+xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = nome;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      };
      const total = n + 1;
      for (let k = 0; k < n; k++) {
        botao.textContent = `baixando ${k + 1} de ${total}…`;
        baixar(`${slug}-lamina-${String(k).padStart(2, '0')}.svg`, mod.svgDaLamina(laminas, k, { numerar: true }));
        await dormir(300);
      }
      botao.textContent = `baixando ${total} de ${total}…`;
      baixar(`${slug}-folha-chave.svg`, mod.svgFolhaChave(laminas, {}));
      botao.textContent = rotulo;
      botao.disabled = false;
    } catch (e) {
      console.warn(`SVG indisponível no navegador (${e?.message || e}); gere pela CLI: node cli/svg.mjs ${slug}`);
      botao.textContent = 'SVG só pela CLI';
      botao.title = `Este build não tem cli/svg-lamina.mjs acessível pela página. No terminal: node cli/svg.mjs ${slug}`;
    }
  }

  // primeiro quadro (e a UI sincronizada com ele: um deep link ?t=5 mostra a cena em 5 s com o slider certo)
  aplicarTempo(tInicial);
  desenhar();
  sincronizarUi();
  await proximoQuadro();
  const info = {
    slug, laminas: n, triangulos_pilha: triangulosPilha, placa: maquete.metrics().placa, moldura: moldura ? M : 0, material: estado.material,
    trilha_padrao: trilhaPadraoUsada, renderizador, calls: ultimas.calls, triangles: ultimas.triangles, mm: [L, A, E],
  };
  console.log('maquete pronta', JSON.stringify(info));
  return info;
}

iniciar().then(resolveReady).catch((e) => { avisar(`Não deu para montar a cena: ${e?.message || e}`); rejectReady(e); });

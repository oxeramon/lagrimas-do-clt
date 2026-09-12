/* Hook PostToolUse: confere o grafo de módulos de `js/` e os imports do
 * index.html.
 *
 * Por que existe: o `checa-sintaxe.mjs` roda `node --check`, que só olha
 * SINTAXE. Um identificador que ficou sem import passa por ele sem um pio e
 * só explode quando a tela renderiza -- foi o que aconteceu na extração, com
 * um nome que existia antes no escopo único e deixou de existir. Em módulo,
 * cada referência precisa de um endereço.
 *
 * Confere quatro coisas:
 *   1. todo módulo compila;
 *   2. todo `import` aponta para um arquivo que existe, com o caminho exato --
 *      o GitHub Pages roda em Linux e diferencia maiúscula de minúscula;
 *   3. todo nome importado é realmente exportado pelo módulo de origem;
 *   4. o grafo não tem ciclo.
 *
 * Silencioso quando passa. */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const entrada = JSON.parse(readFileSync(0, "utf8"));
const arquivo = entrada.tool_response?.filePath ?? entrada.tool_input?.file_path ?? "";
const rel = arquivo ? relative(RAIZ, resolve(arquivo)) : "";
/* só interessa quando mexeram no HTML ou em algum módulo */
if (!rel || (basename(rel) !== "index.html" && !rel.startsWith("js/"))) process.exit(0);

const bloqueia = (motivo) => {
  process.stdout.write(JSON.stringify({ decision: "block", reason: motivo }));
  process.exit(0);
};

const problemas = [];
const RE_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["'];?\s*$/gm;
const RE_EXPORT = /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

/* ---- 1. os módulos compilam ------------------------------------------- */
function todosOsModulos(dir = join(RAIZ, "js"), fora = []) {
  if (!existsSync(dir)) return fora;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) todosOsModulos(p, fora);
    else if (e.name.endsWith(".js")) fora.push(relative(RAIZ, p));
  }
  return fora;
}
const modulos = todosOsModulos();
for (const m of modulos) {
  try { execFileSync(process.execPath, ["--check", join(RAIZ, m)], { stdio: "pipe" }); }
  catch (e) {
    problemas.push(m + " não compila:\n" + ((e.stderr?.toString() || "").trim().split("\n").slice(0, 4).join("\n")));
  }
}

/* ---- 2, 3 e 4: o grafo ------------------------------------------------- */
const fonteDe = new Map();
const leitura = (relArq) => {
  if (fonteDe.has(relArq)) return fonteDe.get(relArq);
  let txt = "";
  try { txt = readFileSync(join(RAIZ, relArq), "utf8"); } catch { txt = null; }
  fonteDe.set(relArq, txt);
  return txt;
};

/* lista real do diretório, para pegar diferença de maiúscula que o Linux
   diferencia e o macOS não */
const existeExato = (relArq) => {
  const dir = join(RAIZ, dirname(relArq));
  if (!existsSync(dir)) return false;
  return readdirSync(dir).includes(basename(relArq));
};

const exportadosPor = (relArq) => {
  const txt = leitura(relArq);
  if (txt == null) return null;
  return new Set([...txt.matchAll(RE_EXPORT)].map((m) => m[1]));
};

const arestas = new Map();
function confereImports(relArq, fonte) {
  const base = dirname(relArq);
  const saidas = [];
  for (const m of fonte.matchAll(RE_IMPORT)) {
    const nomes = m[1].split(",").map((x) => x.trim()).filter(Boolean)
      .map((x) => x.split(/\s+as\s+/)[0].trim());
    const alvo = relative(RAIZ, resolve(join(RAIZ, base), m[2]));
    saidas.push(alvo);
    if (!existeExato(alvo)) {
      problemas.push(relArq + ": importa \"" + m[2] + "\", que não existe como "
        + alvo + ". O Pages roda em Linux e diferencia maiúscula de minúscula.");
      continue;
    }
    const exportados = exportadosPor(alvo);
    for (const n of nomes) {
      if (exportados && !exportados.has(n))
        problemas.push(relArq + ": importa `" + n + "` de " + alvo
          + ", mas esse módulo não exporta esse nome.");
    }
  }
  arestas.set(relArq, saidas);
}

for (const m of modulos) {
  const txt = leitura(m);
  if (txt != null) confereImports(m, txt);
}

const html = leitura("index.html");
if (html != null) {
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (script) confereImports("index.html", script[1]);
}

/* ciclo: em módulo ES não é erro fatal, mas aqui é sintoma de camada
   invertida -- domínio importando UI, por exemplo */
const estado = new Map();
function ciclo(no, caminho = []) {
  if (estado.get(no) === "pronto") return;
  if (estado.get(no) === "andando") {
    problemas.push("ciclo de import: " + [...caminho, no].join(" → ")
      + ". Em geral significa camada invertida: confira o mapa de dependências "
      + "em docs/ARCHITECTURE_V2.md.");
    return;
  }
  estado.set(no, "andando");
  for (const viz of arestas.get(no) || []) ciclo(viz, [...caminho, no]);
  estado.set(no, "pronto");
}
for (const n of arestas.keys()) ciclo(n);

if (problemas.length) {
  bloqueia("O grafo de módulos quebrou:\n\n" + problemas.map((p) => "• " + p).join("\n\n"));
}

/* Constrói o artefato público -- o que o GitHub Pages vai servir.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Até agora o Pages publicava a árvore inteira do repositório: `CLAUDE.md`,
 * `docs/`, `supabase/` com todas as migrações, `testes/`, `.claude/`, os hooks.
 * Nada disso é segredo -- o repositório é público --, mas nada disso precisa
 * estar num servidor web, e cada arquivo publicado é uma linha a mais no mapa
 * que alguém pode ler sem nem clonar.
 *
 * POR QUE WHITELIST, E NÃO EXCLUSÃO
 *
 * `cp -r . _site` seguido de uma lista de `rm` é o desenho errado, e o motivo
 * é o tempo: o arquivo interno que alguém criar daqui a seis meses entra no ar
 * sozinho, porque ninguém vai lembrar de acrescentá-lo à lista de exclusão.
 * A falha da exclusão é silenciosa e o padrão dela é publicar.
 *
 * Com whitelist é o contrário: o que não foi explicitamente permitido fica de
 * fora, e a falha -- se houver -- é um arquivo faltando, que aparece na hora
 * como 404 no teste de dependência.
 *
 * A LISTA NÃO É A ÚNICA GUARDA
 *
 * `js/` inteiro entrar pela pasta ainda deixaria passar um `js/rascunho.md`.
 * Por isso `testes/artefato.mjs` confere, além da lista, que TODO arquivo do
 * artefato é alcançável a partir do `index.html` -- é o grafo de dependência
 * real que manda, e a lista só diz onde procurar.
 *
 * Sem dependência de npm, como o resto do projeto.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/* O QUE VAI AO AR. Nada além disto.
 *
 * `extensoes` fecha a porta que a pasta deixaria aberta: um `.md` dentro de
 * `js/` não é código de tela e não sobe. */
export const PERMITIDOS = [
  { caminho: "index.html", tipo: "arquivo" },
  { caminho: "css",        tipo: "pasta", extensoes: [".css"] },
  { caminho: "js",         tipo: "pasta", extensoes: [".js"] },
];

/* O que NUNCA pode aparecer no artefato. Isto é uma rede de segurança, e não a
   regra: a regra é a whitelist acima. Existe para o teste falhar com uma
   mensagem clara em vez de um path solto. */
export const PROIBIDOS = [
  ".claude", ".githooks", ".github", ".git", ".mcp.json", ".gitignore",
  "docs", "supabase", "testes", "ferramentas",
  "CLAUDE.md", "README.md", "supabase-setup.sql", "preview.html",
];

/* Extensões que não têm o que fazer num servidor de site estático. */
export const EXTENSOES_PROIBIDAS = [".sql", ".md", ".mjs", ".json", ".yml", ".yaml", ".csv"];

const listaArquivos = (base, prefixo = "") => {
  const fora = [];
  for (const nome of readdirSync(base)) {
    const abs = join(base, nome);
    const rel = prefixo ? prefixo + "/" + nome : nome;
    if (statSync(abs).isDirectory()) fora.push(...listaArquivos(abs, rel));
    else fora.push(rel);
  }
  return fora;
};

/* O que a whitelist manda publicar, resolvido em caminhos concretos. */
export function caminhosPermitidos(raiz = RAIZ) {
  const fora = [];
  for (const item of PERMITIDOS) {
    const abs = join(raiz, item.caminho);
    if (!existsSync(abs)) throw new Error("a whitelist aponta para algo que não existe: " + item.caminho);
    if (item.tipo === "arquivo") { fora.push(item.caminho); continue; }
    for (const rel of listaArquivos(abs, item.caminho)) {
      if (item.extensoes && !item.extensoes.some((e) => rel.endsWith(e))) continue;
      fora.push(rel);
    }
  }
  return fora.sort();
}

/* --------------------------------------------------------- construção --
   Do zero a cada execução. Reaproveitar um `_site` anterior traria de volta o
   arquivo que acabou de sair da whitelist, e ninguém repararia. */
export function constroi(destino = join(RAIZ, "_site"), raiz = RAIZ) {
  rmSync(destino, { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });

  const arquivos = caminhosPermitidos(raiz);
  for (const rel of arquivos) {
    const alvo = join(destino, rel);
    mkdirSync(dirname(alvo), { recursive: true });
    cpSync(join(raiz, rel), alvo);
  }
  return arquivos;
}

/* Tudo o que existe dentro do artefato, para o teste conferir. */
export const conteudoDo = (destino) =>
  existsSync(destino) ? listaArquivos(destino).map((p) => p.split(sep).join("/")).sort() : [];

/* -------------------------------------------- o grafo de dependência --
   A prova de que a whitelist não é um chute: todo módulo alcançável a partir
   do `index.html`, e todo CSS que ele carrega.

   Referência que começa com "http" é externa (o CDN do supabase-js, as fontes
   do Google) e não entra no artefato -- por definição, ela mora fora. */
const REFERENCIA = /from\s+"([^"]+)"|import\s*\(\s*"([^"]+)"/g;
const CSS_NO_HTML = /<link[^>]+href="(\.\/[^"]+\.css)"/g;

const normaliza = (p) => {
  const partes = [];
  for (const parte of p.split("/")) {
    if (parte === "." || parte === "") continue;
    if (parte === "..") partes.pop();
    else partes.push(parte);
  }
  return partes.join("/");
};

export function dependenciasDoSite(raiz = RAIZ) {
  const html = readFileSync(join(raiz, "index.html"), "utf8");
  const alcancados = new Set(["index.html"]);
  const externos = new Set();
  const faltando = [];

  for (const m of html.matchAll(CSS_NO_HTML)) alcancados.add(normaliza(m[1]));

  const fila = [];
  const referencias = (texto, base) => {
    for (const m of texto.matchAll(REFERENCIA)) {
      const alvo = m[1] || m[2];
      if (/^https?:/.test(alvo)) { externos.add(alvo); continue; }
      if (!alvo.startsWith(".")) { externos.add(alvo); continue; }
      fila.push(normaliza(base ? base + "/" + alvo : alvo));
    }
  };
  referencias(html, "");

  while (fila.length) {
    const rel = fila.shift();
    if (alcancados.has(rel)) continue;
    alcancados.add(rel);
    const abs = join(raiz, rel);
    if (!existsSync(abs)) { faltando.push(rel); continue; }
    referencias(readFileSync(abs, "utf8"), rel.split("/").slice(0, -1).join("/"));
  }

  return { alcancados: [...alcancados].sort(), externos: [...externos].sort(), faltando };
}

/* ------------------------------------------------------------- CLI --*/
if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === "") {
  const destino = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(RAIZ, "_site");
  const arquivos = constroi(destino);
  const bytes = arquivos.reduce((s, r) => s + statSync(join(destino, r)).size, 0);
  console.log("artefato em " + relative(process.cwd(), destino) + ": "
    + arquivos.length + " arquivo(s), " + (bytes / 1024).toFixed(1) + " KiB");
}

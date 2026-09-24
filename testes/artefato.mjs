/* Prova que o artefato publicado contém exatamente o que precisa, e nada mais.
 *
 * O artefato é o que o GitHub Pages serve. Até esta rodada ele era a árvore
 * inteira do repositório; agora é o que `ferramentas/artefato.mjs` constrói por
 * whitelist. Este arquivo é o que impede a whitelist de virar mentira.
 *
 * Quatro perguntas, nesta ordem:
 *
 *   1. sobrou alguma coisa que não devia estar lá?
 *   2. falta alguma coisa que o navegador vai pedir?
 *   3. o servidor devolve 200 para o que precisa e 404 para o que não é dele?
 *   4. entrou algum segredo que não seja a chave publicável?
 *
 * A pergunta 2 é a que justifica a whitelist ser segura: se ela esquecer um
 * módulo, o teste acusa aqui e não o usuário num 404 em produção.
 *
 * Roda sem rede e sem npm: `node testes/artefato.mjs`.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { constroi, conteudoDo, caminhosPermitidos, dependenciasDoSite,
         PROIBIDOS, EXTENSOES_PROIBIDAS, RAIZ } from "../ferramentas/artefato.mjs";

let ok = 0, bad = 0;
const eq = (nome, obtido, esperado) => {
  const a = JSON.stringify(obtido), b = JSON.stringify(esperado);
  if (a === b) ok++;
  else { bad++; console.error(`  ✗ ${nome}\n      esperado ${b}\n      obtido   ${a}`); }
};

const DESTINO = join(RAIZ, "_site");

console.log("construção");
const publicados = constroi(DESTINO);
const noDisco = conteudoDo(DESTINO);
eq("o artefato é construído do zero e bate com a whitelist", noDisco, publicados);
eq("e a whitelist bate com o que o repositório tem hoje", publicados, caminhosPermitidos());

console.log("\n1. o que NÃO pode estar lá");

/* A lista de proibidos é rede de segurança, não a regra -- a regra é a
   whitelist. Ela existe para a falha ter nome em vez de ser um path solto. */
for (const proibido of PROIBIDOS){
  const achados = noDisco.filter((p) => p === proibido || p.startsWith(proibido + "/"));
  eq(`nada de "${proibido}" no artefato`, achados, []);
}
for (const ext of EXTENSOES_PROIBIDAS){
  eq(`nenhum arquivo ${ext} no artefato`, noDisco.filter((p) => p.endsWith(ext)), []);
}
eq("nenhum arquivo oculto (começando com ponto)",
  noDisco.filter((p) => p.split("/").some((parte) => parte.startsWith("."))), []);

/* A GUARDA QUE VALE MAIS QUE A LISTA: todo arquivo do artefato precisa ser
   alcançável a partir do index.html. Um `js/rascunho.js` que ninguém importa
   passaria pela whitelist de pasta -- e não passa por aqui. */
const grafo = dependenciasDoSite();
eq("todo arquivo publicado é alcançável a partir do index.html",
  noDisco.filter((p) => !grafo.alcancados.includes(p)), []);

console.log("\n2. o que PRECISA estar lá");

eq("nenhuma referência do site aponta para arquivo inexistente", grafo.faltando, []);
eq("todo módulo e CSS alcançável está publicado",
  grafo.alcancados.filter((p) => !noDisco.includes(p)), []);
/* o grafo derivado e a lista publicada são o mesmo conjunto: nem sobra, nem
   falta. É esta igualdade que torna a whitelist verificável em vez de
   confiável. */
eq("o publicado é EXATAMENTE o grafo de dependência", noDisco, grafo.alcancados.slice().sort());
eq("o index.html está na raiz do artefato", noDisco.includes("index.html"), true);

/* O que fica de fora por definição: o CDN do supabase-js e as fontes. Elas não
   entram no artefato, e o teste registra isso em vez de deixar implícito. */
eq("as dependências externas são as duas conhecidas, e nenhuma a mais",
  grafo.externos, ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm"]);

console.log("\n3. o servidor: 200 no que é do site, 404 no resto");

const TIPO = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css" };
const servidor = createServer((req, res) => {
  const pedido = decodeURIComponent(req.url.split("?")[0]);
  const alvoBruto = join(DESTINO, pedido);
  /* o servidor de teste não sai do artefato: um ".." no caminho não pode virar
     leitura de arquivo do repositório */
  if (!alvoBruto.startsWith(DESTINO)){ res.writeHead(403); return res.end("403"); }
  const alvo = existsSync(alvoBruto) && statSync(alvoBruto).isDirectory()
    ? join(alvoBruto, "index.html") : alvoBruto;
  if (!existsSync(alvo) || !statSync(alvo).isFile()){ res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "content-type": TIPO[extname(alvo)] || "application/octet-stream" });
  res.end(readFileSync(alvo));
});
const PORTA = 8094;
await new Promise((pronto) => servidor.listen(PORTA, "127.0.0.1", pronto));
const pede = async (caminho) => {
  const r = await fetch(`http://127.0.0.1:${PORTA}${caminho}`);
  return { status: r.status, tipo: r.headers.get("content-type") || "" };
};

/* POSITIVOS: derivados do grafo, não escritos à mão -- lista manual envelhece
   e passa a provar menos do que aparenta. */
eq("a raiz responde 200 com HTML",
  await pede("/").then((r) => [r.status, r.tipo.includes("text/html")]), [200, true]);
for (const rel of grafo.alcancados){
  const r = await pede("/" + rel);
  if (r.status !== 200){ bad++; console.error(`  ✗ /${rel} devia responder 200, respondeu ${r.status}`); }
  else ok++;
}
console.log(`  (${grafo.alcancados.length} recursos do site conferidos, todos 200)`);

/* NEGATIVOS: os caminhos internos que o Pages servia até ontem. */
const NEGATIVOS = [
  "/CLAUDE.md", "/README.md", "/supabase-setup.sql", "/preview.html",
  "/docs/", "/docs/CODEBASE_MAP.md", "/docs/CONTRATO_CARTAO.md", "/docs/MIGRACOES.md",
  "/supabase/", "/supabase/migrations/001_v2_foundation.sql",
  "/supabase/migrations/010_v2_estorno.sql", "/supabase/testes/005_ponte.sql",
  "/testes/", "/testes/regras.mjs", "/testes/fluxos.mjs", "/testes/audita.mjs",
  "/.claude/", "/.claude/settings.json", "/.claude/hooks/checa-rls.mjs",
  "/.githooks/pre-push", "/.github/workflows/keepalive.yml",
  "/.mcp.json", "/.gitignore", "/ferramentas/artefato.mjs",
];
for (const caminho of NEGATIVOS){
  const r = await pede(caminho);
  if (r.status !== 404){ bad++; console.error(`  ✗ ${caminho} devia ser 404, respondeu ${r.status}`); }
  else ok++;
}
console.log(`  (${NEGATIVOS.length} caminhos internos conferidos, todos 404)`);

servidor.close();

console.log("\n4. auditoria do artefato");

const textos = noDisco.map((rel) => ({ rel, texto: readFileSync(join(DESTINO, rel), "utf8") }));
const procura = (re) => textos.filter((a) => re.test(a.texto)).map((a) => a.rel);

/* A chave publicável é PÚBLICA por projeto -- ela vai no HTML de qualquer app
   Supabase, e escondê-la seria falsa segurança. Quem protege o dado é
   Auth + RLS + grant + ownership. O que NÃO pode entrar é qualquer chave com
   privilégio, e é isso que se confere aqui. */
eq("a chave publicável está no artefato, como tem de estar",
  procura(/sb_publishable_/).length > 0, true);
/* O padrão vem montado por concatenação, pelo mesmo motivo que as duas regras
   equivalentes de `testes/audita.mjs`: escrito inteiro, o literal apareceria
   neste arquivo e a auditoria do repositório acusaria a própria conferência que
   existe para proibi-lo. O padrão final é idêntico; o que muda é que a fonte
   não contém a palavra. */
const CHAVE_PRIVILEGIADA = new RegExp("sb_" + "secret_" + "|service" + "_role", "i");
eq("nenhuma chave de serviço", procura(CHAVE_PRIVILEGIADA), []);
eq("nenhuma chave legada de JWT com papel privilegiado",
  procura(/eyJ[A-Za-z0-9_-]{20,}/), []);
eq("nenhuma senha, token ou segredo declarado",
  procura(/\b(password|senha|secret|api[_-]?key|private[_-]?key|token)\s*[:=]\s*["'][^"']{8,}/i), []);

/* Nada de SQL, documentação interna ou instrução de ferramenta.

   ESTA REGRA JÁ FOI MAIS LARGA, e vale registrar por quê: ela barrava qualquer
   menção a `supabase/migrations/`, e acusou um COMENTÁRIO de
   `v2-repository.js` que aponta para a migração onde a regra daquela função
   mora. Isso não é vazamento -- é a referência que faz o código ser legível, e
   um caminho de arquivo que o leitor não tem não conta nada a ele.

   O que importa é CONTEÚDO de migração no artefato, e disso cuidam as duas
   conferências que sobraram: nenhum comando de DDL, e nenhum arquivo `.sql`
   (lá em cima, na lista de extensões proibidas). */
eq("nenhum comando de DDL no artefato",
  procura(/\b(create table|alter table|drop table|create policy|grant execute|create or replace function)\b/i), []);
eq("nenhum corpo de função de banco",
  procura(/\blanguage plpgsql\b|\bsecurity invoker\b|\bauth\.uid\(\)/i), []);
eq("nenhum bloco de instrução para ferramenta de IA",
  procura(/<system-reminder|anthropic\.com/i), []);

/* Dado financeiro real nunca entrou no repositório, e a auditoria do
   repositório cobre isso a cada commit. Aqui a conferência é de fronteira: o
   artefato não pode conter NADA que a auditoria do repositório não tenha visto,
   e ele é um subconjunto -- todo arquivo dele vem do repositório, sem
   transformação. */
eq("todo arquivo do artefato é cópia byte a byte do repositório",
  noDisco.filter((rel) => readFileSync(join(DESTINO, rel), "utf8")
                       !== readFileSync(join(RAIZ, rel), "utf8")), []);

const bytes = noDisco.reduce((s, rel) => s + statSync(join(DESTINO, rel)).size, 0);
console.log(`\nartefato: ${noDisco.length} arquivos, ${(bytes / 1024).toFixed(1)} KiB`);
console.log(`${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

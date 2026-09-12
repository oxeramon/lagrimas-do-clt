/* Hook PostToolUse: valida o index.html depois de cada edição.

   Por que existe: não há build, bundler nem type-check neste projeto. Um erro
   de sintaxe no <script type="module"> não aparece em lugar nenhum até a
   página abrir em branco — possivelmente só depois de já estar no ar.

   Silencioso quando passa. Bloqueia com o erro do node quando não passa. */
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";

const entrada = JSON.parse(readFileSync(0, "utf8"));
const arquivo = entrada.tool_response?.filePath ?? entrada.tool_input?.file_path ?? "";
if (basename(arquivo) !== "index.html") process.exit(0);

const bloqueia = (motivo) => {
  process.stdout.write(JSON.stringify({ decision: "block", reason: motivo }));
  process.exit(0);
};

let html;
try {
  html = readFileSync(arquivo, "utf8").replaceAll("\r\n", "\n");
} catch {
  process.exit(0); // arquivo sumiu entre a edição e o hook; não é problema nosso
}

const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) bloqueia("index.html ficou sem o bloco <script type=\"module\">. A tag de abertura ou de fechamento foi perdida na edição.");

/* O JS não vive mais só aqui: núcleo e domínio saíram para js/. Um $("id")
   pode aparecer em qualquer módulo, e a conferência de id precisa olhar
   todos -- senão ela passa a cobrir só metade do código.

   Cada arquivo é conferido SOZINHO. Concatenar não serve: o index.html importa
   `MESES_PT` e o dates.js exporta `MESES_PT`, então o texto emendado tem o
   mesmo nome ligado duas vezes e o parser recusa um arquivo que, separado,
   está perfeito. */
const modulos = [];
(function varre(dir){
  let itens = [];
  try { itens = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of itens){
    const p = join(dir, e.name);
    if (e.isDirectory()) varre(p);
    else if (e.name.endsWith(".js"))
      { try { modulos.push([p, readFileSync(p, "utf8")]); } catch {} }
  }
})(join(dirname(arquivo), "js"));

const js = m[1];

/* 1. a sintaxe precisa passar no parser de verdade */
const dir = mkdtempSync(join(tmpdir(), "lagrimas-"));
const confere = (fonte, rotulo) => {
  const tmp = join(dir, "app.mjs");
  writeFileSync(tmp, fonte, "utf8");
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } catch (e) {
    const saida = (e.stderr?.toString() || e.stdout?.toString() || String(e))
      .replaceAll(tmp, rotulo);
    bloqueia(rotulo + " não compila. A página abriria em branco.\n\n" + saida.trim());
  }
};
confere(js, "index.html (bloco <script type=\"module\">)");
for (const [caminho, fonte] of modulos) confere(fonte, basename(dirname(caminho)) + "/" + basename(caminho));

/* 2. todo $("id") precisa existir no HTML, senão vira null em tempo de execução */
const tudoQueUsaDolar = js + "\n" + modulos.map(([, f]) => f).join("\n");
const idsJs = new Set([...tudoQueUsaDolar.matchAll(/\$\("([A-Za-z0-9_]+)"\)/g)].map((x) => x[1]));
const idsHtml = new Set([...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((x) => x[1]));
const faltando = [...idsJs].filter((id) => !idsHtml.has(id)).sort();
if (faltando.length) {
  bloqueia(
    "O JavaScript referencia elementos que não existem no HTML, então $(...) devolve null e a tela quebra ao renderizar:\n\n"
    + faltando.map((id) => "  $(\"" + id + "\")").join("\n")
    + "\n\nAdicione os elementos com esses id, ou corrija os nomes no script.",
  );
}

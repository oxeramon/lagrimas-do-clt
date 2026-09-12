/* Hook PostToolUse: valida o index.html depois de cada edição.

   Por que existe: não há build, bundler nem type-check neste projeto. Um erro
   de sintaxe no <script type="module"> não aparece em lugar nenhum até a
   página abrir em branco — possivelmente só depois de já estar no ar.

   Silencioso quando passa. Bloqueia com o erro do node quando não passa. */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

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
if (!m) bloqueia("index.html ficou sem o bloco <script type=\"module\">. O site inteiro vive nesse bloco — provavelmente a tag de abertura ou de fechamento foi perdida na edição.");

const js = m[1];

/* 1. a sintaxe precisa passar no parser de verdade */
const tmp = join(mkdtempSync(join(tmpdir(), "quitacao-")), "app.mjs");
writeFileSync(tmp, js, "utf8");
try {
  execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
} catch (e) {
  const saida = (e.stderr?.toString() || e.stdout?.toString() || String(e))
    .replaceAll(tmp, "index.html (bloco <script type=\"module\">)");
  bloqueia("O JavaScript do index.html não compila. A página abriria em branco.\n\n" + saida.trim());
}

/* 2. todo $("id") precisa existir no HTML, senão vira null em tempo de execução */
const idsJs = new Set([...js.matchAll(/\$\("([A-Za-z0-9_]+)"\)/g)].map((x) => x[1]));
const idsHtml = new Set([...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((x) => x[1]));
const faltando = [...idsJs].filter((id) => !idsHtml.has(id)).sort();
if (faltando.length) {
  bloqueia(
    "O JavaScript referencia elementos que não existem no HTML, então $(...) devolve null e a tela quebra ao renderizar:\n\n"
    + faltando.map((id) => "  $(\"" + id + "\")").join("\n")
    + "\n\nAdicione os elementos com esses id, ou corrija os nomes no script.",
  );
}

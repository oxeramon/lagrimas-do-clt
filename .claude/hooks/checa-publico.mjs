/* Hook PostToolUse: barra dado privado antes que ele encoste no repositório.
 *
 * Por que existe: este repositório é público, e a regra do projeto é
 * preventiva -- dado real não entra no arquivo versionado, nem temporariamente.
 * Sanitizar depois já custou caro uma vez: resíduo passa despercebido, e o que
 * foi publicado fica no histórico.
 *
 * O hook roda a auditoria (`testes/audita.mjs`) sobre o arquivo que acabou de
 * ser escrito. Ocorrência CRÍTICA bloqueia a edição; aviso passa e aparece.
 *
 * O cruzamento com valores conhecidos da base real é opcional e mora FORA do
 * repositório, em SANITIZATION_BASELINE_PATH. Sem a variável, roda só a parte
 * genérica -- que já cobre token, JWT, CPF, cartão e afins.
 *
 * Silencioso quando passa. */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, relative, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const entrada = JSON.parse(readFileSync(0, "utf8"));
const arquivo = entrada.tool_response?.filePath ?? entrada.tool_input?.file_path ?? "";
if (!arquivo) process.exit(0);

const rel = relative(RAIZ, resolve(arquivo));
/* fora do repositório não é problema nosso: o baseline privado, por exemplo,
   mora fora de propósito e não pode ser tratado como violação */
if (rel.startsWith("..")) process.exit(0);

const bloqueia = (motivo) => {
  process.stdout.write(JSON.stringify({ decision: "block", reason: motivo }));
  process.exit(0);
};

let saida = "";
try {
  saida = execFileSync(process.execPath, [join(RAIZ, "testes", "audita.mjs"), rel],
    { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  /* código 1 = ocorrência crítica; qualquer outro é defeito do próprio script */
  const texto = (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
  if (e.status === 1) {
    bloqueia(
      "A auditoria de repositório público encontrou dado que não pode ser versionado.\n\n"
      + texto.trim()
      + "\n\nEste repositório é público. A regra está em CLAUDE.md e o critério completo em\n"
      + ".claude/skills/public-repo-hygiene/SKILL.md. Não sanitize depois: troque o dado\n"
      + "por um exemplo inventado do zero antes de gravar. Se a classificação estiver\n"
      + "incerta, trate como privado e pergunte.");
  }
  process.stderr.write("checa-publico: a auditoria não rodou (" + (e.message || "erro") + ")\n");
  process.exit(0);
}

/* passou: só imprime se houver aviso, para o aviso não sumir */
if (/^aviso —/m.test(saida)) process.stderr.write(saida);

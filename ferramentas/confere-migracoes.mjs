/* O ARQUIVO DA MIGRAÇÃO BATE COM O QUE RODOU NO BANCO?
 *
 * POR QUE ISTO EXISTE
 *
 * A regra do projeto é que migração aplicada é imutável, comentário incluído:
 * quando o arquivo e o banco discordam, some a única fonte confiável sobre o
 * que de fato rodou.
 *
 * Na rodada da 011/012/013 eu quebrei essa regra sem perceber. Escrevi o
 * arquivo, depois reescrevi a prosa ao mandar por `apply_migration`, e os dois
 * passaram a contar histórias diferentes da mesma mudança. O DDL era o mesmo; o
 * texto que EXPLICA o DDL, não -- e é o texto que alguém vai ler daqui a um ano
 * para entender por que a coluna existe.
 *
 * COMO USAR
 *
 * Este arquivo não fala com o banco: ele não tem credencial e não deve ter. Ele
 * recebe o que o banco respondeu, em JSON, e compara.
 *
 *   1. no SQL Editor (ou por `execute_sql`):
 *        select name, array_to_string(statements, chr(10)) as sql
 *          from supabase_migrations.schema_migrations order by version;
 *   2. salve o resultado como JSON num arquivo;
 *   3. node ferramentas/confere-migracoes.mjs caminho/do/resultado.json
 *
 * Sai com 1 se algum arquivo discordar do banco, ou se houver migração aplicada
 * sem arquivo (ou arquivo sem migração aplicada).
 *
 * A COMPARAÇÃO É POR CONTEÚDO NORMALIZADO, não byte a byte: o `apply_migration`
 * do Supabase guarda os comandos numa lista e descarta o `begin;`/`commit;` que
 * envolvem o arquivo, além de aparar espaço no fim. Comparar cru acusaria
 * diferença em toda migração e o aviso viraria ruído -- que é como um
 * verificador morre.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PASTA = join(RAIZ, "supabase", "migrations");

/* Tira o que o Supabase tira, e nada além:
   - `begin;` e `commit;` de primeiro nível, que o apply_migration não guarda;
   - espaço no fim de cada linha e no fim do arquivo;
   - linhas em branco repetidas.
   NÃO tira comentário: é justamente o comentário que se quer conferir. */
export function normaliza(texto){
  return String(texto)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => !/^(begin|commit)\s*;\s*$/i.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* A conferência só roda quando ESTE arquivo é o programa. Importado, ele
   entrega `normaliza` e mais nada -- é o que permite conferir a normalização
   de fora sem que o import saia do processo no meio. */
const ehOprograma = process.argv[1] && process.argv[1].endsWith("confere-migracoes.mjs");

const caminho = ehOprograma ? process.argv[2] : null;
if (ehOprograma && (!caminho || !existsSync(caminho))){
  console.error("uso: node ferramentas/confere-migracoes.mjs <resultado.json>");
  console.error("     (o JSON com name e sql de supabase_migrations.schema_migrations)");
  process.exit(2);
}

if (!ehOprograma) { /* importado: para por aqui */ }
else confere(caminho);

function confere(caminho){
const doBanco = JSON.parse(readFileSync(caminho, "utf8"));
const noBanco = new Map(doBanco.map((m) => [m.name, normaliza(m.sql)]));

const arquivos = readdirSync(PASTA).filter((n) => n.endsWith(".sql")).sort();
const porNome = new Map(arquivos.map((n) => [n.replace(/\.sql$/, ""), n]));

let problemas = 0;
const acusa = (msg) => { problemas++; console.error("  ✗ " + msg); };

for (const [nome, sql] of noBanco){
  const arq = porNome.get(nome);
  if (!arq){ acusa(`${nome}: rodou no banco e NÃO tem arquivo no repositório`); continue; }
  const local = normaliza(readFileSync(join(PASTA, arq), "utf8"));
  if (local === sql){ console.log("  ok " + nome); continue; }

  acusa(`${nome}: o arquivo discorda do que rodou`);
  /* Mostrar a PRIMEIRA linha divergente vale mais que um diff inteiro: ela
     costuma bastar para reconhecer o que aconteceu. */
  const a = local.split("\n"), b = sql.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++){
    if (a[i] !== b[i]){
      console.error(`      linha ${i + 1}`);
      console.error(`      arquivo: ${a[i] === undefined ? "(acabou)" : a[i].slice(0, 90)}`);
      console.error(`      banco  : ${b[i] === undefined ? "(acabou)" : b[i].slice(0, 90)}`);
      break;
    }
  }
}

for (const nome of porNome.keys())
  if (!noBanco.has(nome))
    acusa(`${nome}: tem arquivo e NÃO rodou no banco`);

console.log(problemas
  ? `\n${problemas} divergência(s). O arquivo é o registro do que rodou -- alinhe o arquivo, nunca o banco.`
  : `\n${noBanco.size} migração(ões) conferidas, todas batendo com o banco.`);
process.exit(problemas ? 1 : 0);
}

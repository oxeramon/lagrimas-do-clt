/* CONFERE-SCHEMA · compara o contrato de um banco com a referência versionada.
 *
 * POR QUE EXISTE
 *
 * `supabase/bootstrap/inventario-esperado.txt` diz como o banco deve ser. Só
 * que um arquivo de referência que ninguém confere envelhece em silêncio: o
 * banco anda, o arquivo fica, e a primeira vez que alguém percebe é numa
 * instalação nova que não funciona. Este script é a conferência, e ele FALHA
 * -- código 1 -- em vez de avisar.
 *
 * COMO RODAR
 *
 *   psql ... -tA -f ferramentas/inventario.sql > /tmp/inv.txt
 *   node ferramentas/confere-schema.mjs /tmp/inv.txt
 *
 * Sem argumento, ele imprime como obter o inventário dos dois lados.
 *
 * A ÚNICA DIFERENÇA TOLERADA é a seção EXT, e por um motivo concreto: as
 * quatro extensões que aparecem num projeto Supabase vêm de fábrica com a
 * plataforma, e nenhuma é criada por este projeto. Num Postgres avulso elas
 * não existem, e exigir que existissem seria cobrar do banco uma coisa que o
 * schema não pede. Toda outra diferença é defeito.
 *
 * O que este script NÃO faz: ler dado. Ele compara duas listas de texto de
 * catálogo, e nenhuma linha de nenhuma tabela de usuário passa por aqui.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REFERENCIA = join(RAIZ, "supabase", "bootstrap", "inventario-esperado.txt");

/* As extensões que um projeto Supabase já traz. A lista é explícita e curta de
   propósito: uma extensão NOVA que aparecesse aqui sem ninguém ter pedido é
   exatamente o tipo de coisa que se quer ver. */
const EXTENSOES_DE_PLATAFORMA = new Set([
  "EXT pg_stat_statements",
  "EXT pgcrypto",
  "EXT supabase_vault",
  "EXT uuid-ossp",
]);

const alvo = process.argv[2];
if (!alvo) {
  process.stderr.write([
    "Falta o arquivo com o inventário do banco a conferir.",
    "",
    "  produção   -> rode ferramentas/inventario.sql no SQL Editor e salve a coluna",
    "  descartável-> psql ... -tA -f ferramentas/inventario.sql > /tmp/inv.txt",
    "",
    "  node ferramentas/confere-schema.mjs /tmp/inv.txt",
    "",
  ].join("\n"));
  process.exit(2);
}

const lê = (caminho) => readFileSync(caminho, "utf8")
  .replaceAll("\r\n", "\n").split("\n").map((l) => l.trimEnd()).filter(Boolean);

let esperado, obtido;
try { esperado = lê(REFERENCIA); } catch {
  process.stderr.write(`Não achei a referência em ${REFERENCIA}.\n`);
  process.exit(2);
}
try { obtido = lê(alvo); } catch {
  process.stderr.write(`Não consegui ler ${alvo}.\n`);
  process.exit(2);
}

/* Multiconjunto, não conjunto: duas linhas idênticas na mesma seção seriam um
   defeito de verdade -- dois índices com a mesma definição, por exemplo -- e um
   `Set` esconderia isso. */
const conta = (linhas) => {
  const m = new Map();
  for (const l of linhas) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
};
const ref = conta(esperado), tem = conta(obtido);

const faltando = [], sobrando = [];
for (const [linha, n] of ref) {
  const d = n - (tem.get(linha) ?? 0);
  for (let i = 0; i < d; i++) faltando.push(linha);
}
for (const [linha, n] of tem) {
  const d = n - (ref.get(linha) ?? 0);
  for (let i = 0; i < d; i++) sobrando.push(linha);
}

/* A tolerância, aplicada uma vez e por escrito. */
const ambiente = [];
const semTolerancia = (lista) => lista.filter((l) => {
  if (l.startsWith("EXT ")) { ambiente.push(l); return false; }
  return true;
});
const faltaReal = semTolerancia(faltando);
const sobraReal = semTolerancia(sobrando);

const secao = (l) => l.split(" ")[0];
const porSecao = (lista) => {
  const m = new Map();
  for (const l of lista) m.set(secao(l), (m.get(secao(l)) ?? 0) + 1);
  return [...m].sort().map(([s, n]) => `${s}:${n}`).join(" ");
};

const saida = [];
saida.push(`referência: ${esperado.length} linhas · banco: ${obtido.length} linhas`);

const inesperadas = ambiente.filter((l) => !EXTENSOES_DE_PLATAFORMA.has(l));
if (ambiente.length) {
  const conhecidas = ambiente.filter((l) => EXTENSOES_DE_PLATAFORMA.has(l));
  if (conhecidas.length) {
    saida.push(`extensões de plataforma (diferença esperada, não é defeito): ${
      conhecidas.map((l) => l.slice(4)).join(", ")}`);
  }
}

if (!faltaReal.length && !sobraReal.length && !inesperadas.length) {
  saida.push("o contrato bate: nenhuma diferença estrutural.");
  process.stdout.write(saida.join("\n") + "\n");
  process.exit(0);
}

saida.push("");
saida.push("O CONTRATO DIVERGIU.");
if (inesperadas.length) {
  saida.push("");
  saida.push("Extensão fora da lista de plataforma -- alguém instalou algo, ou a lista");
  saida.push("precisa ser revista à mão, com um motivo escrito:");
  for (const l of inesperadas) saida.push(`  ? ${l}`);
}
if (faltaReal.length) {
  saida.push("");
  saida.push(`FALTA no banco, e a referência espera (${porSecao(faltaReal)}):`);
  for (const l of faltaReal.slice(0, 40)) saida.push(`  - ${l}`);
  if (faltaReal.length > 40) saida.push(`  ... e mais ${faltaReal.length - 40}`);
}
if (sobraReal.length) {
  saida.push("");
  saida.push(`SOBRA no banco, e a referência não conhece (${porSecao(sobraReal)}):`);
  for (const l of sobraReal.slice(0, 40)) saida.push(`  + ${l}`);
  if (sobraReal.length > 40) saida.push(`  ... e mais ${sobraReal.length - 40}`);
}
saida.push("");
saida.push("Se a mudança é legítima, ela veio de uma migração nova. Então o caminho é:");
saida.push("aplicar a migração, atualizar supabase/bootstrap/schema.sql para nascer já");
saida.push("com ela, rodar ferramentas/reconstroi.sh e regravar a referência do banco");
saida.push("reconstruído. Editar a referência à mão desfaz a única prova que ela dá.");

process.stderr.write(saida.join("\n") + "\n");
process.exit(1);

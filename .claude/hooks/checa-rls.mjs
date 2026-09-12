/* Hook PostToolUse: verifica as invariantes do supabase-setup.sql.

   Por que existe: o repositório é público e a chave publicável fica visível no
   index.html. RLS é a única coisa que separa os dados de qualquer pessoa que
   abrir o site. Uma tabela nova sem policy não dá erro em lugar nenhum — ela
   simplesmente fica legível.

   Verifica três coisas:
     1. toda tabela tem RLS ligado e uma policy
     2. toda tabela com user_id tem o trigger que preenche o campo
     3. o arquivo continua reexecutável do começo ao fim

   Silencioso quando passa. Bloqueia com a lista do que falta quando não. */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const entrada = JSON.parse(readFileSync(0, "utf8"));
const arquivo = entrada.tool_response?.filePath ?? entrada.tool_input?.file_path ?? "";
/* O SQL não vive mais só no arquivo de instalação: `supabase/migrations/` tem
   as migrações que ainda não rodaram, e uma tabela nova sem policy lá é tão
   perigosa quanto uma lá. Toda tabela nova precisa dos quatro blocos, esteja
   onde estiver. */
const ehSqlDoProjeto = basename(arquivo) === "supabase-setup.sql"
  || /\/supabase\/(migrations\/)?[\w.-]+\.sql$/.test(arquivo.replaceAll("\\", "/"));
if (!ehSqlDoProjeto) process.exit(0);

let sql;
try {
  sql = readFileSync(arquivo, "utf8").replaceAll("\r\n", "\n");
} catch {
  process.exit(0);
}

const problemas = [];

/* Tudo é verificado no SQL sem comentários. Duas razões: uma policy comentada
   não protege nada e não pode passar como se protegesse, e a explicação de por
   que não usar 'raise exception' está escrita justamente num comentário. */
const codigo = sql.replace(/--[^\n]*/g, "");

/* ---- 1 e 2: segurança por tabela ------------------------------------- */
const tabelas = [...codigo.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)]
  .map(([, nome, corpo]) => ({ nome, temUserId: /\buser_id\s+uuid/.test(corpo) }));

if (!tabelas.length) {
  problemas.push("Não encontrei nenhum 'create table if not exists public.X (...);'. "
    + "Todas as tabelas precisam usar essa forma, senão o arquivo deixa de ser reexecutável.");
}

for (const { nome, temUserId } of tabelas) {
  const temRls = new RegExp(`alter table public\\.${nome}\\s+enable row level security`).test(codigo);
  const temPolicy = new RegExp(`create policy \\w+ on public\\.${nome}\\b`).test(codigo);
  const temTrigger = new RegExp(`on public\\.${nome}\\s+for each row execute function public\\.set_user_id`).test(codigo);

  if (!temRls) {
    problemas.push(`public.${nome}: falta 'alter table public.${nome} enable row level security;'. `
      + "Sem isso a tabela fica legível por qualquer pessoa que abrir o site.");
  }
  if (!temPolicy) {
    problemas.push(`public.${nome}: falta a policy. Copie o bloco de uma tabela existente:\n`
      + `    drop policy if exists ${nome}_own on public.${nome};\n`
      + `    create policy ${nome}_own on public.${nome}\n`
      + "      for all to authenticated\n"
      + "      using (user_id = auth.uid()) with check (user_id = auth.uid());");
  }
  if (temUserId && !temTrigger) {
    problemas.push(`public.${nome}: tem user_id mas não tem o trigger que preenche o campo. Falta:\n`
      + `    create trigger ${nome}_set_user before insert on public.${nome}\n`
      + "      for each row execute function public.set_user_id();");
  }
}

/* ---- 3: chave estrangeira só aponta para tabela já criada acima -------
   Em banco que já tem a tabela isso passa despercebido: a criação é
   'if not exists' e a referência encontra o que procura. Em banco vazio --
   a instalação do zero que o README descreve -- o Postgres aborta o arquivo
   inteiro com 'relation does not exist', e nenhuma seção depois dela roda.
   Foi o que aconteceu com fixas.credor_id, que referenciava credores cinco
   linhas antes de a tabela ser criada. */
const criadaEm = new Map();
for (const m of codigo.matchAll(/create table if not exists public\.(\w+)/g)) {
  if (!criadaEm.has(m[1])) criadaEm.set(m[1], m.index);
}
/* Tabela da V1 que uma migração pode referenciar sem recriar. O arquivo de
   instalação é quem as cria; aqui elas contam como já existentes. */
const DA_V1 = new Set(["dividas", "fixas", "fixas_mes", "credores", "receitas",
  "pagamentos", "config", "ping"]);

for (const m of codigo.matchAll(/references\s+public\.(\w+)\s*\(/g)) {
  const alvo = m[1], nasce = criadaEm.get(alvo);
  if (nasce === undefined) {
    if (DA_V1.has(alvo)) continue;
    problemas.push(`Há uma referência a public.${alvo}, mas não existe `
      + `'create table if not exists public.${alvo}' neste arquivo.`);
  } else if (nasce > m.index) {
    const linha = codigo.slice(0, m.index).split("\n").length;
    problemas.push(`Perto da linha ${linha}: a chave estrangeira aponta para `
      + `public.${alvo}, que só é criada mais abaixo. Em banco que já tem a tabela `
      + `isso passa, mas numa instalação nova o Postgres aborta o arquivo inteiro. `
      + `Mova esse 'alter table' para depois do 'create table public.${alvo}'.`);
  }
}

/* ---- 4: o arquivo precisa continuar reexecutável --------------------- */
if (/\braise exception\b/i.test(codigo)) {
  problemas.push("O arquivo tem 'raise exception'. Um do $$ que aborta derruba a execução inteira, "
    + "e as seções seguintes — migrações incluídas — nunca rodam. "
    + "Use 'raise notice' com 'return' para sair do bloco sem erro.");
}

if (problemas.length) {
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: basename(arquivo) + " quebrou uma invariante de segurança:\n\n"
      + problemas.map((p) => "• " + p).join("\n\n"),
  }));
}

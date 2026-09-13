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
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const entrada = JSON.parse(readFileSync(0, "utf8"));
const arquivo = entrada.tool_response?.filePath ?? entrada.tool_input?.file_path ?? "";
/* O SQL não vive mais só no arquivo de instalação: `supabase/migrations/` tem
   as migrações que ainda não rodaram, e uma tabela nova sem policy lá é tão
   perigosa quanto uma lá. Toda tabela nova precisa dos quatro blocos, esteja
   onde estiver. */
const caminho = arquivo.replaceAll("\\", "/");
const ehSqlDoProjeto = basename(arquivo) === "supabase-setup.sql"
  || /\/supabase\/(migrations\/|bootstrap\/)?[\w.-]+\.sql$/.test(caminho);
if (!ehSqlDoProjeto) process.exit(0);

/* `supabase/bootstrap/schema.sql` obedece às MESMAS invariantes de segurança
   -- RLS, policy, gatilho de dono, ordem das chaves -- e às duas regras
   OPOSTAS de forma: ele cria sem `if not exists` e aborta com `raise
   exception` de propósito, porque roda uma vez só, em banco vazio. Sem esta
   distinção só haveria dois caminhos, e os dois ruins: o hook reclamando do
   arquivo inteiro, ou ninguém conferindo a policy dele. */
const ehBootstrap = /\/supabase\/bootstrap\//.test(caminho);

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
const tabelas = [...codigo.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g)]
  .map(([, nome, corpo]) => ({ nome, temUserId: /\buser_id\s+uuid/.test(corpo) }));

/* Uma migração que só ajusta tabela existente não cria nenhuma, e isso é
   legítimo -- a 002 é assim inteira. O que não pode é criar FORA da forma
   `if not exists`, que é o que quebra a reexecução. Então a cobrança é sobre
   a forma de quem cria, não sobre a existência de alguém criando. */
for (const m of ehBootstrap ? [] : codigo.matchAll(/create\s+table\s+(?!if\s+not\s+exists\b)/gi)) {
  const linha = codigo.slice(0, m.index).split("\n").length;
  problemas.push(`Perto da linha ${linha}: 'create table' sem 'if not exists'. `
    + "Use 'create table if not exists public.X (...);', senão o arquivo deixa "
    + "de ser reexecutável e a segunda passada aborta.");
}

for (const { nome, temUserId } of tabelas) {
  const temRls = new RegExp(`alter table public\\.${nome}\\s+enable row level security`).test(codigo);
  const temPolicy = new RegExp(`create policy \\w+ on public\\.${nome}\\b`).test(codigo);
  /* `set_user_id` não é o único nome. A 014 trouxe `metas_set_user_id` e
     `alocacoes_set_user_id`, que fazem a mesma coisa em tabela que não usa a
     versão SECURITY DEFINER. O que importa é que ALGUM gatilho preencha o
     dono, não que ele se chame exatamente assim -- e era por não saber disso
     que o hook acusava a 014 de não ter o gatilho que ela tem. */
  const temTrigger = new RegExp(`on public\\.${nome}\\s+for each row execute function public\\.\\w*set_user_id`).test(codigo);

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
for (const m of codigo.matchAll(/create table (?:if not exists )?public\.(\w+)/g)) {
  if (!criadaEm.has(m[1])) criadaEm.set(m[1], m.index);
}
/* Tabela que já existe antes deste arquivo rodar: a instalação da V1 cria as
   oito dela, e cada migração anterior cria as suas. A lista é LIDA, não
   escrita à mão -- uma constante aqui dentro envelheceria a cada migração
   nova, e o hook passaria a acusar referência legítima. A ordem é a do nome
   do arquivo, que é a ordem em que eles rodam. */
/* No bootstrap esse conjunto é vazio, e não por acidente: nada roda antes
   dele. Toda tabela que ele referencia precisa nascer nele mesmo, acima da
   referência -- é essa a diferença entre um bootstrap que funciona em banco
   vazio e um que só funciona em banco que já tinha as tabelas. */
const jaExistem = new Set();
try {
  if (ehBootstrap) throw new Error("bootstrap: nada roda antes");
  const dirSql = resolve(dirname(arquivo));
  const raiz = basename(dirSql) === "migrations" ? resolve(dirSql, "..", "..") : resolve(dirSql, "..");
  const antes = [join(raiz, "supabase-setup.sql")];
  const dirMig = join(raiz, "supabase", "migrations");
  for (const f of readdirSync(dirMig).filter((f) => f.endsWith(".sql")).sort()) {
    if (basename(arquivo) === f) break;      /* daqui para baixo ainda não rodou */
    antes.push(join(dirMig, f));
  }
  for (const caminho of antes) {
    if (resolve(caminho) === resolve(arquivo)) continue;
    let texto;
    try { texto = readFileSync(caminho, "utf8"); } catch { continue; }
    for (const m of texto.replace(/--[^\n]*/g, "").matchAll(/create table if not exists public\.(\w+)/g))
      jaExistem.add(m[1]);
  }
} catch { /* sem diretório de migrações: só o que este arquivo cria vale */ }

for (const m of codigo.matchAll(/references\s+public\.(\w+)\s*\(/g)) {
  const alvo = m[1], nasce = criadaEm.get(alvo);
  if (nasce === undefined) {
    if (jaExistem.has(alvo)) continue;
    problemas.push(`Há uma referência a public.${alvo}, e essa tabela não é criada `
      + `neste arquivo nem em nenhum que roda antes dele. Numa instalação do zero o `
      + `Postgres aborta com 'relation does not exist'.`);
  } else if (nasce > m.index) {
    const linha = codigo.slice(0, m.index).split("\n").length;
    problemas.push(`Perto da linha ${linha}: a chave estrangeira aponta para `
      + `public.${alvo}, que só é criada mais abaixo. Em banco que já tem a tabela `
      + `isso passa, mas numa instalação nova o Postgres aborta o arquivo inteiro. `
      + `Mova esse 'alter table' para depois do 'create table public.${alvo}'.`);
  }
}

/* ---- 4: o arquivo precisa continuar reexecutável --------------------- */
/* O perigo é um `do $$` que aborta no meio do arquivo: ele derruba as seções
   seguintes, e a migração que vinha depois nunca roda. Corpo de função é outra
   coisa -- ele não roda na hora, roda quando alguém mexe na tabela, e recusar
   a linha errada é exatamente o trabalho de um gatilho de constraint. Então o
   corpo de `create function` sai daqui antes da checagem; o resto do arquivo
   continua valendo. */
/* A captura do delimitador, com retrovisor `\1`, fecha no MESMO par que abriu.
   A versão que só conhecia `$$` errava o par em arquivo escrito com `$fn$` ou
   `$function$` -- e desde a 014, que usa `$fn$`, o hook vinha acusando um
   `raise exception` legítimo, de dentro de corpo de função. */
const foraDeFuncao = codigo.replace(
  /create\s+(?:or\s+replace\s+)?function[\s\S]*?(\$\w*\$)[\s\S]*?\1/gi, " ");

if (!ehBootstrap && /\braise exception\b/i.test(foraDeFuncao)) {
  problemas.push("O arquivo tem 'raise exception' fora de corpo de função. Um do $$ que aborta "
    + "derruba a execução inteira, e as seções seguintes — migrações incluídas — nunca rodam. "
    + "Use 'raise notice' com 'return' para sair do bloco sem erro.");
}

if (problemas.length) {
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: basename(arquivo) + " quebrou uma invariante de segurança:\n\n"
      + problemas.map((p) => "• " + p).join("\n\n"),
  }));
}

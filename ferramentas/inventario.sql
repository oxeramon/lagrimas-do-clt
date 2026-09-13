-- INVENTÁRIO ESTRUTURAL · o contrato do banco, em texto comparável
--
-- POR QUE ESTE ARQUIVO EXISTE
--
-- Para provar que um banco reconstruído do zero chega ao MESMO contrato do
-- banco de produção, é preciso descrever os dois com a mesma régua. Um
-- `pg_dump` não serve: ele traz OID, ordem de catálogo, owner do ambiente e
-- ruído que muda entre instalações sem que nada de relevante tenha mudado.
--
-- Esta consulta devolve UMA COLUNA de texto, ordenada e determinística. Rodada
-- contra dois bancos, a diferença entre as duas saídas é a diferença que
-- importa -- e só ela.
--
-- O QUE ELE NÃO LÊ, NUNCA: nenhuma linha de nenhuma tabela de usuário. Só
-- catálogo. Nenhum valor, nome, e-mail, UUID ou data de ninguém passa por aqui,
-- e é por isso que a saída pode ser versionada num repositório público.
--
-- O QUE ELE DELIBERADAMENTE IGNORA, porque muda entre ambientes sem significar
-- nada: OIDs, timestamps, owner, tamanho, estatística, e a ordem física.
--
-- Roda igual nos dois lados:
--   produção   -> pelo MCP (`execute_sql`), somente leitura
--   sala limpa -> psql -f ferramentas/inventario.sql

with
-- ------------------------------------------------------------- extensões --
ext as (
  select 'EXT ' || extname as linha
    from pg_extension
   where extname not in ('plpgsql')
),

-- --------------------------------------------------------------- tabelas --
tab as (
  select 'TAB ' || c.relname
       || ' rls=' || case when c.relrowsecurity then 'on' else 'OFF' end as linha
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),

-- ---------------------------------------------------------------- colunas --
col as (
  select 'COL ' || c.relname || '.' || a.attname
       || ' ' || format_type(a.atttypid, a.atttypmod)
       || case when a.attnotnull then ' NOT NULL' else '' end
       || coalesce(' default=' || pg_get_expr(d.adbin, d.adrelid), '') as linha
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind = 'r'
     and a.attnum > 0 and not a.attisdropped
),

-- ------------------------------------------------------------ constraints --
-- `pg_get_constraintdef` já normaliza a expressão, o que é exatamente o que se
-- quer: duas escritas diferentes do mesmo CHECK saem iguais aqui.
con as (
  select 'CON ' || c.relname || '.' || t.conname
       || ' ' || pg_get_constraintdef(t.oid) as linha
    from pg_constraint t
    join pg_class c on c.oid = t.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
),

-- ---------------------------------------------------------------- índices --
-- Índice que só existe para servir uma constraint sai de cena: ele já foi
-- contado como constraint, e listar os dois faria a mesma coisa aparecer duas
-- vezes -- e divergir quando o Postgres mudasse o nome gerado.
idx as (
  select 'IDX ' || indexdef as linha
    from pg_indexes i
   where schemaname = 'public'
     and not exists (
       select 1 from pg_constraint k
        join pg_class ic on ic.oid = k.conindid
       where ic.relname = i.indexname)
),

-- ------------------------------------------------------------------ views --
vw as (
  select 'VIEW ' || c.relname
       || ' security_invoker=' ||
          case when coalesce((
            select option_value from pg_options_to_table(c.reloptions)
             where option_name = 'security_invoker'), 'false') in ('true', 'on')
          then 'on' else 'OFF' end as linha
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
),
vwdef as (
  select 'VIEWDEF ' || c.relname || ' ' ||
         -- espaço em branco não é contrato: normaliza para comparar o SENTIDO
         regexp_replace(pg_get_viewdef(c.oid, true), '\s+', ' ', 'g') as linha
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
),

-- ---------------------------------------------------------------- funções --
fn as (
  select 'FN ' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')'
       || ' -> ' || pg_get_function_result(p.oid)
       || ' ' || case p.prokind when 'f' then 'func' when 'p' then 'proc' else p.prokind::text end
       || ' ' || case when p.prosecdef then 'DEFINER' else 'invoker' end
       || ' ' || case p.provolatile when 'i' then 'immutable'
                                    when 's' then 'stable' else 'volatile' end
       || ' search_path=' || coalesce((
            select regexp_replace(cfg, '^search_path=', '')
              from unnest(coalesce(p.proconfig, array[]::text[])) cfg
             where cfg like 'search_path=%'), 'NENHUM') as linha
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),
-- O CORPO da função entra: a assinatura igual com corpo diferente é
-- exatamente o drift que passa despercebido.
fnbody as (
  select 'FNBODY ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
       || md5(regexp_replace(coalesce(p.prosrc, ''), '\s+', ' ', 'g')) as linha
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
),

-- --------------------------------------------------------------- triggers --
trg as (
  select 'TRG ' || c.relname || '.' || t.tgname
       || ' ' || pg_get_triggerdef(t.oid)
       || ' deferrable=' || case when t.tgdeferrable then 'sim' else 'nao' end
       || ' initdeferred=' || case when t.tginitdeferred then 'sim' else 'nao' end as linha
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
),

-- --------------------------------------------------------------- policies --
pol as (
  select 'POL ' || tablename || '.' || policyname
       || ' cmd=' || cmd
       || ' roles=' || array_to_string(roles, '+')
       || ' using=' || coalesce(regexp_replace(qual, '\s+', ' ', 'g'), '-')
       || ' check=' || coalesce(regexp_replace(with_check, '\s+', ' ', 'g'), '-') as linha
    from pg_policies
   where schemaname = 'public'
),

-- ----------------------------------------------------- grants de tabela ---
-- Só os três papéis que o PostgREST usa. `postgres` e os papéis internos do
-- Supabase variam por ambiente e não fazem parte do contrato da aplicação.
gtab as (
  select 'GTAB ' || table_name || ' ' || grantee || ' ' || privilege_type as linha
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated', 'service_role')
),

-- ----------------------------------------------------- grants de função ---
-- O DEFEITO DA 012 MORAVA AQUI: função nova no Supabase nasce com EXECUTE para
-- anon por padrão, e `revoke from public` não tira concessão explícita de
-- papel. Por isso o inventário lista execute por papel, um a um.
gfn as (
  select 'GFN ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
       || r.rolname || '=' ||
          case when has_function_privilege(r.rolname, p.oid, 'execute')
               then 'EXECUTE' else 'nao' end as linha
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','authenticated','service_role']) as rolname) r
   where n.nspname = 'public'
),

-- -------------------------------------------------------------- sequences --
seq as (
  select 'SEQ ' || c.relname as linha
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
),

-- ------------------------------------------------------------ comentários --
-- Comentário de tabela, coluna, view e índice faz parte do contrato neste
-- projeto: é onde mora a explicação de por que a coluna existe.
cmt as (
  select 'CMT ' || c.relname
       || coalesce('.' || a.attname, '')
       || ' ' || regexp_replace(d.description, '\s+', ' ', 'g') as linha
    from pg_description d
    join pg_class c on c.oid = d.objoid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
   where n.nspname = 'public'
)

-- O `tudo` é UM CTE com nome, e não uma subconsulta anônima, de propósito: a
-- linha final deste arquivo é um marcador. `ferramentas/confere-schema.mjs`
-- troca ela por uma agregação para calcular o resumo por seção, e assim os
-- dois lados da comparação usam exatamente as mesmas regras de leitura.
-- Se mexer nela, mexa também na constante `LINHA_FINAL` do script.
, tudo as (
  select linha from ext     union all
  select linha from tab     union all
  select linha from col     union all
  select linha from con     union all
  select linha from idx     union all
  select linha from vw      union all
  select linha from vwdef   union all
  select linha from fn      union all
  select linha from fnbody  union all
  select linha from trg     union all
  select linha from pol     union all
  select linha from gtab    union all
  select linha from gfn     union all
  select linha from seq     union all
  select linha from cmt
)
select linha from tudo order by linha;

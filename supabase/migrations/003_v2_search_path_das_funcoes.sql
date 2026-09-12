-- =====================================================================
-- 003 · SEARCH_PATH FIXO NAS FUNÇÕES DA TRANSFERÊNCIA
-- =====================================================================
-- A 002 criou `valida_transferencia()` e `confere_grupo_transferencia()` sem
-- fixar `search_path`. As duas já qualificam tudo por extenso
-- (`public.transacoes`), então não havia furo de verdade; mas o linter aponta
-- o padrão, e a razão dele é boa: quem lê a função não deveria precisar
-- conferir cada nome para saber se algum resolve em esquema alheio.
--
-- Fixar o caminho é endurecer, não afrouxar: nenhum gatilho muda de
-- comportamento, nenhuma checagem some. É a mesma forma que `set_user_id()` e
-- `nivel_da_categoria()` já usam.
--
-- A 002 continua como foi aplicada. Migração aplicada não se edita: quando o
-- texto e o banco discordam, some a única fonte confiável sobre o que rodou.
-- =====================================================================

alter function public.valida_transferencia()              set search_path = public;
alter function public.confere_grupo_transferencia(uuid)   set search_path = public;

-- ---------------------------------------------------------------------
-- CONFERÊNCIA
-- ---------------------------------------------------------------------
-- As quatro funções de gatilho precisam sair daqui com `search_path` fixo e
-- sem `execute` para anon nem authenticated.
select p.proname,
       coalesce(array_to_string(p.proconfig, ','), 'NAO FIXADO')            as search_path,
       coalesce((select string_agg(distinct r.rolname, ',' order by r.rolname)
                   from aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
                  where a.privilege_type = 'EXECUTE'), 'ninguem')           as quem_executa
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('set_user_id','nivel_da_categoria',
                     'valida_transferencia','confere_grupo_transferencia')
 order by p.proname;

-- ---------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------
--   alter function public.valida_transferencia()            reset search_path;
--   alter function public.confere_grupo_transferencia(uuid) reset search_path;

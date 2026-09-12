-- =====================================================================
-- 006 · A FUNÇÃO DE GATILHO DA 005 SAI DA API
-- =====================================================================
-- Duas linhas, e existem porque a 005 deixou passar uma regra que o projeto já
-- tinha: função de gatilho não fica chamável em `/rest/v1/rpc/`.
--
-- `limpa_marca_da_liquidacao()` nasceu, como toda função, com `execute` para
-- PUBLIC -- e PUBLIC inclui `anon`. Ela não faz nada de útil chamada solta
-- (fora de gatilho não existe `old`, e a chamada falha), e o advisor não a
-- aponta porque ela não é `security definer`. Mesmo assim é porta aberta que
-- não leva a lugar nenhum, e o resto do projeto já fechou todas as outras na
-- 002 e na 004.
--
-- A 005 continua como foi aplicada. Migração aplicada não se edita: conserto
-- vira migração nova, mesmo quando o conserto tem duas linhas.
--
-- PRÉ-CONDIÇÃO: nenhuma. Revogar `execute` não muda comportamento de gatilho
-- nenhum -- o privilégio de gatilho é conferido quando ele é criado, não
-- quando dispara. É exatamente o mesmo raciocínio da 002, e desta vez sem o
-- erro que a 004 teve de consertar: aqui NÃO existe função chamada por outra.
-- =====================================================================

revoke execute on function public.limpa_marca_da_liquidacao() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- CONFERÊNCIA
-- ---------------------------------------------------------------------
-- Todas as funções de gatilho do projeto precisam sair daqui sem `execute`
-- para `anon` nem para `authenticated`.
select p.proname,
       coalesce(array_to_string(p.proconfig, ','), 'NAO FIXADO')           as search_path,
       coalesce((select string_agg(distinct r.rolname, ',' order by r.rolname)
                   from aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
                  where a.privilege_type = 'EXECUTE'), 'ninguem')          as quem_executa
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('set_user_id','nivel_da_categoria','valida_transferencia',
                     'limpa_marca_da_liquidacao')
 order by p.proname;

-- ---------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------
--   grant execute on function public.limpa_marca_da_liquidacao() to public;

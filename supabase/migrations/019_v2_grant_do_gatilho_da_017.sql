-- =====================================================================
-- 019 · o `execute` que a 017 deixou para `authenticated`
-- =====================================================================
-- As migrações 001..018 são IMUTÁVEIS. Esta é de UMA LINHA útil, como a 003
-- e a 013, e existe pelo mesmo motivo delas: conserto de migração aplicada
-- vira migração nova.
--
-- O DEFEITO. A 017 criou `competencias_set_user_id()` e revogou assim:
--
--     revoke all on function public.competencias_set_user_id() from public, anon;
--
-- `public` e `anon`, e mais ninguém. No Supabase, função nova nasce com
-- `execute` para `authenticated` por `alter default privileges` do projeto --
-- e revogar de `public` NÃO tira concessão explícita de papel. É a mesma
-- lição da 012, aplicada pela metade: a 017 lembrou de `anon` e esqueceu de
-- `authenticated`.
--
-- POR QUE IMPORTA, mesmo sendo inofensivo na prática. Função de gatilho
-- chamada direto responde "trigger functions can only be called as triggers"
-- e não faz nada -- então não há porta aberta aqui. O que há é uma
-- INCONSISTÊNCIA: as outras onze funções de gatilho deste banco estão só com
-- `service_role`, e a regra do projeto está escrita na seção 12 do bootstrap.
-- Uma exceção silenciosa é a que ninguém revisa da próxima vez.
--
-- COMO APARECEU: a comparação estrutural entre o banco em uso e o
-- reconstruído do zero acusou a seção GFN divergente. O bootstrap põe função
-- de gatilho só com `service_role`; o banco em uso tinha uma a mais. Foi o
-- inventário que pegou, não uma leitura de código.

revoke all on function public.competencias_set_user_id()
  from public, anon, authenticated, service_role;
grant execute on function public.competencias_set_user_id() to service_role;

do $$
declare tem_auth boolean;
begin
  select has_function_privilege('authenticated', 'public.competencias_set_user_id()', 'execute')
    into tem_auth;
  raise notice '019 pronta: authenticated executa o gatilho? %', tem_auth;
end $$;

-- ---------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------
--   grant execute on function public.competencias_set_user_id() to authenticated;
-- (mas não há motivo: nenhuma tela chama uma função de gatilho.)

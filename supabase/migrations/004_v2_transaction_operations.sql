-- =====================================================================
-- 004 · OPERAÇÕES ATÔMICAS DE TRANSFERÊNCIA
-- =====================================================================
-- A 002 deixou o modelo certo: transferência são duas linhas, uma `saida` e
-- uma `entrada`, com o mesmo `transferencia_id`, e um gatilho de constraint
-- DIFERIDO que recusa a transação terminar com o par pela metade.
--
-- O que falta é o frontend conseguir cumprir isso. Dois `insert` por HTTP são
-- duas transações separadas: a primeira comita, a segunda falha, e o gatilho
-- diferido da primeira derruba só a primeira. O resultado não é meia
-- transferência gravada -- é a pessoa vendo "não deu" sem saber se metade
-- entrou. E `update` e `delete` têm o mesmo problema pelo outro lado.
--
-- A saída é o Postgres fazer as duas pernas de uma vez. É o que estas três
-- funções são: uma chamada, uma transação, ou tudo ou nada.
--
-- ---------------------------------------------------------------------
-- POR QUE `SECURITY INVOKER`
-- ---------------------------------------------------------------------
-- Nenhuma delas precisa de privilégio que o usuário não tenha. Rodando como
-- quem chama, três proteções que já existem continuam valendo de graça:
--
--   * o RLS filtra `contas` -- conta de outra pessoa simplesmente não aparece,
--     e a conferência de "as duas contas existem" falha sozinha, sem revelar
--     se o id existe para outro dono;
--   * o gatilho `set_user_id` preenche `user_id` com `auth.uid()`, então o
--     cliente NÃO manda dono nenhum -- não há parâmetro para isso, de
--     propósito;
--   * a policy `with check (user_id = auth.uid())` barra o resto.
--
-- `security definer` aqui só criaria um caminho novo para escrever linha com
-- dono errado. Não há nada que justifique.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. CONSERTO: O GATILHO DA 002 NÃO CONSEGUIA RODAR
-- ---------------------------------------------------------------------
-- Defeito real, achado ao rodar os testes da 004 como `authenticated` em vez
-- de como `postgres`.
--
-- A 002 tirou `execute` de `confere_grupo_transferencia()` junto com o das
-- outras funções de gatilho. O raciocínio estava certo pela metade: gatilho
-- NÃO precisa de `execute`, porque o privilégio é conferido quando o gatilho
-- é criado. Mas `valida_transferencia()` não usa a outra como gatilho -- ela
-- CHAMA, com `perform`, e chamada comum confere `execute` na hora.
--
-- Resultado: qualquer transferência inserida por um usuário de verdade morria
-- com "permission denied for function confere_grupo_transferencia". Como
-- nenhuma linha da V2 existe ainda, ninguém tinha esbarrado nisso.
--
-- O conserto não é devolver o grant -- seria expor em `/rest/v1/rpc/` uma
-- função que só o gatilho usa. É tirar a chamada do meio: a conferência passa
-- a morar dentro do próprio gatilho, que não precisa de `execute` nenhum.
-- A função antiga fica sem uso e sai junto.
--
-- A lição, escrita aqui porque vai acontecer de novo: teste que roda como
-- `postgres` não prova permissão. `postgres` é dono e passa por cima de tudo.
create or replace function public.valida_transferencia()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  grupo    uuid;
  pernas   int; entradas int; saidas int;
  valores  int; donos    int; contas int;
begin
  for grupo in
    select g from unnest(array[
      case when tg_op in ('UPDATE','DELETE') then old.transferencia_id end,
      case when tg_op in ('INSERT','UPDATE') then new.transferencia_id end
    ]) g where g is not null
  loop
    select count(*), count(*) filter (where tipo = 'entrada'),
           count(*) filter (where tipo = 'saida'),
           count(distinct valor), count(distinct user_id), count(distinct conta_id)
      into pernas, entradas, saidas, valores, donos, contas
      from public.transacoes where transferencia_id = grupo;

    if pernas = 0 then continue; end if;   -- grupo desfeito por inteiro

    if pernas <> 2 or entradas <> 1 or saidas <> 1 then
      raise exception 'transferência %: são necessárias exatamente duas pernas, uma de entrada e uma de saída (encontrei %)', grupo, pernas;
    end if;
    if valores <> 1 then
      raise exception 'transferência %: as duas pernas precisam ter o mesmo valor', grupo;
    end if;
    if donos <> 1 then
      raise exception 'transferência %: as duas pernas precisam ser do mesmo usuário', grupo;
    end if;
    if contas <> 2 then
      raise exception 'transferência %: as duas pernas precisam estar em contas diferentes', grupo;
    end if;
  end loop;
  return null;
end $$;

drop function if exists public.confere_grupo_transferencia(uuid);

-- ---------------------------------------------------------------------
-- 1. A CONFERÊNCIA QUE AS TRÊS COMPARTILHAM
-- ---------------------------------------------------------------------
-- Roda antes de qualquer escrita. As mensagens são as que a pessoa vai ler:
-- `js/data/client.js` repassa erro que fala em "transferência" sem traduzir,
-- porque já está escrito para gente.
--
-- A checagem de dono não pergunta "essa conta é minha?". Ela conta quantas das
-- duas o RLS deixa enxergar: se não forem duas, alguma não é sua OU não
-- existe, e as duas respostas são a mesma para quem chamou. Isso é de
-- propósito -- distinguir as duas contaria que o id existe.
create or replace function public.confere_pernas_da_transferencia(
  origem uuid, destino uuid, valor numeric)
returns void language plpgsql security invoker set search_path = public as $$
declare
  visiveis int;
begin
  if auth.uid() is null then
    raise exception 'transferência: é preciso estar logado';
  end if;
  if origem is null or destino is null then
    raise exception 'transferência: escolha a conta de origem e a de destino';
  end if;
  if origem = destino then
    raise exception 'transferência: a conta de origem e a de destino precisam ser diferentes';
  end if;
  if valor is null or valor <= 0 then
    raise exception 'transferência: o valor precisa ser maior que zero';
  end if;

  select count(*) into visiveis from public.contas where id in (origem, destino);
  if visiveis <> 2 then
    raise exception 'transferência: conta não encontrada';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. CRIAR
-- ---------------------------------------------------------------------
-- Os dois `insert` são um comando só, então ou nascem as duas pernas ou não
-- nasce nenhuma. Devolve o `transferencia_id` para a tela saber o que acabou
-- de criar sem precisar reconsultar.
--
-- Repare no que NÃO tem: parâmetro de `user_id`. Quem preenche é o gatilho,
-- com `auth.uid()`.
create or replace function public.cria_transferencia(
  p_conta_origem  uuid,
  p_conta_destino uuid,
  p_valor         numeric,
  p_data          date,
  p_descricao     text default 'Transferência',
  p_obs           text default '',
  p_status        text default 'realizada')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  grupo uuid := gen_random_uuid();
begin
  perform public.confere_pernas_da_transferencia(p_conta_origem, p_conta_destino, p_valor);

  insert into public.transacoes
    (conta_id, tipo, natureza, transferencia_id, descricao, valor, data, status, origem, obs)
  values
    (p_conta_origem,  'saida',   'transferencia', grupo, p_descricao, p_valor, p_data, p_status, 'manual', p_obs),
    (p_conta_destino, 'entrada', 'transferencia', grupo, p_descricao, p_valor, p_data, p_status, 'manual', p_obs);

  return grupo;
end $$;

-- ---------------------------------------------------------------------
-- 3. ATUALIZAR
-- ---------------------------------------------------------------------
-- Atualiza as duas pernas na mesma transação. A perna de saída sempre aponta
-- para a conta de origem e a de entrada para a de destino, então trocar o
-- sentido da transferência é só trocar os dois parâmetros.
--
-- O `count` antes de escrever existe para dar mensagem melhor: sem ele, um
-- grupo inexistente atualizaria zero linhas e a função diria que deu certo.
create or replace function public.atualiza_transferencia(
  p_transferencia uuid,
  p_conta_origem  uuid,
  p_conta_destino uuid,
  p_valor         numeric,
  p_data          date,
  p_descricao     text default 'Transferência',
  p_obs           text default '',
  p_status        text default 'realizada')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  pernas int;
begin
  perform public.confere_pernas_da_transferencia(p_conta_origem, p_conta_destino, p_valor);

  select count(*) into pernas
    from public.transacoes
   where transferencia_id = p_transferencia and natureza = 'transferencia';
  if pernas <> 2 then
    raise exception 'transferência: não encontrei as duas pernas para atualizar';
  end if;

  update public.transacoes
     set conta_id = p_conta_origem, valor = p_valor, data = p_data,
         descricao = p_descricao, obs = p_obs, status = p_status
   where transferencia_id = p_transferencia and tipo = 'saida';

  update public.transacoes
     set conta_id = p_conta_destino, valor = p_valor, data = p_data,
         descricao = p_descricao, obs = p_obs, status = p_status
   where transferencia_id = p_transferencia and tipo = 'entrada';

  return p_transferencia;
end $$;

-- ---------------------------------------------------------------------
-- 4. EXCLUIR
-- ---------------------------------------------------------------------
-- Um `delete` por grupo apaga as duas pernas de uma vez. Apagar uma só nunca
-- é opção: o gatilho diferido recusaria no commit, e mesmo que não recusasse,
-- meia transferência é dinheiro sumindo de uma conta sem aparecer na outra.
create or replace function public.remove_transferencia(p_transferencia uuid)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  apagadas int;
begin
  if auth.uid() is null then
    raise exception 'transferência: é preciso estar logado';
  end if;

  delete from public.transacoes
   where transferencia_id = p_transferencia and natureza = 'transferencia';
  get diagnostics apagadas = row_count;

  if apagadas = 0 then
    raise exception 'transferência: não encontrei nada para excluir';
  end if;
  return apagadas;
end $$;

-- ---------------------------------------------------------------------
-- 5. QUEM PODE CHAMAR
-- ---------------------------------------------------------------------
-- Função nasce com `execute` para PUBLIC, e PUBLIC inclui `anon`. Nenhuma das
-- quatro faz sentido sem sessão -- as três primeiras já recusam com
-- `auth.uid() is null` --, mas negar antes é melhor do que depender da
-- primeira linha do corpo.
--
-- A conferência fica chamável por `authenticated` porque as outras rodam como
-- quem chamou e precisam de `execute` nela. Não é vazamento: ela só responde
-- sobre contas que o RLS já deixaria a própria pessoa listar.
revoke execute on function public.confere_pernas_da_transferencia(uuid, uuid, numeric) from public, anon;
revoke execute on function public.cria_transferencia(uuid, uuid, numeric, date, text, text, text) from public, anon;
revoke execute on function public.atualiza_transferencia(uuid, uuid, uuid, numeric, date, text, text, text) from public, anon;
revoke execute on function public.remove_transferencia(uuid) from public, anon;

grant execute on function public.confere_pernas_da_transferencia(uuid, uuid, numeric) to authenticated;
grant execute on function public.cria_transferencia(uuid, uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.atualiza_transferencia(uuid, uuid, uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.remove_transferencia(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- As quatro precisam sair daqui com `search_path` fixo, sem `security
-- definer`, sem `execute` para `anon`, e com `execute` para `authenticated`.
-- As tabelas continuam vazias: esta migração não cria dado nenhum.
select p.proname,
       p.prosecdef                                                   as security_definer,
       coalesce(array_to_string(p.proconfig, ','), 'NAO FIXADO')      as search_path,
       coalesce((select string_agg(distinct r.rolname, ',' order by r.rolname)
                   from aclexplode(p.proacl) a join pg_roles r on r.oid = a.grantee
                  where a.privilege_type = 'EXECUTE'), 'ninguem')     as quem_executa
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('confere_pernas_da_transferencia','cria_transferencia',
                     'atualiza_transferencia','remove_transferencia',
                     'valida_transferencia')
 order by p.proname;

-- ---------------------------------------------------------------------
-- 7. ROLLBACK
-- ---------------------------------------------------------------------
-- Seguro a qualquer momento: são só funções, e nenhuma tabela depende delas.
-- Depois de desfazer, a tela de transferência para de funcionar -- as duas
-- pernas voltariam a precisar de duas chamadas separadas, que é justamente o
-- que esta migração existe para evitar.
--
--   drop function if exists public.remove_transferencia(uuid);
--   drop function if exists public.atualiza_transferencia(uuid, uuid, uuid, numeric, date, text, text, text);
--   drop function if exists public.cria_transferencia(uuid, uuid, numeric, date, text, text, text);
--   drop function if exists public.confere_pernas_da_transferencia(uuid, uuid, numeric);
--
-- O gatilho da seção 0 NÃO volta atrás: desfazer ele significaria recriar
-- `confere_grupo_transferencia()` e o defeito de permissão junto.

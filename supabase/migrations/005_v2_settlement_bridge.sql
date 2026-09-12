-- =====================================================================
-- 005 · A PONTE ENTRE COMPROMISSO E MOVIMENTO
-- =====================================================================
-- O contrato completo está em `docs/CONTRATO_PONTE.md`, escrito antes desta
-- migração. O resumo:
--
--   "eu devo R$ 500"                     é compromisso, e mora na V1
--   "R$ 500 saíram da conta X em 12/09"  é movimento, e mora na V2
--
-- As duas se relacionam. Não são a mesma entidade, e somá-las conta o mesmo
-- dinheiro duas vezes. Esta migração cria o vínculo EXPLÍCITO entre elas.
--
-- ---------------------------------------------------------------------
-- PRÉ-CONDIÇÃO: DIFERENTE DAS ANTERIORES
-- ---------------------------------------------------------------------
-- Da 001 à 004 a V2 estava vazia, e várias delas dependiam disso. **Agora
-- não está**: há instituições, contas e categorias cadastradas por gente de
-- verdade. Então esta migração é estritamente ADITIVA: cria uma tabela nova,
-- alarga um `check` numa tabela sem linhas, e não toca em mais nada. Nenhum
-- `drop` de coluna, nenhum estreitamento, nenhuma carga.
--
-- ---------------------------------------------------------------------
-- POR QUE UMA TABELA, E NÃO SÓ `origem` / `origem_id`
-- ---------------------------------------------------------------------
-- As duas colunas existem e continuam sendo preenchidas, para filtrar sem
-- `join`. Mas elas não bastam como identidade, e a razão é concreta: um
-- compromisso da V1 não é uma linha, é uma linha VEZES um mês. Uma dívida de
-- 24 parcelas é uma linha em `dividas` e vinte e quatro obrigações distintas.
-- `origem_id = <uuid da dívida>` não diz QUAL parcela foi paga.
--
-- `liquidacoes` carrega a competência como coluna. É isso que torna a relação
-- consultável nos dois sentidos, em vez de virar texto codificado que ninguém
-- consegue filtrar depois.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. `origem` PASSA A CONHECER FIXA E RECEITA
-- ---------------------------------------------------------------------
-- `divida` já estava na lista desde a 001. Faltavam as outras duas pontas da
-- ponte. `transacoes` está vazia, então alargar o `check` não pode cortar
-- linha nenhuma -- e alargar nunca corta, mesmo com dado: só aceita mais.
alter table public.transacoes drop constraint if exists transacoes_origem_check;
alter table public.transacoes add  constraint transacoes_origem_check
  check (origem in ('manual','divida','fixa','receita','recorrencia','cartao','importacao','mensagem'));

-- ---------------------------------------------------------------------
-- 2. O VÍNCULO
-- ---------------------------------------------------------------------
-- `item_id` é TEXTO e não chave estrangeira, porque o alvo muda de tabela:
-- dívida, fixa e, depois, fatura. Uma FK aponta para uma tabela só. É a mesma
-- razão pela qual `pagamentos.item_id` já é texto na V1 -- e usar EXATAMENTE a
-- mesma convenção (`<uuid>` para dívida, `fx:<uuid>` para fixa) é o que faz a
-- marca da V1 e o vínculo da V2 falarem do mesmo item sem tradução.
--
-- O preço é o banco não conseguir garantir que o `item_id` existe. Quem
-- garante é a RPC, lendo com o RLS ligado: compromisso de outra pessoa
-- simplesmente não é encontrado.
create table if not exists public.liquidacoes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- o que foi liquidado
  tipo          text not null check (tipo in ('divida','fixa','receita')),
  item_id       text not null check (length(item_id) between 1 and 80),
  -- 'YYYY-MM': a competência é o que distingue a parcela de março da de abril
  competencia   text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- a movimentação que liquidou
  transacao_id  uuid not null,
  valor         numeric(14,2) not null check (valor > 0),
  criado_em     timestamptz not null default now(),

  -- Uma liquidação por competência. É isto que EXCLUI pagamento parcial, e a
  -- exclusão é escolha: a V1 não tem onde guardar "quanto ainda falta desta
  -- parcela", e `pagamentos` é booleano. Ver `docs/CONTRATO_PONTE.md`.
  constraint liquidacao_uma_por_competencia unique (user_id, tipo, item_id, competencia)
);

-- A transação é dona do vínculo: apagou a transação, o vínculo vai junto. Sem
-- isto existiria compromisso marcado como pago cuja transação sumiu.
alter table public.liquidacoes drop constraint if exists liquidacoes_transacao_dono_fk;
alter table public.liquidacoes add  constraint liquidacoes_transacao_dono_fk
  foreign key (user_id, transacao_id) references public.transacoes (user_id, id)
  on update cascade on delete cascade;

-- uma transação liquida no máximo um compromisso
alter table public.liquidacoes drop constraint if exists liquidacao_uma_por_transacao;
alter table public.liquidacoes add  constraint liquidacao_uma_por_transacao
  unique (user_id, transacao_id);

create index if not exists liquidacoes_user_idx on public.liquidacoes (user_id, competencia);
create index if not exists liquidacoes_item_idx on public.liquidacoes (user_id, tipo, item_id);
create index if not exists liquidacoes_transacao_idx on public.liquidacoes (user_id, transacao_id);

-- ---------------------------------------------------------------------
-- 3. SEGURANÇA
-- ---------------------------------------------------------------------
alter table public.liquidacoes enable row level security;

drop policy if exists liquidacoes_own on public.liquidacoes;
create policy liquidacoes_own on public.liquidacoes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists liquidacoes_set_user on public.liquidacoes;
create trigger liquidacoes_set_user before insert on public.liquidacoes
  for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 4. A MARCA DA V1 ACOMPANHA O VÍNCULO
-- ---------------------------------------------------------------------
-- Apagar a transação leva o vínculo pelo `cascade`; este gatilho leva também a
-- marca de pago da V1. A consequência é correta e vale dizer em voz alta: se
-- o movimento foi apagado, o compromisso deixa de estar liquidado.
--
-- Só mexe em marca que a PONTE criou. Quem marcou pago no quadradinho, sem
-- escolher conta, não tem linha em `liquidacoes` e não é afetado -- a ponte é
-- opcional, e `pagamentos` pode existir sozinha.
--
-- Receita não entra: ela nunca gera linha em `pagamentos`. Receita não é
-- pagamento, e a tabela tem esse nome por um motivo.
create or replace function public.limpa_marca_da_liquidacao()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.tipo in ('divida','fixa') then
    delete from public.pagamentos
     where user_id = old.user_id
       and mes     = old.competencia
       and item_id = old.item_id;
  end if;
  return null;
end $$;

drop trigger if exists liquidacoes_limpa_marca on public.liquidacoes;
create trigger liquidacoes_limpa_marca after delete on public.liquidacoes
  for each row execute function public.limpa_marca_da_liquidacao();

-- ---------------------------------------------------------------------
-- 5. A CONFERÊNCIA QUE AS TRÊS OPERAÇÕES COMPARTILHAM
-- ---------------------------------------------------------------------
-- Mesma escolha da 004: a checagem de dono não pergunta "esse compromisso é
-- meu?" -- ela conta quantos o RLS deixa enxergar. Distinguir "não é seu" de
-- "não existe" contaria que o id existe.
create or replace function public.confere_liquidacao(
  p_tipo text, p_item_id text, p_competencia text, p_conta uuid, p_valor numeric)
returns void language plpgsql security invoker set search_path = public as $$
declare
  achou int;
  bruto uuid;
begin
  if auth.uid() is null then
    raise exception 'liquidação: é preciso estar logado';
  end if;
  if p_conta is null then
    raise exception 'liquidação: escolha a conta';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'liquidação: o valor precisa ser maior que zero';
  end if;
  if p_competencia !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'liquidação: a competência precisa estar no formato AAAA-MM';
  end if;

  select count(*) into achou from public.contas where id = p_conta;
  if achou <> 1 then
    raise exception 'liquidação: conta não encontrada';
  end if;

  -- o compromisso existe e é meu? o RLS responde sozinho
  if p_tipo = 'divida' then
    begin bruto := p_item_id::uuid; exception when others then
      raise exception 'liquidação: identificador de dívida inválido'; end;
    select count(*) into achou from public.dividas where id = bruto;
  elsif p_tipo = 'fixa' then
    if left(p_item_id, 3) <> 'fx:' then
      raise exception 'liquidação: conta fixa precisa do prefixo fx:';
    end if;
    begin bruto := substr(p_item_id, 4)::uuid; exception when others then
      raise exception 'liquidação: identificador de conta fixa inválido'; end;
    select count(*) into achou from public.fixas where id = bruto;
  elsif p_tipo = 'receita' then
    begin bruto := p_item_id::uuid; exception when others then
      raise exception 'liquidação: identificador de receita inválido'; end;
    select count(*) into achou from public.receitas where id = bruto;
  else
    raise exception 'liquidação: tipo desconhecido';
  end if;

  if achou <> 1 then
    raise exception 'liquidação: compromisso não encontrado';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. LIQUIDAR COMPROMISSO
-- ---------------------------------------------------------------------
-- Três escritas, uma transação: a saída em `transacoes`, a marca em
-- `pagamentos` (a MESMA que o quadradinho da V1 cria) e o vínculo.
--
-- Para quem usa, é uma operação. Por dentro continuam sendo entidades
-- diferentes -- que é o ponto do contrato inteiro.
--
-- Sem parâmetro de `user_id`, como nas RPCs da 004: quem preenche é o gatilho,
-- com `auth.uid()`.
create or replace function public.liquida_compromisso(
  p_tipo        text,
  p_item_id     text,
  p_competencia text,
  p_conta       uuid,
  p_valor       numeric,
  p_data        date,
  p_descricao   text,
  p_categoria   uuid default null,
  p_obs         text default '')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  nova uuid;
begin
  if p_tipo not in ('divida','fixa') then
    raise exception 'liquidação: use recebe_receita para receita';
  end if;
  perform public.confere_liquidacao(p_tipo, p_item_id, p_competencia, p_conta, p_valor);

  insert into public.transacoes
    (conta_id, categoria_id, tipo, natureza, descricao, valor, data, status, origem, origem_id, obs)
  values
    (p_conta, p_categoria, 'saida', 'normal', p_descricao, p_valor, p_data,
     'realizada', p_tipo, p_item_id, p_obs)
  returning id into nova;

  -- a marca da V1. `on conflict do nothing` porque a pessoa pode ter marcado
  -- no quadradinho antes de decidir registrar de qual conta saiu.
  insert into public.pagamentos (mes, item_id)
  values (p_competencia, p_item_id)
  on conflict do nothing;

  insert into public.liquidacoes (tipo, item_id, competencia, transacao_id, valor)
  values (p_tipo, p_item_id, p_competencia, nova, p_valor);

  return nova;
end $$;

-- ---------------------------------------------------------------------
-- 7. RECEBER RECEITA
-- ---------------------------------------------------------------------
-- Sem linha em `pagamentos`: receita não é pagamento. O marcador de
-- recebimento passa a ser a própria `liquidacoes`, o que resolve a lacuna da
-- V1 -- que nunca teve como registrar "esta receita caiu" -- sem tabela nova e
-- sem enfiar recebimento numa tabela chamada `pagamentos`.
create or replace function public.recebe_receita(
  p_receita     uuid,
  p_competencia text,
  p_conta       uuid,
  p_valor       numeric,
  p_data        date,
  p_descricao   text,
  p_categoria   uuid default null,
  p_obs         text default '')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  nova uuid;
begin
  perform public.confere_liquidacao('receita', p_receita::text, p_competencia, p_conta, p_valor);

  insert into public.transacoes
    (conta_id, categoria_id, tipo, natureza, descricao, valor, data, status, origem, origem_id, obs)
  values
    (p_conta, p_categoria, 'entrada', 'normal', p_descricao, p_valor, p_data,
     'realizada', 'receita', p_receita::text, p_obs)
  returning id into nova;

  insert into public.liquidacoes (tipo, item_id, competencia, transacao_id, valor)
  values ('receita', p_receita::text, p_competencia, nova, p_valor);

  return nova;
end $$;

-- ---------------------------------------------------------------------
-- 8. DESFAZER
-- ---------------------------------------------------------------------
-- Apaga a transação. O `cascade` leva o vínculo e o gatilho leva a marca da
-- V1. Uma chamada desfaz as três coisas, na mesma transação.
create or replace function public.desfaz_liquidacao(
  p_tipo text, p_item_id text, p_competencia text)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  alvo uuid;
begin
  if auth.uid() is null then
    raise exception 'liquidação: é preciso estar logado';
  end if;

  select transacao_id into alvo from public.liquidacoes
   where tipo = p_tipo and item_id = p_item_id and competencia = p_competencia;
  if alvo is null then
    raise exception 'liquidação: não encontrei o que desfazer';
  end if;

  delete from public.transacoes where id = alvo;
  return 1;
end $$;

-- ---------------------------------------------------------------------
-- 9. QUEM PODE CHAMAR
-- ---------------------------------------------------------------------
revoke execute on function public.confere_liquidacao(text, text, text, uuid, numeric) from public, anon;
revoke execute on function public.liquida_compromisso(text, text, text, uuid, numeric, date, text, uuid, text) from public, anon;
revoke execute on function public.recebe_receita(uuid, text, uuid, numeric, date, text, uuid, text) from public, anon;
revoke execute on function public.desfaz_liquidacao(text, text, text) from public, anon;

grant execute on function public.confere_liquidacao(text, text, text, uuid, numeric) to authenticated;
grant execute on function public.liquida_compromisso(text, text, text, uuid, numeric, date, text, uuid, text) to authenticated;
grant execute on function public.recebe_receita(uuid, text, uuid, numeric, date, text, uuid, text) to authenticated;
grant execute on function public.desfaz_liquidacao(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- `liquidacoes` nasce vazia: esta migração não liquida nada. O que importa é
-- ela existir com RLS ligada e as funções saírem sem `execute` para `anon`.
select
  (select count(*) from public.liquidacoes)                                   as liquidacoes,
  (select count(*) from pg_tables where schemaname='public'
     and tablename='liquidacoes' and rowsecurity)                             as com_rls,
  (select count(*) from pg_policies where schemaname='public'
     and tablename='liquidacoes')                                             as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
       ('confere_liquidacao','liquida_compromisso','recebe_receita','desfaz_liquidacao')) as funcoes;

-- ---------------------------------------------------------------------
-- 11. ROLLBACK
-- ---------------------------------------------------------------------
-- Seguro enquanto `liquidacoes` estiver vazia. Com vínculos gravados, desfazer
-- deixa as marcas da V1 sem a transação que as explica -- e nesse ponto o
-- certo é desfazer cada liquidação pela RPC, não derrubar a tabela.
--
-- O `check` de `origem` NÃO volta atrás: estreitá-lo de novo recusaria
-- transações que a ponte já criou.
--
--   drop function if exists public.desfaz_liquidacao(text, text, text);
--   drop function if exists public.recebe_receita(uuid, text, uuid, numeric, date, text, uuid, text);
--   drop function if exists public.liquida_compromisso(text, text, text, uuid, numeric, date, text, uuid, text);
--   drop function if exists public.confere_liquidacao(text, text, text, uuid, numeric);
--   drop table if exists public.liquidacoes;
--   drop function if exists public.limpa_marca_da_liquidacao();

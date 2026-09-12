-- =====================================================================
-- 008 · ASSINATURAS E RECORRÊNCIA
-- =====================================================================
-- A distinção que organiza esta migração inteira:
--
--     Assinatura é REGRA.      "R$ 19,90 todo mês, desde março"
--     Ocorrência é EVENTO.     "R$ 19,90 saíram em 05/09"
--
-- Confundir as duas é o mesmo erro que a ponte da 005 resolveu do outro lado:
-- somar a regra com o evento conta o mesmo dinheiro duas vezes.
--
-- A ESTRATÉGIA DE MATERIALIZAÇÃO, que é a decisão difícil aqui:
--
-- Uma assinatura mensal sem data de fim tem infinitas ocorrências. Gerar
-- "todas" é impossível, e gerar duzentas por garantia enche o banco de linhas
-- que ninguém vai olhar e que precisam ser apagadas quando o valor mudar.
--
-- Então: materializa-se SOB DEMANDA, numa janela curta, e a idempotência é do
-- BANCO e não da aplicação. `unique (user_id, assinatura_id, competencia)`
-- garante que rodar a geração duas vezes não duplica nada -- que é a única
-- propriedade que torna seguro chamá-la a cada carga da tela.
--
-- É a mesma estratégia da fatura na 007. Duas features, uma ideia.
--
-- A ocorrência nasce com `status='prevista'`: ela ainda não aconteceu. Status
-- previsto não entra em saldo nem em consumo -- a 001 já decidiu isso, e nada
-- aqui muda essa regra.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ASSINATURAS
-- ---------------------------------------------------------------------
-- `conta_id` e `cartao_id` são mutuamente exclusivos, e os DOIS podem faltar:
-- "ainda não decidi por onde pago" é um estado real, e forçar uma escolha
-- falsa só produziria dado errado.
create table if not exists public.assinaturas (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  nome           text not null check (length(nome) between 1 and 60),
  -- URL pública de logo. O app NÃO hospeda imagem, e a tela sempre tem o
  -- monograma como plano B: CDN fora do ar não pode deixar buraco.
  logo           text not null default '',
  valor          numeric(14,2) not null check (valor > 0),
  frequencia     text not null default 'mensal'
                 check (frequencia in ('semanal','mensal','bimestral','trimestral','semestral','anual')),
  categoria_id   uuid,
  conta_id       uuid,
  cartao_id      uuid,
  -- primeira cobrança. É a âncora de todas as outras: a segunda é esta mais um
  -- período, e assim por diante. Guardar "próxima cobrança" seria guardar um
  -- derivado, e derivado guardado envelhece.
  inicio         date not null,
  fim            date,
  ativo          boolean not null default true,
  obs            text not null default '',
  ordem          integer not null default 0,
  criado_em      timestamptz not null default now(),
  constraint assinatura_nome_unico unique (user_id, nome),
  constraint assinaturas_dono_id_unico unique (user_id, id),
  constraint assinatura_paga_por_um_lugar_so check (conta_id is null or cartao_id is null),
  constraint assinatura_fim_depois_do_inicio check (fim is null or fim >= inicio)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assinaturas_categoria_dono_fk') then
    alter table public.assinaturas
      add constraint assinaturas_categoria_dono_fk
      foreign key (user_id, categoria_id) references public.categorias (user_id, id)
      on update cascade on delete set null (categoria_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assinaturas_conta_dono_fk') then
    alter table public.assinaturas
      add constraint assinaturas_conta_dono_fk
      foreign key (user_id, conta_id) references public.contas (user_id, id)
      on update cascade on delete set null (conta_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assinaturas_cartao_dono_fk') then
    alter table public.assinaturas
      add constraint assinaturas_cartao_dono_fk
      foreign key (user_id, cartao_id) references public.cartoes (user_id, id)
      on update cascade on delete set null (cartao_id);
  end if;
end $$;

create index if not exists assinaturas_user_idx on public.assinaturas (user_id, ativo, ordem, nome);

alter table public.assinaturas enable row level security;
drop policy if exists assinaturas_own on public.assinaturas;
create policy assinaturas_own on public.assinaturas
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists assinaturas_set_user on public.assinaturas;
create trigger assinaturas_set_user before insert on public.assinaturas
  for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 2. A OCORRÊNCIA É UMA TRANSAÇÃO, E SE RECONHECE PELA COMPETÊNCIA
-- ---------------------------------------------------------------------
-- Nenhuma tabela nova para ocorrência: ela É uma transação, só que prevista.
-- O que faltava era como reconhecer "esta é a cobrança de setembro desta
-- assinatura" -- e a resposta é a mesma da ponte: competência como coluna.
alter table public.transacoes add column if not exists assinatura_id uuid;
alter table public.transacoes add column if not exists competencia   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transacoes_assinatura_dono_fk') then
    alter table public.transacoes
      add constraint transacoes_assinatura_dono_fk
      foreign key (user_id, assinatura_id) references public.assinaturas (user_id, id)
      on update cascade on delete set null (assinatura_id);
  end if;
end $$;

alter table public.transacoes drop constraint if exists transacao_competencia_formato;
alter table public.transacoes add constraint transacao_competencia_formato
  check (competencia is null or competencia ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- Ocorrência de assinatura sempre sabe de qual período ela é. Sem isso, gerar
-- duas vezes criaria duas cobranças do mesmo mês.
alter table public.transacoes drop constraint if exists ocorrencia_tem_competencia;
alter table public.transacoes add constraint ocorrencia_tem_competencia
  check (assinatura_id is null or competencia is not null);

-- A ÚNICA COISA QUE TORNA A GERAÇÃO SEGURA DE REPETIR.
alter table public.transacoes drop constraint if exists ocorrencia_unica_por_periodo;
alter table public.transacoes add constraint ocorrencia_unica_por_periodo
  unique (user_id, assinatura_id, competencia);

create index if not exists transacoes_assinatura_idx
  on public.transacoes (user_id, assinatura_id, competencia);

-- ---------------------------------------------------------------------
-- 3. QUANDO CAI CADA COBRANÇA
-- ---------------------------------------------------------------------
-- O intervalo de cada frequência, num lugar só.
create or replace function public.passo_da_frequencia(p_frequencia text)
returns interval language sql immutable set search_path = public as $$
  select case p_frequencia
           when 'semanal'    then interval '7 days'
           when 'mensal'     then interval '1 month'
           when 'bimestral'  then interval '2 months'
           when 'trimestral' then interval '3 months'
           when 'semestral'  then interval '6 months'
           when 'anual'      then interval '1 year'
         end;
$$;

-- A competência de uma ocorrência é o MÊS em que ela cai.
--
-- ISSO NÃO SERVE PARA A FREQUÊNCIA SEMANAL, e é por isso que ela fica fora da
-- materialização: quatro cobranças semanais caem no mesmo mês, e a `unique`
-- por competência deixaria passar só a primeira. Resolver direito exige mudar
-- a chave, e mudar chave é caro. Assinatura semanal pode ser cadastrada e
-- entra nos indicadores de custo; ela só não vira ocorrência ainda.
create or replace function public.competencia_da_ocorrencia(p_data date, p_frequencia text)
returns text language sql immutable set search_path = public as $$
  select case when p_frequencia = 'semanal' then null
              else to_char(p_data, 'YYYY-MM') end;
$$;

-- ---------------------------------------------------------------------
-- 4. MATERIALIZAR
-- ---------------------------------------------------------------------
-- Gera as ocorrências que faltam entre hoje e `p_ate`, e devolve quantas
-- criou. Rodar duas vezes seguidas devolve zero na segunda -- quem garante é a
-- `unique`, não um `if` na aplicação.
--
-- Semanal fica DE FORA desta rodada, e a exclusão é declarada: a competência
-- por mês não distingue duas cobranças semanais do mesmo mês, e resolver isso
-- direito exige mudar a chave. Assinatura semanal pode ser cadastrada; ela só
-- não é materializada ainda, e a tela diz isso.
create or replace function public.materializa_assinaturas(p_ate date default null)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  a public.assinaturas%rowtype;
  quando date;
  limite date;
  comp text;
  criadas int := 0;
  voltas int;
  fatura uuid;
begin
  if auth.uid() is null then
    raise exception 'assinatura: é preciso estar logado';
  end if;

  -- janela curta e controlada. Dois meses cobre "o que vem por aí" sem encher
  -- o banco de linha que ninguém vai olhar.
  limite := coalesce(p_ate, (current_date + interval '2 months')::date);
  if limite > (current_date + interval '24 months')::date then
    raise exception 'assinatura: a janela de geração não passa de 24 meses';
  end if;

  for a in select * from public.assinaturas
            where ativo and frequencia <> 'semanal'
              and (fim is null or fim >= current_date)
  loop
    quando := a.inicio;
    voltas := 0;
    -- pula o que já passou: o que interessa é o que ainda vem. O contador não
    -- é paranoia -- uma data de início absurda faria este laço rodar milhares
    -- de vezes dentro de uma transação de banco.
    while quando < current_date loop
      quando := (quando + public.passo_da_frequencia(a.frequencia))::date;
      voltas := voltas + 1;
      if voltas > 2000 then
        raise exception 'assinatura %: data de início longe demais para gerar cobranças', a.nome;
      end if;
    end loop;

    while quando <= limite and (a.fim is null or quando <= a.fim) loop
      comp := public.competencia_da_ocorrencia(quando, a.frequencia);
      fatura := null;
      if a.cartao_id is not null then
        fatura := public.fatura_do_cartao(a.cartao_id, quando);
      end if;

      insert into public.transacoes
        (conta_id, fatura_id, assinatura_id, competencia, categoria_id, tipo, natureza,
         descricao, valor, data, status, origem, origem_id, obs)
      values
        (a.conta_id, fatura, a.id, comp, a.categoria_id, 'saida', 'normal',
         a.nome, a.valor, quando, 'prevista', 'recorrencia', a.id::text, '')
      on conflict (user_id, assinatura_id, competencia) do nothing;

      if found then criadas := criadas + 1; end if;
      quando := (quando + public.passo_da_frequencia(a.frequencia))::date;
    end loop;
  end loop;

  return criadas;
end $$;

-- ---------------------------------------------------------------------
-- 5. A VIEW QUE RESPONDE "QUANTO ISSO CUSTA POR MÊS"
-- ---------------------------------------------------------------------
-- Custo mensal equivalente e anual equivalente, para poder comparar uma
-- assinatura anual com uma mensal sem fazer a conta de cabeça.
--
-- `proxima_cobranca` é DERIVADA da âncora `inicio`, e não guardada: guardar um
-- derivado é guardar algo que envelhece sozinho.
create or replace view public.assinaturas_resolvidas
with (security_invoker = on) as
select
  a.*,
  case a.frequencia
    when 'semanal'    then round(a.valor * 52 / 12, 2)
    when 'mensal'     then a.valor
    when 'bimestral'  then round(a.valor / 2, 2)
    when 'trimestral' then round(a.valor / 3, 2)
    when 'semestral'  then round(a.valor / 6, 2)
    when 'anual'      then round(a.valor / 12, 2)
  end as custo_mensal,
  case a.frequencia
    when 'semanal'    then round(a.valor * 52, 2)
    when 'mensal'     then a.valor * 12
    when 'bimestral'  then a.valor * 6
    when 'trimestral' then a.valor * 4
    when 'semestral'  then a.valor * 2
    when 'anual'      then a.valor
  end as custo_anual,
  (select min(t.data) from public.transacoes t
    where t.assinatura_id = a.id and t.user_id = a.user_id
      and t.data >= current_date and t.status = 'prevista') as proxima_cobranca
from public.assinaturas a;

-- ---------------------------------------------------------------------
-- 6. QUEM PODE CHAMAR
-- ---------------------------------------------------------------------
revoke execute on function public.passo_da_frequencia(text) from public, anon;
revoke execute on function public.competencia_da_ocorrencia(date, text) from public, anon;
revoke execute on function public.materializa_assinaturas(date) from public, anon;

grant execute on function public.passo_da_frequencia(text) to authenticated;
grant execute on function public.competencia_da_ocorrencia(date, text) to authenticated;
grant execute on function public.materializa_assinaturas(date) to authenticated;

-- ---------------------------------------------------------------------
-- 7. CONFERÊNCIA
-- ---------------------------------------------------------------------
select 'assinaturas' as objeto, count(*) as linhas from public.assinaturas;

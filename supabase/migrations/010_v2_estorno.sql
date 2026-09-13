-- =====================================================================
-- 010 · ESTORNO
-- =====================================================================
-- O contrato está em docs/CONTRATO_ESTORNO.md e foi escrito antes deste
-- arquivo. O schema já tinha `natureza='estorno'` e `estorno_de_id` desde a
-- 002; o que faltava não era coluna, era DECISÃO.
--
-- Estorno é dinheiro que VOLTOU. Ele não apaga a transação original -- as duas
-- aconteceram, e a segunda desfaz o efeito da primeira sem apagar o histórico.
-- Apagar seria mais simples e seria errado: o extrato do banco tem as duas
-- linhas, e um app que discorda do extrato é um app em que não se confia.
--
-- A REGRA QUE SEPARA ESTORNO DE DESFAZER, e que decide os três "não" abaixo:
--
--     Transação que carrega VÍNCULO ESTRUTURAL não se estorna, se desfaz.
--
-- Estorno é para dinheiro que voltou; desfazer é para registro que não devia
-- existir. Confundir os dois deixa o banco consistente e a realidade errada:
-- fatura dizendo "paga" com o dinheiro de volta no bolso, compromisso marcado
-- como pago sem pagamento, meia transferência sem a outra perna.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SÓ TRANSAÇÃO NORMAL SE ESTORNA
-- ---------------------------------------------------------------------
-- Fecha, no banco, as três portas do contrato: transferência, pagamento de
-- fatura e estorno de estorno. Numa tela isso seria uma condição esquecível;
-- aqui é uma restrição.
create or replace function public.confere_estorno()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  o public.transacoes%rowtype;
  somado numeric(14,2);
begin
  if new.estorno_de_id is null then return null; end if;

  select * into o from public.transacoes where id = new.estorno_de_id;
  if o.id is null then
    raise exception 'estorno: a transação original não foi encontrada';
  end if;

  if o.natureza <> 'normal' then
    raise exception
      'estorno: transação de natureza % não se estorna, se desfaz -- veja docs/CONTRATO_ESTORNO.md',
      o.natureza;
  end if;

  -- vínculo estrutural: liquidação de compromisso da V1 ou de fatura
  if exists (select 1 from public.liquidacoes l where l.transacao_id = o.id) then
    raise exception
      'estorno: esta transação quita uma obrigação; desfazer é o caminho, não estornar';
  end if;

  -- o sinal inverte, sempre
  if new.tipo = o.tipo then
    raise exception 'estorno: o sinal precisa inverter -- estorno de % é %',
      o.tipo, case when o.tipo = 'saida' then 'entrada' else 'saida' end;
  end if;

  -- a soma dos estornos nunca passa do original. Postergado pela mesma razão
  -- do rateio na 009: vários estornos entram um a um.
  select coalesce(sum(valor), 0) into somado from public.transacoes
   where estorno_de_id = o.id and status <> 'cancelada';
  if somado > o.valor then
    raise exception 'estorno: os estornos somam % e o original é de % -- não dá para devolver mais do que saiu',
      somado, o.valor;
  end if;

  return null;
end $$;

drop trigger if exists transacoes_confere_estorno on public.transacoes;
create constraint trigger transacoes_confere_estorno
  after insert or update on public.transacoes
  deferrable initially deferred
  for each row execute function public.confere_estorno();

-- ---------------------------------------------------------------------
-- 2. ESTORNAR
-- ---------------------------------------------------------------------
-- Herda categoria e origem do original: é o que faz o relatório por categoria
-- fechar em zero quando o estorno é total. O vínculo de verdade é
-- `estorno_de_id`, não a origem.
--
-- `p_valor` nulo significa "o que ainda falta" -- estorno total é o caso
-- comum, e obrigar a redigitar o valor só produz erro de digitação.
create or replace function public.estorna_transacao(
  p_transacao uuid,
  p_valor     numeric default null,
  p_data      date default null,
  p_obs       text default '')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  o public.transacoes%rowtype;
  ja numeric(14,2);
  quanto numeric(14,2);
  nova uuid;
begin
  if auth.uid() is null then
    raise exception 'estorno: é preciso estar logado';
  end if;

  select * into o from public.transacoes where id = p_transacao;
  if o.id is null then
    raise exception 'estorno: transação não encontrada';
  end if;

  select coalesce(sum(valor), 0) into ja from public.transacoes
   where estorno_de_id = o.id and status <> 'cancelada';

  quanto := coalesce(p_valor, o.valor - ja);
  if quanto <= 0 then
    raise exception 'estorno: não há o que estornar -- esta transação já voltou por inteiro';
  end if;

  insert into public.transacoes
    (conta_id, fatura_id, categoria_id, tipo, natureza, estorno_de_id,
     descricao, valor, data, status, origem, origem_id, obs)
  values
    (o.conta_id, o.fatura_id, o.categoria_id,
     case when o.tipo = 'saida' then 'entrada' else 'saida' end,
     'estorno', o.id,
     'Estorno · ' || o.descricao,
     quanto, coalesce(p_data, current_date), 'realizada',
     o.origem, o.origem_id, coalesce(p_obs,''))
  returning id into nova;

  return nova;
end $$;

-- ---------------------------------------------------------------------
-- 3. QUANTO SOBROU PARA ESTORNAR
-- ---------------------------------------------------------------------
-- A tela precisa deste número para não oferecer um estorno que o banco vai
-- recusar. Recusa depois do clique é o defeito que a transferência tinha.
create or replace view public.transacoes_com_estorno
with (security_invoker = on) as
select
  t.id as transacao_id,
  t.user_id,
  t.valor,
  coalesce((select sum(e.valor) from public.transacoes e
             where e.estorno_de_id = t.id and e.user_id = t.user_id
               and e.status <> 'cancelada'), 0)::numeric(14,2) as estornado,
  (t.valor - coalesce((select sum(e.valor) from public.transacoes e
                        where e.estorno_de_id = t.id and e.user_id = t.user_id
                          and e.status <> 'cancelada'), 0))::numeric(14,2) as estornavel,
  -- só transação normal, sem vínculo estrutural, aceita estorno
  (t.natureza = 'normal'
   and not exists (select 1 from public.liquidacoes l
                    where l.transacao_id = t.id and l.user_id = t.user_id)) as pode_estornar
from public.transacoes t;

-- ---------------------------------------------------------------------
-- 4. O TOTAL DA FATURA PASSA A TER SINAL
-- ---------------------------------------------------------------------
-- Um defeito que só existe a partir de agora, e que vale registrar porque foi
-- o contrato do estorno que o revelou.
--
-- `estorna_transacao` herda `fatura_id` do original, e isso está certo:
-- estorno de compra no cartão volta PARA A FATURA, não para a conta -- é o que
-- o cartão faz de verdade. Mas a soma da 007 era
--
--     sum(t.valor)
--
-- sem olhar o tipo. Uma compra de 100 mais o estorno dela de 100 daria uma
-- fatura de 200, quando a resposta certa é zero.
--
-- Enquanto não havia estorno, nenhuma linha de fatura era entrada, e a soma
-- sem sinal dava o mesmo resultado. A partir daqui, não dá.
create or replace view public.faturas_resolvidas
with (security_invoker = on) as
select
  f.id           as fatura_id,
  f.user_id,
  f.cartao_id,
  f.competencia,
  f.abertura,
  f.fechamento,
  f.vencimento,
  f.obs,
  coalesce(sum(case when t.tipo = 'entrada' then -t.valor else t.valor end) filter (
    where t.status in ('realizada','conciliada')), 0)::numeric(14,2) as total,
  count(t.id) filter (where t.id is not null)                        as itens,
  coalesce(l.valor, 0)::numeric(14,2)                                as pago,
  l.transacao_id                                                     as pagamento_id,
  case when l.id is not null            then 'paga'
       when current_date >= f.fechamento then 'fechada'
       else 'aberta' end                                             as situacao
from public.faturas f
left join public.transacoes t
       on t.fatura_id = f.id and t.user_id = f.user_id
left join public.liquidacoes l
       on l.user_id = f.user_id and l.tipo = 'fatura' and l.item_id = f.id::text
group by f.id, f.user_id, f.cartao_id, f.competencia, f.abertura, f.fechamento,
         f.vencimento, f.obs, l.id, l.valor, l.transacao_id;

-- ---------------------------------------------------------------------
-- 5. QUEM PODE CHAMAR
-- ---------------------------------------------------------------------
-- `confere_estorno` é função de GATILHO. Não é API, e a 006 já ensinou isso.
revoke execute on function public.confere_estorno() from public, anon, authenticated;
revoke execute on function public.estorna_transacao(uuid, numeric, date, text) from public, anon;
grant execute on function public.estorna_transacao(uuid, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. CONFERÊNCIA
-- ---------------------------------------------------------------------
select 'transacoes com estorno' as objeto,
       count(*) filter (where natureza = 'estorno') as linhas
  from public.transacoes;

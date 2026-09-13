-- 011 · ASSINATURA SEMANAL: a ocorrência passa a ter identidade própria
--
-- O DEFEITO QUE ESTA MIGRAÇÃO CONSERTA
--
-- A 008 identificava uma ocorrência por `(user_id, assinatura_id, competencia)`,
-- e `competencia` é 'YYYY-MM'. Quatro ou cinco cobranças semanais no mesmo mês
-- não cabem nessa chave: a segunda colide com a primeira.
--
-- A 008 sabia disso e desviou, em vez de modelar errado: `materializa_assinaturas`
-- filtrava `frequencia <> 'semanal'`, e `competencia_da_ocorrencia` devolvia null
-- para semanal -- que o CHECK `ocorrencia_tem_competencia` recusava. O resultado
-- é que assinatura semanal podia ser CADASTRADA e nunca era materializada. Ela
-- aparecia na tela e não virava cobrança nenhuma.
--
-- A CORREÇÃO
--
-- A identidade da ocorrência passa a ser a DATA em que ela acontece, e não o mês
-- em que ela cai: `(user_id, assinatura_id, ocorrencia_em)`. Mês é um recorte de
-- relatório; a cobrança é um evento com data. Para mensal nada muda na prática,
-- porque duas ocorrências mensais nunca caem no mesmo dia.
--
-- `competencia` CONTINUA preenchida para as frequências de mês inteiro, porque é
-- por ela que o resto do produto agrupa. Ela só deixa de ser obrigatória, que é
-- o que libera a semanal.
--
-- IDEMPOTÊNCIA. Continua sendo a `unique` quem garante, agora sobre a data:
-- materializar duas vezes não duplica nada, e é seguro chamar a cada carga.
--
-- JANELA. Continua em dois meses (§20): semanal dá cerca de nove ocorrências
-- nesse intervalo, o que é "o que vem por aí" sem encher o banco de linha que
-- ninguém vai olhar.

begin;

-- ---------------------------------------------------------------- coluna --
alter table public.transacoes
  add column if not exists ocorrencia_em date;

comment on column public.transacoes.ocorrencia_em is
  'A data da ocorrência de uma assinatura. É a identidade dela: mês não serve, '
  'porque semanal tem quatro ou cinco no mesmo mês.';

-- ------------------------------------------------- constraints, parte 1 --
-- As antigas SAEM antes do backfill. A que exigia competência de toda
-- ocorrência é a que barrava a semanal.
alter table public.transacoes
  drop constraint if exists ocorrencia_tem_competencia;
alter table public.transacoes
  drop constraint if exists ocorrencia_unica_por_periodo;

-- ---------------------------------------------------------------- backfill --
-- Preenche o que já existe. `data` É a data da ocorrência nas linhas que a 008
-- gerou -- a função insere `data => quando`, e `quando` é a ocorrência.
update public.transacoes
   set ocorrencia_em = data
 where assinatura_id is not null
   and ocorrencia_em is null;

-- A ORDEM AQUI NÃO É ESTILO, É OBRIGAÇÃO, e o ensaio em transação revertida
-- foi quem mostrou. A 002 criou um gatilho de constraint DIFERIDO para o par
-- da transferência; o `update` acima enfileira eventos desse gatilho, e o
-- Postgres recusa qualquer `alter table` enquanto houver evento pendente:
--
--   55006: cannot ALTER TABLE "transacoes" because it has pending trigger events
--
-- `set constraints all immediate` força a checagem agora e esvazia a fila.
-- Sem esta linha a migração aborta no meio -- com a coluna criada e as
-- constraints antigas já removidas, que é o pior estado possível.
set constraints all immediate;

-- ------------------------------------------------- constraints, parte 2 --
-- As novas entram DEPOIS do backfill, senão as linhas que já existem violam
-- o CHECK no instante em que ele é criado.
alter table public.transacoes
  drop constraint if exists ocorrencia_tem_data;
alter table public.transacoes
  add constraint ocorrencia_tem_data
  check ((assinatura_id is null) = (ocorrencia_em is null));

alter table public.transacoes
  drop constraint if exists ocorrencia_unica_por_data;
alter table public.transacoes
  add constraint ocorrencia_unica_por_data
  unique (user_id, assinatura_id, ocorrencia_em);

-- ------------------------------------------------------------ competência --
-- Deixa de devolver null para semanal: a competência ainda serve para agrupar
-- num relatório mensal, e null ali obrigaria todo consumidor a tratar o caso.
-- Quem garante a unicidade agora é a data, então não há risco em preenchê-la.
create or replace function public.competencia_da_ocorrencia(p_data date, p_frequencia text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select to_char(p_data, 'YYYY-MM');
$$;

-- --------------------------------------------------------- materialização --
create or replace function public.materializa_assinaturas(p_ate date default null)
returns integer
language plpgsql
set search_path to 'public'
as $$
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

  -- SEM o filtro de semanal: era ele o desvio que a 008 fez por não ter como
  -- guardar quatro ocorrências no mesmo mês.
  for a in select * from public.assinaturas
            where ativo
              and (fim is null or fim >= current_date)
  loop
    quando := a.inicio;
    voltas := 0;
    -- pula o que já passou: o que interessa é o que ainda vem. O contador não
    -- é paranoia -- uma data de início absurda faria este laço rodar milhares
    -- de vezes dentro de uma transação de banco. Semanal gasta 52 voltas por
    -- ano de atraso, então o teto sobe para caber uma assinatura antiga.
    while quando < current_date loop
      quando := (quando + public.passo_da_frequencia(a.frequencia))::date;
      voltas := voltas + 1;
      if voltas > 5000 then
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
        (conta_id, fatura_id, assinatura_id, competencia, ocorrencia_em, categoria_id,
         tipo, natureza, descricao, valor, data, status, origem, origem_id, obs)
      values
        (a.conta_id, fatura, a.id, comp, quando, a.categoria_id,
         'saida', 'normal', a.nome, a.valor, quando, 'prevista', 'recorrencia', a.id::text, '')
      on conflict (user_id, assinatura_id, ocorrencia_em) do nothing;

      if found then criadas := criadas + 1; end if;
      quando := (quando + public.passo_da_frequencia(a.frequencia))::date;
    end loop;
  end loop;

  return criadas;
end $$;

commit;

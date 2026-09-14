-- =====================================================================
-- 018 · `regra_desde` na view, que a 017 esqueceu
-- =====================================================================
-- As migrações 001..017 são IMUTÁVEIS. Esta existe porque a 017 acrescentou
-- `metas.regra_desde` e NÃO recriou `metas_resolvidas` -- e é a view que o
-- app lê, não a tabela.
--
-- O EFEITO DO ESQUECIMENTO, se ficasse assim: `regraDesde` chegaria
-- `undefined` na tela, `regraVigente()` responderia `false` para toda meta,
-- e NENHUMA competência pendente apareceria. A automação continuaria
-- rodando (ela lê a tabela, pelo banco), mas a parte do Modelo C que pede
-- decisão ficaria invisível. Silencioso, e do pior tipo: sem erro nenhum.
--
-- COMO PASSOU: o dublê dos testes de navegador devolvia `regra_desde` na
-- view, porque foi escrito a partir do modelo e não do catálogo. Ele era
-- mais generoso que o banco de verdade, e por isso o fluxo passava. A
-- conferência que pegou foi a comparação de colunas entre a view real e o
-- que o domínio consome -- e entrou um caso de teste para cobrar isso, na
-- suíte da 017.
--
-- Conserto vira migração nova; é por isso que existe uma 003 de duas linhas
-- em vez de um remendo na 002.
--
-- A view é recriada com a definição EXATA que estava no banco, mais uma
-- coluna no fim. Nada mais muda: mesmo `security_invoker`, mesmas contas,
-- mesma ordem de colunas até `regra_ativa`.

create or replace view public.metas_resolvidas with (security_invoker = true) as
 SELECT m.id AS meta_id,
    m.user_id,
    m.nome,
    m.valor_alvo,
    m.prazo,
    m.prioridade,
    m.cor,
    m.icone,
    m.status,
    m.obs,
    m.ordem,
    m.criado_em,
    COALESCE(a.reservado, 0::numeric)::numeric(14,2) AS reservado,
    GREATEST(m.valor_alvo - COALESCE(a.reservado, 0::numeric), 0::numeric)::numeric(14,2) AS falta,
    COALESCE(a.quantas, 0::bigint) AS alocacoes,
    LEAST(round(COALESCE(a.reservado, 0::numeric) * 100::numeric / m.valor_alvo), 100::numeric)::integer AS percentual,
        CASE
            WHEN m.prazo IS NULL THEN NULL::integer
            ELSE GREATEST(1, (date_part('year'::text, age(m.prazo::timestamp with time zone, CURRENT_DATE::timestamp with time zone)) * 12::double precision + date_part('month'::text, age(m.prazo::timestamp with time zone, CURRENT_DATE::timestamp with time zone)))::integer + 1)
        END AS meses_ate_prazo,
    m.regra_valor,
    m.regra_ativa,
    m.regra_desde
   FROM metas m
     LEFT JOIN LATERAL ( SELECT sum(x.valor) AS reservado,
            count(*) AS quantas
           FROM alocacoes_de_meta x
          WHERE x.meta_id = m.id AND x.user_id = m.user_id) a ON true;

-- `create or replace view` preserva dono e permissões, mas o revoke explícito
-- fica aqui pela mesma razão da 013: o que se concede tem de ser o que se quis
-- conceder, e não o que sobrou de antes.
revoke all on table public.metas_resolvidas from public, anon, authenticated, service_role;
grant delete, insert, references, select, trigger, truncate, update
  on table public.metas_resolvidas to anon, authenticated, service_role;

do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'metas_resolvidas'
     and column_name in ('regra_valor','regra_ativa','regra_desde');
  raise notice '018 pronta: a view expõe % das 3 colunas de regra', n;
end $$;

-- ---------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------
-- Recriar a view sem a última coluna, com a definição que está em
-- `016_v2_regra_de_alocacao.sql`. Nada mais precisa ser desfeito: esta
-- migração não cria tabela, coluna, índice nem constraint.

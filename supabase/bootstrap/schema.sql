-- =============================================================================
-- BOOTSTRAP · o schema inteiro, de uma vez, num projeto Supabase VAZIO
-- =============================================================================
--
-- PARA QUE SERVE
--
-- Recuperar o banco em um projeto Supabase novo sem depender de lembrar a
-- ordem de `supabase-setup.sql` (a V1) mais catorze migrações. Este arquivo é
-- o RESULTADO daquela história, lido do catálogo do banco em produção e
-- reescrito em ordem de dependência.
--
-- O QUE ELE NÃO É
--
-- Não é migração e não substitui `supabase/migrations/`. Aquelas continuam
-- sendo o registro do que aconteceu, e continuam imutáveis. Este arquivo é o
-- ponto de partida de uma instalação NOVA -- e só isso.
--
-- Não é `supabase-setup.sql`. Aquele é a V1, história, e segue onde está.
--
-- NÃO É REEXECUTÁVEL, DE PROPÓSITO
--
-- Um bootstrap que "conserta o que faltar" esconde o estado em que o banco
-- estava. Este aqui roda uma vez, num banco limpo, e aborta na primeira linha
-- se encontrar qualquer coisa já criada. Sem `if not exists`, sem `or replace`.
-- Se ele falhou no meio, o banco está pela metade: descarte o projeto e comece
-- de novo. Em banco vazio isso não custa nada, e é exatamente por isso que o
-- arquivo se recusa a rodar em banco que não está vazio.
--
-- ESTRUTURA, NENHUM DADO
--
-- Nenhuma linha de nenhuma tabela de usuário passa por aqui. Carga de exemplo,
-- quem quiser, está em `seed.sql`, e é sintética.
--
-- COMO RODAR: leia `README.md`, nesta mesma pasta. Resumo: crie o projeto,
-- abra o SQL Editor, cole este arquivo inteiro, execute.
--
-- DE ONDE VEIO: gerado do catálogo de um banco que é V1 + migrações 001..014.
-- `ferramentas/confere-schema.mjs` compara os dois e falha se divergirem.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. A GUARDA
-- -----------------------------------------------------------------------------
-- Duas perguntas, nesta ordem: o ambiente serve, e o banco está vazio.
--
-- A primeira porque este schema presume um projeto Supabase de verdade -- os
-- papéis do PostgREST e o `auth` já existem lá, e não é papel deste arquivo
-- criá-los. A segunda porque bootstrap em banco habitado é como se descobre,
-- tarde, que dois esquemas foram misturados.

do $$
declare
  faltando text;
  ocupado text;
begin
  -- o ambiente
  select string_agg(p, ', ' order by p) into faltando from (
    select 'papel ' || r as p from unnest(array['anon','authenticated','service_role']) r
     where not exists (select 1 from pg_roles where rolname = r)
    union all
    select 'schema auth' where not exists (select 1 from pg_namespace where nspname = 'auth')
    union all
    select 'auth.uid()' where to_regprocedure('auth.uid()') is null
    union all
    select 'auth.users' where to_regclass('auth.users') is null
  ) f;
  if faltando is not null then
    raise exception E'Este schema presume um projeto Supabase. Não encontrei: %.\nSe o alvo é um Postgres avulso, rode antes ferramentas/sala-limpa.sql.', faltando;
  end if;

  -- o banco
  select string_agg(c.relname, ', ' order by c.relname) into ocupado
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','v');
  if ocupado is not null then
    raise exception E'O schema public já tem objeto: %.\nEste bootstrap só roda em banco vazio. Crie um projeto novo.', ocupado;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 1. EXTENSÕES
-- -----------------------------------------------------------------------------
-- Nenhuma. `gen_random_uuid()` é nativa do Postgres desde a 13, e é a única
-- função de fora do projeto que o schema usa.
--
-- O projeto em produção tem quatro extensões instaladas -- pg_stat_statements,
-- pgcrypto, supabase_vault e uuid-ossp -- e nenhuma delas foi criada por este
-- projeto: vêm de fábrica com qualquer projeto Supabase. Criá-las aqui daria a
-- impressão errada de que o app depende delas.


-- -----------------------------------------------------------------------------
-- 2. TABELAS
-- -----------------------------------------------------------------------------
-- Em ordem alfabética: as dependências entre elas moram nas chaves
-- estrangeiras, que vêm depois, e não na ordem de criação.

create table public.acertos (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  grupo_id uuid not null,
  de_id uuid not null,
  para_id uuid not null,
  valor numeric(14,2) not null,
  data date not null,
  transacao_id uuid,
  obs text default ''::text not null,
  criado_em timestamp with time zone default now() not null
);

create table public.alocacoes_de_meta (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  meta_id uuid not null,
  valor numeric(14,2) not null,
  data date default CURRENT_DATE not null,
  obs text default ''::text not null,
  criado_em timestamp with time zone default now() not null
);

create table public.assinaturas (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  nome text not null,
  logo text default ''::text not null,
  valor numeric(14,2) not null,
  frequencia text default 'mensal'::text not null,
  categoria_id uuid,
  conta_id uuid,
  cartao_id uuid,
  inicio date not null,
  fim date,
  ativo boolean default true not null,
  obs text default ''::text not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null
);

create table public.cartoes (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  instituicao_id uuid,
  nome text not null,
  apelido text default ''::text not null,
  final text,
  limite numeric(14,2),
  dia_fechamento smallint not null,
  dia_vencimento smallint not null,
  conta_padrao_id uuid,
  cor text,
  ativo boolean default true not null,
  obs text default ''::text not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null
);

create table public.categorias (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  pai_id uuid,
  nome text not null,
  nivel smallint default 1 not null,
  fluxo text default 'saida'::text not null,
  cor text,
  icone text default ''::text not null,
  ativo boolean default true not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null
);

create table public.compras_de_cartao (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  cartao_id uuid not null,
  categoria_id uuid,
  descricao text not null,
  valor_total numeric(14,2) not null,
  data_compra date not null,
  total_parcelas smallint default 1 not null,
  obs text default ''::text not null,
  criado_em timestamp with time zone default now() not null
);

create table public.config (
  user_id uuid not null,
  renda numeric(12,2) default 0 not null
);

create table public.contas (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  instituicao_id uuid,
  nome text not null,
  tipo text default 'corrente'::text not null,
  saldo_inicial numeric(14,2) default 0 not null,
  saldo_inicial_em date default CURRENT_DATE not null,
  liquidez text default 'livre'::text not null,
  moeda text default 'BRL'::text not null,
  ativo boolean default true not null,
  obs text default ''::text not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null
);

create table public.credores (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  nome text not null,
  tipo text default 'Pessoa'::text not null,
  contato text default ''::text not null,
  obs text default ''::text not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null,
  ativo boolean default true not null,
  dia_fechamento smallint,
  dia_vencimento smallint,
  credor_pai_id uuid
);

create table public.despesas_do_grupo (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  grupo_id uuid not null,
  pago_por_id uuid not null,
  categoria_id uuid,
  descricao text not null,
  valor numeric(14,2) not null,
  data date not null,
  obs text default ''::text not null,
  criado_em timestamp with time zone default now() not null
);

create table public.dividas (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  credor text not null,
  descricao text not null,
  categoria text default 'Terceiros'::text not null,
  valor numeric(12,2) not null,
  parcela_inicial integer default 1 not null,
  total_parcelas integer default 1 not null,
  mes_inicial text not null,
  obs text default ''::text not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null,
  credor_id uuid,
  meio text default 'Outro'::text not null,
  data_compra date,
  pessoa_id uuid,
  valor_terceiro numeric(12,2) default 0 not null
);

create table public.faturas (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  cartao_id uuid not null,
  competencia text not null,
  abertura date not null,
  fechamento date not null,
  vencimento date not null,
  obs text default ''::text not null,
  criado_em timestamp with time zone default now() not null
);

create table public.fixas (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  nome text not null,
  valor numeric(12,2) not null,
  obs text default ''::text not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null,
  categoria text default 'Moradia'::text not null,
  meio text default 'Debito automatico'::text not null,
  credor text default ''::text not null,
  credor_id uuid,
  variavel boolean default false not null
);

create table public.fixas_mes (
  user_id uuid not null,
  fixa_id uuid not null,
  mes text not null,
  valor numeric(12,2) not null,
  criado_em timestamp with time zone default now() not null
);

create table public.grupos (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  nome text not null,
  obs text default ''::text not null,
  ativo boolean default true not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null
);

create table public.instituicoes (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  nome text not null,
  tipo text default 'Banco'::text not null,
  logo text default ''::text not null,
  cor text,
  ativo boolean default true not null,
  obs text default ''::text not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null
);

create table public.liquidacoes (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  tipo text not null,
  item_id text not null,
  competencia text not null,
  transacao_id uuid not null,
  valor numeric(14,2) not null,
  criado_em timestamp with time zone default now() not null
);

create table public.membros (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  grupo_id uuid not null,
  nome text not null,
  apelido text default ''::text not null,
  sou_eu boolean default false not null,
  ativo boolean default true not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null
);

create table public.metas (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  nome text not null,
  valor_alvo numeric(14,2) not null,
  prazo date,
  prioridade smallint default 2 not null,
  cor text default ''::text not null,
  icone text default ''::text not null,
  status text default 'ativa'::text not null,
  obs text default ''::text not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null
);

create table public.pagamentos (
  user_id uuid not null,
  mes text not null,
  item_id text not null,
  pago_em timestamp with time zone default now() not null
);

create table public.ping (
  id integer not null,
  visto_em timestamp with time zone default now() not null
);

create table public.rateios (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  despesa_id uuid not null,
  membro_id uuid not null,
  valor numeric(14,2) not null,
  criado_em timestamp with time zone default now() not null
);

create table public.receitas (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  descricao text not null,
  categoria text default 'Extra'::text not null,
  valor numeric(12,2) not null,
  tipo text default 'pontual'::text not null,
  mes_inicial text,
  mes_final text,
  obs text default ''::text not null,
  ordem integer default 0 not null,
  criado_em timestamp with time zone default now() not null
);

create table public.transacoes (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  conta_id uuid,
  categoria_id uuid,
  tipo text not null,
  descricao text not null,
  valor numeric(14,2) not null,
  data date not null,
  status text default 'realizada'::text not null,
  origem text default 'manual'::text not null,
  origem_id text default ''::text not null,
  obs text default ''::text not null,
  criado_em timestamp with time zone default now() not null,
  natureza text default 'normal'::text not null,
  transferencia_id uuid,
  estorno_de_id uuid,
  fatura_id uuid,
  compra_id uuid,
  parcela smallint,
  total_parcelas smallint,
  assinatura_id uuid,
  competencia text,
  ocorrencia_em date
);


-- -----------------------------------------------------------------------------
-- 3. CHAVES PRIMÁRIAS E ÚNICAS
-- -----------------------------------------------------------------------------
-- Vêm antes das estrangeiras porque é nelas que as estrangeiras se apoiam.
--
-- O par `(user_id, id)` único em quase toda tabela não é redundância: é o que
-- permite a FK COMPOSTA da seção seguinte. Conferência de FK roda por dentro
-- do RLS, então uma FK só por `id` aceitaria apontar para linha de outra
-- pessoa; a composta não aceita, porque o `user_id` precisa bater.

alter table public.acertos add constraint acertos_pkey primary key (id);
alter table public.alocacoes_de_meta add constraint alocacoes_de_meta_pkey primary key (id);
alter table public.assinaturas add constraint assinaturas_pkey primary key (id);
alter table public.cartoes add constraint cartoes_pkey primary key (id);
alter table public.categorias add constraint categorias_pkey primary key (id);
alter table public.compras_de_cartao add constraint compras_de_cartao_pkey primary key (id);
alter table public.config add constraint config_pkey primary key (user_id);
alter table public.contas add constraint contas_pkey primary key (id);
alter table public.credores add constraint credores_pkey primary key (id);
alter table public.despesas_do_grupo add constraint despesas_do_grupo_pkey primary key (id);
alter table public.dividas add constraint dividas_pkey primary key (id);
alter table public.faturas add constraint faturas_pkey primary key (id);
alter table public.fixas add constraint fixas_pkey primary key (id);
alter table public.fixas_mes add constraint fixas_mes_pkey primary key (user_id, fixa_id, mes);
alter table public.grupos add constraint grupos_pkey primary key (id);
alter table public.instituicoes add constraint instituicoes_pkey primary key (id);
alter table public.liquidacoes add constraint liquidacoes_pkey primary key (id);
alter table public.membros add constraint membros_pkey primary key (id);
alter table public.metas add constraint metas_pkey primary key (id);
alter table public.pagamentos add constraint pagamentos_pkey primary key (user_id, mes, item_id);
alter table public.ping add constraint ping_pkey primary key (id);
alter table public.rateios add constraint rateios_pkey primary key (id);
alter table public.receitas add constraint receitas_pkey primary key (id);
alter table public.transacoes add constraint transacoes_pkey primary key (id);

alter table public.acertos add constraint acertos_dono_id_unico unique (user_id, id);
alter table public.assinaturas add constraint assinatura_nome_unico unique (user_id, nome);
alter table public.assinaturas add constraint assinaturas_dono_id_unico unique (user_id, id);
alter table public.cartoes add constraint cartao_nome_unico unique (user_id, nome);
alter table public.cartoes add constraint cartoes_dono_id_unico unique (user_id, id);
-- `nulls not distinct`: duas categorias de primeiro nível com o mesmo nome têm
-- `pai_id` nulo nas duas, e sem isto o único não pegaria a repetição.
alter table public.categorias add constraint categoria_nome_unico_no_pai unique nulls not distinct (user_id, pai_id, nome);
alter table public.categorias add constraint categorias_dono_id_unico unique (user_id, id);
alter table public.compras_de_cartao add constraint compras_dono_id_unico unique (user_id, id);
alter table public.contas add constraint conta_nome_unico unique (user_id, nome);
alter table public.contas add constraint contas_dono_id_unico unique (user_id, id);
alter table public.credores add constraint credor_nome_unico unique (user_id, nome);
alter table public.despesas_do_grupo add constraint despesas_do_grupo_dono_id_unico unique (user_id, id);
alter table public.faturas add constraint fatura_uma_por_ciclo unique (user_id, cartao_id, competencia);
alter table public.faturas add constraint faturas_dono_id_unico unique (user_id, id);
alter table public.grupos add constraint grupo_nome_unico unique (user_id, nome);
alter table public.grupos add constraint grupos_dono_id_unico unique (user_id, id);
alter table public.instituicoes add constraint instituicao_nome_unico unique (user_id, nome);
alter table public.instituicoes add constraint instituicoes_dono_id_unico unique (user_id, id);
alter table public.liquidacoes add constraint liquidacao_uma_por_transacao unique (user_id, transacao_id);
alter table public.membros add constraint membro_nome_unico_no_grupo unique (user_id, grupo_id, nome);
alter table public.membros add constraint membros_dono_id_unico unique (user_id, id);
alter table public.metas add constraint metas_dono_id_unico unique (user_id, id);
alter table public.rateios add constraint rateio_um_por_membro unique (user_id, despesa_id, membro_id);
alter table public.rateios add constraint rateios_dono_id_unico unique (user_id, id);
alter table public.transacoes add constraint ocorrencia_unica_por_data unique (user_id, assinatura_id, ocorrencia_em);
alter table public.transacoes add constraint parcela_unica_por_compra unique (user_id, compra_id, parcela);
alter table public.transacoes add constraint transacoes_dono_id_unico unique (user_id, id);


-- -----------------------------------------------------------------------------
-- 4. CHECKS
-- -----------------------------------------------------------------------------

alter table public.acertos add constraint acerto_entre_dois check ((de_id <> para_id));
alter table public.acertos add constraint acertos_valor_check check ((valor > (0)::numeric));
alter table public.alocacoes_de_meta add constraint alocacao_valor_check check ((valor <> (0)::numeric));
alter table public.assinaturas add constraint assinatura_fim_depois_do_inicio check (((fim is null) or (fim >= inicio)));
alter table public.assinaturas add constraint assinatura_paga_por_um_lugar_so check (((conta_id is null) or (cartao_id is null)));
alter table public.assinaturas add constraint assinaturas_frequencia_check check ((frequencia = any (array['semanal'::text, 'mensal'::text, 'bimestral'::text, 'trimestral'::text, 'semestral'::text, 'anual'::text])));
alter table public.assinaturas add constraint assinaturas_nome_check check (((length(nome) >= 1) and (length(nome) <= 60)));
alter table public.assinaturas add constraint assinaturas_valor_check check ((valor > (0)::numeric));
alter table public.cartoes add constraint cartoes_apelido_check check ((length(apelido) <= 40));
alter table public.cartoes add constraint cartoes_cor_check check (((cor is null) or (cor ~ '^#[0-9A-Fa-f]{6}$'::text)));
alter table public.cartoes add constraint cartoes_dia_fechamento_check check (((dia_fechamento >= 1) and (dia_fechamento <= 31)));
alter table public.cartoes add constraint cartoes_dia_vencimento_check check (((dia_vencimento >= 1) and (dia_vencimento <= 31)));
alter table public.cartoes add constraint cartoes_final_check check (((final is null) or (final ~ '^[0-9]{4}$'::text)));
alter table public.cartoes add constraint cartoes_limite_check check (((limite is null) or (limite >= (0)::numeric)));
alter table public.cartoes add constraint cartoes_nome_check check (((length(nome) >= 1) and (length(nome) <= 60)));
alter table public.categorias add constraint categoria_nao_e_pai_de_si check (((pai_id is null) or (pai_id <> id)));
alter table public.categorias add constraint categorias_cor_check check (((cor is null) or (cor ~ '^#[0-9A-Fa-f]{6}$'::text)));
alter table public.categorias add constraint categorias_fluxo_check check ((fluxo = any (array['entrada'::text, 'saida'::text, 'ambos'::text])));
alter table public.categorias add constraint categorias_nivel_check check (((nivel >= 1) and (nivel <= 3)));
alter table public.compras_de_cartao add constraint compras_de_cartao_descricao_check check (((length(descricao) >= 1) and (length(descricao) <= 120)));
alter table public.compras_de_cartao add constraint compras_de_cartao_total_parcelas_check check (((total_parcelas >= 1) and (total_parcelas <= 72)));
alter table public.compras_de_cartao add constraint compras_de_cartao_valor_total_check check ((valor_total > (0)::numeric));
alter table public.config add constraint config_renda_check check ((renda >= (0)::numeric));
alter table public.contas add constraint contas_liquidez_check check ((liquidez = any (array['livre'::text, 'restrita'::text, 'bloqueada'::text])));
alter table public.contas add constraint contas_tipo_check check ((tipo = any (array['corrente'::text, 'poupanca'::text, 'carteira'::text, 'investimento'::text, 'fgts'::text, 'outro'::text])));
alter table public.credores add constraint credores_dia_fechamento_check check (((dia_fechamento is null) or ((dia_fechamento >= 1) and (dia_fechamento <= 31))));
alter table public.credores add constraint credores_dia_vencimento_check check (((dia_vencimento is null) or ((dia_vencimento >= 1) and (dia_vencimento <= 31))));
alter table public.credores add constraint credores_pai_nao_e_si check (((credor_pai_id is null) or (credor_pai_id <> id)));
alter table public.despesas_do_grupo add constraint despesas_do_grupo_descricao_check check (((length(descricao) >= 1) and (length(descricao) <= 120)));
alter table public.despesas_do_grupo add constraint despesas_do_grupo_valor_check check ((valor > (0)::numeric));
alter table public.dividas add constraint dividas_mes_inicial_check check ((mes_inicial ~ '^\d{4}-\d{2}$'::text));
alter table public.dividas add constraint dividas_parcela_inicial_check check ((parcela_inicial >= 1));
alter table public.dividas add constraint dividas_total_parcelas_check check ((total_parcelas >= 1));
alter table public.dividas add constraint dividas_valor_check check ((valor >= (0)::numeric));
alter table public.dividas add constraint dividas_valor_terceiro_check check ((valor_terceiro >= (0)::numeric));
alter table public.dividas add constraint parcela_dentro_do_total check ((parcela_inicial <= total_parcelas));
alter table public.dividas add constraint terceiro_cabe_no_valor check ((valor_terceiro <= valor));
alter table public.dividas add constraint terceiro_tem_pessoa check (((valor_terceiro = (0)::numeric) or (pessoa_id is not null)));
alter table public.faturas add constraint fatura_janela_coerente check ((abertura < fechamento));
alter table public.faturas add constraint fatura_vence_depois_de_fechar check ((vencimento >= fechamento));
alter table public.faturas add constraint faturas_competencia_check check ((competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'::text));
alter table public.fixas add constraint fixas_valor_check check ((valor >= (0)::numeric));
alter table public.fixas_mes add constraint fixas_mes_mes_check check ((mes ~ '^[0-9]{4}-[0-9]{2}$'::text));
alter table public.fixas_mes add constraint fixas_mes_valor_check check ((valor >= (0)::numeric));
alter table public.grupos add constraint grupos_nome_check check (((length(nome) >= 1) and (length(nome) <= 60)));
alter table public.instituicoes add constraint instituicoes_cor_check check (((cor is null) or (cor ~ '^#[0-9A-Fa-f]{6}$'::text)));
alter table public.instituicoes add constraint instituicoes_tipo_check check ((tipo = any (array['Banco'::text, 'Corretora'::text, 'Fintech'::text, 'Carteira'::text, 'Empregador'::text, 'Outro'::text])));
alter table public.liquidacoes add constraint liquidacoes_competencia_check check ((competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'::text));
alter table public.liquidacoes add constraint liquidacoes_item_id_check check (((length(item_id) >= 1) and (length(item_id) <= 80)));
alter table public.liquidacoes add constraint liquidacoes_tipo_check check ((tipo = any (array['divida'::text, 'fixa'::text, 'receita'::text, 'fatura'::text])));
alter table public.liquidacoes add constraint liquidacoes_valor_check check ((valor > (0)::numeric));
alter table public.membros add constraint membros_apelido_check check ((length(apelido) <= 30));
alter table public.membros add constraint membros_nome_check check (((length(nome) >= 1) and (length(nome) <= 60)));
alter table public.metas add constraint metas_nome_check check (((length(nome) >= 1) and (length(nome) <= 80)));
alter table public.metas add constraint metas_prioridade_check check (((prioridade >= 1) and (prioridade <= 3)));
alter table public.metas add constraint metas_status_check check ((status = any (array['ativa'::text, 'concluida'::text, 'arquivada'::text])));
alter table public.metas add constraint metas_valor_alvo_check check ((valor_alvo > (0)::numeric));
alter table public.pagamentos add constraint pagamentos_mes_check check ((mes ~ '^\d{4}-\d{2}$'::text));
alter table public.rateios add constraint rateios_valor_check check ((valor >= (0)::numeric));
alter table public.receitas add constraint receita_intervalo_valido check (((mes_final is null) or (mes_inicial is null) or (mes_final >= mes_inicial)));
alter table public.receitas add constraint receita_pontual_tem_mes check (((tipo <> 'pontual'::text) or (mes_inicial is not null)));
alter table public.receitas add constraint receitas_mes_final_check check ((mes_final ~ '^\d{4}-\d{2}$'::text));
alter table public.receitas add constraint receitas_mes_inicial_check check ((mes_inicial ~ '^\d{4}-\d{2}$'::text));
alter table public.receitas add constraint receitas_tipo_check check ((tipo = any (array['mensal'::text, 'pontual'::text])));
alter table public.receitas add constraint receitas_valor_check check ((valor >= (0)::numeric));
alter table public.transacoes add constraint estorno_tem_original check (((natureza = 'estorno'::text) = (estorno_de_id is not null)));
alter table public.transacoes add constraint ocorrencia_tem_data check (((assinatura_id is null) = (ocorrencia_em is null)));
alter table public.transacoes add constraint pagamento_de_fatura_sai_de_conta check (((natureza <> 'pagamento_de_fatura'::text) or (conta_id is not null)));
alter table public.transacoes add constraint parcela_mora_numa_fatura check (((compra_id is null) or (fatura_id is not null)));
alter table public.transacoes add constraint parcela_numerada_direito check (((parcela is null) or ((parcela >= 1) and (total_parcelas is not null) and (parcela <= total_parcelas))));
alter table public.transacoes add constraint parcela_tem_compra check (((compra_id is null) = (parcela is null)));
alter table public.transacoes add constraint transacao_competencia_formato check (((competencia is null) or (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'::text)));
alter table public.transacoes add constraint transacao_nao_e_conta_e_fatura check (((fatura_id is null) or (conta_id is null)));
alter table public.transacoes add constraint transacao_nao_estorna_a_si check (((estorno_de_id is null) or (estorno_de_id <> id)));
alter table public.transacoes add constraint transacoes_natureza_check check ((natureza = any (array['normal'::text, 'transferencia'::text, 'estorno'::text, 'pagamento_de_fatura'::text])));
alter table public.transacoes add constraint transacoes_origem_check check ((origem = any (array['manual'::text, 'divida'::text, 'fixa'::text, 'receita'::text, 'recorrencia'::text, 'cartao'::text, 'importacao'::text, 'mensagem'::text])));
alter table public.transacoes add constraint transacoes_status_check check ((status = any (array['prevista'::text, 'realizada'::text, 'conciliada'::text, 'cancelada'::text])));
alter table public.transacoes add constraint transacoes_tipo_check check ((tipo = any (array['entrada'::text, 'saida'::text])));
alter table public.transacoes add constraint transacoes_valor_check check ((valor > (0)::numeric));
alter table public.transacoes add constraint transferencia_tem_grupo check (((natureza = 'transferencia'::text) = (transferencia_id is not null)));


-- -----------------------------------------------------------------------------
-- 5. CHAVES ESTRANGEIRAS
-- -----------------------------------------------------------------------------
-- Todas as tabelas já existem acima, então a ordem aqui é só alfabética.
--
-- Duas famílias. As `_user_id_fkey` amarram o dono a `auth.users`. As
-- compostas, `(user_id, x_id) -> alvo(user_id, id)`, são a proteção real: a
-- conferência de FK roda por fora do RLS, e sem o `user_id` no par seria
-- possível apontar para linha de outra pessoa.

alter table public.acertos add constraint acertos_de_dono_fk foreign key (user_id, de_id) references public.membros(user_id, id) on update cascade on delete restrict;
alter table public.acertos add constraint acertos_grupo_dono_fk foreign key (user_id, grupo_id) references public.grupos(user_id, id) on update cascade on delete cascade;
alter table public.acertos add constraint acertos_para_dono_fk foreign key (user_id, para_id) references public.membros(user_id, id) on update cascade on delete restrict;
alter table public.acertos add constraint acertos_transacao_dono_fk foreign key (user_id, transacao_id) references public.transacoes(user_id, id) on update cascade on delete set null (transacao_id);
alter table public.acertos add constraint acertos_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.alocacoes_de_meta add constraint alocacao_da_meta_do_dono foreign key (user_id, meta_id) references public.metas(user_id, id) on delete cascade;
alter table public.assinaturas add constraint assinaturas_cartao_dono_fk foreign key (user_id, cartao_id) references public.cartoes(user_id, id) on update cascade on delete set null (cartao_id);
alter table public.assinaturas add constraint assinaturas_categoria_dono_fk foreign key (user_id, categoria_id) references public.categorias(user_id, id) on update cascade on delete set null (categoria_id);
alter table public.assinaturas add constraint assinaturas_conta_dono_fk foreign key (user_id, conta_id) references public.contas(user_id, id) on update cascade on delete set null (conta_id);
alter table public.assinaturas add constraint assinaturas_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.cartoes add constraint cartoes_conta_padrao_dono_fk foreign key (user_id, conta_padrao_id) references public.contas(user_id, id) on update cascade on delete set null (conta_padrao_id);
alter table public.cartoes add constraint cartoes_instituicao_dono_fk foreign key (user_id, instituicao_id) references public.instituicoes(user_id, id) on update cascade on delete set null (instituicao_id);
alter table public.cartoes add constraint cartoes_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.categorias add constraint categorias_pai_dono_fk foreign key (user_id, pai_id) references public.categorias(user_id, id) on update cascade on delete cascade;
alter table public.categorias add constraint categorias_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.compras_de_cartao add constraint compras_cartao_dono_fk foreign key (user_id, cartao_id) references public.cartoes(user_id, id) on update cascade on delete cascade;
alter table public.compras_de_cartao add constraint compras_categoria_dono_fk foreign key (user_id, categoria_id) references public.categorias(user_id, id) on update cascade on delete set null (categoria_id);
alter table public.compras_de_cartao add constraint compras_de_cartao_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.config add constraint config_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.contas add constraint contas_instituicao_dono_fk foreign key (user_id, instituicao_id) references public.instituicoes(user_id, id) on update cascade on delete set null (instituicao_id);
alter table public.contas add constraint contas_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.credores add constraint credores_credor_pai_id_fkey foreign key (credor_pai_id) references public.credores(id) on delete set null;
alter table public.credores add constraint credores_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.despesas_do_grupo add constraint despesas_categoria_dono_fk foreign key (user_id, categoria_id) references public.categorias(user_id, id) on update cascade on delete set null (categoria_id);
alter table public.despesas_do_grupo add constraint despesas_do_grupo_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.despesas_do_grupo add constraint despesas_grupo_dono_fk foreign key (user_id, grupo_id) references public.grupos(user_id, id) on update cascade on delete cascade;
alter table public.despesas_do_grupo add constraint despesas_pagador_dono_fk foreign key (user_id, pago_por_id) references public.membros(user_id, id) on update cascade on delete restrict;
alter table public.dividas add constraint dividas_credor_id_fkey foreign key (credor_id) references public.credores(id) on delete set null;
alter table public.dividas add constraint dividas_pessoa_id_fkey foreign key (pessoa_id) references public.credores(id) on delete set null;
alter table public.dividas add constraint dividas_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.faturas add constraint faturas_cartao_dono_fk foreign key (user_id, cartao_id) references public.cartoes(user_id, id) on update cascade on delete cascade;
alter table public.faturas add constraint faturas_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.fixas add constraint fixas_credor_id_fkey foreign key (credor_id) references public.credores(id) on delete set null;
alter table public.fixas add constraint fixas_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.fixas_mes add constraint fixas_mes_fixa_id_fkey foreign key (fixa_id) references public.fixas(id) on delete cascade;
alter table public.fixas_mes add constraint fixas_mes_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.grupos add constraint grupos_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.instituicoes add constraint instituicoes_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.liquidacoes add constraint liquidacoes_transacao_dono_fk foreign key (user_id, transacao_id) references public.transacoes(user_id, id) on update cascade on delete cascade;
alter table public.liquidacoes add constraint liquidacoes_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.membros add constraint membros_grupo_dono_fk foreign key (user_id, grupo_id) references public.grupos(user_id, id) on update cascade on delete cascade;
alter table public.membros add constraint membros_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.pagamentos add constraint pagamentos_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.rateios add constraint rateios_despesa_dono_fk foreign key (user_id, despesa_id) references public.despesas_do_grupo(user_id, id) on update cascade on delete cascade;
alter table public.rateios add constraint rateios_membro_dono_fk foreign key (user_id, membro_id) references public.membros(user_id, id) on update cascade on delete restrict;
alter table public.rateios add constraint rateios_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.receitas add constraint receitas_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.transacoes add constraint transacoes_assinatura_dono_fk foreign key (user_id, assinatura_id) references public.assinaturas(user_id, id) on update cascade on delete set null (assinatura_id);
alter table public.transacoes add constraint transacoes_categoria_dono_fk foreign key (user_id, categoria_id) references public.categorias(user_id, id) on update cascade on delete set null (categoria_id);
alter table public.transacoes add constraint transacoes_compra_dono_fk foreign key (user_id, compra_id) references public.compras_de_cartao(user_id, id) on update cascade on delete cascade;
alter table public.transacoes add constraint transacoes_conta_dono_fk foreign key (user_id, conta_id) references public.contas(user_id, id) on update cascade on delete set null (conta_id);
alter table public.transacoes add constraint transacoes_estorno_dono_fk foreign key (user_id, estorno_de_id) references public.transacoes(user_id, id) on update cascade on delete restrict;
alter table public.transacoes add constraint transacoes_fatura_dono_fk foreign key (user_id, fatura_id) references public.faturas(user_id, id) on update cascade on delete cascade;
alter table public.transacoes add constraint transacoes_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;


-- -----------------------------------------------------------------------------
-- 6. ÍNDICES
-- -----------------------------------------------------------------------------
-- Só os que não vêm de graça com uma constraint. Quase todos começam por
-- `user_id` porque toda consulta do app já chega filtrada pelo dono.

create index acertos_grupo_idx on public.acertos using btree (user_id, grupo_id, data);
create index alocacoes_da_meta on public.alocacoes_de_meta using btree (user_id, meta_id, data);
create index assinaturas_user_idx on public.assinaturas using btree (user_id, ativo, ordem, nome);
create index cartoes_user_idx on public.cartoes using btree (user_id, ordem, nome);
create index categorias_pai_idx on public.categorias using btree (user_id, pai_id);
create index categorias_user_idx on public.categorias using btree (user_id, ativo, ordem);
create index compras_cartao_idx on public.compras_de_cartao using btree (user_id, cartao_id, data_compra);
create index contas_instituicao_dono_idx on public.contas using btree (user_id, instituicao_id);
create index contas_instituicao_idx on public.contas using btree (instituicao_id);
create index contas_user_idx on public.contas using btree (user_id, ativo, ordem);
create index credores_ativo_idx on public.credores using btree (user_id, ativo, ordem);
create index credores_pai_idx on public.credores using btree (user_id, credor_pai_id, ordem);
create index credores_user_idx on public.credores using btree (user_id, ordem);
create index despesas_grupo_idx on public.despesas_do_grupo using btree (user_id, grupo_id, data);
create index dividas_credor_idx on public.dividas using btree (credor_id);
create index dividas_data_idx on public.dividas using btree (user_id, data_compra);
create index dividas_meio_idx on public.dividas using btree (user_id, meio, mes_inicial);
create index dividas_pessoa_idx on public.dividas using btree (user_id, pessoa_id);
create index dividas_user_idx on public.dividas using btree (user_id, ordem);
create index faturas_cartao_idx on public.faturas using btree (user_id, cartao_id, competencia);
create index faturas_vencimento_idx on public.faturas using btree (user_id, vencimento);
create index fixas_credor_idx on public.fixas using btree (credor_id);
create index fixas_user_idx on public.fixas using btree (user_id, ordem);
create index fixas_mes_idx on public.fixas_mes using btree (user_id, mes);
create index grupos_user_idx on public.grupos using btree (user_id, ordem, nome);
create index instituicoes_user_idx on public.instituicoes using btree (user_id, ativo, ordem);
create unique index liquidacao_uma_por_competencia on public.liquidacoes using btree (user_id, tipo, item_id, competencia) where (tipo <> 'fatura'::text);
create index liquidacoes_item_idx on public.liquidacoes using btree (user_id, tipo, item_id);
create index liquidacoes_transacao_idx on public.liquidacoes using btree (user_id, transacao_id);
create index liquidacoes_user_idx on public.liquidacoes using btree (user_id, competencia);
create unique index membro_um_sou_eu_por_grupo on public.membros using btree (user_id, grupo_id) where sou_eu;
create index membros_grupo_idx on public.membros using btree (user_id, grupo_id, ordem, nome);
create index metas_do_usuario on public.metas using btree (user_id, status, ordem);
create index pagamentos_user_idx on public.pagamentos using btree (user_id, mes);
create index rateios_despesa_idx on public.rateios using btree (user_id, despesa_id);
create index rateios_membro_idx on public.rateios using btree (user_id, membro_id);
create index receitas_user_idx on public.receitas using btree (user_id, ordem);
create index transacoes_assinatura_idx on public.transacoes using btree (user_id, assinatura_id, competencia);
create index transacoes_categoria_idx on public.transacoes using btree (user_id, categoria_id);
create index transacoes_compra_idx on public.transacoes using btree (user_id, compra_id);
create index transacoes_conta_idx on public.transacoes using btree (user_id, conta_id, data);
create index transacoes_estorno_idx on public.transacoes using btree (user_id, estorno_de_id);
create index transacoes_fatura_idx on public.transacoes using btree (user_id, fatura_id);
create index transacoes_origem_idx on public.transacoes using btree (user_id, origem, origem_id);
create index transacoes_status_idx on public.transacoes using btree (user_id, status, data);
create index transacoes_transferencia_idx on public.transacoes using btree (user_id, transferencia_id);
create index transacoes_user_data_idx on public.transacoes using btree (user_id, data desc);


-- -----------------------------------------------------------------------------
-- 7. VIEWS
-- -----------------------------------------------------------------------------
-- Vêm antes das funções: `saldo_livre_do_usuario()` lê `saldos_de_conta`, e
-- corpo de função em SQL é conferido na hora da criação.
--
-- TODAS com `security_invoker = true`. Sem isso a view roda como dona e
-- entrega a linha de qualquer pessoa: é o buraco de RLS mais silencioso que
-- existe, porque a view continua funcionando -- só que para todo mundo.

create view public.saldos_de_conta with (security_invoker = true) as
  select c.id as conta_id,
         c.user_id,
         c.nome,
         c.tipo,
         c.liquidez,
         c.saldo_inicial,
         c.saldo_inicial_em,
         c.saldo_inicial + coalesce(sum(
           case when t.tipo = 'entrada'::text then t.valor else - t.valor end), 0::numeric) as saldo
    from public.contas c
    left join public.transacoes t
      on t.conta_id = c.id and t.user_id = c.user_id
     and (t.status = any (array['realizada'::text, 'conciliada'::text]))
     and t.data >= c.saldo_inicial_em
   group by c.id, c.user_id, c.nome, c.tipo, c.liquidez, c.saldo_inicial, c.saldo_inicial_em;

create view public.assinaturas_resolvidas with (security_invoker = true) as
  select id,
         user_id,
         nome,
         logo,
         valor,
         frequencia,
         categoria_id,
         conta_id,
         cartao_id,
         inicio,
         fim,
         ativo,
         obs,
         ordem,
         criado_em,
         case frequencia
           when 'semanal'::text then round(valor * 52::numeric / 12::numeric, 2)
           when 'mensal'::text then valor
           when 'bimestral'::text then round(valor / 2::numeric, 2)
           when 'trimestral'::text then round(valor / 3::numeric, 2)
           when 'semestral'::text then round(valor / 6::numeric, 2)
           when 'anual'::text then round(valor / 12::numeric, 2)
           else null::numeric
         end as custo_mensal,
         case frequencia
           when 'semanal'::text then round(valor * 52::numeric, 2)
           when 'mensal'::text then valor * 12::numeric
           when 'bimestral'::text then valor * 6::numeric
           when 'trimestral'::text then valor * 4::numeric
           when 'semestral'::text then valor * 2::numeric
           when 'anual'::text then valor
           else null::numeric
         end as custo_anual,
         (select min(t.data) as min
            from public.transacoes t
           where t.assinatura_id = a.id and t.user_id = a.user_id
             and t.data >= CURRENT_DATE and t.status = 'prevista'::text) as proxima_cobranca
    from public.assinaturas a;

create view public.saldos_do_grupo with (security_invoker = true) as
  select id as membro_id,
         user_id,
         grupo_id,
         nome,
         apelido,
         sou_eu,
         ativo,
         coalesce((select sum(d.valor) as sum from public.despesas_do_grupo d
                    where d.pago_por_id = m.id and d.user_id = m.user_id), 0::numeric)::numeric(14,2) as pagou,
         coalesce((select sum(r.valor) as sum from public.rateios r
                    where r.membro_id = m.id and r.user_id = m.user_id), 0::numeric)::numeric(14,2) as coube,
         coalesce((select sum(a.valor) as sum from public.acertos a
                    where a.para_id = m.id and a.user_id = m.user_id), 0::numeric)::numeric(14,2) as recebeu,
         coalesce((select sum(a.valor) as sum from public.acertos a
                    where a.de_id = m.id and a.user_id = m.user_id), 0::numeric)::numeric(14,2) as quitou,
         (coalesce((select sum(d.valor) as sum from public.despesas_do_grupo d
                     where d.pago_por_id = m.id and d.user_id = m.user_id), 0::numeric)
          - coalesce((select sum(r.valor) as sum from public.rateios r
                       where r.membro_id = m.id and r.user_id = m.user_id), 0::numeric)
          - coalesce((select sum(a.valor) as sum from public.acertos a
                       where a.para_id = m.id and a.user_id = m.user_id), 0::numeric)
          + coalesce((select sum(a.valor) as sum from public.acertos a
                       where a.de_id = m.id and a.user_id = m.user_id), 0::numeric))::numeric(14,2) as saldo
    from public.membros m;

create view public.transacoes_com_estorno with (security_invoker = true) as
  select id as transacao_id,
         user_id,
         valor,
         coalesce((select sum(e.valor) as sum from public.transacoes e
                    where e.estorno_de_id = t.id and e.user_id = t.user_id
                      and e.status <> 'cancelada'::text), 0::numeric)::numeric(14,2) as estornado,
         (valor - coalesce((select sum(e.valor) as sum from public.transacoes e
                             where e.estorno_de_id = t.id and e.user_id = t.user_id
                               and e.status <> 'cancelada'::text), 0::numeric))::numeric(14,2) as estornavel,
         natureza = 'normal'::text and not (exists (select 1 from public.liquidacoes l
           where l.transacao_id = t.id and l.user_id = t.user_id)) as pode_estornar
    from public.transacoes t;

create view public.faturas_resolvidas with (security_invoker = true) as
  select f.id as fatura_id,
         f.user_id,
         f.cartao_id,
         f.competencia,
         f.abertura,
         f.fechamento,
         f.vencimento,
         f.obs,
         coalesce(i.total, 0::numeric)::numeric(14,2) as total,
         coalesce(i.itens, 0::bigint) as itens,
         coalesce(p.pago, 0::numeric)::numeric(14,2) as pago,
         (coalesce(i.total, 0::numeric) - coalesce(p.pago, 0::numeric))::numeric(14,2) as restante,
         coalesce(p.pagamentos, 0::bigint) as pagamentos,
         case
           when coalesce(i.total, 0::numeric) > 0::numeric
            and coalesce(p.pago, 0::numeric) >= coalesce(i.total, 0::numeric) then 'paga'::text
           when coalesce(p.pago, 0::numeric) > 0::numeric then 'parcial'::text
           when CURRENT_DATE >= f.fechamento then 'fechada'::text
           else 'aberta'::text
         end as situacao
    from public.faturas f
    left join lateral (
      select sum(case when t.tipo = 'entrada'::text then - t.valor else t.valor end) as total,
             count(*) as itens
        from public.transacoes t
       where t.fatura_id = f.id and t.user_id = f.user_id
         and (t.status = any (array['realizada'::text, 'conciliada'::text]))) i on true
    left join lateral (
      select sum(l.valor) as pago,
             count(*) as pagamentos
        from public.liquidacoes l
       where l.user_id = f.user_id and l.tipo = 'fatura'::text and l.item_id = f.id::text) p on true;

create view public.metas_resolvidas with (security_invoker = true) as
  select m.id as meta_id,
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
         coalesce(a.reservado, 0::numeric)::numeric(14,2) as reservado,
         greatest(m.valor_alvo - coalesce(a.reservado, 0::numeric), 0::numeric)::numeric(14,2) as falta,
         coalesce(a.quantas, 0::bigint) as alocacoes,
         least(round(coalesce(a.reservado, 0::numeric) * 100::numeric / m.valor_alvo), 100::numeric)::integer as percentual,
         case
           when m.prazo is null then null::integer
           else greatest(1, (date_part('year'::text, age(m.prazo::timestamp with time zone, CURRENT_DATE::timestamp with time zone)) * 12::double precision
                             + date_part('month'::text, age(m.prazo::timestamp with time zone, CURRENT_DATE::timestamp with time zone)))::integer + 1)
         end as meses_ate_prazo
    from public.metas m
    left join lateral (
      select sum(x.valor) as reservado,
             count(*) as quantas
        from public.alocacoes_de_meta x
       where x.meta_id = m.id and x.user_id = m.user_id) a on true;


-- -----------------------------------------------------------------------------
-- 8. FUNÇÕES
-- -----------------------------------------------------------------------------
-- `create function`, não `create or replace`: em banco limpo não há o que
-- substituir, e a forma estrita acusa se alguém rodar este arquivo duas vezes.
--
-- Toda função leva `set search_path to 'public'`. Sem isso, quem chama escolhe
-- em que schema os nomes de dentro do corpo são resolvidos -- e isso é um
-- caminho conhecido de escalada de privilégio.
--
-- Ordem: primeiro as auxiliares puras, depois quem as usa, e as de gatilho no
-- fim. Corpo em SQL é conferido na criação, então a ordem não é estética.

-- ...............................................................  calendário --

create function public.dia_no_mes(p_mes text, p_dia integer)
returns date
language sql
immutable
set search_path to 'public'
as $$
  select primeiro + (least(greatest(p_dia, 1),
                           extract(day from (primeiro + interval '1 month - 1 day'))::int) - 1)
    from (select make_date(left(p_mes, 4)::int, right(p_mes, 2)::int, 1) as primeiro) b;
$$;

create function public.passo_da_frequencia(p_frequencia text)
returns interval
language sql
immutable
set search_path to 'public'
as $$
  select case p_frequencia
           when 'semanal'    then interval '7 days'
           when 'mensal'     then interval '1 month'
           when 'bimestral'  then interval '2 months'
           when 'trimestral' then interval '3 months'
           when 'semestral'  then interval '6 months'
           when 'anual'      then interval '1 year'
         end;
$$;

create function public.competencia_da_ocorrencia(p_data date, p_frequencia text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select to_char(p_data, 'YYYY-MM');
$$;

create function public.competencia_da_compra(p_data date, p_fechamento integer)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select to_char(
    case when p_data < public.dia_no_mes(to_char(p_data, 'YYYY-MM'), p_fechamento)
         then date_trunc('month', p_data)
         else date_trunc('month', p_data) + interval '1 month'
    end, 'YYYY-MM');
$$;

create function public.ciclo_da_fatura(p_competencia text, p_fechamento integer, p_vencimento integer,
                                       out abertura date, out fechamento date, out vencimento date)
returns record
language sql
immutable
set search_path to 'public'
as $$
  select
    public.dia_no_mes(to_char(public.dia_no_mes(p_competencia, 1) - interval '1 month', 'YYYY-MM'),
                      p_fechamento),
    public.dia_no_mes(p_competencia, p_fechamento),
    public.dia_no_mes(
      to_char(public.dia_no_mes(p_competencia, 1)
              + (case when p_vencimento > p_fechamento then 0 else 1 end) * interval '1 month',
              'YYYY-MM'),
      p_vencimento);
$$;

-- ....................................................................  somas --

create function public.saldo_livre_do_usuario()
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(s.saldo), 0)::numeric(14,2)
    from public.saldos_de_conta s
   where s.liquidez = 'livre';
$$;

create function public.total_reservado_em_metas()
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(a.valor), 0)::numeric(14,2)
    from public.alocacoes_de_meta a
    join public.metas m on m.id = a.meta_id
   where m.status <> 'arquivada';
$$;

create function public.total_devido_da_fatura(p_fatura uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(case when t.tipo = 'entrada' then -t.valor else t.valor end), 0)::numeric(14,2)
    from public.transacoes t
   where t.fatura_id = p_fatura and t.status in ('realizada', 'conciliada');
$$;

create function public.total_pago_da_fatura(p_fatura uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(l.valor), 0)::numeric(14,2)
    from public.liquidacoes l
   where l.tipo = 'fatura' and l.item_id = p_fatura::text;
$$;

-- ...........................................................  transferência --

create function public.confere_pernas_da_transferencia(origem uuid, destino uuid, valor numeric)
returns void
language plpgsql
set search_path to 'public'
as $$
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

create function public.cria_transferencia(p_conta_origem uuid, p_conta_destino uuid, p_valor numeric,
                                          p_data date, p_descricao text default 'Transferência'::text,
                                          p_obs text default ''::text, p_status text default 'realizada'::text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
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

create function public.atualiza_transferencia(p_transferencia uuid, p_conta_origem uuid, p_conta_destino uuid,
                                              p_valor numeric, p_data date,
                                              p_descricao text default 'Transferência'::text,
                                              p_obs text default ''::text, p_status text default 'realizada'::text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
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

create function public.remove_transferencia(p_transferencia uuid)
returns integer
language plpgsql
set search_path to 'public'
as $$
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

-- ..............................................................  liquidação --

create function public.confere_liquidacao(p_tipo text, p_item_id text, p_competencia text,
                                          p_conta uuid, p_valor numeric)
returns void
language plpgsql
set search_path to 'public'
as $$
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

create function public.liquida_compromisso(p_tipo text, p_item_id text, p_competencia text, p_conta uuid,
                                           p_valor numeric, p_data date, p_descricao text,
                                           p_categoria uuid default null::uuid, p_obs text default ''::text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
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

create function public.recebe_receita(p_receita uuid, p_competencia text, p_conta uuid, p_valor numeric,
                                      p_data date, p_descricao text,
                                      p_categoria uuid default null::uuid, p_obs text default ''::text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
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

create function public.desfaz_liquidacao(p_tipo text, p_item_id text, p_competencia text)
returns integer
language plpgsql
set search_path to 'public'
as $$
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

-- .................................................  cartões, faturas, compras --

create function public.fatura_na_competencia(p_cartao uuid, p_competencia text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  c public.cartoes%rowtype;
  ci record;
  achou uuid;
begin
  if auth.uid() is null then
    raise exception 'fatura: é preciso estar logado';
  end if;
  if p_competencia !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'fatura: a competência precisa estar no formato AAAA-MM';
  end if;

  select * into c from public.cartoes where id = p_cartao;
  if c.id is null then
    raise exception 'fatura: cartão não encontrado';
  end if;

  select id into achou from public.faturas
   where cartao_id = p_cartao and competencia = p_competencia;
  if achou is not null then return achou; end if;

  select * into ci from public.ciclo_da_fatura(p_competencia, c.dia_fechamento, c.dia_vencimento);
  insert into public.faturas (cartao_id, competencia, abertura, fechamento, vencimento)
  values (p_cartao, p_competencia, ci.abertura, ci.fechamento, ci.vencimento)
  on conflict (user_id, cartao_id, competencia) do nothing
  returning id into achou;

  if achou is null then
    select id into achou from public.faturas
     where cartao_id = p_cartao and competencia = p_competencia;
  end if;
  return achou;
end $$;

create function public.fatura_do_cartao(p_cartao uuid, p_data date)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  c public.cartoes%rowtype;
begin
  select * into c from public.cartoes where id = p_cartao;
  if c.id is null then
    raise exception 'fatura: cartão não encontrado';
  end if;
  return public.fatura_na_competencia(
    p_cartao, public.competencia_da_compra(p_data, c.dia_fechamento));
end $$;

create function public.registra_compra_de_cartao(p_cartao uuid, p_descricao text, p_valor_total numeric,
                                                 p_data date, p_parcelas integer default 1,
                                                 p_categoria uuid default null::uuid,
                                                 p_obs text default ''::text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  c public.cartoes%rowtype;
  compra uuid;
  comp1 text;
  comp_i text;
  base numeric(14,2);
  sobra numeric(14,2);
  valor_i numeric(14,2);
  soma numeric(14,2) := 0;
  i int;
begin
  if auth.uid() is null then
    raise exception 'compra: é preciso estar logado';
  end if;
  if p_valor_total is null or p_valor_total <= 0 then
    raise exception 'compra: o valor precisa ser maior que zero';
  end if;
  if p_parcelas is null or p_parcelas < 1 or p_parcelas > 72 then
    raise exception 'compra: o número de parcelas precisa ficar entre 1 e 72';
  end if;

  select * into c from public.cartoes where id = p_cartao;
  if c.id is null then
    raise exception 'compra: cartão não encontrado';
  end if;

  insert into public.compras_de_cartao
    (cartao_id, categoria_id, descricao, valor_total, data_compra, total_parcelas, obs)
  values (p_cartao, p_categoria, p_descricao, p_valor_total, p_data, p_parcelas, coalesce(p_obs,''))
  returning id into compra;

  comp1 := public.competencia_da_compra(p_data, c.dia_fechamento);
  base  := trunc(p_valor_total / p_parcelas, 2);
  sobra := p_valor_total - (base * p_parcelas);

  for i in 1..p_parcelas loop
    comp_i := to_char(public.dia_no_mes(comp1, 1) + ((i - 1) * interval '1 month'), 'YYYY-MM');
    valor_i := base + (case when i = 1 then sobra else 0 end);
    soma := soma + valor_i;

    insert into public.transacoes
      (conta_id, fatura_id, compra_id, parcela, total_parcelas, categoria_id, tipo, natureza,
       descricao, valor, data, status, origem, origem_id, obs)
    values
      (null,
       public.fatura_na_competencia(p_cartao, comp_i),
       compra, i, p_parcelas, p_categoria, 'saida', 'normal',
       p_descricao, valor_i,
       (public.dia_no_mes(comp_i, extract(day from p_data)::int)),
       'realizada', 'cartao', compra::text, coalesce(p_obs,''));
  end loop;

  if soma <> p_valor_total then
    raise exception 'compra: as parcelas somam % e o total é %', soma, p_valor_total;
  end if;
  return compra;
end $$;

create function public.paga_fatura(p_fatura uuid, p_conta uuid, p_valor numeric, p_data date,
                                   p_obs text default ''::text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  f public.faturas%rowtype;
  achou int;
  nova uuid;
  devido numeric;
  pago numeric;
  falta numeric;
  -- NÃO se chama `nome`: haveria uma coluna `nome` em `cartoes` e o plpgsql
  -- recusa a ambiguidade em tempo de execução, não de criação.
  rotulo text;
begin
  if auth.uid() is null then raise exception 'fatura: é preciso estar logado'; end if;
  if p_conta is null then raise exception 'fatura: escolha a conta'; end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'fatura: o valor precisa ser maior que zero';
  end if;

  select * into f from public.faturas where id = p_fatura;
  if f.id is null then raise exception 'fatura: não encontrada'; end if;

  select count(*) into achou from public.contas where id = p_conta;
  if achou <> 1 then raise exception 'fatura: conta não encontrada'; end if;

  devido := public.total_devido_da_fatura(f.id);
  pago := public.total_pago_da_fatura(f.id);
  falta := devido - pago;

  if devido <= 0 then raise exception 'fatura: não há nada a pagar nesta fatura'; end if;
  if falta <= 0 then raise exception 'fatura: esta fatura já está paga'; end if;
  if p_valor > falta then
    raise exception 'fatura: falta % e você lançou %. Pagamento acima do devido não é aceito: esta versão não modela crédito de fatura.',
      falta, p_valor using errcode = 'check_violation';
  end if;

  select coalesce(nullif(apelido,''), nome) into rotulo from public.cartoes where id = f.cartao_id;

  insert into public.transacoes
    (conta_id, categoria_id, tipo, natureza, descricao, valor, data, status,
     origem, origem_id, obs)
  values
    (p_conta, null, 'saida', 'pagamento_de_fatura',
     'Fatura ' || coalesce(rotulo, 'do cartão') || ' · vence ' || to_char(f.vencimento, 'DD/MM'),
     p_valor, p_data, 'realizada', 'cartao', f.id::text, coalesce(p_obs,''))
  returning id into nova;

  insert into public.liquidacoes (tipo, item_id, competencia, transacao_id, valor)
  values ('fatura', f.id::text, f.competencia, nova, p_valor);

  return nova;
end $$;

create function public.desfaz_pagamento_de_fatura(p_pagamento uuid)
returns boolean
language plpgsql
set search_path to 'public'
as $$
declare achou int;
begin
  if auth.uid() is null then raise exception 'fatura: é preciso estar logado'; end if;

  -- O RLS decide o que é visível; pagamento de outra pessoa simplesmente não é
  -- encontrado, e a mensagem é a mesma de um id que não existe.
  select count(*) into achou from public.liquidacoes
   where transacao_id = p_pagamento and tipo = 'fatura';
  if achou <> 1 then raise exception 'fatura: pagamento não encontrado'; end if;

  delete from public.liquidacoes where transacao_id = p_pagamento and tipo = 'fatura';
  delete from public.transacoes where id = p_pagamento;
  return true;
end $$;

-- ..............................................................  assinaturas --

create function public.materializa_assinaturas(p_ate date default null::date)
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
  -- o banco de linha que ninguém vai olhar. Semanal dá cerca de nove.
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
    -- pula o que já passou. O contador não é paranoia: uma data de início
    -- absurda faria este laço rodar milhares de vezes dentro de uma transação.
    -- Semanal gasta 52 voltas por ano de atraso, então o teto sobe.
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

-- ..................................................................  estorno --

create function public.estorna_transacao(p_transacao uuid, p_valor numeric default null::numeric,
                                         p_data date default null::date, p_obs text default ''::text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
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

-- ...................................................................  grupos --

create function public.registra_despesa_do_grupo(p_grupo uuid, p_descricao text, p_valor numeric,
                                                 p_data date, p_pago_por uuid, p_rateios jsonb,
                                                 p_categoria uuid default null::uuid,
                                                 p_obs text default ''::text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  nova uuid;
  item jsonb;
  quantos int;
begin
  if auth.uid() is null then
    raise exception 'grupo: é preciso estar logado';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'grupo: o valor precisa ser maior que zero';
  end if;

  select count(*) into quantos from public.grupos where id = p_grupo;
  if quantos <> 1 then
    raise exception 'grupo: não encontrado';
  end if;
  select count(*) into quantos from public.membros
   where id = p_pago_por and grupo_id = p_grupo;
  if quantos <> 1 then
    raise exception 'grupo: quem pagou precisa ser membro deste grupo';
  end if;

  if p_rateios is null or jsonb_array_length(p_rateios) = 0 then
    raise exception 'rateio: uma despesa sem partes é um número sem dono';
  end if;

  insert into public.despesas_do_grupo
    (grupo_id, pago_por_id, categoria_id, descricao, valor, data, obs)
  values (p_grupo, p_pago_por, p_categoria, p_descricao, p_valor, p_data, coalesce(p_obs,''))
  returning id into nova;

  for item in select * from jsonb_array_elements(p_rateios) loop
    select count(*) into quantos from public.membros
     where id = (item->>'membro')::uuid and grupo_id = p_grupo;
    if quantos <> 1 then
      raise exception 'rateio: só membro do grupo entra na divisão';
    end if;
    insert into public.rateios (despesa_id, membro_id, valor)
    values (nova, (item->>'membro')::uuid, (item->>'valor')::numeric);
  end loop;

  -- a conferência da soma acontece no COMMIT, pelo gatilho postergado
  return nova;
end $$;

create function public.registra_acerto(p_grupo uuid, p_de uuid, p_para uuid, p_valor numeric, p_data date,
                                       p_conta uuid default null::uuid, p_obs text default ''::text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  novo uuid;
  tx uuid := null;
  quantos int;
  eu_recebo boolean;
  eu_pago boolean;
  outro text;
begin
  if auth.uid() is null then
    raise exception 'grupo: é preciso estar logado';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'acerto: o valor precisa ser maior que zero';
  end if;
  if p_de = p_para then
    raise exception 'acerto: quem paga e quem recebe precisam ser pessoas diferentes';
  end if;

  select count(*) into quantos from public.membros
   where id in (p_de, p_para) and grupo_id = p_grupo;
  if quantos <> 2 then
    raise exception 'acerto: as duas pessoas precisam ser membros deste grupo';
  end if;

  if p_conta is not null then
    select count(*) into quantos from public.contas where id = p_conta;
    if quantos <> 1 then
      raise exception 'acerto: conta não encontrada';
    end if;

    select sou_eu into eu_recebo from public.membros where id = p_para;
    select sou_eu into eu_pago   from public.membros where id = p_de;
    if not coalesce(eu_recebo, false) and not coalesce(eu_pago, false) then
      raise exception 'acerto: só entra em conta o acerto de que você participa';
    end if;

    select nome into outro from public.membros
     where id = case when coalesce(eu_recebo, false) then p_de else p_para end;

    insert into public.transacoes
      (conta_id, tipo, natureza, descricao, valor, data, status, origem, origem_id, obs)
    values
      (p_conta,
       case when coalesce(eu_recebo, false) then 'entrada' else 'saida' end,
       'normal',
       'Acerto com ' || coalesce(outro, 'o grupo'),
       p_valor, p_data, 'realizada', 'manual', '', coalesce(p_obs,''))
    returning id into tx;
  end if;

  insert into public.acertos (grupo_id, de_id, para_id, valor, data, transacao_id, obs)
  values (p_grupo, p_de, p_para, p_valor, p_data, tx, coalesce(p_obs,''))
  returning id into novo;

  return novo;
end $$;

-- ......................................................  funções de gatilho --
-- Nenhuma delas tem `execute` para `anon`: ver a seção 12.

create function public.set_user_id()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.user_id is null then new.user_id := auth.uid(); end if;
  return new;
end $$;

create function public.metas_set_user_id()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.user_id := coalesce(new.user_id, auth.uid());
  return new;
end $$;

create function public.alocacoes_set_user_id()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.user_id := coalesce(new.user_id, auth.uid());
  return new;
end $$;

create function public.nivel_da_categoria()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  nivel_pai smallint;
begin
  if new.pai_id is null then
    new.nivel := 1;
  else
    -- o `user_id` no where é o que impede ler a árvore de outra pessoa. Se o
    -- pai não for do mesmo dono, não acha nada, o nível sai 1, e a FK composta
    -- recusa a linha logo em seguida -- o erro vem do banco, não do RLS.
    select c.nivel into nivel_pai
      from public.categorias c
     where c.id = new.pai_id and c.user_id = new.user_id;
    new.nivel := coalesce(nivel_pai, 0) + 1;
  end if;
  return new;
end $$;

create function public.valida_transferencia()
returns trigger
language plpgsql
set search_path to 'public'
as $$
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

create function public.confere_estorno()
returns trigger
language plpgsql
set search_path to 'public'
as $$
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

create function public.confere_soma_do_rateio()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  alvo uuid;
  d record;
  somado numeric(14,2);
begin
  alvo := coalesce(new.despesa_id, old.despesa_id);

  select * into d from public.despesas_do_grupo where id = alvo;
  -- a despesa pode ter sido apagada na mesma transação; aí não há o que conferir
  if d.id is null then return null; end if;

  select coalesce(sum(valor), 0) into somado from public.rateios where despesa_id = alvo;
  if somado <> d.valor then
    raise exception 'rateio: as partes somam % e a despesa é de % -- a diferença precisa ser zero',
      somado, d.valor;
  end if;
  return null;
end $$;

create function public.confere_soma_da_despesa()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  somado numeric(14,2);
begin
  select coalesce(sum(valor), 0) into somado from public.rateios where despesa_id = new.id;
  if somado <> new.valor then
    raise exception 'rateio: as partes somam % e a despesa passou a ser de % -- reveja a divisão',
      somado, new.valor;
  end if;
  return null;
end $$;

create function public.confere_pagamento_de_fatura()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  devido numeric;
  pago numeric;
begin
  if new.tipo <> 'fatura' then return new; end if;
  devido := public.total_devido_da_fatura(new.item_id::uuid);
  pago := public.total_pago_da_fatura(new.item_id::uuid);
  if pago > devido then
    raise exception 'fatura: o pagamento passa do que se deve. Devido %, já pago %, e esta versão não modela crédito de fatura.',
      devido, pago using errcode = 'check_violation';
  end if;
  return new;
end $$;

create function public.confere_alocacao_de_meta()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  livre numeric;
  reservado numeric;
begin
  reservado := public.total_reservado_em_metas();
  -- liberar (valor negativo) nunca precisa de saldo: ela só devolve
  if reservado <= 0 then return new; end if;
  livre := public.saldo_livre_do_usuario();
  if reservado > livre then
    raise exception 'meta: não dá para reservar % com % livre em conta. Meta é envelope, não dinheiro novo.',
      reservado, livre using errcode = 'check_violation';
  end if;
  return new;
end $$;

create function public.limpa_marca_da_liquidacao()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.tipo in ('divida','fixa') then
    delete from public.pagamentos
     where user_id = old.user_id
       and mes     = old.competencia
       and item_id = old.item_id;
  end if;
  return null;
end $$;


-- -----------------------------------------------------------------------------
-- 9. GATILHOS
-- -----------------------------------------------------------------------------
-- Os `_set_user` preenchem o dono na inserção: o app nunca manda `user_id`, e
-- é isso que impede gravar em nome de outra pessoa.
--
-- Os `constraint trigger ... deferrable initially deferred` conferem no
-- COMMIT, não na linha. Rateio entra um a um e só fecha no fim; conferir a
-- cada linha recusaria a primeira parte de toda despesa.

create trigger acertos_set_user before insert on public.acertos
  for each row execute function public.set_user_id();

-- `a_` no começo para ordenar antes do gatilho de conferência: o Postgres
-- dispara gatilho de mesmo evento em ordem alfabética de nome.
create trigger a_alocacoes_set_user before insert on public.alocacoes_de_meta
  for each row execute function public.alocacoes_set_user_id();
create constraint trigger confere_alocacao_de_meta after insert or update on public.alocacoes_de_meta
  deferrable initially deferred for each row execute function public.confere_alocacao_de_meta();

create trigger assinaturas_set_user before insert on public.assinaturas
  for each row execute function public.set_user_id();
create trigger cartoes_set_user before insert on public.cartoes
  for each row execute function public.set_user_id();

create trigger categorias_1_set_user before insert on public.categorias
  for each row execute function public.set_user_id();
create trigger categorias_2_nivel before insert or update of pai_id on public.categorias
  for each row execute function public.nivel_da_categoria();

create trigger compras_de_cartao_set_user before insert on public.compras_de_cartao
  for each row execute function public.set_user_id();
create trigger config_set_user before insert on public.config
  for each row execute function public.set_user_id();
create trigger contas_set_user before insert on public.contas
  for each row execute function public.set_user_id();
create trigger credores_set_user before insert on public.credores
  for each row execute function public.set_user_id();

create trigger despesas_do_grupo_set_user before insert on public.despesas_do_grupo
  for each row execute function public.set_user_id();
create constraint trigger despesa_confere_rateio after update on public.despesas_do_grupo
  deferrable initially deferred for each row execute function public.confere_soma_da_despesa();

create trigger dividas_set_user before insert on public.dividas
  for each row execute function public.set_user_id();
create trigger faturas_set_user before insert on public.faturas
  for each row execute function public.set_user_id();
create trigger fixas_set_user before insert on public.fixas
  for each row execute function public.set_user_id();
create trigger fixas_mes_set_user before insert on public.fixas_mes
  for each row execute function public.set_user_id();
create trigger grupos_set_user before insert on public.grupos
  for each row execute function public.set_user_id();
create trigger instituicoes_set_user before insert on public.instituicoes
  for each row execute function public.set_user_id();

create trigger liquidacoes_set_user before insert on public.liquidacoes
  for each row execute function public.set_user_id();
create constraint trigger confere_pagamento_de_fatura after insert or update on public.liquidacoes
  deferrable initially deferred for each row execute function public.confere_pagamento_de_fatura();
create trigger liquidacoes_limpa_marca after delete on public.liquidacoes
  for each row execute function public.limpa_marca_da_liquidacao();

create trigger membros_set_user before insert on public.membros
  for each row execute function public.set_user_id();
create trigger metas_set_user before insert on public.metas
  for each row execute function public.metas_set_user_id();
create trigger pagamentos_set_user before insert on public.pagamentos
  for each row execute function public.set_user_id();

create trigger rateios_set_user before insert on public.rateios
  for each row execute function public.set_user_id();
create constraint trigger rateios_somam_a_despesa after insert or delete or update on public.rateios
  deferrable initially deferred for each row execute function public.confere_soma_do_rateio();

create trigger receitas_set_user before insert on public.receitas
  for each row execute function public.set_user_id();

create trigger transacoes_set_user before insert on public.transacoes
  for each row execute function public.set_user_id();
create constraint trigger transacoes_confere_estorno after insert or update on public.transacoes
  deferrable initially deferred for each row execute function public.confere_estorno();
create constraint trigger transacoes_transferencia_completa after insert or delete or update on public.transacoes
  deferrable initially deferred for each row execute function public.valida_transferencia();


-- -----------------------------------------------------------------------------
-- 10. RLS
-- -----------------------------------------------------------------------------
-- Esta é a ÚNICA proteção dos dados. O repositório é público e a chave
-- publicável está visível no HTML: quem abrir o site tem uma conexão ao banco.
-- O que separa uma pessoa da outra é a policy, e nada mais.
--
-- Tabela sem RLS aqui não fica "menos protegida": fica aberta.

alter table public.acertos enable row level security;
alter table public.alocacoes_de_meta enable row level security;
alter table public.assinaturas enable row level security;
alter table public.cartoes enable row level security;
alter table public.categorias enable row level security;
alter table public.compras_de_cartao enable row level security;
alter table public.config enable row level security;
alter table public.contas enable row level security;
alter table public.credores enable row level security;
alter table public.despesas_do_grupo enable row level security;
alter table public.dividas enable row level security;
alter table public.faturas enable row level security;
alter table public.fixas enable row level security;
alter table public.fixas_mes enable row level security;
alter table public.grupos enable row level security;
alter table public.instituicoes enable row level security;
alter table public.liquidacoes enable row level security;
alter table public.membros enable row level security;
alter table public.metas enable row level security;
alter table public.pagamentos enable row level security;
alter table public.ping enable row level security;
alter table public.rateios enable row level security;
alter table public.receitas enable row level security;
alter table public.transacoes enable row level security;


-- -----------------------------------------------------------------------------
-- 11. POLICIES
-- -----------------------------------------------------------------------------
-- Uma por tabela, `for all to authenticated`, `user_id = auth.uid()` nos dois
-- lados. `using` decide o que se lê e o que se pode alterar; `with check`
-- decide o que se pode gravar. Faltando o segundo, dá para inserir linha com o
-- dono de outra pessoa.
--
-- `anon` não aparece em nenhuma delas, exceto `ping`: sem policy, o RLS nega.

create policy acertos_own on public.acertos for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy alocacoes_do_dono on public.alocacoes_de_meta for all to authenticated
  using ((user_id = ( select auth.uid() as uid)))
  with check ((user_id = ( select auth.uid() as uid)));
create policy assinaturas_own on public.assinaturas for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy cartoes_own on public.cartoes for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy categorias_own on public.categorias for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy compras_de_cartao_own on public.compras_de_cartao for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy config_own on public.config for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy contas_own on public.contas for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy credores_own on public.credores for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy despesas_do_grupo_own on public.despesas_do_grupo for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy dividas_own on public.dividas for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy faturas_own on public.faturas for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy fixas_own on public.fixas for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy fixas_mes_own on public.fixas_mes for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy grupos_own on public.grupos for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy instituicoes_own on public.instituicoes for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy liquidacoes_own on public.liquidacoes for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy membros_own on public.membros for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy metas_do_dono on public.metas for all to authenticated
  using ((user_id = ( select auth.uid() as uid)))
  with check ((user_id = ( select auth.uid() as uid)));
create policy pagamentos_own on public.pagamentos for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
-- `ping` é a única exceção do projeto: não tem dono, não guarda nada de
-- ninguém, e é legível sem login de propósito -- serve para o site saber se o
-- banco responde antes de pedir senha.
create policy ping_read on public.ping for select to anon, authenticated
  using (true);
create policy rateios_own on public.rateios for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy receitas_own on public.receitas for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy transacoes_own on public.transacoes for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));


-- -----------------------------------------------------------------------------
-- 12. PERMISSÕES
-- -----------------------------------------------------------------------------
-- O `revoke` antes de cada `grant` não é zelo: num projeto Supabase, tabela e
-- função NOVAS já nascem com permissão, dada por `alter default privileges`
-- do próprio projeto. Sem revogar primeiro, o que este arquivo concede se soma
-- ao que veio de fábrica, e o resultado depende do ambiente.
--
-- Foi exatamente esse o defeito da migração 012: função nova nasceu com
-- `execute` para `anon`, e `revoke ... from public` não tira concessão
-- explícita de papel. A 013 consertou. Aqui a ordem é fixa: revoga de todos,
-- concede a quem deve.

-- ...........................................................  tabelas e views --
-- `anon` recebe as mesmas permissões de tabela que `authenticated`, e mesmo
-- assim não lê nada: quem barra é a policy, que só existe para `authenticated`.
-- Duas camadas dizendo a mesma coisa; tirar uma não é simplificação.

do $$
declare
  r record;
begin
  for r in select c.relname from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','v')
           order by c.relname
  loop
    execute format('revoke all on public.%I from anon, authenticated, service_role', r.relname);
    execute format('grant delete, insert, references, select, trigger, truncate, update on public.%I to anon, authenticated, service_role', r.relname);
  end loop;
end $$;

-- ..................................................................  funções --
-- `anon` não executa NENHUMA. Uma função é código do lado do servidor: dar
-- `execute` a quem não fez login é abrir uma porta que o RLS não guarda.
--
-- Função de gatilho fica só com `service_role`. Ela não é chamada por
-- ninguém: é o gatilho que a dispara, sob o dono da tabela.

do $$
declare
  r record;
  gatilho boolean;
begin
  for r in select p.oid, p.proname,
                  pg_get_function_identity_arguments(p.oid) as args,
                  pg_get_function_result(p.oid) as resultado
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
            order by p.proname
  loop
    gatilho := r.resultado = 'trigger';
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated, service_role',
                   r.proname, r.args);
    if gatilho then
      execute format('grant execute on function public.%I(%s) to service_role', r.proname, r.args);
    else
      execute format('grant execute on function public.%I(%s) to authenticated, service_role',
                     r.proname, r.args);
    end if;
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 13. COMENTÁRIOS
-- -----------------------------------------------------------------------------
-- Onde mora o porquê de a coluna existir. Entram no inventário estrutural, e
-- por isso somem do banco só se alguém decidir que somem.

comment on table public.alocacoes_de_meta is 'Uma linha por reserva ou liberação. Valor com SINAL: positivo reserva, negativo libera. NÃO gera transação.';
comment on table public.metas is 'Objetivo de destinação. NÃO guarda dinheiro e NÃO altera saldo: ver docs/CONTRATO_METAS.md.';
comment on column public.transacoes.ocorrencia_em is 'A data da ocorrência de uma assinatura. É a identidade dela: mês não serve, porque semanal tem quatro ou cinco no mesmo mês.';
comment on view public.faturas_resolvidas is 'A fatura com total, pago, restante e situação já derivados. `pago` vem de subconsulta, e não de join, porque com N pagamentos o join multiplicaria os itens e o total sairia errado.';
comment on view public.metas_resolvidas is 'Meta com reservado, falta e percentual derivados. NÃO some reservado com saldo de conta: é o mesmo dinheiro visto de outro ângulo.';
comment on index public.liquidacao_uma_por_competencia is 'Um compromisso da V1 se liquida uma vez por competência. Fatura fica de fora: ela recebe N pagamentos, e o limite dela é de VALOR, não de contagem.';


-- -----------------------------------------------------------------------------
-- 14. CONFERÊNCIA
-- -----------------------------------------------------------------------------
-- Última linha do arquivo: se os números não baterem, algo acima não rodou, e
-- é melhor descobrir agora do que no primeiro login.

do $$
declare
  t int; v int; f int; g int; p int; sem_rls text;
begin
  select count(*) into t from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r';
  select count(*) into v from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='v';
  select count(*) into f from pg_proc p2 join pg_namespace n on n.oid=p2.pronamespace
   where n.nspname='public';
  select count(*) into g from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and not tg.tgisinternal;
  select count(*) into p from pg_policies where schemaname='public';

  select string_agg(c.relname, ', ' order by c.relname) into sem_rls
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;

  if (t,v,f,g,p) is distinct from (24,6,37,31,24) then
    raise exception 'bootstrap incompleto: % tabelas, % views, % funções, % gatilhos, % policies (esperado 24/6/37/31/24)',
      t, v, f, g, p;
  end if;
  if sem_rls is not null then
    raise exception 'tabela sem RLS: %', sem_rls;
  end if;

  raise notice 'Banco pronto: 24 tabelas, 6 views, 37 funções, 31 gatilhos, 24 policies, RLS em todas.';
end $$;

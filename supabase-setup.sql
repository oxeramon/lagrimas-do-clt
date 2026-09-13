-- =====================================================================
-- QUITAÇÃO · configuração do banco no Supabase  ·  V1, HISTÓRICO
-- =====================================================================
--
-- >>> NÃO USE ESTE ARQUIVO PARA INSTALAR UM BANCO NOVO. <<<
--
-- Ele instala a V1, e só ela: oito tabelas. O banco de hoje tem vinte e
-- quatro, e as outras dezesseis vieram das catorze migrações de
-- `supabase/migrations/`, que se corrigem umas às outras. Num projeto novo,
-- este arquivo sozinho produz um banco que o site não consegue usar.
--
-- Para instalar do zero:  supabase/bootstrap/README.md
--
-- Ele fica onde está, e continua reexecutável, por duas razões concretas: é
-- o registro de como o banco começou, e o valor de conferência da seção 5 é
-- lido por `testes/regras.mjs`, que amarra a carga de exemplo ao cálculo de
-- saldo. Não o reescreva para virar o schema atual -- isso apagaria a
-- história sem dar nada em troca, porque o schema atual já está inteiro em
-- `supabase/bootstrap/schema.sql`.
--
-- =====================================================================
-- Como usar (V1, referência histórica):
--   1. Crie o usuário primeiro em Authentication > Users > Add user
--      (marque "Auto Confirm User").
--   2. Troque o e-mail na linha marcada com  <<< TROQUE AQUI  logo abaixo.
--   3. Cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- Pode ser executado novamente sem duplicar dados.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------
create table if not exists public.dividas (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  credor          text not null,
  descricao       text not null,
  categoria       text not null default 'Terceiros',
  valor           numeric(12,2) not null check (valor >= 0),
  parcela_inicial integer not null default 1 check (parcela_inicial >= 1),
  total_parcelas  integer not null default 1 check (total_parcelas >= 1),
  mes_inicial     text not null check (mes_inicial ~ '^\d{4}-\d{2}$'),
  obs             text not null default '',
  ordem           integer not null default 0,
  criado_em       timestamptz not null default now(),
  constraint parcela_dentro_do_total check (parcela_inicial <= total_parcelas)
);

create table if not exists public.fixas (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  nome      text not null,
  valor     numeric(12,2) not null check (valor >= 0),
  obs       text not null default '',
  ordem     integer not null default 0,
  criado_em timestamptz not null default now()
);

-- Conta fixa também é gasto, e gasto tem categoria: aluguel é Moradia,
-- academia é Saúde, streaming é Assinaturas. Sem isso a quebra por
-- categoria ignora a maior despesa recorrente da casa.
alter table public.fixas
  add column if not exists categoria text not null default 'Moradia';

-- Uma assinatura cobrada no cartão é conta fixa E linha de fatura ao mesmo
-- tempo. Com credor e meio, a assinatura cobrada num cartão cai dentro da
-- fatura daquele cartão, enquanto o aluguel pago por transferência segue no
-- seu próprio grupo.
alter table public.fixas
  add column if not exists meio text not null default 'Débito automático';
alter table public.fixas
  add column if not exists credor text not null default '';
-- O vínculo por id fica logo depois de `credores` existir, mais abaixo: uma
-- chave estrangeira exige a tabela criada, e aqui ela ainda não foi.

-- quem você deve: cadastro próprio, para agrupar dívidas e guardar contato
create table if not exists public.credores (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  nome      text not null,
  tipo      text not null default 'Pessoa',
  contato   text not null default '',
  obs       text not null default '',
  ordem     integer not null default 0,
  criado_em timestamptz not null default now(),
  constraint credor_nome_unico unique (user_id, nome)
);

-- Agora que `credores` existe, a conta fixa pode apontar para ela. Estas duas
-- linhas já estiveram acima, junto das outras colunas de `fixas`, e ali a FK
-- referenciava uma tabela que só nascia cinco linhas depois: em banco que já
-- tinha `credores` passava batido, em banco novo abortava o arquivo inteiro --
-- justamente a instalação do zero que o README descreve.
alter table public.fixas
  add column if not exists credor_id uuid references public.credores(id) on delete set null;

create index if not exists fixas_credor_idx on public.fixas (credor_id);

-- Aluguel é o mesmo todo mês; energia e condomínio não são. Marcar quais variam
-- muda o que o app promete: onde o valor é média, a sobra do mês é estimativa, e
-- dizer isso em voz alta vale mais do que fingir precisão.
alter table public.fixas
  add column if not exists variavel boolean not null default false;

-- O valor real de uma conta variável num mês. É a segunda coisa deste banco que
-- precisa existir mês a mês, junto de `pagamentos`, e pelo mesmo motivo: não dá
-- para derivar. A conta de luz de outubro não sai de nenhuma conta -- ela chega.
--
-- `fixas.valor` continua sendo a média: serve de palpite para os meses que ainda
-- não chegaram, e não é reescrito quando um mês informa o real. Aqui a chave
-- estrangeira é de verdade, diferente de `pagamentos`: apagar a conta leva os
-- valores dela junto, sem deixar órfão.
create table if not exists public.fixas_mes (
  user_id   uuid not null references auth.users(id) on delete cascade,
  fixa_id   uuid not null references public.fixas(id) on delete cascade,
  mes       text not null check (mes ~ '^\d{4}-\d{2}$'),
  valor     numeric(12,2) not null check (valor >= 0),
  criado_em timestamptz not null default now(),
  primary key (user_id, fixa_id, mes)
);

create index if not exists fixas_mes_idx on public.fixas_mes (user_id, mes);

-- o que entra. 'mensal' se repete todo mês; 'pontual' acontece uma vez só.
-- Numa receita mensal, mes_inicial nulo significa "desde sempre" e
-- mes_final nulo significa "sem prazo para acabar".
create table if not exists public.receitas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  descricao   text not null,
  categoria   text not null default 'Extra',
  valor       numeric(12,2) not null check (valor >= 0),
  tipo        text not null default 'pontual' check (tipo in ('mensal','pontual')),
  mes_inicial text check (mes_inicial ~ '^\d{4}-\d{2}$'),
  mes_final   text check (mes_final ~ '^\d{4}-\d{2}$'),
  obs         text not null default '',
  ordem       integer not null default 0,
  criado_em   timestamptz not null default now(),
  constraint receita_pontual_tem_mes
    check (tipo <> 'pontual' or mes_inicial is not null),
  constraint receita_intervalo_valido
    check (mes_final is null or mes_inicial is null or mes_final >= mes_inicial)
);

-- Três eixos diferentes, que antes viviam espremidos em 'categoria':
--   credor    a quem se deve          (Banco Exemplo)
--   meio      como se paga            (Cartão de crédito)
--   categoria onde o dinheiro foi     (Transporte)
-- Sem isso não dá para responder "quanto gasto com transporte", porque a
-- lista antiga misturava instrumento (Cartão), relação (Terceiros) e gasto.
alter table public.dividas
  add column if not exists meio text not null default 'Outro';

-- Dia da compra, separado do mês em que ela é paga. Uma corrida de 23/08 cai
-- na fatura de outubro: são duas datas diferentes e só a segunda existia.
-- É opcional porque lançamento antigo não tem como saber.
alter table public.dividas
  add column if not exists data_compra date;

create index if not exists dividas_data_idx on public.dividas (user_id, data_compra);

create index if not exists dividas_meio_idx on public.dividas (user_id, meio, mes_inicial);

-- Quem deve não é sempre quem gastou. Uma compra de R$ 340 rachada ao meio
-- continua sendo R$ 340 que VOCÊ paga ao credor -- por isso `valor` não muda --
-- mas metade volta de outra pessoa. Sem separar as duas coisas, ou o saldo com
-- o credor fica errado, ou o que você realmente gastou fica inflado.
--
-- `valor_terceiro` é por parcela, igual a `valor`: numa compra de 4x R$ 88
-- rachada ao meio, são R$ 44 por parcela. Cobre você mais uma pessoa; racha de
-- três vira dois lançamentos.
alter table public.dividas
  add column if not exists pessoa_id uuid references public.credores(id) on delete set null;
alter table public.dividas
  add column if not exists valor_terceiro numeric(12,2) not null default 0
    check (valor_terceiro >= 0);

-- a parte de terceiro não pode passar do que se paga, e não existe parte de
-- terceiro sem terceiro: os dois campos andam juntos ou nenhum dos dois vale
alter table public.dividas drop constraint if exists terceiro_cabe_no_valor;
alter table public.dividas
  add constraint terceiro_cabe_no_valor check (valor_terceiro <= valor);
alter table public.dividas drop constraint if exists terceiro_tem_pessoa;
alter table public.dividas
  add constraint terceiro_tem_pessoa check (valor_terceiro = 0 or pessoa_id is not null);

create index if not exists dividas_pessoa_idx on public.dividas (user_id, pessoa_id);

-- Desativar um credor é diferente de excluir: some das listas de escolha,
-- mas o cadastro e o histórico continuam. Exclusão perde o contato para
-- sempre; desativação é reversível.
alter table public.credores
  add column if not exists ativo boolean not null default true;

-- Quando o cartão fecha e vence. Com os dois, o app sabe sozinho em qual
-- fatura uma compra cai: quem compra dia 23 não deveria ter que calcular
-- que aquilo só é pago em outubro. Nulo em credor que não é cartão.
alter table public.credores
  add column if not exists dia_fechamento smallint
    check (dia_fechamento is null or dia_fechamento between 1 and 31);
alter table public.credores
  add column if not exists dia_vencimento smallint
    check (dia_vencimento is null or dia_vencimento between 1 and 31);

-- Um banco é o credor; cartão é produto dele. Dois cartões do mesmo banco
-- precisam de faturas separadas, porque fecham em dias diferentes, mas quem
-- se deve é um só. O pai guarda a identidade, o filho guarda o ciclo.
-- Nulo = credor de primeiro nível: o próprio banco, uma loja, uma pessoa.
alter table public.credores
  add column if not exists credor_pai_id uuid references public.credores(id) on delete set null;

-- Dois níveis bastam (banco -> produto) e ninguém é pai de si mesmo. A tela
-- só oferece credor de primeiro nível como pai, o que impede o terceiro nível;
-- aqui fica a metade que o banco consegue garantir sozinho.
alter table public.credores drop constraint if exists credores_pai_nao_e_si;
alter table public.credores
  add constraint credores_pai_nao_e_si check (credor_pai_id is null or credor_pai_id <> id);

create index if not exists credores_pai_idx on public.credores (user_id, credor_pai_id, ordem);

create index if not exists credores_ativo_idx on public.credores (user_id, ativo, ordem);

-- liga a dívida ao credor cadastrado. A coluna de texto 'credor' continua
-- existindo e preenchida, então nada quebra durante a migração.
alter table public.dividas
  add column if not exists credor_id uuid references public.credores(id) on delete set null;

-- um registro por item pago em cada mês; item_id = id da dívida ou 'fx:<id da conta fixa>'
create table if not exists public.pagamentos (
  user_id  uuid not null references auth.users(id) on delete cascade,
  mes      text not null check (mes ~ '^\d{4}-\d{2}$'),
  item_id  text not null,
  pago_em  timestamptz not null default now(),
  primary key (user_id, mes, item_id)
);

create table if not exists public.config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  renda   numeric(12,2) not null default 0 check (renda >= 0)
);

-- tabela mínima usada só pelo keep-alive diário (evita a pausa por inatividade)
create table if not exists public.ping (
  id integer primary key,
  visto_em timestamptz not null default now()
);
insert into public.ping (id) values (1) on conflict (id) do nothing;

create index if not exists dividas_user_idx     on public.dividas (user_id, ordem);
create index if not exists fixas_user_idx       on public.fixas (user_id, ordem);
create index if not exists pagamentos_user_idx  on public.pagamentos (user_id, mes);
create index if not exists credores_user_idx    on public.credores (user_id, ordem);
create index if not exists receitas_user_idx    on public.receitas (user_id, ordem);
create index if not exists dividas_credor_idx   on public.dividas (credor_id);

-- ---------------------------------------------------------------------
-- 2. SEGURANÇA (RLS): cada usuário só enxerga as próprias linhas
-- ---------------------------------------------------------------------
alter table public.dividas    enable row level security;
alter table public.fixas      enable row level security;
alter table public.fixas_mes  enable row level security;
alter table public.pagamentos enable row level security;
alter table public.credores   enable row level security;
alter table public.receitas   enable row level security;
alter table public.config     enable row level security;
alter table public.ping       enable row level security;

drop policy if exists dividas_own    on public.dividas;
drop policy if exists fixas_own      on public.fixas;
drop policy if exists fixas_mes_own  on public.fixas_mes;
drop policy if exists pagamentos_own on public.pagamentos;
drop policy if exists credores_own   on public.credores;
drop policy if exists receitas_own   on public.receitas;
drop policy if exists config_own     on public.config;
drop policy if exists ping_read      on public.ping;

create policy dividas_own on public.dividas
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy fixas_own on public.fixas
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy fixas_mes_own on public.fixas_mes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy pagamentos_own on public.pagamentos
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy credores_own on public.credores
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy receitas_own on public.receitas
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy config_own on public.config
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- única tabela legível sem login, e só leitura, sem nenhum dado pessoal
create policy ping_read on public.ping
  for select to anon, authenticated using (true);

-- preenche user_id sozinho, para o app nunca precisar enviar esse campo
create or replace function public.set_user_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null then new.user_id := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists dividas_set_user    on public.dividas;
drop trigger if exists fixas_set_user      on public.fixas;
drop trigger if exists fixas_mes_set_user  on public.fixas_mes;
drop trigger if exists pagamentos_set_user on public.pagamentos;
drop trigger if exists config_set_user     on public.config;
drop trigger if exists credores_set_user   on public.credores;
drop trigger if exists receitas_set_user   on public.receitas;

create trigger dividas_set_user    before insert on public.dividas    for each row execute function public.set_user_id();
create trigger fixas_set_user      before insert on public.fixas      for each row execute function public.set_user_id();
create trigger fixas_mes_set_user  before insert on public.fixas_mes  for each row execute function public.set_user_id();
create trigger pagamentos_set_user before insert on public.pagamentos for each row execute function public.set_user_id();
create trigger config_set_user     before insert on public.config     for each row execute function public.set_user_id();
create trigger credores_set_user   before insert on public.credores   for each row execute function public.set_user_id();
create trigger receitas_set_user   before insert on public.receitas   for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 3. CARGA INICIAL (demonstração)
-- ---------------------------------------------------------------------
-- Este bloco existe só para uma instalação nova ter o que mostrar na primeira
-- abertura e para o passo de conferência do README ter um número com que
-- comparar. Todos os registros abaixo são FICTÍCIOS e os valores são redondos
-- de propósito: este repositório é público, e dado financeiro de verdade não
-- entra aqui. Quem for usar de verdade apaga estas linhas ou simplesmente
-- exclui os registros de exemplo pelo próprio app.
--
-- O conjunto é pequeno mas cobre os casos que o app trata de forma diferente:
-- pagamento à vista, parcelamento que começa na parcela 1, parcelamento que
-- começa no meio (quem entra na 3 de 6 já pagou 2 antes), e um financiamento
-- de prazo longo.
do $$
declare
  uid uuid;
  meu_email text := 'troque@pelo-seu-email.com';   -- <<< TROQUE AQUI
begin
  select id into uid from auth.users where lower(email) = lower(meu_email);
  if uid is null then
    -- Instalação que já existe, ou e-mail ainda não trocado: não há o que
    -- carregar. Sair sem erro é essencial, senão um 'raise exception' aqui
    -- aborta o arquivo inteiro e as migrações abaixo nunca rodam.
    raise notice 'Carga inicial ignorada: usuário % não encontrado.', meu_email;
    return;
  end if;

  -- não recarrega se já houver dados
  if exists (select 1 from public.dividas where user_id = uid) then
    raise notice 'Carga inicial ignorada: já existem dívidas para este usuário.';
    return;
  end if;

  insert into public.dividas
    (user_id, credor, descricao, categoria, valor, parcela_inicial, total_parcelas, mes_inicial, obs, ordem)
  select uid, v.credor, v.descricao, v.categoria, v.valor, v.pi, v.tot, v.mes, v.obs, v.ordem
  from (values
    ('Loja Exemplo',    'Compra Exemplo à vista',   'Compras',        111.00,  1,  1, '2026-10', 'pagamento único',        10),
    ('Cartão Exemplo',  'Fatura Exemplo',           'Cartão',         222.00,  1,  1, '2026-10', 'fatura fechada',         20),
    ('Cartão Exemplo',  'Compra Exemplo parcelada', 'Cartão',          33.00,  1,  4, '2026-11', 'começa na parcela 1',    30),
    ('Pessoa Exemplo',  'Item Exemplo',             'Terceiros',      144.00,  3,  6, '2026-10', 'já tinha 2 parcelas',    40),
    ('Pessoa Exemplo',  'Serviço Exemplo',          'Terceiros',       88.00,  4,  9, '2026-10', 'já tinha 3 parcelas',    50),
    ('Banco Exemplo',   'Financiamento Exemplo',    'Financiamento', 1111.00, 12, 36, '2026-10', 'prazo longo',            60)
  ) as v(credor, descricao, categoria, valor, pi, tot, mes, obs, ordem);

  insert into public.fixas (user_id, nome, valor, obs, ordem)
  select uid, v.nome, v.valor, v.obs, v.ordem
  from (values
    ('Aluguel Exemplo',     777.00, 'valor fixo',      10),
    ('Conta Exemplo',       123.00, 'média informada', 20)
  ) as v(nome, valor, obs, ordem);

  insert into public.config (user_id, renda) values (uid, 0)
  on conflict (user_id) do nothing;

  raise notice 'Carga inicial de exemplo concluída: 6 dívidas e 2 contas fixas.';
end $$;

-- ---------------------------------------------------------------------
-- 4. MIGRAÇÃO: transforma os nomes de credor em cadastro de verdade
-- ---------------------------------------------------------------------
-- Roda sozinho e pode ser repetido: cria um credor para cada nome distinto
-- que já aparece em 'dividas' e liga as linhas que ainda estão soltas.
do $$
declare
  novos   integer;
  ligadas integer;
begin
  insert into public.credores (user_id, nome, tipo, ordem)
  select
    d.user_id,
    d.credor,
    case min(d.categoria)
      when 'Cartão'        then 'Cartão'
      when 'Financiamento' then 'Banco'
      when 'Compras'       then 'Loja'
      else 'Pessoa'
    end,
    min(d.ordem)
  from public.dividas d
  group by d.user_id, d.credor
  on conflict (user_id, nome) do nothing;
  get diagnostics novos = row_count;

  update public.dividas d
     set credor_id = c.id
    from public.credores c
   where c.user_id = d.user_id
     and c.nome    = d.credor
     and d.credor_id is null;
  get diagnostics ligadas = row_count;

  raise notice 'Migração de credores: % credor(es) criado(s), % dívida(s) ligada(s).', novos, ligadas;
end $$;

-- "Pix ou transferência" virou só "Pix". O nome comprido era para abrigar TED
-- e DOC, que na prática ninguém mais usa; ficava largo demais na lista e não
-- ajudava ninguém a decidir nada.
update public.dividas set meio = 'Pix' where meio = 'Pix ou transferência';
update public.fixas   set meio = 'Pix' where meio = 'Pix ou transferência';

-- ---------------------------------------------------------------------
-- 5. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- Numa instalação do zero, com a carga de exemplo da seção 3 e nada mais,
-- saldo_devedor_total sai 29344.00. Em base já em uso o número é outro, e é
-- assim mesmo: ele serve para comparar antes e depois de uma migração, não
-- como constante do projeto.
-- dividas_sem_credor precisa ficar em 0 depois da migração.
select
  (select round(sum(valor * (total_parcelas - parcela_inicial + 1)), 2) from public.dividas) as saldo_devedor_total,
  (select count(*) from public.credores)                                                    as credores,
  (select count(*) from public.receitas)                                                    as receitas,
  (select count(*) from public.dividas where credor_id is null)                             as dividas_sem_credor;

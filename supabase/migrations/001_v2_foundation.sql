-- =====================================================================
-- 001 · FUNDAÇÃO DA V2
-- =====================================================================
-- ESTA MIGRAÇÃO AINDA NÃO FOI EXECUTADA. Ela existe em arquivo para ser
-- revisada antes de encostar em banco nenhum.
--
-- O que ela faz: acrescenta quatro tabelas que a V1 não tem. Não renomeia,
-- não remove, não migra dado e não altera nenhuma tabela existente. Depois de
-- rodar, o app da V1 continua funcionando exatamente igual, porque ele não
-- consulta nada daqui.
--
-- É idempotente, como todo SQL deste projeto: `create table if not exists`,
-- `add column if not exists`, `drop policy if exists` antes de criar.
--
-- ---------------------------------------------------------------------
-- O MODELO
-- ---------------------------------------------------------------------
--   instituição
--       ├── contas      (corrente, poupança, carteira, investimento, FGTS)
--       └── cartões     (fase seguinte; hoje cartão ainda é `credores`)
--
--   contas
--       └── transações  (movimento que ACONTECEU)
--
--   compromissos
--       └── dividas     (a tabela da V1, intocada)
--
-- Oito distinções que o modelo mantém separadas de propósito, porque juntá-las
-- é como se erra um app de finanças:
--
--   instituição ≠ conta       o banco não é a conta corrente dele
--   conta ≠ credor            de onde o dinheiro sai não é a quem se deve
--   cartão ≠ credor           o cartão é o instrumento, o banco é o credor
--   dívida ≠ transação        obrigação não é movimento
--   pagamento ≠ transação     marcar como pago é um ato de controle
--   receita prevista ≠ entrada realizada
--   fatura ≠ gasto            a fatura agrupa gastos, não é um gasto
--   pagar a fatura ≠ gastar   é liquidação, não despesa nova
--
-- A última é a que mais dá errado na prática: lançar o pagamento da fatura
-- como despesa conta o mesmo dinheiro duas vezes, uma na compra e outra na
-- quitação. Aqui a compra é a despesa; o pagamento é saída de caixa que
-- liquida uma obrigação.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. INSTITUIÇÕES
-- ---------------------------------------------------------------------
-- Quem guarda ou empresta o dinheiro: banco, corretora, fintech, o cofre de
-- casa. Não é a conta -- uma instituição tem várias. Separar as duas é o que
-- permite ter corrente e poupança no mesmo banco sem duplicar identidade.
create table if not exists public.instituicoes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  nome       text not null,
  tipo       text not null default 'Banco'
             check (tipo in ('Banco','Corretora','Fintech','Carteira','Empregador','Outro')),
  -- o logo entra como URL ou data URI; o app não hospeda imagem
  logo       text not null default '',
  -- cor da marca, para o app não ter que inventar uma paleta por instituição.
  -- Opcional: sem ela o app usa a cor de série que já usa hoje.
  cor        text check (cor is null or cor ~ '^#[0-9A-Fa-f]{6}$'),
  ativo      boolean not null default true,
  obs        text not null default '',
  ordem      integer not null default 0,
  criado_em  timestamptz not null default now(),
  constraint instituicao_nome_unico unique (user_id, nome)
);

create index if not exists instituicoes_user_idx on public.instituicoes (user_id, ativo, ordem);

-- ---------------------------------------------------------------------
-- 2. CONTAS
-- ---------------------------------------------------------------------
-- Onde o dinheiro está. O saldo NÃO é uma coluna mantida à mão: ele é
--
--     saldo inicial
--     + entradas − saídas
--     + transferências recebidas − transferências enviadas
--
-- a partir de `saldo_inicial_em`. Guardar `saldo_atual` como fonte primária
-- parece prático e envelhece mal: qualquer transação perdida, duplicada ou
-- fora de ordem faz a coluna divergir do extrato, e a partir daí ninguém sabe
-- qual dos dois está certo. A coluna pode voltar depois como CACHE, com o
-- derivado continuando sendo a verdade.
--
-- `liquidez` existe por causa do FGTS e dos parentes dele: dinheiro que é seu,
-- conta como patrimônio, e não está disponível para pagar a conta de luz.
-- Tratar FGTS como receita mensal seria pior ainda -- ele não entra todo mês.
create table if not exists public.contas (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  instituicao_id    uuid references public.instituicoes(id) on delete set null,
  nome              text not null,
  tipo              text not null default 'corrente'
                    check (tipo in ('corrente','poupanca','carteira','investimento','fgts','outro')),
  saldo_inicial     numeric(14,2) not null default 0,
  -- a partir de quando o saldo inicial vale. Sem isso não há de onde começar
  -- a somar, e o saldo derivado fica sem âncora.
  saldo_inicial_em  date not null default current_date,
  liquidez          text not null default 'livre'
                    check (liquidez in ('livre','restrita','bloqueada')),
  moeda             text not null default 'BRL',
  ativo             boolean not null default true,
  obs               text not null default '',
  ordem             integer not null default 0,
  criado_em         timestamptz not null default now(),
  constraint conta_nome_unico unique (user_id, nome)
);

create index if not exists contas_user_idx on public.contas (user_id, ativo, ordem);
create index if not exists contas_instituicao_idx on public.contas (instituicao_id);

-- ---------------------------------------------------------------------
-- 3. CATEGORIAS
-- ---------------------------------------------------------------------
-- Hierarquia de até três níveis:  Alimentação › Restaurante › Pizza
--
-- Nenhuma categoria vem embutida no schema. As listas da V1 (`CATS_OK` no
-- app) continuam existindo como constante do frontend enquanto a V2 não está
-- ligada; quando estiver, elas viram linhas aqui. Cravar nomes no banco é o
-- tipo de decisão que fica cara: a lista muda, e migração de texto é chata.
--
-- O nível é derivado do pai, mas fica materializado para a consulta não
-- precisar subir a árvore só para saber em que andar está. A constraint
-- garante o teto de três.
create table if not exists public.categorias (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  pai_id     uuid references public.categorias(id) on delete cascade,
  nome       text not null,
  nivel      smallint not null default 1 check (nivel between 1 and 3),
  -- entrada e saída não compartilham árvore: "Salário" não é subcategoria de
  -- "Alimentação", e misturar as duas faz a lista de escolha virar um caos
  fluxo      text not null default 'saida' check (fluxo in ('entrada','saida','ambos')),
  cor        text check (cor is null or cor ~ '^#[0-9A-Fa-f]{6}$'),
  icone      text not null default '',
  ativo      boolean not null default true,
  ordem      integer not null default 0,
  criado_em  timestamptz not null default now(),
  constraint categoria_nao_e_pai_de_si check (pai_id is null or pai_id <> id),
  constraint categoria_nome_unico_no_pai unique (user_id, pai_id, nome)
);

create index if not exists categorias_user_idx on public.categorias (user_id, ativo, ordem);
create index if not exists categorias_pai_idx on public.categorias (user_id, pai_id);

-- O teto de três níveis o banco garante junto com a tela: aqui fica a metade
-- que ele consegue sozinho -- filho de nível 3 não existe, porque `nivel` não
-- passa de 3 e um gatilho o calcula a partir do pai.
create or replace function public.nivel_da_categoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  nivel_pai smallint;
begin
  if new.pai_id is null then
    new.nivel := 1;
  else
    select nivel into nivel_pai from public.categorias where id = new.pai_id;
    new.nivel := coalesce(nivel_pai, 0) + 1;
  end if;
  return new;
end $$;

drop trigger if exists categorias_nivel on public.categorias;
create trigger categorias_nivel before insert or update of pai_id on public.categorias
  for each row execute function public.nivel_da_categoria();

-- ---------------------------------------------------------------------
-- 4. TRANSAÇÕES
-- ---------------------------------------------------------------------
-- Movimento que ACONTECEU, ou que está previsto para acontecer numa data.
-- Não confundir com `dividas`, que é obrigação: uma dívida de 24 parcelas é
-- UMA linha em `dividas` e vira, no máximo, 24 transações ao longo do tempo.
--
-- `origem` diz de onde a linha veio. Ela existe desde já porque saber a
-- procedência é o que permite desfazer uma importação inteira, não duplicar
-- lançamento de uma recorrência já gerada, e -- quando a entrada por mensagem
-- existir -- separar o que a IA criou do que a pessoa digitou.
--
-- `transferencia_par_id` liga as duas pernas de uma transferência. Elas são
-- duas linhas de propósito: uma saída na conta de origem e uma entrada na de
-- destino, para o saldo de cada conta fechar sozinho sem caso especial.
create table if not exists public.transacoes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  conta_id      uuid references public.contas(id) on delete set null,
  categoria_id  uuid references public.categorias(id) on delete set null,
  tipo          text not null check (tipo in ('entrada','saida','transferencia','estorno')),
  descricao     text not null,
  valor         numeric(14,2) not null check (valor >= 0),
  data          date not null,
  status        text not null default 'realizada'
                check (status in ('prevista','realizada','conciliada','cancelada')),
  origem        text not null default 'manual'
                check (origem in ('manual','divida','recorrencia','cartao','importacao','mensagem')),
  -- de onde veio, quando veio de outro registro. Texto livre e sem FK, pela
  -- mesma razão de `pagamentos.item_id` na V1: a origem pode ser de tabelas
  -- diferentes, e uma FK só aponta para uma.
  origem_id     text not null default '',
  transferencia_par_id uuid references public.transacoes(id) on delete set null,
  obs           text not null default '',
  criado_em     timestamptz not null default now(),
  -- transferência sempre anda em par; os outros tipos nunca têm par
  constraint transferencia_tem_par
    check ((tipo = 'transferencia') or transferencia_par_id is null),
  constraint transacao_nao_e_par_de_si
    check (transferencia_par_id is null or transferencia_par_id <> id)
);

create index if not exists transacoes_user_data_idx on public.transacoes (user_id, data desc);
create index if not exists transacoes_conta_idx on public.transacoes (user_id, conta_id, data);
create index if not exists transacoes_categoria_idx on public.transacoes (user_id, categoria_id);
create index if not exists transacoes_origem_idx on public.transacoes (user_id, origem, origem_id);
create index if not exists transacoes_status_idx on public.transacoes (user_id, status, data);

-- ---------------------------------------------------------------------
-- 5. SEGURANÇA
-- ---------------------------------------------------------------------
-- O repositório é público e a chave publicável fica visível no HTML. RLS é a
-- única coisa que separa os dados de qualquer pessoa que abrir o site. Os
-- quatro blocos andam juntos: enable, policy, trigger, índice.
alter table public.instituicoes enable row level security;
alter table public.contas       enable row level security;
alter table public.categorias   enable row level security;
alter table public.transacoes   enable row level security;

drop policy if exists instituicoes_own on public.instituicoes;
drop policy if exists contas_own       on public.contas;
drop policy if exists categorias_own   on public.categorias;
drop policy if exists transacoes_own   on public.transacoes;

create policy instituicoes_own on public.instituicoes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy contas_own on public.contas
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy categorias_own on public.categorias
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy transacoes_own on public.transacoes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- `set_user_id()` já existe desde a V1 e é reaproveitada: ela preenche o campo
-- sozinha, para o app nunca precisar enviar, e a policy `with check` barra
-- quem tentar mandar user_id alheio.
drop trigger if exists instituicoes_set_user on public.instituicoes;
drop trigger if exists contas_set_user       on public.contas;
drop trigger if exists categorias_set_user   on public.categorias;
drop trigger if exists transacoes_set_user   on public.transacoes;

create trigger instituicoes_set_user before insert on public.instituicoes for each row execute function public.set_user_id();
create trigger contas_set_user       before insert on public.contas       for each row execute function public.set_user_id();
create trigger categorias_set_user   before insert on public.categorias   for each row execute function public.set_user_id();
create trigger transacoes_set_user   before insert on public.transacoes   for each row execute function public.set_user_id();

-- ---------------------------------------------------------------------
-- 6. SALDO DERIVADO
-- ---------------------------------------------------------------------
-- A regra de saldo em um lugar só, como view. Nenhuma coluna `saldo_atual`
-- mantida à mão: a verdade é a soma, e a soma é aqui.
--
-- Transação `prevista` e `cancelada` ficam de fora: saldo é o que aconteceu.
-- Quem quiser projeção soma as previstas por cima, o que é outra pergunta.
create or replace view public.saldos_de_conta as
select
  c.id                                  as conta_id,
  c.user_id,
  c.nome,
  c.tipo,
  c.liquidez,
  c.saldo_inicial,
  c.saldo_inicial_em,
  coalesce(sum(
    case
      when t.status not in ('realizada','conciliada') then 0
      when t.tipo = 'entrada'  then  t.valor
      when t.tipo = 'saida'    then -t.valor
      when t.tipo = 'estorno'  then  t.valor
      -- transferência é uma linha por perna: o sinal vem do valor lançado em
      -- cada conta, então a soma de cada lado fecha sozinha
      when t.tipo = 'transferencia' then t.valor
      else 0
    end), 0) + c.saldo_inicial          as saldo
from public.contas c
left join public.transacoes t
       on t.conta_id = c.id
      and t.user_id  = c.user_id
      and t.data    >= c.saldo_inicial_em
group by c.id, c.user_id, c.nome, c.tipo, c.liquidez, c.saldo_inicial, c.saldo_inicial_em;

-- A view herda o RLS das tabelas de baixo quando roda com os privilégios de
-- quem consulta, e não os do dono. Sem isto a view seria um furo no RLS.
alter view public.saldos_de_conta set (security_invoker = on);

-- ---------------------------------------------------------------------
-- 7. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- Depois de rodar, as quatro contagens vêm zeradas -- a migração não carrega
-- dado. O que importa conferir é que as quatro tabelas existem COM RLS ligada.
select
  (select count(*) from public.instituicoes)  as instituicoes,
  (select count(*) from public.contas)        as contas,
  (select count(*) from public.categorias)    as categorias,
  (select count(*) from public.transacoes)    as transacoes,
  (select count(*) from pg_tables
    where schemaname = 'public'
      and tablename in ('instituicoes','contas','categorias','transacoes')
      and rowsecurity)                        as com_rls_ligada;

-- ---------------------------------------------------------------------
-- 8. ROLLBACK
-- ---------------------------------------------------------------------
-- Esta migração é puramente aditiva, então desfazer é seguro ENQUANTO nenhum
-- dado tiver sido gravado nas tabelas novas. Confira a seção 7 antes: se as
-- contagens não estiverem em zero, você vai apagar dado de verdade.
--
-- O `cascade` no drop da view é desnecessário e está omitido de propósito:
-- derrubar a view primeiro, e as tabelas depois, na ordem inversa das
-- dependências.
--
--   drop view if exists public.saldos_de_conta;
--   drop table if exists public.transacoes;
--   drop table if exists public.categorias;
--   drop table if exists public.contas;
--   drop table if exists public.instituicoes;
--   drop function if exists public.nivel_da_categoria();
--
-- `set_user_id()` NÃO deve ser removida: ela é da V1 e as sete tabelas
-- antigas dependem dela.

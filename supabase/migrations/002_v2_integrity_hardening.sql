-- =====================================================================
-- 002 · INTEGRIDADE DA V2
-- =====================================================================
-- A 001 criou as quatro tabelas da V2 e é IMUTÁVEL: nada aqui a edita, e o
-- arquivo dela continua igual ao texto gravado em `schema_migrations`.
--
-- PRÉ-CONDIÇÃO: as quatro tabelas da V2 precisam estar VAZIAS. Esta migração
-- estreita `transacoes.tipo`, remove `transferencia_par_id` e troca a
-- unicidade de `categorias`. Com tabelas vazias isso não perde nada; com dado
-- dentro, perderia. Confira a seção 11 antes de rodar, em qualquer banco que
-- não seja o que já foi conferido.
--
-- ---------------------------------------------------------------------
-- O QUE ESTAVA ERRADO NA 001
-- ---------------------------------------------------------------------
-- Seis defeitos de modelo, todos achados antes de existir uma linha:
--
-- 1. FK não conferia dono. `contas.instituicao_id`, `categorias.pai_id`,
--    `transacoes.conta_id`, `.categoria_id` e `.transferencia_par_id`
--    apontavam só para `id`. A checagem de FK roda POR FORA do RLS, por
--    definição do Postgres, então nada impedia uma linha de um usuário de
--    apontar para objeto de outro. RLS esconde; não é integridade.
--
-- 2. Transferência não tinha sinal. `valor >= 0`, `tipo = 'transferencia'`
--    e a view somando `+valor` nas duas pernas: não havia como dizer qual
--    perna sai e qual entra. O dinheiro aparecia duas vezes.
--
-- 3. `transferencia_tem_par` não obrigava par nenhum. Ela só dizia "se não
--    for transferência, o par é nulo" -- uma transferência sozinha passava.
--    E o par ser FK para a própria tabela exigia inserir uma perna
--    incompleta antes da outra.
--
-- 4. Estorno somava sempre como entrada. Estornar uma despesa aumenta o
--    saldo; estornar uma receita diminui. Um `tipo` só não dava conta.
--
-- 5. `unique (user_id, pai_id, nome)` não impedia duas categorias-raiz com
--    o mesmo nome: em `pai_id is null`, NULL não é igual a NULL, e o índice
--    deixava as duas entrarem.
--
-- 6. Os dois gatilhos BEFORE INSERT de `categorias` disparavam em ordem
--    alfabética: `categorias_nivel` ANTES de `categorias_set_user`. O nível
--    era calculado com `user_id` ainda nulo.
--
-- ---------------------------------------------------------------------
-- O MODELO CORRIGIDO
-- ---------------------------------------------------------------------
-- `tipo` passa a significar UMA coisa só: o efeito no saldo.
--
--     tipo      entrada | saida            -- o sinal, sempre
--     natureza  normal | transferencia | estorno   -- o que é, economicamente
--
-- Assim o saldo é uma soma sem caso especial:
--
--     saldo = saldo_inicial + entradas realizadas − saídas realizadas
--
-- Transferência vira duas linhas com o mesmo `transferencia_id`: uma `saida`
-- na conta de origem e uma `entrada` na de destino, mesmo valor. Cada conta
-- fecha sozinha e o patrimônio consolidado não muda, porque as duas pernas se
-- anulam. Não há mais `tipo = 'transferencia'` pedindo regra de sinal.
--
-- Estorno vira uma linha de sinal contrário ao da original, ligada a ela por
-- `estorno_de_id`. Estorno de `saida` é `entrada`; estorno de `entrada` é
-- `saida`. O sinal continua saindo do `tipo`, e `natureza` só conta a
-- história.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CHAVE AUXILIAR (user_id, id) NAS TABELAS APONTADAS
-- ---------------------------------------------------------------------
-- Uma FK só aponta para colunas com unicidade declarada. Para a FK composta
-- poder exigir "mesmo dono", cada tabela apontada ganha `unique (user_id,
-- id)`. É redundante com a primária -- `id` já é único sozinho -- e é o preço
-- de deixar o banco, e não a aplicação, garantir o dono.
alter table public.instituicoes drop constraint if exists instituicoes_dono_id_unico;
alter table public.instituicoes add  constraint instituicoes_dono_id_unico unique (user_id, id);

alter table public.contas drop constraint if exists contas_dono_id_unico;
alter table public.contas add  constraint contas_dono_id_unico unique (user_id, id);

alter table public.categorias drop constraint if exists categorias_dono_id_unico;
alter table public.categorias add  constraint categorias_dono_id_unico unique (user_id, id);

alter table public.transacoes drop constraint if exists transacoes_dono_id_unico;
alter table public.transacoes add  constraint transacoes_dono_id_unico unique (user_id, id);

-- ---------------------------------------------------------------------
-- 2. FKs COMPOSTAS: A LINHA APONTADA É DO MESMO DONO
-- ---------------------------------------------------------------------
-- `on delete set null (coluna)` existe desde o Postgres 15 e é o que torna
-- isto possível: sem a lista de colunas, apagar a instituição tentaria anular
-- TAMBÉM o `user_id`, que é `not null`, e o delete morreria.
--
-- `match simple` (o padrão) é o que queremos: quando a coluna opcional é
-- nula, a FK não é conferida. Com `match full` o par (user_id não-nulo,
-- coluna nula) seria recusado, e conta sem instituição deixaria de existir.

alter table public.contas drop constraint if exists contas_instituicao_id_fkey;
alter table public.contas drop constraint if exists contas_instituicao_dono_fk;
alter table public.contas add  constraint contas_instituicao_dono_fk
  foreign key (user_id, instituicao_id) references public.instituicoes (user_id, id)
  on update cascade on delete set null (instituicao_id);

alter table public.categorias drop constraint if exists categorias_pai_id_fkey;
alter table public.categorias drop constraint if exists categorias_pai_dono_fk;
alter table public.categorias add  constraint categorias_pai_dono_fk
  foreign key (user_id, pai_id) references public.categorias (user_id, id)
  on update cascade on delete cascade;

alter table public.transacoes drop constraint if exists transacoes_conta_id_fkey;
alter table public.transacoes drop constraint if exists transacoes_conta_dono_fk;
alter table public.transacoes add  constraint transacoes_conta_dono_fk
  foreign key (user_id, conta_id) references public.contas (user_id, id)
  on update cascade on delete set null (conta_id);

alter table public.transacoes drop constraint if exists transacoes_categoria_id_fkey;
alter table public.transacoes drop constraint if exists transacoes_categoria_dono_fk;
alter table public.transacoes add  constraint transacoes_categoria_dono_fk
  foreign key (user_id, categoria_id) references public.categorias (user_id, id)
  on update cascade on delete set null (categoria_id);

-- a FK de `contas.instituicao_id` agora é composta, e o índice de antes
-- cobria só a coluna solta
create index if not exists contas_instituicao_dono_idx on public.contas (user_id, instituicao_id);

-- ---------------------------------------------------------------------
-- 3. `tipo` É O SINAL; `natureza` É O QUE ACONTECEU
-- ---------------------------------------------------------------------
alter table public.transacoes drop constraint if exists transacoes_tipo_check;
alter table public.transacoes add  constraint transacoes_tipo_check
  check (tipo in ('entrada','saida'));

alter table public.transacoes add column if not exists natureza text not null default 'normal';
alter table public.transacoes drop constraint if exists transacoes_natureza_check;
alter table public.transacoes add  constraint transacoes_natureza_check
  check (natureza in ('normal','transferencia','estorno'));

-- valor continua sem sinal: quem dá o sinal é o `tipo`. Zero não é movimento.
alter table public.transacoes drop constraint if exists transacoes_valor_check;
alter table public.transacoes add  constraint transacoes_valor_check check (valor > 0);

-- ---------------------------------------------------------------------
-- 4. TRANSFERÊNCIA: GRUPO NO LUGAR DE PAR CIRCULAR
-- ---------------------------------------------------------------------
-- O par apontando para a outra perna obrigava a inserir uma linha incompleta
-- primeiro. Um `transferencia_id` comum resolve: as duas pernas nascem no
-- mesmo insert, sem uma precisar existir antes da outra.
alter table public.transacoes add column if not exists transferencia_id uuid;

alter table public.transacoes drop constraint if exists transferencia_tem_par;
alter table public.transacoes drop constraint if exists transacao_nao_e_par_de_si;
alter table public.transacoes drop constraint if exists transacoes_transferencia_par_id_fkey;
alter table public.transacoes drop column if exists transferencia_par_id;

-- os dois lados da mesma moeda: é transferência se, e só se, tem grupo
alter table public.transacoes drop constraint if exists transferencia_tem_grupo;
alter table public.transacoes add  constraint transferencia_tem_grupo
  check ((natureza = 'transferencia') = (transferencia_id is not null));

create index if not exists transacoes_transferencia_idx on public.transacoes (user_id, transferencia_id);

-- ---------------------------------------------------------------------
-- 5. ESTORNO: LIGADO À ORIGINAL, SINAL PELO `tipo`
-- ---------------------------------------------------------------------
alter table public.transacoes add column if not exists estorno_de_id uuid;

alter table public.transacoes drop constraint if exists estorno_tem_original;
alter table public.transacoes add  constraint estorno_tem_original
  check ((natureza = 'estorno') = (estorno_de_id is not null));

alter table public.transacoes drop constraint if exists transacao_nao_estorna_a_si;
alter table public.transacoes add  constraint transacao_nao_estorna_a_si
  check (estorno_de_id is null or estorno_de_id <> id);

-- `restrict` e não `set null`: apagar a original deixaria o estorno órfão, e
-- `estorno_tem_original` recusaria a linha resultante. Quem quiser apagar a
-- original apaga o estorno antes, de propósito.
alter table public.transacoes drop constraint if exists transacoes_estorno_dono_fk;
alter table public.transacoes add  constraint transacoes_estorno_dono_fk
  foreign key (user_id, estorno_de_id) references public.transacoes (user_id, id)
  on update cascade on delete restrict;

create index if not exists transacoes_estorno_idx on public.transacoes (user_id, estorno_de_id);

-- ---------------------------------------------------------------------
-- 6. A TRANSFERÊNCIA PRECISA DE DUAS PERNAS DE VERDADE
-- ---------------------------------------------------------------------
-- Isto NÃO cabe em `check`: um `check` enxerga uma linha por vez, e a regra é
-- sobre o grupo. Vai como gatilho de constraint DIFERIDO -- a conferência
-- roda no commit, então as duas pernas podem nascer em qualquer ordem dentro
-- da mesma transação, e o estado intermediário de uma perna só nunca é
-- rejeitado no meio do caminho. O que não passa é a transação TERMINAR com a
-- transferência pela metade.
create or replace function public.confere_grupo_transferencia(grupo uuid)
returns void language plpgsql as $$
declare
  pernas int; entradas int; saidas int; valores int; donos int; contas int;
begin
  select count(*), count(*) filter (where tipo = 'entrada'),
         count(*) filter (where tipo = 'saida'),
         count(distinct valor), count(distinct user_id), count(distinct conta_id)
    into pernas, entradas, saidas, valores, donos, contas
    from public.transacoes where transferencia_id = grupo;

  -- grupo desfeito por inteiro: nada a conferir
  if pernas = 0 then return; end if;

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
end $$;

create or replace function public.valida_transferencia()
returns trigger language plpgsql as $$
begin
  -- na saída de um grupo (update que troca o grupo, ou delete) o grupo ANTIGO
  -- também precisa continuar íntegro
  if tg_op in ('UPDATE','DELETE') and old.transferencia_id is not null then
    perform public.confere_grupo_transferencia(old.transferencia_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and new.transferencia_id is not null then
    perform public.confere_grupo_transferencia(new.transferencia_id);
  end if;
  return null;
end $$;

drop trigger if exists transacoes_transferencia_completa on public.transacoes;
create constraint trigger transacoes_transferencia_completa
  after insert or update or delete on public.transacoes
  deferrable initially deferred
  for each row execute function public.valida_transferencia();

-- ---------------------------------------------------------------------
-- 7. CATEGORIAS: NULL DEIXA DE SER UM BURACO NA UNICIDADE
-- ---------------------------------------------------------------------
-- `nulls not distinct` existe desde o Postgres 15. Sem ele, duas raízes com o
-- mesmo nome passavam, porque NULL nunca é igual a NULL num índice único.
--
-- CONTRATO, explícito: o nome de uma categoria é único entre os irmãos, e as
-- raízes são irmãs entre si. Vale por usuário e NÃO olha `fluxo` -- não dá
-- para ter "Ajuste" como raiz de entrada e outra de saída. É uma escolha:
-- nome repetido em duas árvores confunde na hora de escolher numa lista.
alter table public.categorias drop constraint if exists categoria_nome_unico_no_pai;
alter table public.categorias add  constraint categoria_nome_unico_no_pai
  unique nulls not distinct (user_id, pai_id, nome);

-- ---------------------------------------------------------------------
-- 8. ORDEM DOS GATILHOS, E O NÍVEL QUE NÃO OLHA PAI ALHEIO
-- ---------------------------------------------------------------------
-- Gatilho BEFORE dispara em ordem ALFABÉTICA do nome. `categorias_nivel` vinha
-- antes de `categorias_set_user`, então o nível era calculado com `user_id`
-- ainda nulo e saía 1 para todo mundo. O número no nome deixa a ordem
-- explícita e impossível de quebrar por acidente ao renomear.
create or replace function public.nivel_da_categoria()
returns trigger language plpgsql security invoker set search_path = public as $$
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

drop trigger if exists categorias_nivel on public.categorias;
drop trigger if exists categorias_set_user on public.categorias;
drop trigger if exists categorias_1_set_user on public.categorias;
drop trigger if exists categorias_2_nivel on public.categorias;

create trigger categorias_1_set_user before insert on public.categorias
  for each row execute function public.set_user_id();
create trigger categorias_2_nivel before insert or update of pai_id on public.categorias
  for each row execute function public.nivel_da_categoria();

-- ---------------------------------------------------------------------
-- 9. AS FUNÇÕES DE GATILHO SAEM DA API
-- ---------------------------------------------------------------------
-- Todas elas nasceram com `execute` para PUBLIC, o que as expõe em
-- `/rest/v1/rpc/`. Nenhuma faz sentido chamada solta -- `new` não existe fora
-- de gatilho -- e gatilho NÃO precisa de `execute`: o privilégio é conferido
-- quando o gatilho é criado, não quando dispara. Tirar o grant não enfraquece
-- nada; só fecha uma porta que não levava a lugar nenhum.
revoke execute on function public.set_user_id()            from public, anon, authenticated;
revoke execute on function public.nivel_da_categoria()     from public, anon, authenticated;
revoke execute on function public.valida_transferencia()   from public, anon, authenticated;
revoke execute on function public.confere_grupo_transferencia(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. SALDO: UMA SOMA, SEM CASO ESPECIAL
-- ---------------------------------------------------------------------
--     saldo = saldo_inicial + entradas realizadas − saídas realizadas
--
-- Transferência não aparece aqui, e é esse o ponto: as duas pernas já são uma
-- `saida` e uma `entrada` comuns. A de origem diminui, a de destino aumenta, e
-- somando as contas todas o patrimônio não se mexe.
--
-- `prevista` e `cancelada` ficam de fora -- saldo é o que aconteceu. O filtro
-- vai no ON e não no WHERE: no WHERE ele transformaria o LEFT JOIN em INNER e
-- sumiria com toda conta que ainda não tem movimento.
create or replace view public.saldos_de_conta as
select
  c.id               as conta_id,
  c.user_id,
  c.nome,
  c.tipo,
  c.liquidez,
  c.saldo_inicial,
  c.saldo_inicial_em,
  c.saldo_inicial + coalesce(sum(
    case when t.tipo = 'entrada' then t.valor else -t.valor end
  ), 0)              as saldo
from public.contas c
left join public.transacoes t
       on t.conta_id = c.id
      and t.user_id  = c.user_id
      and t.status in ('realizada','conciliada')
      and t.data    >= c.saldo_inicial_em
group by c.id, c.user_id, c.nome, c.tipo, c.liquidez, c.saldo_inicial, c.saldo_inicial_em;

alter view public.saldos_de_conta set (security_invoker = on);

-- ---------------------------------------------------------------------
-- 11. CONFERÊNCIA
-- ---------------------------------------------------------------------
-- As quatro contagens precisam vir ZERADAS, e não porque a migração apagou
-- algo: ela não apaga. Vêm zeradas porque a pré-condição é rodar antes de
-- existir dado. Se vier diferente de zero, esta migração foi rodada tarde
-- demais e o que ela estreitou pode ter cortado linha.
select
  (select count(*) from public.instituicoes) as instituicoes,
  (select count(*) from public.contas)       as contas,
  (select count(*) from public.categorias)   as categorias,
  (select count(*) from public.transacoes)   as transacoes,
  (select count(*) from pg_constraint
    where conrelid = 'public.transacoes'::regclass and contype = 'f')      as fks_em_transacoes,
  (select count(*) from pg_tables
    where schemaname = 'public'
      and tablename in ('instituicoes','contas','categorias','transacoes')
      and rowsecurity)                                                     as com_rls_ligada;

-- ---------------------------------------------------------------------
-- 12. ROLLBACK
-- ---------------------------------------------------------------------
-- Não há rollback para esta migração, e é melhor dizer isso do que fingir que
-- há. Ela estreita o modelo: `transferencia_par_id` deixou de existir e
-- `tipo` deixou de aceitar 'transferencia' e 'estorno'. Voltar significaria
-- recriar coluna e afrouxar `check`, e o resultado seria o modelo defeituoso
-- da 001 de novo -- que é justamente o que ela conserta.
--
-- Desfazer só faz sentido derrubando a V2 inteira, e isso só é seguro
-- enquanto as quatro contagens da seção 11 estiverem em zero. O bloco está
-- no fim da 001. `set_user_id()` NÃO entra nele: é da V1.

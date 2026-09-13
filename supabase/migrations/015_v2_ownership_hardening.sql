-- =====================================================================
-- 015 · OWNERSHIP NA V1, E A LIGAÇÃO DE METAS COM auth.users
-- =====================================================================
-- As migrações 001..014 são IMUTÁVEIS: nada aqui edita nenhuma delas, e os
-- arquivos continuam iguais ao texto gravado em `schema_migrations`.
--
-- PRÉ-CONDIÇÃO: nenhuma linha pode apontar para objeto de outro dono, e
-- nenhum `user_id` pode estar fora de `auth.users`. A seção 6 tem as seis
-- consultas que provam isso -- **rode-as antes**, e não depois. Elas são só
-- `select` e não mudam nada. Vindo qualquer uma diferente de zero, PARE: esta
-- migração não conserta dado, ela passa a recusar dado errado, e a constraint
-- simplesmente não entraria.
--
-- Esta migração NÃO apaga, NÃO altera e NÃO move nenhuma linha. Ela só
-- estreita o que o banco aceita daqui em diante.
--
-- ---------------------------------------------------------------------
-- O QUE ESTAVA ERRADO
-- ---------------------------------------------------------------------
-- Dois achados da rodada de reconstrução, os dois de ownership:
--
-- A. `metas` e `alocacoes_de_meta` não tinham chave estrangeira para
--    `auth.users`. As outras vinte e duas tabelas com dono têm, com
--    `on delete cascade`. Apagar a pessoa no Auth levaria junto tudo menos
--    essas duas, que ficariam órfãs -- linhas com um dono que não existe
--    mais, invisíveis para o RLS (nenhum `auth.uid()` bate) e eternas.
--
--    `alocacoes_de_meta` cascateia de `metas` pela FK composta da 014, então
--    na prática ela some junto assim que `metas` sumir. A FK direta existe
--    para que isso não dependa de a outra estar lá: cada tabela com `user_id`
--    responde por si.
--
-- B. Cinco chaves estrangeiras herdadas da V1 apontavam só por `id`:
--
--        dividas.credor_id      -> credores(id)
--        dividas.pessoa_id      -> credores(id)
--        fixas.credor_id        -> credores(id)
--        credores.credor_pai_id -> credores(id)
--        fixas_mes.fixa_id      -> fixas(id)
--
--    É o mesmo defeito que a 002 consertou na V2, pela mesma razão: **a
--    checagem de FK roda POR FORA do RLS**, por definição do Postgres. O RLS
--    esconde a linha de outra pessoa da leitura; ele não impede que uma linha
--    minha aponte para ela. Integridade e visibilidade são coisas diferentes,
--    e só uma delas estava garantida.
--
--    Num app de um usuário só isso não é explorável pela tela -- a interface
--    não tem como oferecer o credor de outra pessoa, porque não consegue
--    lê-lo. Mas "não dá para chegar lá pela tela" não é uma garantia do
--    banco, e é o banco que responde por integridade.
--
-- ---------------------------------------------------------------------
-- O QUE NÃO MUDA
-- ---------------------------------------------------------------------
-- O comportamento de exclusão de cada relação é preservado EXATAMENTE:
--
--     dividas.credor_id       set null  ->  set null (só a coluna)
--     dividas.pessoa_id       set null  ->  set null (só a coluna)
--     fixas.credor_id         set null  ->  set null (só a coluna)
--     credores.credor_pai_id  set null  ->  set null (só a coluna)
--     fixas_mes.fixa_id       cascade   ->  cascade
--
-- Nenhuma coluna muda de tipo, de nulabilidade ou de default. Nenhuma tabela
-- é reescrita. A aplicação não precisa saber que isto aconteceu: ela nunca
-- teve como mandar um id de outro dono, porque nunca conseguiu ler um.


-- ---------------------------------------------------------------------
-- 1. SOLTAR AS CINCO FKs ANTES DE QUALQUER OUTRA COISA
-- ---------------------------------------------------------------------
-- Esta seção existe só para o arquivo poder rodar duas vezes. Uma FK composta
-- depende do índice do `unique (user_id, id)` da tabela apontada, e o
-- `drop constraint if exists` daquele unique falha -- não silencia, falha --
-- enquanto qualquer FK ainda depender dele. Então as FKs saem primeiro, e
-- numa primeira execução estas dez linhas não fazem nada além de avisar que
-- não havia o que soltar.
--
-- Os dois nomes de cada relação estão aqui de propósito: o antigo, da V1, e o
-- novo. Assim o arquivo converge tanto de um banco no estado 014 quanto de um
-- banco que já rodou esta migração.

alter table public.dividas   drop constraint if exists dividas_credor_id_fkey;
alter table public.dividas   drop constraint if exists dividas_credor_dono_fk;
alter table public.dividas   drop constraint if exists dividas_pessoa_id_fkey;
alter table public.dividas   drop constraint if exists dividas_pessoa_dono_fk;
alter table public.fixas     drop constraint if exists fixas_credor_id_fkey;
alter table public.fixas     drop constraint if exists fixas_credor_dono_fk;
alter table public.credores  drop constraint if exists credores_credor_pai_id_fkey;
alter table public.credores  drop constraint if exists credores_pai_dono_fk;
alter table public.fixas_mes drop constraint if exists fixas_mes_fixa_id_fkey;
alter table public.fixas_mes drop constraint if exists fixas_mes_fixa_dono_fk;


-- ---------------------------------------------------------------------
-- 2. CHAVE AUXILIAR (user_id, id) NAS TABELAS APONTADAS
-- ---------------------------------------------------------------------
-- Uma FK só aponta para colunas com unicidade declarada. `metas` já ganhou a
-- dela na 014; `credores` e `fixas` não tinham. É redundante com a primária --
-- `id` já é único sozinho -- e é o preço de deixar o banco, e não a aplicação,
-- garantir o dono. Mesma escolha da 002, pelo mesmo motivo.

alter table public.credores drop constraint if exists credores_dono_id_unico;
alter table public.credores add  constraint credores_dono_id_unico unique (user_id, id);

alter table public.fixas drop constraint if exists fixas_dono_id_unico;
alter table public.fixas add  constraint fixas_dono_id_unico unique (user_id, id);


-- ---------------------------------------------------------------------
-- 3. METAS E ALOCAÇÕES RESPONDEM A auth.users
-- ---------------------------------------------------------------------
-- `on delete cascade`, igual às outras vinte e duas: quando a conta some, o
-- que era dela some junto. O nome segue a convenção das outras
-- (`<tabela>_user_id_fkey`), e não a das compostas, porque é a mesma relação
-- que elas têm.

alter table public.metas drop constraint if exists metas_user_id_fkey;
alter table public.metas add  constraint metas_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.alocacoes_de_meta drop constraint if exists alocacoes_de_meta_user_id_fkey;
alter table public.alocacoes_de_meta add  constraint alocacoes_de_meta_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;


-- ---------------------------------------------------------------------
-- 4. FKs COMPOSTAS NA V1: A LINHA APONTADA É DO MESMO DONO
-- ---------------------------------------------------------------------
-- `on delete set null (coluna)` existe desde o Postgres 15 e é o que torna
-- isto possível: sem a lista de colunas, apagar o credor tentaria anular
-- TAMBÉM o `user_id`, que é `not null`, e o delete morreria. É por isso que a
-- lista de colunas não é estilo -- sem ela, a exclusão de credor pararia de
-- funcionar.
--
-- `match simple` (o padrão) é o que queremos: com a coluna opcional nula, a FK
-- não é conferida. Com `match full`, o par (user_id não-nulo, coluna nula)
-- seria recusado, e dívida sem credor deixaria de existir -- hoje há 16 linhas
-- com `pessoa_id` nulo e 3 com `credor_id` de conta fixa nulo, todas legítimas.
--
-- `on update cascade` acompanha o padrão que a 002 fixou para toda FK composta
-- deste banco. Na prática ele nunca dispara: nem `auth.users.id` nem um `id`
-- gerado por `gen_random_uuid()` mudam de valor. Está aqui para que as vinte e
-- uma FKs compostas do banco se leiam iguais, e não por estética: FK composta
-- que se comporta diferente das outras é o tipo de exceção que ninguém lembra
-- na hora errada.

-- dívida -> credor (opcional; apagar o credor solta a dívida)
alter table public.dividas add  constraint dividas_credor_dono_fk
  foreign key (user_id, credor_id) references public.credores (user_id, id)
  on update cascade on delete set null (credor_id);

-- dívida -> pessoa (o terceiro que deve parte dela; também um credor)
alter table public.dividas add  constraint dividas_pessoa_dono_fk
  foreign key (user_id, pessoa_id) references public.credores (user_id, id)
  on update cascade on delete set null (pessoa_id);

-- conta fixa -> credor (opcional)
alter table public.fixas add  constraint fixas_credor_dono_fk
  foreign key (user_id, credor_id) references public.credores (user_id, id)
  on update cascade on delete set null (credor_id);

-- credor -> credor pai (hierarquia dentro do mesmo dono)
alter table public.credores add  constraint credores_pai_dono_fk
  foreign key (user_id, credor_pai_id) references public.credores (user_id, id)
  on update cascade on delete set null (credor_pai_id);

-- valor do mês -> conta fixa. Aqui é CASCADE, e continua sendo: o valor de um
-- mês não existe sem a conta a que ele pertence. `fixa_id` é `not null`, então
-- `set null` nem seria possível.
alter table public.fixas_mes add  constraint fixas_mes_fixa_dono_fk
  foreign key (user_id, fixa_id) references public.fixas (user_id, id)
  on update cascade on delete cascade;


-- ---------------------------------------------------------------------
-- 5. ÍNDICES DAS FKs QUE PASSARAM A SER COMPOSTAS
-- ---------------------------------------------------------------------
-- Duas, e só duas. O índice do lado que APONTA é o que o Postgres percorre ao
-- apagar a linha apontada; com a FK composta, um índice pela coluna solta
-- ainda serve, mas pior.
--
-- As outras três já estão cobertas e não ganham nada novo:
--   dividas.pessoa_id       -> dividas_pessoa_idx (user_id, pessoa_id)
--   credores.credor_pai_id  -> credores_pai_idx   (user_id, credor_pai_id, ordem)
--   fixas_mes.fixa_id       -> fixas_mes_pkey     (user_id, fixa_id, mes)
--
-- Os índices antigos de coluna solta (`dividas_credor_idx`, `fixas_credor_idx`)
-- ficam onde estão. Derrubá-los não é parte de hardening, e a 002 deixou o
-- equivalente dela (`contas_instituicao_idx`) exatamente assim.

create index if not exists dividas_credor_dono_idx on public.dividas (user_id, credor_id);
create index if not exists fixas_credor_dono_idx   on public.fixas   (user_id, credor_id);


-- ---------------------------------------------------------------------
-- 6. PRÉ-CONDIÇÃO E CONFERÊNCIA
-- ---------------------------------------------------------------------
-- As seis primeiras linhas são a PRÉ-CONDIÇÃO: rode antes de aplicar. Todas
-- precisam vir zeradas. Elas continuam valendo depois -- aí como conferência,
-- e aí garantidas pelo banco em vez de pela sorte.
--
--   select count(*) from public.dividas d join public.credores c
--     on c.id = d.credor_id where c.user_id <> d.user_id;            -- 0
--   select count(*) from public.dividas d join public.credores c
--     on c.id = d.pessoa_id where c.user_id <> d.user_id;            -- 0
--   select count(*) from public.fixas f join public.credores c
--     on c.id = f.credor_id where c.user_id <> f.user_id;            -- 0
--   select count(*) from public.credores f join public.credores p
--     on p.id = f.credor_pai_id where p.user_id <> f.user_id;        -- 0
--   select count(*) from public.fixas_mes fm join public.fixas f
--     on f.id = fm.fixa_id where f.user_id <> fm.user_id;            -- 0
--   select count(*) from public.metas m where not exists
--     (select 1 from auth.users u where u.id = m.user_id);           -- 0
--   select count(*) from public.alocacoes_de_meta a where not exists
--     (select 1 from auth.users u where u.id = a.user_id);           -- 0
--
-- Depois de aplicar, as sete constraints novas precisam aparecer, e o
-- comportamento de exclusão precisa ser o da tabela do cabeçalho:
--
--   select c.relname, t.conname, pg_get_constraintdef(t.oid)
--     from pg_constraint t
--     join pg_class c on c.oid = t.conrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and t.conname in ('credores_dono_id_unico','fixas_dono_id_unico',
--                        'metas_user_id_fkey','alocacoes_de_meta_user_id_fkey',
--                        'dividas_credor_dono_fk','dividas_pessoa_dono_fk',
--                        'fixas_credor_dono_fk','credores_pai_dono_fk',
--                        'fixas_mes_fixa_dono_fk')
--    order by 1, 2;                                       -- 9 linhas
--
-- E nenhuma FK de coluna única pode sobrar, fora as de `auth.users`:
--
--   select count(*) from pg_constraint t
--     join pg_class c on c.oid = t.conrelid
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and t.contype = 'f'
--      and array_length(t.conkey, 1) = 1
--      and pg_get_constraintdef(t.oid) not like '%auth.users%';      -- 0
--
-- As contagens de linha de todas as 24 tabelas precisam ser as mesmas de
-- antes. Esta migração não move dado; se alguma mudou, alguma outra coisa
-- aconteceu junto.
--
-- ---------------------------------------------------------------------
-- 7. ROLLBACK
-- ---------------------------------------------------------------------
-- Esta migração É reversível, ao contrário da 002: ela não apaga coluna, não
-- estreita `check` e não toca em dado. Desfazer é voltar as cinco FKs à forma
-- de coluna única e soltar o que foi acrescentado.
--
-- Só faz sentido se alguma coisa REAL precisar apontar para objeto de outro
-- dono -- e nada neste app precisa. Antes de rodar isto, pergunte o que
-- exatamente parou de funcionar: a resposta provavelmente é um defeito em
-- outro lugar.
--
--   alter table public.fixas_mes drop constraint fixas_mes_fixa_dono_fk;
--   alter table public.fixas_mes add  constraint fixas_mes_fixa_id_fkey
--     foreign key (fixa_id) references public.fixas (id) on delete cascade;
--
--   alter table public.credores drop constraint credores_pai_dono_fk;
--   alter table public.credores add  constraint credores_credor_pai_id_fkey
--     foreign key (credor_pai_id) references public.credores (id) on delete set null;
--
--   alter table public.fixas drop constraint fixas_credor_dono_fk;
--   alter table public.fixas add  constraint fixas_credor_id_fkey
--     foreign key (credor_id) references public.credores (id) on delete set null;
--
--   alter table public.dividas drop constraint dividas_pessoa_dono_fk;
--   alter table public.dividas add  constraint dividas_pessoa_id_fkey
--     foreign key (pessoa_id) references public.credores (id) on delete set null;
--
--   alter table public.dividas drop constraint dividas_credor_dono_fk;
--   alter table public.dividas add  constraint dividas_credor_id_fkey
--     foreign key (credor_id) references public.credores (id) on delete set null;
--
--   drop index if exists public.fixas_credor_dono_idx;
--   drop index if exists public.dividas_credor_dono_idx;
--
--   alter table public.fixas drop constraint fixas_dono_id_unico;
--   alter table public.credores drop constraint credores_dono_id_unico;
--
--   alter table public.alocacoes_de_meta drop constraint alocacoes_de_meta_user_id_fkey;
--   alter table public.metas drop constraint metas_user_id_fkey;

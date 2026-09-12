---
name: nova-migration
description: Cria uma migração no supabase-setup.sql no padrão do projeto — tabela, RLS, policy, trigger, índice, backfill e conferência — aplica no Supabase e confere o resultado.
disable-model-invocation: true
---

# Nova migração

O que migrar está em `$ARGUMENTS`. Se vier vazio, pergunte antes de escrever
qualquer coisa.

`supabase-setup.sql` é a fonte única do schema: não existe pasta de migrações
numeradas. Toda mudança entra nesse arquivo, que precisa continuar rodando do
começo ao fim, quantas vezes for.

## 1. Antes de escrever

Decida e diga em voz alta:

- **O mês é derivado ou armazenado?** Neste projeto ele é sempre derivado. Se a
  ideia pede uma linha por mês, ela está errada — modele como intervalo
  (`mes_inicial`/`mes_final`), como `dividas` e `receitas` fazem. Corrigir um
  valor tem que corrigir o histórico inteiro.
- **A tabela tem dado pessoal?** Se sim, precisa de `user_id` e do bloco de
  segurança inteiro. Se não (só `ping` é assim), diga por quê.
- **Precisa de backfill?** Se a coluna nova tem que ser preenchida a partir do
  que já existe, escreva o bloco e garanta que ele seja idempotente.

## 2. Onde cada coisa entra

O arquivo é dividido em seções numeradas. Respeite a ordem — o `do $$` da carga
e das migrações roda depois das tabelas existirem.

| Seção | O que entra |
|---|---|
| 1. TABELAS | `create table`, `alter table ... add column if not exists`, índices |
| 2. SEGURANÇA (RLS) | `enable row level security`, `drop policy`, `create policy`, `drop trigger`, `create trigger` |
| 3. CARGA INICIAL | só instalação nova, e só dado fictício: o repositório é público |
| 4. MIGRAÇÃO | backfill idempotente, com `raise notice` contando o que fez |
| 5. CONFERÊNCIA | acrescente uma coluna que prove que a migração funcionou |

## 3. Template

Troque `NOVA` pelo nome da tabela. Os quatro blocos são obrigatórios juntos —
tabela sem os outros três é uma tabela vazando dados.

```sql
-- seção 1
create table if not exists public.NOVA (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  nome      text not null,
  valor     numeric(12,2) not null check (valor >= 0),
  obs       text not null default '',
  ordem     integer not null default 0,
  criado_em timestamptz not null default now()
);

create index if not exists NOVA_user_idx on public.NOVA (user_id, ordem);

-- seção 2
alter table public.NOVA enable row level security;

drop policy if exists NOVA_own on public.NOVA;
create policy NOVA_own on public.NOVA
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists NOVA_set_user on public.NOVA;
create trigger NOVA_set_user before insert on public.NOVA
  for each row execute function public.set_user_id();
```

Backfill, quando houver:

```sql
-- seção 4
do $$
declare
  afetadas integer;
begin
  update public.dividas d
     set campo_novo = <expressão>
   where d.campo_novo is null;      -- a cláusula que torna repetível
  get diagnostics afetadas = row_count;
  raise notice 'Migração X: % linha(s) atualizada(s).', afetadas;
end $$;
```

## 4. O que o hook vai cobrar

`.claude/hooks/checa-rls.mjs` roda sozinho a cada edição do arquivo e bloqueia se:

- alguma tabela não tem `enable row level security`
- alguma tabela não tem `create policy`
- alguma tabela com `user_id` não tem o trigger `set_user_id`
- o arquivo contém `raise exception` — um `do $$` que aborta derruba a execução
  inteira e as seções seguintes nunca rodam. Use `raise notice` com `return`.
- alguma chave estrangeira aponta para uma tabela criada mais abaixo. Em banco
  que já tem a tabela isso passa despercebido; em banco vazio o Postgres aborta
  o arquivo inteiro, que é justamente a instalação do zero do README.

Não tente contornar o hook. Se ele reclamou, falta mesmo alguma coisa.

## 5. Aplicar — **antes** de publicar o site

Esta é a ordem, e ela não é negociável: **roda o SQL, depois empurra o código.**

O site sobe no push. Se o `index.html` já consulta uma coluna ou tabela que o
banco ainda não tem, o app quebra na mão de quem estiver usando. Aconteceu duas
vezes em 12/09/2026 — a primeira derrubou o carregamento inteiro, a segunda só o
salvamento.

Se por qualquer motivo não der para rodar o SQL na hora, **segure o push**. Um
commit local esperando é barato; um app quebrado no ar não é.

Com o MCP do Supabase conectado, aplique o arquivo inteiro no projeto cuja URL
está no topo do `<script type="module">` do `index.html`. Ele é idempotente:
rodar de novo não duplica nada.

Sem o MCP, diga isso claramente e entregue o caminho do arquivo para colar no
SQL Editor — não finja que aplicou, e não empurre o código enquanto isso.

### Quando a tabela nova pode faltar sem quebrar tudo

A carga do app é tudo-ou-nada de propósito. Ao acrescentar uma tabela, decida em
qual lado ela fica e escreva isso no código:

> Sem essa tabela, o app **sabe menos** ou **mente**?

`pagamentos` faz o app mentir — sem ela tudo pareceria não pago, então uma falha
ali é fatal. `fixas_mes` faz o app saber menos — sem ela a conta variável mostra
a média, que é o comportamento de antes dela existir, então ela falha em silêncio
com aviso no console. Só o segundo caso pode ficar fora da lista fatal.

## 6. Conferir

Rode a seção 5 e confira:

- `saldo_devedor_total` continua batendo com o que o app mostra
- as colunas de contagem que você acrescentou vieram com o valor esperado
- nenhuma coluna de "sem vínculo" ficou diferente de 0

Depois, no app: se a migração adicionou tabela ou coluna que o `index.html`
consulta, rode `node testes/regras.mjs` e `node testes/preview.mjs` antes de
commitar.

## 7. Commit

Uma mudança de schema, um commit. No corpo, explique **por que** a modelagem é
essa — principalmente se alguém pudesse razoavelmente ter modelado diferente
(uma linha por mês, por exemplo). O `git log` deste projeto é onde essas
decisões ficam registradas.

# SQL do projeto

Qual arquivo é o quê, e em que ordem eles entram.

| Arquivo | Papel | Já foi executado? |
|---|---|---|
| `../supabase-setup.sql` | **Instalação limpa da V1.** Tabelas, segurança, carga de exemplo, migrações e conferência, num arquivo só, para colar inteiro no SQL Editor | sim, é o banco em uso |
| `migrations/001_v2_foundation.sql` | **Migração da V2.** Acrescenta instituições, contas, categorias e transações | **não** |

## Por que a instalação continua num arquivo só

A estrutura sugerida para esta fase era `schema.sql` + `seed.sql` +
`migrations/`. Eu parei antes de separar `supabase-setup.sql` em dois, e o
motivo é concreto: o SQL Editor do Supabase recebe **um** arquivo colado por
vez, sem `\i` nem include. Separar hoje significaria uma de duas coisas, e as
duas são piores do que esperar:

- manter o schema em `schema.sql` **e** em `supabase-setup.sql`, o que cria
  duas fontes para a mesma verdade. É exatamente o tipo de duplicata que
  envelhece mal: alguém corrige uma coluna num arquivo, esquece o outro, e o
  erro só aparece numa instalação do zero, meses depois;
- transformar a instalação em "cole três arquivos nesta ordem", trocando um
  passo por três num fluxo que hoje funciona e que o README descreve.

A separação vale a pena quando a V2 for de fato aplicada, porque aí existe uma
segunda migração e o arquivo único deixa de dar conta sozinho. Até lá,
`supabase-setup.sql` continua sendo a fonte única do schema da V1, como o
`CLAUDE.md` manda, e `migrations/` guarda o que ainda não rodou.

Quando a hora chegar, a ordem é: `schema.sql` (tabelas e segurança da V1),
`migrations/001_…` em diante, e `seed.sql` por último, só em instalação nova.

## A regra que vale para toda tabela nova

Quatro coisas, sempre no mesmo commit, sem exceção:

1. `user_id` com `references auth.users(id) on delete cascade`;
2. `enable row level security`;
3. `create policy` por `auth.uid()`, com `using` **e** `with check`;
4. trigger `set_user_id` e os índices que as consultas vão pedir.

O hook `.claude/hooks/checa-rls.mjs` cobra os quatro, neste diretório e no
arquivo de instalação. Tabela sem policy não dá erro em lugar nenhum: ela
simplesmente fica legível para quem abrir o site.

Toda migração precisa também de uma seção de **conferência** (o que olhar
depois de rodar) e de uma de **rollback** (como desfazer, e sob qual condição
desfazer ainda é seguro).

## Nada de dado real

`supabase-setup.sql` tem uma carga de exemplo, e ela é inteiramente inventada:
nomes genéricos, centavos zerados, combinações de parcela que não vieram de
lugar nenhum. Migração **não** carrega dado. Se uma precisar de fixture, ela
segue a mesma regra, que está em `.claude/skills/public-repo-hygiene/SKILL.md`.

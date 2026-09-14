# SQL do projeto

Qual arquivo é o quê, e em que ordem eles entram.

| Pasta ou arquivo | Papel |
|---|---|
| `bootstrap/` | **Instalação do zero.** `schema.sql` põe o banco inteiro num projeto Supabase vazio; `seed.sql` é carga de exemplo opcional; `inventario-esperado.txt` é como o banco deve ficar. O passo a passo está no `bootstrap/README.md` |
| `migrations/` | **O registro do que já rodou**, 001 a 016. Migração aplicada é imutável, comentário incluído. O que cada uma fez está em `../docs/MIGRACOES.md` |
| `testes/` | **Suítes que rodam no banco de verdade**, uma por migração que mudou regra de modelo, mais `isolamento.sql`, que varre o banco inteiro. Abrem em `begin` e fecham em `rollback`: não gravam nada |
| `../supabase-setup.sql` | **A V1, histórico.** Instala oito das vinte e quatro tabelas. Não serve para instalar um banco novo, e fica onde está por ser o registro de como o banco começou |

## A instalação do zero não é mais um arquivo só, nem três

Durante um bom tempo este arquivo explicava por que `supabase-setup.sql` não
tinha sido separado em `schema.sql` + `seed.sql`: o SQL Editor recebe **um**
arquivo colado por vez, e manter o schema em dois lugares criaria duas fontes
para a mesma verdade — alguém corrige uma coluna num, esquece o outro, e o erro
só aparece numa instalação do zero, meses depois.

O argumento continua certo, e a saída foi outra: `bootstrap/schema.sql` **não é
uma segunda cópia escrita à mão**. Ele é gerado do catálogo do banco, e
`ferramentas/confere-schema.mjs` compara os dois e falha quando divergem. A
duplicata que o argumento temia é justamente o que a conferência não deixa
existir.

Continua sendo um arquivo colado por vez, e a ordem para instalar é
`bootstrap/schema.sql`, criar a conta no site, e `bootstrap/seed.sql` se quiser
exemplo. As migrações **não** entram numa instalação nova: elas são história, e
o schema já nasce com tudo o que elas fizeram.

Para a ordem inversa — uma migração nova, depois disso —, os cinco passos estão
em `../CLAUDE.md`, na seção "Reconstruir o banco do zero". O que não tem atalho
é o quarto: a referência do inventário se regrava a partir do banco
reconstruído, nunca à mão.

Os cabeçalhos das migrações antigas ainda dizem que elas não foram executadas,
ou falam de pré-condição no futuro. Ficaram assim de propósito: **migração
aplicada não se edita**, para o arquivo continuar idêntico ao texto gravado em
`supabase_migrations.schema_migrations`, que é o que
`ferramentas/confere-migracoes.mjs` confere. Quem quer saber o que rodou olha
`../docs/MIGRACOES.md`, não o comentário. Pela mesma razão, conserto de migração
aplicada vira migração nova — a 003 tem duas linhas e existe só por isso.

## A regra que vale para toda tabela nova

Quatro coisas, sempre no mesmo commit, sem exceção:

1. `user_id` com `references auth.users(id) on delete cascade`;
2. `enable row level security`;
3. `create policy` por `auth.uid()`, com `using` **e** `with check`;
4. trigger `set_user_id` e os índices que as consultas vão pedir.

O hook `.claude/hooks/checa-rls.mjs` cobra os quatro em `migrations/`, em
`bootstrap/` e no arquivo da V1. Tabela sem policy não dá erro em lugar nenhum:
ela simplesmente fica legível para quem abrir o site. E `testes/isolamento.sql`
varre o banco inteiro pedindo o mesmo, sem lista escrita à mão — tabela nova
entra na varredura sozinha.

Toda migração precisa também de uma seção de **conferência** (o que olhar
depois de rodar) e de uma de **rollback** (como desfazer, e sob qual condição
desfazer ainda é seguro).

## Nada de dado real

`supabase-setup.sql` e `bootstrap/seed.sql` têm carga de exemplo, e as duas são
inteiramente inventadas: nomes genéricos, valores redondos, combinações de
parcela que não vieram de lugar nenhum. O `seed.sql` nem sequer traz o dono
escrito — ele descobre lendo `auth.users` e para se houver mais de um. Migração
**não** carrega dado. Se uma precisar de fixture, ela
segue a mesma regra, que está em `.claude/skills/public-repo-hygiene/SKILL.md`.

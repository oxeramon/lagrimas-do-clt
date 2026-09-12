# Migrações aplicadas

O que já rodou no banco, quando, e como foi conferido. Uma linha por migração,
em ordem. Este arquivo é o registro; o SQL é a fonte.

| Versão | Arquivo | Quando | Situação |
|---|---|---|---|
| — | `../supabase-setup.sql` | antes do registro existir | aplicada colando no SQL Editor, fora do controle de migrações |
| `20260912185920` | `../supabase/migrations/001_v2_foundation.sql` | 12/09/2026 | **aplicada** · imutável |
| `20260912192729` | `../supabase/migrations/002_v2_integrity_hardening.sql` | 12/09/2026 | **aplicada** |
| `20260912193340` | `../supabase/migrations/003_v2_search_path_das_funcoes.sql` | 12/09/2026 | **aplicada** |
| `20260912200722` | `../supabase/migrations/004_v2_transaction_operations.sql` | 12/09/2026 | **aplicada** |

**Migração aplicada não se edita.** Quando o arquivo e o banco discordam, some
a única fonte confiável sobre o que rodou. Conserto vira migração nova, e é por
isso que existe uma 003 de duas linhas em vez de um remendo na 002.

## Por que a V1 não aparece no histórico

`list_migrations` estava vazio até a 001. A V1 entrou colada inteira no SQL
Editor, e o SQL Editor não escreve em `supabase_migrations.schema_migrations`.
A consequência prática: **o histórico registrado começa na 001**, e não contém
a linha de base da V1.

Isso não é um defeito a corrigir agora, mas é preciso saber ao ler o histórico:
um banco novo não se reconstrói só aplicando as migrações registradas. A ordem
continua sendo `supabase-setup.sql` primeiro, `migrations/` depois, como o
`supabase/README.md` descreve.

## 001 · fundação da V2

Acrescenta `instituicoes`, `contas`, `categorias` e `transacoes`, mais a view
`saldos_de_conta`, a função `nivel_da_categoria()` e o gatilho que a usa.
Puramente aditiva: não renomeia, não remove, não migra dado e não toca em
nenhuma tabela da V1.

Conferido depois de rodar: as quatro tabelas com `rowsecurity` ligada, a view
com `security_invoker`, uma policy por tabela com `using` **e** `with check` por
`auth.uid()`, os gatilhos `*_set_user`, 17 índices, 9 chaves estrangeiras, 14
`check`, zero linha nas tabelas novas, as oito tabelas da V1 com contagem
idêntica à de antes, e `set_user_id()` preservada.

### O cabeçalho da 001 está desatualizado, de propósito

A primeira linha do arquivo diz que a migração ainda não foi executada. Ela
ficou como estava para o arquivo continuar idêntico ao texto gravado em
`schema_migrations`. Quem for ler o SQL deve olhar a tabela no topo **deste**
arquivo para saber o que já rodou.

## 002 · integridade da V2

Rodou com as quatro tabelas ainda vazias, que era a pré-condição: ela estreita
o modelo, e com dado dentro teria cortado linha. Conserta seis defeitos que a
001 deixou passar.

| # | O defeito | O conserto |
|---|---|---|
| 1 | FK apontava só para `id`, então uma linha podia referenciar objeto de outro usuário — a checagem de FK roda por fora do RLS | `unique (user_id, id)` nas tabelas apontadas e FK composta `(user_id, coluna)` em todas as cinco relações |
| 2 | transferência não tinha sinal: `valor >= 0`, `tipo = 'transferencia'` e a view somando `+valor` nas duas pernas | `tipo` passa a ser só `entrada`/`saida`; `natureza` guarda `normal`/`transferencia`/`estorno` |
| 3 | `transferencia_tem_par` não obrigava par nenhum, e o par era FK circular para a própria tabela | `transferencia_id` comum às duas pernas, com gatilho de constraint **diferido** conferindo o grupo no commit |
| 4 | estorno somava sempre como entrada | estorno é uma linha de sinal contrário ligada à original por `estorno_de_id` |
| 5 | `unique (user_id, pai_id, nome)` não barrava duas raízes com o mesmo nome, porque NULL nunca é igual a NULL | `unique nulls not distinct` |
| 6 | `categorias_nivel` disparava **antes** de `categorias_set_user` (ordem alfabética), e o nível saía calculado com `user_id` nulo | `categorias_1_set_user` e `categorias_2_nivel`, com a ordem no nome |

### A regra de saldo, agora sem caso especial

```
saldo = saldo_inicial + entradas realizadas − saídas realizadas
```

Transferência não aparece nessa conta, e é esse o ponto: as duas pernas já são
uma `saida` e uma `entrada` comuns. A conta de origem diminui, a de destino
aumenta, e somando todas as contas o patrimônio não se mexe.

### Contrato de categoria, explícito

O nome é único entre irmãos, e as raízes são irmãs entre si. Vale por usuário e
**não** olha `fluxo`: não dá para ter "Ajuste" como raiz de entrada e outra de
saída. É escolha, não acidente — nome repetido em duas árvores confunde na hora
de escolher numa lista.

### Como foi provado

`supabase/testes/002_integridade.sql`, **27 casos**, rodando no banco de
verdade dentro de uma transação que termina em `rollback`. Dois usuários
inventados na hora, nenhum identificador real.

| O que prova | Casos |
|---|---|
| entrada aumenta, saída reduz | 1 |
| transferência move entre contas e não cria patrimônio | 2, 3, 4 |
| estorno de saída aumenta; estorno de entrada reduz | 5, 6 |
| prevista e cancelada ficam fora do saldo | 7 |
| conta, categoria, pai e original de outro usuário são recusados pela FK | 8, 9, 10, 11, 12 |
| transferência pela metade, com valores diferentes ou na mesma conta é recusada | 13, 14, 15 |
| `natureza = transferencia` exige grupo; `tipo = transferencia` não existe mais | 16, 17 |
| raiz duplicada recusada; níveis 1, 2 e 3; quarto nível recusado; mesmo nome sob pais diferentes permitido | 18, 19, 20, 21 |
| nível correto quando o `user_id` vem do gatilho — a regressão do defeito 6 | 22 |
| RLS: o logado só vê o que é dele, `anon` não vê nada da V2 nem da V1 | 23, 24, 26, 27 |
| insert continua funcionando depois do `revoke execute` | 25 |

Uma armadilha que o arquivo contorna: o gatilho da transferência é **diferido**,
então só dispararia no commit — que nunca chega, porque o teste termina em
rollback. `set constraints all immediate` força a conferência na hora.

### Rollback

Não há, e é melhor dizer isso do que fingir que há. A 002 estreita o modelo:
`transferencia_par_id` deixou de existir e `tipo` deixou de aceitar
`transferencia` e `estorno`. Voltar seria recriar o modelo defeituoso. Desfazer
só faz sentido derrubando a V2 inteira, pelo bloco no fim da 001, e só enquanto
as quatro contagens estiverem em zero.

## 003 · search_path fixo nas funções da transferência

Duas linhas. `valida_transferencia()` e `confere_grupo_transferencia()`
nasceram na 002 sem `search_path` fixo. As duas já qualificavam tudo por
extenso, então não havia furo de verdade, mas o linter aponta o padrão e a
razão dele é boa.

Depois dela, **as quatro funções de gatilho estão com `search_path = public` e
sem `execute` para `anon` nem `authenticated`**.

## 004 · operações atômicas de transferência

A 002 deixou o modelo certo, mas o frontend não tinha como cumpri-lo. Duas
pernas por dois `insert` HTTP são duas transações: a primeira comita, a segunda
falha, e sobra meia transferência ou a dúvida de se sobrou. A 004 leva as duas
pernas para dentro do Postgres.

| Função | O que faz |
|---|---|
| `cria_transferencia` | os dois inserts num comando só; devolve o `transferencia_id` |
| `atualiza_transferencia` | as duas pernas na mesma transação; trocar os parâmetros inverte o sentido |
| `remove_transferencia` | apaga o grupo inteiro, nunca uma perna |
| `confere_pernas_da_transferencia` | a validação que as três compartilham |

Todas `SECURITY INVOKER`, com `search_path` fixo, sem `execute` para `anon` e
com `execute` para `authenticated`. **Nenhuma aceita `user_id`**: quem preenche
é o gatilho, com `auth.uid()`. A conferência de dono não pergunta "essa conta é
minha?" -- ela conta quantas das duas o RLS deixa enxergar, porque distinguir
"não é sua" de "não existe" contaria que o id existe.

### O defeito da 002 que ela conserta

A 002 revogou `execute` de `confere_grupo_transferencia()` junto com o das
outras funções de gatilho. O raciocínio estava certo pela metade: **gatilho não
precisa de `execute`, mas função CHAMADA por um gatilho precisa.**
`valida_transferencia()` a chamava com `perform`, e toda transferência de
usuário real morria com `permission denied`. Ninguém tinha esbarrado porque a
V2 está vazia.

O conserto tira a chamada do meio em vez de devolver o grant: a conferência
passou a morar dentro do próprio gatilho, e a função antiga saiu.

**Por que escapou, e a lição:** os testes da 002 rodavam como `postgres`, que é
dono das tabelas e passa por cima de RLS e de grant. Teste de permissão que
roda como dono não prova nada. Pelo mesmo motivo, as ajudantes dos dois
arquivos de teste deixaram de ser `security definer` -- com elas assim, um caso
de "anon não pode" passava sozinho.

### Como foi provada

`supabase/testes/004_operacoes.sql`, **25 casos**, rodando como `authenticated`
e como `anon`, em transação com `rollback`. Cobre o caminho feliz, a
atomicidade (um `status` inválido derruba a operação inteira sem deixar perna
órfã), as recusas (mesma conta, valor zero, conta alheia, grupo inexistente), a
edição, a exclusão do par, o gatilho rodando para usuário de verdade, e `anon`
esbarrando no grant.

## O que os advisors dizem agora

Segurança: **uma única ocorrência**, e é configuração de Auth, não de schema —
proteção contra senha vazada desligada, que já era assim antes de tudo isto.
Ligar é um clique no painel e não passa por migração.

As duas ocorrências de `SECURITY DEFINER` chamável por `anon` e por
`authenticated`, que existiam desde a V1, **sumiram** com o `revoke` da 002.

Desempenho, tudo informativo e nada novo:

| O que aponta | Por que fica |
|---|---|
| `auth_rls_initplan` nas 12 policies: `auth.uid()` reavaliada por linha | o conserto é trocar por `(select auth.uid())` em **todas**, inclusive as oito da V1 — e mexer na V1 está fora do escopo. É questão de escala, e a escala aqui é um usuário |
| três FKs da V1 sem índice de cobertura | V1, mesma razão |
| índices da V2 "não usados" | as tabelas estão vazias e nenhuma tela consulta ainda; some sozinho quando o uso começar |

## Em aberto

**A ponte entre V1 e V2 não existe, e é de propósito.** Marcar dívida como paga
NÃO cria transação, e lançar transação NÃO marca dívida como paga. A V1
responde por compromisso e previsão; a V2, por conta e movimento realizado.
Ligar as duas sem projeto é a maneira mais rápida de contar o mesmo dinheiro
duas vezes -- e por isso ainda não há "patrimônio líquido" no produto.

**Cartão e fatura na V2 ainda não existem.** Cartão continua sendo `credores`
na V1. Estorno tem schema e sabe ser renderizado, mas não tem botão: o contrato
de estorno parcial e múltiplo ainda não foi definido.

**A instalação do zero ainda é um arquivo só.** Com três migrações aplicadas,
`supabase-setup.sql` sozinho não reconstrói mais o banco inteiro. O
`supabase/README.md` explica a ordem; separar em `schema.sql` + `seed.sql` +
`migrations/` passou a fazer sentido e ainda não foi feito.

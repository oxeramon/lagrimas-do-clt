# Migrações aplicadas

O que já rodou no banco, quando, e como foi conferido. Uma linha por migração,
em ordem. Este arquivo é o registro; o SQL é a fonte.

| Versão | Arquivo | Quando | Situação |
|---|---|---|---|
| — | `../supabase-setup.sql` | antes do registro existir | aplicada colando no SQL Editor, fora do controle de migrações |
| `20260912185920` | `../supabase/migrations/001_v2_foundation.sql` | 12/09/2026 | **aplicada** |

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

### O que foi conferido depois de rodar

| | |
|---|---|
| migração registrada | `20260912185920 · 001_v2_foundation` |
| tabelas criadas | as quatro, todas com `rowsecurity` ligada |
| view | `saldos_de_conta` com `security_invoker = on` |
| policies | uma por tabela, `to authenticated`, `using` **e** `with check` por `auth.uid()`, expressão idêntica nas quatro |
| gatilhos | quatro `*_set_user` apontando para `set_user_id()`, mais `categorias_nivel` |
| índices | 17, contando as chaves primárias e as três restrições de unicidade |
| chaves estrangeiras | 9; as quatro para `auth.users` em cascade, o resto `set null` |
| restrições `check` | 14 |
| linhas nas tabelas novas | zero nas quatro — migração não carrega dado |
| tabelas da V1 | as oito intactas, contagem de linhas idêntica à de antes |
| `set_user_id()` | preservada, como o rodapé da migração manda |

### A prova de que o RLS pega

Contagem de catálogo não prova RLS: quem consulta como `postgres` passa por
cima dele, e uma tabela vazia responde zero por estar vazia, não por estar
protegida. A conferência que vale foi feita trocando o papel para `anon`:

- `dividas` e `credores`, que **têm** linhas, responderam zero;
- `ping`, público de propósito, continuou respondendo;
- as quatro tabelas novas e a view responderam zero.

A view responder zero é o que confirma o `security_invoker`: sem ele, ela
rodaria com os privilégios do dono e devolveria tudo.

### Rollback

Continua válido enquanto as quatro contagens estiverem em zero. O bloco está
comentado no fim da própria migração, na ordem inversa das dependências.
`set_user_id()` **não** entra nele: ela é da V1.

### O cabeçalho da 001 está desatualizado, de propósito

A primeira linha do arquivo diz que a migração ainda não foi executada. Ela
ficou como estava para o arquivo continuar idêntico ao texto gravado em
`schema_migrations`. Quem for ler o SQL deve olhar a tabela no topo **deste**
arquivo para saber o que já rodou.

## Em aberto, para uma 002

Duas coisas ficaram anotadas em vez de entrar de contrabando na 001.

**1. `nivel_da_categoria()` é `security definer`.** O linter do Supabase passou
a apontá-la, junto com a `set_user_id()` que já era apontada antes: as duas são
chamáveis por `anon` e por `authenticated` via `/rest/v1/rpc/`. Nenhuma das
duas faz nada útil quando chamada solta — `new` não existe fora de gatilho, e a
chamada falha. Ainda assim, o `search_path` está fixado e o alerta é o mesmo
que já existia, sem categoria nova de risco.

**2. Chave estrangeira não confere dono.** `categorias.pai_id`,
`transacoes.conta_id`, `transacoes.categoria_id` e
`transacoes.transferencia_par_id` apontam para a própria tabela ou para outra
protegida por RLS, mas a FK sozinha não exige que a linha apontada seja do
mesmo usuário — a checagem de FK roda por fora do RLS, por definição do
Postgres. Num app de um usuário só o efeito prático é nenhum, e explorar isso
exigiria adivinhar um UUID inteiro. O conserto, quando valer a pena, é o par
`unique (user_id, id)` na tabela apontada e FK composta por `(user_id, <col>)`.

Nenhuma das duas é motivo para desfazer a 001.

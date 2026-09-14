# Recuperar o banco num projeto Supabase novo

Se o projeto Supabase se perder — apagado, suspenso, migrado de conta, ou só
trocado por outro —, é aqui que a reconstrução começa. São três arquivos e
cerca de cinco minutos.

O que **não** é preciso fazer: lembrar a ordem de `supabase-setup.sql` e das
quinze migrações. Essa ordem não estava escrita em lugar nenhum, e as
migrações se corrigem umas às outras — a 002 conserta seis defeitos da 001, a
013 conserta o grant da 012. Um banco novo não precisa repetir a arqueologia.

| Arquivo | O que é |
|---|---|
| `schema.sql` | o schema inteiro: tabelas, chaves, índices, views, funções, gatilhos, RLS, policies e permissões |
| `seed.sql` | carga de exemplo, **opcional**, toda inventada |
| `inventario-esperado.txt` | como o banco deve ficar, linha a linha, para conferir depois |

---

## Antes de começar

1. Um projeto Supabase **novo e vazio**, com `auth` já funcionando (todo
   projeto novo tem). Região São Paulo, como o atual.
2. O `schema.sql` **aborta** se achar qualquer tabela ou view em `public`. Ele
   roda uma vez, em banco limpo, e não tem modo "conserta o que faltar" — um
   bootstrap assim esconderia o estado em que o banco estava.
3. Nada aqui apaga nada. Se o arquivo recusar, é porque o projeto não está
   vazio: crie outro em vez de limpar este à mão.

---

## A ordem

### 1. Schema

SQL Editor → cole `schema.sql` inteiro → Run.

A última coisa que ele imprime é a conferência:

```
NOTICE: Banco pronto: 25 tabelas, 6 views, 43 funções, 32 gatilhos, 25 policies, RLS em todas.
```

Se aparecer erro no meio, o banco ficou pela metade. Não tente emendar: apague
o projeto, crie outro e rode de novo do começo. Em projeto vazio isso não custa
nada, e é por isso que vale mais do que consertar.

### 2. Ligar o site ao banco novo

A URL e a chave publicável ficam no topo do `<script type="module">` do
`index.html`, e são a fonte para qualquer coisa que precise delas. Troque as
duas pelas do projeto novo (Settings → API), empurre, espere o Pages publicar.

A chave publicável aparecer no HTML é esperado: o repositório é público, e o
que separa os dados de quem abre o site é a RLS, não a chave.

### 3. Criar a conta

Abra o site e cadastre-se normalmente. Isso cria a linha em `auth.users`, de
que todo o resto depende.

### 4. Carga de exemplo (opcional)

SQL Editor → cole `seed.sql` → Run. Ele descobre o dono lendo `auth.users` e só
aceita quando há exatamente um; com nenhum ou com vários, ele para e diz o que
fazer. Nenhum identificador está escrito dentro do arquivo.

Para começar do zero de verdade, pule esta etapa.

---

## Conferir que deu certo

### Estrutural

SQL Editor → cole `ferramentas/inventario.sql` → Run → salve a coluna num
arquivo → então:

```bash
node ferramentas/confere-schema.mjs /caminho/do/inventario.txt
```

Esperado:

```
referência: 1473 linhas · banco: 1473 linhas
extensões de plataforma (diferença esperada, não é defeito): pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp
o contrato bate: nenhuma diferença estrutural.
```

Aquelas quatro extensões vêm de fábrica com qualquer projeto Supabase e não são
criadas por este projeto — por isso a única diferença tolerada é essa. Qualquer
outra linha a mais ou a menos faz o script sair com erro, de propósito.

### Comportamental

As suítes de `supabase/testes/` rodam inteiras dentro de uma transação e
terminam em `rollback`: **não gravam nada**. Cole uma por vez no SQL Editor. O
último `select` é o placar; qualquer linha com `FALHOU` é defeito.

Comece por `isolamento.sql`: ele varre o banco inteiro — toda tabela, toda view,
toda função — e é o que prova que ninguém enxerga o dado de ninguém.

---

## A prova, medida em 14/09/2026 (com a 019 aplicada)

O `schema.sql` não foi escrito de memória: foi lido do catálogo do banco em uso
e reescrito em ordem de dependência. O que fecha o argumento é ter rodado o
arquivo num Postgres vazio e comparado os dois lados com a mesma régua.

| | banco em uso | reconstruído do zero |
|---|---|---|
| linhas do inventário | 1477 | 1473 |

Os totais diferem em quatro linhas, e são as quatro extensões de plataforma. O
que prova isso é a comparação **seção a seção**: as treze seções comparáveis
batem md5 por md5, e é onde a coisa toda de fato mora.

| seção | linhas | md5, nos dois lados |
|---|---|---|
| COL colunas | 253 | `db79f91d6e604432250db0ff39561237` |
| CON constraints | 211 | `cc16daf84e7a2d70ccbd9b4b0343ab33` |
| IDX índices | 52 | `f4c8752764dec5e4234b1aeb9040238d` |
| FN assinatura de função | 43 | `4a3cf210116cc25039e83fd08084425e` |
| FNBODY corpo de função | 43 | `f8b42630fd687ffeb72799671ad73368` |
| GFN permissão de função | 129 | `b4c5385a356364648e12db8658654071` |
| GTAB permissão de tabela | 638 | `826112a9a4566d5af898a2847e6162de` |
| POL policies | 25 | `8bab59b28ff6bedc40a00db48254b9e7` |
| TAB tabelas | 25 | `dd13de2a7e797e4745bbec87be64d746` |
| TRG gatilhos | 32 | `14eec099766ebff41a45d09b06a11d92` |
| CMT · VIEW · VIEWDEF | 10 · 6 · 6 | iguais |

**Foi esta tabela que achou três defeitos da rodada da 017**, e nenhum deles
aparecia lendo o código: dois comentários que não tinham ido para o bootstrap,
quatro corpos de função em que os comentários tinham sido reescritos na cópia,
e um `execute` que a 017 deixou para `authenticated` numa função de gatilho --
este último no BANCO, e consertado pela 019.

Colunas, chaves, índices, definição de view, corpo de função, gatilho, policy e
permissão por papel: tudo igual dos dois lados. As quatro linhas de diferença
são as extensões de plataforma, que vêm de fábrica com o projeto Supabase e
que nenhuma migração deste projeto cria.

E a conferência não é só de hash: `ferramentas/reconstroi.sh` roda o inventário
linha a linha contra `inventario-esperado.txt` e, no mesmo banco recém-criado,
as catorze suítes de `../testes/`.

```
== inventário estrutural
referência: 1473 linhas · banco: 1473 linhas
o contrato bate: nenhuma diferença estrutural.
== suítes de SQL
460 casos, 0 falhas
```

Uma ressalva honesta: o Postgres descartável rodou a **16.13**, e o projeto em
uso roda a **17.6**. Todo recurso que o schema usa existe nas duas (`unique
nulls not distinct`, view com `security_invoker` e `on delete set null` de
coluna são todos da 15 em diante), e o inventário é lido por
`information_schema` e por funções de catálogo que existem nas duas. O que uma
comparação assim não alcança é privilégio que só a 17 conhece — `maintain`, por
exemplo, que não aparece em `information_schema` de nenhuma das duas.

Além do estrutural, as doze suítes de `supabase/testes/` rodaram contra o banco
reconstruído: **384 casos, nenhuma falha**.

---

## Fora do Supabase

Para testar o bootstrap sem tocar em projeto nenhum, há um Postgres
descartável:

```bash
ferramentas/reconstroi.sh --i-know-this-is-disposable
```

Ele apaga e recria um banco local, aplica `ferramentas/sala-limpa.sql` (a
maquete do `auth` e dos três papéis do PostgREST, que num Supabase de verdade
já existem), aplica o `schema.sql`, confere o inventário e roda todas as
suítes. Sai com erro se qualquer etapa falhar.

Ele **se recusa** a apontar para o projeto em uso: exige a opção escrita por
extenso, recusa destino com `supabase.co` no nome ou com a referência do
projeto, exige socket local em vez de TCP, e ainda pergunta ao servidor se ele
tem papéis de plataforma do Supabase. Nenhuma dessas barreiras existe por
desconfiança de quem roda; existem porque um script de reconstrução apontado
para o banco errado não dá erro — ele funciona.

---

## Quando uma migração nova entrar

O bootstrap não se atualiza sozinho, e uma referência que envelhece em silêncio
é pior do que não ter referência. A ordem é:

1. escrever a migração em `supabase/migrations/` e aplicá-la;
2. atualizar `schema.sql` para que um banco novo **já nasça** com a mudança;
3. rodar `ferramentas/reconstroi.sh --i-know-this-is-disposable`;
4. regravar `inventario-esperado.txt` a partir do banco reconstruído;
5. conferir que o inventário do banco em uso bate com a referência nova.

O passo 4 é do banco reconstruído, nunca editado à mão: uma referência escrita
à mão desfaz a única prova que ela dá.

---

## O que este bootstrap não recupera

Ele recupera a **estrutura**. Não recupera:

- **os dados** — para isso existe backup do Supabase, que é outro assunto;
- **as contas de `auth`** — cada pessoa se cadastra de novo, e os `user_id`
  mudam;
- **as quatro extensões de plataforma** — vêm com o projeto novo;
- **as configurações do projeto** — região, autenticação, e-mail, limites.

E ele não substitui `supabase/migrations/`. Aquelas são o registro do que
aconteceu, e continuam imutáveis. Este arquivo é o ponto de partida de uma
instalação nova.

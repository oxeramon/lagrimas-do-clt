# Lágrimas do CLT

Organizador financeiro pessoal de um usuário só. Site estático no GitHub Pages,
dados no Supabase. Português do Brasil em tudo: interface, banco, comentários,
commits.

## Repositório público — regra de segurança obrigatória

Este repositório é PÚBLICO.

Nenhum dado real, pessoal, financeiro, identificável ou derivado da base em uso
pode ser escrito em qualquer arquivo versionado, documentação, teste, fixture,
seed, comentário, exemplo, screenshot, artefato, nome de branch, mensagem de
commit ou outro conteúdo destinado ao Git.

Esta regra vale inclusive para dados usados apenas temporariamente durante uma
análise ou depuração.

Nunca use dados reais como exemplo para depois sanitizar.
Crie o exemplo sintético antes de escrever.

São proibidos, entre outros:

- nomes reais de pessoas;
- e-mails pessoais;
- telefones;
- CPF/CNPJ;
- endereços e CEP;
- placas;
- números ou finais reais de cartões;
- números de contrato;
- credores reais;
- bancos/produtos derivados da base pessoal;
- saldos;
- rendas;
- valores de dívidas;
- valores de parcelas;
- combinações parcela/total provenientes da base real;
- datas de compra reais;
- ciclos reais de cartão;
- dados de aluguel;
- dados de financiamento;
- dumps, backups e exportações reais;
- screenshots contendo dados reais;
- JWT;
- service_role;
- senhas;
- tokens privados;
- chaves privadas;
- secrets de IA, WhatsApp ou serviços externos.

Podem permanecer apenas quando tecnicamente necessários e explicitamente
classificados como públicos:

- SUPABASE_URL;
- chave Supabase publishable/anon;
- URLs públicas do GitHub/GitHub Pages;
- dados de teste comprovadamente sintéticos.

Ao precisar de dados para teste, crie fixtures artificiais que não sejam
transformações, arredondamentos ou pequenas alterações de dados reais.

Antes de qualquer commit ou push, execute a auditoria de repositório público.

Se houver dúvida se uma informação pode ser publicada, trate-a como privada e
não a grave no repositório.

Como fazer isso na prática, com os critérios de classificação e o procedimento
completo, está em `.claude/skills/public-repo-hygiene/SKILL.md`. A auditoria é
`node testes/audita.mjs`, e ela roda sozinha a cada Write/Edit pelo hook
`.claude/hooks/checa-publico.mjs` e antes de cada push pelo `.githooks/pre-push`.

## Onde fica o que

| | |
|---|---|
| Site no ar | https://oxeramon.github.io/lagrimas-do-clt/ |
| Repositório | `github.com/oxeramon/lagrimas-do-clt`, branch `main` |
| O que vai ao ar | **só o artefato**: `index.html`, `css/*.css`, `js/**/*.js`. `docs/`, `supabase/`, `testes/`, `.claude/` e `ferramentas/` ficam no repositório e NÃO são publicados — ver `docs/PUBLICACAO.md` |
| Projeto Supabase | região São Paulo; a URL e a chave publicável ficam no topo do `<script type="module">` do `index.html`, que é a fonte para qualquer coisa que precise delas |

Estrutura do banco: **24 tabelas e 6 views**, todas com RLS ligada e 24
policies — `ping` sem trigger, como sempre. As views rodam com
`security_invoker`. **Quinze migrações** já rodaram, e o registro do que cada
uma fez está em `docs/MIGRACOES.md`.

Todas as tabelas da V2 estão ligadas a alguma tela. `ferramentas/confere-migracoes.mjs`
compara o arquivo de cada migração com o que de fato rodou no banco: quando os
dois discordam, some a única fonte confiável sobre o que aconteceu.

**Migração aplicada é imutável**, comentário incluído. Quando o arquivo e o
banco discordam, some a única fonte confiável sobre o que rodou; conserto vira
migração nova. Na V2, `tipo` é só o efeito no saldo (`entrada`/`saida`) e
`natureza` é o que aconteceu (`normal`/`transferencia`/`estorno`) — e FK entre
objetos de usuário é composta por `(user_id, coluna)`, porque a checagem de FK
roda por fora do RLS.

As três fontes de dado de exemplo do projeto são a carga da seção 3 do SQL, a
fixture de `testes/regras.mjs` e o cenário de `testes/preview.mjs`. Todas são
inventadas, com nomes genéricos e centavos zerados. A regra acima vale para as
três, e também para exemplo em comentário, em placeholder de formulário e em
documentação.

O valor de conferência da seção 5 do SQL vale para uma instalação do zero, só
com a carga de exemplo. Em base já em uso ele é outro, e serve para comparar
antes e depois de uma migração, não como constante do projeto.

**`supabase-setup.sql` é a V1, e é história.** Ele instala oito das vinte e
quatro tabelas, e num projeto novo produz um banco que o site não consegue
usar. Não o reescreva para virar o schema atual: o schema atual já está inteiro
em `supabase/bootstrap/schema.sql`, e reescrever aquele apagaria a história sem
dar nada em troca. Ele fica reexecutável porque `testes/regras.mjs` lê o valor
de conferência da seção 5 dele.

## Reconstruir o banco do zero

`supabase/bootstrap/` existe para o dia em que o projeto Supabase se perder.
São três arquivos — `schema.sql` (o schema inteiro), `seed.sql` (carga de
exemplo, opcional, inventada) e `inventario-esperado.txt` (como o banco deve
ficar) — e o passo a passo está em `supabase/bootstrap/README.md`.

`schema.sql` **não é reexecutável, de propósito**: aborta se achar qualquer
objeto em `public`, e não usa `if not exists` em lugar nenhum. É a regra
oposta à do `supabase-setup.sql`, e o hook `checa-rls.mjs` sabe disso — as
invariantes de segurança continuam valendo iguais lá dentro.

**Migração nova não atualiza o bootstrap sozinha.** A ordem, e ela não tem
atalho:

1. escrever a migração em `supabase/migrations/` e aplicá-la;
2. atualizar `supabase/bootstrap/schema.sql` para um banco novo já nascer com
   a mudança;
3. `ferramentas/reconstroi.sh --i-know-this-is-disposable`;
4. regravar `inventario-esperado.txt` **a partir do banco reconstruído**;
5. conferir que o inventário do banco em uso bate com a referência nova.

O passo 4 nunca é à mão. Uma referência escrita à mão desfaz a única prova que
ela dá: passa a descrever o que alguém achou que o banco tinha, e é exatamente
aí que o drift some.

**O banco em uso não é laboratório de reconstrução.** Para provar qualquer
coisa sobre o bootstrap, o lugar é o Postgres descartável de
`ferramentas/reconstroi.sh`, que se recusa a apontar para o projeto em uso de
quatro maneiras diferentes. No banco em uso cabe leitura de catálogo,
comparação e conferência — nunca `drop`, `truncate` nem "recriar para ver se
funciona".

## O mapa

`docs/CODEBASE_MAP.md` tem a planta completa: o modelo de dados, os quatro eixos,
o schema tabela a tabela, as peças de interface escritas à mão, as armadilhas e
onde mexer para cada tipo de mudança. Leia antes de uma alteração grande.

`docs/ARCHITECTURE_V2.md` tem o mapa de módulos e o que cada camada pode
importar. `docs/CONTRATOS_V1.md` tem o que não pode mudar de comportamento.

Resumindo: `index.html` guarda o HTML e o JS de tela da V1. O CSS saiu para
`css/` (tokens, base, views-v2) e o cálculo saiu para `js/`, em ES Modules que
`testes/regras.mjs` importa exatamente iguais. As telas da V2 moram em
**`js/ui/screens/`**, uma por responsabilidade, e `js/ui/v2-screens.js` é só a
fachada que o `index.html` conhece. **Nenhuma tela importa outra tela**: o que
duas telas precisam ler mora em `screens/estado.js`, e o que duas telas
desenham igual mora em `screens/pecas.js`. O acesso ao banco mora em
`js/data/`: nenhum `sb.from` sobrou no `index.html`.
Há um segundo `<script>`, de 15 linhas, no `<head>`: ele resolve o tema antes
da primeira pintura e não faz mais nada.

**A lateral e o rodapé do celular são MONTADOS a partir de
`js/ui/navigation.js`.** Acrescentar uma tela é acrescentar uma linha no
registro -- e só isso. Escrever no HTML à mão já fez a tela discordar do
registro duas vezes.

## A V1 e a V2 se ligam, e continuam sem se somar

A V1 responde por **compromisso** (dívida, fixa, receita prevista, projeção); a
V2, por **movimento** (conta, saldo, transação, cartão, fatura). As duas hoje se
ligam pela ponte, e a regra que impede a dupla contagem é uma frase:

> Compromisso liquidado deixa de ser previsto e passa a ser realizado.
> Ele aparece num lado OU no outro. Nunca nos dois.

Nada acontece automaticamente: transação solta não marca compromisso, marcar
pago no quadradinho não cria transação, e a ligação só existe quando a pessoa
usa "Pagar" ou "Receber".

**Quatro contratos governam o que pode ser somado**, e cada um foi escrito
antes do SQL correspondente:

| Contrato | A frase |
|---|---|
| `docs/CONTRATO_PONTE.md` | compromisso liquidado sai do previsto e entra no realizado |
| `docs/CONTRATO_CARTAO.md` | compra no cartão é despesa; pagamento da fatura não é despesa nova |
| `docs/CONTRATO_ESTORNO.md` | transação com vínculo estrutural não se estorna, se desfaz |
| `docs/CONTRATO_METAS.md` | meta é envelope: ela não cria dinheiro nem muda saldo |
| a 011 | assinatura é REGRA, ocorrência é EVENTO com DATA própria |

**Quatro invariantes viraram teste permanente**, e mexer em cálculo sem
entendê-los é como se quebra o produto:

| | Situação | Resposta |
|---|---|---|
| A | compra no cartão 100 + pagamento da fatura 100 | consumo 100, caixa 100 |
| B | compromisso 500 + o pagamento dele | 500 no mês |
| C | transferência de A para B | patrimônio inalterado |
| D | receita prevista 1.000 + o recebimento | 1.000 no mês |

Continua **não existindo** "patrimônio líquido" no produto: obrigação e caixa
vão para blocos diferentes do Início, e a fórmula que os juntar, se um dia
existir, precisa estar escrita antes de aparecer na tela.

## Restrições que não são negociáveis

**Sem build, sem bundler, sem `npm install`, sem dependência local.**
Bibliotecas só por CDN com ESM, e hoje só há uma (`supabase-js`). Os módulos de
`js/` são servidos como arquivos, e o navegador resolve os caminhos sozinho.
Gráficos, calendário e listas suspensas são escritos à mão. Se uma mudança
parecer pedir um passo de build para produção, ela está errada para este
projeto.

**Regra financeira mora em `js/domain/`, e só lá.** Nada de uma cópia no
`index.html` por conveniência. Módulo de domínio não toca DOM; é isso que o
deixa testável sem navegador. O hook `checa-modulos.mjs` cobra o grafo.

**`index.html` não abre mais direto do disco.** O navegador recusa `import` a
partir de `file://`. Para olhar a tela localmente, use `node testes/preview.mjs`,
que achata os módulos num arquivo só.

**RLS é a única proteção dos dados.** O repositório é público (exigência do
plano grátis do Pages) e a chave publicável fica visível no HTML. Toda tabela
nova com dado pessoal precisa, no mesmo commit: `enable row level security`,
policy por `auth.uid()`, trigger `set_user_id` e índice. Copie o bloco de uma
tabela existente. `ping` é a única exceção — não tem `user_id` e é legível sem
login de propósito.

**O que vai ao ar é whitelist, nunca lista de exclusão.** O Pages publica o
artefato de `ferramentas/artefato.mjs`: `index.html`, `css/*.css` e
`js/**/*.js`, e mais nada. Um arquivo novo em `js/` sobe sozinho, o que é o
comportamento certo; qualquer arquivo novo em outro lugar NÃO sobe, e esse
também é o comportamento certo. Se uma mudança pedir para publicar algo fora
dessas três entradas, ela precisa entrar em `PERMITIDOS` de propósito, com
commit próprio. Nunca troque a whitelist por `cp -r .` mais exclusões: a falha
da exclusão é silenciosa e o padrão dela é publicar. Detalhes e o passo manual
do Pages estão em `docs/PUBLICACAO.md`.

**A migração roda antes do deploy.** Publicar código que consulta uma coluna ou
tabela que ainda não existe derruba o app — aconteceu duas vezes em 12/09/2026.
Rode o SQL primeiro e só então empurre; se não der para rodar na hora, segure o
push.

**Meta é envelope, conta é onde o dinheiro está.** Uma meta não cria dinheiro,
não move dinheiro e não altera saldo bancário: alocar não gera transação e não
tem coluna de conta. Saldo 10.000 com meta de 5.000 é 10.000, nunca 15.000 --
os 5.000 estão DENTRO. A única relação entre saldo e reservado é de subtração,
e nenhum número do produto os soma. Ver `docs/CONTRATO_METAS.md`.

**Um acontecimento é UM evento no calendário.** Compromisso previsto e pago não
são duas linhas: são uma linha com dois estados, e quem liga as duas é a ponte
da 005. Duas linhas de 100 fazem quem lê concluir que pagou 200. Ver
`js/domain/calendar.js`.

**Nada é armazenado mês a mês, e há exatamente duas exceções.** A parcela de um
mês existe se o mês cai entre `mes_inicial` e
`mes_inicial + (total_parcelas - parcela_inicial)`. Uma receita mensal vale no
intervalo `mes_inicial..mes_final`, ambos opcionais.

As duas exceções são `pagamentos` (qual item foi pago em qual mês) e `fixas_mes`
(quanto uma conta variável veio num mês). Ambas existem pelo mesmo motivo: **não
se derivam**. Pagar é um ato; a conta de luz chega. Antes de criar uma terceira,
pergunte se o dado é calculável — se for, ele não mora numa tabela por mês.

**`supabase-setup.sql` é a fonte única do schema** e precisa continuar
reexecutável do começo ao fim. Nada de `raise exception` fora de erro real — um
`do $$` que aborta derruba as migrações que vêm depois dele. E chave estrangeira
só aponta para tabela já criada acima: o hook cobra isso, porque em banco que já
tem a tabela o erro passa despercebido e só aparece numa instalação nova.

## Estilo

- Todo dado do usuário passa por `esc()` antes de entrar em `innerHTML`.
- Cor só por variável CSS (`var(--brand)`, `var(--ink-2)`…); o tema escuro sai
  de graça e nunca deve ser tratado à parte. Quem decide é `<html data-tema>`, e
  existe **um** bloco escuro no CSS, `:root[data-tema="escuro"]`. Se uma mudança
  pedir um segundo bloco de cores, ela está errada: a duplicata é que abre tema
  pela metade.
- Peça larga (tabela, figura grande, mais um botão na barra) pede medição de
  rolagem lateral em 320, 360 e 390 px. `1fr` de grid cresce até o filho mais
  largo, e o defeito não aparece no monitor.
- Dinheiro por `money()` — ele já traz o "R$", não ponha outro na frente.
  Porcentagem por `pct()`, mês por `label()` / `labelLong()`. Número que
  alinha em coluna leva `tabular-nums`; a única família carregada é a Inter.
- Excluir é sempre em dois cliques no mesmo botão ("Excluir" → "Confirmar
  exclusão", volta sozinho em 4s). Não use `confirm()`.
- Escrita: frase curta, sem jargão, sem exclamação. "Não deu para salvar", não
  "Erro ao persistir". Os textos da interface são lidos por quem está apertado
  de dinheiro.
- **Nome de número importa tanto quanto o número.** Três defeitos de 12/09/2026
  foram só de rótulo: "Saldo devedor" que era total a pagar, uma contagem de
  parcelas pagas lida como o número da parcela atual, e um filtro comparando
  com o eixo errado. Nenhum teste pega isso: a expressão está certa e responde
  outra pergunta.

## Comandos

```bash
node testes/rotas.mjs
```
85 casos que percorrem o REGISTRO de abas num navegador de verdade: uma entrada
por aba na lateral, cada aba abrindo o painel certo e nenhum outro junto, o
celular com quatro no rodapé e o resto atrás do "Mais", e os módulos do site
importando sem erro. A matriz sai de `ABAS`, nunca de lista à mão -- tela nova
entra na prova no commit em que for registrada.

Ele existe porque duas classes de defeito passaram por todos os hooks:
identificador de outro módulo usado como global (compila, passa, quebra no
navegador) e id duplicado criado em tempo de execução (o arquivo tem um, o DOM
tem dois).

```bash
node testes/regras.mjs
```
332 casos sobre uma fixture sintética, importando os mesmos módulos que o
navegador carrega -- não uma cópia deles. Inclui a regressão que amarra
`saldoAberto()` ao valor de conferência do SQL, lido do próprio
`supabase-setup.sql`: se a carga de exemplo mudar e a fixture não acompanhar, o
teste acusa. **Rode depois de mexer em
qualquer conta** — erro aqui não quebra nada, só mostra o número errado. Um teste
novo só vale se você confirmar que ele falha com o defeito antigo de volta.

```bash
node testes/preview.mjs
```
Gera `preview.html` com o Supabase dublado e dados de exemplo, para conferir a
tela sem tocar no banco real. Fica fora do git. Ele se recusa a gerar com seed
incoerente: recalcula a fatura de cada compra de cartão e aborta se o mês
declarado não bater com o fechamento.

```bash
node testes/fluxos.mjs
```
273 casos que dirigem a interface num navegador de verdade, em desktop e
celular. Eles existem porque `regras.mjs` prova o CÁLCULO e provou certo o
tempo todo enquanto a transferência estava travada: aquele defeito só existia
com DOM. Precisa de Playwright e de um Chromium; se não achar, avisa e sai com
zero em vez de fingir que rodou.

Ele pega o que nenhum outro pega: identificador usado fora do módulo onde foi
declarado, tela que não se refaz depois de um recarregamento, e rolagem lateral
em 320 px.

```bash
node testes/audita.mjs
```
Auditoria de repositório público. Crítico bloqueia commit e push.

```bash
node ferramentas/artefato.mjs     # constrói _site/, fora do git
node testes/artefato.mjs          # 110 conferências sobre o que vai ao ar
SERVIR_ARTEFATO=1 node testes/fluxos.mjs   # os 273 fluxos contra o artefato
```
A fronteira da publicação. `artefato.mjs` confere que nada de proibido entrou,
que nada de que o navegador precisa ficou de fora, que o servidor devolve 404
no que não é do site e que nenhuma chave além da publicável está no pacote.
**Rode depois de mexer em `index.html`, em `css/` ou em `js/`** — e antes de
qualquer mudança na whitelist. `docs/PUBLICACAO.md` explica o desenho.

```bash
ferramentas/reconstroi.sh --i-know-this-is-disposable
```
Levanta um banco descartável, aplica `supabase/bootstrap/schema.sql` do zero,
confere o inventário estrutural contra `inventario-esperado.txt` e roda as
doze suítes de `supabase/testes/` -- 384 casos. É a prova de que o bootstrap
reconstrói o banco, e não só de que o arquivo parece certo. **Rode depois de
qualquer migração nova**, junto com o passo 4 da seção "Reconstruir o banco do
zero".

Ele se recusa a apontar para o projeto em uso de quatro maneiras: exige a opção
escrita por extenso, recusa destino com a referência do projeto ou com
`supabase.co` no nome, exige socket local em vez de TCP, e pergunta ao servidor
se ele tem papéis de plataforma do Supabase.

```bash
node ferramentas/confere-schema.mjs /caminho/do/inventario.txt
```
Compara o inventário de qualquer banco com a referência versionada e FALHA na
divergência. Para o banco em uso, rode `ferramentas/inventario.sql` no SQL
Editor -- é só leitura de catálogo -- e salve a coluna num arquivo.

Os arquivos de `supabase/testes/` rodam no banco de VERDADE: cole no SQL Editor
ou mande por `execute_sql`. Cada um abre em `begin` e fecha em `rollback`, então
não grava nada. Migração que muda regra de modelo vem com teste assim, e ele
roda como `authenticated` e como `anon` -- teste de autorização rodando como
`postgres` não prova nada, porque `postgres` passa por cima de RLS e de grant.

**Rode a suíte ANTES de aplicar a migração**, junto com o próprio DDL numa
transação revertida no fim. Esse ensaio já encontrou dois defeitos reais que só
apareceriam em produção: uma variável com o mesmo nome de uma coluna, que o
plpgsql só recusa em tempo de execução, e uma soma de fatura sem sinal.

Cinco hooks rodam sozinhos depois de cada Write/Edit:

| Hook | O que cobra |
|---|---|
| `checa-publico.mjs` | nenhum dado privado entrou no arquivo editado |
| `checa-sintaxe.mjs` | cada arquivo JS compila e todo `$("id")` existe no HTML |
| `checa-modulos.mjs` | import aponta para arquivo existente, nome é exportado, sem ciclo |
| `checa-html.mjs` | tags fecham na ordem certa, nenhum id repete |
| `checa-rls.mjs` | RLS, policy, trigger, ordem das FKs, e `raise exception` fora de função — esta última só no SQL reexecutável, não no bootstrap |

Não há lint nem type-check.

**Não escreva código com regex por heredoc.** `bash <<'EOF'` transforma `\b` em
bytes de backspace reais: invisíveis no grep, aprovados pelo `node --check`, e a
regex nunca casa. Use a ferramenta Write.

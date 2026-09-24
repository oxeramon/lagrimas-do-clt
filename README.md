# Lágrimas do CLT

Organizador financeiro pessoal: o que entra, o que sai e quando acaba. Site
estático no GitHub Pages, dados no Supabase, login por e-mail e senha. Sem custo
e sem dependência de conta corporativa.

| Aba | Para quê |
|---|---|
| **Início** | quanto falta pagar, data prevista de quitação, curva de quanto ainda falta, maiores credores, e o saldo que está nas contas |
| **Mês** | o que vence no mês, com marcação de pago |
| **Contas** | onde o dinheiro está: saldo por conta, disponível, restrito e bloqueado |
| **Transações** | o que entrou e saiu, por dia, com filtro e busca |
| **Receitas** | o que entra além da renda base: recorrente ou uma vez só |
| **Dívidas** | tudo que está parcelado e as contas fixas |
| **Projeção** | 12 meses de compromisso contra a renda de cada mês |
| **Ajustes** | renda base, credores, categorias, instituições, importação e backup integral |

### Duas metades que se ligam, e nunca se somam

O app tem dois lados, e saber qual responde o quê é o que faz os números
fazerem sentido:

| | Responde por | Onde vive |
|---|---|---|
| **Compromisso** | dívidas, parcelas, contas fixas, receitas previstas, projeção | Mês, Dívidas, Receitas, Projeção |
| **Movimento** | contas, saldo, o que entrou e saiu, cartões, faturas | Contas, Cartões, Transações |

A primeira fala do que **ainda vai** acontecer. A segunda, do que **já**
aconteceu. Somar as duas num número só contaria o mesmo dinheiro duas vezes.

Os dois lados hoje **se ligam**: dá para pagar um compromisso escolhendo a
conta, e receber uma receita prevista. A regra que impede a dupla contagem cabe
numa frase:

> Compromisso liquidado deixa de ser previsto e passa a ser realizado.
> Ele aparece num lado **ou** no outro. Nunca nos dois.

E nada acontece sozinho. Lançar uma transação solta não marca compromisso
nenhum; marcar pago no quadradinho não cria transação. A ligação só existe
quando você usa **Pagar** ou **Receber** — adivinhar qual transação corresponde
a qual compromisso é a maneira mais rápida de contar dinheiro duas vezes.

Pelo mesmo motivo, **compra no cartão é despesa e pagamento da fatura não é
despesa nova.** Uma compra de R$ 100 paga na fatura é R$ 100 de gasto e R$ 100
que saíram da conta — nunca R$ 200 em lugar nenhum.

Continua sem existir um "patrimônio líquido" na tela: obrigação e caixa ficam
em blocos separados no Início, e a fórmula que os juntar, se um dia existir,
precisa estar escrita antes de aparecer.

### O que ele sabe fazer

**Fatura de cartão.** Cadastre o cartão com o dia de fechamento e o app deduz
sozinho em qual fatura cada compra cai. A dedução é sugestão: mexeu no mês, a
sua escolha manda, e ele avisa quando as duas divergem.

**Banco e cartões.** O credor é o banco; cada cartão é um produto dele, com
fatura e ciclo próprios. Dois cartões do mesmo banco viram duas faturas dentro
do mesmo credor.

**Conta dividida.** Uma compra de R$ 400 rachada ao meio continua sendo R$ 400
que você deve — mas o app sabe que R$ 200 voltam, e de quem.

**Conta fixa que varia.** Energia e condomínio se cadastram com o valor médio.
Quando a conta chega, você informa o real daquele mês, sem reescrever os outros.

**Compra antiga.** Lançando uma dívida na parcela 4 de 9, o app entende que 3
já foram pagas e as mostra nos meses delas.

**Pagar e receber.** No Mês, cada compromisso ganha um botão: escolha a conta e
a data, e ele vira uma saída de verdade — e sai do "falta pagar" no mesmo
movimento. Em Receitas, o mesmo com **Receber**. A conta do mês não muda por
causa disso: o dinheiro só troca de coluna.

**Cartões e faturas.** Cadastre o cartão com o dia de fechamento e o de
vencimento, e o app diz em qual fatura cada compra cai — inclusive quando o
fechamento é dia 31 e o mês tem 28. A fatura nunca é rotulada por um mês solto:
ela mostra as duas datas, porque "a fatura de setembro" quer dizer coisas
diferentes para o app e para você.

**Compra parcelada.** Uma compra em 3x vira três parcelas em três faturas, e os
centavos que não dividem vão para a primeira. A soma é exatamente o valor.

**Assinaturas.** Aquelas cobranças que chegam sozinhas. O app mostra quanto
custam por mês somadas — e converte a anual para o equivalente mensal, porque
R$ 120 por ano parece maior que R$ 30 por mês e é um terço.

**Contas divididas.** Grupos com quem você racha: quem pagou, quanto cabe a
cada um, quem deve a quem, e o acerto quando alguém paga. O grupo calcula a
obrigação; o dinheiro só entra na sua conta quando você escolhe a conta.

**Tema claro ou escuro.** O botão **Tema**, no rodapé da lateral e no topo do
celular, gira entre três posições: automático, claro e escuro. Em automático ele
segue o aparelho, inclusive quando o celular troca sozinho ao anoitecer. A
escolha fica guardada no navegador, não no banco, então vale por aparelho.

---

## Como funciona

| Camada | Onde fica | Custo |
|---|---|---|
| Tela (HTML, CSS, JS) | GitHub Pages, artefato de GitHub Actions | grátis |
| Banco de dados e login | Supabase | grátis |
| Ping diário anti-pausa | GitHub Actions | grátis |

O arquivo `index.html` é público, porque o plano gratuito do GitHub Pages só publica repositório público. **Isso não expõe seus dados.** A chave `anon` do Supabase é feita para ficar visível: sozinha ela não lê nada, porque as políticas de segurança do banco (RLS) exigem login e restringem cada usuário às próprias linhas.

---

## Instalação

Tempo estimado: 40 a 60 minutos. Faça na ordem.

### 1. Criar o projeto no Supabase

1. Entre em [supabase.com](https://supabase.com) com sua conta **pessoal** e crie um projeto.
2. Região: escolha `South America (São Paulo)`.
3. Guarde a senha do banco que ele pedir. Você não vai usar no dia a dia, mas não dá para recuperar.
4. Espere o projeto terminar de subir (2 a 3 minutos).

### 2. Criar seu usuário

1. Menu **Authentication → Users → Add user → Create new user**.
2. Preencha e-mail e senha. **Marque "Auto Confirm User"**, senão você não consegue entrar.
3. Ainda em Authentication, abra **Sign In / Providers → Email** e **desative "Allow new users to sign up"**. Como o site é público, isso impede que qualquer pessoa crie conta no seu banco.

### 3. Criar as tabelas

1. Abra o arquivo `supabase/bootstrap/schema.sql`.
2. No Supabase, vá em **SQL Editor → New query**, cole o arquivo inteiro e clique em **Run**.
3. No fim deve aparecer:
   Confira o inventário exibido pelo script. O banco ativo já recebeu migrações posteriores ao arquivo de bootstrap; antes de uma instalação nova, regenere e valide o bootstrap contra o banco.

Se der erro no meio, o banco ficou pela metade. Não tente emendar: apague o
projeto, crie outro e comece de novo. Em projeto vazio isso não custa nada, e o
arquivo se recusa a rodar por cima de um banco que já tem alguma coisa
justamente para você não ficar com dois schemas misturados.

**Não use `supabase-setup.sql` para isso.** Ele instala a V1 — oito das vinte e
quatro tabelas — e ficou no repositório como história. O passo a passo completo,
com o que conferir depois, está em `supabase/bootstrap/README.md`.

### 3b. Carregar dados de exemplo (opcional)

Depois de criar sua conta no site (passo 7), cole `supabase/bootstrap/seed.sql`
no SQL Editor. Ele põe duas contas, uma árvore de categorias, um cartão com
fatura, alguns compromissos e uma meta, tudo inventado, só para a primeira tela
não vir vazia. Apague pelo próprio app quando for começar a usar de verdade.

Para começar do zero de verdade, pule este passo.

### 4. Pegar as chaves

Em **Project Settings → API**, copie:

- **Project URL** (algo como `https://abcdefgh.supabase.co`)
- **anon public** (chave longa)

### 5. Configurar o `index.html`

Abra o arquivo e preencha as duas linhas no começo do bloco `<script>`:

```js
const SUPABASE_URL      = "https://abcdefgh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

### 6. Publicar no GitHub

1. Crie um repositório **público** chamado `lagrimas-do-clt`.
2. Suba os arquivos mantendo a estrutura:

```
lagrimas-do-clt/
├── index.html            tela: CSS, HTML e o JavaScript de interface
├── js/                   o cálculo, em ES Modules que o navegador carrega
│   ├── core/             datas, dinheiro, escape, estado
│   ├── domain/           dívidas, receitas, credores, contas fixas, fatura
│   └── ui/               navegação
├── supabase-setup.sql    a V1, histórico: NÃO serve para instalar
├── supabase/
│   ├── README.md         qual arquivo é o quê
│   ├── bootstrap/        o schema inteiro, para instalar do zero
│   ├── migrations/       o registro do que já rodou no banco
│   └── testes/           suítes que rodam no banco, em transação revertida
├── README.md
├── CLAUDE.md             restrições do projeto, para quem for mexer
├── docs/
│   ├── CODEBASE_MAP.md   a planta do código
│   ├── ARCHITECTURE_V2.md  módulos, dependências e o modelo da V2
│   └── CONTRATOS_V1.md   o que não pode mudar de comportamento
├── testes/
│   ├── regras.mjs        confere as contas
│   ├── preview.mjs       gera uma prévia com dados falsos
│   └── audita.mjs        confere que nada privado entrou no repositório
└── .github/
    └── workflows/
        └── keepalive.yml
```

3. Em **Settings → Pages → Build and deployment**, escolha **GitHub Actions** como origem. O workflow publica apenas HTML, CSS e JS; os arquivos internos continuam públicos no repositório, mas não são servidos no Pages.
4. Em 1 a 2 minutos o site fica no ar em `https://SEU-USUARIO.github.io/lagrimas-do-clt/`.

### 7. Liberar o endereço no Supabase

Em **Authentication → URL Configuration**, adicione `https://SEU-USUARIO.github.io/lagrimas-do-clt/` em **Site URL** e em **Redirect URLs**.

### 8. Ligar o ping diário

Em **Settings → Secrets and variables → Actions → New repository secret**, crie os dois:

| Nome | Valor |
|---|---|
| `SUPABASE_URL` | a Project URL do passo 4 |
| `SUPABASE_ANON_KEY` | a chave anon do passo 4 |

Depois abra a aba **Actions**, selecione o workflow `keepalive` e clique em **Run workflow** para testar. Tem que terminar verde.

### 9. Colocar no celular

Abra o endereço no navegador do celular, faça login e use **Adicionar à tela de início**. Ele passa a abrir como aplicativo, em tela cheia.

---

## O que fazer depois

1. Abra a aba **Ajustes** e preencha a renda base. Sem ela, o % comprometido e a sobra ficam inativos.
2. Cadastre uma conta fixa chamada **Custo de vida variável** com a média de alimentação, transporte e demais gastos. Sem isso a sobra estimada fica maior do que a real.
3. Na aba **Receitas**, lance o que entra além do salário: 13º, férias, freelance, aluguel recebido, reembolso. Sem isso a projeção fica pessimista nos meses em que sobra dinheiro.
4. Na aba **Dívidas**, confira o card **Credores** e preencha o contato de quem você precisa avisar.
5. Apague os lançamentos de exemplo que a carga inicial criou. Eles têm
   "Exemplo" no nome e existem só para a primeira tela não vir vazia.
6. Baixe o backup integral JSON em Ajustes e guarde-o em local privado. O CSV é uma projeção para Excel e não permite restaurar o sistema.

---

## Manutenção

| Situação | O que fazer |
|---|---|
| O site pede login toda vez | Normal se você limpou os dados do navegador. A sessão dura semanas. |
| "Failed to fetch" ou tela travada no login | O projeto Supabase pode ter pausado. Entre no painel do Supabase e clique em **Resume project**. Depois confira por que o keepalive falhou, na aba Actions. |
| O keepalive ficou vermelho | Abra o log na aba Actions. Quase sempre é segredo errado ou projeto pausado. |
| Quero mudar a senha | Supabase → Authentication → Users → seu usuário → Reset password. |
| Quero apagar tudo | Supabase → Settings → General → Delete project. |

### Riscos que você deve conhecer

**Pausa por inatividade.** O plano gratuito do Supabase pausa o projeto após cerca de 7 dias de baixa atividade, e sair da pausa é manual. O ping diário resolve, mas ele é um elo a mais: se o workflow parar, o banco pausa. Confira a aba Actions se o site der erro de conexão.

**Nada é infalível.** São três serviços gratuitos encadeados. Guarde backups integrais fora do GitHub. A restauração exige o schema atualizado e uma conta de destino vazia; teste o procedimento antes de depender dele. O CSV mensal não é um backup.

**Um só usuário.** O banco está preparado para múltiplos usuários (cada um vê só o que é seu), mas o cadastro está desativado. Para liberar outra pessoa, crie o usuário manualmente no painel.

---

## Estrutura do banco

O banco atual tem 25 tabelas públicas, incluindo `ping`, e 6 views. A lista abaixo descreve os grupos funcionais, não é o inventário completo.

| Tabela | Conteúdo |
|---|---|
| `dividas` | uma linha por compra, com valor, parcela atual, total, mês inicial, dia da compra e o rateio com outra pessoa |
| `credores` | quem você deve: nome, tipo, contato, dia de fechamento do cartão e o banco a que pertence |
| `fixas` | despesas recorrentes sem prazo final, marcadas se o valor varia |
| `fixas_mes` | quanto uma conta variável veio num mês específico |
| `receitas` | o que entra além da renda base, recorrente ou pontual |
| `pagamentos` | uma linha por item marcado como pago em cada mês |
| `config` | renda base mensal |
| `ping` | tabela vazia usada só pelo keepalive |

**Nada é armazenado mês a mês.** A parcela de um mês existe se aquele mês
estiver entre `mes_inicial` e `mes_inicial + (total_parcelas - parcela_inicial)`.
Uma receita mensal vale no intervalo `mes_inicial..mes_final`, e os dois são
opcionais: sem início ela vale desde sempre, sem fim ela não acaba. Como não
existe uma linha por mês, corrigir um valor corrige o histórico inteiro de uma
vez.

Há exatamente **duas exceções**, e as duas existem porque o dado não se calcula:
`pagamentos` guarda qual item foi pago em qual mês, e `fixas_mes` guarda quanto
uma conta variável veio. Pagar é um ato; a conta de luz chega.

### E as tabelas do lado do movimento

| Tabela | Conteúdo |
|---|---|
| `instituicoes`, `contas` | onde o dinheiro está, com saldo inicial e liquidez |
| `categorias` | árvore de até três níveis, entrada e saída separadas |
| `transacoes` | o que entrou e saiu, e de onde |
| `liquidacoes` | a ponte: qual compromisso, de qual mês, por qual transação |
| `cartoes`, `faturas`, `compras_de_cartao` | cartão, ciclo e a compra que vira N parcelas |
| `assinaturas` | a regra da cobrança que se repete |
| `grupos`, `membros`, `despesas_do_grupo`, `rateios`, `acertos` | contas divididas |

**O cartão guarda no máximo os quatro últimos dígitos**, e o banco recusa
qualquer coisa diferente disso. Número completo, CVV, validade e senha não têm
onde ser guardados. Membro de grupo guarda nome e apelido, e nada mais: sem
e-mail, sem telefone, sem documento.

**Nenhuma dessas tabelas guarda o que dá para derivar.** Total de fatura,
situação da fatura, custo anual de assinatura e saldo de grupo saem de views, e
não de colunas — número guardado envelhece sozinho e passa a discordar do que
lhe deu origem.

Todas as tabelas com dados pessoais têm RLS ligado, policy por `auth.uid()` e
trigger que preenche o `user_id`. O repositório é público e a chave publicável
fica visível no HTML, então **RLS é a única coisa que separa os seus dados de
qualquer pessoa que abrir o site.** Ao criar uma tabela nova, copie o bloco de
segurança de uma existente antes de qualquer outra coisa.

---

## Mexer no código

Não há build, bundler nem `npm install`. O `index.html` guarda a tela, e o
cálculo mora em ES Modules dentro de `js/`, que o navegador carrega direto. Os
scripts abaixo precisam só do Node.

**O `index.html` não abre mais com dois cliques no disco**: o navegador recusa
`import` a partir de `file://`. Para olhar a tela localmente, use a prévia.

```bash
node testes/regras.mjs
```

Roda 297 casos sobre os mesmos módulos que o navegador carrega: parcelas,
intervalos de receita, renda do mês, contas fixas variáveis, fatura de cartão,
hierarquia banco/cartão, ciclo de fatura, divisão em centavos, e a regressão
que amarra o saldo devedor ao valor de conferência do `supabase-setup.sql`.
Rode depois de mexer em qualquer conta.

```bash
node testes/fluxos.mjs
```

Roda 204 casos dirigindo a interface num navegador de verdade, em desktop e em
celular. Ele pega o que teste de cálculo não pega: botão que não responde,
tela que não se atualiza, e rolagem lateral em 320 px. Precisa de Playwright e
de um Chromium; sem eles, avisa e sai sem falhar.

```bash
node testes/preview.mjs
```

Gera `preview.html`, uma cópia do site com o Supabase dublado e dados de exemplo,
para conferir a tela sem entrar no banco de verdade. O arquivo fica fora do git e
nunca vai para o ar.

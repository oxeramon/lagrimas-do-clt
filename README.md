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
| **Ajustes** | renda base, credores, categorias, instituições, importação e backup |

### Duas metades, e elas não se somam

O app está no meio de uma troca de motor, e é importante saber qual metade
responde o quê:

| | Responde por | Onde vive |
|---|---|---|
| **Compromisso** | dívidas, parcelas, contas fixas, receitas previstas, projeção | Dívidas, Receitas, Projeção |
| **Movimento** | contas, saldo, o que entrou e saiu, transferências | Contas, Transações |

A primeira fala do que **ainda vai** acontecer. A segunda, do que **já**
aconteceu. Somar as duas num número só contaria o mesmo dinheiro duas vezes,
então o app não faz isso -- e é por isso que ainda não existe um "patrimônio
líquido" na tela.

**Marcar uma dívida como paga NÃO cria transação, e lançar uma transação NÃO
marca dívida como paga.** As duas pontas são independentes de propósito nesta
fase. A ligação entre elas é trabalho de uma fase seguinte, e inventá-la sem
projeto é a maneira mais rápida de duplicar dinheiro na tela.

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

**Tema claro ou escuro.** O botão **Tema**, no rodapé da lateral e no topo do
celular, gira entre três posições: automático, claro e escuro. Em automático ele
segue o aparelho, inclusive quando o celular troca sozinho ao anoitecer. A
escolha fica guardada no navegador, não no banco, então vale por aparelho.

---

## Como funciona

| Camada | Onde fica | Custo |
|---|---|---|
| Tela (HTML, CSS, JS) | GitHub Pages | grátis |
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

### 3. Criar as tabelas e carregar os dados

1. Abra o arquivo `supabase-setup.sql`.
2. Troque `troque@pelo-seu-email.com` pelo e-mail que você acabou de cadastrar.
3. No Supabase, vá em **SQL Editor → New query**, cole o arquivo inteiro e clique em **Run**.
4. No fim deve aparecer `saldo_devedor_total = 29344.00`. Esse é o total da carga
   de exemplo que o arquivo cria, com seis lançamentos e dois credores fictícios.
   Se numa instalação do zero aparecer outro número, algo não entrou.

Os registros de exemplo servem só para a primeira tela não vir vazia. Apague-os
pelo próprio app quando for começar a usar de verdade, ou remova a seção 3 do
arquivo antes de executar.

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
├── supabase-setup.sql    instalação limpa: tabelas, segurança e migrações
├── supabase/
│   ├── README.md         qual arquivo é o quê
│   └── migrations/       o que ainda não foi executado no banco
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

3. Em **Settings → Pages → Build and deployment**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`, e salve.
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
6. Baixe o CSV uma vez por mês, em Ajustes → Backup.

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

**Nada é infalível.** São três serviços gratuitos encadeados. O CSV mensal é a sua garantia. Sem ele, um problema no Supabase significa recomeçar.

**Um só usuário.** O banco está preparado para múltiplos usuários (cada um vê só o que é seu), mas o cadastro está desativado. Para liberar outra pessoa, crie o usuário manualmente no painel.

---

## Estrutura do banco

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

Roda 152 casos sobre os mesmos módulos que o navegador carrega: parcelas,
intervalos de receita, renda do mês, contas fixas variáveis, fatura de cartão,
hierarquia banco/cartão e a regressão que amarra o saldo devedor ao valor de
conferência do `supabase-setup.sql`. Rode depois de mexer em qualquer conta.

```bash
node testes/preview.mjs
```

Gera `preview.html`, uma cópia do site com o Supabase dublado e dados de exemplo,
para conferir a tela sem entrar no banco de verdade. O arquivo fica fora do git e
nunca vai para o ar.

# Quitação

Organizador financeiro pessoal de um usuário só. Site estático no GitHub Pages,
dados no Supabase. Português do Brasil em tudo: interface, banco, comentários,
commits.

## Onde fica o que

| | |
|---|---|
| Site no ar | https://oxeramon.github.io/lagrimas-do-clt/ |
| Repositório | `github.com/oxeramon/lagrimas-do-clt`, branch `main` |
| Projeto Supabase | região São Paulo; a URL e a chave publicável ficam no topo do `<script type="module">` do `index.html`, que é a fonte para qualquer coisa que precise delas |

Estrutura do banco: **8 tabelas**, todas com RLS ligada, 1 policy e 1 trigger
cada — `ping` sem trigger, como sempre.

**Este repositório é público e não guarda dado financeiro real.** A carga da
seção 3 do SQL, a fixture de `testes/regras.mjs` e o cenário de
`testes/preview.mjs` são todos fictícios, com nomes genéricos e valores
redondos. Ao mexer em qualquer um dos três, mantenha assim: nada de saldo, nome
de pessoa, credor, final de cartão ou valor vindo de uma base em uso. O mesmo
vale para exemplos em comentário, em placeholder de formulário e em
documentação.

O valor de conferência da seção 5 do SQL vale para uma instalação do zero, só
com a carga de exemplo. Em base já em uso ele é outro, e serve para comparar
antes e depois de uma migração, não como constante do projeto.

## O mapa

`docs/CODEBASE_MAP.md` tem a planta completa: o modelo de dados, os quatro eixos,
o schema tabela a tabela, as peças de interface escritas à mão, as armadilhas e
onde mexer para cada tipo de mudança. Leia antes de uma alteração grande.

Resumindo: `index.html` é o site inteiro (CSS 35–784, HTML 786–1399, JS
1400–4617), com uma única dependência de CDN. O JS tem oito seções nomeadas por
comentário de banner; `testes/regras.mjs` recorta a de cálculo e roda em Node.
Há um segundo `<script>`, de 15 linhas, no `<head>`: ele resolve o tema antes da
primeira pintura e não faz mais nada.

## Restrições que não são negociáveis

**`index.html` é o site inteiro.** Sem build, sem bundler, sem `npm install`,
sem dependência local. Bibliotecas só por CDN com ESM, e hoje só há uma
(`supabase-js`). Gráficos, calendário e listas suspensas são escritos à mão. Se
uma mudança parecer pedir um passo de build, ela está errada para este projeto.

**RLS é a única proteção dos dados.** O repositório é público (exigência do
plano grátis do Pages) e a chave publicável fica visível no HTML. Toda tabela
nova com dado pessoal precisa, no mesmo commit: `enable row level security`,
policy por `auth.uid()`, trigger `set_user_id` e índice. Copie o bloco de uma
tabela existente. `ping` é a única exceção — não tem `user_id` e é legível sem
login de propósito.

**A migração roda antes do deploy.** Publicar código que consulta uma coluna ou
tabela que ainda não existe derruba o app — aconteceu duas vezes em 12/09/2026.
Rode o SQL primeiro e só então empurre; se não der para rodar na hora, segure o
push.

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
  Porcentagem por `pct()`, mês por `label()` / `labelLong()`. Números em
  `IBM Plex Mono` com `tabular-nums`.
- Excluir é sempre em dois cliques no mesmo botão ("Excluir" → "Confirmar
  exclusão", volta sozinho em 4s). Não use `confirm()`.
- Escrita: frase curta, sem jargão, sem exclamação. "Não deu para salvar", não
  "Erro ao persistir". Os textos da interface são lidos por quem está apertado
  de dinheiro.
- **Nome de número importa tanto quanto o número.** Três defeitos de 12/09/2026
  foram só de rótulo: "Saldo devedor" que era total a pagar, uma contagem de
  parcelas pagas lida como o número da parcela atual, e um filtro comparando
  com o eixo errado. Nenhum
  teste pega isso — a expressão está certa e responde outra pergunta.

## Comandos

```bash
node testes/regras.mjs
```
34 casos recortados do próprio `index.html`, sobre uma fixture sintética. Inclui
a regressão que amarra `saldoAberto()` ao valor de conferência do SQL, lido do
próprio `supabase-setup.sql`: se a carga de exemplo mudar e a fixture não
acompanhar, o teste acusa. **Rode depois de mexer em
qualquer conta** — erro aqui não quebra nada, só mostra o número errado. Um teste
novo só vale se você confirmar que ele falha com o defeito antigo de volta.

```bash
node testes/preview.mjs
```
Gera `preview.html` com o Supabase dublado e dados de exemplo, para conferir a
tela sem tocar no banco real. Fica fora do git. Ele se recusa a gerar com seed
incoerente: recalcula a fatura de cada compra de cartão e aborta se o mês
declarado não bater com o fechamento.

Três hooks rodam sozinhos depois de cada Write/Edit:

| Hook | O que cobra |
|---|---|
| `checa-sintaxe.mjs` | o JS compila e todo `$("id")` existe no HTML |
| `checa-html.mjs` | tags fecham na ordem certa, nenhum id repete |
| `checa-rls.mjs` | RLS, policy, trigger, ordem das FKs, sem `raise exception` |

Não há lint nem type-check.

**Não escreva código com regex por heredoc.** `bash <<'EOF'` transforma `\b` em
bytes de backspace reais: invisíveis no grep, aprovados pelo `node --check`, e a
regex nunca casa. Use a ferramenta Write.

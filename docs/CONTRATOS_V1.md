# Contratos da V1

Este documento registra o que **não pode mudar** enquanto a arquitetura é
reorganizada. Ele existe porque refatoração e mudança de regra de negócio são
coisas separadas, e misturar as duas é a forma mais barata de quebrar um app
financeiro sem ninguém perceber: o número continua aparecendo, só que errado.

Cada contrato abaixo diz **o comportamento**, não a implementação. Mover a
função de arquivo é livre; mudar a resposta dela não é.

A coluna "provado por" separa o que um teste cobre do que hoje só está escrito.
Onde estiver "só documentado", a refatoração precisa conferir à mão, e a Fase D
deve transformar isso em teste assim que a função sair do `index.html`.

## 1. Parcelas

| Contrato | Provado por |
|---|---|
| Uma dívida é um intervalo, não uma coleção de linhas. A parcela de um mês existe se `mes_inicial <= mês <= mes_inicial + (total_parcelas − parcela_inicial)` | `parcelaEm`, 3 casos |
| `restantesDe(d) = (total_parcelas − parcela_inicial) + 1` | 1 caso |
| `ultimoMes(d) = mes_inicial + restantesDe − 1` | 1 caso |
| Fora do intervalo, `parcelaEm` devolve `null`, nunca uma parcela zero | 2 casos |
| A numeração mostrada é `parcela_inicial + i`, e não `i + 1` | `parcelaEm` |

## 2. Parcelas anteriores ao cadastro

| Contrato | Provado por |
|---|---|
| Quem entra na parcela N já pagou N−1. Elas contam como quitadas | `totalQuitado`, 1 caso |
| Elas **aparecem** na lista do mês delas, derivadas para trás | só documentado |
| Elas **não** entram em nenhuma soma de saldo em aberto | `saldoAberto` |
| Elas não têm linha em `pagamentos`, então não podem ser desmarcadas | só documentado |

## 3. Saldo em aberto e quitado

| Contrato | Provado por |
|---|---|
| `saldoAberto` soma mês a mês, pulando o que está marcado como pago | 1 caso, amarrado ao SQL |
| `totalQuitado` soma `(parcela_inicial − 1) × valor` mais as marcadas | 2 casos |
| `quitado + aberto = valor × total_parcelas`, exatamente, sem subtração | 1 caso |
| Nenhum dos dois pode devolver negativo | 1 caso |
| Somar por repetição, nunca por multiplicação: multiplicar deixava resto de ponto flutuante que o formatador imprimia como "R$ 0,00" negativo | 1 caso |
| `abertoDe(d)` é o mesmo cálculo para uma dívida só | novo em Fase A |

## 4. Curva de quitação

| Contrato | Provado por |
|---|---|
| `saldoAposMes(k)` conta só parcelas com mês **estritamente** maior que k | 1 caso |
| Ele desconta o que está marcado como pago, igual a `saldoAberto` | 1 caso |
| Marcar uma parcela no próprio mês k não muda `saldoAposMes(k)` | 1 caso |
| `fimGeral()` é o maior `ultimoMes` entre as dívidas do filtro | novo em Fase A |

## 5. Pagamentos

| Contrato | Provado por |
|---|---|
| `pagamentos` guarda (mês, item). O item é o uuid da dívida ou `fx:<id>` | só documentado |
| Marcar é um ato, não uma consequência: nada deriva pagamento | só documentado |
| Apagar dívida ou conta fixa apaga as marcas dela | só documentado |

## 6. Contas fixas

| Contrato | Provado por |
|---|---|
| Conta fixa não tem prazo: vale em todo mês consultado | novo em Fase A |
| `fixas.valor` é a média quando `variavel` é verdadeiro | novo em Fase A |
| `fixas_mes` guarda o real de um mês e **não** reescreve o cadastro | novo em Fase A |
| Informar um mês não muda nenhum outro | novo em Fase A |
| Sem `fixas_mes`, a conta variável mostra a média e o app degrada em silêncio | só documentado |

## 7. Receitas

| Contrato | Provado por |
|---|---|
| Pontual vale só no mês exato | 3 casos |
| Mensal vale no intervalo, inclusivo nas duas pontas | 4 casos |
| Sem início vale desde sempre; sem fim, para sempre | 2 casos |
| `rendaDoMes = renda base + receitas do mês` | 4 casos |
| `periodoReceita` nomeia os cinco formatos de intervalo | 5 casos |

## 8. Fatura de cartão

| Contrato | Provado por |
|---|---|
| A compra entra na fatura que fecha depois dela | só documentado |
| A comparação é `>=`: compra no dia do fechamento já é do ciclo seguinte | só documentado |
| Vencimento antes do fechamento empurra o pagamento um mês | só documentado |
| A dedução é sugestão: mexer no mês liga `mesManual` e a regra vira aviso | só documentado |

## 9. Hierarquia banco e cartão

| Contrato | Provado por |
|---|---|
| Exatamente dois níveis. `paiDe`/`raizDe` resolvem um nível só | só documentado |
| Quem tem pai não pode ser pai: a tela só oferece credor sem pai | só documentado |
| Só cartão vira produto. Financiamento e empréstimo ficam no banco | só documentado |
| Filtrar pelo banco pega tudo dele; pelo produto, só aquele | só documentado |

## 10. Rateio

| Contrato | Provado por |
|---|---|
| `valor` não muda: você deve a parcela cheia ao credor | só documentado |
| `valor_terceiro` é por parcela, igual a `valor` | só documentado |
| Cobre você mais uma pessoa. Racha de três vira dois lançamentos | só documentado |
| O rateio **não** entra no fluxo mensal nem na projeção | só documentado |

## 11. Importação e backup

| Contrato | Provado por |
|---|---|
| CSV exige as 8 colunas obrigatórias; `data` é opcional | só documentado |
| Separador é o que aparece mais no cabeçalho | só documentado |
| Linha com problema não entra, e o problema é nomeado | só documentado |
| Valor zerado ou negativo não é lançamento | só documentado |
| Aceita `2026-03-07` e `07/03/2026` | só documentado |
| O backup sai com BOM, para o Excel abrir em UTF-8 | só documentado |

## 12. Sessão e segurança

| Contrato | Provado por |
|---|---|
| Login por e-mail e senha; sem sessão, nada carrega | só documentado |
| RLS é a única proteção: toda tabela com dado pessoal tem policy por `auth.uid()` | `checa-rls.mjs` |
| A carga é tudo-ou-nada, com `fixas_mes` como única exceção | só documentado |
| A chave publicável é pública por design | `audita.mjs` |

## 13. Interface

| Contrato | Provado por |
|---|---|
| Tema em três posições: automático, claro, escuro, nessa ordem cíclica | teste de navegador |
| Automático segue o sistema e acompanha a troca sem recarregar | teste de navegador |
| A escolha sobrevive ao recarregamento e funciona sem `localStorage` | teste de navegador |
| Nenhuma aba rola de lado entre 320 e 1600 px | teste de navegador |
| Excluir é dois cliques no mesmo botão, com reversão em 4s | só documentado |
| Seis diálogos, e o cartão da dívida tem dois alvos: corpo abre detalhe, lápis edita | só documentado |
| Navegação por abas, com lateral no desktop e rodapé no celular | só documentado |

## Como usar este documento

Antes de mover código: leia a linha do contrato que a função sustenta.
Depois de mover: rode `node testes/regras.mjs` e o teste de navegador.
Se um contrato marcado "só documentado" estiver na área tocada, confira à mão e,
de preferência, escreva o teste que faltava — é assim que esta coluna encolhe.

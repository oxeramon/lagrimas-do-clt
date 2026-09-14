/* Previsto × realizado: onde as duas metades do produto se encontram sem se
 * somar.
 *
 * A regra central, e ela é a única coisa que impede o app de contar dinheiro
 * duas vezes:
 *
 *     Compromisso liquidado deixa de ser previsto e passa a ser realizado.
 *     Ele aparece num lado OU no outro. Nunca nos dois.
 *
 * "Liquidado" aqui significa: existe linha em `liquidacoes` ligando o
 * compromisso, naquela competência, a uma transação. A transação já está no
 * realizado; somar o compromisso de novo dobraria o valor.
 *
 * Existe um terceiro estado, e ignorá-lo seria mentir: o compromisso marcado
 * como pago no quadradinho da V1, sem escolher conta. Ele NÃO tem movimento
 * correspondente. Contá-lo como realizado inventaria uma saída que nunca
 * existiu; contá-lo como previsto diria que ainda falta pagar algo que a
 * pessoa já pagou. Então ele vai para uma caixa própria, com nome próprio.
 *
 * Nada aqui toca DOM nem banco.
 */
import { contaNoSaldo, semTransferencias } from "./transactions.js";
import { consumoDe, caixaDe, ehEstornoDeEntrada } from "./cards.js";

export const ABERTO = "aberto";
export const LIQUIDADO = "liquidado";
export const PAGO_SEM_MOVIMENTO = "pago_sem_movimento";

/* A chave de um compromisso é (item_id, competência) -- não o item sozinho.
   Uma dívida de 24 parcelas é UMA linha e vinte e quatro obrigações. */
export const chaveDe = (itemId, competencia) => itemId + "@" + competencia;

export function indiceDeLiquidacoes(liquidacoes){
  const fora = new Map();
  for (const l of (liquidacoes || [])) fora.set(chaveDe(l.itemId, l.competencia), l);
  return fora;
}

/* Em que estado está este compromisso, neste mês?
 *
 * A ordem das perguntas importa: liquidado é mais forte que marcado, porque
 * toda liquidação cria a marca -- mas nem toda marca vem de liquidação. */
export function estadoDoCompromisso(itemId, competencia, liquidados, pagos){
  if (liquidados.has(chaveDe(itemId, competencia))) return LIQUIDADO;
  if (pagos && pagos[competencia] && pagos[competencia][itemId] === true) return PAGO_SEM_MOVIMENTO;
  return ABERTO;
}

/* ------------------------------------------------------------------ saídas --
   `compromissos` é o que a V1 já sabe montar: cada item do mês com `id` na
   MESMA convenção do vínculo (`<uuid>` da dívida, `fx:<uuid>` da fixa). */
export function saidasDoMes({ compromissos, transacoes, liquidacoes, pagos, mes }){
  const liquidados = indiceDeLiquidacoes(liquidacoes);
  const caixas = { aberto: 0, liquidado: 0, pagoSemMovimento: 0,
                   itens: { aberto: [], liquidado: [], pagoSemMovimento: [] } };

  for (const c of (compromissos || [])){
    const estado = estadoDoCompromisso(c.id, mes, liquidados, pagos);
    const valor = Number(c.valor) || 0;
    if (estado === LIQUIDADO){ caixas.liquidado += valor; caixas.itens.liquidado.push(c); }
    else if (estado === PAGO_SEM_MOVIMENTO){
      caixas.pagoSemMovimento += valor; caixas.itens.pagoSemMovimento.push(c);
    } else { caixas.aberto += valor; caixas.itens.aberto.push(c); }
  }

  /* O movimento vem das transações, e não da soma dos compromissos liquidados.
     São quase sempre o mesmo número -- e "quase" é o motivo: a pessoa pode ter
     pago um valor diferente do previsto, e quem manda no extrato é o extrato.
     Transferência fica de fora: ela não é despesa, só muda de gaveta.

     ISTO É CAIXA, e caixa exige conta: `saiDoCaixa` pede `contaId`. Compra no
     cartão não tem conta nenhuma -- quando ela acontece, nenhum dinheiro saiu
     de lugar nenhum, e contá-la aqui somaria a compra ao pagamento da fatura
     mais tarde. É o CASO A do contrato, visto do Painel. */
  const lista = semTransferencias(transacoes || []);
  const movimento = caixaDe(lista);

  /* A outra pergunta, que NÃO se soma à de cima: quanto foi consumido. Aqui a
     compra no cartão entra e o pagamento da fatura não, exatamente ao
     contrário do caixa. Ver docs/CONTRATO_CARTAO.md. */
  const consumo = consumoDe(lista);

  return {
    previsto: caixas.aberto,
    realizado: movimento,
    consumo,
    pagoSemMovimento: caixas.pagoSemMovimento,
    liquidado: caixas.liquidado,
    itens: caixas.itens,
    /* O total que a pessoa se comprometeu a pagar no mês, venha de onde vier.
       Este é o número que NÃO pode ser somado ao realizado. */
    comprometido: caixas.aberto + caixas.liquidado + caixas.pagoSemMovimento,
  };
}

/* ---------------------------------------------------------------- entradas --
   Receita prevista só afeta o saldo quando é recebida. Antes disso ela é
   expectativa, e expectativa não paga boleto. */
export function entradasDoMes({ receitas, transacoes, liquidacoes, mes }){
  const liquidados = indiceDeLiquidacoes(liquidacoes);
  let aReceber = 0, recebidoPrevisto = 0;
  const itens = { aReceber: [], recebido: [] };

  for (const r of (receitas || [])){
    const valor = Number(r.valor) || 0;
    if (liquidados.has(chaveDe(r.id, mes))){
      recebidoPrevisto += valor; itens.recebido.push(r);
    } else {
      aReceber += valor; itens.aReceber.push(r);
    }
  }

  /* Simétrico da saída: entrada só é caixa quando caiu numa conta, e o
     estorno de uma entrada (que é uma saída) desconta dela. Sem isso, um
     recebimento devolvido continuaria contando como recebido. */
  const soEntradas = semTransferencias(transacoes || []);
  const movimento =
    soEntradas.filter((t) => t.tipo === "entrada" && t.natureza === "normal"
                             && t.contaId && contaNoSaldo(t))
      .reduce((s, t) => s + Number(t.valor || 0), 0)
    - soEntradas.filter((t) => ehEstornoDeEntrada(t) && t.contaId)
      .reduce((s, t) => s + Number(t.valor || 0), 0);

  return { previsto: aReceber, realizado: movimento, recebidoPrevisto, itens };
}

/* ----------------------------------------------------------------- resumo --
   Os números que o Painel mostra lado a lado. Repare no que NÃO existe aqui:
   nenhum campo que some previsto com realizado.

   SOBRA É FLUXO, SALDO É ESTOQUE, e este resumo devolve os dois com nomes que
   dizem qual é qual. O contrato está em `docs/CONTRATO_SOBRA.md`.

   Existia aqui um campo `sobraProjetada` que valia `saldo + previstas`. A
   expressão estava certa e o nome errado: aquilo é o SALDO do dia 30, não o
   que o mês produziu. Com 10.000 em conta e um mês que entra 3.000 e sai
   3.000, ele dizia "sobra projetada 10.000"; o mês sobrou zero.

   O nome foi APOSENTADO em vez de reaproveitado. Reaproveitar mudaria o
   sentido de um número sem mudar o nome dele, e é assim que um defeito
   atravessa uma revisão sem ninguém ver. Quem lia `sobraProjetada` agora
   quebra, e quebrar é a intenção. */
export function resumoDoMes(entrada){
  const s = saidasDoMes(entrada);
  const e = entradasDoMes(entrada);

  const realizada = e.realizado - s.realizado;
  const prevista = e.previsto - s.previsto;

  /* Sem NENHUMA entrada no mês, nem realizada nem prevista, a sobra não é
     zero: é desconhecida. Zero afirmaria "este mês não produz nada"; num app
     recém-instalado a verdade é "ainda não sei". A diferença decide se toda
     meta com prazo nasce marcada em risco no primeiro minuto de uso. */
  const semReferencia = e.realizado === 0 && e.previsto === 0;

  return {
    saidas: s,
    entradas: e,
    /* o que já aconteceu de verdade, pelas transações */
    resultadoRealizado: realizada,
    /* o que ainda deve acontecer, pelo planejamento */
    aindaEntra: e.previsto,
    aindaSai: s.previsto,

    /* A SOBRA DO MÊS, nas três leituras que não se confundem. */
    sobra: { realizada, prevista, projetada: realizada + prevista, semReferencia },

    /* O SALDO no fim do mês. Parte do saldo de HOJE e soma só o que ainda
       FALTA acontecer: o realizado do mês já está dentro do saldo, e somá-lo
       de novo contaria duas vezes. Por isso é `prevista`, e nunca
       `projetada`. */
    saldoProjetado: (Number(entrada.saldoEmContas) || 0) + prevista,

    /* aderência: quanto do previsto do mês já virou movimento */
    aderencia: s.comprometido > 0 ? (s.liquidado + s.pagoSemMovimento) / s.comprometido : null,
  };
}

/* Compromissos em aberto cuja data de vencimento já passou. A V1 não guarda dia
   de vencimento por item, só o mês, então "atrasado" aqui é o mês fechado --
   e o nome diz isso, em vez de fingir precisão que o dado não tem. */
export function mesesEmAtraso(compromissos, liquidacoes, pagos, mesAtual, meses){
  const liquidados = indiceDeLiquidacoes(liquidacoes);
  const fora = [];
  for (const m of (meses || [])){
    if (m >= mesAtual) continue;
    for (const c of (compromissos || [])){
      if (estadoDoCompromisso(c.id, m, liquidados, pagos) === ABERTO)
        fora.push({ ...c, competencia: m });
    }
  }
  return fora;
}

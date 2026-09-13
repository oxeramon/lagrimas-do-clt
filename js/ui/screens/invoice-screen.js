/* O DIÁLOGO DA FATURA.
 *
 * Separado da tela de Cartões porque aqui é onde o dinheiro se move: pagar a
 * fatura é saída de caixa, e a compra que a formou já foi consumo. Somar os
 * dois conta o mesmo dinheiro duas vezes -- ver docs/CONTRATO_CARTAO.md.
 */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { rotuloDaFatura } from "../../domain/cards.js";
import { V2, dep, recarrega, cartaoPorId, opcoesDeConta } from "./estado.js";
import { listaDeOpcoes, confirmaEmDoisCliques, mostraErro, hojeISO,
         diaLegivel } from "./pecas.js";
import * as v2 from "../../data/v2-repository.js";

/* ------------------------------------------------------------- fatura --*/
let faturaAberta = null;

/* Quanto ainda falta. Vem da view (`restante`), com piso em zero: um estorno
   lançado DEPOIS do pagamento reduz o devido e pode deixar o pago acima dele,
   e "falta −50" não é uma frase que alguém precise ler. */
const quantoFalta = (f) =>
  Math.max(0, Number(f.restante ?? (Number(f.total || 0) - Number(f.pago || 0))));

export async function abreFatura(id){
  const f = V2.faturas.find((x) => x.faturaId === id);
  if (!f) return;
  faturaAberta = f;
  const c = cartaoPorId(f.cartaoId);
  const falta = quantoFalta(f);
  /* "paga" é a situação que a VIEW deriva. Aqui quem decide se ainda cabe pagar
     é quanto FALTA -- e fatura vazia não é fatura quitada, distinção que a view
     já faz e que esta tela não precisa repetir. */
  const quitada = falta <= 0;

  $("ftTitulo").textContent = c ? c.nome : "Fatura";
  $("ftResumo").textContent = rotuloDaFatura(f) + " · " + f.itens
    + (f.itens === 1 ? " lançamento" : " lançamentos");

  $("ftSaldo").hidden = false;
  $("ftTotal").textContent    = money(f.total || 0);
  $("ftPago").textContent     = money(f.pago || 0);
  $("ftRestante").textContent = money(falta);

  mostraErro($("ftErro"), "");
  $("ftPagar").hidden = quitada;
  $("ftPagarBtn").hidden = quitada;

  if (!quitada){
    const padrao = c && c.contaPadraoId ? c.contaPadraoId : "";
    $("ft_conta").innerHTML = listaDeOpcoes(
      V2.contas.filter((x) => x.ativo !== false).map((x) => ({ id: x.id, rotulo: x.nome })),
      padrao, "");
    /* O padrão é o que FALTA, não o total: numa fatura já parcialmente paga,
       propor o total é propor um valor que o banco vai recusar. */
    $("ft_valor").value = falta.toFixed(2);
    $("ft_data").value = hojeISO();
    /* O que o produto sabe e o que ele não sabe, dito ANTES do clique. Pagar
       menos passou a ser aceito; o que continua não existindo é projeção de
       juros, e isso não se esconde. */
    $("ftAviso").hidden = false;
    $("ftAviso").textContent = Number(f.pago || 0) > 0
      ? "Você pode pagar o que falta de uma vez ou em partes. Juros de rotativo não são projetados."
      : "Dá para pagar menos que o total. O resto fica em aberto, e juros de rotativo não são projetados.";
  }

  $("ftItens").innerHTML = '<p class="hint">Carregando os lançamentos…</p>';
  $("ftPagamentos").innerHTML = "";
  $("dlgFatura").showModal();

  const r = await v2.itensDaFatura(id);
  if (r.erro){ $("ftItens").innerHTML = '<p class="hint">Não deu para carregar os lançamentos.</p>'; return; }
  const itens = r.dados || [];
  $("ftItens").innerHTML = itens.length
    ? '<div class="fatura-itens">' + itens.map((t) =>
        '<div class="row"><div class="desc"><b>' + esc(t.descricao) + '</b>'
        + '<span class="meta">' + esc(diaLegivel(t.data))
        + (t.parcela ? ' · parcela ' + t.parcela + ' de ' + t.totalParcelas : '')
        + '</span></div><div class="amt">' + money(t.valor) + '</div></div>').join("")
      + '</div>'
    : '<p class="hint">Nenhum lançamento nesta fatura.</p>';

  await desenhaPagamentos(id);
}

/* A lista dos pagamentos já feitos, cada um com o próprio "desfazer".
   Desfazer passou a ser POR PAGAMENTO: o botão único de antes chamava
   `desfaz_liquidacao`, que apaga a liquidação da competência inteira -- numa
   fatura com três pagamentos ela apagaria os três, e quem clicou queria um. */
async function desenhaPagamentos(faturaId){
  const r = await v2.pagamentosDaFatura(faturaId);
  if (r.erro){
    $("ftPagamentos").innerHTML = '<p class="hint">Não deu para carregar os pagamentos.</p>';
    return;
  }
  const pagos = r.dados || [];
  if (!pagos.length){ $("ftPagamentos").innerHTML = ""; return; }

  /* A data que se mostra é a do PAGAMENTO, não a do registro: quem pagou dia 5
     e lançou dia 12 quer ler 5. Ela mora na transação, e o vínculo aponta para
     ela. Sem a transação carregada, some o "em ..." em vez de inventar data. */
  const dataDoPagamento = (p) => {
    const t = V2.transacoes.find((x) => x.id === p.transacaoId);
    return t && t.data ? diaLegivel(t.data) : "";
  };

  $("ftPagamentos").innerHTML = '<h3 class="sub-titulo">'
    + (pagos.length === 1 ? "Pagamento" : "Pagamentos") + '</h3>'
    + '<div class="fatura-itens">' + pagos.map((p) =>
        '<div class="row"><div class="desc"><b>' + money(p.valor) + '</b>'
        + '<span class="meta">' + esc(dataDoPagamento(p))
        + '</span></div>'
        + '<div class="amt"><button type="button" class="btn ghost sm" '
        + 'data-desfaz="' + esc(p.transacaoId) + '">Desfazer</button></div></div>').join("")
      + '</div>';

  for (const botao of $("ftPagamentos").querySelectorAll("[data-desfaz]"))
    confirmaEmDoisCliques(botao, "Desfazer", async () => {
      const r2 = await v2.desfazPagamentoDeFatura(botao.getAttribute("data-desfaz"));
      if (r2.erro) return mostraErro($("ftErro"), r2.erro);
      $("dlgFatura").close();
      dep.toast("Pagamento desfeito.");
      await recarrega();
    });
}

export function ligaFatura(){
  $("ftPagarBtn")?.addEventListener("click", async () => {
    if (!faturaAberta) return;
    const contaId = $("ft_conta").value;
    const valor = Number($("ft_valor").value);
    const data = $("ft_data").value;
    if (!contaId) return mostraErro($("ftErro"), "Escolha a conta.");
    if (!(valor > 0)) return mostraErro($("ftErro"), "O valor precisa ser maior que zero.");
    if (!data) return mostraErro($("ftErro"), "Escolha a data.");
    $("ftPagarBtn").disabled = true;
    const r = await v2.pagaFatura({ faturaId: faturaAberta.faturaId, contaId, valor, data });
    $("ftPagarBtn").disabled = false;
    if (r.erro) return mostraErro($("ftErro"), r.erro);
    $("dlgFatura").close();
    /* "Fatura paga" seria mentira num pagamento parcial, e mentira sobre
       dinheiro é o defeito que este produto mais evita. */
    const restava = quantoFalta(faturaAberta);
    dep.toast(valor >= restava ? "Fatura paga." : "Pagamento registrado.");
    await recarrega();
  });

  /* O "Desfazer o pagamento" único saiu do rodapé do diálogo. Ele chamava
     `removeTransacao(faturaAberta.pagamentoId)`, e desde a 012 a view não tem
     mais `pagamento_id`: uma fatura recebe N pagamentos, e não há UM id que a
     represente. Agora cada pagamento traz o próprio botão, em
     `desenhaPagamentos()`. */
}


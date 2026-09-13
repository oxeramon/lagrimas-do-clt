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

export async function abreFatura(id){
  const f = V2.faturas.find((x) => x.faturaId === id);
  if (!f) return;
  faturaAberta = f;
  const c = cartaoPorId(f.cartaoId);
  const paga = f.situacao === "paga";

  $("ftTitulo").textContent = c ? c.nome : "Fatura";
  $("ftResumo").textContent = rotuloDaFatura(f) + " · " + money(f.total)
    + " em " + f.itens + (f.itens === 1 ? " lançamento" : " lançamentos")
    + (paga ? " · paga com " + money(f.pago) : "");
  mostraErro($("ftErro"), "");
  $("ftPagar").hidden = paga;
  $("ftPagarBtn").hidden = paga;
  $("ftDesfazer").hidden = !paga;

  if (!paga){
    const padrao = c && c.contaPadraoId ? c.contaPadraoId : "";
    $("ft_conta").innerHTML = listaDeOpcoes(
      V2.contas.filter((x) => x.ativo !== false).map((x) => ({ id: x.id, rotulo: x.nome })),
      padrao, "");
    $("ft_valor").value = Number(f.total || 0).toFixed(2);
    $("ft_data").value = hojeISO();
    /* Pagamento parcial está fora desta rodada, de propósito. A tela diz isso
       ANTES do clique, e não depois da recusa do banco. */
    $("ftAviso").hidden = false;
    $("ftAviso").textContent = "O pagamento é integral: o app ainda não sabe calcular juros de "
      + "rotativo, e um número errado com cara de certo é pior que número nenhum.";
  }

  $("ftItens").innerHTML = '<p class="hint">Carregando os lançamentos…</p>';
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
    dep.toast("Fatura paga.");
    await recarrega();
  });

  const desfazer = $("ftDesfazer");
  /* Desfazer apaga o lançamento do pagamento. O vínculo vai junto pelo
     cascade, e a fatura volta para "a pagar" sozinha -- a situação é derivada,
     não guardada. */
  if (desfazer) confirmaEmDoisCliques(desfazer, "Desfazer o pagamento", async () => {
    if (!faturaAberta || !faturaAberta.pagamentoId) return;
    const r = await v2.removeTransacao(faturaAberta.pagamentoId);
    if (r.erro) return mostraErro($("ftErro"), r.erro);
    $("dlgFatura").close();
    dep.toast("Pagamento desfeito.");
    await recarrega();
  });
}


/* O DIÁLOGO DE ESTORNO · dinheiro que voltou.
 *
 * Módulo próprio, e não um pedaço da tela de Transações, porque estornar não é
 * editar: editar muda o que ESTÁ escrito, estornar registra um fato novo. As
 * duas linhas coexistem no histórico, e é essa coexistência que faz o relatório
 * por categoria fechar em zero quando o dinheiro volta inteiro.
 *
 * O contrato está em `docs/CONTRATO_ESTORNO.md` e o banco é quem o garante (a
 * 010). Esta tela existe para a pessoa saber ANTES do clique: o que já voltou,
 * o que ainda cabe, e -- quando não cabe estornar -- qual é a operação certa.
 *
 * NÃO INVENTA NADA QUE O CONTRATO NÃO PERMITA. Parcial: o contrato permite,
 * então a tela permite. Vários: o contrato permite, então há histórico. Estorno
 * de transferência, de pagamento de fatura ou de estorno: o contrato proíbe, e
 * a tela explica em vez de inventar um jeito.
 */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { podeEstornar, jaEstornado, saldoEstornavel, estornosDe }
  from "../../domain/reversal.js";
import { V2, dep, recarrega, contaPorId } from "./estado.js";
import { mostraErro, hojeISO, diaLegivel } from "./pecas.js";
import * as v2 from "../../data/v2-repository.js";

let estornando = null;

/* O índice de vínculos da ponte, como Set de id de transação. Uma transação
   que liquidou um compromisso da V1 não se estorna: o compromisso continuaria
   quitado. Ver LIQUIDACAO no domínio. */
const vinculadas = () => new Set((V2.liquidacoes || []).map((l) => l.transacaoId));

/* A pergunta que a tela de Transações faz para decidir se mostra o botão. */
export const estornavel = (t) => podeEstornar(t, vinculadas()).pode;

export function abreEstorno(transacaoId){
  const t = V2.transacoes.find((x) => x.id === transacaoId);
  const veredito = podeEstornar(t, vinculadas());
  estornando = t || null;

  mostraErro($("esErro"), "");
  if (!t) return;

  const conta = contaPorId(t.contaId);
  $("esOriginal").textContent = t.descricao
    + " · " + diaLegivel(t.data)
    + (conta ? " · " + conta.nome : "");

  /* IMPEDIDO: o diálogo abre mesmo assim, e diz por quê. Botão que some sem
     explicação faz a pessoa achar que o app quebrou -- e aqui há uma resposta
     útil para dar, que é qual operação usar no lugar. */
  if (!veredito.pode){
    $("esSaldo").hidden = true;
    $("esForm").hidden = true;
    $("esHistorico").innerHTML = "";
    $("esConfirmar").hidden = true;
    $("esImpedido").hidden = false;
    $("esImpedido").textContent = veredito.porque
      + (veredito.caminho ? " " + veredito.caminho : "");
    $("dlgEstorno").showModal();
    return;
  }

  const ja = jaEstornado(t, V2.transacoes);
  const cabe = saldoEstornavel(t, V2.transacoes);

  $("esImpedido").hidden = true;
  $("esSaldo").hidden = false;
  $("esValor").textContent = money(t.valor);
  $("esJa").textContent    = money(ja);
  $("esCabe").textContent  = money(cabe);

  const acabou = cabe <= 0;
  $("esForm").hidden = acabou;
  $("esConfirmar").hidden = acabou;
  if (acabou){
    $("esImpedido").hidden = false;
    $("esImpedido").textContent = "Este lançamento já voltou por inteiro.";
  } else {
    /* O padrão é o que CABE, não o valor cheio: num segundo estorno, propor o
       cheio é propor um valor que o banco recusa. */
    $("es_valor").value = cabe.toFixed(2);
    $("es_valor").max = String(cabe);
    $("es_data").value = hojeISO();
    $("es_obs").value = "";
  }

  /* O histórico só aparece quando há o que contar. Bloco vazio ocupa espaço e
     não informa nada. */
  const anteriores = estornosDe(t, V2.transacoes);
  $("esHistorico").innerHTML = anteriores.length
    ? '<h3 class="sub-titulo">'
      + (anteriores.length === 1 ? "Estorno já registrado" : "Estornos já registrados")
      + '</h3><div class="fatura-itens">'
      + anteriores.map((e) =>
          '<div class="row"><div class="desc"><b>' + money(e.valor) + '</b>'
          + '<span class="meta">' + esc(diaLegivel(e.data))
          + (e.obs ? ' · ' + esc(e.obs) : '') + '</span></div></div>').join("")
      + '</div>'
    : "";

  $("dlgEstorno").showModal();
}

export function ligaEstorno(){
  $("trEstornar")?.addEventListener("click", () => {
    const id = $("trEstornar").getAttribute("data-tx");
    $("dlgTransacao").close();
    if (id) abreEstorno(id);
  });

  $("esConfirmar")?.addEventListener("click", async () => {
    if (!estornando) return;
    const valor = Number($("es_valor").value);
    const data = $("es_data").value;
    const cabe = saldoEstornavel(estornando, V2.transacoes);

    if (!(valor > 0)) return mostraErro($("esErro"), "O valor precisa ser maior que zero.");
    /* A tela recusa antes de tentar, com o número na frente. O banco recusaria
       de qualquer jeito -- mas depois do clique, e com a mensagem dele. */
    if (valor > cabe)
      return mostraErro($("esErro"),
        "Cabe estornar " + money(cabe) + ", e você lançou " + money(valor) + ".");
    if (!data) return mostraErro($("esErro"), "Escolha a data.");

    $("esConfirmar").disabled = true;
    const r = await v2.estornaTransacao({
      transacaoId: estornando.id,
      /* total vira null, para o banco decidir o valor cheio sem a tela ter de
         saber dele -- um centavo de arredondamento aqui viraria discordância */
      valor: valor >= cabe ? null : valor,
      data,
      obs: $("es_obs").value.trim(),
    });
    $("esConfirmar").disabled = false;
    if (r.erro) return mostraErro($("esErro"), r.erro);

    $("dlgEstorno").close();
    dep.toast(valor >= cabe ? "Estorno registrado." : "Estorno parcial registrado.");
    await recarrega();
  });
}

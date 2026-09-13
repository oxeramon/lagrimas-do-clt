/* A PONTE COM A V1: pagar e receber.
 *
 * Um diálogo só para as duas ações. O que muda entre elas é o sinal, o rótulo e
 * a RPC -- e três diferenças não pagam dois formulários quase iguais, que
 * envelheceriam separados.
 *
 * Nada aqui decide se o compromisso existe: quem valida é a RPC, lendo com o
 * RLS ligado, e compromisso de outra pessoa simplesmente não é encontrado.
 * Ver docs/CONTRATO_PONTE.md.
 */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { MES_LONGO, midx, fromIdx } from "../../core/dates.js";
import { categoriasPorFluxo, caminhoDaCategoria } from "../../domain/categories.js";
import { indiceDeLiquidacoes } from "../../domain/reconciliation.js";
import { V2, dep, recarrega, contaPorId, opcoesDeConta } from "./estado.js";
import { listaDeOpcoes, confirmaEmDoisCliques, mostraErro, hojeISO } from "./pecas.js";
import * as v2 from "../../data/v2-repository.js";

/* ==================================================================
   PONTE COM A V1: PAGAR E RECEBER
   ==================================================================
   Um diálogo só para as duas ações. O que muda entre elas é o sinal, o rótulo
   e a RPC -- e três diferenças não pagam dois formulários quase iguais, que
   envelheceriam separados.

   Nada aqui decide se o compromisso existe: quem valida é a RPC, lendo com o
   RLS ligado, e compromisso de outra pessoa simplesmente não é encontrado.
   Ver docs/CONTRATO_PONTE.md. */

/* O alvo do diálogo aberto: { tipo, itemId, competencia, nome, valor }. */
let liquidando = null;

/* Quem desenha a lista da V1 monta o índice UMA vez e consulta por linha.
   Montar por linha seria O(n) dentro de O(n). */
export const indiceDaPonte = () => indiceDeLiquidacoes(V2.liquidacoes);

/* A ponte só se oferece quando há conta para escolher E quando os vínculos
   chegaram. Sem vínculo carregado a tela não sabe o que já foi liquidado;
   oferecer "Pagar" ali seria convidar a pagar de novo. O banco recusaria pela
   `unique`, mas o convite já teria sido feito, e recusa depois do clique é
   exatamente o defeito que a transferência tinha. */
export const pontePronta = () => V2.carregado && !V2.erroPonte && V2.contas.length > 0;

/* A transação que liquidou este compromisso, se houver. */
export function vinculoDe(itemId, competencia){
  return V2.liquidacoes.find((l) => l.itemId === itemId && l.competencia === competencia) || null;
}
export function contaDoVinculo(vinculo){
  if (!vinculo) return null;
  const t = V2.transacoes.find((x) => x.id === vinculo.transacaoId);
  return t ? contaPorId(t.contaId) : null;
}

function ehReceita(alvo){ return alvo && alvo.tipo === "receita"; }

export function abreLiquidacao(alvo){
  if (!pontePronta()) return;
  liquidando = alvo;
  const receita = ehReceita(alvo);
  const vinculo = vinculoDe(alvo.itemId, alvo.competencia);

  $("lqTitulo").textContent = receita ? "Receber" : "Pagar";
  $("lqSalvar").textContent = receita ? "Receber" : "Pagar";
  $("lqRotConta").textContent = receita ? "Em qual conta caiu" : "De qual conta saiu";
  mostraErro($("lqErro"), "");

  /* Já liquidado: não há o que preencher, só o que desfazer. Mostrar os campos
     preenchidos daria a impressão de que editar ali muda alguma coisa. */
  $("lqCampos").hidden = !!vinculo;
  $("lqSalvar").hidden = !!vinculo;
  $("lqDesfazer").hidden = !vinculo;

  if (vinculo){
    const conta = contaDoVinculo(vinculo);
    $("lqSobre").innerHTML = esc(alvo.nome) + " · " + esc(labelLongDoMes(alvo.competencia))
      + "<br>" + (receita ? "Recebido" : "Pago") + " " + money(vinculo.valor)
      + (conta ? " em " + esc(conta.nome) : "")
      + ".<br>Desfazer apaga o lançamento"
      + (receita ? "." : " e desmarca o compromisso.");
    $("dlgLiquidar").showModal();
    return;
  }

  $("lqSobre").innerHTML = esc(alvo.nome) + " · " + esc(labelLongDoMes(alvo.competencia))
    + "<br>" + (receita
        ? "A receita vira entrada na conta. Enquanto não entra, ela é previsão."
        : "O compromisso vira saída na conta e sai do que ainda falta pagar. Ele conta de um lado só.");

  $("lq_conta").innerHTML = listaDeOpcoes(
    V2.contas.filter((c) => c.ativo !== false).map((c) => ({ id: c.id, rotulo: c.nome })), "", "");
  $("lq_categoria").innerHTML = listaDeOpcoes(
    categoriasPorFluxo(V2.categorias, receita ? "entrada" : "saida")
      .map((c) => ({ id: c.id, rotulo: caminhoDaCategoria(V2.categorias, c.id) })), "", "Sem categoria");
  $("lq_valor").value = Number(alvo.valor || 0).toFixed(2);
  $("lq_data").value = hojeISO();
  $("lq_obs").value = "";
  $("dlgLiquidar").showModal();
}

/* "2026-09" -> "setembro de 2026", sem importar o label da V1: este módulo não
   conhece o `index.html`, e a data já vem em texto. */
function labelLongDoMes(mes){
  const i = midx(mes);
  return MES_LONGO[i % 12] + " de " + fromIdx(i).slice(0, 4);
}

async function confirmaLiquidacao(){
  if (!liquidando) return;
  const receita = ehReceita(liquidando);
  const contaId = $("lq_conta").value;
  const valor = Number($("lq_valor").value);
  const data = $("lq_data").value;

  if (!contaId) return mostraErro($("lqErro"), "Escolha a conta.");
  if (!(valor > 0)) return mostraErro($("lqErro"), "O valor precisa ser maior que zero.");
  if (!data) return mostraErro($("lqErro"), "Escolha a data.");

  const comum = {
    competencia: liquidando.competencia, contaId, valor, data,
    descricao: liquidando.nome,
    categoriaId: $("lq_categoria").value || null,
    obs: $("lq_obs").value.trim(),
  };
  $("lqSalvar").disabled = true;
  const r = receita
    ? await v2.recebeReceita({ ...comum, receitaId: liquidando.itemId })
    : await v2.liquidaCompromisso({ ...comum, tipo: liquidando.tipo, itemId: liquidando.itemId });
  $("lqSalvar").disabled = false;

  if (r.erro) return mostraErro($("lqErro"), r.erro);
  const alvo = liquidando;
  $("dlgLiquidar").close();
  dep.toast(receita ? "Recebido." : "Pago.");
  /* A RPC criou a marca da V1 junto, na mesma transação. A tela da V1 precisa
     saber disso sem ir ao banco de novo. */
  await avisaAPonte(alvo, !receita);
}

async function desfazLiquidacaoAqui(){
  if (!liquidando) return;
  const alvo = liquidando;
  const r = await v2.desfazLiquidacao({ tipo: alvo.tipo, itemId: alvo.itemId, competencia: alvo.competencia });
  if (r.erro) return mostraErro($("lqErro"), r.erro);
  $("dlgLiquidar").close();
  dep.toast("Desfeito.");
  await avisaAPonte(alvo, ehReceita(alvo) ? null : false);
}

/* Recarrega a V2 e devolve à V1 o que mudou do lado dela. `marcado` é `null`
   quando não houve marca nenhuma em jogo -- receita não entra em `pagamentos`,
   porque receita não é pagamento. */
async function avisaAPonte(alvo, marcado){
  await recarrega();
  if (dep.pontemudou) dep.pontemudou({
    competencia: alvo.competencia, itemId: alvo.itemId, marcado,
  });
}

export function ligaLiquidacao(){
  $("formLiquidar")?.addEventListener("submit", (e) => { e.preventDefault(); confirmaLiquidacao(); });
  const btn = $("lqDesfazer");
  /* Desfazer apaga um lançamento: dois cliques no mesmo botão, como todo o
     resto do app. Aqui o rótulo de volta é "Desfazer", não "Excluir". */
  if (btn) confirmaEmDoisCliques(btn, "Desfazer", desfazLiquidacaoAqui);
}


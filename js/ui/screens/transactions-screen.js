/* TELA DE TRANSAÇÕES: a lista do mês, o lançamento e a navegação entre meses. */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { MES_LONGO, midx, fromIdx } from "../../core/dates.js";
import { filtraTransacoes, totaisDoPeriodo, agrupaPorData, gastoPorCategoria,
         semTransferencias, ehTransferencia, rotuloDoStatus }
  from "../../domain/transactions.js";
import { categoriasPorFluxo, caminhoDaCategoria } from "../../domain/categories.js";
import { V2, dep, recarrega, contaPorId, opcoesDeConta, carregaTransacoesDoMes }
  from "./estado.js";
import { listaDeOpcoes, confirmaEmDoisCliques, mostraErro, pirulitos, hojeISO,
         diaLegivel } from "./pecas.js";
import { abreTransferencia } from "./transfer-dialog.js";
import * as v2 from "../../data/v2-repository.js";

const filtros = { busca: "", contaId: "", categoriaId: "", tipo: "", status: "" };

const ICO = {
  entrada: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  saida:   '<path d="M12 5v14M5 12l7 7 7-7"/>',
  transferencia: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
  estorno: '<path d="M3 12a9 9 0 109-9"/><path d="M3 4v8h8"/>',
};

export function renderTransacoes(){
  const temConta = V2.contas.length > 0;
  $("txSemConta").hidden = temConta;
  $("txConteudo").hidden = !temConta;
  if (!temConta) return;

  $("txMesAtual").textContent = MES_LONGO[midx(V2.mes) % 12] + " de " + V2.mes.slice(0, 4);
  $("txTituloMes").textContent = "Movimentações";

  const lista = filtraTransacoes(V2.transacoes, filtros);
  const semTr = semTransferencias(lista);
  const t = totaisDoPeriodo(semTr);
  $("txEntradas").textContent = money(t.entradas);
  $("txSaidas").textContent   = money(t.saidas);
  $("txPrevisto").textContent = money(t.previstas);
  $("txResultado").textContent = money(t.resultado);
  $("txPiada").textContent = t.resultado < 0
    ? "Saiu mais do que entrou. O boleto sabe que dia é."
    : "Entrou mais do que saiu. Aproveite a sensação.";

  const dias = agrupaPorData(lista);
  if (!dias.length){
    $("txLista").innerHTML = `<div class="vazio"><div class="emoji" aria-hidden="true">🍃</div>
      <h3>Nada neste recorte</h3>
      <p>Nenhum lançamento com esses filtros. Ou o mês foi tranquilo, ou o filtro está apertado demais.</p></div>`;
    $("txCardCategorias").hidden = true;
    return;
  }

  $("txLista").innerHTML = dias.map((d) => `
    <section class="dia">
      <div class="dia-cab"><h3>${esc(diaLegivel(d.data))}</h3>
        <span class="tot">${d.total === 0 ? "" : money(d.total)}</span></div>
      <ul class="linhas">${d.itens.map(linhaDeLancamento).join("")}</ul>
    </section>`).join("");

  const gastos = gastoPorCategoria(lista, V2.categorias);
  $("txCardCategorias").hidden = gastos.length === 0;
  pirulitos($("txPorCategoria"), gastos.map((g) => ({ rotulo: g.nome, valor: g.total, cor: g.cor })));
}

function linhaDeLancamento(t){
  const conta = contaPorId(t.contaId);
  const cat = t.categoriaId ? caminhoDaCategoria(V2.categorias, t.categoriaId) : "";
  const ico = ICO[t.natureza === "normal" ? t.tipo : t.natureza] || ICO[t.tipo];
  const sinal = t.tipo === "entrada" ? "+" : "−";
  const marca = t.status === "realizada" || t.status === "conciliada"
    ? "" : " · " + rotuloDoStatus(t.status);
  const sub = [conta ? conta.nome : "sem conta", cat].filter(Boolean).join(" · ") + marca;
  return `<li><button class="lanc" data-tx="${esc(t.id)}"
      data-tipo="${esc(t.tipo)}" data-natureza="${esc(t.natureza)}" data-status="${esc(t.status)}">
    <span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ico}</svg></span>
    <span style="min-width:0"><span class="desc">${esc(t.descricao)}</span>
      <span class="sub">${esc(sub)}</span></span>
    <span class="vlr">${sinal} ${money(Math.abs(Number(t.valor)))}</span>
  </button></li>`;
}


/* ----------------------------------------------------------- transações --*/
let txEditando = null;


function atualizaCategoriasDoForm(){
  const fluxo = $("tr_tipo").value === "entrada" ? "entrada" : "saida";
  const atual = $("tr_categoria").value;
  const lista = categoriasPorFluxo(V2.categorias, fluxo)
    .map((c) => ({ id: c.id, rotulo: caminhoDaCategoria(V2.categorias, c.id) }));
  $("tr_categoria").innerHTML = listaDeOpcoes(lista, atual, "Sem categoria");
}

function abreTransacao(id){
  txEditando = id || null;
  const t = id ? V2.transacoes.find((x) => x.id === id) : null;

  /* transferência não se edita por aqui: ela tem duas pernas, e mexer numa só
     quebraria o par. O botão manda para o diálogo próprio. */
  if (t && ehTransferencia(t)){ abreTransferencia(t.transferenciaId); return; }

  $("trTitulo").textContent = t ? "Editar lançamento" : "Lançar";
  $("tr_tipo").value = t ? t.tipo : "saida";
  $("tr_valor").value = t ? t.valor : "";
  $("tr_descricao").value = t ? t.descricao : "";
  $("tr_conta").innerHTML = opcoesDeConta(t ? t.contaId : (V2.contas[0] || {}).id);
  $("tr_data").value = t ? t.data : hojeISO();
  $("tr_status").value = t ? t.status : "realizada";
  $("tr_obs").value = t ? (t.obs || "") : "";
  atualizaCategoriasDoForm();
  if (t) $("tr_categoria").value = t.categoriaId || "";
  $("trExcluir").hidden = !t;

  const estorno = t && t.natureza === "estorno";
  $("trAviso").hidden = !estorno;
  if (estorno) $("trAviso").textContent =
    "Este lançamento é um estorno. O valor e o sentido dele acompanham o lançamento original.";
  mostraErro($("trErro"), "");
  $("dlgTransacao").showModal();
}

export function ligaTransacoes(){
  $("btnNovaTransacao")?.addEventListener("click", () => abreTransacao(null));
  $("btnFlutuante")?.addEventListener("click", () => abreTransacao(null));
  $("tr_tipo")?.addEventListener("change", atualizaCategoriasDoForm);
  $("txLista")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tx]");
    if (b) abreTransacao(b.getAttribute("data-tx"));
  });

  for (const [campo, chave] of [["txBusca","busca"],["txFiltroConta","contaId"],
       ["txFiltroCategoria","categoriaId"],["txFiltroTipo","tipo"],["txFiltroStatus","status"]]){
    $(campo)?.addEventListener("input", () => { filtros[chave] = $(campo).value; renderTransacoes(); });
  }

  $("txMesAnterior")?.addEventListener("click", () => trocaMes(-1));
  $("txMesProximo")?.addEventListener("click", () => trocaMes(+1));

  $("formTransacao")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("trSalvar"); btn.disabled = true;
    const modelo = {
      contaId: $("tr_conta").value || null,
      categoriaId: $("tr_categoria").value || null,
      tipo: $("tr_tipo").value,
      valor: Number($("tr_valor").value),
      data: $("tr_data").value,
      descricao: $("tr_descricao").value.trim(),
      status: $("tr_status").value,
      obs: $("tr_obs").value.trim(),
    };
    if (!txEditando){ modelo.natureza = "normal"; modelo.origem = "manual"; }
    const r = await v2.salvaTransacao(modelo, txEditando);
    btn.disabled = false;
    if (r.erro){ mostraErro($("trErro"), r.erro); return; }
    $("dlgTransacao").close();
    await recarrega();
    dep.toast(txEditando ? "Lançamento salvo" : "Lançado. O saldo já sabe.");
  });

  confirmaEmDoisCliques($("trExcluir"), "Excluir", async () => {
    const r = await v2.removeTransacao(txEditando);
    if (r.erro){ mostraErro($("trErro"), r.erro); return; }
    $("dlgTransacao").close();
    await recarrega();
    dep.toast("Lançamento excluído");
  });
}

/* O app inteiro fala de UM mês. Duas navegações de mês independentes -- uma
   aqui, outra na V1 -- fariam o Painel dizer setembro enquanto a lista dizia
   outubro, e ninguém repara nisso até somar errado.

   Esta função NÃO avisa a V1: ela é o lado que RECEBE o aviso. Quem avisa é
   `trocaMes`, logo abaixo -- e separar as duas é o que evita o laço infinito. */
export async function vaiParaMes(k){
  V2.mes = k;
  const r = await carregaTransacoesDoMes();
  if (r.erro){ dep.erro("Não deu para carregar o mês. " + r.erro); return { erro: r.erro }; }
  renderTransacoes();
  return { erro: null };
}

async function trocaMes(passo){
  const r = await vaiParaMes(fromIdx(midx(V2.mes) + passo));
  if (r && r.erro) return;
  if (dep.mudouDeMes) dep.mudouDeMes(V2.mes);
}


export function atualizaFiltrosDeTela(){
  const conta = $("txFiltroConta"), cat = $("txFiltroCategoria");
  if (conta) conta.innerHTML = listaDeOpcoes(V2.contas.map((c) => ({ id: c.id, rotulo: c.nome })),
    filtros.contaId, "Todas");
  if (cat) cat.innerHTML = listaDeOpcoes(V2.categorias.map((c) =>
    ({ id: c.id, rotulo: caminhoDaCategoria(V2.categorias, c.id) })), filtros.categoriaId, "Todas");
}


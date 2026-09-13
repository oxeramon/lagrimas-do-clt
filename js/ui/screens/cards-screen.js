/* TELA DE CARTÕES: o cadastro, o ciclo e a compra.
 *
 * A fatura tem módulo próprio (`invoice-screen.js`): ela é a operação de
 * dinheiro, e esta tela é o cadastro do instrumento. Consumo e caixa são coisas
 * diferentes no produto inteiro, e a separação dos arquivos segue a do modelo.
 */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { competenciaDaCompra, cicloDaFatura, rotuloDaFatura, parcelasDe,
         indicadoresDeCartoes, proximaAVencer, vencidas } from "../../domain/cards.js";
import { categoriasPorFluxo, caminhoDaCategoria } from "../../domain/categories.js";
import { V2, dep, recarrega, instPorId, cartaoPorId, faturasDoCartao,
         opcoesDeConta } from "./estado.js";
import { selo, listaDeOpcoes, confirmaEmDoisCliques, mostraErro, hojeISO,
         diaLegivel } from "./pecas.js";
import { abreFatura } from "./invoice-screen.js";
import * as v2 from "../../data/v2-repository.js";

/* ==================================================================
   CARTÕES E FATURAS
   ==================================================================
   O contrato está em docs/CONTRATO_CARTAO.md. A regra que governa cada linha
   daqui:

       Compra no cartão é despesa.
       Pagamento da fatura não é despesa nova.

   A tela só precisa NÃO desfazer isso: ela nunca soma o total das faturas com
   as saídas realizadas, e nunca oferece pagar uma compra avulsa de cartão --
   quem paga compra de cartão é a fatura.

   O ciclo é calculado por js/domain/cards.js, que repete a regra da 007 para a
   tela poder responder antes de ir ao banco. As duas são provadas com os
   mesmos casos em testes/regras.mjs. */

const PIADAS_FATURA = [
  "A fatura sabe que dia é.",
  "Dinheiro do mês que vem, gasto no mês passado.",
  "Parcelar é adiar a conversa, não encerrá-la.",
];


/* "•••• 1234", e nada além disso. */
const finalLegivel = (c) => (c.final ? "•••• " + esc(c.final) : "");

export function renderCartoes(){
  const tem = V2.cartoes.length > 0;
  const vazio = $("cartoesVazio"), conteudo = $("cartoesConteudo");
  if (!vazio || !conteudo) return;
  vazio.hidden = tem;
  conteudo.hidden = !tem;
  if (!tem) return;

  const hoje = hojeISO();
  const ind = indicadoresDeCartoes(V2.cartoes, V2.faturas);
  $("crAPagar").textContent = money(ind.aPagar);
  $("crQuantidade").textContent = String(ind.quantidade);
  $("crAbertas").textContent = String(ind.faturasAbertas);

  const prox = proximaAVencer(V2.faturas, hoje);
  $("crProxima").textContent = prox ? diaLegivel(prox.vencimento) : "—";

  $("crPiada").textContent = PIADAS_FATURA[V2.cartoes.length % PIADAS_FATURA.length];

  /* Fatura vencida e não paga é a informação que a pessoa mais precisa ver, e
     a que mais some no meio de uma lista ordenada por data. Então ela sai da
     lista e vira uma linha própria. Sem piada: atraso custa juros. */
  const atrasadas = vencidas(V2.faturas, hoje);
  const aviso = $("crVencidas");
  aviso.hidden = atrasadas.length === 0;
  if (!aviso.hidden){
    aviso.className = "hint alerta";
    aviso.textContent = atrasadas.length === 1
      ? "Uma fatura venceu e não foi paga: " + money(atrasadas[0].total)
        + ", vencida em " + diaLegivel(atrasadas[0].vencimento) + "."
      : atrasadas.length + " faturas venceram e não foram pagas, somando "
        + money(atrasadas.reduce((s, f) => s + Number(f.total || 0), 0)) + ".";
  }

  $("listaCartoes").innerHTML = V2.cartoes.map((c) => {
    const inst = instPorId(c.instituicaoId);
    const minhas = faturasDoCartao(c.id);
    const aberto = minhas.filter((f) => f.situacao !== "paga")
      .reduce((s, f) => s + Number(f.total || 0), 0);
    return '<div class="cartao-card' + (c.ativo === false ? " off" : "") + '">'
      + '<div class="cartao-topo">'
      + selo(c.nome, c.cor || (inst && inst.cor), inst && inst.logo)
      + '<div class="cartao-nome"><b>' + esc(c.nome) + '</b>'
      + '<span class="meta">' + [finalLegivel(c), inst ? esc(inst.nome) : "",
          "fecha dia " + esc(String(c.diaFechamento))].filter(Boolean).join(" · ")
      + '</span></div>'
      + '<div class="cartao-valor"><b>' + money(aberto) + '</b><span>em aberto</span></div>'
      + '<button class="btn ghost sm" data-editcartao="' + esc(c.id) + '">Editar</button>'
      + '</div>'
      + (minhas.length
          ? '<div class="cartao-faturas">' + minhas.slice(0, 6).map(linhaDeFatura).join("") + '</div>'
          : '<p class="hint" style="padding:0 var(--e-4) var(--e-3)">Nenhuma compra lançada ainda.</p>')
      + '</div>';
  }).join("");
}

/* A linha de uma fatura NUNCA diz só um mês. Competência 2026-09 num cartão
   que fecha 25 e vence 8 é a fatura que a pessoa chama de "de outubro" -- o
   mês sozinho discordaria de quem lê. Então vão as duas datas.

   A situação vai por rótulo E por cor, nunca só por cor. */
function linhaDeFatura(f){
  const rotulo = { aberta: "Aberta", fechada: "A pagar", paga: "Paga",
                   parcial: "Parcial" }[f.situacao] || f.situacao;
  /* Numa fatura parcial, o número que decide é o que FALTA. Mostrar o total
     faria a linha dizer que se deve mais do que se deve -- é exatamente o tipo
     de rótulo certo sobre o número errado que já custou três defeitos. O total
     não some: ele vira contexto, ao lado das datas. */
  const parcial = f.situacao === "parcial";
  return '<button type="button" class="fatura-linha" data-fatura="' + esc(f.faturaId) + '">'
    + '<span class="fatura-quando">' + esc(rotuloDaFatura(f))
    + (parcial ? " · de " + esc(money(f.total)) : "") + '</span>'
    + '<span class="pill sit-' + esc(f.situacao) + '">' + esc(rotulo) + '</span>'
    + '<span class="fatura-total num">'
    + money(parcial ? Number(f.restante || 0) : Number(f.total || 0)) + '</span>'
    + '</button>';
}

/* ------------------------------------------------------------- cadastro --*/
let cartaoEditando = null;

function abreCartao(id){
  cartaoEditando = id || null;
  const c = id ? cartaoPorId(id) : null;
  $("crTitulo").textContent = c ? "Editar cartão" : "Novo cartão";
  $("cr_nome").value = c ? c.nome : "";
  $("cr_final").value = c && c.final ? c.final : "";
  $("cr_fechamento").value = c ? c.diaFechamento : "";
  $("cr_vencimento").value = c ? c.diaVencimento : "";
  $("cr_limite").value = c && c.limite !== null && c.limite !== undefined ? c.limite : "";
  $("cr_obs").value = c ? c.obs || "" : "";
  $("cr_instituicao").innerHTML = listaDeOpcoes(
    V2.instituicoes.map((i) => ({ id: i.id, rotulo: i.nome })),
    c ? c.instituicaoId : "", "Sem instituição");
  $("cr_conta").innerHTML = listaDeOpcoes(
    V2.contas.filter((x) => x.ativo !== false).map((x) => ({ id: x.id, rotulo: x.nome })),
    c ? c.contaPadraoId : "", "Escolher na hora de pagar");
  $("crExcluir").hidden = !c;
  mostraErro($("crErro"), "");
  mostraCiclo();
  $("dlgCartao").showModal();
}

/* Mostra o ciclo resolvido enquanto a pessoa digita. Fechamento e vencimento
   são dois números que, trocados, mudam o mês inteiro de uma fatura -- ver o
   resultado antes de salvar é o que impede errar por um dia. */
function mostraCiclo(){
  const f = Number($("cr_fechamento").value), v = Number($("cr_vencimento").value);
  const aviso = $("crCiclo");
  if (!(f >= 1 && f <= 31 && v >= 1 && v <= 31)){ aviso.hidden = true; return; }
  const ciclo = cicloDaFatura(V2.mes, f, v);
  aviso.hidden = false;
  aviso.textContent = "A fatura que fecha em " + diaLegivel(ciclo.fechamento)
    + " vence em " + diaLegivel(ciclo.vencimento)
    + ". Compra feita no dia " + f + " já cai na fatura seguinte.";
}

export function ligaCartoes(){
  $("btnPrimeiroCartao")?.addEventListener("click", () => abreCartao(null));
  $("btnNovoCartao")?.addEventListener("click", () => abreCartao(null));
  $("cr_fechamento")?.addEventListener("input", mostraCiclo);
  $("cr_vencimento")?.addEventListener("input", mostraCiclo);

  $("listaCartoes")?.addEventListener("click", (e) => {
    const ed = e.target.closest("[data-editcartao]");
    if (ed) return abreCartao(ed.getAttribute("data-editcartao"));
    const fa = e.target.closest("[data-fatura]");
    if (fa) abreFatura(fa.getAttribute("data-fatura"));
  });

  $("formCartao")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const final = $("cr_final").value.trim();
    if (final && !/^[0-9]{4}$/.test(final))
      return mostraErro($("crErro"), "O final do cartão tem quatro dígitos. Nada além disso é guardado.");
    const limite = $("cr_limite").value.trim();
    const modelo = {
      nome: $("cr_nome").value.trim(),
      instituicaoId: $("cr_instituicao").value || null,
      final: final || null,
      diaFechamento: Number($("cr_fechamento").value),
      diaVencimento: Number($("cr_vencimento").value),
      limite: limite === "" ? null : Number(limite),
      contaPadraoId: $("cr_conta").value || null,
      obs: $("cr_obs").value.trim(),
    };
    if (!modelo.nome) return mostraErro($("crErro"), "Dê um nome ao cartão.");
    const r = await v2.salvaCartao(modelo, cartaoEditando);
    if (r.erro) return mostraErro($("crErro"), r.erro);
    $("dlgCartao").close();
    dep.toast(cartaoEditando ? "Cartão salvo." : "Cartão criado.");
    await recarrega();
  });

  const excluir = $("crExcluir");
  if (excluir) confirmaEmDoisCliques(excluir, "Excluir", async () => {
    const r = await v2.removeCartao(cartaoEditando);
    if (r.erro) return mostraErro($("crErro"), r.erro);
    $("dlgCartao").close();
    dep.toast("Cartão excluído.");
    await recarrega();
  });
}

/* ------------------------------------------------------------- compra --*/
function abreCompra(){
  if (!V2.cartoes.length) return;
  $("cp_cartao").innerHTML = listaDeOpcoes(
    V2.cartoes.filter((c) => c.ativo !== false).map((c) => ({ id: c.id, rotulo: c.nome })), "", "");
  $("cp_categoria").innerHTML = listaDeOpcoes(
    categoriasPorFluxo(V2.categorias, "saida")
      .map((c) => ({ id: c.id, rotulo: caminhoDaCategoria(V2.categorias, c.id) })), "", "Sem categoria");
  $("cp_data").value = hojeISO();
  $("cp_descricao").value = "";
  $("cp_valor").value = "";
  $("cp_parcelas").value = "1";
  $("cp_obs").value = "";
  mostraErro($("cpErro"), "");
  mostraPreviaDaCompra();
  $("dlgCompraCartao").showModal();
}

/* Em qual fatura vai cair, e de quanto fica cada parcela -- antes de gravar.
   É a pergunta que a pessoa tem na cabeça no momento de lançar, e respondê-la
   depois seria responder tarde. */
function mostraPreviaDaCompra(){
  const aviso = $("cpPrevia");
  const c = cartaoPorId($("cp_cartao").value);
  const data = $("cp_data").value;
  const valor = Number($("cp_valor").value);
  const n = Math.max(1, Number($("cp_parcelas").value) || 1);
  if (!c || !data || !(valor > 0)){ aviso.hidden = true; return; }

  const comp = competenciaDaCompra(data, c.diaFechamento);
  const ciclo = cicloDaFatura(comp, c.diaFechamento, c.diaVencimento);
  const partes = parcelasDe(valor, n);
  aviso.hidden = false;
  aviso.textContent = n === 1
    ? "Cai na fatura que vence em " + diaLegivel(ciclo.vencimento) + "."
    : n + "x de " + money(partes[partes.length - 1])
      + (partes[0] !== partes[partes.length - 1] ? " (a primeira de " + money(partes[0]) + ")" : "")
      + ". A primeira vence em " + diaLegivel(ciclo.vencimento) + ".";
}

export function ligaCompraDeCartao(){
  $("btnNovaCompra")?.addEventListener("click", abreCompra);
  for (const id of ["cp_cartao", "cp_data", "cp_valor", "cp_parcelas"])
    $(id)?.addEventListener("input", mostraPreviaDaCompra);
  $("cp_cartao")?.addEventListener("change", mostraPreviaDaCompra);

  $("formCompraCartao")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = {
      cartaoId: $("cp_cartao").value,
      descricao: $("cp_descricao").value.trim(),
      valor: Number($("cp_valor").value),
      data: $("cp_data").value,
      parcelas: Number($("cp_parcelas").value) || 1,
      categoriaId: $("cp_categoria").value || null,
      obs: $("cp_obs").value.trim(),
    };
    if (!p.cartaoId) return mostraErro($("cpErro"), "Escolha o cartão.");
    if (!p.descricao) return mostraErro($("cpErro"), "Diga o que foi a compra.");
    if (!(p.valor > 0)) return mostraErro($("cpErro"), "O valor precisa ser maior que zero.");
    $("cpSalvar").disabled = true;
    const r = await v2.registraCompraDeCartao(p);
    $("cpSalvar").disabled = false;
    if (r.erro) return mostraErro($("cpErro"), r.erro);
    $("dlgCompraCartao").close();
    dep.toast(p.parcelas > 1 ? "Compra lançada em " + p.parcelas + " parcelas." : "Compra lançada.");
    await recarrega();
  });
}


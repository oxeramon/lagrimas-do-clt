/* TELA DE GRUPOS: rateios e acertos.
 *
 * O maior módulo de tela do projeto, e continua um só de propósito: grupo,
 * membro, despesa e acerto são a MESMA tela: quebrar em quatro arquivos daria
 * quatro módulos que só conversam entre si, o que aumenta acoplamento em vez de
 * reduzir.
 */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { divisaoIgual, faltaFechar, fecha, acertosSugeridos, indicadoresDoGrupo }
  from "../../domain/groups.js";
import { categoriasPorFluxo, caminhoDaCategoria } from "../../domain/categories.js";
import { V2, dep, recarrega, opcoesDeConta } from "./estado.js";
import { selo, listaDeOpcoes, confirmaEmDoisCliques, mostraErro, hojeISO,
         diaLegivel } from "./pecas.js";
import * as v2 from "../../data/v2-repository.js";

/* ==================================================================
   GRUPOS, RATEIOS E ACERTOS
   ==================================================================
       GRUPO calcula OBRIGAÇÃO.     "Carlos te deve R$ 100"
       TRANSAÇÃO calcula DINHEIRO.  "Carlos pagou R$ 100 na sua conta"

   A tela existe para não confundir as duas. Lançar despesa de grupo NÃO mexe
   em conta nenhuma; registrar acerto só vira movimentação quando a pessoa
   escolhe a conta. Adivinhar aqui inventaria uma entrada que não existiu.

   A divisão em centavos é calculada aqui para a tela poder mostrar as partes
   antes de gravar. Quem RECUSA uma divisão que não fecha é o gatilho
   postergado da 009, e ele não pode ser contornado. */

const PIADAS_GRUPO = [
  "Amizade boa também fecha conta.",
  "Dividir é fácil. Cobrar é que é.",
  "A conta não some se ninguém olhar.",
];

let grupoAtual = null;

const membrosDe = (id) => V2.membros.filter((m) => m.grupoId === id);
const saldosDe  = (id) => V2.saldosGrupo.filter((s) => s.grupoId === id);
const despesasDe = (id) => V2.despesas.filter((d) => d.grupoId === id);
const membroPorId = (id) => V2.membros.find((m) => m.id === id) || null;

export function renderGrupos(){
  const tem = V2.grupos.length > 0;
  const vazio = $("gruposVazio"), conteudo = $("gruposConteudo");
  if (!vazio || !conteudo) return;
  vazio.hidden = tem;
  conteudo.hidden = !tem;
  if (!tem) return;

  if (!grupoAtual || !V2.grupos.some((g) => g.id === grupoAtual))
    grupoAtual = V2.grupos[0].id;
  $("gpSeletor").innerHTML = listaDeOpcoes(
    V2.grupos.map((g) => ({ id: g.id, rotulo: g.nome })), grupoAtual, "");

  const saldos = saldosDe(grupoAtual);
  const despesas = despesasDe(grupoAtual);
  const ind = indicadoresDoGrupo(saldos, despesas);

  /* O MEU saldo é o número que responde a pergunta que a pessoa tem. `null`
     quando ninguém está marcado como "sou eu" -- e null não é zero: um diz
     "não sei", o outro diz "estamos quites". */
  const meu = ind.meuSaldo;
  $("gpMeuSaldo").textContent = meu === null ? "—" : money(Math.abs(meu));
  $("gpMeuRotulo").textContent = meu === null ? "Seu saldo no grupo"
    : meu > 0 ? "Você tem a receber" : meu < 0 ? "Você deve" : "Você está quite";
  $("gpMeuSaldo").className = "numerao" + (meu < 0 ? " ruim" : meu > 0 ? " bom" : "");
  $("gpPiada").textContent = meu === null
    ? "Marque quem é você na lista abaixo para o app saber de que lado você está."
    : PIADAS_GRUPO[despesas.length % PIADAS_GRUPO.length];

  $("gpGasto").textContent = money(ind.gastoTotal);
  $("gpMembros").textContent = String(ind.membros);
  $("gpDespesas").textContent = String(ind.despesas);

  /* A soma dos saldos de um grupo é sempre zero. Se não for, alguma coisa
     está errada, e é melhor dizer isso do que mostrar número torto com cara
     de certo. Sem piada: aqui é erro. */
  const alerta = $("gpNaoFecha");
  alerta.hidden = ind.fecha || saldos.length === 0;
  if (!alerta.hidden)
    alerta.textContent = "A conta deste grupo não está fechando. "
      + "Confira as despesas: a soma das partes precisa bater com o valor de cada uma.";

  renderSaldosDoGrupo(saldos);
  renderAcertosSugeridos(saldos);
  renderDespesasDoGrupo(despesas);
}

function renderSaldosDoGrupo(saldos){
  const box = $("listaSaldos");
  if (!saldos.length){
    box.innerHTML = '<div class="empty">Ninguém no grupo ainda. Adicione as pessoas para começar a dividir.</div>';
    return;
  }
  /* Situação por RÓTULO e por cor, nunca só por cor. */
  box.innerHTML = saldos.map((m) => {
    const v = Number(m.saldo);
    const rotulo = v > 0 ? "a receber" : v < 0 ? "deve" : "quite";
    return '<div class="row">'
      + selo(m.nome, null, null)
      + '<div class="desc"><b>' + esc(m.nome) + (m.souEu ? " (você)" : "") + '</b>'
      + '<span class="meta">pagou ' + money(m.pagou) + ' · coube ' + money(m.coube) + '</span></div>'
      + '<div class="amt ' + (v > 0 ? "bom" : v < 0 ? "ruim" : "") + '">'
      + money(Math.abs(v)) + ' <span class="meta">' + rotulo + '</span></div>'
      + '<button class="btn ghost sm" data-editmembro="' + esc(m.membroId) + '">Editar</button>'
      + '</div>';
  }).join("");
}

/* O grupo sabe quanto cada um deve no total; isso não é o mesmo que saber quem
   paga a quem. A sugestão é determinística e explicável -- não é o mínimo de
   transferências possível, e a diferença num grupo de amigos é de uma. */
function renderAcertosSugeridos(saldos){
  const sugestoes = acertosSugeridos(saldos);
  const card = $("cardAcertos");
  card.hidden = sugestoes.length === 0;
  if (card.hidden) return;
  $("listaAcertos").innerHTML = sugestoes.map((a) =>
    '<div class="row"><div class="desc"><b>' + esc(a.deNome) + ' → ' + esc(a.paraNome) + '</b>'
    + '<span class="meta">para zerar entre os dois</span></div>'
    + '<div class="amt">' + money(a.valor) + '</div>'
    + '<button class="btn ghost sm" data-acerto="' + esc(a.deId) + ':' + esc(a.paraId)
    + ':' + a.valor + '">Registrar</button></div>').join("");
}

function renderDespesasDoGrupo(despesas){
  const box = $("listaDespesas");
  if (!despesas.length){
    box.innerHTML = '<div class="empty">Nenhuma despesa lançada neste grupo.</div>';
    return;
  }
  box.innerHTML = despesas.map((d) => {
    const quem = membroPorId(d.pagoPorId);
    return '<div class="row"><div class="desc"><b>' + esc(d.descricao) + '</b>'
      + '<span class="meta">' + esc(diaLegivel(d.data))
      + ' · pagou ' + esc(quem ? quem.nome : "alguém") + '</span></div>'
      + '<div class="amt">' + money(d.valor) + '</div>'
      + '<button class="btn ghost sm" data-excluidespesa="' + esc(d.id) + '">Excluir</button>'
      + '</div>';
  }).join("");
}

/* ------------------------------------------------------------- grupo --*/
let grupoEditando = null;

function abreGrupo(id){
  grupoEditando = id || null;
  const g = id ? V2.grupos.find((x) => x.id === id) : null;
  $("gpTitulo").textContent = g ? "Editar grupo" : "Novo grupo";
  $("gp_nome").value = g ? g.nome : "";
  $("gp_obs").value = g ? g.obs || "" : "";
  $("gpExcluir").hidden = !g;
  mostraErro($("gpErro"), "");
  $("dlgGrupo").showModal();
}

/* ------------------------------------------------------------ membro --*/
let membroEditando = null;

function abreMembro(id){
  membroEditando = id || null;
  const m = id ? membroPorId(id) : null;
  $("mbTitulo").textContent = m ? "Editar pessoa" : "Adicionar pessoa";
  $("mb_nome").value = m ? m.nome : "";
  $("mb_apelido").value = m ? m.apelido || "" : "";
  $("mb_eu").value = m && m.souEu ? "sim" : "nao";
  $("mbExcluir").hidden = !m;
  mostraErro($("mbErro"), "");
  $("dlgMembro").showModal();
}

/* ----------------------------------------------------------- despesa --*/
function abreDespesaDoGrupo(){
  const membros = membrosDe(grupoAtual).filter((m) => m.ativo !== false);
  if (!membros.length) return dep.erro("Adicione pelo menos uma pessoa ao grupo antes de lançar despesa.");
  $("dg_descricao").value = "";
  $("dg_valor").value = "";
  $("dg_data").value = hojeISO();
  $("dg_modo").value = "igual";
  $("dg_pagou").innerHTML = listaDeOpcoes(
    membros.map((m) => ({ id: m.id, rotulo: m.nome })),
    (membros.find((m) => m.souEu) || membros[0]).id, "");
  $("dg_categoria").innerHTML = listaDeOpcoes(
    categoriasPorFluxo(V2.categorias, "saida")
      .map((c) => ({ id: c.id, rotulo: caminhoDaCategoria(V2.categorias, c.id) })), "", "Sem categoria");
  mostraErro($("dgErro"), "");
  montaPartes();
  $("dlgDespesaGrupo").showModal();
}

/* As partes aparecem ANTES de gravar, com o valor de cada uma já calculado.
   Na divisão personalizada, o "falta fechar" é mostrado a cada tecla: é o
   número que a pessoa precisa zerar, e descobri-lo na recusa do banco seria
   descobrir tarde. */
function montaPartes(){
  const membros = membrosDe(grupoAtual).filter((m) => m.ativo !== false);
  const total = Number($("dg_valor").value) || 0;
  const igual = $("dg_modo").value === "igual";
  const partes = divisaoIgual(total, membros.length);

  $("dg_partes").innerHTML = '<div class="formgrid" style="padding:0">'
    + membros.map((m, i) =>
        '<div class="field"><label for="dgp_' + esc(m.id) + '">' + esc(m.nome) + '</label>'
        + '<input type="number" step="0.01" min="0" inputmode="decimal" id="dgp_' + esc(m.id) + '"'
        + ' data-parte="' + esc(m.id) + '" value="' + partes[i].toFixed(2) + '"'
        + (igual ? " readonly" : "") + '></div>').join("")
    + '</div>';
  mostraFalta();
}

function partesAtuais(){
  return [...document.querySelectorAll("#dg_partes [data-parte]")].map((el) => ({
    membro: el.getAttribute("data-parte"), valor: Number(el.value) || 0,
  }));
}

function mostraFalta(){
  const aviso = $("dgFalta");
  const total = Number($("dg_valor").value) || 0;
  const partes = partesAtuais();
  if (!total || !partes.length){ aviso.hidden = true; return; }
  const falta = faltaFechar(total, partes.map((p) => p.valor));
  aviso.hidden = false;
  aviso.className = falta === 0 ? "hint full" : "hint full alerta";
  aviso.textContent = falta === 0
    ? "As partes somam exatamente " + money(total) + "."
    : falta > 0 ? "Falta dividir " + money(falta) + "."
                : "Passou " + money(-falta) + " do valor da despesa.";
}

/* ------------------------------------------------------------ acerto --*/
let acertoAtual = null;

function abreAcerto(deId, paraId, valor){
  const de = membroPorId(deId), para = membroPorId(paraId);
  if (!de || !para) return;
  acertoAtual = { deId, paraId };
  $("acSobre").textContent = de.nome + " paga " + money(valor) + " para " + para.nome + ".";
  $("ac_valor").value = Number(valor).toFixed(2);
  $("ac_data").value = hojeISO();
  /* A conta só é oferecida quando VOCÊ participa: acerto entre duas outras
     pessoas não passa pela sua conta, e a 009 recusa. */
  const euParticipo = de.souEu || para.souEu;
  $("ac_conta").innerHTML = euParticipo
    ? listaDeOpcoes(V2.contas.filter((c) => c.ativo !== false)
        .map((c) => ({ id: c.id, rotulo: c.nome })), "", "Não passou por conta")
    : '<option value="">Você não participa deste acerto</option>';
  $("ac_conta").disabled = !euParticipo;
  mostraErro($("acErro"), "");
  $("dlgAcerto").showModal();
}

/* ------------------------------------------------------------ ligação --*/
export function ligaGrupos(){
  $("btnPrimeiroGrupo")?.addEventListener("click", () => abreGrupo(null));
  $("btnNovoGrupo")?.addEventListener("click", () => abreGrupo(null));
  $("btnEditarGrupo")?.addEventListener("click", () => abreGrupo(grupoAtual));
  $("btnNovoMembro")?.addEventListener("click", () => abreMembro(null));
  $("btnNovaDespesa")?.addEventListener("click", abreDespesaDoGrupo);
  $("gpSeletor")?.addEventListener("change", (e) => {
    grupoAtual = e.target.value; renderGrupos();
  });

  $("listaSaldos")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-editmembro]");
    if (b) abreMembro(b.getAttribute("data-editmembro"));
  });
  $("listaAcertos")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-acerto]");
    if (!b) return;
    const [de, para, valor] = b.getAttribute("data-acerto").split(":");
    abreAcerto(de, para, Number(valor));
  });
  $("listaDespesas")?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-excluidespesa]");
    if (!b) return;
    if (b.getAttribute("data-armado") !== "sim"){
      b.setAttribute("data-armado", "sim");
      b.textContent = "Confirmar exclusão";
      b.classList.add("perigo");
      setTimeout(() => {
        b.removeAttribute("data-armado"); b.textContent = "Excluir"; b.classList.remove("perigo");
      }, 4000);
      return;
    }
    const r = await v2.removeDespesaDoGrupo(b.getAttribute("data-excluidespesa"));
    if (r.erro) return dep.erro(r.erro);
    dep.toast("Despesa excluída.");
    await recarrega();
  });

  $("dg_valor")?.addEventListener("input", montaPartes);
  $("dg_modo")?.addEventListener("change", montaPartes);
  $("dg_partes")?.addEventListener("input", mostraFalta);

  $("formGrupo")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = $("gp_nome").value.trim();
    if (!nome) return mostraErro($("gpErro"), "Dê um nome ao grupo.");
    const r = await v2.salvaGrupo({ nome, obs: $("gp_obs").value.trim() }, grupoEditando);
    if (r.erro) return mostraErro($("gpErro"), r.erro);
    $("dlgGrupo").close();
    dep.toast(grupoEditando ? "Grupo salvo." : "Grupo criado.");
    await recarrega();
  });
  const gpEx = $("gpExcluir");
  if (gpEx) confirmaEmDoisCliques(gpEx, "Excluir", async () => {
    const r = await v2.removeGrupo(grupoEditando);
    if (r.erro) return mostraErro($("gpErro"), r.erro);
    $("dlgGrupo").close(); grupoAtual = null;
    dep.toast("Grupo excluído.");
    await recarrega();
  });

  $("formMembro")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = $("mb_nome").value.trim();
    if (!nome) return mostraErro($("mbErro"), "Diga o nome da pessoa.");
    const r = await v2.salvaMembro({
      grupoId: grupoAtual, nome, apelido: $("mb_apelido").value.trim(),
      souEu: $("mb_eu").value === "sim",
    }, membroEditando);
    if (r.erro) return mostraErro($("mbErro"), r.erro);
    $("dlgMembro").close();
    dep.toast(membroEditando ? "Pessoa salva." : "Pessoa adicionada.");
    await recarrega();
  });
  const mbEx = $("mbExcluir");
  if (mbEx) confirmaEmDoisCliques(mbEx, "Excluir", async () => {
    const r = await v2.removeMembro(membroEditando);
    if (r.erro) return mostraErro($("mbErro"), r.erro);
    $("dlgMembro").close();
    dep.toast("Pessoa removida.");
    await recarrega();
  });

  $("formDespesaGrupo")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const valor = Number($("dg_valor").value);
    const partes = partesAtuais().filter((p) => p.valor > 0);
    if (!(valor > 0)) return mostraErro($("dgErro"), "O valor precisa ser maior que zero.");
    if (!partes.length) return mostraErro($("dgErro"), "Divida a despesa entre pelo menos uma pessoa.");
    /* A tela confere antes para não levar a pessoa até a recusa do banco. Mas
       quem GARANTE é o gatilho da 009, e é por isso que esta checagem pode ser
       amigável em vez de desconfiada. */
    if (!fecha(valor, partes.map((p) => p.valor)))
      return mostraErro($("dgErro"), "As partes precisam somar exatamente o valor da despesa.");
    $("dgSalvar").disabled = true;
    const r = await v2.registraDespesaDoGrupo({
      grupoId: grupoAtual, descricao: $("dg_descricao").value.trim(),
      valor, data: $("dg_data").value, pagoPorId: $("dg_pagou").value,
      rateios: partes, categoriaId: $("dg_categoria").value || null,
    });
    $("dgSalvar").disabled = false;
    if (r.erro) return mostraErro($("dgErro"), r.erro);
    $("dlgDespesaGrupo").close();
    dep.toast("Despesa lançada.");
    await recarrega();
  });

  $("formAcerto")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!acertoAtual) return;
    const valor = Number($("ac_valor").value);
    if (!(valor > 0)) return mostraErro($("acErro"), "O valor precisa ser maior que zero.");
    $("acSalvar").disabled = true;
    const r = await v2.registraAcerto({
      grupoId: grupoAtual, deId: acertoAtual.deId, paraId: acertoAtual.paraId,
      valor, data: $("ac_data").value, contaId: $("ac_conta").value || null,
    });
    $("acSalvar").disabled = false;
    if (r.erro) return mostraErro($("acErro"), r.erro);
    $("dlgAcerto").close();
    dep.toast($("ac_conta").value ? "Acerto registrado e lançado na conta." : "Acerto registrado.");
    await recarrega();
  });
}

/* As telas de Contas e Transações.
 *
 * Por que este arquivo existe e não mais um pedaço do `index.html`: o render
 * da V1 ainda mora lá e é a dívida técnica conhecida do projeto. Código novo
 * não aumenta a dívida -- ele nasce do lado certo da linha.
 *
 * O que ele recebe de fora, por injeção, é só o que continua morando no
 * `index.html`: `toast`, `erro` e o recarregar da V1. Nada aqui importa o
 * `index.html` (nem poderia -- ele não exporta).
 *
 * Regras que valem em todo o arquivo:
 *   · todo dado do usuário passa por esc() antes de entrar em innerHTML;
 *   · dinheiro por money(), que já traz o "R$";
 *   · excluir é sempre dois cliques no mesmo botão;
 *   · erro de dinheiro, de exclusão e de segurança não tem piada.
 */
import { $ } from "../core/dom.js";
import { esc } from "../core/escape.js";
import { money } from "../core/money.js";
/* HOJE já é o mês corrente EM TEXTO ("2026-09"), não um Date -- foi assim que
   este arquivo nasceu quebrado, chamando mkey(HOJE) e derrubando o módulo
   inteiro no import. Para a data de hoje em ISO, quem serve é iso(new Date()). */
import { MES_LONGO, midx, fromIdx, HOJE, iso } from "../core/dates.js";
const hojeISO = () => iso(new Date());
import { TIPOS_DE_CONTA, LIQUIDEZ, rotuloDoTipo, rotuloDaLiquidez, saldoDaConta,
         indicadoresDeContas, porInstituicao, porTipo, podeExcluirConta } from "../domain/accounts.js";
import { filtraTransacoes, totaisDoPeriodo, agrupaPorData, gastoPorCategoria,
         semTransferencias, ehTransferencia, valorComSinal, contaNoSaldo,
         rotuloDoStatus } from "../domain/transactions.js";
import { categoriasPorFluxo, caminhoDaCategoria, arvoreDeCategorias,
         paisPossiveis, descendentesDe } from "../domain/categories.js";
import { CATALOGO_INSTITUICOES, monogramaDe, contrasteSobre } from "./institution-catalog.js";
import { raizesPadrao, filhasPadrao, quantasCategoriasPadrao } from "./category-catalog.js";
import { abasDoMais, vaiParaAba, quandoTrocarDeAba } from "./navigation.js";
import * as v2 from "../data/v2-repository.js";

/* O espelho da V2 em memória. Mesma regra do `S` da V1: só a camada de tela
   escreve, e só depois de o banco confirmar. */
export const V2 = {
  instituicoes: [], contas: [], categorias: [], saldos: [], transacoes: [],
  mes: HOJE, carregado: false, erro: null,
};

let dep = { toast: () => {}, erro: () => {} };

/* ------------------------------------------------------------------ carga --*/
export async function carregaV2(){
  const cad = await v2.carregaCadastrosV2();
  if (cad.erro){ V2.erro = cad.erro; return { erro: cad.erro }; }
  Object.assign(V2, cad.dados, { erro: null, carregado: true });
  return carregaTransacoesDoMes();
}

export async function carregaTransacoesDoMes(){
  const i = midx(V2.mes);
  const r = await v2.listaTransacoes({ de: V2.mes + "-01", ate: fromIdx(i + 1) + "-01" });
  if (r.erro){ V2.erro = r.erro; return { erro: r.erro }; }
  V2.transacoes = r.dados || [];
  V2.erro = null;
  return { erro: null };
}

/* ------------------------------------------------------------- utilitários --*/
const dinheiro = (v) => (v === null || v === undefined ? "—" : money(v));
const contaPorId = (id) => V2.contas.find((c) => c.id === id) || null;
const instPorId  = (id) => V2.instituicoes.find((i) => i.id === id) || null;

/* O selo é monograma por padrão. Logo só quando a pessoa cadastrou uma URL, e
   mesmo assim com `onerror` voltando ao monograma -- CDN fora do ar não pode
   deixar buraco na tela. */
function selo(nome, cor, logo){
  const c = cor || "#1A6459";
  const estilo = `--marca:${esc(c)};--marca-ink:${contrasteSobre(c)}`;
  const mono = esc(monogramaDe(nome));
  const img = logo
    ? `<img src="${esc(logo)}" alt="" loading="lazy" onerror="this.remove()">`
    : "";
  return `<span class="selo" style="${estilo}" aria-hidden="true">${mono}${img}</span>`;
}

function listaDeOpcoes(lista, selecionado, vazio){
  const cab = vazio ? `<option value="">${esc(vazio)}</option>` : "";
  return cab + lista.map((o) =>
    `<option value="${esc(o.id)}"${o.id === selecionado ? " selected" : ""}>${esc(o.rotulo)}</option>`
  ).join("");
}

/* Dois cliques no mesmo botão, e volta sozinho em 4s. Igual ao resto do app:
   `confirm()` do navegador não combina com nada e é fácil de errar sem ler. */
function confirmaEmDoisCliques(botao, rotuloNormal, aoConfirmar){
  let armado = false, relogio = null;
  botao.addEventListener("click", async () => {
    if (!armado){
      armado = true;
      botao.textContent = "Confirmar exclusão";
      botao.classList.add("perigo");
      relogio = setTimeout(() => {
        armado = false; botao.textContent = rotuloNormal; botao.classList.remove("perigo");
      }, 4000);
      return;
    }
    clearTimeout(relogio);
    armado = false; botao.textContent = rotuloNormal; botao.classList.remove("perigo");
    await aoConfirmar();
  });
}

const mostraErro = (el, texto) => {
  if (!el) return;
  el.textContent = texto || "";
  el.hidden = !texto;
};

/* ==================================================================
   CONTAS
   ================================================================== */
const PIADAS_SALDO = [
  "Seu dinheiro ainda não pediu demissão.",
  "É o que tem. E o que tem é isto aqui.",
  "Número conferido. Sentimentos, não.",
];

export function renderContas(){
  const temContas = V2.contas.length > 0;
  $("contasVazio").hidden = temContas;
  $("contasConteudo").hidden = !temContas;
  if (!temContas) return;

  const ind = indicadoresDeContas(V2.contas, V2.saldos);
  $("ctSaldoTotal").textContent = money(ind.total);
  $("ctDisponivel").textContent = money(ind.disponivel);
  $("ctRestrito").textContent   = money(ind.restrito);
  $("ctBloqueado").textContent  = money(ind.bloqueado);
  $("ctQuantidade").textContent = "· " + ind.quantidade
    + (ind.quantidade === 1 ? " conta" : " contas")
    + (ind.inativas ? ", " + ind.inativas + " inativa" + (ind.inativas > 1 ? "s" : "") : "");
  /* a piada é fixa por sessão, não sorteada a cada render: texto que muda
     sozinho enquanto a pessoa olha parece defeito */
  $("ctPiada").textContent = PIADAS_SALDO[(V2.contas.length + ind.quantidade) % PIADAS_SALDO.length];

  $("ctGrade").innerHTML = V2.contas.map((c) => {
    const inst = instPorId(c.instituicaoId);
    const s = saldoDaConta(V2.saldos, c.id);
    const classe = s === null ? "saldo desconhecido" : (s < 0 ? "saldo negativo" : "saldo");
    const liq = c.liquidez && c.liquidez !== "livre"
      ? `<span class="etiqueta ${esc(c.liquidez)}">${esc(rotuloDaLiquidez(c.liquidez))}</span>` : "";
    const inativa = c.ativo === false ? '<span class="etiqueta">Inativa</span>' : "";
    return `<button class="conta-card" data-conta="${esc(c.id)}" data-inativa="${c.ativo === false ? "sim" : "nao"}">
      ${selo(inst ? inst.nome : c.nome, inst ? inst.cor : null, inst ? inst.logo : "")}
      <span style="min-width:0">
        <span class="nome">${esc(c.nome)}</span>
        <span class="meta">${esc(inst ? inst.nome : "Sem instituição")} · ${esc(rotuloDoTipo(c.tipo))}</span>
        <span class="${classe}">${s === null ? "sem saldo ainda" : money(s)}</span>
        <span class="meta" style="margin-top:6px">${liq} ${inativa}</span>
      </span></button>`;
  }).join("");

  pirulitos($("ctPorInstituicao"), porInstituicao(V2.contas, V2.saldos, V2.instituicoes)
    .map((g) => ({ rotulo: g.nome, valor: g.total, cor: g.cor })));
  pirulitos($("ctPorTipo"), porTipo(V2.contas, V2.saldos)
    .map((g) => ({ rotulo: g.nome, valor: g.total })));
}

/* O gráfico de pirulito. Escala pelo MAIOR VALOR ABSOLUTO, para saldo negativo
   não virar barra invisível. */
function pirulitos(alvo, itens){
  if (!alvo) return;
  if (!itens.length){ alvo.innerHTML = '<li class="pirulito"><span class="rot">Nada por aqui ainda</span></li>'; return; }
  const teto = Math.max(...itens.map((i) => Math.abs(i.valor)), 1);
  alvo.innerHTML = itens.map((i) => {
    const frac = Math.round((Math.abs(i.valor) / teto) * 100);
    const cor = i.cor ? `--cor:${esc(i.cor)};` : "";
    return `<li class="pirulito" style="${cor}--frac:${frac}%">
      <span class="rot" title="${esc(i.rotulo)}">${esc(i.rotulo)}</span>
      <span class="talo"><span class="haste"></span><span class="bola"></span></span>
      <span class="val">${money(i.valor)}</span></li>`;
  }).join("");
}

/* ==================================================================
   TRANSAÇÕES
   ================================================================== */
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

function diaLegivel(d){
  const [a, m, dd] = d.split("-");
  return dd + " de " + MES_LONGO[Number(m) - 1];
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

/* ==================================================================
   LIGAÇÃO
   ================================================================== */
export function ligaTelasV2(deps){
  dep = Object.assign(dep, deps || {});

  montaFolhaMais();
  ligaFecharDialogos();
  $("btnVerContas")?.addEventListener("click", () => vaiParaAba("contas"));
  ligaContas();
  ligaInstituicoes();
  ligaTransacoes();
  ligaTransferencia();
  ligaCategorias();

  /* o botão flutuante só faz sentido onde há o que lançar */
  quandoTrocarDeAba((destino) => {
    const fab = $("btnFlutuante");
    if (fab) fab.hidden = !(destino === "transacoes" && V2.contas.length > 0);
  });
}

export function renderV2(){
  renderContas();
  renderTransacoes();
  renderPainelV2();
}

/* Todo botão com `data-fechar` fecha o diálogo que ele nomeia. Um ouvinte só,
   em vez de um por diálogo -- e `<dialog>` já devolve o foco ao gatilho e já
   fecha no ESC, então não há nada a reimplementar. */
function ligaFecharDialogos(){
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fechar]");
    if (b) $(b.getAttribute("data-fechar"))?.close();
  });
}

/* O bloco da V2 no Painel. Ele mostra o que ESTÁ na conta, e nada mais: os
   compromissos continuam sendo assunto da V1, no resto da tela. Somar os dois
   num número só contaria o mesmo dinheiro duas vezes. */
export function renderPainelV2(){
  const bloco = $("painelV2");
  if (!bloco) return;
  bloco.hidden = V2.contas.length === 0;
  if (bloco.hidden) return;
  const ind = indicadoresDeContas(V2.contas, V2.saldos);
  $("pnSaldoContas").textContent = money(ind.total);
  $("pnDisponivel").textContent  = money(ind.disponivel);
  $("pnNota").textContent =
    "Isto é o que está nas contas hoje. As dívidas e a projeção abaixo são outra conta: "
    + "elas falam do que ainda vai sair, e os dois números não se somam.";
}

/* ------------------------------------------------------------ folha Mais --*/
function montaFolhaMais(){
  const folha = $("folhaMais"), alvo = $("folhaOpcoes");
  if (!folha || !alvo) return;
  alvo.innerHTML = abasDoMais().map((a) =>
    `<button type="button" id="navs-${esc(a.id)}" role="tab" aria-selected="false"
       aria-controls="p-${esc(a.id)}">${esc(a.rotulo)}</button>`).join("");
  /* A folha liga os próprios cliques em vez de depender de `ligaNavegacao()`:
     os botões dela nascem AQUI, e `ligaNavegacao()` já rodou quando isto
     acontece. Ficaram mudos uma vez por causa dessa ordem. */
  alvo.addEventListener("click", (e) => {
    const b = e.target.closest("button[id^='navs-']");
    if (!b) return;
    vaiParaAba(b.id.slice("navs-".length));
    folha.close();
  });
  $("navm-mais")?.addEventListener("click", () => folha.showModal());
  /* clicar fora fecha: a folha ocupa a largura toda, então "fora" é o backdrop */
  folha.addEventListener("click", (e) => { if (e.target === folha) folha.close(); });
}

/* ---------------------------------------------------------------- contas --*/
let contaEditando = null;

function abreConta(id){
  contaEditando = id || null;
  const c = id ? contaPorId(id) : null;
  $("cnTitulo").textContent = c ? "Editar conta" : "Nova conta";
  $("cn_nome").value = c ? c.nome : "";
  $("cn_instituicao").innerHTML = listaDeOpcoes(
    V2.instituicoes.filter((i) => i.ativo !== false).map((i) => ({ id: i.id, rotulo: i.nome })),
    c ? c.instituicaoId : "", "Sem instituição");
  $("cn_tipo").innerHTML = listaDeOpcoes(TIPOS_DE_CONTA, c ? c.tipo : "corrente");
  $("cn_liquidez").innerHTML = listaDeOpcoes(LIQUIDEZ, c ? c.liquidez : "livre");
  $("cn_saldo").value = c ? c.saldoInicial : "0";
  $("cn_data").value = c ? c.saldoInicialEm : hojeISO();
  $("cn_ativo").value = c && c.ativo === false ? "nao" : "sim";
  $("cn_obs").value = c ? (c.obs || "") : "";
  /* saldo inicial de conta que já tem histórico mexe em tudo para trás; a
     tela avisa em vez de deixar a pessoa descobrir depois */
  $("cnAjuda").textContent = c
    ? "Mudar o saldo inicial recalcula todo o histórico desta conta."
    : "O saldo inicial é o ponto de partida. Daí para frente, quem move o saldo são as transações.";
  $("cnExcluir").hidden = !c;
  mostraErro($("cnErro"), "");
  $("dlgConta").showModal();
}

function ligaContas(){
  $("btnNovaConta")?.addEventListener("click", () => abreConta(null));
  $("btnPrimeiraConta")?.addEventListener("click", () => abreConta(null));
  $("btnIrParaContas")?.addEventListener("click", () => vaiParaAba("contas"));
  $("ctGrade")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-conta]");
    if (b) abreConta(b.getAttribute("data-conta"));
  });

  $("formConta")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("cnSalvar"); btn.disabled = true;
    const modelo = {
      nome: $("cn_nome").value.trim(),
      instituicaoId: $("cn_instituicao").value || null,
      tipo: $("cn_tipo").value,
      saldoInicial: Number($("cn_saldo").value) || 0,
      saldoInicialEm: $("cn_data").value,
      liquidez: $("cn_liquidez").value,
      ativo: $("cn_ativo").value === "sim",
      obs: $("cn_obs").value.trim(),
    };
    const r = await v2.salvaConta(modelo, contaEditando);
    btn.disabled = false;
    if (r.erro){ mostraErro($("cnErro"), r.erro); return; }
    $("dlgConta").close();
    await recarrega();
    dep.toast(contaEditando ? "Conta salva" : "Conta criada. Agora dá para lançar.");
  });

  confirmaEmDoisCliques($("cnExcluir"), "Excluir", async () => {
    const conta = contaEditando;
    const quantos = await v2.contaTemMovimento(conta);
    if (quantos.erro){ mostraErro($("cnErro"), quantos.erro); return; }
    const n = Number(quantos.dados ?? 0);
    if (!podeExcluirConta(n)){
      mostraErro($("cnErro"), "Esta conta tem " + n + " lançamento(s). "
        + "Apagar levaria o histórico junto. Marque como inativa em vez de excluir.");
      return;
    }
    const r = await v2.removeConta(conta);
    if (r.erro){ mostraErro($("cnErro"), r.erro); return; }
    $("dlgConta").close();
    await recarrega();
    dep.toast("Conta excluída");
  });
}

/* --------------------------------------------------------- instituições --*/
let instEditando = null;

function renderInstituicoes(){
  const alvo = $("inLista");
  if (!alvo) return;
  if (!V2.instituicoes.length){
    alvo.innerHTML = '<p class="hint">Nenhuma instituição ainda. A conta pode ficar sem uma, se preferir.</p>';
    return;
  }
  alvo.innerHTML = '<div class="mini-lista">' + V2.instituicoes.map((i) => `
    <div class="mini-item" data-inativo="${i.ativo === false ? "sim" : "nao"}">
      ${selo(i.nome, i.cor, i.logo)}
      <span class="txt">${esc(i.nome)}<span class="sub"> · ${esc(i.tipo || "Outro")}</span></span>
      <button type="button" class="btn ghost sm" data-editar-inst="${esc(i.id)}">Editar</button>
      <button type="button" class="btn ghost sm" data-alterna-inst="${esc(i.id)}">${i.ativo === false ? "Ativar" : "Desativar"}</button>
    </div>`).join("") + "</div>";
}

function ligaInstituicoes(){
  $("catalogoInst").innerHTML = CATALOGO_INSTITUICOES
    .map((i) => `<option value="${esc(i.nome)}"></option>`).join("");

  const abrirInst = () => {
    instEditando = null; limpaFormInstituicao(); renderInstituicoes();
    $("dlgInstituicoes").showModal();
  };
  $("btnInstituicoes")?.addEventListener("click", abrirInst);
  $("btnInstituicoesAjustes")?.addEventListener("click", abrirInst);

  /* escolher do catálogo preenche tipo e cor, e a pessoa pode mudar os dois */
  $("in_nome")?.addEventListener("input", () => {
    if (instEditando) return;
    const achou = CATALOGO_INSTITUICOES.find(
      (i) => i.nome.toLowerCase() === $("in_nome").value.trim().toLowerCase());
    if (achou){ $("in_tipo").value = achou.tipo; $("in_cor").value = achou.cor; }
  });

  $("inLista")?.addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-editar-inst]");
    if (ed){
      instEditando = ed.getAttribute("data-editar-inst");
      const i = instPorId(instEditando);
      $("in_nome").value = i.nome; $("in_tipo").value = i.tipo || "Outro";
      $("in_cor").value = i.cor || "#14524A"; $("in_logo").value = i.logo || "";
      $("inSalvar").textContent = "Salvar"; $("inCancelarEdicao").hidden = false;
      $("in_nome").focus();
      return;
    }
    const alt = e.target.closest("[data-alterna-inst]");
    if (alt){
      const i = instPorId(alt.getAttribute("data-alterna-inst"));
      const r = await v2.salvaInstituicao({ ativo: i.ativo === false }, i.id);
      if (r.erro){ mostraErro($("inErro"), r.erro); return; }
      await recarrega(); renderInstituicoes();
    }
  });

  $("inCancelarEdicao")?.addEventListener("click", () => { instEditando = null; limpaFormInstituicao(); });

  $("formInstituicao")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const modelo = {
      nome: $("in_nome").value.trim(), tipo: $("in_tipo").value,
      cor: $("in_cor").value, logo: $("in_logo").value.trim(),
      ativo: true, ordem: (V2.instituicoes.length + 1) * 10,
    };
    if (instEditando) delete modelo.ordem;
    const r = await v2.salvaInstituicao(modelo, instEditando);
    if (r.erro){ mostraErro($("inErro"), r.erro); return; }
    instEditando = null; limpaFormInstituicao();
    await recarrega(); renderInstituicoes();
    dep.toast("Instituição salva");
  });
}

function limpaFormInstituicao(){
  $("in_nome").value = ""; $("in_logo").value = "";
  $("in_tipo").value = "Banco"; $("in_cor").value = "#14524A";
  $("inSalvar").textContent = "Adicionar"; $("inCancelarEdicao").hidden = true;
  mostraErro($("inErro"), "");
}

/* ----------------------------------------------------------- transações --*/
let txEditando = null;

function opcoesDeConta(selecionado){
  return listaDeOpcoes(V2.contas.filter((c) => c.ativo !== false)
    .map((c) => ({ id: c.id, rotulo: c.nome })), selecionado, "");
}

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

function ligaTransacoes(){
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

async function trocaMes(passo){
  V2.mes = fromIdx(midx(V2.mes) + passo);
  const r = await carregaTransacoesDoMes();
  if (r.erro){ dep.erro("Não deu para carregar o mês. " + r.erro); return; }
  renderTransacoes();
}

/* -------------------------------------------------------- transferência --*/
let transfEditando = null;

function abreTransferencia(grupoId){
  transfEditando = grupoId || null;
  const pernas = grupoId ? V2.transacoes.filter((t) => t.transferenciaId === grupoId) : [];
  const saida = pernas.find((t) => t.tipo === "saida");
  const entrada = pernas.find((t) => t.tipo === "entrada");

  $("tfTitulo").textContent = grupoId ? "Editar transferência" : "Transferir entre contas";
  $("tf_origem").innerHTML  = opcoesDeConta(saida ? saida.contaId : "");
  $("tf_destino").innerHTML = opcoesDeConta(entrada ? entrada.contaId : "");

  /* DEFEITO QUE BLOQUEOU A PRIMEIRA TRANSFERÊNCIA DE VERDADE
     ---------------------------------------------------------------
     Dois `select` com a mesma lista abrem os dois na PRIMEIRA opção. Numa
     transferência nova, isso é a mesma conta dos dois lados -- e o guarda
     estava ligado só ao evento `change`, que não dispara ao abrir. Resultado:
     formulário com cara de válido, botão habilitado, e a recusa só aparecia
     depois de preencher o valor e clicar.

     O conserto é de duas pontas: escolher um destino DIFERENTE ao abrir, e
     rodar o guarda na abertura em vez de esperar o `change`. As duas juntas,
     porque a primeira sozinha quebraria se existisse só uma conta. */
  if (!grupoId){
    const outras = V2.contas.filter((c) => c.ativo !== false && c.id !== $("tf_origem").value);
    if (outras.length) $("tf_destino").value = outras[0].id;
  }
  $("tf_valor").value = saida ? saida.valor : "";
  $("tf_data").value = saida ? saida.data : hojeISO();
  $("tf_descricao").value = saida ? saida.descricao : "";
  $("tf_status").value = saida ? (saida.status === "prevista" ? "prevista" : "realizada") : "realizada";
  $("tf_obs").value = saida ? (saida.obs || "") : "";
  $("tfExcluir").hidden = !grupoId;
  $("tfSalvar").textContent = grupoId ? "Salvar" : "Transferir";
  mostraErro($("tfErro"), "");
  $("dlgTransferencia").showModal();
  confereContasDiferentes();
}

/* A mesma conta dos dois lados é recusada pelo banco. A tela impede antes,
   porque descobrir isso depois de preencher tudo é perda de tempo -- e roda na
   ABERTURA, não só no `change`: foi por não rodar na abertura que a
   transferência ficou bloqueada. */
function confereContasDiferentes(){
  const o = $("tf_origem"), d = $("tf_destino"), b = $("tfSalvar");
  if (!o || !d || !b) return;
  const igual = o.value && o.value === d.value;
  mostraErro($("tfErro"), igual
    ? "Origem e destino precisam ser contas diferentes. Dinheiro não muda de gaveta ficando na mesma."
    : "");
  b.disabled = !!igual;
}

function ligaTransferencia(){
  $("btnTransferir")?.addEventListener("click", () => {
    if (V2.contas.filter((c) => c.ativo !== false).length < 2){
      dep.erro("Transferência precisa de duas contas. Cadastre a segunda primeiro.");
      return;
    }
    abreTransferencia(null);
  });

  $("tf_origem")?.addEventListener("change", confereContasDiferentes);
  $("tf_destino")?.addEventListener("change", confereContasDiferentes);

  $("formTransferencia")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("tfSalvar"); btn.disabled = true;
    const p = {
      contaOrigemId: $("tf_origem").value, contaDestinoId: $("tf_destino").value,
      valor: Number($("tf_valor").value), data: $("tf_data").value,
      descricao: $("tf_descricao").value.trim() || "Transferência",
      obs: $("tf_obs").value.trim(), status: $("tf_status").value,
    };
    const r = transfEditando
      ? await v2.atualizaTransferencia({ ...p, transferenciaId: transfEditando })
      : await v2.criaTransferencia(p);
    btn.disabled = false;
    if (r.erro){ mostraErro($("tfErro"), r.erro); return; }
    $("dlgTransferencia").close();
    await recarrega();
    dep.toast("Dinheiro mudou de gaveta. Patrimônio continua igual.");
  });

  confirmaEmDoisCliques($("tfExcluir"), "Excluir", async () => {
    const r = await v2.removeTransferencia(transfEditando);
    if (r.erro){ mostraErro($("tfErro"), r.erro); return; }
    $("dlgTransferencia").close();
    await recarrega();
    dep.toast("Transferência desfeita, as duas pernas juntas");
  });
}

/* ------------------------------------------------------------ categorias --*/
let catEditando = null;

function renderCategorias(){
  const alvo = $("ctgLista");
  if (!alvo) return;
  $("ctgVazio").hidden = V2.categorias.length > 0;
  if (!V2.categorias.length){ alvo.innerHTML = ""; atualizaPaisDoForm(); return; }

  const linhas = [];
  const desce = (nos) => {
    for (const n of nos){
      linhas.push(`<div class="mini-item" data-nivel="${n.nivel}" data-inativo="${n.ativo === false ? "sim" : "nao"}">
        <span class="ponto-cor" style="--cor:${esc(n.cor || "#1F5E52")}" aria-hidden="true"></span>
        <span class="txt">${esc(n.nome)}<span class="sub"> · ${esc(n.fluxo)}</span></span>
        <button type="button" class="btn ghost sm" data-editar-cat="${esc(n.id)}">Editar</button>
        <button type="button" class="btn ghost sm" data-excluir-cat="${esc(n.id)}">Excluir</button>
      </div>`);
      desce(n.filhos);
    }
  };
  desce(arvoreDeCategorias(V2.categorias));
  alvo.innerHTML = '<div class="mini-lista">' + linhas.join("") + "</div>";
  atualizaPaisDoForm();
}

function atualizaPaisDoForm(){
  $("cg_pai").innerHTML = listaDeOpcoes(
    paisPossiveis(V2.categorias, catEditando)
      .map((c) => ({ id: c.id, rotulo: caminhoDaCategoria(V2.categorias, c.id) })),
    "", "É uma categoria principal");
}

function ligaCategorias(){
  $("btnCategorias")?.addEventListener("click", () => {
    catEditando = null; limpaFormCategoria(); renderCategorias();
    $("dlgCategorias").showModal();
  });

  $("ctgLista")?.addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-editar-cat]");
    if (ed){
      catEditando = ed.getAttribute("data-editar-cat");
      const c = V2.categorias.find((x) => x.id === catEditando);
      $("cg_nome").value = c.nome; $("cg_fluxo").value = c.fluxo;
      $("cg_cor").value = c.cor || "#1F5E52";
      atualizaPaisDoForm(); $("cg_pai").value = c.paiId || "";
      $("cgSalvar").textContent = "Salvar"; $("cgCancelarEdicao").hidden = false;
      $("cg_nome").focus();
      return;
    }
    const ex = e.target.closest("[data-excluir-cat]");
    if (ex){
      const id = ex.getAttribute("data-excluir-cat");
      const filhos = descendentesDe(V2.categorias, id);
      if (ex.getAttribute("data-armado") !== "sim"){
        ex.setAttribute("data-armado", "sim");
        ex.textContent = filhos.length
          ? "Confirmar (leva " + filhos.length + ")" : "Confirmar exclusão";
        setTimeout(() => { ex.removeAttribute("data-armado"); ex.textContent = "Excluir"; }, 4000);
        return;
      }
      const r = await v2.removeCategoria(id);
      if (r.erro){ mostraErro($("cgErro"), r.erro); return; }
      await recarrega(); renderCategorias();
      dep.toast("Categoria excluída");
    }
  });

  $("cgCancelarEdicao")?.addEventListener("click", () => { catEditando = null; limpaFormCategoria(); });

  $("formCategoria")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const modelo = {
      nome: $("cg_nome").value.trim(), paiId: $("cg_pai").value || null,
      fluxo: $("cg_fluxo").value, cor: $("cg_cor").value, ativo: true,
    };
    const r = await v2.salvaCategoria(modelo, catEditando);
    if (r.erro){ mostraErro($("cgErro"), r.erro); return; }
    catEditando = null; limpaFormCategoria();
    await recarrega(); renderCategorias();
    dep.toast("Categoria salva");
  });

  $("btnCategoriasPadrao")?.addEventListener("click", async () => {
    const btn = $("btnCategoriasPadrao"); btn.disabled = true;
    /* duas levas: as filhas precisam do id da mãe, que só existe depois do
       primeiro insert */
    const raizes = await v2.criaCategorias(raizesPadrao());
    if (raizes.erro){ btn.disabled = false; mostraErro($("cgErro"), raizes.erro); return; }
    const filhas = filhasPadrao(raizes.dados);
    const r2 = filhas.length ? await v2.criaCategorias(filhas) : { erro: null };
    btn.disabled = false;
    if (r2.erro){ mostraErro($("cgErro"), r2.erro); return; }
    await recarrega(); renderCategorias();
    dep.toast(quantasCategoriasPadrao() + " categorias criadas");
  });
}

function limpaFormCategoria(){
  $("cg_nome").value = ""; $("cg_pai").value = "";
  $("cg_fluxo").value = "saida"; $("cg_cor").value = "#1F5E52";
  $("cgSalvar").textContent = "Adicionar"; $("cgCancelarEdicao").hidden = true;
  mostraErro($("cgErro"), "");
}

/* ------------------------------------------------------------ recarregar --*/
async function recarrega(){
  const r = await carregaV2();
  if (r && r.erro){ dep.erro("Não deu para atualizar. " + r.erro); return; }
  atualizaFiltrosDeTela();
  renderV2();
}

export function atualizaFiltrosDeTela(){
  const conta = $("txFiltroConta"), cat = $("txFiltroCategoria");
  if (conta) conta.innerHTML = listaDeOpcoes(V2.contas.map((c) => ({ id: c.id, rotulo: c.nome })),
    filtros.contaId, "Todas");
  if (cat) cat.innerHTML = listaDeOpcoes(V2.categorias.map((c) =>
    ({ id: c.id, rotulo: caminhoDaCategoria(V2.categorias, c.id) })), filtros.categoriaId, "Todas");
}

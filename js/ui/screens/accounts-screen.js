/* TELA DE CONTAS, e as instituições que aparecem dentro dela.
 *
 * As instituições ficam aqui, e não em módulo próprio, porque não são uma tela:
 * são o diálogo que a tela de Contas abre para cadastrar quem guarda o dinheiro.
 * Separá-las daria um módulo que só esta tela chama, que é o oposto de reduzir
 * acoplamento.
 */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { money } from "../../core/money.js";
import { TIPOS_DE_CONTA, LIQUIDEZ, rotuloDoTipo, rotuloDaLiquidez, saldoDaConta,
         indicadoresDeContas, porInstituicao, porTipo, podeExcluirConta }
  from "../../domain/accounts.js";
import { CATALOGO_INSTITUICOES } from "../institution-catalog.js";
import { vaiParaAba } from "../navigation.js";
import { V2, dep, recarrega, contaPorId, instPorId } from "./estado.js";
import { dinheiro, selo, listaDeOpcoes, confirmaEmDoisCliques, mostraErro,
         pirulitos, hojeISO } from "./pecas.js";
import * as v2 from "../../data/v2-repository.js";

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

export function ligaContas(){
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

export function ligaInstituicoes(){
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


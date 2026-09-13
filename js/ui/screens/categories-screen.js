/* A ÁRVORE DE CATEGORIAS, dentro de Ajustes. */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { arvoreDeCategorias, caminhoDaCategoria, paisPossiveis, descendentesDe }
  from "../../domain/categories.js";
import { raizesPadrao, filhasPadrao, quantasCategoriasPadrao } from "../category-catalog.js";
import { V2, dep, recarrega } from "./estado.js";
import { listaDeOpcoes, mostraErro } from "./pecas.js";
import * as v2 from "../../data/v2-repository.js";

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

export function ligaCategorias(){
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


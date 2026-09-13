/* A MOLDURA DO APP: os diálogos e a folha "Mais".
 *
 * Não é tela: é o que existe em volta de todas elas. Ficou separado porque
 * nenhuma tela precisa saber que a folha existe, e a folha não precisa saber
 * que telas existem -- ela pergunta ao registro de navegação.
 */
import { $ } from "../../core/dom.js";
import { esc } from "../../core/escape.js";
import { abasDoMais, vaiParaAba } from "../navigation.js";

export function ligaFecharDialogos(){
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fechar]");
    if (b) $(b.getAttribute("data-fechar"))?.close();
  });
}

/* ------------------------------------------------------------ folha Mais --*/
export function montaFolhaMais(){
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


/* A MOLDURA DO APP: os diálogos e a pasta "Mais".
 *
 * Não é tela: é o que existe em volta de todas elas. Ficou separado porque
 * nenhuma tela precisa saber que a pasta existe, e a pasta não precisa saber
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

/* ------------------------------------------------------------ pasta Mais --*/
export function montaFolhaMais(){
  const folha = $("folhaMais"), alvo = $("folhaOpcoes");
  if (!folha || !alvo) return;
  alvo.innerHTML = abasDoMais().map((a) =>
    `<button type="button" id="navs-${esc(a.id)}" role="tab" aria-selected="false"
       aria-controls="p-${esc(a.id)}"><span class="pasta-icone"><svg viewBox="0 0 24 24" aria-hidden="true">${a.icone}</svg></span><span class="pasta-rotulo">${esc(a.rotulo)}</span></button>`).join("");
  const botaoMais = $("navm-mais");
  let relogioFechar;
  const fechaPasta = () => {
    if (!folha.open || folha.classList.contains("fechando")) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches){ folha.close(); return; }
    folha.classList.add("fechando");
    relogioFechar = setTimeout(() => folha.close(), 180);
  };
  /* A pasta liga os próprios cliques em vez de depender de `ligaNavegacao()`:
     os botões dela nascem AQUI, e `ligaNavegacao()` já rodou quando isto
     acontece. Ficaram mudos uma vez por causa dessa ordem. */
  alvo.addEventListener("click", (e) => {
    const b = e.target.closest("button[id^='navs-']");
    if (!b) return;
    vaiParaAba(b.id.slice("navs-".length));
    fechaPasta();
  });
  botaoMais?.addEventListener("click", () => {
    if (folha.open) return;
    folha.showModal();
    botaoMais.setAttribute("aria-expanded", "true");
  });
  $("fecharFolhaMais")?.addEventListener("click", fechaPasta);
  folha.addEventListener("cancel", (e) => { e.preventDefault(); fechaPasta(); });
  folha.addEventListener("click", (e) => { if (e.target === folha) fechaPasta(); });
  folha.addEventListener("close", () => {
    clearTimeout(relogioFechar);
    folha.classList.remove("fechando");
    botaoMais?.setAttribute("aria-expanded", "false");
  });
}


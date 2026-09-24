/* Navegação por abas.
 *
 * Uma aba é uma entrada no registro abaixo. Tudo o que a navegação faz -- ligar
 * o clique, marcar quem está selecionado, mostrar o painel certo, montar os
 * grupos do desktop e o rodapé do celular -- sai daí. Acrescentar uma tela é
 * acrescentar uma linha.
 *
 * Duas decisões que o registro carrega:
 *
 * `grupo` desenha a lateral do desktop. Ele existia sem efeito desde a fase
 * anterior, esperando as telas que agora chegaram.
 *
 * `rodape` resolve o celular. Onze ícones espremidos em 360 px não é
 * navegação, é enigma. Quatro abas vão para o rodapé, o quinto lugar é o
 * "Mais", e o resto vive atrás dele -- a divisão é declarada aqui, não
 * espalhada no CSS.
 *
 * "Metas" entrou quando a tela passou a existir, e não antes. Entrada de menu
 * que abre o nada é pior do que menu curto: ela ensina a desconfiar do menu.
 * "Calendário" é a aba `mes`: o rótulo mudou quando a tela virou calendário de
 * verdade, e o id ficou, porque id não é rótulo.
 *
 * Contrato do DOM, e é só isto:
 *   painel      <section id="p-<id>">
 *   lateral     <button id="nav-<id>">        (desktop)
 *   rodapé      <button id="navm-<id>">       (celular)
 *   folha Mais  <button id="navs-<id>">       (celular, dentro do sheet)
 *   atalho      <button id="nav-<id>M">       (topo do celular, opcional)
 * Qualquer um pode faltar: quem não existe é ignorado.
 */
import { $ } from "../core/dom.js";

/* A ordem aqui é a ordem de leitura da lateral. */
/* O `icone` é o conteúdo do <svg>, e ele mora AQUI pela mesma razão que o
   resto: a lateral é montada a partir deste registro. Antes ela era escrita à
   mão no HTML, e a consequência apareceu duas vezes na mesma sessão --
   Assinaturas foi parar em PLANEJAMENTO e Grupos no rodapé, porque o registro
   dizia uma coisa e o markup dizia outra. Agora só existe uma verdade. */
export const ABAS = [
  { id: "painel",      rotulo: "Início",      grupo: "VISÃO",          rodape: true,
    icone: '<path d="M3 3h7v8H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 15h7v6H3z"/>' },
  /* O id continua `mes`: ele é conhecido pelo index.html, pelos testes e pela
     navegação, e renomear um id para trocar um RÓTULO é pagar caro por nada.
     O que a pessoa lê mudou; o que o código chama, não. */
  { id: "mes",         rotulo: "Calendário",  grupo: "VISÃO",          rodape: true,
    icone: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>' },
  { id: "contas",      rotulo: "Contas",      grupo: "MEU DINHEIRO",   rodape: true,
    icone: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>' },
  { id: "cartoes",     rotulo: "Cartões",     grupo: "MEU DINHEIRO",   rodape: false,
    icone: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 15h3"/>' },
  { id: "transacoes",  rotulo: "Transações",  grupo: "MEU DINHEIRO",   rodape: true,
    icone: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>' },
  { id: "receitas",    rotulo: "Receitas",    grupo: "MEU DINHEIRO",   rodape: false,
    icone: '<path d="M3 7l6 6 4-4 8 8"/><path d="M21 13v4h-4"/>' },
  { id: "dividas",     rotulo: "Dívidas",     grupo: "PLANEJAMENTO",   rodape: false,
    icone: '<path d="M3 17l6-6 4 4 8-8"/><path d="M21 11V7h-4"/>' },
  { id: "metas",       rotulo: "Metas",       grupo: "PLANEJAMENTO",   rodape: false,
    icone: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>' },
  { id: "proj",        rotulo: "Projeção",    grupo: "PLANEJAMENTO",   rodape: false,
    icone: '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>' },
  { id: "assinaturas", rotulo: "Assinaturas", grupo: "ROTINAS",        rodape: false,
    icone: '<path d="M4 12a8 8 0 0 1 13.6-5.7M20 12a8 8 0 0 1-13.6 5.7"/><path d="M17 3v4h-4M7 21v-4h4"/>' },
  { id: "grupos",      rotulo: "Grupos",      grupo: "ROTINAS",        rodape: false,
    icone: '<circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M16 6.5a2.8 2.8 0 0 1 0 5.4M17 19a6 6 0 0 0-1.5-4"/>' },
  { id: "ajustes",     rotulo: "Ajustes",     grupo: "CONFIGURAÇÕES",  rodape: false,
    icone: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>' },
];

export const idsDasAbas = () => ABAS.map((a) => a.id);
export const abaPorId   = (id) => ABAS.find((a) => a.id === id) || null;
export const grupoDaAba = (id) => (abaPorId(id) || {}).grupo || null;

/* No máximo quatro: o quinto lugar do rodapé é o botão "Mais". */
export const abasDoRodape = () => ABAS.filter((a) => a.rodape).slice(0, 4);
export const abasDoMais   = () => ABAS.filter((a) => !a.rodape);

/* Os grupos da lateral, na ordem em que aparecem, sem repetir. */
export function gruposDaLateral(){
  const fora = [];
  for (const a of ABAS){
    let g = fora.find((x) => x.nome === a.grupo);
    if (!g){ g = { nome: a.grupo, abas: [] }; fora.push(g); }
    g.abas.push(a);
  }
  return fora;
}

/* Quem quiser reagir à troca de aba -- recarregar dado, focar um campo --
   registra aqui, em vez de a navegação passar a conhecer cada tela. */
const aoTrocar = [];
export const quandoTrocarDeAba = (fn) => { aoTrocar.push(fn); };

/* os quatro lugares de onde uma aba pode ser acionada ou marcada */
const alvosDe = (id) => [$("nav-" + id), $("navm-" + id), $("navs-" + id), $("nav-" + id + "M")];

/* A lente é uma única peça que acompanha a aba escolhida. A posição vem do
   botão real, inclusive quando a largura do celular ou o texto muda. */
function posicionaLente(nav, ativo){
  if (!nav || !ativo || !nav.getClientRects().length) return;
  const origem = nav.getBoundingClientRect();
  const alvo = ativo.getBoundingClientRect();
  nav.style.setProperty("--lens-left", `${alvo.left - origem.left + nav.scrollLeft}px`);
  nav.style.setProperty("--lens-top", `${alvo.top - origem.top + nav.scrollTop}px`);
  nav.style.setProperty("--lens-width", `${alvo.width}px`);
  nav.style.setProperty("--lens-height", `${alvo.height}px`);
  nav.style.setProperty("--lens-opacity", "1");
}

function atualizaLentes(){
  const lateral = document.querySelector(".lateral nav[role='tablist']");
  const movel = document.querySelector("nav.rodapenav");
  posicionaLente(lateral, lateral?.querySelector('.navitem[aria-selected="true"]'));
  posicionaLente(movel, movel?.querySelector('.navitem[aria-selected="true"]'));
}

/* o mesmo estado alimenta a lateral, o rodapé, a folha "Mais" e o atalho do
   topo; um só lugar decide quem está selecionado */
export function vaiParaAba(destino){
  for (const { id } of ABAS){
    const sel = String(id === destino);
    for (const el of alvosDe(id)) el?.setAttribute("aria-selected", sel);
    const painel = $("p-" + id);
    if (painel) painel.hidden = id !== destino;
  }
  /* o botão "Mais" fica marcado enquanto uma das telas de dentro está aberta,
     senão o rodapé não mostra onde a pessoa está */
  const noMais = abasDoMais().some((a) => a.id === destino);
  $("navm-mais")?.setAttribute("aria-selected", String(noMais));
  requestAnimationFrame(atualizaLentes);

  /* re-dispara a animação de entrada do painel que acabou de aparecer */
  const p = $("p-" + destino);
  if (p){ p.style.animation = "none"; void p.offsetWidth; p.style.animation = ""; }

  for (const fn of aoTrocar) fn(destino);
}

/* A lateral do desktop, montada a partir do registro. "CONFIGURAÇÕES" fica de
   fora daqui: Ajustes vive no rodapé da lateral, junto de Atualizar e do tema,
   e é lá que ele é procurado. */
export function montaLateral(){
  const nav = document.querySelector(".lateral nav[role='tablist']");
  if (!nav) return;
  nav.innerHTML = gruposDaLateral()
    .filter((g) => g.nome !== "CONFIGURAÇÕES")
    .map((g) => '<p class="grupo-nav">' + g.nome + "</p>"
      + g.abas.map(botaoDaLateral).join(""))
    .join("");
}

/* O rodapé do celular: as quatro do registro, e o "Mais" que já está no HTML
   porque ele não é uma aba -- é uma folha. */
export function montaRodapeMovel(){
  const nav = document.querySelector("nav.rodapenav");
  const mais = nav && nav.querySelector("#navm-mais");
  if (!nav || !mais) return;
  mais.insertAdjacentHTML("beforebegin", abasDoRodape()
    .map((a) => botaoDaLateral(a).replace('id="nav-', 'id="navm-')).join(""));
}

const botaoDaLateral = (a) =>
  '<button class="navitem" id="nav-' + a.id + '" role="tab" aria-selected="false"'
  + ' aria-controls="p-' + a.id + '">'
  + '<svg viewBox="0 0 24 24" aria-hidden="true">' + a.icone + "</svg>"
  + "<span>" + a.rotulo + "</span></button>";

/* Liga os cliques. Chamar mais de uma vez duplicaria os ouvintes, então a
   função guarda se já rodou. */
let ligada = false;
export function ligaNavegacao(){
  if (ligada) return;
  ligada = true;
  /* antes de ligar os cliques, os botões precisam existir */
  montaLateral();
  montaRodapeMovel();
  for (const nav of [document.querySelector(".lateral nav[role='tablist']"), document.querySelector("nav.rodapenav")]){
    nav?.addEventListener("pointermove", (e) => {
      const vidro = nav.closest(".lateral") || nav;
      const caixa = vidro.getBoundingClientRect();
      vidro.style.setProperty("--glx", `${e.clientX - caixa.left}px`);
      vidro.style.setProperty("--gly", `${e.clientY - caixa.top}px`);
    });
    nav?.addEventListener("pointerleave", () => {
      const vidro = nav.closest(".lateral") || nav;
      vidro.style.removeProperty("--glx");
      vidro.style.removeProperty("--gly");
    });
  }
  window.addEventListener("resize", atualizaLentes);
  for (const { id } of ABAS)
    for (const el of alvosDe(id))
      el?.addEventListener("click", () => vaiParaAba(id));
  vaiParaAba("painel");
}

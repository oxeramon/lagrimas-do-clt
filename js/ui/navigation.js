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
 *   pasta Mais  <button id="navs-<id>">       (celular, dentro da pasta)
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
    icone: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/>' },
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
  { id: "perfil",      rotulo: "Usuário",     grupo: "CONFIGURAÇÕES", rodape: false,
    icone: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>' },
  { id: "ajustes",     rotulo: "Ajustes",     grupo: "CONFIGURAÇÕES",  rodape: false,
    icone: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>' },
];

export const idsDasAbas = () => ABAS.map((a) => a.id);
export const abaPorId   = (id) => ABAS.find((a) => a.id === id) || null;
export const grupoDaAba = (id) => (abaPorId(id) || {}).grupo || null;

/* No máximo quatro: o quinto lugar do rodapé é o botão "Mais". */
export const abasDoRodape = () => ABAS.filter((a) => a.rodape).slice(0, 4);
export const abasDoMais   = () => ABAS.filter((a) => !a.rodape && a.id !== "perfil");

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
const relogiosDaLente = new WeakMap();
const arrastesDaLente = new WeakMap();
const molasDaLente = new WeakMap();
let quadroDeContraste = 0;

/* A barra flutua sobre cartões claros e sobre o resumo verde. Cada botão
   usa a superfície que está exatamente atrás dele, inclusive após rolar. */
function sobreFundoEscuro(nav, item){
  const r = item.getBoundingClientRect();
  for (const el of document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)){
    if (nav.contains(el) || el === nav) continue;
    const partes = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number);
    if (!partes || (partes[3] ?? 1) < .85) continue;
    const linear = partes.slice(0,3).map((c) => {
      const v = c / 255;
      return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    });
    return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2] < .30;
  }
  return false;
}

function atualizaContrasteRodape(){
  const nav = document.querySelector("nav.rodapenav");
  if (!nav || !nav.getClientRects().length) return;
  for (const item of nav.querySelectorAll(".navitem"))
    item.classList.toggle("sobre-escuro", sobreFundoEscuro(nav, item));
  const focado = nav.querySelector(".glass-focused") || nav.querySelector('.navitem[aria-selected="true"]');
  nav.classList.toggle("lente-sobre-escuro", Boolean(focado?.classList.contains("sobre-escuro")));
}

function agendaContrasteRodape(){
  if (quadroDeContraste) return;
  quadroDeContraste = requestAnimationFrame(() => {
    quadroDeContraste = 0;
    atualizaContrasteRodape();
  });
}

/* O indicador do rodapé se move por uma mola real em JavaScript. Durante o
   arraste ele segue o dedo sem atraso; ao soltar, assenta na aba escolhida. */
function moveLenteMovel(nav, destino){
  const anterior = molasDaLente.get(nav);
  if (anterior?.frame) cancelAnimationFrame(anterior.frame);
  const atual = parseFloat(nav.style.getPropertyValue("--lens-left"));
  const instantaneo = !Number.isFinite(atual) || !nav.style.getPropertyValue("--lens-opacity")
    || matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (instantaneo){
    nav.style.setProperty("--lens-left", `${destino}px`);
    molasDaLente.set(nav, { x:destino, velocidade:0, frame:0 });
    return;
  }
  const mola = { x:atual, velocidade:anterior?.velocidade || 0, frame:0 };
  molasDaLente.set(nav, mola);
  const passo = () => {
    mola.velocidade = (mola.velocidade + (destino - mola.x) * .19) * .76;
    mola.x += mola.velocidade;
    if (Math.abs(destino - mola.x) < .2 && Math.abs(mola.velocidade) < .2){
      mola.x = destino;
      mola.velocidade = 0;
      mola.frame = 0;
    } else mola.frame = requestAnimationFrame(passo);
    nav.style.setProperty("--lens-left", `${mola.x}px`);
  };
  mola.frame = requestAnimationFrame(passo);
}

/* A lente é uma única peça que acompanha a aba escolhida. A posição vem do
   botão real, inclusive quando a largura do celular ou o texto muda. */
function posicionaLente(nav, ativo){
  if (!nav || !ativo || !nav.getClientRects().length) return;
  const origem = nav.getBoundingClientRect();
  const alvo = ativo.getBoundingClientRect();
  const movel = nav.classList.contains("rodapenav");
  const margemX = movel ? 7 : 4;
  const margemY = movel ? 7 : 2;
  const esquerda = alvo.left - origem.left + nav.scrollLeft + margemX;
  nav.style.setProperty("--lens-target", `${esquerda}px`);
  if (movel) moveLenteMovel(nav, esquerda);
  else nav.style.setProperty("--lens-left", `${esquerda}px`);
  nav.style.setProperty("--lens-top", `${movel ? margemY : alvo.top - origem.top + nav.scrollTop + margemY}px`);
  nav.style.setProperty("--lens-width", `${alvo.width - margemX * 2}px`);
  nav.style.setProperty("--lens-height", `${movel ? origem.height - margemY * 2 : alvo.height - margemY * 2}px`);
  nav.style.setProperty("--lens-opacity", "1");
  nav.querySelector(".glass-focused")?.classList.remove("glass-focused");
  ativo.classList.add("glass-focused");
  if (movel) nav.classList.toggle("lente-sobre-escuro", ativo.classList.contains("sobre-escuro"));
  nav.classList.add("lens-moving");
  clearTimeout(relogiosDaLente.get(nav));
  relogiosDaLente.set(nav, setTimeout(() => nav.classList.remove("lens-moving"), 560));
}

function sincronizaLente(nav){
  if (!nav) return;
  const ativo = nav.querySelector('.navitem[aria-selected="true"]');
  if (ativo){
    posicionaLente(nav, ativo);
    if (!nav.classList.contains("rodapenav")){
      const painel = nav.closest(".lateral")?.getBoundingClientRect();
      const item = ativo.getBoundingClientRect();
      nav.style.setProperty("--lens-opacity", painel && item.top >= painel.top + 6 && item.bottom <= painel.bottom - 6 ? "1" : "0");
    }
  }
  else {
    nav.style.setProperty("--lens-opacity", "0");
    nav.querySelector(".glass-focused")?.classList.remove("glass-focused");
  }
}

function arrastaLente(nav, evento){
  const estado = arrastesDaLente.get(nav);
  if (!estado || estado.id !== evento.pointerId) return;
  const caixa = nav.getBoundingClientRect();
  const largura = parseFloat(nav.style.getPropertyValue("--lens-width"));
  const centro = Math.max(7 + largura / 2, Math.min(caixa.width - 7 - largura / 2, evento.clientX - caixa.left));
  const anterior = molasDaLente.get(nav);
  if (anterior?.frame) cancelAnimationFrame(anterior.frame);
  const esquerda = centro - largura / 2;
  molasDaLente.set(nav, { x:esquerda, velocidade:Math.max(-14,Math.min(14,esquerda - (anterior?.x ?? esquerda))), frame:0 });
  nav.style.setProperty("--lens-left", `${esquerda}px`);
  nav.style.setProperty("--lens-glint-x", `${Math.round(50 + Math.max(-25, Math.min(25, (evento.clientX - estado.ultimoX) * 2)))}%`);
  estado.ultimoX = evento.clientX;
  estado.alvo = [...nav.querySelectorAll(".navitem")].reduce((maisProximo, item) =>
    Math.abs(item.getBoundingClientRect().left + item.getBoundingClientRect().width / 2 - evento.clientX)
      < Math.abs(maisProximo.getBoundingClientRect().left + maisProximo.getBoundingClientRect().width / 2 - evento.clientX)
      ? item : maisProximo);
  nav.querySelector(".glass-focused")?.classList.remove("glass-focused");
  estado.alvo.classList.add("glass-focused");
  nav.classList.toggle("lente-sobre-escuro", estado.alvo.classList.contains("sobre-escuro"));
}

function atualizaLentes(){
  const lateral = document.querySelector(".lateral nav[role='tablist']");
  const movel = document.querySelector("nav.rodapenav");
  sincronizaLente(lateral);
  sincronizaLente(movel);
}

/* o mesmo estado alimenta a lateral, o rodapé, a pasta "Mais" e o atalho do
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
  agendaContrasteRodape();

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
   porque ele não é uma aba -- abre a pasta de seções. */
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
    nav?.addEventListener("pointerover", (e) => {
      if (!nav.classList.contains("rodapenav")) return;
      if (e.pointerType === "touch" || arrastesDaLente.has(nav)) return;
      const item = e.target.closest(".navitem");
      if (item && nav.contains(item)) posicionaLente(nav, item);
    });
    nav?.addEventListener("focusin", (e) => {
      if (!nav.classList.contains("rodapenav")) return;
      const item = e.target.closest(".navitem");
      if (item && nav.contains(item)) posicionaLente(nav, item);
    });
    nav?.addEventListener("pointermove", (e) => {
      const arraste = arrastesDaLente.get(nav);
      if (arraste && arraste.id === e.pointerId){
        if (Math.abs(e.clientX - arraste.inicioX) > 4){
          arraste.moveu = true;
          nav.classList.add("lens-dragging");
          arrastaLente(nav, e);
        }
        return;
      }
      const vidro = nav.closest(".lateral") || nav;
      const caixa = vidro.getBoundingClientRect();
      vidro.style.setProperty("--glx", `${e.clientX - caixa.left}px`);
      vidro.style.setProperty("--gly", `${e.clientY - caixa.top}px`);
    });
    nav?.addEventListener("pointerleave", () => {
      if (arrastesDaLente.has(nav)) return;
      const vidro = nav.closest(".lateral") || nav;
      vidro.style.removeProperty("--glx");
      vidro.style.removeProperty("--gly");
      sincronizaLente(nav);
    });
    if (nav?.classList.contains("rodapenav")){
      nav.addEventListener("pointerdown", (e) => {
        if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
        const item = e.target.closest(".navitem");
        if (!item || !nav.contains(item)) return;
        const mola = molasDaLente.get(nav);
        if (mola?.frame) cancelAnimationFrame(mola.frame);
        arrastesDaLente.set(nav, {id:e.pointerId,inicioX:e.clientX,ultimoX:e.clientX,alvo:item,moveu:false});
        nav.setPointerCapture(e.pointerId);
      });
      nav.addEventListener("pointerup", (e) => {
        const estado = arrastesDaLente.get(nav);
        if (!estado || estado.id !== e.pointerId) return;
        arrastesDaLente.delete(nav);
        nav.classList.remove("lens-dragging");
        // Com pointer capture, o clique nativo pode cair na barra em vez do
        // botão; acionamos o alvo do toque ou o escolhido ao arrastar.
        nav.dataset.suprimirClique = "1";
        estado.alvo.click();
        setTimeout(() => delete nav.dataset.suprimirClique, 0);
      });
      nav.addEventListener("pointercancel", () => {
        arrastesDaLente.delete(nav);
        nav.classList.remove("lens-dragging");
        sincronizaLente(nav);
      });
      nav.addEventListener("click", (e) => {
        if (nav.dataset.suprimirClique && e.isTrusted){
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }, true);
    }
    nav?.addEventListener("focusout", (e) => {
      if (!nav.contains(e.relatedTarget))
        sincronizaLente(nav);
    });
  }
  window.addEventListener("resize", atualizaLentes);
  window.addEventListener("resize", agendaContrasteRodape);
  const lateral = document.querySelector(".lateral");
  lateral?.addEventListener("scroll", () => sincronizaLente(lateral.querySelector("nav")), {passive:true});
  document.addEventListener("scroll", agendaContrasteRodape, { passive:true, capture:true });
  const conteudo = document.querySelector("main");
  if (conteudo) new MutationObserver(agendaContrasteRodape)
    .observe(conteudo, { subtree:true, childList:true, attributes:true, attributeFilter:["hidden","style"] });
  for (const { id } of ABAS)
    for (const el of alvosDe(id))
      el?.addEventListener("click", () => vaiParaAba(id));
  vaiParaAba("painel");
}

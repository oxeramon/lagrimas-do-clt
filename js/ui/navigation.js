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
 * `rodape` resolve o celular. Oito ícones espremidos em 360 px não é
 * navegação, é enigma. Quatro abas vão para o rodapé, o resto vive atrás de
 * "Mais" -- e a divisão é declarada aqui, não espalhada no CSS.
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
export const ABAS = [
  { id: "painel",     rotulo: "Início",      grupo: "VISÃO GERAL",    rodape: true },
  { id: "mes",        rotulo: "Mês",         grupo: "VISÃO GERAL",    rodape: true },
  { id: "contas",     rotulo: "Contas",      grupo: "MEU DINHEIRO",   rodape: true },
  { id: "cartoes",    rotulo: "Cartões",     grupo: "MEU DINHEIRO",   rodape: false },
  { id: "transacoes", rotulo: "Transações",  grupo: "MEU DINHEIRO",   rodape: true },
  { id: "receitas",   rotulo: "Receitas",    grupo: "MEU DINHEIRO",   rodape: false },
  { id: "dividas",    rotulo: "Dívidas",     grupo: "PLANEJAMENTO",   rodape: false },
  { id: "proj",       rotulo: "Projeção",    grupo: "PLANEJAMENTO",   rodape: false },
  { id: "assinaturas", rotulo: "Assinaturas", grupo: "ROTINAS",        rodape: false },
  { id: "ajustes",    rotulo: "Ajustes",     grupo: "CONFIGURAÇÕES",  rodape: false },
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

  /* re-dispara a animação de entrada do painel que acabou de aparecer */
  const p = $("p-" + destino);
  if (p){ p.style.animation = "none"; void p.offsetWidth; p.style.animation = ""; }

  for (const fn of aoTrocar) fn(destino);
}

/* Liga os cliques. Chamar mais de uma vez duplicaria os ouvintes, então a
   função guarda se já rodou. */
let ligada = false;
export function ligaNavegacao(){
  if (ligada) return;
  ligada = true;
  for (const { id } of ABAS)
    for (const el of alvosDe(id))
      el?.addEventListener("click", () => vaiParaAba(id));
}

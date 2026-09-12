/* Navegação por abas.
 *
 * Uma aba é uma entrada no registro abaixo. Tudo o que a navegação faz -- ligar
 * o clique, marcar quem está selecionado, mostrar o painel certo -- sai daí,
 * então acrescentar uma tela é acrescentar uma linha, e não mexer no shell.
 *
 * O `grupo` já existe e ainda não é desenhado. Ele é a preparação para a
 * navegação agrupada que vem depois:
 *
 *     VISÃO GERAL     Painel · Mês · Calendário
 *     MEU DINHEIRO    Contas · Cartões · Transações · Receitas
 *     PLANEJAMENTO    Dívidas · Metas · Projeção
 *     COMPARTILHADO   Grupos
 *     CONFIGURAÇÕES   Ajustes
 *
 * Nenhuma dessas telas novas está aqui, de propósito: menu cheio de item que
 * abre tela vazia é pior do que menu curto. Quando "Contas" existir, ela entra
 * como `{ id: "contas", grupo: "MEU DINHEIRO" }` e ganha seu `<section
 * id="p-contas">` -- a navegação não muda.
 *
 * Contrato do DOM, e é só isto:
 *   painel      <section id="p-<id>">
 *   lateral     <button id="nav-<id>">        (desktop)
 *   rodapé      <button id="navm-<id>">       (celular, até 5 itens)
 *   atalho      <button id="nav-<id>M">       (topo do celular, opcional)
 * Qualquer um pode faltar: quem não existe é ignorado.
 */
import { $ } from "../core/dom.js";

/* A ordem aqui é a ordem de leitura, não a de desenho -- quem desenha é o
   HTML. `grupo` é para a fase seguinte e hoje não tem efeito. */
export const ABAS = [
  { id: "painel",   rotulo: "Painel",    grupo: "VISÃO GERAL" },
  { id: "mes",      rotulo: "Mês",       grupo: "VISÃO GERAL" },
  { id: "dividas",  rotulo: "Dívidas",   grupo: "PLANEJAMENTO" },
  { id: "receitas", rotulo: "Receitas",  grupo: "MEU DINHEIRO" },
  { id: "proj",     rotulo: "Projeção",  grupo: "PLANEJAMENTO" },
  { id: "ajustes",  rotulo: "Ajustes",   grupo: "CONFIGURAÇÕES" },
];

export const idsDasAbas = () => ABAS.map(a => a.id);

/* os três lugares de onde uma aba pode ser acionada ou marcada */
const alvosDe = (id) => [$("nav-" + id), $("navm-" + id), $("nav-" + id + "M")];

/* o mesmo estado alimenta a lateral, o rodapé do celular e o atalho do topo;
   um só lugar decide quem está selecionado */
export function vaiParaAba(destino){
  for (const { id } of ABAS){
    const sel = String(id === destino);
    for (const el of alvosDe(id)) el?.setAttribute("aria-selected", sel);
    const painel = $("p-" + id);
    if (painel) painel.hidden = id !== destino;
  }
  /* re-dispara a animação de entrada do painel que acabou de aparecer */
  const p = $("p-" + destino);
  if (p){ p.style.animation = "none"; void p.offsetWidth; p.style.animation = ""; }
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

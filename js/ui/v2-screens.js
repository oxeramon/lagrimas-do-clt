/* A FACHADA DAS TELAS DA V2.
 *
 * Este arquivo já teve 1.887 linhas e cinco telas dentro. Elas agora moram em
 * `js/ui/screens/`, uma por responsabilidade, e o que sobrou aqui é só o que
 * uma fachada deve ser: a ordem em que as telas são ligadas, a ordem em que
 * são desenhadas, e o nome pelo qual o `index.html` as conhece.
 *
 * POR QUE A FACHADA CONTINUA EXISTINDO
 *
 * O `index.html` importa dez nomes daqui. Espalhar esses dez por oito arquivos
 * transformaria toda mudança de estrutura interna numa edição do HTML, que é o
 * arquivo que menos se quer tocar. A fachada é o contrato; atrás dela as telas
 * podem ser reorganizadas sem ninguém do lado de fora saber.
 *
 * QUEM CONHECE QUEM
 *
 *   telas   -> estado.js   (lêem V2, chamam recarrega, usam os consultores)
 *   telas   -> pecas.js    (selo, dois cliques, campo de erro, pirulito)
 *   telas   -> js/domain/  (a regra financeira, que não sabe que há DOM)
 *   fachada -> telas       (só aqui, e em nenhum outro sentido)
 *
 * Nenhuma tela importa outra tela. As duas vezes em que isso quase aconteceu --
 * cartões com fatura, transações com transferência -- a resposta foi mover a
 * leitura de estado para `estado.js`, não criar um módulo de utilidades.
 */
import { $ } from "../core/dom.js";
import { vaiParaAba, quandoTrocarDeAba } from "./navigation.js";

import { V2, dep, registraRecarga } from "./screens/estado.js";
import { ligaFecharDialogos, montaFolhaMais } from "./screens/shell.js";
import { renderContas, ligaContas, ligaInstituicoes } from "./screens/accounts-screen.js";
import { renderTransacoes, ligaTransacoes, atualizaFiltrosDeTela }
  from "./screens/transactions-screen.js";
import { ligaTransferencia } from "./screens/transfer-dialog.js";
import { ligaEstorno } from "./screens/reversal-dialog.js";
import { ligaCategorias } from "./screens/categories-screen.js";
import { ligaLiquidacao } from "./screens/reconciliation-screen.js";
import { renderCartoes, ligaCartoes, ligaCompraDeCartao } from "./screens/cards-screen.js";
import { ligaFatura } from "./screens/invoice-screen.js";
import { renderAssinaturas, ligaAssinaturas } from "./screens/subscriptions-screen.js";
import { renderGrupos, ligaGrupos } from "./screens/groups-screen.js";
import { renderMetas, ligaMetas } from "./screens/goals-screen.js";
import { renderCalendario, ligaCalendario } from "./screens/calendar-screen.js";

/* O que o `index.html` conhece. Mantido nome por nome, de propósito: a
   modularização não pode custar uma edição no HTML. */
export { V2, carregaV2, carregaLiquidacoes, carregaCartoesEFaturas,
         carregaAssinaturas, carregaGruposEsaldos, carregaTransacoesDoMes,
         carregaMetas }
  from "./screens/estado.js";
export { atualizaFiltrosDeTela, vaiParaMes, renderTransacoes }
  from "./screens/transactions-screen.js";
export { abreLiquidacao, pontePronta, indiceDaPonte, vinculoDe, contaDoVinculo }
  from "./screens/reconciliation-screen.js";
export { diaLegivel } from "./screens/pecas.js";
export { renderContas } from "./screens/accounts-screen.js";
export { renderCartoes } from "./screens/cards-screen.js";
export { renderAssinaturas } from "./screens/subscriptions-screen.js";
export { renderGrupos } from "./screens/groups-screen.js";
export { renderMetas } from "./screens/goals-screen.js";
export { renderCalendario, registraFonteDaV1 } from "./screens/calendar-screen.js";

export function ligaTelasV2(deps){
  Object.assign(dep, deps || {});

  montaFolhaMais();
  ligaFecharDialogos();
  $("btnVerContas")?.addEventListener("click", () => vaiParaAba("contas"));
  ligaContas();
  ligaInstituicoes();
  ligaTransacoes();
  ligaTransferencia();
  ligaEstorno();
  ligaCategorias();
  ligaLiquidacao();
  ligaCartoes();
  ligaCompraDeCartao();
  ligaFatura();
  ligaAssinaturas();
  ligaGrupos();
  ligaMetas();
  ligaCalendario();

  /* o botão flutuante só faz sentido onde há o que lançar */
  quandoTrocarDeAba((destino) => {
    const fab = $("btnFlutuante");
    if (fab) fab.hidden = !(destino === "transacoes" && V2.contas.length > 0);
  });
}

export function renderV2(){
  renderContas();
  renderCartoes();
  renderAssinaturas();
  renderGrupos();
  renderMetas();
  renderCalendario();
  renderTransacoes();
}

/* A inscrição na recarga fica AQUI, e não dentro de cada tela, por uma razão de
   comportamento: `recarrega()` atualizava os filtros e só então desenhava,
   nesta ordem exata. Registrar tela por tela espalharia essa ordem por oito
   arquivos e a deixaria à mercê da ordem dos imports. */
registraRecarga(() => { atualizaFiltrosDeTela(); renderV2(); });

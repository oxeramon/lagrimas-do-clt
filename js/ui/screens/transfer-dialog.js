/* O DIÁLOGO DE TRANSFERÊNCIA.
 *
 * Módulo próprio, e não um pedaço da tela de Transações, porque ele carrega uma
 * regra que só existe aqui: as duas pernas são UMA operação, e a tela precisa
 * impedir origem igual a destino ANTES do clique. Foi exatamente esse guarda,
 * preso ao evento `change` que não dispara ao abrir, que travou a primeira
 * transferência real do produto.
 */
import { $ } from "../../core/dom.js";
import { V2, dep, recarrega, opcoesDeConta } from "./estado.js";
import { confirmaEmDoisCliques, mostraErro, hojeISO } from "./pecas.js";
import * as v2 from "../../data/v2-repository.js";

/* -------------------------------------------------------- transferência --*/
let transfEditando = null;

export function abreTransferencia(grupoId){
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

export function ligaTransferencia(){
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


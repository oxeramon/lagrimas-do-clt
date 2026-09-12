/* Contas: tipos, liquidez e os números da tela.
 *
 * Nada aqui consulta banco nem toca DOM. O saldo NÃO é calculado aqui de
 * propósito: quem soma é a view `saldos_de_conta`, no Postgres, e é a única
 * fonte. Duplicar a soma no frontend criaria dois números com o mesmo nome
 * discordando um do outro -- que é exatamente o defeito que a V2 nasceu para
 * não ter.
 *
 * O que este módulo faz é AGRUPAR o que já veio somado.
 */

export const TIPOS_DE_CONTA = [
  { id: "corrente",     rotulo: "Conta corrente" },
  { id: "poupanca",     rotulo: "Poupança" },
  { id: "carteira",     rotulo: "Carteira" },
  { id: "investimento", rotulo: "Investimento" },
  { id: "fgts",         rotulo: "FGTS" },
  { id: "outro",        rotulo: "Outro" },
];

/* `restrita` é o FGTS e os parentes dele: dinheiro que é seu, conta como
   patrimônio, e não paga a conta de luz este mês. `bloqueada` é o que está
   preso por decisão de terceiro -- penhora, bloqueio judicial. */
export const LIQUIDEZ = [
  { id: "livre",     rotulo: "Disponível",  ajuda: "dá para usar hoje" },
  { id: "restrita",  rotulo: "Restrito",    ajuda: "é seu, mas não dá para sacar agora" },
  { id: "bloqueada", rotulo: "Bloqueado",   ajuda: "preso por decisão de terceiro" },
];

export const rotuloDoTipo = (id) =>
  (TIPOS_DE_CONTA.find((t) => t.id === id) || { rotulo: "Outro" }).rotulo;
export const rotuloDaLiquidez = (id) =>
  (LIQUIDEZ.find((l) => l.id === id) || { rotulo: "Disponível" }).rotulo;

/* O saldo de uma conta, vindo da view. `null` quando a conta ainda não
   apareceu na view -- e `null` NÃO é zero: a tela precisa saber a diferença
   entre "saldo zero" e "ainda não sei". */
export function saldoDaConta(saldos, contaId){
  const s = (saldos || []).find((x) => x.contaId === contaId);
  return s ? Number(s.saldo) : null;
}

/* Os números do topo da tela de Contas.
 *
 * Sobre o nome: isto NÃO é patrimônio líquido, e chamar assim seria o tipo de
 * erro de rótulo que já custou caro neste projeto. Patrimônio líquido desconta
 * obrigação, e as obrigações ainda moram na V1. Aqui é só o que está nas
 * contas.
 *
 * Conta inativa fica fora: ela é histórico, não dinheiro de hoje. */
export function indicadoresDeContas(contas, saldos){
  const ativas = (contas || []).filter((c) => c.ativo !== false);
  const zero = { total: 0, disponivel: 0, restrito: 0, bloqueado: 0,
                 quantidade: ativas.length, inativas: (contas || []).length - ativas.length,
                 semSaldo: 0 };
  return ativas.reduce((acc, c) => {
    const s = saldoDaConta(saldos, c.id);
    if (s === null){ acc.semSaldo += 1; return acc; }
    acc.total += s;
    if (c.liquidez === "restrita")       acc.restrito  += s;
    else if (c.liquidez === "bloqueada") acc.bloqueado += s;
    else                                  acc.disponivel += s;
    return acc;
  }, zero);
}

/* Distribuição por instituição, já ordenada do maior para o menor. Conta sem
   instituição vira um grupo próprio em vez de sumir. */
export function porInstituicao(contas, saldos, instituicoes){
  const nomeDe = new Map((instituicoes || []).map((i) => [i.id, i]));
  const grupos = new Map();
  for (const c of (contas || []).filter((x) => x.ativo !== false)){
    const inst = c.instituicaoId ? nomeDe.get(c.instituicaoId) : null;
    const chave = inst ? inst.id : "sem";
    const atual = grupos.get(chave) || {
      id: chave,
      nome: inst ? inst.nome : "Sem instituição",
      cor: inst ? inst.cor : null,
      logo: inst ? inst.logo : "",
      total: 0, contas: 0,
    };
    atual.total += saldoDaConta(saldos, c.id) || 0;
    atual.contas += 1;
    grupos.set(chave, atual);
  }
  return [...grupos.values()].sort((a, b) => b.total - a.total);
}

export function porTipo(contas, saldos){
  const grupos = new Map();
  for (const c of (contas || []).filter((x) => x.ativo !== false)){
    const atual = grupos.get(c.tipo) || { id: c.tipo, nome: rotuloDoTipo(c.tipo), total: 0, contas: 0 };
    atual.total += saldoDaConta(saldos, c.id) || 0;
    atual.contas += 1;
    grupos.set(c.tipo, atual);
  }
  return [...grupos.values()].sort((a, b) => b.total - a.total);
}

/* Conta só some de verdade quando não deixou rastro. Com movimento, o certo é
   desativar: apagar levaria junto o histórico que explica o saldo das outras. */
export const podeExcluirConta = (temMovimento) => temMovimento === 0;

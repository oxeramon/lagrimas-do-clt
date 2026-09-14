/* METAS · envelope, nunca dinheiro novo.
 *
 * O contrato inteiro está em `docs/CONTRATO_METAS.md`. A frase que governa este
 * módulo, e que ele existe para tornar difícil de violar sem perceber:
 *
 *   META É ENVELOPE. CONTA É ONDE O DINHEIRO ESTÁ.
 *
 * O erro que se está impedindo:
 *
 *   saldo em contas   10.000
 *   meta "Viagem"      5.000
 *   "patrimônio"      15.000    <- ERRADO. São os mesmos 10.000.
 *
 * Os 5.000 da meta estão DENTRO dos 10.000, não ao lado. Por isso não existe
 * neste arquivo nenhuma função que SOME saldo com reservado: a única relação
 * entre os dois é de subtração.
 */

const cent = (v) => Math.round((Number(v) || 0) * 100) / 100;

export const PRIORIDADES = [
  { id: 1, rotulo: "Alta" },
  { id: 2, rotulo: "Média" },
  { id: 3, rotulo: "Baixa" },
];
export const rotuloDaPrioridade = (p) =>
  (PRIORIDADES.find((x) => x.id === Number(p)) || { rotulo: "Média" }).rotulo;

export const STATUS = [
  { id: "ativa",      rotulo: "Ativa" },
  { id: "concluida",  rotulo: "Concluída" },
  { id: "arquivada",  rotulo: "Arquivada" },
];
export const rotuloDoStatusDaMeta = (s) =>
  (STATUS.find((x) => x.id === s) || { rotulo: s }).rotulo;

/* ------------------------------------------------- os três números --------
   `disponivel` é uma LEITURA DIFERENTE do mesmo dinheiro, não um dinheiro a
   mais. É por isso que ele é uma subtração e nunca uma soma. */
export function disponibilidade(saldoLivre, reservado){
  const livre = cent(saldoLivre);
  const guardado = cent(reservado);
  return {
    livre,
    reservado: guardado,
    disponivel: cent(livre - guardado),
    /* Reservado acima do livre NÃO é erro do modelo: é o que acontece quando a
       pessoa reserva e depois gasta. O banco impede reservar demais HOJE; ele
       não impede o saldo cair amanhã. A tela avisa uma vez, e não uma vez por
       meta. */
    estourado: guardado > livre,
  };
}

/* ------------------------------------------------ necessidade mensal ------
   Sem prazo não há necessidade mensal, e a resposta é `null`, não zero: zero
   diria "não precisa guardar nada", que é o oposto do que acontece. */
export function necessidadeMensal(meta){
  if (!meta || meta.prazo == null) return null;
  const falta = cent(meta.falta ?? (Number(meta.valorAlvo || 0) - Number(meta.reservado || 0)));
  if (falta <= 0) return 0;
  /* pelo menos um mês: meta que vence este mês precisa do valor inteiro agora,
     não de uma divisão por zero */
  const meses = Math.max(1, Number(meta.mesesAtePrazo || 1));
  return cent(falta / meses);
}

/* ------------------------------------------------ capacidade mensal -------
   O que o MÊS produz e que pode, em princípio, virar reserva. É fluxo, e não
   se confunde com `disponibilidade`, que é estoque. `docs/CONTRATO_SOBRA.md`.

   `null` quando não há referência: mês sem entrada nenhuma não produz zero,
   produz um número que ainda não dá para saber. Zero marcaria toda meta com
   prazo em risco no primeiro minuto de uso, e alarme que toca sozinho ensina
   a ignorar alarme. */
export function capacidadeMensal(sobra){
  if (!sobra || sobra.semReferencia) return null;
  return Math.max(0, cent(sobra.projetada));
}

/* Quanto as metas com prazo pedem por mês, somadas. Meta sem prazo não entra:
   ela não pede ritmo. */
export function necessidadeTotal(metas){
  return cent((metas || [])
    .filter((m) => m.status === "ativa")
    .reduce((s, m) => s + (necessidadeMensal(m) || 0), 0));
}

/* O que ainda cabe depois do que já foi prometido. Negativo é o sinal do
   CONJUNTO, e ele existe porque cada meta pode caber sozinha sem que todas
   caibam juntas. */
export function capacidadeRestante(capacidade, necessidade){
  if (capacidade == null) return null;
  return cent(capacidade - cent(necessidade || 0));
}

/* -------------------------------------------------------- ritmo da meta ---
   Cinco estados, cada um com fundamento objetivo, avaliados NESTA ordem: a
   primeira regra que casa vence. Nenhum corte sai de porcentagem inventada.

     concluída       não há ritmo a julgar
     sem prazo       sem prazo não existe necessidade mensal
     sem referência  julgar sem base é alarme falso
     em risco        o mês não produz o que ESTA meta sozinha pede
     atenção         cabe ela; não cabem todas
     no ritmo        cabe sozinha e cabe no conjunto

   PRAZO PRÓXIMO NÃO É RISCO. Meta que vence mês que vem com o valor inteiro
   reservado está concluída. O que cria risco é a conta não fechar. */
export const RITMO = {
  CONCLUIDA:      "concluida",
  SEM_PRAZO:      "sem_prazo",
  SEM_REFERENCIA: "sem_referencia",
  EM_RISCO:       "em_risco",
  ATENCAO:        "atencao",
  NO_RITMO:       "no_ritmo",
};

const ROTULO_DO_RITMO = {
  concluida:      "Concluída",
  sem_prazo:      "Sem prazo",
  sem_referencia: "Sem referência",
  em_risco:       "Em risco",
  atencao:        "Atenção",
  no_ritmo:       "No ritmo",
};
export const rotuloDoRitmo = (r) => ROTULO_DO_RITMO[r] || r;

export function ritmoDaMeta(meta, capacidade, necessidadeDoConjunto){
  if (!meta) return RITMO.SEM_REFERENCIA;
  const falta = cent(meta.falta ?? (Number(meta.valorAlvo || 0) - Number(meta.reservado || 0)));
  if (meta.status === "concluida" || falta <= 0) return RITMO.CONCLUIDA;
  if (meta.prazo == null) return RITMO.SEM_PRAZO;
  if (capacidade == null) return RITMO.SEM_REFERENCIA;

  const precisa = necessidadeMensal(meta);
  if (precisa > cent(capacidade)) return RITMO.EM_RISCO;
  if (cent(necessidadeDoConjunto || 0) > cent(capacidade)) return RITMO.ATENCAO;
  return RITMO.NO_RITMO;
}

/* --------------------------------------------------- meta em risco --------
   Só um atalho para o estado, e a única definição de risco do projeto: esta
   meta pede por mês mais do que o mês produz. O parâmetro é CAPACIDADE, e não
   sobra crua -- foi assim que o contrato ficou, e misturar os dois voltaria a
   comparar um envelope com um extrato. */
export function emRisco(meta, capacidade){
  return ritmoDaMeta(meta, capacidade, 0) === RITMO.EM_RISCO;
}

/* ------------------------------------------------------ indicadores -------
   O topo da tela. Meta arquivada fica fora de tudo: ela é histórico, não plano
   de hoje -- mesma regra da assinatura pausada. */
export function indicadoresDeMetas(metas, saldoLivre, capacidade){
  const vivas = (metas || []).filter((m) => m.status !== "arquivada");
  const ativas = vivas.filter((m) => m.status === "ativa");
  const alvo = cent(ativas.reduce((s, m) => s + Number(m.valorAlvo || 0), 0));
  const reservado = cent(vivas.reduce((s, m) => s + Number(m.reservado || 0), 0));
  const falta = cent(ativas.reduce((s, m) => s + Number(m.falta || 0), 0));
  const disp = disponibilidade(saldoLivre, reservado);
  const precisaPorMes = necessidadeTotal(ativas);
  const ritmos = ativas.map((m) => ritmoDaMeta(m, capacidade, precisaPorMes));

  return {
    quantas: ativas.length,
    concluidas: vivas.filter((m) => m.status === "concluida").length,
    alvo,
    reservado,
    falta,
    /* os três de `disponibilidade`, repassados por nome para quem lê o objeto
       não precisar saber que existe outra função */
    saldoLivre: disp.livre,
    disponivel: disp.disponivel,
    estourado: disp.estourado,
    emRisco: ritmos.filter((r) => r === RITMO.EM_RISCO).length,
    emAtencao: ritmos.filter((r) => r === RITMO.ATENCAO).length,
    noRitmo: ritmos.filter((r) => r === RITMO.NO_RITMO).length,
    /* quanto seria preciso guardar por mês para dar conta de tudo que tem
       prazo. Metas sem prazo não entram: elas não pedem ritmo. */
    precisaPorMes,
    capacidade: capacidade ?? null,
    /* negativo aqui é o sinal do conjunto: cabem uma a uma e não cabem juntas */
    capacidadeRestante: capacidadeRestante(capacidade, precisaPorMes),
  };
}

/* A meta ativa de prazo mais perto. Sem prazo não concorre: ela não tem
   "próxima" nenhuma. `null` quando não há candidata, e a tela esconde a linha
   em vez de escrever um travessão que não quer dizer nada. */
export function proximaMeta(metas){
  const comPrazo = (metas || [])
    .filter((m) => m.status === "ativa" && m.prazo && Number(m.falta || 0) > 0);
  if (!comPrazo.length) return null;
  return comPrazo.slice().sort((a, b) => String(a.prazo).localeCompare(String(b.prazo)))[0];
}

/* A ordem da lista: em risco primeiro, depois por prioridade, depois por prazo.
   Quem abre a tela de Metas quer ver o que está apertado, não o alfabeto. */
export function ordenaMetas(metas, capacidade){
  return (metas || []).slice().sort((a, b) => {
    const ra = emRisco(a, capacidade) ? 0 : 1;
    const rb = emRisco(b, capacidade) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    if (a.prioridade !== b.prioridade) return Number(a.prioridade) - Number(b.prioridade);
    /* sem prazo vai para o fim: prazo é o que cria urgência */
    if (!a.prazo && b.prazo) return 1;
    if (a.prazo && !b.prazo) return -1;
    if (a.prazo && b.prazo) return String(a.prazo).localeCompare(String(b.prazo));
    return String(a.nome).localeCompare(String(b.nome));
  });
}

/* Quanto ainda cabe reservar no total. Nunca negativo: quando o reservado já
   passou do livre, o que cabe é zero, não um número negativo para a tela ter
   de tratar. */
export const cabeReservar = (saldoLivre, reservado) =>
  Math.max(0, cent(Number(saldoLivre || 0) - Number(reservado || 0)));

/* ------------------------------------------------- a regra mensal ---------
   "Reservar R$ X por mês". O banco garante uma alocação por competência e o
   teto do disponível; o que mora aqui é a LEITURA: esta meta tem regra, e o
   mês em foco já foi aplicado?

   `docs/CONTRATO_SOBRA.md`, "Alocação recorrente". */
export const temRegra = (meta) =>
  !!meta && meta.regraAtiva === true && Number(meta.regraValor || 0) > 0;

/* A alocação que a regra criou naquela competência, se existir. `origem` e
   `competencia` são do banco: alocação manual tem `origem = 'manual'` e
   competência nula, e por isso nunca casa aqui. */
export function alocacaoDaRegra(alocacoes, metaId, competencia){
  return (alocacoes || []).find((a) =>
    a.metaId === metaId && a.origem === "regra" && a.competencia === competencia) || null;
}

/* O QUE FALTOU da regra naquele mês, DERIVADO -- regra menos alocado.
   Não existe coluna para isto, e não deve existir: guardar "faltou 200" é
   guardar uma subtração, e ela mentiria no instante em que alguém editasse o
   valor da regra.

   `null` quando não há regra ou quando a competência não foi aplicada: nesse
   caso não faltou nada, simplesmente ainda não se tentou. Zero quando coube
   inteiro, e a tela não tem o que dizer. */
export function faltouNaRegra(meta, alocacao){
  if (!temRegra(meta) || !alocacao) return null;
  return Math.max(0, cent(Number(meta.regraValor) - Number(alocacao.valor || 0)));
}

/* O ESTADO DA REGRA no mês em foco, num valor só, porque a tela precisa dos
   três juntos para escrever uma frase e escolher um botão. */
export const SEM_REGRA = "sem_regra";
export const REGRA_PENDENTE = "pendente";
export const REGRA_APLICADA = "aplicada";
export const REGRA_PARCIAL = "parcial";

export function estadoDaRegra(meta, alocacoes, competencia){
  if (!temRegra(meta)) return { estado: SEM_REGRA, alocacao: null, faltou: null };
  const alocacao = alocacaoDaRegra(alocacoes, meta.metaId, competencia);
  if (!alocacao) return { estado: REGRA_PENDENTE, alocacao: null, faltou: null };
  const faltou = faltouNaRegra(meta, alocacao);
  return { estado: faltou > 0 ? REGRA_PARCIAL : REGRA_APLICADA, alocacao, faltou };
}

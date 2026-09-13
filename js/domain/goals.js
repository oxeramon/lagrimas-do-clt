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

/* --------------------------------------------------- meta em risco --------
   Duas perguntas diferentes, e a segunda vale para TODAS as metas ao mesmo
   tempo -- por isso ela não mora aqui dentro, e sim em `disponibilidade`.

   Aqui: esta meta pede mais por mês do que costuma sobrar? */
export function emRisco(meta, sobraMensal){
  const precisa = necessidadeMensal(meta);
  if (precisa === null || precisa === 0) return false;
  /* sem referência de sobra, não há como afirmar risco -- e afirmar sem base é
     alarme falso, que ensina a ignorar o alarme */
  if (sobraMensal == null) return false;
  return precisa > cent(sobraMensal);
}

/* ------------------------------------------------------ indicadores -------
   O topo da tela. Meta arquivada fica fora de tudo: ela é histórico, não plano
   de hoje -- mesma regra da assinatura pausada. */
export function indicadoresDeMetas(metas, saldoLivre, sobraMensal){
  const vivas = (metas || []).filter((m) => m.status !== "arquivada");
  const ativas = vivas.filter((m) => m.status === "ativa");
  const alvo = cent(ativas.reduce((s, m) => s + Number(m.valorAlvo || 0), 0));
  const reservado = cent(vivas.reduce((s, m) => s + Number(m.reservado || 0), 0));
  const falta = cent(ativas.reduce((s, m) => s + Number(m.falta || 0), 0));
  const disp = disponibilidade(saldoLivre, reservado);

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
    emRisco: ativas.filter((m) => emRisco(m, sobraMensal)).length,
    /* quanto seria preciso guardar por mês para dar conta de tudo que tem
       prazo. Metas sem prazo não entram: elas não pedem ritmo. */
    precisaPorMes: cent(ativas.reduce((s, m) => s + (necessidadeMensal(m) || 0), 0)),
  };
}

/* A ordem da lista: em risco primeiro, depois por prioridade, depois por prazo.
   Quem abre a tela de Metas quer ver o que está apertado, não o alfabeto. */
export function ordenaMetas(metas, sobraMensal){
  return (metas || []).slice().sort((a, b) => {
    const ra = emRisco(a, sobraMensal) ? 0 : 1;
    const rb = emRisco(b, sobraMensal) ? 0 : 1;
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

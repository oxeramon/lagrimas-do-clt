/* COMPETÊNCIAS DA REGRA · o mês passou e a regra não rodou.
 *
 * O contrato inteiro está em `docs/CONTRATO_COMPETENCIAS.md`. A decisão que
 * este módulo existe para tornar difícil de violar sem perceber:
 *
 *   A COMPETÊNCIA ATUAL RODA SOZINHA. AS PASSADAS NUNCA RODAM SOZINHAS.
 *
 * Uma regra de 500 que ficou três meses parada NÃO reserva 1.500 quando a
 * pessoa volta. Consumir 1.500 da disponibilidade de hoje por causa de meses
 * que já passaram é tomar uma decisão grande no lugar de quem ia tomá-la.
 *
 * AQUI NÃO SE GUARDA NADA. Tudo o que este arquivo devolve é derivado de três
 * coisas que o banco já tem -- a regra, as alocações e as decisões -- e é por
 * isso que "pendente" não é uma linha em tabela nenhuma: é a AUSÊNCIA de
 * decisão num mês que a vigência cobre.
 */
import { midx, fromIdx } from "../core/dates.js";

const cent = (v) => Math.round((Number(v) || 0) * 100) / 100;

/* Os quatro estados de uma competência. Só dois existem no banco; os outros
   dois são leitura. */
export const APLICADA = "aplicada";
export const PARCIAL  = "parcial";
export const IGNORADA = "ignorada";
export const PENDENTE = "pendente";

const ROTULOS = {
  [APLICADA]: "Reservada",
  [PARCIAL]:  "Reservada em parte",
  [IGNORADA]: "Ignorada",
  [PENDENTE]: "Pendente",
};
export const rotuloDaCompetencia = (s) => ROTULOS[s] || s;

/* A regra vale? Precisa de valor, de estar ligada, de vigência e de a meta
   estar ativa. Meta concluída ou arquivada não reserva mais nada. */
export const regraVigente = (meta) =>
  !!meta && meta.regraAtiva === true && Number(meta.regraValor || 0) > 0
  && !!meta.regraDesde && meta.status === "ativa";

/* Os meses que a vigência cobre, de `regraDesde` até o mês em foco, inclusive.
   Vazio quando a regra não vale, e vazio quando a vigência começa depois do
   mês atual -- que é o caso de uma regra criada hoje olhada num mês passado. */
export function mesesDaVigencia(meta, mesAtual){
  if (!regraVigente(meta) || !mesAtual) return [];
  const de = midx(meta.regraDesde);
  const ate = midx(mesAtual);
  if (ate < de) return [];
  /* Teto de segurança: uma `regraDesde` corrompida não pode virar um laço de
     milhares de meses que trava a tela. Cinco anos é mais do que qualquer
     história real deste app, e o corte fica visível em vez de silencioso. */
  const inicio = Math.max(de, ate - 60);
  const meses = [];
  for (let i = inicio; i <= ate; i++) meses.push(fromIdx(i));
  return meses;
}

/* O estado de UMA competência, com os números que a tela precisa.

   `planejado` é a parte que mais importa, e tem duas fontes:
     - competência DECIDIDA  -> o valor congelado no momento da decisão
     - competência PENDENTE  -> a regra de HOJE
   Não é inconsistência: uma competência sem decisão nunca teve um valor
   próprio para preservar, e mostrar a regra de hoje é a única leitura honesta.
   Congela no momento da decisão, e não antes. */
export function estadoDaCompetencia(meta, competencia, alocacao, decisao){
  if (decisao) return {
    competencia,
    estado: IGNORADA,
    planejado: cent(decisao.valorPlanejado),
    alocado: 0,
    faltou: 0,
    em: decisao.decididaEm || null,
  };

  if (alocacao){
    const planejado = cent(alocacao.valorPlanejado);
    const alocado = cent(alocacao.valor);
    const faltou = Math.max(0, cent(planejado - alocado));
    return {
      competencia,
      estado: faltou > 0 ? PARCIAL : APLICADA,
      planejado, alocado, faltou,
      em: alocacao.criadoEm || null,
    };
  }

  return {
    competencia,
    estado: PENDENTE,
    planejado: cent(meta.regraValor),
    alocado: 0,
    faltou: 0,
    em: null,
  };
}

/* O histórico de uma meta, do mês mais recente para o mais antigo -- que é a
   ordem em que se lê um extrato. */
export function historicoDaMeta(meta, alocacoes, decisoes, mesAtual){
  const meses = mesesDaVigencia(meta, mesAtual);
  if (!meses.length) return [];
  const porMes = new Map();
  for (const a of alocacoes || [])
    if (a.metaId === meta.metaId && a.origem === "regra" && a.competencia)
      porMes.set(a.competencia, a);
  const decididas = new Map();
  for (const d of decisoes || [])
    if (d.metaId === meta.metaId) decididas.set(d.competencia, d);

  return meses
    .map((m) => estadoDaCompetencia(meta, m, porMes.get(m), decididas.get(m)))
    .sort((a, b) => b.competencia.localeCompare(a.competencia));
}

/* AS PENDÊNCIAS PASSADAS, e só elas. O mês atual fica de fora de propósito:
   ele é da automação, não da lista de decisões esperando. Mostrá-lo junto
   pediria uma decisão que o app já vai tomar sozinho daqui a um instante.

   Da MAIS ANTIGA para a mais nova, ao contrário do histórico. As duas ordens
   são certas para coisas diferentes: histórico se lê como extrato, do recente
   para trás; pendência se REGULARIZA na ordem em que aconteceu. */
export function pendenciasDaMeta(meta, alocacoes, decisoes, mesAtual){
  return historicoDaMeta(meta, alocacoes, decisoes, mesAtual)
    .filter((c) => c.estado === PENDENTE && c.competencia < mesAtual)
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
}

/* A ORDEM DETERMINÍSTICA, a mesma do banco: prioridade, prazo mais próximo,
   competência mais antiga, e o desempate estável por nome e competência.

   Ela existe para a simulação da tela bater com o que o banco vai fazer. Duas
   ordens diferentes dariam dois totais diferentes para a mesma seleção, e a
   pessoa veria um número antes de confirmar e outro depois. */
export function ordenaPendencias(itens){
  return (itens || []).slice().sort((a, b) => {
    const pa = Number(a.meta.prioridade ?? 2), pb = Number(b.meta.prioridade ?? 2);
    if (pa !== pb) return pa - pb;
    /* sem prazo vai por último: não tem urgência a comparar */
    if (!a.meta.prazo && b.meta.prazo) return 1;
    if (a.meta.prazo && !b.meta.prazo) return -1;
    if (a.meta.prazo && b.meta.prazo){
      const d = String(a.meta.prazo).localeCompare(String(b.meta.prazo));
      if (d) return d;
    }
    const c = a.competencia.localeCompare(b.competencia);
    if (c) return c;
    return String(a.meta.nome).localeCompare(String(b.meta.nome));
  });
}

/* Todas as pendências, de todas as metas, já na ordem em que serão aplicadas. */
export function todasAsPendencias(metas, alocacoes, decisoes, mesAtual){
  const fora = [];
  for (const meta of metas || [])
    for (const c of pendenciasDaMeta(meta, alocacoes, decisoes, mesAtual))
      fora.push({ ...c, meta });
  return ordenaPendencias(fora);
}

/* O resumo do topo: quantas competências esperam decisão, e quanto elas
   SOMAM DE REGRA.

   `planejado` NÃO é dívida, saldo, despesa nem valor reservado. É a soma das
   regras que não rodaram -- um número de planejamento. A tela é obrigada a
   dizer isso com todas as letras, e nenhum indicador financeiro o soma. */
export function resumoDePendencias(metas, alocacoes, decisoes, mesAtual){
  const itens = todasAsPendencias(metas, alocacoes, decisoes, mesAtual);
  return {
    quantas: itens.length,
    planejado: cent(itens.reduce((s, c) => s + Number(c.planejado || 0), 0)),
    metas: new Set(itens.map((c) => c.meta.metaId)).size,
  };
}

/* A SIMULAÇÃO, sequencial, antes de confirmar.

   Nada de regra vezes número de meses: com 900 disponíveis, duas pendências de
   500 dão 500 e 400, e a terceira dá zero. O disponível é descontado a cada
   uma, na mesma ordem que o banco vai usar.

   O que sai daqui é PREVISÃO. Quem decide é o banco, e se o dinheiro mudar
   entre a simulação e a confirmação, o que vale é a resposta dele -- a tela
   mostra o que de fato aconteceu, não o que ela tinha previsto. */
export function simulaRegularizacao(pendencias, disponivel){
  let resta = Math.max(0, cent(disponivel));
  /* O QUE FALTA PARA CADA META TAMBÉM ENCOLHE, e não só o disponível geral.
     Duas competências da mesma meta que só precisa de 120 somam 120, nunca
     240: o banco recalcula `alvo - soma das alocações` a cada aplicação, e
     uma simulação que não fizesse o mesmo prometeria o dobro e entregaria a
     metade -- que é exatamente a surpresa que a confirmação existe para
     evitar. */
  const restaNaMeta = new Map();
  const linhas = ordenaPendencias(pendencias).map((c) => {
    const id = c.meta.metaId;
    if (!restaNaMeta.has(id))
      restaNaMeta.set(id, Math.max(0, cent(Number(c.meta.falta || 0))));
    const cabeNaMeta = restaNaMeta.get(id);
    const vai = Math.min(cent(c.planejado), resta, cabeNaMeta);
    resta = cent(resta - vai);
    restaNaMeta.set(id, cent(cabeNaMeta - vai));
    return { ...c, reservar: vai, faltara: Math.max(0, cent(c.planejado - vai)) };
  });
  return {
    linhas,
    total: cent(linhas.reduce((s, l) => s + l.reservar, 0)),
    sobra: resta,
    /* quantas não vão conseguir nada: é o número que evita a surpresa */
    semNada: linhas.filter((l) => l.reservar <= 0).length,
  };
}

/* O que a tela manda para o banco: só o par que identifica a competência. */
export const paraOBanco = (pendencias) =>
  ordenaPendencias(pendencias).map((c) => ({
    meta_id: c.meta.metaId, competencia: c.competencia,
  }));

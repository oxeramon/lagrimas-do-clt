/* Cartão e fatura: o ciclo, e as duas perguntas que não se somam.
 *
 * O contrato inteiro está em docs/CONTRATO_CARTAO.md. O resumo que importa:
 *
 *     Compra no cartão é despesa.
 *     Pagamento da fatura não é despesa nova.
 *
 * ESTE ARQUIVO REPETE UMA REGRA QUE JÁ EXISTE NO BANCO, e isso merece
 * explicação. `competencia_da_compra` e `ciclo_da_fatura` estão na migração
 * 007, em plpgsql, e são elas que mandam na hora de escrever. As daqui
 * existem para a TELA poder dizer "esta compra vai cair na fatura que vence
 * em 08/10" antes de mandar qualquer coisa para o banco -- sem ida e volta de
 * rede a cada tecla.
 *
 * Duas implementações da mesma regra é dívida, e o preço dela se paga em
 * teste: `testes/regras.mjs` roda aqui exatamente os mesmos casos que
 * `supabase/testes/007_cartoes.sql` roda lá. Se as duas discordarem, a suíte
 * acusa. Enquanto concordarem, a duplicação é segura.
 *
 * Nada aqui toca DOM nem banco.
 */
import { midx, fromIdx } from "../core/dates.js";
import { contaNoSaldo } from "./transactions.js";

/* ------------------------------------------------------------------ ciclo --*/

/* Quantos dias tem o mês "AAAA-MM". */
export function diasDoMes(mes){
  const [a, m] = String(mes).split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/* Dia `dia` do mês `mes`, truncado ao último dia quando o mês não tem aquele
   dia. Fevereiro de ano comum devolve 28; de bissexto, 29.

   O dia guardado no cartão NÃO é truncado -- quem trunca é este cálculo, mês a
   mês. Guardar 28 para um cartão que fecha no último dia perderia a informação
   de que ele fecha no último dia. */
export function diaNoMes(mes, dia){
  const d = Math.min(Math.max(Number(dia) || 1, 1), diasDoMes(mes));
  return mes + "-" + String(d).padStart(2, "0");
}

/* Em qual competência cai uma compra feita em `iso` (AAAA-MM-DD).

   `>=` e não `>`: compra feita no PRÓPRIO dia do fechamento já cai na fatura
   seguinte, porque o extrato é cortado naquele dia. É a mesma regra da V1 em
   `billing.js` e a mesma da 007 no banco. */
export function competenciaDaCompra(iso, fechamento){
  if (!iso || !fechamento) return null;
  const mes = String(iso).slice(0, 7);
  const dia = Number(String(iso).slice(8, 10));
  const corte = Number(diaNoMes(mes, fechamento).slice(8, 10));
  return dia < corte ? mes : fromIdx(midx(mes) + 1);
}

/* As três datas de um ciclo. A janela é MEIA ABERTA: abertura <= D <
   fechamento. A data de fechamento pertence à competência seguinte. */
export function cicloDaFatura(competencia, fechamento, vencimento){
  const anterior = fromIdx(midx(competencia) - 1);
  const mesVence = vencimento > fechamento ? competencia : fromIdx(midx(competencia) + 1);
  return {
    abertura:   diaNoMes(anterior, fechamento),
    fechamento: diaNoMes(competencia, fechamento),
    vencimento: diaNoMes(mesVence, vencimento),
  };
}

/* ---------------------------------------------------------------- situação --
   Derivada, nunca guardada -- é por isso que apagar o pagamento devolve a
   fatura para "fechada" sozinho. */
export const ABERTA  = "aberta";
export const FECHADA = "fechada";
export const PAGA    = "paga";

export function situacaoDaFatura({ fechamento, pagamentoId }, hojeISO){
  if (pagamentoId) return PAGA;
  return String(hojeISO) >= String(fechamento) ? FECHADA : ABERTA;
}

/* O rótulo da fatura NUNCA é um mês solto.

   `competencia = '2026-09'` é o ciclo que FECHA em setembro. Num cartão que
   fecha 25 e vence 8, essa fatura vence em 08/10 -- e a pessoa vai chamá-la de
   "fatura de outubro", porque é quando ela paga. Mostrar "setembro" sozinho
   seria discordar de quem lê. Então a tela mostra as duas datas. */
const ddmm = (iso) => String(iso).slice(8, 10) + "/" + String(iso).slice(5, 7);
export const rotuloDaFatura = (f) =>
  "fecha " + ddmm(f.fechamento) + " · vence " + ddmm(f.vencimento);

/* ------------------------------------------------- as duas perguntas --------
   Elas NÃO se somam, e a separação é o produto inteiro deste módulo.

   consumo  quanto eu gastei    compra no cartão entra, pagamento de fatura não
   caixa    quanto saiu da conta  pagamento entra, compra no cartão não

   Nenhum dos dois filtros precisa conhecer o outro: a compra no cartão não tem
   conta, e o pagamento da fatura tem natureza própria. */
export const PAGAMENTO_DE_FATURA = "pagamento_de_fatura";

export const ehCompraDeCartao   = (t) => !!t.faturaId;
export const ehPagamentoDeFatura = (t) => t.natureza === PAGAMENTO_DE_FATURA;

/* Gasto de verdade: o que foi consumido, tenha saído da conta ou não. */
export const ehConsumo = (t) =>
  t.tipo === "saida" && t.natureza === "normal" && contaNoSaldo(t);

/* Dinheiro que saiu de uma conta: inclui o pagamento da fatura, exclui a
   compra no cartão, que não tem conta nenhuma. */
export const saiDoCaixa = (t) =>
  t.tipo === "saida" && !!t.contaId && contaNoSaldo(t);

const soma = (lista, quando) =>
  (lista || []).filter(quando).reduce((s, t) => s + (Number(t.valor) || 0), 0);

export const consumoDe = (transacoes) => soma(transacoes, ehConsumo);
export const caixaDe   = (transacoes) => soma(transacoes, saiDoCaixa);

/* ------------------------------------------------------------- indicadores --*/

/* O que a tela de Cartões mostra no topo. `limite` é opcional, e quando falta
   o indicador some em vez de virar zero -- limite zero e limite desconhecido
   são coisas diferentes. */
export function indicadoresDeCartoes(cartoes, faturas){
  const ativos = (cartoes || []).filter((c) => c.ativo !== false);
  const abertas = (faturas || []).filter((f) => f.situacao !== PAGA);
  const comLimite = ativos.filter((c) => c.limite !== null && c.limite !== undefined);
  return {
    quantidade: ativos.length,
    inativos: (cartoes || []).length - ativos.length,
    aPagar: abertas.reduce((s, f) => s + (Number(f.total) || 0), 0),
    faturasAbertas: abertas.length,
    limiteTotal: comLimite.length ? comLimite.reduce((s, c) => s + Number(c.limite), 0) : null,
  };
}

/* A próxima fatura a vencer entre as que ainda não foram pagas. Devolve `null`
   quando não há nenhuma -- e `null` NÃO é "vence hoje". */
export function proximaAVencer(faturas, hojeISO){
  const abertas = (faturas || [])
    .filter((f) => f.situacao !== PAGA && String(f.vencimento) >= String(hojeISO))
    .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  return abertas[0] || null;
}

/* Fatura vencida e não paga. É a informação que a pessoa mais precisa ver e a
   que mais some no meio de uma lista ordenada por data. */
export const vencidas = (faturas, hojeISO) =>
  (faturas || []).filter((f) => f.situacao !== PAGA && String(f.vencimento) < String(hojeISO));

/* ------------------------------------------------------------ parcelamento --
   A divisão que a 007 faz no banco, repetida aqui para a tela poder mostrar
   "3x de R$ 33,33 (a primeira de R$ 33,34)" antes de gravar.

   A sobra de centavos vai para a PRIMEIRA parcela, que é o que os emissores
   brasileiros fazem. A soma é exatamente o total, sempre. */
export function parcelasDe(valorTotal, n){
  const total = Math.round((Number(valorTotal) || 0) * 100);
  const partes = Number(n) || 1;
  const base = Math.floor(total / partes);
  const sobra = total - base * partes;
  return Array.from({ length: partes }, (_, i) => (base + (i === 0 ? sobra : 0)) / 100);
}

/* Em que competência cai cada parcela: a da compra, e as seguintes mês a mês. */
export const competenciasDasParcelas = (competencia1, n) =>
  Array.from({ length: Number(n) || 1 }, (_, i) => fromIdx(midx(competencia1) + i));

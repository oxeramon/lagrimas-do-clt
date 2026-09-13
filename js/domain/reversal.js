/* ESTORNO · o que pode ser estornado, e quanto ainda cabe.
 *
 * O contrato inteiro está em `docs/CONTRATO_ESTORNO.md`; aqui mora a parte que
 * a tela precisa saber ANTES do clique. Quem garante de verdade é o banco (a
 * 010), com gatilho e CHECK -- este módulo existe para a pessoa não descobrir
 * que não podia depois de preencher um formulário.
 *
 * A REGRA QUE DECIDE TUDO: só transação de natureza `normal` se estorna.
 *
 * Os três "não" do contrato não são preguiça, e cada um tem a operação certa no
 * lugar do estorno:
 *
 *   transferência        -> excluir a transferência (leva as duas pernas)
 *   pagamento de fatura  -> desfazer o pagamento (a fatura reabre sozinha)
 *   liquidação da V1     -> desfazer a liquidação (o compromisso volta a previsto)
 *
 * O motivo é o mesmo nos três: todos têm vínculo estrutural com outra coisa, e
 * estornar criaria uma linha de sinal contrário SEM desfazer o vínculo. A
 * fatura continuaria marcada como paga, a dívida continuaria quitada, a
 * transferência ficaria com uma perna a mais. Dinheiro certo, história errada.
 *
 * E estorno não se estorna: cadeia de estorno de estorno é ambiguidade pura.
 */

/* O que o estorno não alcança, e por qual porta se desfaz cada um. A tela lê
   isto para EXPLICAR, em vez de só desabilitar um botão -- botão apagado sem
   motivo é o que faz a pessoa achar que o app quebrou. */
export const MOTIVOS = {
  transferencia: {
    porque: "Transferência não se estorna: as duas pernas nascem e morrem juntas.",
    caminho: "Abra a transferência e exclua — a exclusão leva as duas.",
  },
  pagamento_de_fatura: {
    porque: "Pagamento de fatura não se estorna: a fatura continuaria marcada como paga.",
    caminho: "Abra a fatura e desfaça o pagamento por lá.",
  },
  estorno: {
    porque: "Estorno não se estorna: estorno de estorno não tem leitura única.",
    caminho: "Se o estorno foi errado, exclua o estorno.",
  },
};

/* Liquidação da V1 não é uma NATUREZA, é um vínculo: a transação nasce
   `normal` e ganha uma linha em `liquidacoes`. Por isso ela não cabe no mapa
   acima e precisa da pergunta própria. */
export const LIQUIDACAO = {
  porque: "Este lançamento quitou um compromisso da V1, e estorná-lo deixaria o compromisso quitado.",
  caminho: "Abra o compromisso no Mês e use \"Desfazer\".",
};

/* `natureza` é o que a 010 cobra no banco. A liquidação entra por fora, pelo
   índice de vínculos que a ponte já monta. */
export function podeEstornar(t, vinculos){
  if (!t) return { pode: false, porque: "Lançamento não encontrado.", caminho: "" };
  const bloqueio = MOTIVOS[t.natureza];
  if (bloqueio) return { pode: false, ...bloqueio };
  if (vinculos && vinculos.has && vinculos.has(t.id))
    return { pode: false, ...LIQUIDACAO };
  /* previsto ainda não aconteceu: não há o que devolver */
  if (t.status === "prevista")
    return { pode: false,
             porque: "Este lançamento ainda é previsto: não houve dinheiro para voltar.",
             caminho: "Marque como realizado primeiro, se ele aconteceu." };
  if (t.status === "cancelada")
    return { pode: false,
             porque: "Este lançamento está cancelado.",
             caminho: "" };
  return { pode: true, porque: "", caminho: "" };
}

/* Quanto já voltou. Soma dos estornos que apontam para esta transação. */
export const jaEstornado = (t, todas) =>
  cent((todas || []).filter((x) => x.natureza === "estorno" && x.estornoDeId === t.id)
    .reduce((s, x) => s + Number(x.valor || 0), 0));

/* O que ainda cabe estornar. Nunca negativo: o banco impede que a soma passe
   do original, então um valor abaixo de zero aqui seria sintoma, não estado. */
export const saldoEstornavel = (t, todas) =>
  Math.max(0, cent(Number(t.valor || 0) - jaEstornado(t, todas)));

/* Centavo é a unidade do produto. Arredondar no fim de cada conta evita que
   0,1 + 0,2 apareça na tela. */
const cent = (v) => Math.round(v * 100) / 100;

/* A lista de estornos de uma transação, da mais recente para a mais antiga --
   é assim que a tela mostra o histórico que o contrato promete. */
export const estornosDe = (t, todas) =>
  (todas || []).filter((x) => x.natureza === "estorno" && x.estornoDeId === t.id)
    .slice().sort((a, b) => String(b.data).localeCompare(String(a.data)));

/* CALENDÁRIO FINANCEIRO · um mês, um evento por acontecimento.
 *
 * A REGRA QUE GOVERNA ESTE MÓDULO
 *
 * Um compromisso pago NÃO é duas linhas no calendário. É UMA linha com dois
 * estados. O errado seria assim:
 *
 *   12/09  Conta de energia          R$ 100
 *   12/09  Pagamento conta de energia R$ 100
 *
 * Duas linhas, R$ 200 aparente, e nenhuma relação visível entre elas -- quem
 * lê conclui que pagou duas vezes. O certo é:
 *
 *   12/09  Conta de energia · previsto R$ 100 · ✓ paga em 12/09
 *
 * A ponte V1/V2 já sabe qual transação liquidou qual compromisso (`liquidacoes`,
 * desde a 005). Este módulo usa esse vínculo para FUNDIR os dois lados num
 * evento só, em vez de somá-los.
 *
 * O mesmo vale para receita recebida e para fatura paga.
 *
 * O QUE ISTO NÃO FAZ: não soma nada. Ele devolve eventos; quem totaliza é o
 * Painel, que já sabe que previsto e realizado não se somam.
 */

/* Os estados que a tela precisa distinguir. Cada um tem rótulo E ícone além da
   cor, porque cor sozinha não decide nada neste projeto. */
export const ESTADOS = {
  previsto:  { rotulo: "Previsto",  icone: "○" },
  atrasado:  { rotulo: "Atrasado",  icone: "!" },
  pago:      { rotulo: "Pago",      icone: "✓" },
  recebido:  { rotulo: "Recebido",  icone: "✓" },
  realizado: { rotulo: "Realizado", icone: "•" },
  fatura:    { rotulo: "Fatura",    icone: "▣" },
  assinatura:{ rotulo: "Assinatura",icone: "↻" },
};
export const rotuloDoEstado = (e) => (ESTADOS[e] || { rotulo: e }).rotulo;
export const iconeDoEstado  = (e) => (ESTADOS[e] || { icone: "•" }).icone;

/* `null` quando não há dia. NÃO é o mesmo que "dia 1": a V1 guarda dívida,
   fixa e receita por COMPETÊNCIA mensal, sem dia do mês, e escolher um dia
   para elas seria inventar dado de dinheiro. Elas vão para um balde próprio
   -- "sem dia certo" -- em vez de cair numa célula que mente. */
const dia = (iso) => (iso ? String(iso).slice(0, 10) : null);
const doMes = (iso, mes) => String(iso || "").slice(0, 7) === mes;

/* ---------------------------------------------------------- o evento ------
   `chave` é a identidade: dois registros com a mesma chave são o MESMO
   acontecimento visto de ângulos diferentes, e por isso se fundem. */
const evento = (o) => ({
  chave: o.chave,
  data: o.data,
  titulo: o.titulo,
  valor: Number(o.valor) || 0,
  sentido: o.sentido,            /* "saida" | "entrada" */
  tipo: o.tipo,                  /* compromisso | receita | transacao | fatura | assinatura */
  estado: o.estado,
  /* as duas datas do MESMO evento. Quando as duas existem e são diferentes, a
     tela mostra as duas -- "previsto 10, pago 12" é informação, não ruído. */
  previstoEm: o.previstoEm || null,
  realizadoEm: o.realizadoEm || null,
  detalhe: o.detalhe || "",
});

/* ------------------------------------------------------- o mês inteiro ----
   Recebe tudo o que já existe em memória e devolve a lista de eventos. Não vai
   ao banco e não sabe que existe DOM.

   `hoje` entra por parâmetro para o atraso ser testável sem mexer no relógio. */
export function eventosDoMes({
  mes, hoje,
  transacoes = [], liquidacoes = [], faturas = [], cartoes = [],
  compromissos = [], receitas = [],
} = {}){
  const fora = [];

  /* Quais transações já são a REALIZAÇÃO de outra coisa. Elas não entram como
     evento próprio: entram como o estado "realizado" do evento de origem. */
  const liquidouCompromisso = new Map();   /* transacaoId -> liquidacao */
  for (const l of liquidacoes) liquidouCompromisso.set(l.transacaoId, l);

  /* ---- 1. compromissos da V1 (dívida, fixa): previsto -> pago ---- */
  for (const c of compromissos){
    /* `vence` pode ser null: a V1 não guarda dia. O evento existe do mesmo
       jeito, só não tem célula na grade. */
    if (c.vence != null && !doMes(c.vence, mes)) continue;
    const l = liquidacoes.find((x) => x.itemId === c.itemId && x.competencia === mes);
    const t = l ? transacoes.find((x) => x.id === l.transacaoId) : null;
    fora.push(evento({
      chave: c.tipo + ":" + c.itemId + ":" + mes,
      data: dia(c.vence),
      titulo: c.titulo,
      valor: c.valor,
      sentido: "saida",
      tipo: "compromisso",
      /* UM evento, dois estados. Nunca dois eventos. */
      /* sem dia não dá para afirmar atraso -- e afirmar sem base é alarme
         falso, que ensina a ignorar o alarme */
      estado: l ? "pago"
            : (c.vence != null && dia(c.vence) < dia(hoje) ? "atrasado" : "previsto"),
      previstoEm: dia(c.vence),
      realizadoEm: t ? dia(t.data) : null,
      detalhe: c.detalhe || "",
    }));
  }

  /* ---- 2. receitas previstas da V1: previsto -> recebido ---- */
  for (const r of receitas){
    if (r.quando != null && !doMes(r.quando, mes)) continue;
    const l = liquidacoes.find((x) => x.itemId === r.itemId && x.competencia === mes
                                   && x.tipo === "receita");
    const t = l ? transacoes.find((x) => x.id === l.transacaoId) : null;
    fora.push(evento({
      chave: "receita:" + r.itemId + ":" + mes,
      data: dia(r.quando),
      titulo: r.titulo,
      valor: r.valor,
      sentido: "entrada",
      tipo: "receita",
      estado: l ? "recebido"
            : (r.quando != null && dia(r.quando) < dia(hoje) ? "atrasado" : "previsto"),
      previstoEm: dia(r.quando),
      realizadoEm: t ? dia(t.data) : null,
      detalhe: r.detalhe || "",
    }));
  }

  /* ---- 3. faturas: fechamento e vencimento são eventos DIFERENTES ----
     Fechar não é pagar. Quem lê precisa dos dois: um diz "não compre mais
     nesta fatura", o outro diz "pague até aqui". */
  for (const f of faturas){
    const cartao = cartoes.find((c) => c.id === f.cartaoId);
    const nome = cartao ? (cartao.apelido || cartao.nome) : "Cartão";
    if (doMes(f.fechamento, mes) && Number(f.total) > 0)
      fora.push(evento({
        chave: "fatura-fecha:" + f.faturaId,
        data: dia(f.fechamento),
        titulo: nome + " fecha",
        valor: f.total,
        sentido: "saida",
        tipo: "fatura",
        estado: "fatura",
        previstoEm: dia(f.fechamento),
        detalhe: "a partir daqui, a compra cai na próxima",
      }));

    if (doMes(f.vencimento, mes) && Number(f.total) > 0){
      const quitada = f.situacao === "paga";
      fora.push(evento({
        chave: "fatura-vence:" + f.faturaId,
        data: dia(f.vencimento),
        titulo: nome + " vence",
        /* numa fatura parcial o número que decide é o que FALTA */
        valor: quitada ? f.total : Number(f.restante ?? f.total),
        sentido: "saida",
        tipo: "fatura",
        estado: quitada ? "pago"
              : (dia(f.vencimento) < dia(hoje) ? "atrasado" : "previsto"),
        previstoEm: dia(f.vencimento),
        detalhe: f.situacao === "parcial"
          ? "parcial: já pagou parte" : "",
      }));
    }
  }

  /* ---- 4. as transações que sobraram ----
     Fora as que já apareceram como realização de outra coisa, e fora o
     pagamento de fatura, que é o estado "pago" do evento de vencimento. */
  for (const t of transacoes){
    if (!doMes(t.data, mes)) continue;
    if (liquidouCompromisso.has(t.id)) continue;
    if (t.natureza === "pagamento_de_fatura") continue;
    /* compra no cartão não é evento de caixa: ela vira a fatura, e a fatura já
       está no calendário. Mostrá-la aqui contaria o mesmo gasto duas vezes. */
    if (t.faturaId) continue;

    const ehAssinatura = Boolean(t.assinaturaId);
    fora.push(evento({
      chave: "tx:" + t.id,
      data: dia(t.data),
      titulo: t.descricao,
      valor: t.valor,
      sentido: t.tipo,
      tipo: ehAssinatura ? "assinatura" : "transacao",
      estado: ehAssinatura && t.status === "prevista" ? "assinatura"
            : t.status === "prevista"
              ? (dia(t.data) < dia(hoje) ? "atrasado" : "previsto")
              : "realizado",
      previstoEm: t.status === "prevista" ? dia(t.data) : null,
      realizadoEm: t.status === "prevista" ? null : dia(t.data),
      detalhe: t.natureza === "estorno" ? "estorno" : "",
    }));
  }

  /* sem dia vai para o FIM: a agenda é cronológica, e o que não tem dia não
     tem lugar na cronologia */
  return fora.sort((a, b) =>
    String(a.data || "9999").localeCompare(String(b.data || "9999"))
    || a.titulo.localeCompare(b.titulo));
}

/* ------------------------------------------------------ agrupado por dia --
   A agenda do celular e a grade do desktop usam a mesma estrutura; o que muda
   é o desenho, não o dado. */
export function porDia(eventos){
  const mapa = new Map();
  for (const e of eventos){
    if (e.data == null) continue;
    if (!mapa.has(e.data)) mapa.set(e.data, []);
    mapa.get(e.data).push(e);
  }
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, itens]) => ({ data, itens }));
}

/* O que existe no mês e não tem dia. A V1 guarda dívida, fixa e receita por
   competência mensal; espalhá-las pela grade exigiria escolher um dia, e
   escolher um dia para conta de dinheiro é inventar dado. Elas aparecem numa
   lista própria, com o mês por cabeçalho. */
export const semDiaCerto = (eventos) => eventos.filter((e) => e.data == null);

/* Os números do topo do calendário. Repare no que NÃO existe: nenhum total que
   some previsto com realizado. Eles respondem perguntas diferentes, e somá-los
   contaria o mesmo dinheiro duas vezes -- é o mesmo cuidado do Painel. */
export function resumoDoCalendario(eventos){
  const conta = (f) => eventos.filter(f).reduce((s, e) => s + e.valor, 0);
  const cent = (v) => Math.round(v * 100) / 100;
  return {
    aPagar:    cent(conta((e) => e.sentido === "saida"
                             && ["previsto", "atrasado", "assinatura"].includes(e.estado))),
    pago:      cent(conta((e) => e.sentido === "saida"
                             && ["pago", "realizado"].includes(e.estado))),
    aReceber:  cent(conta((e) => e.sentido === "entrada"
                             && ["previsto", "atrasado"].includes(e.estado))),
    recebido:  cent(conta((e) => e.sentido === "entrada"
                             && ["recebido", "realizado"].includes(e.estado))),
    atrasados: eventos.filter((e) => e.estado === "atrasado").length,
    eventos:   eventos.length,
  };
}

/* ---------------------------------------------------- a grade do mês ------
   Semanas de domingo a sábado, com os dias vizinhos preenchidos para a grade
   não ficar com buracos. `noMes` diz quais são do mês pedido. */
export function gradeDoMes(mes){
  const [ano, m] = mes.split("-").map(Number);
  const primeiro = new Date(Date.UTC(ano, m - 1, 1));
  const comeco = new Date(primeiro);
  comeco.setUTCDate(1 - primeiro.getUTCDay());

  const semanas = [];
  const cursor = new Date(comeco);
  /* seis semanas cobrem qualquer mês; parar antes deixaria a grade mudando de
     altura de mês para mês, o que faz a tela pular */
  for (let s = 0; s < 6; s++){
    const semana = [];
    for (let d = 0; d < 7; d++){
      const iso = cursor.toISOString().slice(0, 10);
      semana.push({ data: iso, noMes: iso.slice(0, 7) === mes,
                    numero: cursor.getUTCDate() });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    semanas.push(semana);
    /* se a semana seguinte já passou inteira do mês, para: seis linhas só
       quando o mês precisa delas */
    if (semana[6].data.slice(0, 7) > mes) break;
  }
  return semanas;
}

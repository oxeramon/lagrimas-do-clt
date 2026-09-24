/* Gera preview.html: uma cópia do index.html com o cliente Supabase dublado
   e dados de exemplo, para olhar a tela sem logar no banco de verdade.

     node testes/preview.mjs && start preview.html

   O arquivo gerado fica fora do git (.gitignore). Nada aqui vai para o ar.

   Todos os dados abaixo são FICTÍCIOS e foram montados de propósito para este
   arquivo: nomes genéricos, ciclos de cartão escolhidos a dedo, e valores com
   centavos zerados que nenhum extrato produziria. Este repositório é público, e
   prévia não é lugar de dado financeiro real.

   O cenário existe para exercitar o modelo de três eixos — credor (de quem se
   deve), meio (como se paga), categoria (no que foi) — e não só para encher a
   tela. Ele tem, de propósito:

     · um banco com dois cartões pendurados nele, com ciclos diferentes
       (fecha 10 e fecha 25), que viram duas faturas dentro do mesmo credor;
     · financiamento e empréstimo lançados no próprio banco, sem fatura;
     · uma loja com carnê e uma pessoa, que também não;
     · assinaturas cobradas no cartão, que entram na fatura do cartão certo;
     · um credor desativado, que sai das listas sem apagar o histórico.  */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, normalize } from "node:path";

const raiz = new URL("../", import.meta.url);
const ENTRADA = fileURLToPath(new URL("index.html", raiz));
const SAIDA = fileURLToPath(new URL("preview.html", raiz));

/* nome, tipo, fecha, vence, ativo, pertence a

   O banco é o credor; o cartão é produto dele. Só o cartão precisa de
   fechamento, porque só ele emite fatura. Financiamento e empréstimo são
   lançados direto no banco: não passam por fatura, então não viram produto. */
const CREDORES = [
  ["Banco Exemplo",       "Banco",  null, null, true,  null],
  ["Cartão Principal",    "Cartão",   10,   20, true,  "Banco Exemplo"],
  ["Cartão Secundário",   "Cartão",   25,    8, true,  "Banco Exemplo"],
  ["Loja Exemplo",        "Loja",   null, null, true,  null],
  ["Pessoa A",            "Pessoa", null, null, true,  null],
  ["Cartão Encerrado",    "Cartão",   18,   26, false, null],
  ["Pessoa B",            "Pessoa", null, null, true,  null],
];

/* credor, descrição, categoria, meio, valor, parcela, total, mês, data, [quem divide, quanto é dele]

   Nas linhas de cartão a data e o mês precisam ser coerentes com o fechamento:
   no Principal (fecha 10, vence 20) a fatura de setembro leva compras de 10/08
   a 09/09; no Secundário (fecha 25, vence 8) a de setembro leva de 01/08 a
   24/08. A conferência no fim do arquivo reclama se eu errar uma linha. */
const CARTAO = "Cartão de crédito";
const DIVIDAS = [
  /* ---- Principal: fatura de setembro ---- */
  ["Cartão Principal",  "Delivery Exemplo",     "Alimentação", CARTAO,  37.00, 1,  1, "2026-09", "2026-08-12"],
  ["Cartão Principal",  "Lavanderia Exemplo",   "Serviços",    CARTAO,  19.00, 1,  1, "2026-09", "2026-08-17"],
  ["Cartão Principal",  "Transporte por app",   "Transporte",  CARTAO,  64.00, 1,  1, "2026-09", "2026-08-20"],
  ["Cartão Principal",  "Transporte por app",   "Transporte",  CARTAO,  28.00, 1,  1, "2026-09", "2026-09-02"],
  ["Cartão Principal",  "Seguro Exemplo",       "Serviços",    CARTAO, 233.00, 3, 30, "2026-09", "2026-07-14"],
  ["Cartão Principal",  "Eletrônico Exemplo",   "Compras",     CARTAO, 188.00, 2,  6, "2026-09", "2026-07-19"],
  /* ---- Principal: fatura de outubro ---- */
  ["Cartão Principal",  "Passagem Exemplo",     "Viagem",      CARTAO, 141.00, 1,  1, "2026-10", "2026-09-11"],
  ["Cartão Principal",  "Compra Exemplo",       "Compras",     CARTAO,  17.00, 1,  1, "2026-10", "2026-09-16"],
  ["Cartão Principal",  "Delivery Exemplo",     "Alimentação", CARTAO,  29.00, 1,  1, "2026-10", "2026-09-22"],
  ["Cartão Principal",  "Academia Exemplo",     "Saúde",       CARTAO, 133.00, 1,  1, "2026-10", "2026-09-27"],
  ["Cartão Principal",  "Transporte por app",   "Transporte",  CARTAO,  72.00, 1,  1, "2026-10", "2026-10-03"],
  /* ---- Secundário: mesmo banco, outro ciclo ---- */
  ["Cartão Secundário", "Combustível Exemplo",  "Transporte",  CARTAO, 166.00, 1,  1, "2026-09", "2026-08-06"],
  ["Cartão Secundário", "Transporte por app",   "Transporte",  CARTAO,  43.00, 1,  1, "2026-09", "2026-08-13"],
  ["Cartão Secundário", "Assinatura Exemplo",   "Assinaturas", CARTAO,   7.00, 1,  1, "2026-09", "2026-08-21"],
  ["Cartão Secundário", "Compra Exemplo",       "Compras",     CARTAO,  96.00, 1,  5, "2026-10", "2026-09-08"],
  /* ---- mesmo banco, sem fatura: cada parcela vence sozinha ---- */
  ["Banco Exemplo", "Financiamento Exemplo", "Transporte", "Financiamento", 1111.00, 15, 40, "2026-09", null],
  ["Banco Exemplo", "Empréstimo Exemplo",    "Outros",     "Empréstimo",     666.00,  6, 15, "2026-09", null],
  /* ---- nem loja nem pessoa viram fatura ---- */
  ["Loja Exemplo", "Eletrodoméstico Exemplo", "Moradia", "Carnê",           137.00, 10, 18, "2026-09", null],
  ["Pessoa A",     "Evento Exemplo",          "Lazer",   "Pix", 444.00,  7, 14, "2026-09", null, "Pessoa B", 222.00],
  ["Pessoa A",     "Ingresso Exemplo",        "Lazer",   "Pix", 260.00,  1,  1, "2026-09", null, "Pessoa B", 130.00],
];

/* nome, valor, categoria, meio, credor (vazio = fora de fatura), obs, varia? */
const FIXAS = [
  ["Aluguel Exemplo",        1333.00, "Moradia",     "Débito automático", "",                   "contrato até mar/27"],
  ["Condomínio Exemplo",      377.00, "Moradia",     "Boleto",            "",                   "vence dia 10", true],
  ["Energia Exemplo",         162.00, "Moradia",     "Débito automático", "",                   "valor varia", true],
  ["Assinatura de vídeo",      39.00, "Assinaturas", CARTAO,              "Cartão Principal",   ""],
  ["Assinatura de música",     17.00, "Assinaturas", CARTAO,              "Cartão Secundário",  ""],
  ["Custo de vida variável", 1122.00, "Alimentação", "Pix",               "",                   "mercado, transporte"],
];

const idDe = new Map();
/* o pai vem antes do filho na lista, então o id dele já existe aqui */
const credores = CREDORES.map(([nome, tipo, fecha, vence, ativo, pai], i) => {
  idDe.set(nome, "c" + i);
  return { id: "c" + i, nome, tipo, contato: "", obs: "", ordem: (i + 1) * 10,
           ativo, dia_fechamento: fecha, dia_vencimento: vence,
           credor_pai_id: pai ? idDe.get(pai) : null };
});

/* Categorias da V2: duas raízes de saída, uma de entrada, e uma filha em cada
   -- o bastante para a lista de escolha mostrar caminho de dois níveis. */
const CATEGORIAS_V2 = [
  { id: "g1", pai_id: null, nome: "Moradia",   nivel: 1, fluxo: "saida",   cor: "#1F5E52", icone: "", ativo: true, ordem: 10 },
  { id: "g2", pai_id: null, nome: "Transporte",nivel: 1, fluxo: "saida",   cor: "#2F4858", icone: "", ativo: true, ordem: 20 },
  { id: "g3", pai_id: null, nome: "Renda",     nivel: 1, fluxo: "entrada", cor: "#4C7A5A", icone: "", ativo: true, ordem: 30 },
  { id: "g4", pai_id: "g1", nome: "Aluguel",   nivel: 2, fluxo: "saida",   cor: null, icone: "", ativo: true, ordem: 10 },
  { id: "g5", pai_id: "g1", nome: "Energia",   nivel: 2, fluxo: "saida",   cor: null, icone: "", ativo: true, ordem: 20 },
  { id: "g6", pai_id: "g2", nome: "Combust\u00edvel", nivel: 2, fluxo: "saida", cor: null, icone: "", ativo: true, ordem: 10 },
  { id: "g7", pai_id: "g3", nome: "Sal\u00e1rio",  nivel: 2, fluxo: "entrada", cor: null, icone: "", ativo: true, ordem: 10 },
];

/* Movimento de setembro. `t3`/`t4` são as duas pernas de UMA transferência:
   elas compartilham `transferencia_id` e se anulam no patrimônio. `t5` é a
   saída que liquidou a primeira conta fixa do mês. */
const TRANSACOES_V2 = [
  { id: "t1", conta_id: "ct1", categoria_id: "g7", tipo: "entrada", natureza: "normal",
    descricao: "Sal\u00e1rio", valor: 7400, data: "2026-09-05", status: "realizada",
    origem: null, origem_id: null, obs: "", transferencia_id: null },
  { id: "t2", conta_id: "ct1", categoria_id: "g6", tipo: "saida", natureza: "normal",
    descricao: "Combust\u00edvel", valor: 300, data: "2026-09-08", status: "realizada",
    origem: null, origem_id: null, obs: "", transferencia_id: null },
  { id: "t3", conta_id: "ct1", categoria_id: null, tipo: "saida", natureza: "transferencia",
    descricao: "Para a reserva", valor: 500, data: "2026-09-10", status: "realizada",
    origem: null, origem_id: null, obs: "", transferencia_id: "tr1" },
  { id: "t4", conta_id: "ct2", categoria_id: null, tipo: "entrada", natureza: "transferencia",
    descricao: "Da conta corrente", valor: 500, data: "2026-09-10", status: "realizada",
    origem: null, origem_id: null, obs: "", transferencia_id: "tr1" },
  { id: "t5", conta_id: "ct1", categoria_id: "g4", tipo: "saida", natureza: "normal",
    descricao: "Aluguel Exemplo", valor: 1333, data: "2026-09-05", status: "realizada",
    origem: "fixa", origem_id: "fx:f0", obs: "", transferencia_id: null },
];

const DB = {
  dividas: DIVIDAS.map(([credor, descricao, categoria, meio, valor, pi, tot, mes, data, quem, quanto], i) => ({
    id: "d" + i, credor, credor_id: idDe.get(credor), descricao, categoria, meio,
    valor, parcela_inicial: pi, total_parcelas: tot, mes_inicial: mes,
    data_compra: data, obs: "", ordem: (i + 1) * 10,
    pessoa_id: quem ? idDe.get(quem) : null, valor_terceiro: quanto || 0,
  })),
  fixas: FIXAS.map(([nome, valor, categoria, meio, credor, obs, varia], i) => ({
    id: "f" + i, nome, valor, categoria, meio, credor,
    credor_id: idDe.get(credor) || null, obs, ordem: (i + 1) * 10,
    variavel: !!varia,
  })),
  /* energia de setembro já chegou; condomínio ainda não -- os dois estados na
     mesma tela, que é como a coisa realmente fica */
  fixas_mes: [{ mes: "2026-09", fixa_id: "f2", valor: 183.00 }],
  credores,
  receitas: [
    { id: "r1", descricao: "Aluguel recebido", categoria: "Aluguel", valor: 888, tipo: "mensal", mes_inicial: null, mes_final: null, obs: "", ordem: 10 },
    { id: "r2", descricao: "Serviço Exemplo", categoria: "Freelance", valor: 2750, tipo: "pontual", mes_inicial: "2026-11", mes_final: null, obs: "metade na entrega", ordem: 20 },
    { id: "r3", descricao: "Adicional Exemplo", categoria: "Bônus", valor: 470, tipo: "mensal", mes_inicial: "2026-10", mes_final: "2027-03", obs: "", ordem: 30 },
    { id: "r4", descricao: "13º salário", categoria: "Extra", valor: 3900, tipo: "pontual", mes_inicial: "2026-12", mes_final: null, obs: "", ordem: 40 },
  ],
  /* setembro meio pago: a fatura do Secundário quitada, o aluguel e a energia em dia */
  pagamentos: [
    { mes: "2026-09", item_id: "d11" }, { mes: "2026-09", item_id: "d12" },
    { mes: "2026-09", item_id: "d13" }, { mes: "2026-09", item_id: "fx:f4" },
    { mes: "2026-09", item_id: "fx:f0" }, { mes: "2026-09", item_id: "fx:f2" },
  ],
  config: { renda: 7400 },

  /* ---------------------------------------------------------------- V2 ----
     Contas, categorias e movimento. Fictício como o resto do arquivo: nome
     genérico, valor redondo, nada vindo de base em uso. */
  instituicoes: [
    { id: "i1", nome: "Banco Exemplo",    tipo: "Banco",    logo: "", cor: "#1F5E52", ativo: true, obs: "", ordem: 10 },
    { id: "i2", nome: "Fintech Exemplo",  tipo: "Fintech",  logo: "", cor: "#2F4858", ativo: true, obs: "", ordem: 20 },
  ],
  contas: [
    { id: "ct1", instituicao_id: "i1", nome: "Conta corrente", tipo: "corrente",
      saldo_inicial: 2000, saldo_inicial_em: "2026-01-01", liquidez: "livre",
      moeda: "BRL", ativo: true, obs: "", ordem: 10 },
    { id: "ct2", instituicao_id: "i2", nome: "Reserva", tipo: "poupanca",
      saldo_inicial: 5000, saldo_inicial_em: "2026-01-01", liquidez: "livre",
      moeda: "BRL", ativo: true, obs: "", ordem: 20 },
    { id: "ct3", instituicao_id: "i1", nome: "FGTS", tipo: "fgts",
      saldo_inicial: 3000, saldo_inicial_em: "2026-01-01", liquidez: "restrita",
      moeda: "BRL", ativo: true, obs: "", ordem: 30 },
  ],
  categorias: CATEGORIAS_V2,
  transacoes: TRANSACOES_V2,
  /* A única liquidação do cenário: a primeira conta fixa de setembro, paga
     pela conta corrente. A marca correspondente já está em `pagamentos` --
     a conferência abaixo cobra isso. */
  liquidacoes: [
    { id: "lq1", tipo: "fixa", item_id: "fx:f0", competencia: "2026-09",
      transacao_id: "t5", valor: 1333, criado_em: "2026-09-05T12:00:00Z" },
  ],

  /* METAS, e as três com regra de propósito: a linha da regra tem TRÊS
     estados visuais -- pendente, aplicada e parcial -- e a prévia existe para
     olhar os três lado a lado, na mesma tela, na largura mais apertada. Uma
     meta só mostraria um estado e esconderia os outros dois. */
  metas: [
    { id: "mt1", nome: "Viagem de fim de ano", valor_alvo: 6000, prazo: "2026-12-20",
      prioridade: 1, cor: "", icone: "", status: "ativa", obs: "", ordem: 10,
      criado_em: "2026-06-01T12:00:00Z", regra_valor: 500, regra_ativa: true },
    { id: "mt2", nome: "Reserva de emergência", valor_alvo: 12000, prazo: null,
      prioridade: 2, cor: "", icone: "", status: "ativa", obs: "", ordem: 20,
      criado_em: "2026-06-01T12:00:00Z", regra_valor: 800, regra_ativa: true },
    { id: "mt3", nome: "Troca do notebook", valor_alvo: 4000, prazo: "2027-03-31",
      prioridade: 2, cor: "", icone: "", status: "ativa", obs: "", ordem: 30,
      criado_em: "2026-06-01T12:00:00Z", regra_valor: 900, regra_ativa: true },
  ],
  alocacoes_de_meta: [
    /* mt1: a regra do mês coube inteira -> linha "aplicada" */
    { id: "al1", meta_id: "mt1", valor: 500, data: "2026-09-01",
      competencia: "2026-09", origem: "regra", obs: "Regra mensal" },
    /* e uma manual antiga, para o histórico não nascer vazio */
    { id: "al2", meta_id: "mt1", valor: 700, data: "2026-08-12",
      competencia: null, origem: "manual", obs: "" },
    /* mt3: coube 300 dos 900 -> linha "parcial", a que pinta de aviso */
    { id: "al3", meta_id: "mt3", valor: 300, data: "2026-09-01",
      competencia: "2026-09", origem: "regra", obs: "Regra mensal" },
    /* mt2 fica SEM alocação de regra neste mês -> linha "pendente", com botão */
  ],
};

/* A view do banco soma; aqui o dublê precisa entregar o MESMO número. Calcular
   em vez de digitar é o que impede a prévia de mostrar um saldo que o banco
   nunca produziria. */
DB.saldos_de_conta = DB.contas.map(c => ({
  conta_id: c.id, nome: c.nome, tipo: c.tipo, liquidez: c.liquidez,
  saldo_inicial: c.saldo_inicial, saldo_inicial_em: c.saldo_inicial_em,
  saldo: DB.transacoes
    .filter(t => t.conta_id === c.id && (t.status === "realizada" || t.status === "conciliada"))
    .reduce((v, t) => v + (t.tipo === "saida" ? -t.valor : t.valor), c.saldo_inicial),
}));

/* O hoje do gerador, no mesmo formato do app. A view do banco conta os meses
   até o prazo a partir de `current_date`, e a prévia precisa da mesma régua --
   uma data fixa aqui faria "meses até o prazo" apodrecer sozinha. */
const HOJE_ISO = new Date().toISOString().slice(0, 10);

/* `metas_resolvidas` é VIEW no banco: reservado, falta e percentual são
   derivados. Aqui também, pelo mesmo motivo dos saldos -- digitar o reservado
   seria digitar um número que o banco nunca produziria a partir das alocações
   ao lado, e a prévia passaria a mostrar uma conta que não existe. */
DB.metas_resolvidas = DB.metas.map((m) => {
  const alocs = DB.alocacoes_de_meta.filter((a) => a.meta_id === m.id);
  const reservado = alocs.reduce((s, a) => s + Number(a.valor), 0);
  let meses = null;
  if (m.prazo){
    const hoje = new Date(HOJE_ISO + "T00:00:00Z");
    const fim = new Date(m.prazo + "T00:00:00Z");
    meses = Math.max(1, (fim.getUTCFullYear() - hoje.getUTCFullYear()) * 12
                      + (fim.getUTCMonth() - hoje.getUTCMonth()) + 1);
  }
  return { meta_id: m.id, user_id: "u1", nome: m.nome, valor_alvo: m.valor_alvo,
    prazo: m.prazo, prioridade: m.prioridade, cor: m.cor, icone: m.icone,
    status: m.status, obs: m.obs, ordem: m.ordem, criado_em: m.criado_em,
    reservado, falta: Math.max(m.valor_alvo - reservado, 0),
    alocacoes: alocs.length,
    percentual: Math.min(Math.round(reservado * 100 / m.valor_alvo), 100),
    meses_ate_prazo: meses,
    regra_valor: m.regra_valor, regra_ativa: m.regra_ativa };
});

/* o saldo LIVRE que o banco calcula por função: só conta de liquidez livre */
const SALDO_LIVRE = DB.saldos_de_conta
  .filter((s) => s.liquidez === "livre")
  .reduce((v, s) => v + Number(s.saldo), 0);



/* ---- conferência: o mês declarado tem que bater com o ciclo do cartão ----
   Dado de exemplo errado é pior que dado nenhum: a tela fica plausível e
   esconde o defeito. Então o gerador confere antes de escrever. */
const midx = k => { const p = k.split("-"); return (+p[0]) * 12 + (+p[1]) - 1; };
const fromIdx = i => Math.floor(i / 12) + "-" + String(i % 12 + 1).padStart(2, "0");
const faturaDaCompra = (iso, fecha, vence) => {
  if (!iso || !fecha) return null;
  const p = String(iso).split("-");
  let m = midx(p[0] + "-" + p[1]);
  if (+p[2] >= fecha) m += 1;
  return fromIdx(m + ((vence && vence > fecha) ? 0 : 1));
};
const porNome = Object.fromEntries(CREDORES.map(c => [c[0], c]));
let erros = 0;
for (const [credor, desc, , meio, , pi, , mes, data] of DIVIDAS) {
  /* só a primeira parcela nasce na fatura da compra; as seguintes são derivadas */
  if (meio !== CARTAO || !data || pi !== 1) continue;
  const [, , fecha, vence] = porNome[credor];
  const esperado = faturaDaCompra(data, fecha, vence);
  if (esperado !== mes) {
    console.error("  INCOERENTE: " + credor + " / " + desc + " comprado em " + data
      + " cairia na fatura de " + esperado + ", não em " + mes);
    erros++;
  }
}
/* Liquidação de dívida ou fixa sem a marca da V1 é estado impossível: a RPC
   escreve as duas na mesma transação. Cenário incoerente esconde defeito. */
for (const l of DB.liquidacoes) {
  if (l.tipo === "receita") continue;
  if (!DB.pagamentos.some(p => p.mes === l.competencia && p.item_id === l.item_id)) {
    console.error("  INCOERENTE: liquidação de " + l.item_id + " em " + l.competencia
      + " sem a marca correspondente em `pagamentos`.");
    erros++;
  }
  const t = DB.transacoes.find(x => x.id === l.transacao_id);
  if (!t) {
    console.error("  INCOERENTE: liquidação aponta para a transação "
      + l.transacao_id + ", que não existe no cenário.");
    erros++;
  } else if (t.valor !== l.valor) {
    /* a RPC escreve os dois a partir do MESMO parâmetro. Diferir aqui é
       inventar um estado que o banco não produz. */
    console.error("  INCOERENTE: a liquidação de " + l.item_id + " diz " + l.valor
      + " e a transação diz " + t.valor + ".");
    erros++;
  }
}

if (erros) {
  console.error("\n" + erros + " linha(s) incoerentes no cenário de exemplo.");
  process.exit(1);
}

const stub = `
/* ===== Dublê do Supabase: só para inspeção visual, nunca publicado ===== */
const __DB = ${JSON.stringify(DB)};
function createClient(){
  const resp = (data) => {
    const p = Promise.resolve({ data, error: null });
    /* Encadeamento inteiro: a V2 filtra por faixa de data (gte/lt), e um dublê
       que não conhece um método derruba a prévia com "não é função". Aqui
       nenhum deles FILTRA de verdade -- a prévia é inspeção visual, e o
       cenário já vem do tamanho certo. */
    const api = {
      select: () => api, order: () => api, eq: () => api, limit: () => api,
      gte: () => api, lt: () => api, lte: () => api, gt: () => api,
      in: () => api, neq: () => api, is: () => api, ilike: () => api,
      insert: () => api, update: () => api, upsert: () => api, delete: () => api,
      maybeSingle: () => p, single: () => p,
      then: (a, b) => p.then(a, b),
    };
    return api;
  };
  return {
    from: (t) => resp(__DB[t] ?? []),
    /* saldo_livre_do_usuario é a UNICA que responde, e precisa responder: sem
       ela carregaMetas falha inteira e a tela de Metas nasce vazia -- que e
       justamente a tela que a previa costuma ser aberta para olhar. O valor vem
       calculado das contas de liquidez livre, nao digitado.
       As outras nao tem como rodar sem banco, e a previa diz isso em vez de
       fingir que deu certo.
       (Sem crase neste comentario: ele mora dentro do template do dublê, e uma
       crase aqui fecharia o literal no meio.) */
    rpc: (nome) => nome === "saldo_livre_do_usuario"
      ? Promise.resolve({ data: ${JSON.stringify(SALDO_LIVRE)}, error: null })
      : Promise.resolve({ data: null,
          error: { message: "a prévia não fala com o banco" } }),
    auth: {
      onAuthStateChange: (cb) => { cb("SIGNED_IN", { user: { id: "u1" } });
        return { data: { subscription: { unsubscribe(){} } } }; },
      getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } } }),
      signInWithPassword: () => Promise.resolve({ error: null }),
      signOut: () => Promise.resolve({}),
    },
  };
}
`;

const IMPORT = /import \{ createClient \} from "https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2(?:\.\d+){0,2}\/\+esm";/;
const html = readFileSync(ENTRADA, "utf8");
if (!IMPORT.test(html)) {
  console.error("FALHA: não achei a linha de import do supabase-js no index.html.");
  process.exit(1);
}

/* ---- por que a prévia precisa embutir os módulos -----------------------
   O navegador RECUSA `import` a partir de file://: o módulo vem de origem
   "null" e a política de CORS barra. No ar isso não existe, porque o Pages
   serve tudo por HTTPS e o import resolve normalmente -- continua sem bundler
   e sem passo de build para produção.

   Mas a prévia é feita para ser aberta como arquivo, com dois cliques. Então
   aqui, e SÓ aqui, o grafo de módulos é achatado num script só. É ferramenta
   de inspeção local, não empacotamento de produção.

   O achatamento é deliberadamente burro, e pode ser porque o estilo dos
   módulos do projeto é uniforme: só `import { … } from "./caminho.js"` e só
   `export const` / `export function`. Nada de default, de `export {}` no fim,
   de renomeação nem de import dinâmico. Se alguém introduzir uma dessas, o
   gerador para e diz -- em vez de gerar uma prévia sutilmente errada. */
const RAIZ_JS = fileURLToPath(raiz);

function leModulo(rel){
  try { return readFileSync(join(RAIZ_JS, rel), "utf8"); }
  catch { console.error("FALHA: módulo não encontrado: " + rel); process.exit(1); }
}

const RE_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["'];?\s*$/gm;
/* `import * as v2 from "./x.js"`. Ele entra na regra do achatador porque a
   tradução é EXATA, não chute: no escopo único todos os nomes já existem
   soltos, então o namespace vira um objeto que aponta para eles. O gerador
   sabe quais são, porque já lê os `export` de cada módulo para detectar
   colisão. */
const RE_NAMESPACE = /^import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*["'](\.[^"']+)["'];?\s*$/gm;
/* REEXPORTAÇÃO: `export { a, b } from "./x.js"`. No escopo único ela não faz
   nada -- `a` e `b` já estão soltos ali -- então some. O que ela ainda vale é
   como ARESTA: quem reexporta depende de quem declara, e sem seguir essa aresta
   o módulo de origem podia nem entrar na prévia.
   `[^}]*` atravessa quebra de linha de propósito: a lista de `v2-screens.js`
   ocupa três linhas, e exigir uma só seria exigir que o código se deformasse
   para caber na ferramenta. */
const RE_REEXPORT = /^export\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["'];?\s*$/gm;

const exportadosDe = (rel) => {
  const fonte = leModulo(rel);
  const proprios = [...fonte
    .matchAll(/^export\s+(?:async\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  /* o que o módulo reexporta também é exportado POR ele: quem faz
     `import * as x` desse módulo espera esses nomes no namespace */
  const repassados = [...fonte.matchAll(RE_REEXPORT)]
    .flatMap((m) => m[1].split(",").map((n) => n.trim()).filter(Boolean));
  return [...proprios, ...repassados];
};

/* percorre o grafo em profundidade, dependência antes de quem depende */
function ordena(relInicial, vistos = new Set(), ordem = []){
  if (vistos.has(relInicial)) return ordem;
  vistos.add(relInicial);
  const fonte = leModulo(relInicial);
  const base = dirname(relInicial);
  for (const m of fonte.matchAll(RE_IMPORT)){
    const alvo = normalize(join(base, m[2]));
    ordena(alvo, vistos, ordem);
  }
  for (const m of fonte.matchAll(RE_NAMESPACE)){
    const alvo = normalize(join(base, m[2]));
    ordena(alvo, vistos, ordem);
  }
  for (const m of fonte.matchAll(RE_REEXPORT)){
    const alvo = normalize(join(base, m[2]));
    ordena(alvo, vistos, ordem);
  }
  ordem.push(relInicial);
  return ordem;
}

/* UM APELIDO DE NAMESPACE, UMA DECLARAÇÃO SÓ.
   Sete telas fazem `import * as v2 from ".../v2-repository.js"`. Traduzindo
   cada uma para `const v2 = {…}` saem sete `const v2` no mesmo escopo, e a
   prévia morre em "Identifier 'v2' has already been declared" -- sem passar
   pela checagem de colisão, que lê o FONTE e lá só existe `import`.
   A primeira tradução vale e as outras somem. Isso é seguro porque `ordena`
   já garantiu que o módulo de origem vem antes de todos que o importam.
   Dois apelidos iguais apontando para módulos DIFERENTES seriam outra coisa,
   e aí o gerador para: o objeto emitido serviria a um e mentiria para o
   outro. */
const namespacesEmitidos = new Map();
function declaraNamespace(apelido, alvo, rel){
  const jaEmitido = namespacesEmitidos.get(apelido);
  if (jaEmitido && jaEmitido !== alvo){
    console.error("FALHA: o apelido `" + apelido + "` aponta para " + jaEmitido
      + " e para " + alvo + " (em " + rel + "). No escopo único da prévia só cabe "
      + "um dos dois. Use apelidos diferentes.");
    process.exit(1);
  }
  if (jaEmitido) return "/* namespace `" + apelido + "` já declarado acima */";
  namespacesEmitidos.set(apelido, alvo);
  return "const " + apelido + " = { " + exportadosDe(alvo).join(", ") + " };";
}

function achata(fonte, rel){
  const base = dirname(rel);
  /* o namespace é reconstruído como objeto literal apontando para os nomes que
     já vão estar soltos no escopo único */
  const semNamespace = fonte.replace(RE_NAMESPACE, (_, apelido, caminho) =>
    declaraNamespace(apelido, normalize(join(base, caminho)), rel));
  const semImport = semNamespace.replace(RE_IMPORT, "").replace(RE_REEXPORT, "");
  if (/^\s*export\s+(default|\{)/m.test(semImport)){
    console.error("FALHA: " + rel + " usa `export default` ou `export {}`, que o "
      + "achatamento da prévia não sabe resolver. Use `export const` / `export function`.");
    process.exit(1);
  }
  if (/^\s*import\s/m.test(semImport)){
    console.error("FALHA: sobrou um import em " + rel + " que o gerador não reconheceu. "
      + "A prévia só entende `import { … } from \"./caminho.js\"`.");
    process.exit(1);
  }
  return semImport.replace(/^export\s+/gm, "");
}

/* os módulos que o index.html importa, na ordem em que aparecem */
const doIndex = [...html.matchAll(RE_IMPORT), ...html.matchAll(RE_NAMESPACE)]
  .map(m => normalize(m[2].replace(/^\.\//, "")));
const ordem = [];
for (const rel of doIndex) ordena(rel, new Set(ordem.map(x => x)), ordem);

/* NOME DE TOPO REPETIDO, e as duas espécies dele.
   No escopo único, dois `const cent` viram
   "Identifier 'cent' has already been declared" e a prévia nem abre. Mas as
   duas espécies de nome repetido não são o mesmo problema:

   PRIVADO. Quatro módulos de domínio têm um `const cent` só deles, e isso é
   BOM: helper de arredondamento é detalhe interno, e obrigar nome único no
   projeto inteiro seria piorar o código de produção para agradar uma
   ferramenta de inspeção local. O gerador RENOMEIA essas cópias, cada uma com
   o sufixo do módulo onde mora. Ninguém de fora as chama -- é o que "privado"
   quer dizer -- então renomear não alcança nenhuma outra linha.

   EXPORTADO. Aí o nome é a API: dois módulos exportando `carregaMetas` são
   dois nomes que se confundem de verdade, para quem lê e para quem importa.
   Esse continua parando o gerador, porque o conserto é no projeto, não aqui.
   (Foi assim que `carregaMetas` do estado virou `carregaMetasEAlocacoes`.) */
const RE_TOPO = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm;

const exportadosPorModulo = new Map(ordem.map((rel) => [rel, new Set(exportadosDe(rel))]));
/* index.html não exporta nada, mas também não pode ser renomeado: ele é o app,
   e o que está na margem dele é o escopo de destino. Conta como público. */
const ehPublico = (rel, nome) => rel === "index.html" || exportadosPorModulo.get(rel).has(nome);

const quemDeclara = new Map();
for (const rel of [...ordem, "index.html"]){
  const fonte = rel === "index.html" ? html : leModulo(rel);
  for (const m of fonte.matchAll(RE_TOPO)){
    if (!quemDeclara.has(m[1])) quemDeclara.set(m[1], []);
    const donos = quemDeclara.get(m[1]);
    if (!donos.includes(rel)) donos.push(rel);
  }
}

/* `js/domain/reversal.js` -> `reversal`; o sufixo diz de onde o nome veio, que
   é o que torna a prévia gerada legível quando alguém vai depurar nela. */
const sufixoDe = (rel) => rel.replace(/^js\//, "").replace(/\.js$/, "").replace(/[^A-Za-z0-9]+/g, "_");

const renomeios = new Map(ordem.map((rel) => [rel, new Map()]));
for (const [nome, donos] of quemDeclara){
  if (donos.length < 2) continue;
  const publicos = donos.filter((rel) => ehPublico(rel, nome));
  if (publicos.length > 1){
    console.error("FALHA: `" + nome + "` é EXPORTADO por " + publicos.join(" e ")
      + ". No achatamento da prévia os dois caem no mesmo escopo, e renomear um "
      + "exportado aqui esconderia um nome ambíguo no projeto. Renomeie no código.");
    process.exit(1);
  }
  for (const rel of donos)
    if (!ehPublico(rel, nome)) renomeios.get(rel).set(nome, nome + "$" + sufixoDe(rel));
}

/* A troca é textual, e o cuidado está no que ela NÃO pode pegar: acesso a
   propriedade (`x.cent`), nome colado em outro nome (`centavos`) e chave de
   objeto em forma curta (`{ cent }`), que renomeada mudaria a chave e não só
   a referência. As três ficam de fora pelos contornos abaixo. */
function renomeiaPrivados(fonte, rel){
  let saida = fonte;
  for (const [de, para] of renomeios.get(rel)){
    const re = new RegExp("(?<![.\\w$])" + de + "(?![\\w$])(?!\\s*[:,}])", "g");
    const curto = new RegExp("[{,]\\s*" + de + "\\s*[,}]");
    if (curto.test(fonte)){
      console.error("FALHA: `" + de + "` em " + rel + " aparece como chave curta de objeto, "
        + "e o gerador precisaria renomeá-lo por causa de uma colisão. Renomeie no código.");
      process.exit(1);
    }
    saida = saida.replace(re, para);
  }
  return saida;
}

const embutidos = ordem.map((rel) =>
  "/* ===== " + rel + " ===== */\n" + renomeiaPrivados(achata(leModulo(rel), rel), rel)).join("\n");

/* O index.html também importa por namespace (`import * as v1 from ...`), e ele
   precisa do mesmo tratamento que os módulos: sem isto sobrava um import de
   verdade no arquivo gerado, e o navegador tentava buscá-lo por file:// -- que
   é exatamente o que a prévia existe para evitar. */
const namespacesDoIndex = [...html.matchAll(RE_NAMESPACE)].map(([, apelido, caminho]) =>
  declaraNamespace(apelido, normalize(caminho.replace(/^\.\//, "")), "index.html")).join("\n");

const corpo = html
  .replace(IMPORT, stub)
  .replace(RE_IMPORT, "")
  .replace(RE_NAMESPACE, "")
  .replace(stub, stub + "\n" + embutidos + "\n" + namespacesDoIndex + "\n");

writeFileSync(SAIDA, corpo, "utf8");
console.log("preview.html gerado: " + credores.length + " credores, "
  + DIVIDAS.length + " lançamentos, " + FIXAS.length + " contas fixas, "
  + ordem.length + " módulos embutidos.");

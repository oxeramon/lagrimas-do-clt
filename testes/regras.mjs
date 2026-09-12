/* Testa as regras de negócio do app.
   Não há build nem bundler: o teste importa EXATAMENTE os mesmos módulos que o
   navegador carrega. Antes ele recortava um trecho do index.html com new
   Function, e aquilo tinha um problema de fundo -- o que rodava no teste era
   uma cópia do que rodava no app, e cópia se descola. Agora não há dois
   motores financeiros: há um, e o teste usa ele.

   A fixture abaixo é 100% sintética e espelha a carga de exemplo do
   supabase-setup.sql. Ela não vem de base nenhuma em uso: os valores são
   redondos de propósito, e nenhum número aqui diz quanto alguém deve. */
import { readFileSync } from "node:fs";

import { S } from "../js/core/state.js";
import { midx, addM, label, HOJE } from "../js/core/dates.js";
import { money, pct, temValor } from "../js/core/money.js";
import { esc } from "../js/core/escape.js";
import {
  restantesDe, ultimoMes, parcelaEm, pagoId, dividasDoMes, totalDividas,
  saldoAberto, abertoDe, totalQuitado, agrupaAberto, parcelasAVencer,
  fimGeral, saldoAposMes, escolheMesInicial, progressoDe, temJuros, meuDe,
} from "../js/domain/debts.js";
import { valorFixa, informado, fixasEstimadas, totalFixas } from "../js/domain/fixed.js";
import {
  aplicaEm, receitasDoMes, totalReceitas, rendaDoMes, periodoReceita,
} from "../js/domain/income.js";
import { credorDe, paiDe, raizDe, filhosDe, nomeCredorDe, nomeBancoDe,
         credorPorNome } from "../js/domain/creditors.js";
import { faturaDaCompra } from "../js/domain/billing.js";
import { indicadoresDeContas, porInstituicao, porTipo, saldoDaConta,
         rotuloDoTipo, podeExcluirConta } from "../js/domain/accounts.js";
import { sinalDe, valorComSinal, contaNoSaldo, ehTransferencia, filtraTransacoes,
         totaisDoPeriodo, agrupaPorData, gastoPorCategoria, semTransferencias,
         evolucaoDoSaldo } from "../js/domain/transactions.js";
import { categoriasPorFluxo, caminhoDaCategoria, arvoreDeCategorias,
         paisPossiveis, descendentesDe } from "../js/domain/categories.js";
import { doBanco, paraBanco, paraCamel, paraSnake } from "../js/data/v2-repository.js";
import { monogramaDe, contrasteSobre, doCatalogo } from "../js/ui/institution-catalog.js";
import { raizesPadrao, filhasPadrao, quantasCategoriasPadrao } from "../js/ui/category-catalog.js";
import { ABAS, idsDasAbas, grupoDaAba, abasDoRodape, abasDoMais } from "../js/ui/navigation.js";
import { saidasDoMes, entradasDoMes, resumoDoMes, estadoDoCompromisso,
         indiceDeLiquidacoes, chaveDe, mesesEmAtraso,
         ABERTO, LIQUIDADO, PAGO_SEM_MOVIMENTO } from "../js/domain/reconciliation.js";

let ok = 0, bad = 0;
const eq = (nome, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { ok++; }
  else { bad++; console.error(`  ✗ ${nome}\n      esperado ${b}\n      obtido   ${a}`); }
};

/* ---- fixture sintética, igual à carga de exemplo do supabase-setup.sql ----

   Seis linhas, escolhidas para cobrir o que o app trata de forma diferente:
   pagamento à vista, parcelamento que começa na parcela 1, parcelamento que
   começa no meio (quem entra na 3 de 6 pagou 2 antes) e um prazo longo.

   Os três totais saem da própria fixture, sem número mágico escrito à mão:
     aberto     = Σ valor × (total − inicial + 1)
     contratado = Σ valor × total
     quitado    = Σ (inicial − 1) × valor
   O primeiro é o que a seção 5 do SQL imprime como saldo_devedor_total, e é
   por isso que ele é recalculado aqui: se a expressão do app e a do SQL
   discordarem, uma das duas está errada.                                     */
const seed = [
  ["Loja Exemplo",   "Compra Exemplo à vista",   "Compras",        111.00,  1,  1, "2026-10"],
  ["Cartão Exemplo", "Fatura Exemplo",           "Cartão",         222.00,  1,  1, "2026-10"],
  ["Cartão Exemplo", "Compra Exemplo parcelada", "Cartão",          33.00,  1,  4, "2026-11"],
  ["Pessoa Exemplo", "Item Exemplo",             "Terceiros",      144.00,  3,  6, "2026-10"],
  ["Pessoa Exemplo", "Serviço Exemplo",          "Terceiros",       88.00,  4,  9, "2026-10"],
  ["Banco Exemplo",  "Financiamento Exemplo",    "Financiamento", 1111.00, 12, 36, "2026-10"],
];
const cent = v => Math.round(v * 100) / 100;
const ABERTO_FIXTURE = cent(seed.reduce((s, r) => s + r[3] * (r[5] - r[4] + 1), 0));
const CONTRATADO = cent(seed.reduce((s, r) => s + r[3] * r[5], 0));
const QUITADO    = cent(seed.reduce((s, r) => s + (r[4] - 1) * r[3], 0));

/* A amarra com o SQL: o número esperado não é copiado para cá, é lido da
   seção 5 do supabase-setup.sql. Assim, se a carga de exemplo mudar e esta
   fixture não acompanhar, o teste acusa -- que é justamente o descompasso que
   ninguém percebe olhando um arquivo de cada vez. */
const sql = readFileSync(new URL("../supabase-setup.sql", import.meta.url), "utf8");
const achado = sql.match(/saldo_devedor_total sai ([\d.]+)\b/);
if (!achado) {
  console.error("FALHA: não achei o valor de conferência na seção 5 do supabase-setup.sql");
  process.exit(1);
}
const CONFERENCIA = Number(achado[1]);

S.dividas = seed.map(([credor, descricao, categoria, valor, pi, tot, mes], i) => ({
  id: "d" + i, credor, descricao, categoria, valor,
  parcelaInicial: pi, totalParcelas: tot, mesInicial: mes, obs: "", ordem: (i + 1) * 10,
}));
S.fixas = [{ id: "f1", nome: "Aluguel Exemplo", valor: 777 }, { id: "f2", nome: "Conta Exemplo", valor: 123 }];
S.pagos = {};

console.log("regras existentes (não podem ter mudado)");
eq("saldo devedor bate com a conferência do SQL", cent(saldoAberto(null)), CONFERENCIA);
eq("a fixture reproduz a carga de exemplo do SQL", ABERTO_FIXTURE, CONFERENCIA);
eq("restantesDe 3/6", restantesDe(S.dividas[3]), 4);
eq("última parcela de 3/6 em 2026-10", ultimoMes(S.dividas[3]), "2027-01");
eq("parcela única existe no mês", parcelaEm(S.dividas[0], "2026-10").n, 1);
eq("parcela única não existe depois", parcelaEm(S.dividas[0], "2026-11"), null);
eq("parcela não existe antes do início", parcelaEm(S.dividas[2], "2026-10"), null);
eq("parcelas a vencer", parcelasAVencer(), seed.reduce((s, r) => s + (r[5] - r[4] + 1), 0));

console.log("quitado vs em aberto (ponto flutuante)");
/* O painel mostrava "-R$ 0,00 já quitados" quando nada estava pago, porque
   comparava uma soma feita por multiplicação com outra feita mês a mês. */
eq("quitado nunca é negativo", totalQuitado() >= 0, true);
const soUma = S.dividas.filter(d => d.parcelaInicial === 1);
eq("dívida que começa na parcela 1, sem nada marcado, quitado é exatamente zero",
  soUma.reduce((t, d) => t + (d.parcelaInicial - 1) * d.valor, 0), 0);

/* Quem entra na parcela 3 de 6 já pagou 2 antes de o app existir. Essas não
   têm marca em `pagamentos`, e contar só as marcadas escondia o que já tinha
   sido pago -- na fixture, tudo o que a coluna parcela_inicial afirma. */
eq("parcelas anteriores à inicial contam como quitadas", cent(totalQuitado()), QUITADO);
S.pagos = { "2026-10": { d3: true, d5: true } };  // Item Exemplo e Financiamento Exemplo de out/26
eq("marcar no mês soma por cima das anteriores",
  cent(totalQuitado()), cent(QUITADO + S.dividas[3].valor + S.dividas[5].valor));
eq("quitado + aberto reconstrói o total contratado",
  cent(totalQuitado() + saldoAberto(null)), CONTRATADO);
S.pagos = {};

console.log("saldo depois do mês desconta o que já foi pago");
/* Era a única soma de saldo que ignorava `pagamentos`. Isso fazia a curva de
   quitação começar num ponto que descontava o pago e seguir em pontos que não
   descontavam: adiantar parcela não derrubava a curva. */
{
  const d = S.dividas[2];                      // Compra Exemplo parcelada, 1/4
  const base = saldoAposMes(d.mesInicial);
  S.pagos = { [addM(d.mesInicial, 3)]: { [d.id]: true } };
  eq("parcela futura marcada sai do saldo depois do mês",
    cent(base - saldoAposMes(d.mesInicial)), cent(d.valor));
  eq("parcela paga no próprio mês k não muda o saldo depois de k",
    (S.pagos = { [d.mesInicial]: { [d.id]: true } }, saldoAposMes(d.mesInicial)), base);
  S.pagos = {};
}

console.log("receitas pontuais");
S.receitas = [{ id: "r1", descricao: "Serviço Exemplo", categoria: "Extra", valor: 800, tipo: "pontual", mesInicial: "2026-11", mesFinal: null }];
eq("não conta no mês anterior", aplicaEm(S.receitas[0], "2026-10"), false);
eq("conta no mês exato", aplicaEm(S.receitas[0], "2026-11"), true);
eq("não conta no mês seguinte", aplicaEm(S.receitas[0], "2026-12"), false);
eq("total do mês exato", totalReceitas("2026-11"), 800);
eq("total fora do mês", totalReceitas("2026-12"), 0);

console.log("receitas mensais");
const mensal = (mi, mf) => ({ id: "x", descricao: "m", categoria: "Extra", valor: 100, tipo: "mensal", mesInicial: mi, mesFinal: mf });
S.receitas = [mensal(null, null)];
eq("sem limites vale sempre", [aplicaEm(S.receitas[0], "2020-01"), aplicaEm(S.receitas[0], "2099-12")], [true, true]);
S.receitas = [mensal("2026-11", null)];
eq("com início vale do início em diante", [aplicaEm(S.receitas[0], "2026-10"), aplicaEm(S.receitas[0], "2026-11"), aplicaEm(S.receitas[0], "2030-01")], [false, true, true]);
S.receitas = [mensal(null, "2026-11")];
eq("com fim vale até o fim", [aplicaEm(S.receitas[0], "2026-11"), aplicaEm(S.receitas[0], "2026-12")], [true, false]);
S.receitas = [mensal("2026-11", "2027-01")];
eq("intervalo é inclusivo nas duas pontas",
  ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"].map(k => aplicaEm(S.receitas[0], k)),
  [false, true, true, true, false]);
eq("vira o ano corretamente", aplicaEm(S.receitas[0], "2027-01"), true);

console.log("renda do mês");
S.renda = 5000;
S.receitas = [mensal("2026-11", null), { id: "p", descricao: "b", categoria: "Bônus", valor: 2000, tipo: "pontual", mesInicial: "2026-12", mesFinal: null }];
eq("mês sem extras = renda base", rendaDoMes("2026-10"), 5000);
eq("mês com mensal", rendaDoMes("2026-11"), 5100);
eq("mês com mensal + pontual", rendaDoMes("2026-12"), 7100);
S.renda = 0;
eq("sem renda base ainda soma os extras", rendaDoMes("2026-12"), 2100);

console.log("rótulo de período");
eq("pontual", periodoReceita({ tipo: "pontual", mesInicial: "2026-11" }), "nov/26");
eq("mensal sem limites", periodoReceita(mensal(null, null)), "sem prazo");
eq("mensal só com início", periodoReceita(mensal("2026-11", null)), "desde nov/26");
eq("mensal só com fim", periodoReceita(mensal(null, "2026-11")), "até nov/26");
eq("mensal com intervalo", periodoReceita(mensal("2026-11", "2027-01")), "nov/26–jan/27");

console.log("saldo de uma dívida só, e agrupamento");
/* abertoDe é a mesma conta de saldoAberto para uma linha. Elas precisam
   concordar: se uma passar a multiplicar em vez de somar mês a mês, a soma das
   partes deixa de bater com o todo, e nenhum outro teste percebe. */
eq("a soma dos abertos de cada dívida é o saldo total",
  cent(S.dividas.reduce((t, d) => t + abertoDe(d), 0)), cent(saldoAberto(null)));
S.pagos = { "2026-10": { d5: true } };
eq("marcar uma parcela reduz abertoDe exatamente o valor dela",
  cent(abertoDe(S.dividas[5])), cent((36 - 12 + 1 - 1) * S.dividas[5].valor));
S.pagos = {};
/* agrupaAberto é o que alimenta credores e categorias no painel. Ele tem que
   somar o mesmo total e devolver do maior para o menor. */
{
  const porCredor = agrupaAberto(d => d.credor);
  eq("agrupar por credor soma o mesmo total",
    cent(porCredor.reduce((t, x) => t + x.v, 0)), cent(saldoAberto(null)));
  eq("agrupamento vem do maior para o menor",
    porCredor.map(x => x.v).every((v, i, a) => i === 0 || a[i - 1] >= v), true);
}

console.log("fim geral e mês de entrada");
eq("fimGeral é o último mês entre todas as dívidas",
  fimGeral(null), S.dividas.map(d => d.mesInicial).length
    ? S.dividas.reduce((m, d) => (m === null || midx(ultimoMes(d)) > midx(m)) ? ultimoMes(d) : m, null)
    : null);
eq("fimGeral respeita o filtro",
  fimGeral(d => d.categoria === "Cartão"), ultimoMes(S.dividas[2]));
eq("sem dívida nenhuma, fimGeral é nulo", fimGeral(() => false), null);

console.log("contas fixas: média no cadastro, real por mês");
S.fixas = [{ id: "f1", nome: "Fixa Exemplo", valor: 300, variavel: true },
           { id: "f2", nome: "Outra Exemplo", valor: 200, variavel: false }];
S.fixasMes = {};
eq("sem valor informado, vale a média do cadastro", valorFixa(S.fixas[0], "2026-10"), 300);
eq("e `informado` diz que ainda é palpite", informado(S.fixas[0], "2026-10"), false);
S.fixasMes = { "2026-10": { f1: 412 } };
eq("informado um mês, vale o real daquele mês", valorFixa(S.fixas[0], "2026-10"), 412);
eq("e `informado` passa a dizer que não é mais palpite", informado(S.fixas[0], "2026-10"), true);
/* o contrato que mais importa: informar outubro não pode mexer em setembro
   nem em novembro. Uma implementação que sobrescrevesse `fixas.valor` passaria
   nos dois testes acima e falharia nestes dois. */
eq("o mês anterior continua na média", valorFixa(S.fixas[0], "2026-09"), 300);
eq("o mês seguinte continua na média", valorFixa(S.fixas[0], "2026-11"), 300);
eq("conta fixa vale em qualquer mês consultado, sem prazo",
  [valorFixa(S.fixas[1], "2020-01"), valorFixa(S.fixas[1], "2099-12")], [200, 200]);
/* Zero informado é informação, não ausência. Conta variável pode vir zerada --
   condomínio dispensado, energia num mês sem consumo -- e aí o app tem que
   mostrar zero, não voltar para a média. Uma implementação por veracidade
   (`!!valor`) trata o zero como "não informado" e passa em todo o resto. */
S.fixasMes = { "2026-10": { f1: 0 } };
eq("zero informado vale zero, não a média", valorFixa(S.fixas[0], "2026-10"), 0);
eq("e zero informado conta como informado", informado(S.fixas[0], "2026-10"), true);
S.fixasMes = { "2026-10": { f1: 412 } };
eq("totalFixas soma o real onde há real e a média no resto",
  totalFixas("2026-10"), 612);
eq("e no mês sem informação soma só as médias", totalFixas("2026-11"), 500);
S.fixas = []; S.fixasMes = {};

console.log("fatura de cartão: em que mês a compra é paga");
/* Esta regra só ficou testável quando saiu do index.html. Ela é pura --
   recebe data e ciclo, devolve mês -- e é a que mais custa caro errar, porque
   um mês trocado joga a compra para a fatura errada sem nenhum aviso. */
/* vencimento DEPOIS do fechamento: a fatura é paga no mesmo mês que fecha */
eq("compra antes do fechamento cai na fatura que fecha naquele mês",
  faturaDaCompra("2026-03-05", 10, 20), "2026-03");
eq("compra depois do fechamento cai na fatura seguinte",
  faturaDaCompra("2026-03-15", 10, 20), "2026-04");
/* a fronteira, que é o motivo de a comparação ser >= e não > */
eq("compra NO DIA do fechamento já é do ciclo seguinte",
  faturaDaCompra("2026-03-10", 10, 20), "2026-04");
eq("e a véspera do fechamento ainda é do ciclo atual",
  faturaDaCompra("2026-03-09", 10, 20), "2026-03");
/* vencimento ANTES do fechamento: o pagamento escorrega um mês */
eq("vencimento antes do fechamento empurra a fatura um mês",
  faturaDaCompra("2026-03-05", 25, 8), "2026-04");
eq("e a compra no dia do fechamento empurra dois",
  faturaDaCompra("2026-03-25", 25, 8), "2026-05");
eq("dezembro vira o ano corretamente", faturaDaCompra("2026-12-15", 10, 20), "2027-01");
eq("sem dia de fechamento não há fatura a deduzir",
  [faturaDaCompra("2026-03-05", null, 20), faturaDaCompra(null, 10, 20)], [null, null]);

console.log("hierarquia banco e cartão");
S.credores = [
  { id: "c0", nome: "Banco Exemplo", paiId: null },
  { id: "c1", nome: "Cartão Principal", paiId: "c0" },
  { id: "c2", nome: "Cartão Secundário", paiId: "c0" },
  { id: "c3", nome: "Loja Exemplo", paiId: null },
];
{
  const noCartao = { credorId: "c1", credor: "Cartão Principal" };
  const naLoja   = { credorId: "c3", credor: "Loja Exemplo" };
  eq("credorDe acha pelo id", credorDe(noCartao).nome, "Cartão Principal");
  eq("credorDe cai no nome quando não há id", credorDe({ credor: "Loja Exemplo" }).nome, "Loja Exemplo");
  eq("paiDe sobe um nível", paiDe(S.credores[1]).nome, "Banco Exemplo");
  eq("raizDe de um produto é o banco", raizDe(S.credores[1]).nome, "Banco Exemplo");
  /* o contrato dos DOIS níveis: a raiz de quem não tem pai é ele mesmo, e não
     null. Uma implementação que subisse em laço até o topo daria o mesmo
     resultado aqui e entraria em loop num ciclo -- por isso ela sobe UM só. */
  eq("raizDe de quem não tem pai é ele mesmo", raizDe(S.credores[0]).nome, "Banco Exemplo");
  eq("paiDe de quem não tem pai é nulo", paiDe(S.credores[0]), null);
  eq("filhosDe lista os produtos do banco",
    filhosDe(S.credores[0]).map(c => c.nome), ["Cartão Principal", "Cartão Secundário"]);
  eq("filhosDe de um produto é vazio", filhosDe(S.credores[1]), []);
  /* agrupar pelo produto detalha; pelo banco, junta */
  eq("nomeCredorDe é o produto", nomeCredorDe(noCartao), "Cartão Principal");
  eq("nomeBancoDe é o banco", nomeBancoDe(noCartao), "Banco Exemplo");
  eq("sem hierarquia os dois coincidem",
    [nomeCredorDe(naLoja), nomeBancoDe(naLoja)], ["Loja Exemplo", "Loja Exemplo"]);
  eq("credorPorNome ignora caixa e espaço", credorPorNome("  banco exemplo ").id, "c0");
  eq("credorPorNome não inventa credor", credorPorNome("Não Existe"), undefined);
}
S.credores = [];

console.log("progresso da dívida e meios com juros");
S.dividas = [{ id: "dA", valor: 100, parcelaInicial: 4, totalParcelas: 10,
               mesInicial: "2026-10", ordem: 10, meio: "Carnê", valorTerceiro: 40 }];
S.pagos = {};
eq("progresso conta as anteriores ao cadastro",
  progressoDe(S.dividas[0]), { quitadas: 3, total: 10, frac: 0.3 });
S.pagos = { "2026-10": { dA: true }, "2026-11": { dA: true } };
eq("e soma as marcadas por cima",
  progressoDe(S.dividas[0]), { quitadas: 5, total: 10, frac: 0.5 });
/* nunca passa do total, mesmo se as marcas excederem: o cartão mostraria
   "11 de 10 pagas" e a barra estouraria a caixa */
S.pagos = { "2026-10": { dA: true }, "2026-11": { dA: true }, "2026-12": { dA: true },
            "2027-01": { dA: true }, "2027-02": { dA: true }, "2027-03": { dA: true },
            "2027-04": { dA: true }, "2027-05": { dA: true } };
eq("quitadas nunca passa do total", progressoDe(S.dividas[0]).quitadas, 10);
S.pagos = {};
eq("financiamento e empréstimo são meios com juros",
  [temJuros({ meio: "Financiamento" }), temJuros({ meio: "Empréstimo" }),
   temJuros({ meio: "Carnê" }), temJuros({ meio: "Cartão de crédito" })],
  [true, true, false, false]);
/* rateio: o que é seu é o que sobra depois do que a outra pessoa devolve */
eq("meuDe desconta a parte do terceiro", meuDe(S.dividas[0]), 60);
eq("sem terceiro, tudo é seu", meuDe({ valor: 100 }), 100);
S.dividas = [];

/* ==================================================================
   V2 · CONTAS, TRANSAÇÕES, CATEGORIAS
   ------------------------------------------------------------------
   Fixture sintética e independente: nomes genéricos, valores redondos,
   UUIDs inventados. Nada aqui veio de base nenhuma.
   ================================================================== */
console.log("\ncontas: indicadores da tela");

const cts = [
  { id: "c1", nome: "Conta Um",    tipo: "corrente",     liquidez: "livre",     instituicaoId: "i1", ativo: true },
  { id: "c2", nome: "Conta Dois",  tipo: "poupanca",     liquidez: "livre",     instituicaoId: "i1", ativo: true },
  { id: "c3", nome: "Reserva",     tipo: "fgts",         liquidez: "restrita",  instituicaoId: "i2", ativo: true },
  { id: "c4", nome: "Presa",       tipo: "corrente",     liquidez: "bloqueada", instituicaoId: null, ativo: true },
  { id: "c5", nome: "Antiga",      tipo: "corrente",     liquidez: "livre",     instituicaoId: "i1", ativo: false },
];
const sld = [
  { contaId: "c1", saldo: 1000 }, { contaId: "c2", saldo: 500 },
  { contaId: "c3", saldo: 300 },  { contaId: "c4", saldo: 200 },
  { contaId: "c5", saldo: 9999 },
];
const insts = [
  { id: "i1", nome: "Instituição Um", cor: "#123456", logo: "" },
  { id: "i2", nome: "Instituição Dois", cor: null, logo: "" },
];

const ind = indicadoresDeContas(cts, sld);
eq("saldo em contas soma só as ativas", ind.total, 2000);
eq("disponível é só a liquidez livre", ind.disponivel, 1500);
eq("restrito não entra no disponível", ind.restrito, 300);
eq("bloqueado é uma terceira caixa", ind.bloqueado, 200);
eq("conta inativa fica de fora e é contada à parte",
  [ind.quantidade, ind.inativas], [4, 1]);
/* saldo ausente não é zero: a tela precisa saber que ainda não sabe */
eq("saldo de conta que a view ainda não trouxe é null", saldoDaConta(sld, "c9"), null);
eq("conta sem saldo conhecido não entra na soma",
  indicadoresDeContas([{ id: "cx", liquidez: "livre", ativo: true }], []),
  { total: 0, disponivel: 0, restrito: 0, bloqueado: 0, quantidade: 1, inativas: 0, semSaldo: 1 });

eq("distribuição por instituição vem do maior para o menor",
  porInstituicao(cts, sld, insts).map(g => [g.nome, g.total]),
  [["Instituição Um", 1500], ["Instituição Dois", 300], ["Sem instituição", 200]]);
eq("conta sem instituição vira grupo próprio, não some",
  porInstituicao(cts, sld, insts).some(g => g.nome === "Sem instituição"), true);
eq("distribuição por tipo usa o rótulo legível",
  porTipo(cts, sld).map(g => g.nome),
  ["Conta corrente", "Poupança", "FGTS"]);
eq("tipo desconhecido cai em Outro", rotuloDoTipo("marte"), "Outro");
eq("conta com movimento não pode ser excluída",
  [podeExcluirConta(0), podeExcluirConta(3)], [true, false]);

console.log("\ntransações: sinal, filtro e totais");

const tx = [
  { id: "t1", contaId: "c1", categoriaId: "k1", tipo: "entrada", natureza: "normal",
    valor: 1000, data: "2026-03-05", status: "realizada", descricao: "Entrada normal" },
  { id: "t2", contaId: "c1", categoriaId: "k2", tipo: "saida", natureza: "normal",
    valor: 200, data: "2026-03-05", status: "realizada", descricao: "Saída normal" },
  { id: "t3", contaId: "c1", categoriaId: null, tipo: "saida", natureza: "transferencia",
    valor: 300, data: "2026-03-06", status: "realizada", descricao: "Transferência", transferenciaId: "g1" },
  { id: "t4", contaId: "c2", categoriaId: null, tipo: "entrada", natureza: "transferencia",
    valor: 300, data: "2026-03-06", status: "realizada", descricao: "Transferência", transferenciaId: "g1" },
  { id: "t5", contaId: "c1", categoriaId: "k2", tipo: "entrada", natureza: "estorno",
    valor: 50, data: "2026-03-07", status: "realizada", descricao: "Estorno de saída", estornoDeId: "t2" },
  { id: "t6", contaId: "c1", categoriaId: "k2", tipo: "saida", natureza: "normal",
    valor: 9999, data: "2026-03-08", status: "prevista", descricao: "Ainda vai sair" },
  { id: "t7", contaId: "c1", categoriaId: "k2", tipo: "saida", natureza: "normal",
    valor: 8888, data: "2026-03-09", status: "cancelada", descricao: "Cancelada" },
];

/* o sinal sai do tipo e de mais nada: é a regra que a 002 existiu para criar */
eq("entrada é +, saída é −", [sinalDe(tx[0]), sinalDe(tx[1])], [1, -1]);
eq("transferência não tem sinal próprio: a perna de saída é negativa",
  valorComSinal(tx[2]), -300);
eq("estorno também não: quem manda é o tipo", valorComSinal(tx[4]), 50);
eq("prevista e cancelada não entram no saldo",
  [contaNoSaldo(tx[5]), contaNoSaldo(tx[6]), contaNoSaldo(tx[0])], [false, false, true]);

const tot = totaisDoPeriodo(tx);
eq("entradas somam entrada realizada, inclusive a perna de transferência",
  tot.entradas, 1350);
eq("saídas somam saída realizada", tot.saidas, 500);
eq("resultado é entradas menos saídas", tot.resultado, 850);
eq("previstas ficam num número separado", tot.previstas, -9999);

/* a pergunta "quanto entrou e saiu de verdade" exclui as duas pernas */
const semTr = totaisDoPeriodo(semTransferencias(tx));
eq("sem transferências, entrou 1050 e saiu 200", [semTr.entradas, semTr.saidas], [1050, 200]);
eq("transferência não altera o resultado quando as duas pernas estão na lista",
  tot.resultado - semTr.resultado, 0);

eq("filtro vazio devolve tudo", filtraTransacoes(tx, {}).length, 7);
eq("filtro por conta", filtraTransacoes(tx, { contaId: "c2" }).map(t => t.id), ["t4"]);
eq("filtro por tipo", filtraTransacoes(tx, { tipo: "entrada" }).length, 3);
eq("filtro por status", filtraTransacoes(tx, { status: "prevista" }).map(t => t.id), ["t6"]);
eq("filtro por categoria", filtraTransacoes(tx, { categoriaId: "k1" }).map(t => t.id), ["t1"]);
eq("busca ignora maiúscula e olha descrição",
  filtraTransacoes(tx, { busca: "ESTORNO" }).map(t => t.id), ["t5"]);
eq("filtros combinam", filtraTransacoes(tx, { contaId: "c1", tipo: "saida" }).length, 4);
eq("busca que não acha devolve lista vazia", filtraTransacoes(tx, { busca: "zzz" }).length, 0);

const dias = agrupaPorData(tx);
eq("agrupa por dia, do mais recente para o mais antigo",
  dias.map(d => d.data), ["2026-03-09", "2026-03-08", "2026-03-07", "2026-03-06", "2026-03-05"]);
eq("o total do dia ignora prevista e cancelada",
  dias.find(d => d.data === "2026-03-08").total, 0);
eq("dia com as duas pernas da transferência fecha em zero",
  dias.find(d => d.data === "2026-03-06").total, 0);

eq("gasto por categoria só olha saída realizada e sem transferência",
  gastoPorCategoria(tx, [{ id: "k2", nome: "Categoria Dois" }]).map(g => [g.nome, g.total]),
  [["Categoria Dois", 200]]);
eq("saída sem categoria vira 'Sem categoria' em vez de sumir",
  gastoPorCategoria([{ tipo: "saida", natureza: "normal", status: "realizada",
                       valor: 10, categoriaId: null }], []).map(g => g.nome),
  ["Sem categoria"]);

eq("evolução do saldo acumula do mais antigo para o mais novo",
  evolucaoDoSaldo(tx, 100).map(d => d.saldo), [900, 900, 950, 950, 950]);

console.log("\ncategorias: árvore e fluxo");

const cats = [
  { id: "k1", paiId: null, nome: "Raiz Saída",   nivel: 1, fluxo: "saida",   ordem: 10, ativo: true },
  { id: "k2", paiId: "k1", nome: "Filha",        nivel: 2, fluxo: "saida",   ordem: 10, ativo: true },
  { id: "k3", paiId: "k2", nome: "Neta",         nivel: 3, fluxo: "saida",   ordem: 10, ativo: true },
  { id: "k4", paiId: null, nome: "Raiz Entrada", nivel: 1, fluxo: "entrada", ordem: 20, ativo: true },
  { id: "k5", paiId: null, nome: "Dos Dois",     nivel: 1, fluxo: "ambos",   ordem: 30, ativo: true },
  { id: "k6", paiId: null, nome: "Desativada",   nivel: 1, fluxo: "saida",   ordem: 40, ativo: false },
];
eq("fluxo saída traz as de saída e as de ambos",
  categoriasPorFluxo(cats, "saida").map(c => c.id), ["k1", "k2", "k3", "k5"]);
eq("fluxo entrada traz as de entrada e as de ambos",
  categoriasPorFluxo(cats, "entrada").map(c => c.id), ["k4", "k5"]);
eq("categoria desativada não aparece na escolha",
  categoriasPorFluxo(cats, "saida").some(c => c.id === "k6"), false);
eq("o caminho mostra a árvore inteira", caminhoDaCategoria(cats, "k3"), "Raiz Saída › Filha › Neta");
eq("caminho de raiz é o próprio nome", caminhoDaCategoria(cats, "k4"), "Raiz Entrada");
eq("caminho de id inexistente é vazio", caminhoDaCategoria(cats, "nada"), "");
eq("a árvore aninha e respeita a ordem",
  arvoreDeCategorias(cats).map(r => [r.nome, r.filhos.map(f => f.nome)]),
  [["Raiz Saída", ["Filha"]], ["Raiz Entrada", []], ["Dos Dois", []], ["Desativada", []]]);
/* a tela não oferece o quarto nível: o banco recusaria depois do formulário */
eq("nível 3 não pode ser pai", paisPossiveis(cats).map(c => c.id), ["k1", "k2", "k4", "k5"]);
eq("editando, a própria categoria não é pai de si",
  paisPossiveis(cats, "k1").some(c => c.id === "k1"), false);
eq("descendentes avisam o que o cascade leva junto",
  descendentesDe(cats, "k1").map(c => c.id), ["k2", "k3"]);

console.log("\ncamada de dados: snake_case ↔ camelCase");

eq("snake vira camel", paraCamel("saldo_inicial_em"), "saldoInicialEm");
eq("camel vira snake", paraSnake("saldoInicialEm"), "saldo_inicial_em");
eq("ida e volta não perde nada",
  paraSnake(paraCamel("transferencia_par_id")), "transferencia_par_id");
eq("doBanco converte as chaves e preserva os valores",
  doBanco({ id: 1, saldo_inicial: 10.5, conta_id: "x", estorno_de_id: null }),
  { id: 1, saldoInicial: 10.5, contaId: "x", estornoDeId: null });
eq("doBanco atravessa lista", doBanco([{ pai_id: "a" }, { pai_id: "b" }]),
  [{ paiId: "a" }, { paiId: "b" }]);
eq("doBanco devolve null como null", doBanco(null), null);
/* undefined é campo que o formulário não mexeu: mandar null apagaria o que
   estava lá */
/* Object.keys e não o objeto: JSON.stringify APAGA chave com undefined, então
   comparar os objetos deixaria passar a versão que mantém `obs: undefined` --
   e é justamente ela que apagaria o campo no banco. */
eq("paraBanco ignora undefined e mantém null",
  Object.keys(paraBanco({ nome: "x", obs: undefined, paiId: null })).sort(),
  ["nome", "pai_id"]);
eq("paraBanco preserva o valor null, que é apagar de propósito",
  paraBanco({ paiId: null }).pai_id, null);

console.log("\ncatálogos públicos e monograma");

eq("monograma de nome de uma palavra é uma letra", monogramaDe("Nubank"), "N");
eq("monograma de duas palavras é duas letras", monogramaDe("Mercado Pago"), "MP");
eq("preposição não vira inicial", monogramaDe("Banco do Brasil"), "BB");
eq("nome vazio não quebra", monogramaDe(""), "?");
/* texto branco sobre amarelo não se lê: o contraste decide, não o chute */
eq("cor escura pede texto claro", contrasteSobre("#111111"), "#FFFFFF");
eq("cor clara pede texto escuro", contrasteSobre("#FAE128"), "#14201C");
eq("cor inválida não quebra", contrasteSobre("banana"), "#FFFFFF");
eq("o catálogo acha por slug", doCatalogo("nubank").nome, "Nubank");
eq("slug desconhecido devolve null", doCatalogo("inexistente"), null);

const raizes = raizesPadrao();
eq("as categorias padrão têm raízes de saída, entrada e ambos",
  [...new Set(raizes.map(r => r.fluxo))].sort(), ["ambos", "entrada", "saida"]);
eq("nenhuma raiz padrão nasce com pai", raizes.every(r => !r.paiId), true);
const filhas = filhasPadrao(raizes.map((r, i) => ({ ...r, id: "id" + i })));
eq("toda filha aponta para uma raiz salva", filhas.every(f => !!f.paiId), true);
eq("filha herda o fluxo da mãe",
  filhas.every(f => raizes.some(r => r.fluxo === f.fluxo)), true);
eq("o total do catálogo bate com o que é gerado",
  raizes.length + filhas.length, quantasCategoriasPadrao());

console.log("\nnavegação");

eq("toda aba do registro tem grupo", ABAS.every(a => !!a.grupo), true);
eq("o rodapé do celular para em cinco", abasDoRodape().length <= 5, true);
eq("nenhuma aba fica fora do rodapé e do Mais ao mesmo tempo",
  idsDasAbas().every(id => abasDoRodape().some(a => a.id === id)
                        || abasDoMais().some(a => a.id === id)), true);
eq("rodapé e Mais não repetem a mesma aba",
  abasDoRodape().some(a => abasDoMais().some(b => b.id === a.id)), false);
eq("o grupo de uma aba conhecida", grupoDaAba("contas"), "MEU DINHEIRO");

/* ==================================================================
   PONTE V1 ↔ V2 · PREVISTO × REALIZADO
   ------------------------------------------------------------------
   A regra que estes casos existem para travar:

     compromisso liquidado deixa de ser previsto e passa a ser realizado.
     Aparece num lado OU no outro. Nunca nos dois.

   Fixture sintética e independente.
   ================================================================== */
console.log("\nponte: estado de um compromisso");

const MES = "2026-09";
const compromissos = [
  { id: "d1", nome: "Compromisso Um",  valor: 500 },
  { id: "d2", nome: "Compromisso Dois", valor: 300 },
  { id: "fx:f1", nome: "Conta Fixa",   valor: 120 },
];

eq("sem marca e sem vínculo, o compromisso está aberto",
  estadoDoCompromisso("d1", MES, indiceDeLiquidacoes([]), {}), ABERTO);
eq("com vínculo, está liquidado",
  estadoDoCompromisso("d1", MES, indiceDeLiquidacoes([{ itemId:"d1", competencia:MES }]), {}),
  LIQUIDADO);
eq("marcado no quadradinho, sem vínculo, é um terceiro estado",
  estadoDoCompromisso("d1", MES, indiceDeLiquidacoes([]), { [MES]: { d1: true } }),
  PAGO_SEM_MOVIMENTO);
/* liquidação sempre cria a marca; a marca nem sempre vem de liquidação */
eq("o vínculo vence a marca quando os dois existem",
  estadoDoCompromisso("d1", MES,
    indiceDeLiquidacoes([{ itemId:"d1", competencia:MES }]), { [MES]: { d1: true } }),
  LIQUIDADO);
eq("o vínculo é por competência, não pelo item",
  estadoDoCompromisso("d1", "2026-10",
    indiceDeLiquidacoes([{ itemId:"d1", competencia:MES }]), {}), ABERTO);
eq("a chave junta item e competência", chaveDe("d1", MES), "d1@2026-09");

console.log("\nCASO B · dívida paga não conta duas vezes");

/* a dívida de 500 foi liquidada: existe o vínculo E a transação de 500 */
const casoB = saidasDoMes({
  compromissos,
  transacoes: [{ id:"t1", tipo:"saida", natureza:"normal", status:"realizada", valor:500 }],
  liquidacoes: [{ itemId:"d1", competencia:MES, valor:500 }],
  pagos: { [MES]: { d1: true } },
  mes: MES,
});
eq("o previsto perde o compromisso liquidado", casoB.previsto, 420);   /* 300 + 120 */
eq("o realizado vem da transação", casoB.realizado, 500);
/* ESTE é o número perigoso: previsto + realizado daria 920 para 800 de
   compromisso e 500 de movimento. O comprometido conta cada obrigação UMA vez. */
eq("comprometido conta cada obrigação uma vez só", casoB.comprometido, 920);
eq("e o liquidado não é somado ao previsto",
  casoB.previsto + casoB.liquidado, casoB.comprometido - casoB.pagoSemMovimento);
eq("gasto do mês é 500, não 1.000", casoB.realizado, 500);

console.log("\npago sem movimento: o terceiro estado");

const semMov = saidasDoMes({
  compromissos,
  transacoes: [],
  liquidacoes: [],
  pagos: { [MES]: { "fx:f1": true } },
  mes: MES,
});
eq("marcado no quadradinho sai do previsto", semMov.previsto, 800);
/* não inventa saída que não existe */
eq("mas NÃO vira movimento realizado", semMov.realizado, 0);
eq("ele tem caixa própria, com nome próprio", semMov.pagoSemMovimento, 120);
eq("e o comprometido continua somando tudo uma vez", semMov.comprometido, 920);

console.log("\nCASO C · transferência não mexe no gasto");

const comTransf = saidasDoMes({
  compromissos: [],
  transacoes: [
    { id:"t1", tipo:"saida",   natureza:"transferencia", status:"realizada", valor:100, transferenciaId:"g1" },
    { id:"t2", tipo:"entrada", natureza:"transferencia", status:"realizada", valor:100, transferenciaId:"g1" },
    { id:"t3", tipo:"saida",   natureza:"normal",        status:"realizada", valor:70 },
  ],
  liquidacoes: [], pagos: {}, mes: MES,
});
eq("transferência não entra na saída realizada", comTransf.realizado, 70);

console.log("\nCASO D · receita recebida não conta duas vezes");

const receitas = [
  { id: "r1", descricao: "Receita Um",  valor: 1000 },
  { id: "r2", descricao: "Receita Dois", valor: 200 },
];
const casoD = entradasDoMes({
  receitas,
  transacoes: [{ id:"t1", tipo:"entrada", natureza:"normal", status:"realizada", valor:1000 }],
  liquidacoes: [{ itemId:"r1", competencia:MES, valor:1000 }],
  mes: MES,
});
eq("a receita recebida sai do a receber", casoD.previsto, 200);
eq("entrada realizada é 1.000, não 2.000", casoD.realizado, 1000);
eq("o que foi recebido do que estava previsto fica registrado", casoD.recebidoPrevisto, 1000);
eq("a receita ainda não recebida continua na lista de espera",
  casoD.itens.aReceber.map(r => r.id), ["r2"]);

console.log("\nresumo do mês");

const resumo = resumoDoMes({
  compromissos,
  receitas,
  transacoes: [
    { id:"t1", tipo:"saida",   natureza:"normal", status:"realizada", valor:500 },
    { id:"t2", tipo:"entrada", natureza:"normal", status:"realizada", valor:1000 },
    { id:"t3", tipo:"saida",   natureza:"normal", status:"prevista",  valor:9999 },
  ],
  liquidacoes: [{ itemId:"d1", competencia:MES, valor:500 },
                { itemId:"r1", competencia:MES, valor:1000 }],
  pagos: { [MES]: { d1: true } },
  mes: MES,
  saldoEmContas: 2000,
});
eq("resultado realizado é entradas menos saídas do movimento",
  resumo.resultadoRealizado, 500);
eq("ainda entra é só a receita não recebida", resumo.aindaEntra, 200);
eq("ainda sai é só o compromisso aberto", resumo.aindaSai, 420);
/* 2000 + 200 − 420. O saldo JÁ contém a entrada de 1.000: somá-la de novo
   seria contar duas vezes. */
eq("sobra projetada parte do saldo, não das entradas já realizadas",
  resumo.sobraProjetada, 1780);
eq("prevista não entra em movimento nenhum", resumo.saidas.realizado, 500);
/* 500 liquidado de 920 comprometido */
eq("aderência é o quanto do mês já virou pagamento",
  Math.round(resumo.aderencia * 1000) / 1000, 0.543);
eq("sem compromisso nenhum, aderência é null e não zero",
  resumoDoMes({ compromissos: [], receitas: [], transacoes: [], liquidacoes: [],
                pagos: {}, mes: MES, saldoEmContas: 0 }).aderencia, null);

console.log("\natraso");

eq("compromisso aberto de mês fechado aparece como atrasado",
  mesesEmAtraso(compromissos, [], {}, "2026-09", ["2026-07", "2026-08", "2026-09"])
    .map(c => c.id + "@" + c.competencia),
  ["d1@2026-07","d2@2026-07","fx:f1@2026-07","d1@2026-08","d2@2026-08","fx:f1@2026-08"]);
eq("o que foi liquidado não aparece como atrasado",
  mesesEmAtraso([{ id:"d1", valor:500 }],
    [{ itemId:"d1", competencia:"2026-08" }], {}, "2026-09", ["2026-08"]).length, 0);
eq("o que foi marcado no quadradinho também não",
  mesesEmAtraso([{ id:"d1", valor:500 }], [], { "2026-08": { d1: true } },
    "2026-09", ["2026-08"]).length, 0);

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

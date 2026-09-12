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
const ABERTO     = cent(seed.reduce((s, r) => s + r[3] * (r[5] - r[4] + 1), 0));
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
eq("a fixture reproduz a carga de exemplo do SQL", ABERTO, CONFERENCIA);
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

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

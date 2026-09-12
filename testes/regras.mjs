/* Testa as regras de negócio reais extraídas do index.html.
   Não há build nem bundler: o teste recorta o trecho puro do arquivo
   (do estado até o início do RENDER) e executa com um S de mentira.

   A fixture abaixo é 100% sintética e espelha a carga de exemplo do
   supabase-setup.sql. Ela não vem de base nenhuma em uso: os valores são
   redondos de propósito, e nenhum número aqui diz quanto alguém deve. */
import { readFileSync } from "node:fs";

const HTML = process.argv[2] || new URL("../index.html", import.meta.url);
/* No Windows o git materializa o arquivo com CRLF, e os marcadores abaixo
   procuram "\n". Normalizar na leitura deixa o teste igual em qualquer
   plataforma e em qualquer configuração de core.autocrlf. */
const html = readFileSync(HTML, "utf8").replaceAll("\r\n", "\n");

const ini = html.indexOf("const S = { dividas:");
const fim = html.indexOf("/* ====================================================================\n   RENDER");
if (ini < 0 || fim < 0) { console.error("FALHA: não achei o trecho de regras no index.html"); process.exit(1); }

const trecho = html.slice(ini, fim);
const api = new Function(trecho + `
  return { S, restantesDe, ultimoMes, parcelaEm, dividasDoMes, totalDividas, totalFixas,
           aplicaEm, receitasDoMes, totalReceitas, rendaDoMes, periodoReceita,
           saldoAberto, totalQuitado, parcelasAVencer, fimGeral, saldoAposMes,
           midx, addM, label };`)();

const {
  S, restantesDe, parcelaEm, aplicaEm, totalReceitas, rendaDoMes,
  periodoReceita, saldoAberto, totalQuitado, parcelasAVencer, ultimoMes,
  saldoAposMes, addM,
} = api;

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

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);

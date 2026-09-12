/* Transações: sinal, filtro, agrupamento e os totais do período.
 *
 * A regra central da V2, e ela cabe numa linha: quem dá o sinal é `tipo`.
 * `natureza` conta o que aconteceu e NUNCA mexe no sinal. Antes da 002 os dois
 * estavam misturados, e por isso transferência aparecia duas vezes e estorno
 * sempre somava. Se alguma função aqui precisar olhar `natureza` para decidir
 * se soma ou subtrai, a mudança está errada.
 */

export const TIPOS = [
  { id: "entrada", rotulo: "Entrada" },
  { id: "saida",   rotulo: "Saída" },
];

export const NATUREZAS = [
  { id: "normal",        rotulo: "Normal" },
  { id: "transferencia", rotulo: "Transferência" },
  { id: "estorno",       rotulo: "Estorno" },
];

export const STATUS = [
  { id: "realizada",  rotulo: "Realizada",  conta: true  },
  { id: "conciliada", rotulo: "Conciliada", conta: true  },
  { id: "prevista",   rotulo: "Prevista",   conta: false },
  { id: "cancelada",  rotulo: "Cancelada",  conta: false },
];

export const rotuloDoStatus = (id) =>
  (STATUS.find((s) => s.id === id) || { rotulo: id }).rotulo;

/* Entra no saldo realizado? É a mesma pergunta que a view faz no banco, e as
   duas respostas precisam continuar iguais. */
export const contaNoSaldo = (t) =>
  (STATUS.find((s) => s.id === t.status) || {}).conta === true;

/* +1 para entrada, −1 para saída. Sem caso especial, e é esse o ponto. */
export const sinalDe = (t) => (t.tipo === "entrada" ? 1 : -1);
export const valorComSinal = (t) => sinalDe(t) * Number(t.valor || 0);

export const ehTransferencia = (t) => t.natureza === "transferencia";
export const ehEstorno       = (t) => t.natureza === "estorno";

/* ------------------------------------------------------------------ filtro --
   Campo vazio não filtra. É o que permite a tela mandar o objeto inteiro de
   filtros sem montar condicional a cada campo. */
export function filtraTransacoes(lista, f = {}){
  const busca = (f.busca || "").trim().toLowerCase();
  return (lista || []).filter((t) => {
    if (f.contaId     && t.contaId     !== f.contaId) return false;
    if (f.categoriaId && t.categoriaId !== f.categoriaId) return false;
    if (f.tipo        && t.tipo        !== f.tipo) return false;
    if (f.status      && t.status      !== f.status) return false;
    if (f.natureza    && t.natureza    !== f.natureza) return false;
    if (busca){
      const alvo = ((t.descricao || "") + " " + (t.obs || "")).toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/* --------------------------------------------------------------- totais --
   Prevista e cancelada ficam fora, pela mesma razão do banco: total do período
   é o que aconteceu. `previsto` vai separado -- é outra pergunta, e misturar
   as duas é como se promete dinheiro que não chegou. */
export function totaisDoPeriodo(lista){
  const t = { entradas: 0, saidas: 0, resultado: 0, previstas: 0, quantidade: 0 };
  for (const x of (lista || [])){
    t.quantidade += 1;
    const v = Number(x.valor || 0);
    if (!contaNoSaldo(x)){
      if (x.status === "prevista") t.previstas += sinalDe(x) * v;
      continue;
    }
    if (x.tipo === "entrada") t.entradas += v; else t.saidas += v;
  }
  t.resultado = t.entradas - t.saidas;
  return t;
}

/* Transferência não é receita nem despesa: ela só muda o dinheiro de gaveta.
   Para "quanto entrou e quanto saiu de verdade no mês", as duas pernas se
   anulam e precisam sair da conta. */
export const semTransferencias = (lista) => (lista || []).filter((t) => !ehTransferencia(t));

/* ----------------------------------------------------------- agrupamento --
   Por dia, do mais recente para o mais antigo, que é a ordem de leitura de
   extrato. Devolve array em vez de objeto porque a ordem importa e objeto não
   promete ordem de chave. */
export function agrupaPorData(lista){
  const dias = new Map();
  for (const t of (lista || [])){
    const d = String(t.data || "").slice(0, 10);
    if (!dias.has(d)) dias.set(d, []);
    dias.get(d).push(t);
  }
  return [...dias.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([data, itens]) => ({ data, itens, total: itens.reduce((s, t) =>
        s + (contaNoSaldo(t) ? valorComSinal(t) : 0), 0) }));
}

/* --------------------------------------------------------- por categoria --
   Só as saídas realizadas, e sem transferência: a pergunta é "para onde foi o
   dinheiro", e transferência não foi para lugar nenhum. */
export function gastoPorCategoria(lista, categorias){
  const nomeDe = new Map((categorias || []).map((c) => [c.id, c]));
  const grupos = new Map();
  for (const t of semTransferencias(lista || [])){
    if (t.tipo !== "saida" || !contaNoSaldo(t)) continue;
    const cat = t.categoriaId ? nomeDe.get(t.categoriaId) : null;
    const chave = cat ? cat.id : "sem";
    const atual = grupos.get(chave) || {
      id: chave, nome: cat ? cat.nome : "Sem categoria", cor: cat ? cat.cor : null, total: 0,
    };
    atual.total += Number(t.valor || 0);
    grupos.set(chave, atual);
  }
  return [...grupos.values()].sort((a, b) => b.total - a.total);
}

/* Saldo acumulado dia a dia dentro da lista, para a linha do gráfico. Começa
   do saldo informado e caminha do mais antigo para o mais novo. */
export function evolucaoDoSaldo(lista, saldoInicial = 0){
  const porDia = agrupaPorData(lista).slice().reverse();
  let acumulado = Number(saldoInicial) || 0;
  return porDia.map((d) => {
    acumulado += d.total;
    return { data: d.data, saldo: acumulado, movimento: d.total };
  });
}

/* Categorias: a árvore de até três níveis.
 *
 * O nível é coluna no banco, calculada por gatilho a partir do pai. Aqui ele é
 * só lido -- recalcular no frontend criaria uma segunda verdade sobre a mesma
 * coisa, e as duas iam divergir no primeiro caso estranho.
 */

export const FLUXOS = [
  { id: "saida",   rotulo: "Saída" },
  { id: "entrada", rotulo: "Entrada" },
  { id: "ambos",   rotulo: "Entrada e saída" },
];

export const NIVEL_MAXIMO = 3;

/* Serve a lista de escolha de uma transação. `ambos` aparece nos dois lados de
   propósito: "Ajuste" e "Taxa" são das duas naturezas. */
export function categoriasPorFluxo(categorias, fluxo){
  return (categorias || []).filter((c) =>
    c.ativo !== false && (c.fluxo === fluxo || c.fluxo === "ambos"));
}

/* "Alimentação › Restaurante › Pizza". O caminho existe porque só o nome da
   folha não diz nada numa lista: "Outros" aparece em cinco árvores. */
export function caminhoDaCategoria(categorias, id, separador = " › "){
  const porId = new Map((categorias || []).map((c) => [c.id, c]));
  const partes = [];
  let atual = porId.get(id);
  /* o teto de três níveis também é o limite da subida: árvore com ciclo é
     impossível pelo banco, mas um limite explícito é melhor que confiar nisso */
  for (let i = 0; atual && i <= NIVEL_MAXIMO; i++){
    partes.unshift(atual.nome);
    atual = atual.paiId ? porId.get(atual.paiId) : null;
  }
  return partes.join(separador);
}

/* Árvore para desenhar: cada nó com os filhos dentro, raízes primeiro, tudo em
   ordem de `ordem` e depois nome. */
export function arvoreDeCategorias(categorias){
  const nos = new Map((categorias || []).map((c) => [c.id, { ...c, filhos: [] }]));
  const raizes = [];
  for (const no of nos.values()){
    const pai = no.paiId ? nos.get(no.paiId) : null;
    if (pai) pai.filhos.push(no); else raizes.push(no);
  }
  const ordena = (lista) => {
    lista.sort((a, b) => (a.ordem - b.ordem) || a.nome.localeCompare(b.nome, "pt-BR"));
    lista.forEach((n) => ordena(n.filhos));
    return lista;
  };
  return ordena(raizes);
}

/* A tela não deve OFERECER um quarto nível. O banco recusa de qualquer jeito
   -- ele é a autoridade --, mas deixar a pessoa preencher um formulário
   inteiro para receber erro no fim é desrespeito com o tempo dela. */
export function paisPossiveis(categorias, idEditando){
  return (categorias || []).filter((c) =>
    c.ativo !== false && c.nivel < NIVEL_MAXIMO && c.id !== idEditando);
}

/* Descendentes de uma categoria, para avisar o que some junto: `pai_id` é
   `on delete cascade`, então apagar uma raiz leva a árvore inteira. */
export function descendentesDe(categorias, id){
  const filhosDe = new Map();
  for (const c of (categorias || [])){
    if (!c.paiId) continue;
    if (!filhosDe.has(c.paiId)) filhosDe.set(c.paiId, []);
    filhosDe.get(c.paiId).push(c);
  }
  const fora = [];
  const desce = (pai) => {
    for (const f of (filhosDe.get(pai) || [])){ fora.push(f); desce(f.id); }
  };
  desce(id);
  return fora;
}

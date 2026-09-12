---
name: public-repo-hygiene
description: Higiene de repositório público. Use ANTES de criar ou editar fixture, seed, exemplo, CSV, preview, screenshot, migration, teste com dados, documentação, comentário com exemplo, integração externa, e antes de qualquer commit ou push. Estabelece o que pode e o que não pode entrar no Git, como inventar dado sintético de verdade, e o procedimento de auditoria obrigatório.
---

# Public Repository Hygiene

## Objetivo

Impedir que dados pessoais, financeiros, identificáveis, secretos ou
desnecessários sejam introduzidos no repositório público.

## Regra principal

Nunca sanitizar depois.

O dado real não deve entrar no arquivo versionado em primeiro lugar.

## Quando esta skill é obrigatória

Use esta skill antes de:

- criar ou editar fixtures;
- criar seeds;
- criar exemplos;
- alterar README ou documentação;
- escrever comentários contendo exemplos;
- gerar CSV;
- criar previews;
- criar screenshots ou artefatos;
- adicionar migrations;
- adicionar integração externa;
- criar testes com dados;
- fazer commit;
- fazer push.

## Classificação

### PUBLICÁVEL

- código-fonte;
- schema sem dados reais;
- migrations sem dados reais;
- documentação técnica genérica;
- valores e identidades sintéticos;
- URLs públicas;
- Supabase URL;
- Supabase publishable/anon key.

### NÃO PUBLICÁVEL

Qualquer informação real ou derivada de:

- usuário;
- situação financeira;
- banco;
- cartão;
- dívida;
- financiamento;
- salário;
- receita;
- conta;
- compra;
- contrato;
- pessoa relacionada;
- base de produção.

Também são privados:

- service_role;
- tokens;
- senhas;
- chaves privadas;
- dados de autenticação;
- dumps;
- backups;
- arquivos exportados da produção.

## Dados sintéticos

Um dado sintético deve ser inventado independentemente.

NÃO é sintético:

- valor real arredondado;
- nome real parcialmente ocultado;
- cartão real com alguns dígitos trocados;
- data real deslocada alguns dias;
- parcela 13/48 transformada em 12/48;
- ciclo real com um dos dias modificado;
- combinação de informações derivada de um registro real.

Prefira gerar um conjunto artificial desde o início.

### A convenção deste projeto

Todo valor monetário de exemplo termina em `.00`. Extrato de verdade quase nunca
produz centavos zerados, então essa convenção é ao mesmo tempo uma marca de
"isto é inventado" e uma coisa que a auditoria consegue conferir sozinha. Os
nomes seguem o mesmo caminho: `Banco Exemplo`, `Pessoa A`, `Cartão Principal`.

Ao precisar de um conjunto novo, escreva a lista do zero e só então confira se
ela colide com algo conhecido. O caminho inverso — pegar o real e mexer — é
exatamente o que esta skill proíbe.

## Minimização

Mesmo que uma informação não seja confidencial, pergunte:

"Ela precisa estar no repositório?"

Se não for necessária para:

- executar o software;
- testar uma regra;
- explicar a arquitetura;
- instalar o projeto;

não a registre.

## Mensagens de commit

Nunca inclua:

- dado real;
- nome de pessoa;
- valor financeiro;
- identificador de produção;
- descrição detalhada de informação que foi removida.

Use descrições técnicas.

Bom:

    fix: adjust credit-card billing rule

Ruim:

    fix: Santander parcela de R$ X da pessoa Y

## Falha segura

Se a classificação for incerta:

1. não grave;
2. use placeholder sintético;
3. informe a dúvida ao usuário.

## Antes do push

Obrigatoriamente:

1. executar auditoria automática;
2. verificar staged + working tree;
3. verificar arquivos novos;
4. verificar documentação;
5. verificar fixtures/seeds;
6. verificar mensagens dos commits que serão enviados;
7. verificar que nenhum arquivo ignorado foi adicionado por engano.

Push só é permitido com resultado ZERO ocorrências críticas.

## A ferramenta

```bash
node testes/audita.mjs              # árvore rastreada
node testes/audita.mjs --staged     # só o que está em stage
node testes/audita.mjs --push       # árvore + mensagens dos commits a enviar
```

Ela roda sozinha em três momentos:

| Quando | Quem dispara |
|---|---|
| depois de cada Write/Edit | `.claude/hooks/checa-publico.mjs` |
| antes de cada push | `.githooks/pre-push` |
| quando você quiser | à mão |

Saída diferente de zero significa ocorrência **crítica**, e crítica bloqueia.
Avisos aparecem mas não bloqueiam.

## O baseline privado

A auditoria genérica pega padrão: CPF, token, JWT, cartão. Ela não tem como
saber que um valor específico veio da sua base, porque **essa lista não pode
morar no repositório** — publicar a lista dos dados proibidos é publicar os
dados.

Por isso o cruzamento com valores conhecidos é opcional e mora fora do Git:

```
SANITIZATION_BASELINE_PATH=/caminho/fora/do/repo/baseline-privado.json
```

```
repositório público                    arquivo privado local
testes/audita.mjs  ──── opcional ────▶ termos, valores, datas,
(sabe procurar)                        combinações conhecidas
                                       (o segredo da busca)
```

Formato:

```json
{
  "termos":     ["texto que não pode aparecer"],
  "valores":    ["1234.56"],
  "datas":      ["2026-01-31"],
  "combinacoes":["13/48"]
}
```

Sem a variável, a auditoria roda só a parte genérica e diz isso em voz alta, em
vez de fingir cobertura que não tem. **Nunca** versione esse arquivo, nem o
caminho dele, nem um trecho dele num comentário.

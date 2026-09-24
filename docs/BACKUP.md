# Backup e recuperação

O botão **Baixar backup integral** em Ajustes exporta as 24 tabelas com dono.
`ping` não guarda dados pessoais e fica fora. Cada linha mantém o ID original,
para preservar os vínculos. O JSON contém dados financeiros em texto aberto:
guarde em local privado e nunca envie ao repositório público.

## Procedimento

1. Atualize os dados e baixe o JSON. Confira se tem `formato`, `versao`,
   `origem_user_id` e 24 tabelas. Guarde outra cópia fora do computador.
2. Prepare um projeto Supabase com o **mesmo schema**, incluindo a função da
   migração `020_backup_integral.sql`, e crie a conta de destino. Não carregue seed.
3. Acesse o site apontando ao projeto de destino, entre na conta vazia e use
   **Restaurar em conta vazia**. A função do banco troca apenas `user_id`,
   preserva IDs e vínculos e executa todos os inserts em uma transação.
4. Confira as contagens e os saldos após recarregar. Teste a recuperação em
   ambiente isolado antes de usar o arquivo como garantia.

A restauração recusa conta que já tenha qualquer registro nas 24 tabelas.
Se um insert falhar, a transação cancela tudo. O arquivo não restaura contas
de autenticação, senhas, configurações do projeto ou arquivos externos.
Para um backup maior que o limite de requisição da API, é necessária uma
restauração administrativa por dump, fora do navegador.

**Exportar projeção CSV** é apenas para análise no Excel e não reconstitui
as tabelas. A importação de lançamentos CSV também não é restauração.

## Conferência da implantação

As migrações 020 e 021 foram aplicadas no banco principal em 24/09/2026.
Em transação revertida, uma conta fictícia restaurou uma instituição e uma
conta vinculada; nenhum usuário fictício persistiu. Os grants foram conferidos:
`anon` lê apenas `ping`, `authenticated` mantém CRUD, e ambos perderam
`TRUNCATE`. O bootstrap e seu inventário refletem o catálogo após a 021.
Ainda é preciso testar o arquivo exportado pela interface publicada e executar
uma recuperação completa em projeto separado para medir o tempo e o tamanho.

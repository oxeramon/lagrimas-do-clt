import { strict as assert } from 'node:assert';
import { criaBackup, validaBackup, restauraBackup, TABELAS_BACKUP } from '../js/data/backup.js';

const uid = '00000000-0000-4000-8000-000000000001';
const tabelas = Object.fromEntries(TABELAS_BACKUP.map(t => [t, []]));
const cliente = {
  auth: { getUser: async () => ({ data: { user: { id: uid } }, error: null }) },
  from(nome){
    assert(TABELAS_BACKUP.includes(nome));
    return { select(){ return { eq(col, id){
      assert.equal(col, 'user_id'); assert.equal(id, uid);
      return { order(){ return this; }, range: async (de, ate) => ({ data: tabelas[nome].slice(de, ate + 1), error: null }) };
    } }; } };
  },
  async rpc(nome, argumentos){
    assert.equal(nome, 'restaura_backup_integral');
    assert.equal(argumentos.p_backup.origem_user_id, uid);
    return { data: 1, error: null };
  },
};

tabelas.contas = [{ id: 'conta1', user_id: uid }];
const backup = await criaBackup(cliente);
assert.equal(validaBackup(backup), 1);
assert.equal(await restauraBackup(backup, cliente), 1);
assert.throws(() => validaBackup({ ...backup, tabelas: { contas: [] } }), /tabelas esperadas/);
assert.throws(() => validaBackup({ ...backup, tabelas: { ...backup.tabelas, contas: [{ user_id: 'outro' }] } }), /inválidos/);
tabelas.dividas = Array.from({ length: 501 }, (_, i) => ({ id: String(i), user_id: uid }));
assert.equal(validaBackup(await criaBackup(cliente)), 502);
console.log('backup: exportação, validação e chamada de restauração passaram');

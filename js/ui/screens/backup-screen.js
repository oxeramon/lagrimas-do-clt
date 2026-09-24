import { criaBackup, validaBackup, restauraBackup } from "../../data/backup.js";
import { $ } from "../../core/dom.js";

export function ligaTelaBackup(carregar){
  $('backupCompletoBtn').addEventListener('click', async () => {
    const botao = $('backupCompletoBtn'), status = $('backupStatus');
    botao.disabled = true; status.textContent = 'Lendo todos os registros…';
    try {
      const backup = await criaBackup();
      const total = validaBackup(backup);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'lagrimas-do-clt-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      status.textContent = `Backup baixado: ${total} registros. Confira o arquivo antes de depender dele.`;
    } catch (e){ status.textContent = e.message; }
    finally { botao.disabled = false; }
  });

  $('restaurarBackupArquivo').addEventListener('change', async (evento) => {
    const arquivo = evento.target.files?.[0], status = $('backupStatus');
    evento.target.value = '';
    if (!arquivo) return;
    try {
      const backup = JSON.parse(await arquivo.text());
      const total = validaBackup(backup);
      if (!confirm(`Restaurar ${total} registros nesta conta vazia? Os dados do arquivo serão enviados ao seu Supabase.`)) return;
      status.textContent = 'Restaurando…';
      const restaurados = await restauraBackup(backup);
      status.textContent = `${restaurados} registros restaurados. Atualizando a tela…`;
      await carregar();
    } catch (e){ status.textContent = e.message; }
  });
}

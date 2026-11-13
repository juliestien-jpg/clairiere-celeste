// Téléchargement d'un fichier généré dans la page (export de sauvegarde).
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Nom du fichier d'export du contenu brut stocké (sauvegarde illisible, ou jamais perdue). */
export const RAW_EXPORT_FILE_NAME = "clairiere-celeste-sauvegarde-brute.json";

/** Most DPD logins one person can add during sign-up. Shared by the form and the action. */
export const MAX_DPD_LOGINS = 5;

/**
 * Reads the DPD login blocks from a sign-up form. Each block's fields share an id:
 * dpdUsername_<id>, dpdPassword_<id>, dpdLabel_<id>, dpdFds_<id>. Blocks left entirely blank are ignored.
 */
export function readDpdLoginBlocks(formData: FormData): { id: string; username: string; password: string; label: string; fds: string }[] {
  const ids = new Set<string>();
  for (const key of formData.keys()) {
    const match = /^dpd(?:Username|Password|Label|Fds)_(\d+)$/.exec(key);
    if (match) ids.add(match[1]!);
  }
  const blocks: { id: string; username: string; password: string; label: string; fds: string }[] = [];
  for (const id of [...ids].sort((a, b) => Number(a) - Number(b))) {
    const username = String(formData.get(`dpdUsername_${id}`) ?? "").trim();
    const password = String(formData.get(`dpdPassword_${id}`) ?? "");
    const label = String(formData.get(`dpdLabel_${id}`) ?? "").trim();
    const fds = String(formData.get(`dpdFds_${id}`) ?? "").trim();
    if (!username && !password && !label && !fds) continue;
    blocks.push({ id, username, password, label, fds });
  }
  return blocks;
}

import type { Profil, ProfilRepository } from '../../domain/consolidation/Profil.js';

/**
 * Zurückgegeben wird das Profil selbst und keine Kopie: Es ist eingefroren,
 * also kann niemand es durch die Rückgabe verändern. Eine Kopie wäre hier die
 * gefährlichere Wahl — sie wäre wieder beschreibbar.
 */
export class InMemoryProfilRepository implements ProfilRepository {
  private readonly profile = new Map<string, Profil>();

  async list(tenantId: string): Promise<Profil[]> {
    return [...this.profile.values()]
      .filter((eintrag) => eintrag.tenantId === tenantId)
      .sort((links, rechts) => rechts.matches - links.matches || links.name.localeCompare(rechts.name));
  }

  async getById(id: string): Promise<Profil | undefined> {
    return this.profile.get(id);
  }

  async save(profil: Profil): Promise<Profil> {
    this.profile.set(profil.id, profil);
    return profil;
  }

  async delete(id: string): Promise<void> {
    this.profile.delete(id);
  }
}

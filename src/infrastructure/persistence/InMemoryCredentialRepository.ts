import type { Credential, CredentialRepository } from '../../domain/credentials/Credential.js';

export class InMemoryCredentialRepository implements CredentialRepository {
  private readonly credentials = new Map<string, Credential>();

  async list(): Promise<Credential[]> {
    return [...this.credentials.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async getById(id: string): Promise<Credential | undefined> {
    const found = this.credentials.get(id);
    return found ? { ...found } : undefined;
  }

  async findByName(name: string): Promise<Credential | undefined> {
    return [...this.credentials.values()].find((credential) => credential.name === name);
  }

  async save(credential: Credential): Promise<Credential> {
    this.credentials.set(credential.id, { ...credential });
    return { ...credential };
  }

  async delete(id: string): Promise<void> {
    this.credentials.delete(id);
  }
}

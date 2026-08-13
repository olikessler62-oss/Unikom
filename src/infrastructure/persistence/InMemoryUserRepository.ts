import type { User, UserRepository } from '../../domain/users/User.js';

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();

  async list(): Promise<User[]> {
    return [...this.users.values()].map((user) => ({ ...user }));
  }

  async getById(id: string): Promise<User | undefined> {
    const found = this.users.get(id);
    return found ? { ...found } : undefined;
  }

  async findByUsername(username: string): Promise<User | undefined> {
    const wanted = username.toLowerCase();
    const found = [...this.users.values()].find((user) => user.username.toLowerCase() === wanted);

    return found ? { ...found } : undefined;
  }

  async save(user: User): Promise<User> {
    this.users.set(user.id, { ...user });
    return { ...user };
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }

  async count(): Promise<number> {
    return this.users.size;
  }
}

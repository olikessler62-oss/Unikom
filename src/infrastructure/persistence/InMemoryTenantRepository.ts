import type { Tenant, TenantRepository } from '../../domain/tenants/Tenant.js';

export class InMemoryTenantRepository implements TenantRepository {
  private readonly tenants = new Map<string, Tenant>();

  async list(): Promise<Tenant[]> {
    return [...this.tenants.values()]
      .map((tenant) => ({ ...tenant }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getById(id: string): Promise<Tenant | undefined> {
    const found = this.tenants.get(id);
    return found ? { ...found } : undefined;
  }

  async findByName(name: string): Promise<Tenant | undefined> {
    const wanted = name.trim().toLowerCase();
    const found = [...this.tenants.values()].find((tenant) => tenant.name.toLowerCase() === wanted);

    return found ? { ...found } : undefined;
  }

  async save(tenant: Tenant): Promise<Tenant> {
    this.tenants.set(tenant.id, { ...tenant });
    return { ...tenant };
  }

  async delete(id: string): Promise<void> {
    this.tenants.delete(id);
  }

  async count(): Promise<number> {
    return this.tenants.size;
  }
}

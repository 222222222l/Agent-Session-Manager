import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { SessionAdapter } from './model.js';

export class AdapterRegistry {
  private readonly adapters = new Map<string, SessionAdapter>();

  register(adapter: SessionAdapter): void {
    if (adapter.apiVersion !== 1) throw new Error('Unsupported adapter API version');
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(adapter.id) || !adapter.version || !adapter.label ||
        !Array.isArray(adapter.formats) || typeof adapter.matches !== 'function' || typeof adapter.parse !== 'function' ||
        adapter.capabilities?.read !== true || typeof adapter.capabilities.resume !== 'boolean' ||
        (adapter.capabilities.resume && typeof adapter.planResume !== 'function')) {
      throw new Error('Invalid adapter descriptor');
    }
    if (this.adapters.has(adapter.id)) throw new Error(`Duplicate adapter: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
  }
  get(id: string): SessionAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Unknown adapter: ${id}`);
    return adapter;
  }
  list(): SessionAdapter[] { return [...this.adapters.values()]; }
  /** Only load modules explicitly selected by the user; plugins execute trusted local code. */
  async loadPlugin(file: string): Promise<void> {
    const plugin: unknown = (await import(pathToFileURL(resolve(file)).href)).default;
    if (!plugin || typeof plugin !== 'object') throw new Error('Plugin must default-export an Adapter v1 object');
    this.register(plugin as SessionAdapter);
  }
}

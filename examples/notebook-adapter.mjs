// Example of a future product with a completely different storage format.
// Explicitly loaded local plugins are trusted executable code, not sandboxed.
// Input: { format: "notebook-agent/v1", key, opened, workspace?, turns: [{speaker, body}] }
export default {
  apiVersion: 1,
  id: 'example.notebook',
  version: '1.0.0',
  label: 'Example Notebook Agent',
  formats: ['.notebook.json'],
  capabilities: { read: true, resume: false },
  matches: relativePath => relativePath.endsWith('.notebook.json'),
  parse({ bytes }) {
    const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (raw.format !== 'notebook-agent/v1' || !Array.isArray(raw.turns)) throw new Error('Unsupported Notebook version');
    return {
      document: {
        schemaVersion: 1, nativeId: raw.key, createdAt: raw.opened, title: raw.key,
        ...(raw.workspace ? { cwd: raw.workspace } : {}), metadata: { nativeFormat: raw.format },
        messages: raw.turns.map(turn => ({ role: turn.speaker, blocks: [{ type: 'text', text: turn.body }] })),
      },
      diagnostics: [],
    };
  },
};

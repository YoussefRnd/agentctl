import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import * as shared from '@agentctl/shared';
import * as schemas from '@agentctl/shared/schemas';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../docs/${name}`, import.meta.url), 'utf8'));
test('preserves every established shared runtime export and permanent schema identity', () => {
  for (const name of fixture('shared-api-values.json')) expect(shared).toHaveProperty(name);
  expect(shared.sessionRowSchema).toBe(schemas.sessionRowSchema);
  expect(shared.authStateSchema).toBe(schemas.authStateSchema);
  expect(shared.fontContextSchema.parse({ family: 'Mono', size: 14 })).toEqual({
    family: 'Mono',
    size: 14,
  });
  expect(shared.authStateSchema.parse('needs_auth')).toBe('required');
});
test('preserves the complete typed HTTP method/path/status surface', () => {
  const surface = Object.fromEntries(
    Object.entries(shared.apiContract).map(([name, route]) => [
      name,
      { method: route.method, path: route.path, responses: Object.keys(route.responses) },
    ]),
  );
  expect(surface).toEqual(fixture('http-contract-surface.json'));
});

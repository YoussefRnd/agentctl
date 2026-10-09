import os from 'node:os';
import { redactProviderErrorText } from '@agentctl/shared';

/** Server-only redaction adds environment secrets and private home paths to shared rules. */
export function redactAgentErrorText(
  text: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  let clean = text;
  for (const [key, value] of Object.entries(environment)) {
    if (
      value &&
      value.length >= 4 &&
      /secret|token|password|api.?key|credential|authorization/i.test(key)
    )
      clean = clean.split(value).join('[redacted]');
  }
  for (const home of new Set([environment.HOME, environment.USERPROFILE, os.homedir()]))
    if (home && home.length > 1) clean = clean.split(home).join('~');
  return redactProviderErrorText(clean);
}

import { useMcpTools, useMcpServers } from '../api/useMcpServers';
import { McpSettingsPresentation } from './McpSettingsPresentation';

export function McpSettings() {
  const api = useMcpServers();
  const { tools } = useMcpTools();
  return <McpSettingsPresentation api={api} tools={tools} />;
}

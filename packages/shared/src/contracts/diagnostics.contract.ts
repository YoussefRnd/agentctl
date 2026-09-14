import { agentDiagnosticsSnapshotSchema } from '../schemas/diagnostics.js';

export const diagnosticsContract = {
  getTransportDiagnostics: {
    method: 'GET',
    path: '/api/diagnostics/transport',
    responses: {
      200: agentDiagnosticsSnapshotSchema,
    },
    summary: 'Get ACP transport diagnostics snapshot',
  },
} as const;

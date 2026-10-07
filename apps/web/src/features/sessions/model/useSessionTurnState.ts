import { useSessionResponseState } from './SessionContext';

export function useSessionTurnState() {
  return useSessionResponseState().turn;
}

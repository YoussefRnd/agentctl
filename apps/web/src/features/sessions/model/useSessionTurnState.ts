import { useSessionResponseState } from './SessionStreamContext';

export function useSessionTurnState() {
  return useSessionResponseState().turn;
}

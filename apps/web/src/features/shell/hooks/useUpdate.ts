import { useUpdateContext } from '../../../contexts/UpdateContext';

export function useUpdate() {
  return useUpdateContext();
}

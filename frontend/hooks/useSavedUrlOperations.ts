import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelSavedUrlOperation,
  createSavedUrlOperation,
  fetchSavedUrlOperations,
  retryFailedSavedUrlOperation,
  type CreateSavedUrlOperationInput,
  type SavedUrlOperationRun,
} from "../lib/api";

function hasLiveOperation(items?: SavedUrlOperationRun[]) {
  return Boolean(
    items?.some((run) => run.status === "queued" || run.status === "running"),
  );
}

export function useSavedUrlOperationsQuery(limit = 20) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["saved-url-operations", limit],
    queryFn: () => fetchSavedUrlOperations(limit),
    refetchInterval: (query) =>
      hasLiveOperation(query.state.data?.items) ? 2000 : false,
  });

  const createOperation = useMutation({
    mutationFn: (body: CreateSavedUrlOperationInput) =>
      createSavedUrlOperation(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["saved-url-operations"],
      });
      void queryClient.invalidateQueries({ queryKey: ["saved-url-workspace"] });
    },
  });

  const cancelOperation = useMutation({
    mutationFn: (id: string) => cancelSavedUrlOperation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["saved-url-operations"],
      });
      void queryClient.invalidateQueries({ queryKey: ["saved-url-workspace"] });
    },
  });

  const retryFailedOperation = useMutation({
    mutationFn: (id: string) => retryFailedSavedUrlOperation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["saved-url-operations"],
      });
      void queryClient.invalidateQueries({ queryKey: ["saved-url-workspace"] });
    },
  });

  return {
    ...query,
    createOperation,
    cancelOperation,
    retryFailedOperation,
    hasLiveOperation: hasLiveOperation(query.data?.items),
  };
}

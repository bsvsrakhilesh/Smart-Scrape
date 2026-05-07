import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchSavedUrlWorkspace,
  patchUrl,
  type FetchSavedUrlsParams,
} from "../lib/api";

export function useSavedUrlsWorkspaceQuery(
  params: FetchSavedUrlsParams,
  enabled = true,
) {
  return useQuery({
    queryKey: ["saved-url-workspace", params],
    queryFn: ({ signal }) => fetchSavedUrlWorkspace(params, { signal }),
    enabled,
  });
}

export function useSavedUrlWorkspaceMutations() {
  const queryClient = useQueryClient();

  const updateUrl = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: unknown }) =>
      patchUrl(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saved-url-workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["saved-url-reviews"] });
    },
  });

  return { updateUrl };
}

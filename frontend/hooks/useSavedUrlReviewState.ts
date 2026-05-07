import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearSavedUrlReviews,
  fetchSavedUrlReviews,
  markSavedUrlsReviewed,
} from "../lib/api";

export function useSavedUrlReviewState(urlIds: number[]) {
  const queryClient = useQueryClient();
  const stableIds = Array.from(new Set(urlIds.filter(Number.isFinite))).sort(
    (a, b) => a - b,
  );

  const query = useQuery({
    queryKey: ["saved-url-reviews", stableIds],
    queryFn: () => fetchSavedUrlReviews(stableIds),
    enabled: stableIds.length > 0,
  });

  const markReviewed = useMutation({
    mutationFn: (ids: number[]) => markSavedUrlsReviewed(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saved-url-reviews"] });
      void queryClient.invalidateQueries({ queryKey: ["saved-url-workspace"] });
    },
  });

  const clearReviews = useMutation({
    mutationFn: (ids?: number[]) => clearSavedUrlReviews(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saved-url-reviews"] });
      void queryClient.invalidateQueries({ queryKey: ["saved-url-workspace"] });
    },
  });

  return {
    ...query,
    reviewedAtById: query.data?.reviews ?? {},
    markReviewed,
    clearReviews,
  };
}

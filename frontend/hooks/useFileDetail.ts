import { useEffect, useState } from "react";
import type { FileDetail } from "../lib/types";
import { apiRequest } from "../lib/api";

export function useFileDetail(fileId: string) {
  const [file, setFile] = useState<FileDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    apiRequest<FileDetail>("GET", `/api/files/${fileId}`)
      .then((data) => {
        if (!cancelled) setFile(data);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fileId]);

  return { file, loading, error };
}

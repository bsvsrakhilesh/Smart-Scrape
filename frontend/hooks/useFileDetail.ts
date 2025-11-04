import { useState, useEffect } from 'react';
import { FileDetail } from '../types';

export function useFileDetail(fileId: string) {
  const [file, setFile] = useState<FileDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) return;
    setLoading(true);
    setError(null);
    // TODO: replace with your real backend URL and auth headers
    fetch(`/api/files/${fileId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch file detail');
        const data = await res.json();
        setFile(data);
      })
      .catch((e) => {
        console.error(e);
        setError((e as Error).message);
      })
      .finally(() => setLoading(false));
  }, [fileId]);

  return { file, loading, error };
}

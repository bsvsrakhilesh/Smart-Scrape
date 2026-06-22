export function assertSelectedNotebookSourcesAttached(
  selectedSourceIds: string[] | undefined,
  attachedSourceIds: string[],
) {
  if (!Array.isArray(selectedSourceIds) || selectedSourceIds.length === 0) {
    return;
  }

  const attachedIds = new Set(attachedSourceIds);
  const missing = selectedSourceIds.filter((id) => !attachedIds.has(id));
  if (missing.length > 0) {
    const err: any = new Error(
      "One or more selected sources are no longer attached to this notebook. Refresh sources and try again.",
    );
    err.status = 400;
    throw err;
  }
}

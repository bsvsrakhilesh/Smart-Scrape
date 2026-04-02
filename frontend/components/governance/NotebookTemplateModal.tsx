import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  ClipboardList,
  FileText,
  GitBranch,
  Landmark,
  Loader2,
  Plus,
  Scale,
  ShieldAlert,
  X,
} from "lucide-react";

import SmartCard from "../ui/SmartCard";
import {
  notebookClient as api,
  type NotebookTemplateDefinition,
  type NotebookTemplateKey,
} from "../../lib/notebookClient";
import { openNotebookWithTarget } from "../../lib/notebookLaunch";

type NotebookTemplateModalProps = {
  open: boolean;
  onClose: () => void;
  defaultTemplateKey: NotebookTemplateKey;
  documentId: string | null;
  issueId: string | null;
  issueTitle: string | null;
  agencyId: string | null;
  agencyName: string | null;
  relationType: string | null;
};

function iconForTemplate(key: NotebookTemplateKey) {
  switch (key) {
    case "governance_brief":
      return <BookOpen className="h-4 w-4" />;
    case "contradiction_brief":
      return <GitBranch className="h-4 w-4" />;
    case "agency_comparison_summary":
      return <Landmark className="h-4 w-4" />;
    case "issue_landscape_summary":
      return <ClipboardList className="h-4 w-4" />;
    case "case_timeline_note":
      return <Scale className="h-4 w-4" />;
    case "accountability_coordination_gap_note":
      return <ShieldAlert className="h-4 w-4" />;
    default:
      return <FileText className="h-4 w-4" />;
  }
}

export default function NotebookTemplateModal({
  open,
  onClose,
  defaultTemplateKey,
  documentId,
  issueId,
  issueTitle,
  agencyId,
  agencyName,
  relationType,
}: NotebookTemplateModalProps) {
  const qc = useQueryClient();

  const [selectedTemplateKey, setSelectedTemplateKey] =
    useState<NotebookTemplateKey>(defaultTemplateKey);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>("");
  const [titleOverride, setTitleOverride] = useState("");
  const [newNotebookTitle, setNewNotebookTitle] = useState("Governance Briefs");

  const templatesQ = useQuery({
    queryKey: ["nb:templates"],
    queryFn: api.listTemplates,
    enabled: open,
  });

  const notebooksQ = useQuery({
    queryKey: ["nb:list"],
    queryFn: api.listNotebooks,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setSelectedTemplateKey(defaultTemplateKey);
    setTitleOverride("");
  }, [open, defaultTemplateKey]);

  useEffect(() => {
    if (!open) return;
    if (selectedNotebookId) return;
    const first = notebooksQ.data?.[0]?.id;
    if (first) setSelectedNotebookId(first);
  }, [open, selectedNotebookId, notebooksQ.data]);

  const selectedTemplate = useMemo<NotebookTemplateDefinition | null>(() => {
    return (
      templatesQ.data?.find((item) => item.key === selectedTemplateKey) ?? null
    );
  }, [templatesQ.data, selectedTemplateKey]);

  const contextWarnings = useMemo(() => {
    if (!selectedTemplate) return [];
    const warnings: string[] = [];
    if (selectedTemplate.required.document && !documentId) {
      warnings.push("This template requires a document context.");
    }
    if (selectedTemplate.required.issue && !issueId) {
      warnings.push("This template requires an issue context.");
    }
    if (selectedTemplate.required.agency && !agencyId) {
      warnings.push("This template requires an agency context.");
    }
    return warnings;
  }, [selectedTemplate, documentId, issueId, agencyId]);

  const createNotebookM = useMutation({
    mutationFn: async () =>
      api.createNotebook({
        title: newNotebookTitle.trim() || "Governance Briefs",
        description: "Workspace-generated governance notes and briefs.",
      }),
    onSuccess: (notebook) => {
      qc.invalidateQueries({ queryKey: ["nb:list"] });
      setSelectedNotebookId(notebook.id);
    },
  });

  const createTemplateNoteM = useMutation({
    mutationFn: async () =>
      api.createTemplateNote(selectedNotebookId, {
        templateKey: selectedTemplateKey,
        documentId: documentId || undefined,
        issueId: issueId || undefined,
        agencyId: agencyId || undefined,
        relationType:
          relationType && relationType !== "all" ? relationType : undefined,
        titleOverride: titleOverride.trim() || undefined,
      }),
    onSuccess: (data) => {
      openNotebookWithTarget({
        notebookId: selectedNotebookId,
        noteId: data.note.id,
      });
    },
  });

  if (!open) return null;

  const canCreate =
    Boolean(selectedNotebookId) &&
    Boolean(selectedTemplate) &&
    contextWarnings.length === 0 &&
    !createTemplateNoteM.isPending;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(248,250,252,0.92),rgba(240,249,255,0.92))] shadow-[0_30px_90px_rgba(15,23,42,0.24)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-6 py-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-sm">
              <BookOpen className="h-3.5 w-3.5" />
              Notebook Templates
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
              Create a reusable governance note
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Turn the current governance context into a durable notebook
              artifact with structured sections and preserved evidence
              provenance.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-6 px-6 py-6 xl:grid-cols-[minmax(0,1.3fr),380px]">
          <div className="space-y-6">
            <SmartCard
              className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
              tabIndex={-1}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Current governance context
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
                {documentId ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                    Document {documentId}
                  </span>
                ) : null}
                {issueTitle ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700">
                    Issue {issueTitle}
                  </span>
                ) : null}
                {agencyName ? (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                    Agency {agencyName}
                  </span>
                ) : null}
                {relationType && relationType !== "all" ? (
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-violet-700">
                    Relation {relationType}
                  </span>
                ) : null}
              </div>
            </SmartCard>

            <div className="grid gap-4 md:grid-cols-2">
              {(templatesQ.data ?? []).map((template) => {
                const active = template.key === selectedTemplateKey;
                return (
                  <button
                    key={template.key}
                    type="button"
                    onClick={() => setSelectedTemplateKey(template.key)}
                    className={[
                      "rounded-[24px] border p-5 text-left transition",
                      active
                        ? "border-slate-900 bg-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
                        : "border-slate-200 bg-white/85 text-slate-900 shadow-[0_14px_30px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="inline-flex items-center gap-2 text-sm font-semibold">
                        <span
                          className={[
                            "rounded-xl border p-2",
                            active
                              ? "border-white/20 bg-white/10 text-white"
                              : "border-slate-200 bg-slate-50 text-slate-700",
                          ].join(" ")}
                        >
                          {iconForTemplate(template.key)}
                        </span>
                        {template.label}
                      </div>
                      <span
                        className={[
                          "rounded-full px-2 py-1 text-[11px] font-medium",
                          active
                            ? "border border-white/20 bg-white/10 text-white"
                            : "border border-slate-200 bg-slate-50 text-slate-600",
                        ].join(" ")}
                      >
                        {template.badge}
                      </span>
                    </div>

                    <p
                      className={[
                        "mt-3 text-sm leading-6",
                        active ? "text-slate-200" : "text-slate-600",
                      ].join(" ")}
                    >
                      {template.description}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                      {template.sections.slice(0, 4).map((section) => (
                        <span
                          key={section}
                          className={[
                            "rounded-full px-2.5 py-1",
                            active
                              ? "border border-white/15 bg-white/10 text-slate-100"
                              : "border border-slate-200 bg-slate-50 text-slate-600",
                          ].join(" ")}
                        >
                          {section}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <SmartCard
              className="border-white/70 bg-white/90 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
              tabIndex={-1}
            >
              <div className="text-sm font-semibold text-slate-900">
                Output destination
              </div>

              <label className="mt-4 block">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Notebook
                </div>
                <select
                  value={selectedNotebookId}
                  onChange={(e) => setSelectedNotebookId(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                >
                  <option value="">Select notebook</option>
                  {(notebooksQ.data ?? []).map((notebook) => (
                    <option key={notebook.id} value={notebook.id}>
                      {notebook.title}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Quick create
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={newNotebookTitle}
                    onChange={(e) => setNewNotebookTitle(e.target.value)}
                    placeholder="New notebook title"
                    className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => createNotebookM.mutate()}
                    disabled={createNotebookM.isPending}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    {createNotebookM.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Create
                  </button>
                </div>
              </div>

              <label className="mt-4 block">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Note title override
                </div>
                <input
                  value={titleOverride}
                  onChange={(e) => setTitleOverride(e.target.value)}
                  placeholder={
                    selectedTemplate?.defaultTitlePrefix ||
                    "Optional custom note title"
                  }
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                />
              </label>

              {selectedTemplate ? (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="text-sm font-semibold text-slate-900">
                    {selectedTemplate.label}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    {selectedTemplate.description}
                  </div>

                  <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Sections
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                    {selectedTemplate.sections.map((section) => (
                      <span
                        key={section}
                        className="rounded-full border border-slate-200 bg-white px-2.5 py-1"
                      >
                        {section}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {contextWarnings.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-800">
                  {contextWarnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}

              {createTemplateNoteM.isError ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-700">
                  {(createTemplateNoteM.error as Error)?.message ||
                    "Failed to create notebook note."}
                </div>
              ) : null}

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => createTemplateNoteM.mutate()}
                  disabled={!canCreate}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:-translate-y-0.5 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {createTemplateNoteM.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    <>
                      Create note in notebook
                      <BookOpen className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </SmartCard>
          </div>
        </div>
      </div>
    </div>
  );
}

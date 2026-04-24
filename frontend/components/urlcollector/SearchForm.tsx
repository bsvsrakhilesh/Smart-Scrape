import React, { useEffect, useRef, useState } from "react";
import SearchIcon from "../icons/SearchIcon";
import { PlusButton } from "../ui/PlusButton";
import FormField from "../forms/FormField";
import { Sparkles } from "lucide-react";

interface SearchFormProps {
  onSearch: (website: string, keywords: string) => void;
  isLoading: boolean;
  initialWebsite?: string;
  initialKeywords?: string;
  onWebsiteChange?: (v: string) => void;
  onKeywordsChange?: (v: string) => void;
  searchPreview?: string;
  currentScope?: {
    yearFrom: string;
    yearTo: string;
    jurisdiction: string;
    region: string;
    format: "any" | "pdfOnly" | "excludePdf";
  };
  onAiAssist?: (draft: {
    website: string;
    keywords: string;
    scope: {
      yearFrom: string;
      yearTo: string;
      jurisdiction: string;
      region: string;
      format: "any" | "pdfOnly" | "excludePdf";
    };
  }) => Promise<void> | void;
  aiAssistLoading?: boolean;
  aiAssistRationale?: string;
}

const SearchForm: React.FC<SearchFormProps> = ({
  onSearch,
  isLoading,
  initialWebsite = "",
  initialKeywords = "",
  onWebsiteChange,
  onKeywordsChange,
  searchPreview,
  currentScope,
  onAiAssist,
  aiAssistLoading = false,
  aiAssistRationale,
}) => {
  const [website, setWebsite] = useState(initialWebsite);
  const [keywords, setKeywords] = useState(initialKeywords);

  const siteRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => setWebsite(initialWebsite), [initialWebsite]);
  useEffect(() => setKeywords(initialKeywords), [initialKeywords]);

  // Accept full URL or bare domain; return a clean domain for site: filter
  const normalizeWebsite = (raw: string) => {
    const v = raw.trim();
    if (!v) return "";
    try {
      // Add scheme if missing so URL() can parse
      const maybeUrl = v.match(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//)
        ? v
        : `https://${v}`;
      const u = new URL(maybeUrl);
      // use hostname only (drop port/path)
      return u.hostname.replace(/^\s*www\./i, "").trim();
    } catch {
      // Fallback: keep a permissive domain-ish token
      return v.replace(/^\s*www\./i, "").split(/[\/\s?#]/)[0];
    }
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const site = normalizeWebsite(website);
    onSearch(site, keywords.trim());
  };

  const handleWebsite = (v: string) => {
    setWebsite(v);
    onWebsiteChange?.(v);
  };
  const handleKeywords = (v: string) => {
    setKeywords(v);
    onKeywordsChange?.(v);
  };

  const runAiAssist = async () => {
    if (!onAiAssist) return;

    await onAiAssist({
      website,
      keywords,
      scope: currentScope ?? {
        yearFrom: "",
        yearTo: "",
        jurisdiction: "",
        region: "",
        format: "any",
      },
    });
  };

  return (
    <form onSubmit={submit} noValidate className="w-full">
      {/* Website input */}
      <FormField
        label="Website"
        htmlFor="sf-website"
        helpText="Enter a site to scope the search. Leave empty to search the whole web."
      >
        <div className="input-gradient-shell bg-landing-gradient rounded-full p-[1.5px]">
          <input
            id="sf-website"
            ref={siteRef}
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="example.com or https://example.com"
            className="md3-input input-pill w-full"
            value={website}
            onChange={(e) => handleWebsite(e.target.value)}
          />
        </div>
      </FormField>

      {/* Keywords input */}
      <FormField
        label="Keywords"
        htmlFor="sf-keywords"
        helpText="Use commas for AND, pipes | for OR groups — e.g. governance, enforcement | smog tower, Delhi"
      >
        <div className="input-gradient-shell bg-landing-gradient rounded-full p-[1.5px]">
          <input
            id="sf-keywords"
            ref={keyRef}
            type="text"
            autoComplete="off"
            placeholder="e.g. air quality, governance | smog tower, Delhi"
            className="md3-input input-pill w-full"
            value={keywords}
            onChange={(e) => handleKeywords(e.target.value)}
          />
        </div>
      </FormField>

      {/* Actions */}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <PlusButton
            type="submit"
            size="lg"
            variant="solid"
            loading={isLoading}
            className="w-full md:w-auto rounded-full min-h-[44px] px-5"
            aria-label="Search the web"
            title="Search the web"
          >
            <SearchIcon className="h-4 w-4" />
            Search
          </PlusButton>

          <PlusButton
            type="button"
            size="lg"
            variant="outline"
            loading={aiAssistLoading}
            disabled={!keywords.trim() || isLoading}
            className="w-full md:w-auto rounded-full min-h-[44px] px-5"
            aria-label="Use AI to improve the search plan"
            title="Use AI to improve the search plan"
            onClick={runAiAssist}
          >
            <Sparkles className="h-4 w-4" />
            AI assist
          </PlusButton>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          AI assist sharpens domains, keywords, date hints, and PDF/news bias
          before you search.
        </p>
      </div>

      {aiAssistRationale && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          <span className="font-medium">AI assist</span>
          <span className="ml-2">{aiAssistRationale}</span>
        </div>
      )}

      {/* Built query display — shown after first search so researchers can verify what ran */}
      {searchPreview && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800/50">
          <span className="mt-0.5 shrink-0 font-medium text-gray-500 dark:text-gray-400">
            Search plan
          </span>
          <code className="min-w-0 break-all font-mono text-gray-700 dark:text-gray-300 leading-relaxed">
            {searchPreview}
          </code>
          <button
            type="button"
            title="Copy search plan to clipboard"
            className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(searchPreview);
              } catch {
                /* clipboard unavailable */
              }
            }}
          >
            Copy
          </button>
        </div>
      )}
    </form>
  );
};

export default SearchForm;

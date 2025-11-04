import React, { useEffect, useRef, useState } from 'react';
import SearchIcon from '../icons/SearchIcon';
import { PlusButton } from '../ui/PlusButton';
import FormField from '../forms/FormField';

interface SearchFormProps {
  onSearch: (website: string, keywords: string) => void;
  isLoading: boolean;
  initialWebsite?: string;
  initialKeywords?: string;
  onWebsiteChange?: (v: string) => void;
  onKeywordsChange?: (v: string) => void;
}

const SearchForm: React.FC<SearchFormProps> = ({
  onSearch,
  isLoading,
  initialWebsite = '',
  initialKeywords = '',
  onWebsiteChange,
  onKeywordsChange,
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
    if (!v) return '';
    try {
      // Add scheme if missing so URL() can parse
      const maybeUrl = v.match(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//) ? v : `https://${v}`;
      const u = new URL(maybeUrl);
      // use hostname only (drop port/path)
      return u.hostname.replace(/^\s*www\./i, '').trim();
    } catch {
      // Fallback: keep a permissive domain-ish token
      return v.replace(/^\s*www\./i, '').split(/[\/\s?#]/)[0];
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

  return (
    <form onSubmit={submit} noValidate className="w-full">
      
        {/* Website input */}
          <FormField
            label="Website"
            htmlFor="website"
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
            aria-describedby="sf-website-hint"
          />
          </div>
          </FormField>

        {/* Keywords input */}
        <FormField
          label="Keywords"
          htmlFor="keywords"
          helpText="Comma-separated terms, e.g. smog tower, pm10 pm25, Connaught Place"
        >
          <div className="input-gradient-shell bg-landing-gradient rounded-full p-[1.5px]">
          <input
            id="sf-keywords"
            ref={keyRef}
            type="text"
            autoComplete="off"
            placeholder="What to search for…"
            className="md3-input input-pill w-full"
            value={keywords}
            onChange={(e) => handleKeywords(e.target.value)}
          />
        </div>
        </FormField>

        {/* Submit */}
        <div className="sm:self-end mt-2">
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
        </div>
      
    </form>
  );
};

export default SearchForm;

ALTER TABLE "Url"
ADD COLUMN "normalizedDomain" TEXT;

UPDATE "Url"
SET "normalizedDomain" = NULLIF(
  lower(
    regexp_replace(
      regexp_replace(
        split_part(
          split_part(
            split_part(
              regexp_replace(COALESCE("canonical_url", "url"), '^[a-zA-Z]+://', ''),
              '/',
              1
            ),
            '?',
            1
          ),
          '#',
          1
        ),
        ':\d+$',
        ''
      ),
      '^www\.',
      ''
    )
  ),
  ''
);

CREATE INDEX "Url_normalizedDomain_idx" ON "Url"("normalizedDomain");
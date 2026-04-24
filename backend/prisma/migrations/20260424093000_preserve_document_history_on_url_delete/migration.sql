ALTER TABLE "public"."Document"
DROP CONSTRAINT "Document_urlId_fkey";

ALTER TABLE "public"."Document"
ADD CONSTRAINT "Document_urlId_fkey"
FOREIGN KEY ("urlId") REFERENCES "public"."Url"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

# SmartScrape - User Manual

*Archive analysis tool for environmental governance*

## Contents

1. [What SmartScrape does](#1-what-smartscrape-does)
2. [Key concepts](#2-key-concepts)
3. [Quick start](#3-quick-start)
   - [Worked example case brief](#34-worked-example-case-brief)
4. [Landing page](#4-landing-page)
5. [URL Collector](#5-url-collector)
6. [Saved URLs](#6-saved-urls)
7. [File Manager](#7-file-manager)
8. [Notebook](#8-notebook)
9. [Governance Workspace](#9-governance-workspace)
10. [Evidence and AI safety](#10-evidence-and-ai-safety)
11. [Ten-minute validation exercise](#11-ten-minute-validation-exercise)
12. [Operating and troubleshooting a local installation](#12-operating-and-troubleshooting-a-local-installation)

## 1. What SmartScrape does

SmartScrape is an evidence workspace for discovering public sources with Google Custom Search, organising saved URLs and files, preserving durable text or PDF captures, tracing governance relationships, and analysing selected evidence with OpenAI-backed Notebook and Governance workflows.

The normal workflow is:

> Define a research purpose → discover and save relevant sources → preserve important evidence → analyse it with cited Notebook or Governance workflows → verify the cited evidence.

SmartScrape is intended for researchers, environmental-governance organisations, public agencies, analysts, and other teams that need a traceable archive of documents, organisations, decisions, and interventions.

SmartScrape links generated answers to retrieved source passages to support verification. Users must inspect the cited evidence before relying on an answer.

### 1.1 The five main work surfaces

| Page | Best for | Typical actions |
| --- | --- | --- |
| URL Collector | Discovering public sources | Define a purpose, search, review coverage, and save results to the purpose. |
| Saved URLs | Curating a URL registry | Filter, tag, favourite, group, capture, and perform bulk actions. |
| File Manager | Preserving evidence | Upload, organise, search, tag, preview, and restore files. |
| Notebook | Analysing selected sources | Attach sources, control retrieval scope, ask questions, inspect citations, and write notes. |
| Governance Workspace | Investigating governance questions | Retrieve official evidence, trace agencies and timelines, inspect contradictions, and generate cited answers. |

## 2. Key concepts

These objects serve different purposes and should not be treated as interchangeable.

| Term | Meaning |
| --- | --- |
| Research Purpose | The discovery brief: a question, jurisdiction, desired output, preferred sources, and relevant actors. Searches and saved results can be tied to it. |
| Saved URL | A registry record for a web address and its metadata. Saving a URL does not preserve the page contents. |
| Collection | A reusable grouping for Saved URL records. It is independent of the Research Purpose and separate from File Manager folders. |
| Folder | A File Manager location used to organise uploaded or captured files. File Manager may present top-level folders under a Collections heading, but these folders are not Saved URL collections. |
| Capture | A preserved Text or PDF copy created from a saved URL. It becomes a file in File Manager. |
| Source | A saved URL or file attached to a Notebook. A source must finish processing before it can support grounded retrieval. |
| Notebook | A task-specific analysis space containing selected sources, chat, and durable notes. |

### 2.1 Text capture or PDF capture?

- Use **Text** when searchable page content is the priority. It is usually easier to index, quote, and analyse.
- Use **PDF** when page layout, pagination, signatures, stamps, tables, or the original visual form matter.
- For high-value records, consider preserving both. A capture is a point-in-time copy; it does not automatically update when the website changes.
- Capturing is different from saving a URL. Save first in URL Collector, then capture from Saved URLs or the document-discovery workflow.

## 3. Quick start

Use the path that matches how you access SmartScrape.

### 3.1 Use an existing deployment

1. Open the SmartScrape URL supplied by your administrator in a modern desktop browser.
2. Select **Open App**, then open **URL Collector**.
3. Create or select a **Research Purpose**. Record the question, jurisdiction, desired output, preferred sources, and relevant agencies.
4. Run a search, review coverage, and save relevant results to the active purpose.
5. Open **Saved URLs** to organise and capture important sources.
6. Attach ready URLs or files to a **Notebook**, ask a focused question, and open the returned citations.
7. Use **Governance Workspace** for agency responsibility, timelines, compliance review, or contradiction analysis.

If a feature is unavailable, ask the administrator which integrations have been enabled. Do not enter API keys into the application UI unless your organisation explicitly instructs you to do so.

### 3.2 Run SmartScrape locally with Docker

The supported local installation uses Docker Compose. You need Docker Desktop or Docker Engine with Docker Compose, Git unless you download a ZIP, and a terminal. A standard Docker installation does not require local Node.js, Python, PostgreSQL, or Redis installations.

Only ports `3000`, `4000`, and `7071` are published by the development stack. PostgreSQL and Redis are internal services and do not require host ports `5432` or `6379`.

#### Step 1 — Get the source

```powershell
git clone https://github.com/bsvsrakhilesh/Smart-Scrape.git
cd Smart-Scrape
docker --version
docker compose version
```

If you downloaded a ZIP, extract it and open a terminal in the extracted `Smart-Scrape` directory.

#### Step 2 — Create local environment files

Windows PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
Copy-Item ai-tagger\.env.example ai-tagger\.env
```

macOS or Linux:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp ai-tagger/.env.example ai-tagger/.env
```

These files can contain secrets. Never commit them to version control or paste their contents into an issue, screenshot, or shared log.

#### Step 3 — Configure the development stack

Choose a PostgreSQL password. Put it in the root `.env`:

```env
POSTGRES_PASSWORD=replace-with-your-password
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Set the corresponding values in `backend/.env`. The password in `DATABASE_URL` must exactly match `POSTGRES_PASSWORD`, and the Docker database host must be `db`.

```env
NODE_ENV=development
PORT=4000
POSTGRES_PASSWORD=replace-with-your-password
DATABASE_URL=postgresql://postgres:replace-with-your-password@db:5432/SmartScrape?schema=public
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
TAGGER_PY_URL=http://ai-tagger:7071
GOOGLE_CSE_KEY=your-google-api-key
GOOGLE_CSE_CX=your-programmable-search-engine-id
OPENAI_ENABLED=true
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5.2
GOVERNANCE_ANSWER_MODEL=gpt-5.5
GOVERNANCE_ASSIST_MODEL=gpt-5.4-mini
GOVERNANCE_DEEP_REVIEW_MODEL=gpt-5.5-pro
TAGS_USE_LLM=true
DEV_AUTH_ENABLED=false
```

The checked-in examples remain the source of truth for all available variables. `frontend/.env` may remain blank for Docker. The Compose file supplies internal Redis, storage, Chromium, and queue settings.

#### Step 4 — Start and verify

```powershell
docker compose -f docker-compose.dev.yml up --build
```

The first build may take several minutes or longer depending on network speed and Docker cache state. Keep the terminal open. When startup completes:

1. Open <http://localhost:3000>.
2. Confirm <http://localhost:4000/health> responds.
3. Confirm <http://localhost:7071/health> responds.
4. Run a small URL Collector search to verify Google credentials.
5. Use **AI assist**, or attach a source to Notebook and wait for **Ready**, to verify backend OpenAI configuration.

### 3.3 Capability matrix

| Configuration | Available | Unavailable or reduced |
| --- | --- | --- |
| No external API keys | File upload and organisation, saved-URL management, deterministic AI-tagger processing, and other non-LLM archive operations | Google web discovery, embeddings, grounded Notebook chat, Governance answers, and LLM assistance |
| Google CSE only | Google-backed URL discovery plus non-LLM archive operations | Backend embeddings, grounded Notebook chat, Governance answers, and LLM assistance |
| Backend OpenAI only | Embeddings, Notebook and Governance workflows, and backend LLM assistance for sources already available | Google-backed URL discovery |
| Google CSE + backend OpenAI | Intended discovery and analysis workflow | AI-tagger LLM enhancement remains off unless configured separately |
| AI-tagger OpenAI key | Optional LLM-assisted tag reranking and structured extraction | This key does not by itself enable Notebook, Governance, or Google search |
| Institutional Capture Node (ICN) | Prototype demonstration of future authenticated capture | Not a supported production feature and not required for the core workflow |

### 3.4 Worked example case brief

The page chapters below include a continuing real-world example. Follow the sections headed **Continue the worked example** to carry one investigation from discovery to a cited governance review. The existing page instructions remain the general reference for controls and troubleshooting.

**Scenario:** An environmental-governance analyst needs to determine how Commission for Air Quality Management (CAQM) directions translated into construction-and-demolition (C&D) dust enforcement and reporting in Delhi between January 2023 and December 2025.

Use these values throughout the walkthrough:

| Item | Worked-example value |
| --- | --- |
| Research Purpose | `Delhi C&D dust enforcement, 2023–2025` |
| Research question | `How did CAQM directions translate into Delhi construction-and-demolition dust enforcement and reporting from January 2023 to December 2025?` |
| Jurisdiction or area | `Delhi NCR, India` |
| Desired output | `Cited enforcement timeline and agency-responsibility brief` |
| Official sources or domains | `caqm.nic.in, dpcc.delhigovt.nic.in, cpcb.nic.in` |
| Agencies, actors, or institutions | `CAQM, DPCC, CPCB, MCD, GNCTD` |
| Saved URL collection | `Delhi C&D enforcement` |
| File Manager folder | `Delhi C&D enforcement` |
| File Manager subfolders | `Official directions` and `Implementation reports` |
| Notebook | `Delhi C&D enforcement review` |
| Core tags | `construction-dust`, `Delhi`, `enforcement`, plus the issuing agency name |

The target evidence set contains at least three official-source records with different roles:

1. A CAQM direction or order defining C&D dust-control obligations, such as Direction No. 79 dated 13 February 2024.
2. A CAQM, DPCC, CPCB, MCD, or GNCTD implementation or enforcement record describing monitoring, closure, environmental compensation, prosecution, portal registration, or another follow-up action.
3. A DPCC or CPCB report providing implementation, facility, inspection, or C&D waste-management evidence, such as the DPCC annual report for 2023–2024.

Official websites, document addresses, and Google result ordering can change. Treat the named documents as search targets, not guaranteed search positions. When an exact item is unavailable, select an equivalent official document with the same evidence role and record the substitution in Notes. Do not substitute an unattributed summary for a primary official source.

To complete the full walkthrough, the deployment needs Google Custom Search for discovery and backend OpenAI support for source indexing, Notebook chat, and Governance answers. Without Google credentials, add known official URLs through Saved URLs or upload authorised copies. Without OpenAI support, complete collection, capture, organisation, and evidence inspection, then stop before the generated-analysis steps.

The walkthrough is complete when the purpose contains the selected official URLs, durable evidence is visible and inspected in File Manager, the Notebook contains a citation-checked table and recorded gaps, and Governance Workspace contains a retrieved investigation whose material claims have been checked against their citations. These are workflow checkpoints, not predetermined findings.

## 4. Landing page

![SmartScrape landing page showing the main workspace links](assets/manual/landing-page.png)

*Figure 1. Landing page and work-surface directory.*

The landing page introduces the research flow and links to all five work surfaces.

- **Open App** enters the workspace at URL Collector.
- **Open Notebook** opens the standalone Notebook workspace.
- The page cards describe and open each work surface.

For a new investigation, choose **Open App**. Choose **Open Notebook** when the required sources are already in the archive.

### 4.1 Step-by-step navigation

1. Open the SmartScrape site in a modern desktop browser.
2. Select **Pages** in the header to move to the work-surface overview, or scroll down to review it manually.
3. Select **Open App** to enter the main application. SmartScrape opens URL Collector, which is the normal starting point for a new investigation.
4. Use the application sidebar to move among **URL Collector**, **Saved URLs**, **File Manager**, and **Governance Workspace**.
5. Select **Open Notebook** on the landing page when you want to bypass discovery and work directly with sources already stored in SmartScrape.
6. Select the SmartScrape logo or the home link when available to return to the landing page.

Opening a page does not create, save, capture, or analyse evidence. Those actions occur inside the relevant work surface and are described below.

### 4.2 Continue the worked example: begin the investigation

1. Read the case brief in [Section 3.4](#34-worked-example-case-brief) and confirm that the deployment has the capabilities needed for the stages you intend to complete.
2. From the landing page, select **Open App**. Do not select **Open Notebook** for this first pass because the example begins with source discovery.
3. Confirm that URL Collector opens. Use the application sidebar for every later page transition so the example remains one continuous workspace flow.

**Checkpoint:** You are on URL Collector with the case question, date range, named artifacts, and official-source requirement available from the case brief. No evidence should have been created merely by opening the page.

## 5. URL Collector

![URL Collector showing an active Research Purpose and search controls](assets/manual/url-collector-purpose.png)

*Figure 2. URL Collector with an active Research Purpose.*

URL Collector ties searches and saved links to a Research Purpose so the research question, jurisdiction, intended output, actors, and preferred sources remain visible during discovery.

### 5.1 Main controls

- **Research Purpose:** select an existing purpose or create one before saving results.
- **Purpose details:** title, question, jurisdiction, desired output, preferred domains, and relevant agencies.
- **Generate search lanes:** create focused query approaches from the active purpose when OpenAI is enabled.
- **Search:** website or domain, keywords, AI assist, year range, jurisdiction, area or region, and format.
- **Coverage check:** review whether suggested official sources and evidence roles appear in the results.
- **Results:** filter, deduplicate, sort by original order, title, domain, or year; select; export CSV; save to the purpose; or copy a URL.

![URL Collector results showing Save to purpose actions](assets/manual/url-collector-results.png)

*Figure 3. Collector results and current save actions.*

### 5.2 Step-by-step navigation: discover and save sources

1. Open **URL Collector** from the application sidebar.
2. In the Research Purpose area, select an existing purpose or create a new one. When creating one, enter a useful title and research question, then add jurisdiction, desired output, preferred domains, and relevant agencies when known.
3. Keep the intended purpose selected. Results cannot be saved to a purpose until one is active.
4. Optionally select **Generate search lanes** to create focused searches from the purpose. Review the generated lanes before using them.
5. In the search form, enter a website only when the search must be restricted to that domain; otherwise leave it blank.
6. Enter the topic in **Keywords**. Commas group required concepts, while pipes (`|`) represent alternatives.
7. Optionally select **AI assist** to refine domains, keywords, date hints, and PDF or news bias. Review the proposed changes before searching.
8. Set **Year from**, **Year to**, jurisdiction, area or region, and document format only when those limits are relevant.
9. Select **Search** and wait for the result list to load. If a built-query preview appears, inspect or copy it to confirm the query that was sent.
10. Review the **Coverage check**. Missing official-source families or evidence roles are prompts to broaden the search; they do not prove that evidence is absent.
11. Filter the loaded results by domain or saved state, hide duplicates if needed, and sort the current result set.
12. Open promising results in their source sites and verify relevance before saving them.
13. Save one result with **Save to purpose**, or select multiple result checkboxes and use the toolbar’s **Save to purpose** action.
14. For a URL already present in the registry, use **Add to purpose** to associate it with the active purpose. Use **Open in Saved URLs** when it is already associated.
15. Open **Saved URLs** from the sidebar to add notes and tags, organise records, or create durable Text/PDF captures.

Ordinary result rows do not directly create Text or PDF captures. Saving a result creates a URL registry record, not a durable copy of the page.

### 5.2.1 Continue the worked example: discover and save official sources

1. Create a Research Purpose using the values in Section 3.4:
   - **Purpose title:** `Delhi C&D dust enforcement, 2023–2025`
   - **Jurisdiction or area:** `Delhi NCR, India`
   - **Research question:** `How did CAQM directions translate into Delhi construction-and-demolition dust enforcement and reporting from January 2023 to December 2025?`
   - **Desired output:** `Cited enforcement timeline and agency-responsibility brief`
   - **Official sources or domains:** `caqm.nic.in, dpcc.delhigovt.nic.in, cpcb.nic.in`
   - **Agencies, actors, or institutions:** `CAQM, DPCC, CPCB, MCD, GNCTD`
2. Keep that purpose selected. If **Generate search lanes** is available, generate lanes and retain only lanes that seek an official direction, implementation or enforcement evidence, or a reporting document.
3. Run these focused searches separately rather than forcing every concept into one query:
   - Website `caqm.nic.in`; Keywords `construction demolition, dust, Direction 79`; **Year from** `2023`; **Year to** `2025`; **Jurisdiction** `India`; **Area / region** `Delhi NCR`; format `PDF` when available.
   - Website `caqm.nic.in`; Keywords `construction demolition, enforcement | closure | environmental compensation`; use the same years and area.
   - Website `dpcc.delhigovt.nic.in`; Keywords `construction demolition, annual report | dust mitigation`; use the same years and area.
   - If an evidence role remains missing, search `cpcb.nic.in` or the relevant Delhi government domain for `construction demolition, Delhi, action taken | implementation report`.
4. Inspect the built query and Coverage check after each search. A missing source family is a reason to run another focused search, not evidence that the agency took no action.
5. Open candidate results on their official sites. Confirm the issuing organisation, document title, date, geographic scope, and whether the item is a direction, implementation record, or report.
6. Save at least one verified source for each of the three target evidence roles to the active purpose. Prefer the official document page or PDF over a search-result copy, repost, or news summary.
7. If a named target is absent, save an equivalent official record and note what it replaces when you reach Saved URLs.
8. Open **Saved URLs** from the sidebar.

**Expected state:** The purpose shows at least three official-source URL records covering rule or direction, implementation or enforcement, and reporting. Search counts and titles may differ from this manual.

**Checkpoint:** Every saved result has been opened and checked on its source site. None has yet been treated as a durable capture merely because its URL was saved. If discovery is unavailable, use the existing capability guidance and continue by adding known official URLs in Saved URLs.

### 5.3 Common issues on this page

- **Search fails immediately:** verify `GOOGLE_CSE_KEY` and `GOOGLE_CSE_CX` in `backend/.env`, confirm that the Custom Search API and search engine are active, then recreate the backend container after changing configuration.
- **Search returns no or weak results:** remove unnecessary domain, year, jurisdiction, region, or format restrictions; inspect the built query; and try a narrower keyword set or a generated search lane.
- **AI assist or Generate search lanes fails:** confirm `OPENAI_ENABLED=true`, a valid backend `OPENAI_API_KEY`, and access to the configured model. Ordinary Google search can still be used without AI assistance.
- **Save to purpose is disabled:** create or select a Research Purpose. Search results are not assigned to a purpose automatically.
- **A URL shows Add to purpose or Open in Saved URLs instead of Save to purpose:** the URL already exists in the registry. Add it to the active purpose if needed, or open its existing record.
- **A selected result is skipped during saving:** the URL may be malformed, duplicated in the selection, or already registered. Review the result-level status instead of repeatedly creating duplicates.
- **Coverage remains incomplete:** coverage is calculated from the loaded results. Search the missing official-source family or evidence role directly; a low score is not proof that no such source exists.
- **More results stop loading:** Google Custom Search pagination and account quota limit the available result set. Narrow the query or continue later after resolving quota limits.
- **Network error or Failed to fetch:** confirm that the backend is reachable at the configured API address and inspect backend logs for the failed request.

## 6. Saved URLs

![Saved URLs purpose intake and review command center](assets/manual/saved-urls-overview.png)

*Figure 4. Saved URLs purpose intake and review controls.*

Saved URLs is the source registry used after discovery. It supports purpose-scoped review, collections, filters, metadata, tags, captures, and batch operations.

### 6.1 Main controls

- Purpose intake limits the registry to one Research Purpose or shows all saved URLs.
- Review queues include never captured, stale capture, AI failed, metadata missing, and updated since review.
- Collections are reusable organisational groups independent of Research Purposes.
- Search and advanced filters cover domain, tags, dates, favourites, capture status, AI status, metadata, and visibility.
- Registry and card modes support dense review or visual browsing.
- Quick add saves a URL pasted directly into the registry.

### 6.2 Step-by-step navigation: review and capture a source

1. Open **Saved URLs** from the application sidebar.
2. Choose a Research Purpose in the purpose-intake controls, or choose **All saved URLs** to work across the registry.
3. If the task is operational cleanup, select a review queue such as **Never captured**, **Stale capture**, **AI failed**, **Metadata missing**, or **Updated since review**. Otherwise, use search and advanced filters directly.
4. Apply domain, tag, date, favourite, capture-state, AI-state, metadata, visibility, year, or sort controls as needed.
5. Select **Save current search** when this combination of filters will be reused. Select **Mark visible reviewed** only after checking the visible records.
6. Switch between **Registry** and **Cards** when both views are available. Registry is suited to dense comparison; Cards exposes per-record actions more visibly.
7. To add a known link without running discovery again, paste it into **Quick add URL** and submit it. Duplicate URLs remain a single registry record.
8. Open a record’s **Details** view to inspect metadata and provenance, edit notes or tags, refresh metadata, or send the source to Notebook.
9. To preserve the page, choose its Text capture or PDF capture action. Text prioritises searchable content; PDF prioritises visual form.
10. In the destination picker, select the File Manager folder and confirm the capture. Wait for success before assuming that a durable copy exists.
11. Reopen the record or refresh the registry to confirm the capture status and stored-file link.
12. For several records, select their checkboxes and use only the bulk actions offered by the toolbar. Available actions depend on selection and current view and may include export, collection assignment, favourite, tagging, capture, or deletion.
13. Use **Capture missing text** or **Capture missing PDF** from snapshot-health controls only when the currently loaded missing records should all be captured using the chosen method.
14. Open **File Manager** to inspect the resulting files, or add ready saved URLs directly to a Notebook when a separate capture is not required.

### 6.2.1 Continue the worked example: curate and preserve the source set

1. Select the Research Purpose `Delhi C&D dust enforcement, 2023–2025` so unrelated registry records are excluded from this review.
2. Create the Saved URL collection `Delhi C&D enforcement`. Add the verified example records to it without removing their Research Purpose membership; a collection and a purpose serve different roles.
3. Open each record’s **Details** view and confirm title, source domain, publication or issue date when available, and original URL.
4. Add the core tags `construction-dust`, `Delhi`, and `enforcement`, plus the issuing agency name such as `CAQM` or `DPCC`. Add one concise note identifying the evidence role: `direction`, `implementation/enforcement`, or `reporting`.
5. Capture the CAQM direction or order as PDF into `Delhi C&D enforcement/Official directions`. Use PDF because pagination, the issuing authority, and the original order format matter.
6. Capture official explanatory or enforcement web pages as Text when searchable page content is the important evidence. Capture attached formal reports as PDF into `Delhi C&D enforcement/Implementation reports`.
7. Wait for each capture to report success, then confirm its stored-file link. Do not count a queued, failed, or merely saved URL as preserved evidence.
8. If an official server blocks capture, do not bypass the restriction. Download an authorised public copy through the browser, upload it in File Manager, preserve the source URL in the available metadata or notes, and record that it replaced the blocked automated capture.
9. Open **File Manager** from the sidebar.

**Expected state:** The purpose still contains the URL records, the collection groups the reviewed subset, and successful captures link to files in the two named File Manager subfolders.

**Checkpoint:** At least one formal direction and one implementation or reporting document have durable copies, or a failed capture and its authorised-upload fallback are explicitly documented. Use the existing capture troubleshooting in Section 6.3 for blocked, timed-out, or missing captures.

### 6.3 Common issues on this page

- **A pasted URL is not added:** the URL may already exist or may fail URL validation. Search the registry for the existing record and verify that the address includes a valid `http://` or `https://` scheme.
- **The expected records are missing:** clear the active Research Purpose, collection, review queue, saved search, and advanced filters one at a time. Purpose membership and collection membership are separate filters.
- **Registry view is unavailable:** the dense Registry layout is enabled only at supported viewport widths. Use Cards or widen the browser window.
- **Metadata or preview is incomplete:** the source may block automated retrieval, require JavaScript or authentication, or expose little usable metadata. Use refresh metadata where appropriate and inspect the original source.
- **Text capture is disabled for a PDF URL:** use PDF capture for a source already identified as PDF.
- **Capture is blocked:** `robots.txt`, SSRF protection, authentication, CAPTCHA, unsupported content, or access controls may prevent server-side capture. Do not bypass access controls; use an authorised copy or alternate public representation.
- **PDF capture times out:** complex pages, large documents, or slow rendering can exceed the capture timeout. Retry once, then inspect backend logs or preserve an authorised copy manually.
- **Capture reports success but no file is visible:** confirm the destination folder selected in the picker, refresh File Manager, and inspect the saved record’s capture details.
- **AI tagging remains pending or fails:** confirm that the AI tagger and its queue/Redis dependency are healthy. The deterministic tagger does not require an OpenAI key; only its optional LLM enhancement does.
- **Bulk actions affect fewer records than expected:** actions operate on the selected or currently loaded records described by the control. Recheck selection and filters before retrying.

## 7. File Manager

![File Manager overview with explorer controls](assets/manual/file-manager-overview.png)

*Figure 5. File Manager overview.*

File Manager is the durable evidence archive for uploads, captured web evidence, revisions, and notebook-ready research assets.

### 7.1 Main controls

- Views include all evidence, favourites, trash, and collections.
- Explorer controls include breadcrumbs, search, new folder, upload, layout, sorting, and density.
- Archive filters cover capture type, visibility, integrity, revision, domain, AI status, and metadata.
- Review queues and Analyst Views support repeatable evidence-quality workflows.

![File Manager filters, queues, and Analyst Views](assets/manual/file-manager-controls.png)

*Figure 6. Archive filters, review queues, and Analyst Views.*

The Evidence Inspector shows origin, capture method, SHA-256 state, revisions, AI tags, metadata, and notebook readiness.

![File list and Evidence Inspector](assets/manual/file-manager-evidence.png)

*Figure 7. File list and Evidence Inspector.*

### 7.2 Step-by-step navigation: organise and inspect evidence

1. Open **File Manager** from the application sidebar.
2. In the left sidebar, choose **All evidence**, **Favourites**, **Trash**, or a collection/folder. Use breadcrumbs plus Back and Forward to move through folder history.
3. To create a location, remain in the normal Drive view, select **New folder**, enter the name, and confirm. Folder creation is not available from Trash or archive browsing.
4. Open the intended destination folder before uploading. Select **Upload files**, choose one or more authorised files, and wait for each upload to complete.
5. Switch among **Large**, **Icons**, **Details**, and **List** layouts, then adjust sort and density for the review task.
6. Use search to narrow the current drive, folder, favourites, trash, or archive scope shown by the interface.
7. Open **Archive filters** to filter by capture type, visibility, integrity state, revisions, source domain, AI status, or metadata completeness.
8. Use **Review queues** for targeted cleanup such as AI failures, missing metadata, pending hashes, or records updated since review. Use a built-in or saved **Analyst View** when a repeatable filter set is appropriate.
9. Select a file to preview it. If inline preview is unsupported, use the available download action instead.
10. Open **Properties** or the **Evidence Inspector** to check origin, capture method, source URL, SHA-256/integrity state, revision history, metadata, AI tags, and Notebook readiness.
11. Use row, card, context-menu, or command-bar actions to favourite, rename, duplicate, move, tag, or move items to Trash. The exact actions shown depend on the selected item and view.
12. For multi-item work, select the relevant checkboxes and use the bulk actions that become enabled; do not assume every single-item action supports bulk use.
13. If an item was removed accidentally, open **Trash**, select it, and choose **Restore**. A short-lived **Undo** action may also appear immediately after moving an item to Trash.
14. When a file is ready for analysis, use its Notebook action or open Notebook and choose **Add File**. Use the Governance Workspace action when the file should become pinned anchor evidence for an investigation.

### 7.2.1 Continue the worked example: organise and inspect the evidence

1. In the normal Drive view, create the folder `Delhi C&D enforcement` if the capture destination picker did not already create it.
2. Inside it, confirm or create the subfolders `Official directions` and `Implementation reports`. Move only the corresponding example files into those locations.
3. If a capture was blocked, open the correct subfolder, upload the authorised copy, and give it a descriptive name containing the issuing agency, document identifier or subject, and year. Do not imply that the uploaded file was captured automatically.
4. Open each file’s **Properties** or **Evidence Inspector**. Check the source URL or recorded origin, capture method, date and title metadata, integrity or SHA-256 state, AI tags, and Notebook readiness.
5. Correct organisation or descriptive metadata using only the controls available. Do not alter source content to make records agree with one another.
6. Search the folder for `construction` and filter by agency or capture type to confirm that the example’s direction and implementation/reporting files are discoverable.
7. Wait for the files required for analysis to become Notebook-ready. If a source fails, open diagnostics and follow the existing extraction, OCR, ingestion, or indexing guidance before continuing.
8. Open Notebook and add files from these folders, or use an available file-level Notebook action.

**Expected state:** The archive contains a traceable direction set and implementation/reporting set, with origin and integrity information visible and the analysis sources progressing to a ready state.

**Checkpoint:** You can identify where each file came from, how it entered the archive, which evidence role it serves, and whether it is ready for grounded analysis. Use the existing Section 7.3 troubleshooting when upload, preview, hashing, tagging, or readiness fails.

### 7.3 Common issues on this page

- **Upload is unavailable:** uploads and folder creation require the normal Drive view. Leave Trash, Favourites, or archive browsing and open the intended Drive folder.
- **An upload fails:** check file-size limits, supported request size, backend availability, storage permissions, and available disk space. Retry only after identifying the failed file and reason.
- **A file is not in the expected folder:** uploads use the folder open when the upload is confirmed. Return to **All evidence**, search for the filename, and move it if necessary.
- **Search or filters hide files:** clear the folder search, Archive filters, Review queue, Analyst View, favourites/trash scope, and collection scope. The visible count reflects the active scope.
- **Preview fails but download works:** very large files and browser-unsupported formats may not render inline. Download the authorised file and open it with an appropriate local application.
- **Integrity shows pending or unavailable:** hashing or metadata processing may still be running or may have failed. Refresh the item, inspect Properties/Evidence Inspector, and review service logs if it does not progress.
- **AI tags are pending or failed:** verify AI-tagger and queue health, then use the available retry action. An AI-tagger OpenAI key is optional and is not required for deterministic tagging.
- **A Notebook source is not ready:** open the file’s Evidence Inspector or Notebook diagnostics to distinguish extraction, OCR, ingestion, and embedding failures.
- **Move, paste, or folder actions are disabled:** some operations are blocked in Trash, Favourites, archive/ZIP browsing, or for incompatible mixed selections. Return to Drive and reduce the selection.
- **An item was moved to Trash accidentally:** use the immediate **Undo** action when visible, or open Trash and choose **Restore**. Do not permanently delete evidence unless authorised.

## 8. Notebook

![Notebook showing Sources, Chat, Notes, and answer modes](assets/manual/notebook.png)

*Figure 8. Notebook analysis workspace.*

Notebook combines selected URL and file sources into a cited analysis and writing workspace. Backend OpenAI configuration is required for embeddings and the intended grounded chat experience.

### 8.1 Main controls

- Create, select, rename, and delete notebooks.
- Add saved URLs or files as sources.
- Include or exclude each source from the current retrieval scope.
- Readiness states indicate whether ingestion and embeddings are queued, processing, failed, or **Ready**.
- Chat modes include Draft, Evidence, and Briefing.
- Answers can contain linked citations, evidence blocks, and a source reader.
- Notes preserve durable findings; Guide, Studio, and Recent support prompts and navigation.

### 8.2 Step-by-step navigation: ask a grounded question

1. Open **Notebook** from the landing page, application navigation, or a source action.
2. Create a new notebook or select an existing notebook, then rename it to match the project, case, or question.
3. Select **Add URL** to attach records from Saved URLs, or **Add File** to attach stored evidence from File Manager. Choose the sources in the picker and confirm.
4. Review the Sources panel while ingestion and embeddings run. Essential sources must reach **Ready** before they can support grounded retrieval.
5. If a source is stalled, failed, or not ready, open its diagnostics and use only the repair action offered for that source, such as retrying extraction, OCR, or indexing. Recheck its state afterward.
6. Mark relevant source cards **Included** and irrelevant cards **Excluded**. Select **Use all sources** to restore the full notebook scope. Exclusion affects chat retrieval but does not delete the source.
7. Choose **Draft**, **Evidence**, or **Briefing** according to the required answer style.
8. Ask a precise question that states the issue, jurisdiction, time range, output format, and evidence standard.
9. Read the answer and inspect its evidence blocks. Open every material citation in the source reader and compare the claim with the cited passage.
10. Refine the included-source scope or question when citations are weak, irrelevant, or incomplete; do not treat repeated prompting as a substitute for missing evidence.
11. Copy only verified findings into **Notes**, and record conflicts, caveats, and evidence gaps alongside them.
12. Use **Guide** for prompt patterns, **Studio** for supported note-generation templates, and **Recent** to reopen recent notebook notes.
13. Remove a source from the notebook only when it should no longer belong to that notebook; use Excluded when it should merely be omitted from the current chat scope.

Example prompt:

> For Delhi, identify CPCB and DPCC actions on construction-dust enforcement between January 2023 and December 2025. Produce a dated table, distinguish mandatory orders from recommendations, cite each row, and state when the included evidence is insufficient or conflicting.

If no included source is Ready, grounded chat cannot use it. A citation is an evidence pointer, not a guarantee that the passage supports the claim or that the source is accurate.

### 8.2.1 Continue the worked example: build and verify the evidence table

1. Create the Notebook `Delhi C&D enforcement review`.
2. Add the formal direction and the implementation/reporting files from `Delhi C&D enforcement`. Add the corresponding Saved URL only when it contributes searchable content not already represented by the captured file.
3. Wait until every essential source is **Ready**, then mark those sources **Included**. Exclude duplicates, unrelated results, and sources outside the example’s date or geographic scope.
4. Choose **Evidence** mode and ask:

   > Using only the included sources, build a dated table for Delhi from January 2023 through December 2025 with these columns: date; issuing or reporting agency; action or obligation; legal or administrative authority; responsible implementing body; evidence of implementation; and citation. Separate mandatory directions from advisory or reported actions. After the table, list contradictions and evidence gaps. Do not infer implementation merely because a direction was issued.

5. Open every citation supporting a material table row. Confirm that the passage supports the date, actor, action, authority, and implementation statement attributed to it.
6. Remove or mark as unverified any row whose citation is absent, irrelevant, or weaker than the claim. If evidence is missing, add a better official source rather than repeatedly prompting for a stronger conclusion.
7. Copy the verified table, source substitutions, contradictions, and unresolved gaps into **Notes**. Label the note `Verified through [today’s date]` using the actual review date.
8. Preserve a specific distinction in Notes between `direction issued` and `implementation evidenced`; the former does not prove the latter.

**Expected state:** The Notebook contains a source-bounded table with openable citations and a durable note that separates verified findings from unresolved gaps. The actual findings depend on the selected evidence and are not supplied by this walkthrough.

**Checkpoint:** Every retained material claim has been compared with its cited passage. If a source is not Ready, chat is unavailable, or citations are unsupported, stop and use the existing Section 8.3 troubleshooting before opening Governance Workspace.

### 8.3 Common issues on this page

- **Add URL or Add File shows no expected source:** confirm that the URL exists in Saved URLs or the file exists in File Manager, then clear picker filters and search by its current title.
- **A source remains queued or processing:** allow active extraction, OCR, ingestion, or embedding work to finish, then open source diagnostics. Do not repeatedly remove and re-add the same source while a job is active.
- **A source is failed or not ready:** use the repair action recommended by diagnostics. The available action depends on whether extraction, OCR, ingestion, or embedding failed.
- **Chat cannot send a grounded question:** ensure at least one source is both **Included** and **Ready**, and confirm backend OpenAI is enabled and correctly configured.
- **An expected source is ignored:** check whether its card is **Excluded**. Select **Use all sources** or include it explicitly before asking the next question.
- **The answer is irrelevant:** narrow the included sources and make the question, jurisdiction, time period, output format, and evidence standard explicit.
- **The answer has weak or missing citations:** open the evidence blocks, verify source readiness, and ask a claim-specific question. If the archive lacks supporting passages, add better evidence rather than forcing an answer.
- **A citation opens an unexpected passage:** compare the claim with the displayed excerpt and source document. Treat unsupported claims as unverified and record the discrepancy.
- **Notes do not contain a chat answer automatically:** Chat and Notes are separate. Copy or generate only verified material into Notes using the available controls.
- **OpenAI or model errors appear:** verify `OPENAI_ENABLED=true`, the backend `OPENAI_API_KEY`, configured model access, quota, and backend logs. The AI-tagger key does not enable Notebook chat.

## 9. Governance Workspace

![Governance Workspace official-source intake and question builder](assets/manual/governance-workspace.png)

*Figure 9. Governance Workspace question builder.*

Governance Workspace retrieves official-source evidence before generating an answer. It supports agency responsibility, action review, timelines, compliance and follow-up, contradictions, order comparison, and field preparation.

### 9.1 Main controls

- **Officer Question Builder:** enter a governance question in plain language.
- Question type, time window, issue hint, and location hint make retrieval more precise.
- Workflow modes include Auto-detect, Landscape mapping, Case tracing, and Question review.
- Source scope may use File Manager, Saved URLs, mixed anchors, or all sources.
- **Find evidence** runs retrieval before answer generation.
- Investigation Library preserves earlier sessions, citations, quality status, and follow-ups.

### 9.2 Step-by-step navigation: run an investigation

1. Open **Governance Workspace** from the application navigation. Alternatively, launch it from File Manager or Saved URLs to bring the selected item in as pinned anchor evidence.
2. In **Officer Question Builder**, enter one focused governance question in plain language.
3. Set the question type, time window, issue hint, and location hint when known. These fields narrow retrieval and should reflect the question rather than anticipated conclusions.
4. Choose a workflow: **Auto-detect** lets retrieval select the approach; **Landscape mapping** surveys actors and evidence; **Case tracing** follows a specific matter or contradiction; **Question review** examines the quality and support of a focused question.
5. Set source scope to **File Manager**, **Saved URLs**, **Mixed anchors**, or all available sources as appropriate. Pinned anchors bias retrieval toward those records but do not replace source-scope selection.
6. Review any pinned file or URL anchors. Clear an accidental anchor before retrieval, or return to File Manager/Saved URLs when the necessary source has not yet been stored or captured.
7. Select **Find evidence**. Wait for the ranked candidate set to load before attempting to generate an answer.
8. Review candidate titles, source type, metadata, provenance, and available evidence excerpts. Include relevant candidates and exclude irrelevant ones using the controls on each candidate.
9. Check coverage and gaps for missing agencies, periods, evidence families, or document types. Refine the question or broaden the source scope and run **Find evidence** again when necessary.
10. Select **Generate answer from retrieved evidence** only after the included evidence set is suitable. The generated answer is limited to the retrieved and selected evidence.
11. Inspect every material citation and its provenance. Distinguish statements present in sources from system-generated synthesis or inference.
12. Revisit earlier investigation sessions through **Investigation Library**, and retain unresolved gaps and follow-up questions when continuing the analysis.

### 9.2.1 Continue the worked example: trace responsibility and follow-up

1. Launch Governance Workspace from the CAQM direction in File Manager or Saved URLs so that the direction appears as a pinned anchor. Confirm the anchor before retrieval.
2. Enter this question in **Officer Question Builder**:

   > Between January 2023 and December 2025, what construction-and-demolition dust-control duties did CAQM assign to DPCC and Delhi implementing bodies, what official evidence shows those duties were implemented, and what compliance or reporting gaps remain?

3. Set **Question type** to **Compliance/follow-up**, **Time window** to **Any period**, **Issue hint** to `Construction`, and **Location hint** to `Delhi NCR`. The exact 2023–2025 limit remains in the question because the selector does not provide that custom range.
4. Choose **Case tracing** and set **Source scope** to **Mixed anchors** so the investigation can use both captured files and saved official URLs.
5. Select **Find evidence**. Review the ranked set and include only records that address an assigned duty, implementation action, enforcement result, or reporting gap within the question’s scope.
6. Inspect coverage before generation. If an agency, time period, or evidence role is missing, refine retrieval or return to the archive; do not interpret retrieval silence as proof of non-compliance.
7. Select **Generate answer from retrieved evidence** only after the included set is suitable.
8. Open every citation supporting a claimed mandate, agency relationship, enforcement event, or gap. Compare those claims with the Notebook’s verified table and record genuine conflicts rather than forcing alignment.
9. Reopen the investigation through **Investigation Library** and confirm that its question, source scope, retrieved evidence, citations, and follow-up gaps persist.

**Expected state:** Governance Workspace shows a saved, evidence-first investigation connecting the pinned direction to retrieved implementation or reporting records. Any agency map, timeline, contradiction, or gap panel is an evidence-dependent output, not a guaranteed conclusion.

**Checkpoint:** The purpose, Saved URL collection, File Manager folders, Notebook note, and Governance investigation form one traceable chain. Completion means the claims are reviewable through citations; it does not mean the system has proven compliance or non-compliance. Use the existing Section 9.3 troubleshooting when retrieval, coverage, generation, citation support, or investigation persistence fails.

### 9.3 Common issues on this page

- **Find evidence returns no candidates:** make the question more concrete, clear an overly restrictive source scope or advanced filter, and confirm that relevant Saved URLs or File Manager documents exist and have searchable content.
- **A purpose-scoped investigation reports no captured evidence:** return to Saved URLs and capture authorised Text or PDF evidence for that purpose, or explicitly expand to all workspace evidence when appropriate.
- **Results are too broad or mixed:** add an agency, issue, location, time window, or question type, select the appropriate workflow, and run **Find evidence** again.
- **A known source is missing:** launch Governance Workspace from that File Manager or Saved URLs record to pin it as an anchor, or use exact dossier lookup when the canonical document ID is known.
- **Pinned anchors produce unexpected results:** confirm the source scope as well as the anchor list. Anchors bias the retrieval starting point; they do not guarantee that every retrieved candidate is relevant.
- **Generate answer from retrieved evidence is disabled:** run **Find evidence** first and keep at least one suitable candidate included in the answer set.
- **Answer generation fails:** confirm backend OpenAI configuration, model access, quota, and service logs. Evidence retrieval and answer generation are separate operations.
- **The answer omits an important candidate:** confirm that the candidate is marked **Included in answer**, then regenerate. Excluded candidates are intentionally omitted.
- **Citations do not support a claim:** mark the claim unverified, inspect the underlying source and provenance, adjust the evidence set, and regenerate only when the selected evidence supports the question.
- **Investigation Library does not show the expected session:** clear library search/source-scope filters, refresh the library, and confirm that the investigation reached the persisted retrieval or answer stage.
- **Issue, agency, timeline, or relationship panels are empty:** these panels depend on the selected evidence and extracted governance structure. Select a relevant issue, agency, or anchor document, or retrieve a stronger evidence set.

## 10. Evidence and AI safety

Retrieval and citations improve traceability; they do not guarantee correctness. Before using an answer for policy, legal, compliance, enforcement, procurement, or operational decisions, verify that:

- each cited passage actually supports the associated claim;
- the source is authoritative, authentic, current, and applicable to the stated jurisdiction and time;
- dates, tables, units, negation, amendments, and conflicting evidence were interpreted correctly;
- the retrieval scope included the relevant sources and did not silently omit a key document;
- claims distinguish source text from model inference;
- a qualified human has reviewed the conclusion.

Web pages and uploaded files may contain prompt-injection instructions intended to manipulate an AI system. Treat source content as evidence, not as instructions to the model or user. Never follow embedded requests to reveal secrets, change system settings, download software, or ignore verification rules.

Respect copyright, privacy, confidentiality, retention rules, and website access controls. Do not upload or capture material that your organisation is not authorised to store. Do not place API keys, passwords, personal data, or other secrets in purposes, prompts, notes, filenames, or screenshots.

## 11. Ten-minute validation exercise

This exercise verifies the core archive-to-citation workflow. Use a small, non-sensitive PDF that you are authorised to store.

1. Open File Manager and upload one PDF into a test folder.
2. Select the file and confirm its name, origin, and preview or download action are available.
3. Create a Notebook named `First-run validation`.
4. Add the uploaded PDF as a source.
5. Wait until its status is **Ready**. If it fails, open diagnostics before continuing.
6. Confirm that the source is **Included**.
7. Ask: `Summarise the document's purpose in three bullets. Cite every bullet and state when the evidence is unclear.`
8. Open at least one citation and compare the answer with the source passage.
9. Save one verified finding to Notes.

Success means the file remains visible in File Manager, the Notebook source reaches Ready, the answer contains an openable citation, and the citation leads to relevant evidence. If Google credentials are configured, separately create a Research Purpose, run one small search, save a result to the purpose, and confirm **Open in Saved URLs** opens the Saved URLs view filtered to that purpose. Find the saved result in that filtered registry.

## 12. Operating and troubleshooting a local installation

### 12.1 Stop, restart, rebuild, or reset

Stop the foreground stack with `Ctrl+C`. Restart existing containers:

```powershell
docker compose -f docker-compose.dev.yml up
```

Rebuild after dependency, image, or Dockerfile changes:

```powershell
docker compose -f docker-compose.dev.yml up --build
```

Stop containers while preserving database and file-storage volumes:

```powershell
docker compose -f docker-compose.dev.yml down
```

Delete containers **and all local database and uploaded-file volumes**:

```powershell
docker compose -f docker-compose.dev.yml down -v
```

Use `down -v` only when a complete local reset is intentional. A normal `down` preserves named volumes. For important or shared deployments, establish and test database and file-storage backups before relying on the system; Docker volumes are persistence, not a backup strategy.

### 12.2 Symptom-based troubleshooting

| Symptom | Check | Corrective action |
| --- | --- | --- |
| Docker reports a port conflict | Host ports `3000`, `4000`, and `7071` | Stop the conflicting process or change the relevant Compose mapping. Ports `5432` and `6379` are not published by the development stack. |
| Backend container fails during startup | `POSTGRES_PASSWORD`, `DATABASE_URL`, and backend logs | Use the same password in both settings and use host `db`, not `localhost`, in the Docker URL. |
| Frontend opens but API operations fail | <http://localhost:4000/health> and `CORS_ORIGINS` | Add the exact frontend origin, recreate the backend container, and inspect backend logs. |
| AI tagger is unavailable | <http://localhost:7071/health> and tagger logs | Inspect both tagger services and rebuild if dependency installation failed. |
| URL search fails | Google key, search-engine ID, quota, and backend logs | Correct `GOOGLE_CSE_KEY` or `GOOGLE_CSE_CX`, quota, or engine restrictions; recreate backend. |
| Notebook source never reaches Ready | Source diagnostics, backend OpenAI settings, worker logs, and source accessibility | Enable valid backend OpenAI credentials, confirm workers are running, retry permitted content, or upload an accessible copy. |
| Grounded chat or Governance answer is disabled | `OPENAI_ENABLED` and `OPENAI_API_KEY` | Set valid backend values and recreate backend and worker containers. |
| Text or PDF capture fails | Capture error and backend logs | Check robots rules, SSRF policy, authentication, CAPTCHA, content type, and rendering timeout. Use an authorised alternate source or upload; do not bypass controls. |

Useful log commands:

```powershell
docker compose -f docker-compose.dev.yml logs backend
docker compose -f docker-compose.dev.yml logs ai-tagger
docker compose -f docker-compose.dev.yml logs ai-tagger-worker
```

After changing environment values, recreate the affected containers so the new configuration is loaded. The repository `README.md` and checked-in `.env.example` files are the current source of truth for deployment configuration.

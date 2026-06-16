# SmartScrape

SmartScrape is a research platform for collecting, organizing, preserving, and analyzing web-based and personal documents used in governance and policy work. It helps users build searchable, citation-backed evidence collections for reviewing past decisions, preparing new analyses, and preserving institutional knowledge.

## Overview

The platform brings together four connected workflows:

1. Collect material from the web through the URL Collector, where users can search, inspect, deduplicate, and capture high-signal pages as text or PDF. Collect source material from the web in a structured way, turning scattered links into preserved research inputs

2. Organize saved URLs, PDFs, uploads, and evidence with metadata and structured tags in a structured library.

3. Trace relationships across agencies, timelines, issues or past context in the Governance Workspace. It records across agencies and decisions so users can understand what happened, who acted, and what remains unresolved

4. Brief and analyze from the archive by assembling relevant sources into evidence-backed notes, summaries, and working drafts.

The goal is to make air-quality governance faster to review, easier to trace, and more auditable across institutions such as CAQM and related state agencies. More broadly, SmartScrape is designed for any research or governance setting where documents are fragmented across websites, formats, and individual knowledge silos.

## Statement of need

Governance and policy work often depends on documents like orders, notices, compliance reports, meeting minutes, action-taken reports, court directions, and agency submissions from various governance bodies that are across institutional websites, in their respective databases or in physical copies, which is often difficult to access and requires permissions. Likewise, online newspaper articles become unavailable after a specific period. 

Although analysts can collect and search documents manually, current workflows frequently break provenance across heterogeneous and changing sources. Existing LLM tools do not reliably support evidence-linked answers or grounded retrieval for relevant context. 

Therefore, the approach is to develop an LLM-backed tool that allows you to extract text of the required documents if in text form using their URLs or if available in PDF form, download and save them in the tool’s database with LLM-generated tags for better searchability, and create a metadata schema to structure the database. SmartScrape also includes a Notebook workspace where users can interact directly with the evidence database, ask questions, and generate cited answers through grounded document retrieval. By bringing government records, agency documents, and news sources into a single searchable archive, the platform supports faster review, stronger evidence traceability, and more informed planning for future work. The Governance Workspace further enables officers and analysts to ask work-related questions, automatically surface relevant documents, receive evidence-backed answers with citations, and identify suggested follow-up actions for further review.

## Key features

### Research Impact & Evidence Integrity

- **Evidence-Backed Policy Analysis** — Centralizes fragmented governance documents, helps preserve sources that may disappear from the web, and supports reproducible analysis with cited evidence.
- **Cross-Agency Pattern Discovery** — Trace policy decisions and their consequences within the organization or across multiple institutions ; identify timeline relationships and decision dependencies for comparative governance research and decisions.
- **Grounded AI Analysis** — LLM-backed insights that don't hallucinate; all outputs anchored to source documents with citation links; reduces analyst time on manual review and categorization
- **Provenance & Auditability** — Maintains citation links to original sources; records capture metadata (date, context, version); enables verification and supports institutional knowledge preservation
- **Institutional Continuity** — Archives ephemeral web content before it disappears; captures decision rationale and organizational context; supports longitudinal governance studies

### Data Collection & Organization

- **URL Collector with Deduplication** — Search, inspect, and capture web pages as text or PDF; automatic deduplication prevents redundant data; structured capture of web-sourced evidence
- **Flexible Multi-Format Support** — Handles web pages, PDFs, and text uploads with unified storage and searchable archive
- **Intelligent Metadata & Tagging** — AI-powered automated tagging using LLM-based taxonomy system; customizable structured tags (CAQM taxonomy included as example); full-text search across documents and metadata
- **Governance Workspace** — Map connections across agencies, decisions, timelines, and issues; track authorship and policy dependencies; create audit trails for governance decisions

### Technical Architecture

- **Reproducible & Scalable** — Docker-based deployment with containerized frontend, backend, and AI components; production and development configurations; Prisma ORM for database migrations
- **Extensible Taxonomy System** — Composable taxonomy structure enabling domain-specific customization for different governance contexts
- **Notebook Environment** — Interactive analysis and briefing interface for assembling evidence-backed notes, summaries, and working drafts from the archive

## Installation

The supported local installation path is Docker Compose. It starts the complete
SmartScrape stack: React frontend, Express backend, backend worker, PostgreSQL
with pgvector, Redis, FastAPI AI tagger, and AI tagger worker. Docker also runs
the Node and Python dependency installation inside the containers, so reviewers
do not need a local PostgreSQL, Redis, Node.js, or Python installation for the
standard setup.

### Requirements

- Docker Desktop or Docker Engine with Docker Compose.
- Git, unless you download the repository as a ZIP archive.
- A terminal: PowerShell on Windows, Terminal on macOS or Linux.
- For full external integrations: `OPENAI_API_KEY`, `GOOGLE_CSE_KEY`,
  and `GOOGLE_CSE_CX`.
- Optional for non-Docker development only: Node.js 22+, npm, Python 3.12,
  PostgreSQL 16 with pgvector, and Redis 7.

SmartScrape uses these local ports in the Docker development setup:

| Service | URL |
| --- | --- |
| Frontend | `http://localhost:3000` |
| Backend API | `http://localhost:4000` |
| Backend health check | `http://localhost:4000/health` |
| AI tagger health check | `http://localhost:7071/health` |
| Optional Institutional Capture Node | `http://localhost:7081` |

### 1. Get the Source Code

Clone the repository and enter the project directory:

```powershell
git clone https://github.com/bsvsrakhilesh/Smart-Scrape.git
cd Smart-Scrape
```

If you downloaded a ZIP archive, extract it and open a terminal in the extracted
`Smart-Scrape` directory.

Check that Docker is available:

```powershell
docker --version
docker compose version
```

### 2. Create Local Environment Files

Copy the checked-in examples before starting the containers.

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
Copy-Item ai-tagger\.env.example ai-tagger\.env
Copy-Item icn\.env.example icn\.env
```

On macOS or Linux:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp ai-tagger/.env.example ai-tagger/.env
cp icn/.env.example icn/.env
```

The `.env` files are local configuration files. They may contain secrets and
should not be committed.

### 3. Configure the Docker Development Stack

Choose a PostgreSQL password for local development. Any strong password is fine;
it does not need to exist before Docker creates the database container.

PowerShell password generator:

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
```

macOS or Linux password generator:

```bash
openssl rand -base64 24
```

Set the root `.env` file:

```env
POSTGRES_PASSWORD=replace-with-your-password
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Set the required local values in `backend/.env`. Use the same password in
`POSTGRES_PASSWORD` and `DATABASE_URL`:

```env
NODE_ENV=development
PORT=4000
POSTGRES_PASSWORD=replace-with-your-password
DATABASE_URL=postgresql://postgres:replace-with-your-password@db:5432/SmartScrape?schema=public
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
TAGGER_PY_URL=http://ai-tagger:7071
OPENAI_ENABLED=false
TAGS_USE_LLM=false
DEV_AUTH_ENABLED=false
```

For the Docker development stack, these values are supplied by
`docker-compose.dev.yml` and can stay blank in the copied `.env` files:
`REDIS_URL`, `FILE_STORAGE_DIR`, `CHROMIUM_EXECUTABLE_PATH`,
`AI_TAG_URL_QUEUE_CONCURRENCY`, `AI_TAG_FILE_QUEUE_CONCURRENCY`, and the
`ai-tagger/.env` `PORT` and `REDIS_URL` values.

`frontend/.env` can stay blank for Docker because the development container
starts Vite on port `3000` and proxies API requests to the backend service.

### 4. Optional External Service Configuration

SmartScrape can run without external API keys. In that mode, local startup,
file upload, source storage, deterministic tests, and non-LLM workflows remain
available, but web search and LLM-backed analysis are limited.

To enable OpenAI-backed notebook answers, governance answers, LLM-assisted tag
ranking, and structured extraction, set these values in `backend/.env`:

```env
OPENAI_ENABLED=true
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
GOVERNANCE_ANSWER_MODEL=gpt-4.1-mini
GOVERNANCE_ASSIST_MODEL=gpt-4.1-mini
GOVERNANCE_DEEP_REVIEW_MODEL=gpt-4.1
```

If the Python AI tagger should also use LLM enhancement, set these values in
`ai-tagger/.env`:

```env
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4.1-mini
STRUCTURED_LLM_ENABLED=true
STRUCTURED_LLM_MODEL=gpt-4.1-mini
```

To enable Google-powered URL search, set these values in `backend/.env`:

```env
GOOGLE_CSE_KEY=your-google-api-key
GOOGLE_CSE_CX=your-programmable-search-engine-id
```

If those Google values are absent, reviewers can still test saved-source,
upload, tagging, notebook, and governance workflows with manually supplied
URLs and files.

### 5. Start SmartScrape

Start the full development stack:

```powershell
docker compose -f docker-compose.dev.yml up --build
```

The first run can take several minutes while Docker downloads base images,
builds the SmartScrape images, installs dependencies, generates the Prisma
client, and applies database migrations. Keep the terminal open while the
application is running.

When startup completes, open:

```text
http://localhost:3000
```

Confirm the backend and AI tagger are responding:

```text
http://localhost:4000/health
http://localhost:7071/health
```

### 6. Stop, Restart, or Reset

Stop the running stack with `Ctrl+C` in the Docker Compose terminal.

Restart the existing containers:

```powershell
docker compose -f docker-compose.dev.yml up
```

Rebuild after dependency or Dockerfile changes:

```powershell
docker compose -f docker-compose.dev.yml up --build
```

Stop containers without deleting saved database or file-storage volumes:

```powershell
docker compose -f docker-compose.dev.yml down
```

Reset all local Docker data, including the PostgreSQL database and uploaded
files stored in Docker volumes:

```powershell
docker compose -f docker-compose.dev.yml down -v
```

Only use the reset command when you intentionally want a fresh local database.

### 7. Troubleshooting

If Docker reports that a port is already in use, stop the process using that
port or edit the port mapping in `docker-compose.dev.yml`. The frontend uses
`3000`, the backend uses `4000`, and the AI tagger uses `7071`.

If the database container fails to start, confirm that `backend/.env` contains
`POSTGRES_PASSWORD` and that the same password appears inside `DATABASE_URL`.
For Docker, the database host in `DATABASE_URL` must be `db`, not `localhost`.

If the backend health check does not respond, inspect the backend logs:

```powershell
docker compose -f docker-compose.dev.yml logs backend
```

If the AI tagger health check does not respond, inspect the tagger logs:

```powershell
docker compose -f docker-compose.dev.yml logs ai-tagger
docker compose -f docker-compose.dev.yml logs ai-tagger-worker
```

If dependency installation fails after package changes, rebuild the stack:

```powershell
docker compose -f docker-compose.dev.yml up --build
```

If the application starts but LLM or search features are unavailable, check that
the relevant API keys are present in `backend/.env` and `ai-tagger/.env`. The
basic local application does not require those keys.

### 8. Optional Institutional Capture Node

The Institutional Capture Node (ICN) is an optional local browser-capture
service for authenticated pages. The Docker development backend is configured
to look for it at `http://host.docker.internal:7081`.

Run the ICN outside Docker:

```powershell
cd icn
npm install
npm run install:browsers
npm run dev
```

Recommended `icn/.env` values for local testing:

```env
PORT=7081
HOST=127.0.0.1
ICN_NODE_NAME=local-icn
ICN_HEADLESS=false
ICN_ALLOWED_ORIGIN=http://localhost:3000
```

If you set `ICN_SHARED_SECRET` in `icn/.env`, set the same value in
`backend/.env`.

### 9. Local Development Without Docker

This path is for contributors developing services directly on their machine. It
is not the recommended reviewer setup because you must install and manage
PostgreSQL with pgvector, Redis, Node.js, Python, and the AI tagger yourself.

Install JavaScript dependencies and prepare the database:

```powershell
npm run install:all
npm -w backend run prisma:generate
npm -w backend run prisma:migrate
```

For local services outside Docker, `backend/.env` must point at host services,
for example:

```env
DATABASE_URL=postgresql://postgres:replace-with-your-password@localhost:5432/SmartScrape?schema=public
REDIS_URL=redis://localhost:6379/0
TAGGER_PY_URL=http://localhost:7071
FILE_STORAGE_DIR=./storage
```

Install Python dependencies and run the AI tagger:

```powershell
cd ai-tagger
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 7071 --no-access-log
```

In a separate terminal, start the frontend and backend:

```powershell
npm run dev
```

Start the backend worker in another terminal when testing ingestion, embedding,
and tagging queues:

```powershell
npm -w backend run worker
```

### 10. Production Deployment

For production, use `docker-compose.prod.yml` as a starting point and set
production values in `.env`, `backend/.env`, and `ai-tagger/.env`.

Minimum root `.env` values:

```env
POSTGRES_PASSWORD=replace-with-a-strong-production-password
CORS_ORIGINS=https://your-production-domain.example
```

Minimum `backend/.env` values:

```env
NODE_ENV=production
POSTGRES_PASSWORD=replace-with-a-strong-production-password
DATABASE_URL=postgresql://postgres:replace-with-a-strong-production-password@db:5432/SmartScrape?schema=public
CORS_ORIGINS=https://your-production-domain.example
OPENAI_ENABLED=false
DEV_AUTH_ENABLED=false
```

Start the production stack:

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

The production compose file exposes the frontend on port `80` and keeps the
backend and AI tagger on the internal Docker network.

## Quick Start

For the common local path, the complete setup is:

```powershell
git clone https://github.com/bsvsrakhilesh/Smart-Scrape.git
cd Smart-Scrape
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
Copy-Item ai-tagger\.env.example ai-tagger\.env
Copy-Item icn\.env.example icn\.env
```

Then fill `POSTGRES_PASSWORD`, `DATABASE_URL`, and `CORS_ORIGINS` as described
above, start Docker Desktop, and run:

```powershell
docker compose -f docker-compose.dev.yml up --build
```

Open `http://localhost:3000` after the services are healthy.

## Example Workflow

After installation, use this workflow to verify the main research-software path:

1. Open `http://localhost:3000`.
2. Upload a small PDF or text file in the File Manager.
3. Confirm that the source is saved with file name, capture metadata, and
   searchable text where extraction is available.
4. Add or review structured tags for the saved source.
5. Open the Notebook, attach the saved source, and ask a question that requires
   an answer grounded in the uploaded evidence.
6. Confirm that the answer includes citations back to the saved source.
7. Open the Governance Workspace and verify that the same source can be used in
   an issue, agency, timeline, or evidence-review workflow.

If Google search credentials are configured, also test the URL Collector by
searching for a policy or governance source, reviewing the result metadata,
saving one URL, and confirming that it appears in the saved-source archive.

## Repository structure

```text
smart-scrape/
|-- README.md                    # Project overview, installation, usage, and JOSS-facing documentation
|-- docker-compose.dev.yml        # Local development stack: frontend, backend, database, Redis, AI tagger
|-- docker-compose.prod.yml       # Production-oriented Docker Compose configuration
|-- package.json                  # Root workspace scripts for frontend/backend development
|-- frontend/                     # React/Vite web interface
|   |-- components/               # UI components for URL collection, files, notebooks, governance workspace
|   |-- pages/                    # Main application pages
|   |-- hooks/                    # Frontend data-fetching and state hooks
|   |-- lib/                      # API clients and shared frontend logic
|   |-- utils/                    # URL, CSV, collection, and file helper utilities
|   `-- tests/                    # Frontend unit tests
|-- backend/                      # Node.js/Express API and worker services
|   |-- src/routes/               # HTTP API route definitions
|   |-- src/controllers/          # Request handlers
|   |-- src/services/             # Core application, governance, notebook, tagging, and search logic
|   |-- src/workers/              # Background workers for ingestion, embeddings, tagging, and saved URL operations
|   |-- src/queues/               # Job queue definitions and helpers
|   |-- src/__tests__/            # Backend automated tests
|   `-- prisma/                   # Database schema and migrations
|-- ai-tagger/                    # Python AI tagging, extraction, OCR, and structured metadata service
|   |-- app.py                    # FastAPI entry point for tagging jobs
|   |-- tasks.py                  # Celery task execution
|   |-- extractors.py             # Text extraction from URLs, PDFs, documents, and images
|   |-- pipeline.py               # Tagging pipeline orchestration
|   |-- taxonomies/               # Domain taxonomies, including the CAQM example taxonomy
|   `-- tests/                    # Python tests for tagging, OCR, and structured extraction
|-- icn/                          # Institutional Capture Node for authenticated browser-based captures
`-- paper/                        # JOSS paper source files
    |-- paper.md
    `-- paper.bib
```

Generated and local-only files such as `.env`, `node_modules/`, local storage
volumes, caches, and virtual environments are excluded from the source
distribution and should not be edited directly.

## Documentation

This README is the primary user and reviewer documentation for the current
repository. It includes installation, configuration, example workflow, testing,
and verification instructions for the main SmartScrape workflows:

- collecting URLs and PDFs
- uploading and organizing documents
- using tags and metadata
- working with the Governance Workspace
- using the Notebook for evidence-backed analysis
- interpreting citations and saved sources

## Testing and verification

SmartScrape provides automated tests for the TypeScript backend, frontend
collector utilities, and Python AI tagger components. The tests are intended to
verify the core research-software behavior that supports reproducible evidence
collection: URL normalization, search input validation, queue identifiers, OCR
option parsing, notebook text chunking and provenance handling, governance
workspace query planning, document discovery, embedding vector formatting,
tag-candidate filtering, structured intelligence extraction, and OpenAI client
compatibility helpers.

Install dependencies before running the test suites:

```powershell
npm install
```

If testing the Python AI tagger outside Docker, create a Python environment and
install its dependencies:

```powershell
cd ai-tagger
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

Run the backend tests:

```powershell
npm -w backend test
```

The backend suite includes optional database integration tests for URL Collector
deduplication through the real `createManyUrls` Prisma write path and collector
purpose save-selection flow. They are skipped unless
`SMARTSCRAPE_TEST_DATABASE_URL` points to a disposable test PostgreSQL database
with migrations applied:

```powershell
$env:SMARTSCRAPE_TEST_DATABASE_URL="postgresql://postgres:<password>@localhost:5432/SmartScrape_test?schema=public"
npm -w backend test
```

Run the frontend tests:

```powershell
npm -w frontend test
```

Run the Python AI tagger tests:

```powershell
cd ai-tagger
python -m unittest discover -s tests
cd ..
```

Build the production frontend and backend bundles:

```powershell
npm run build
```

For end-to-end verification, start the full local development stack:

```powershell
docker compose -f docker-compose.dev.yml up --build
```

When the services are running, verify that these endpoints are available:

```text
http://localhost:3000
http://localhost:4000/health
http://localhost:7071/health
```

A reviewer can then perform this manual smoke test:

1. Open `http://localhost:3000`.
2. Use the URL Collector to search for relevant sources using keywords,
   website/domain filters, year filters, jurisdiction, region, and document
   format options.
3. Review the returned URLs, inspect their snippets and metadata, and save one
   or more relevant results to the archive.
4. Upload a small PDF or plain-text file in the File Manager.
5. Run AI tagging on a saved URL or uploaded file when the tagger service is
   available.
6. Confirm that the saved source appears with title, URL or file name, capture
   metadata, tags, and provenance information.
7. Attach the saved source to a Notebook and ask a question that requires a
   cited answer from the archived evidence.
8. Open the Governance Workspace and verify that the same source can be used for
   issue, agency, timeline, or evidence review workflows where applicable.

The expected result is that automated tests exit successfully, the frontend and
backend build without TypeScript errors, service health checks respond, and the
manual workflow produces a saved evidence source that can be searched, tagged,
attached to a notebook, and cited in an answer.

Some integrations depend on external services. OpenAI-backed notebook/chat,
LLM-assisted tag ranking, and structured extraction require a valid
`OPENAI_API_KEY`. Google-powered URL search requires valid `GOOGLE_CSE_KEY` and
`GOOGLE_CSE_CX` credentials. Without these keys, deterministic tests, local
startup, file upload, saved-source management, and non-LLM verification paths
can still be exercised, but external search and LLM-backed analysis will be
limited.

## Development status

SmartScrape is under active development. The current repository is suitable for
local testing, research workflow evaluation, and continued development, but it
should be treated as pre-release research software until a stable public release
is tagged.

The Docker development stack, automated tests, and manual smoke-test workflow in
this README are the recommended ways to verify the current version. Interfaces,
configuration options, and data models may change between early releases.

## Citation

If you use SmartScrape in research, policy analysis, or institutional work,
please cite the repository and the corresponding software release. A formal
software citation file will be added before the first archived release.

Suggested citation format for now:

> Boddu Sesha Venkata Sai Ranga Akhilesh et al. SmartScrape: Evidence collection
> and grounded analysis software for governance and policy workflows. GitHub
> repository: https://github.com/bsvsrakhilesh/Smart-Scrape

For archival citation, create a tagged release and archive it with a service
such as Zenodo to obtain a DOI.

## License

SmartScrape is intended to be released under the Apache License 2.0. A full
`LICENSE` file should be included before public release or journal submission.

## Contact / support

For questions, bug reports, feature requests, or reproducibility issues, use the
GitHub issue tracker:

https://github.com/bsvsrakhilesh/Smart-Scrape/issues

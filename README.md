# SmartScrape

SmartScrape is a platform designed for governance and policy work and help in collecting, organizing, storing and analyzing web-based and personal documents for governance organizations or institutions so that we can have citations backend evidence for new decisions and searchable documents.

## Overview

The platform brings together four connected workflows:

1. Collect material from the web through the URL Collector, where users can search, inspect, deduplicate, and capture high-signal pages as text or PDF. Collect source material from the web in a structured way, turning scattered links into preserved research inputs

2. Organize saved URLs, PDFs, uploads, and evidence with metadata and structured tags in a structured library.

3. Trace relationships across agencies, timelines, issues or past context in the Governance Workspace. It records across agencies and decisions so users can understand what happened, who acted, and what remains unresolved

4. Brief and analyze from the archive by assembling relevant sources into evidence-backed notes, summaries, and working drafts.

The goal is to make air-quality governance faster to review, easier to trace, and more auditable across institutions such as CAQM and related state agencies. More broadly, SmartScrape is designed for any research or governance setting where documents are fragmented across websites, formats, and individual knowledge silos.

## Statement of need

Documents and notifications from various governance bodies are either stored in their respective databases or in paper form, which is often hard to access and requires permissions. Likewise, online newspaper articles become unavailable after a specific period. Although documents can be collected and searched, current workflows frequently break provenance across heterogeneous, changing sources, and existing LLM tools do not reliably support evidence-linked answers or grounded retrieval of relevant context. Therefore, the approach is to develop an LLM-backed tool that allows you to capture screenshots of the required documents using their URLs, save them in the tool’s database with LLM-generated tags for better searchability, and create a metadata schema to structure the database. Then there is a notebook page where you can interact with the database, using cited answers and grounded document retrieval to cite from the tool’s database. This way, documents from various government agencies and newspaper articles are in one place, enabling efficient planning for future work

## Key features

### Research Impact & Evidence Integrity

- **Evidence-Backed Policy Analysis** — Centralized repository for fragmented governance documents; prevents loss of sources that disappear from web (newspaper article, agency pages); enables reproducible research with cited evidence.
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

This guide is written for someone who wants to run the SmartScrape website
locally, even without much development experience. Use Docker Compose unless
you specifically want to develop each service manually. Docker Compose starts
everything SmartScrape needs: the website, backend API, workers, PostgreSQL with
pgvector, Redis, and the Python AI tagger.

You do not need to install PostgreSQL, Redis, Python, or Node.js separately for
the normal Docker setup. Docker runs those services in containers.

1. Install the required tools.

   - Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
     and start it.
   - Install [Git](https://git-scm.com/downloads), or download this repository
     as a ZIP file and extract it.
   - On Windows, open PowerShell. On macOS or Linux, open Terminal.

   To check Docker is ready, run:

   ```powershell
   docker --version
   docker compose version
   ```

2. Get the project files and enter the project directory.

   ```powershell
   git clone https://github.com/bsvsrakhilesh/Smart-Scrape.git
   cd Smart-Scrape
   ```

   If you already downloaded or opened the project folder, just open a terminal
   inside the `smart-scrape` directory and continue.

3. Create environment files from the examples.

   ```powershell
   Copy-Item .env.example .env
   Copy-Item backend\.env.example backend\.env
   Copy-Item frontend\.env.example frontend\.env
   Copy-Item ai-tagger\.env.example ai-tagger\.env
   Copy-Item icn\.env.example icn\.env
   ```

   On macOS or Linux, use `cp` instead of `Copy-Item`.

4. Create a database password.

   This is just a new password you choose. It does not need to already exist.
   Docker will use it when creating the PostgreSQL container.

   To generate a simple alphanumeric password in PowerShell:

   ```powershell
   -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
   ```

   Keep the generated value nearby for the next step.

5. Fill the required local Docker settings.

   In the root `.env` file, set `POSTGRES_PASSWORD` to the password you
   generated:

   ```env
   POSTGRES_PASSWORD=change-me
   CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
   ```

   In `backend/.env`, set these values. Use the same password in
   `POSTGRES_PASSWORD` and inside `DATABASE_URL`:

   ```env
   NODE_ENV=development
   PORT=4000
   POSTGRES_PASSWORD=change-me
   DATABASE_URL=postgresql://postgres:change-me@db:5432/SmartScrape?schema=public
   CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
   TAGGER_PY_URL=http://ai-tagger:7071
   OPENAI_ENABLED=false
   ```

   Example: if your password is `abc123`, then the database line becomes:

   ```env
   DATABASE_URL=postgresql://postgres:abc123@db:5432/SmartScrape?schema=public
   ```

   In `ai-tagger/.env`, Redis and port values can stay blank for Docker because
   Compose supplies them. Set `OPENAI_API_KEY`, `LLM_MODEL`, or
   `STRUCTURED_LLM_MODEL` only when using LLM-enhanced tag ranking and
   structured extraction.

6. Optional: add API keys for AI and Google search features.

   You can skip this step for a basic local launch. Without these keys, the
   website can still start, but OpenAI-backed notebook/chat/tagging features and
   Google-powered URL search will not be fully available.

   - OpenAI API key: sign in to the
     [OpenAI Platform](https://platform.openai.com/), open
     [API keys](https://platform.openai.com/api-keys), create a new secret key,
     and copy it immediately. Put it in `backend/.env` as `OPENAI_API_KEY=...`
     and set `OPENAI_ENABLED=true`. If you want the Python tagger to use the
     same LLM key, also put it in `ai-tagger/.env`.
   - Google Programmable Search credentials: SmartScrape expects
     `GOOGLE_CSE_KEY` and `GOOGLE_CSE_CX` for Google-powered URL search. Google
     currently marks the Custom Search JSON API as closed to new customers, so
     this path applies only if your Google Cloud project already has access or
     Google grants access. For an eligible project, create or configure a
     Programmable Search Engine in the
     [control panel](https://programmablesearchengine.google.com/controlpanel/all),
     copy its Search Engine ID from the Overview/Basic section as
     `GOOGLE_CSE_CX`, then create an API key in
     [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials)
     for `GOOGLE_CSE_KEY`. Restrict the key to the Custom Search JSON API where
     possible.

7. Start SmartScrape.

   ```powershell
   docker compose -f docker-compose.dev.yml up --build
   ```

   The first run can take several minutes because Docker downloads images and
   installs dependencies. Leave the terminal open while the app is running.

8. Open the website.

   Go to `http://localhost:3000` in your browser.

   Useful service URLs:

   - Website: `http://localhost:3000`
   - Backend health check: `http://localhost:4000/health`
   - AI tagger health check: `http://localhost:7071/health`

9. Stop or restart the app.

   To stop it, press `Ctrl+C` in the terminal running Docker Compose.

   To start it again later:

   ```powershell
   docker compose -f docker-compose.dev.yml up
   ```

10. Optional: run the Institutional Capture Node (ICN) for authenticated browser
   captures. The development backend is configured to look for it on the host at
   `http://host.docker.internal:7081`.

   ```powershell
   cd icn
   npm install
   npm run install:browsers
   npm run dev
   ```

   If you set `ICN_SHARED_SECRET` in `icn/.env`, set the same value in
   `backend/.env`.

## Requirements

- Docker Desktop or Docker Engine with Compose for normal local use.
- Git, unless you download the project as a ZIP file.
- SmartScrape requires PostgreSQL with pgvector and Redis. Docker starts both
  automatically as the `db` and `redis` services.
- Node.js 22+ and npm if you run the frontend, backend, or ICN outside Docker.
- Python 3.12 if you run `ai-tagger` outside Docker.
- If you run services locally without Docker, install and start PostgreSQL with
  pgvector and Redis yourself before starting the backend.
- Optional keys for full AI/search behavior: `OPENAI_API_KEY`,
  `GOOGLE_CSE_KEY`, and `GOOGLE_CSE_CX`.

## Quick start

Use this after you have completed the Installation steps above.
Before running the command, make sure Docker Desktop is open and your terminal
is inside the `Smart-Scrape` project folder.

Start the website:

```powershell
docker compose -f docker-compose.dev.yml up --build
```

The first run may take several minutes. When the services are running without
errors, open:

```text
http://localhost:3000
```

To stop the website, press `Ctrl+C` in the terminal. To start it again later,
run:

```powershell
docker compose -f docker-compose.dev.yml up
```

Only use the commands below if you are developing without Docker. This path is
not recommended for a first-time user because you must install and run
PostgreSQL, pgvector, Redis, Node.js, Python, and the AI tagger yourself.

```powershell
npm run install:all
npm -w backend run prisma:generate
npm -w backend run prisma:migrate
npm run dev
```

In that local setup, set `backend/.env` to use local service addresses, for
example `DATABASE_URL=postgresql://postgres:<password>@localhost:5432/SmartScrape?schema=public`,
`REDIS_URL=redis://localhost:6379/0`, and
`TAGGER_PY_URL=http://localhost:7071`.

For production, fill `.env`, `backend/.env`, and `ai-tagger/.env` with
production values, then run:

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

## Example workflow

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
|-- docs/                         # User documentation and manuals
`-- paper/                        # JOSS paper source files
    |-- paper.md
    `-- paper.bib
```

Generated and local-only files such as `.env`, `node_modules/`, local storage
volumes, caches, and virtual environments are excluded from the source
distribution and should not be edited directly.

## Documentation

A detailed user manual is provided separately. It explains how to use the main SmartScrape workflows, including:

- collecting URLs and PDFs
- uploading and organizing documents
- using tags and metadata
- working with the Governance Workspace
- using the Notebook for evidence-backed analysis
- interpreting citations and saved sources

See: [User Manual](./docs/SmartScrape_User_Manual.pdf)

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

The backend suite includes an optional database integration test for URL
Collector deduplication through the real `createManyUrls` Prisma write path. It
is skipped unless `SMARTSCRAPE_TEST_DATABASE_URL` points to a disposable test
PostgreSQL database with migrations applied:

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

## Citation

## License

## Contact / support

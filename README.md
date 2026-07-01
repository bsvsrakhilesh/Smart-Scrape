# SmartScrape

[![CI](https://github.com/bsvsrakhilesh/Smart-Scrape/actions/workflows/ci.yml/badge.svg)](https://github.com/bsvsrakhilesh/Smart-Scrape/actions/workflows/ci.yml)

SmartScrape is a research platform for collecting, organizing, preserving, and analyzing web-based and personal documents used in governance and policy work. It helps users build searchable, citation-backed evidence collections for reviewing past decisions, preparing new analyses, and preserving institutional knowledge.

The intended SmartScrape workflow uses **Google Programmable Search / Custom
Search JSON API** for web discovery and **OpenAI** for query assistance,
embeddings, enhanced tag reranking, Notebook answers, and Governance Workspace
analysis. Configure both integrations before evaluating the complete product.
The AI tagger itself does not require OpenAI: it has a deterministic tagging,
taxonomy, and structured-intelligence path, with optional LLM enhancement.

For detailed page-by-page usage instructions, see the [User Manual](docs/SmartScrape_User_Manual.md).

## Overview

The platform brings together four connected workflows:

1. Discover and collect web sources with the URL Collector. Users can search, inspect, deduplicate, and save high-signal pages for later capture as text or PDF.

2. Organize saved URLs, PDFs, uploads, and other evidence in a searchable library with metadata and structured tags.

3. Trace relationships across agencies, decisions, timelines, issues, and unresolved questions in the Governance Workspace.

4. Analyze archived evidence by assembling relevant sources into cited notes, summaries, and working drafts.

The goal is to make air-quality governance faster to review, easier to trace, and more auditable across institutions such as CAQM and related state agencies. More broadly, SmartScrape is designed for any research or governance setting where documents are fragmented across websites, formats, and individual knowledge silos.

## Statement of need

Governance and policy work often depends on documents like orders, notices, compliance reports, meeting minutes, action-taken reports, court directions, and agency submissions from various governance bodies that are across institutional websites, in their respective databases or in physical copies, which is often difficult to access and requires permissions. Likewise, online newspaper articles become unavailable after a specific period. 

Although analysts can collect and search documents manually, current workflows frequently break provenance across heterogeneous and changing sources. Existing LLM tools do not reliably support evidence-linked answers or grounded retrieval for relevant context. 

Therefore, the approach is to develop an LLM-backed tool that allows you to extract text of the required documents if in text form using their URLs or if available in PDF form, download and save them in the tool's database with LLM-generated tags for better searchability, and create a metadata schema to structure the database. SmartScrape also includes a Notebook workspace where users can interact directly with the evidence database, ask questions, and generate cited answers through grounded document retrieval. By bringing government records, agency documents, and news sources into a single searchable archive, the platform supports faster review, stronger evidence traceability, and more informed planning for future work. The Governance Workspace further enables officers and analysts to ask work-related questions, automatically surface relevant documents, receive evidence-backed answers with citations, and identify suggested follow-up actions for further review.

## Key features

### Research Impact & Evidence Integrity

- **Evidence-Backed Policy Analysis** - Centralizes fragmented governance documents, helps preserve sources that may disappear from the web, and supports reproducible analysis with cited evidence.
- **Cross-Agency Pattern Discovery** - Traces policy decisions and their consequences within an organization or across institutions; identifies timeline relationships and decision dependencies for comparative governance research.
- **Grounded AI Analysis** - Supports LLM-backed analysis grounded in retrieved source passages, with citation links for verification; reduces analyst time on manual review and categorization while keeping evidence checks visible.
- **Provenance & Auditability** - Maintains citation links to original sources; records capture metadata such as date, context, and version; enables verification and institutional knowledge preservation.
- **Institutional Continuity** - Archives ephemeral web content before it disappears; captures decision rationale and organizational context; supports longitudinal governance studies.

### Data Collection & Organization

- **URL Collector with Deduplication** - Searches, inspects, and captures web pages as text or PDF; automatic deduplication prevents redundant records during source collection.
- **Flexible Multi-Format Support** - Handles web pages, PDFs, and text uploads with unified storage and searchable archive workflows.
- **Intelligent Metadata & Tagging** - Provides deterministic tagging with a customizable taxonomy system, structured metadata extraction, optional LLM-enhanced reranking, and full-text search across documents and metadata.
- **Governance Workspace** - Maps connections across agencies, decisions, timelines, and issues; tracks authorship and policy dependencies; creates audit trails for governance decisions.

### Technical Architecture

- **Reproducible & Scalable** - Docker-based deployment with containerized frontend, backend, and AI components; production and development configurations; Prisma ORM for database migrations.
- **Extensible Taxonomy System** - Composable taxonomy structure enabling domain-specific customization for different governance contexts.
- **Notebook Environment** - Interactive analysis and briefing interface for assembling evidence-backed notes, summaries, and working drafts from the archive.

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
- Google Custom Search credentials: `GOOGLE_CSE_KEY` and `GOOGLE_CSE_CX`.
- An OpenAI API key with access to the models configured below.
- Optional for non-Docker development only: Node.js 22+, npm, Python 3.12,
  PostgreSQL 16 with pgvector, and Redis 7.

SmartScrape uses these local ports in the Docker development setup:

| Service | URL |
| --- | --- |
| Frontend | `http://localhost:3000` |
| Backend API | `http://localhost:4000` |
| Backend health check | `http://localhost:4000/health` |
| AI tagger health check | `http://localhost:7071/health` |

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
```

On macOS or Linux:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp ai-tagger/.env.example ai-tagger/.env
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

For the Docker development stack, these values are supplied by
`docker-compose.dev.yml` and can stay blank in the copied `.env` files:
`REDIS_URL`, `FILE_STORAGE_DIR`, `CHROMIUM_EXECUTABLE_PATH`,
`AI_TAG_URL_QUEUE_CONCURRENCY`, `AI_TAG_FILE_QUEUE_CONCURRENCY`, and the
`ai-tagger/.env` `PORT` and `REDIS_URL` values.

`frontend/.env` can stay blank for Docker because the development container
starts Vite on port `3000` and proxies API requests to the backend service.

### 4. Optional OpenAI Enhancement for the AI Tagger

The backend configuration above enables OpenAI for embeddings, Notebook chat,
Governance Workspace answers, search assistance, and backend LLM operations.
The Python AI tagger works without an OpenAI key. Its baseline path performs
deterministic candidate extraction, taxonomy application, ranking, and
structured-intelligence extraction. To additionally enable LLM-assisted tag
reranking and structured extraction, set the following values in
`ai-tagger/.env` (the same OpenAI API key may be used):

```env
OPENAI_API_KEY=your-openai-api-key
LLM_MODEL=gpt-4o-mini
STRUCTURED_LLM_ENABLED=true
STRUCTURED_LLM_MODEL=gpt-4o-mini
```

The containers can start with blank external credentials, which is useful for
deterministic tests and infrastructure development. That degraded mode is not
the intended SmartScrape experience: URL Collector web search requires Google,
while source embeddings, grounded Notebook answers, Governance answers, and
LLM-enhanced tag reranking require OpenAI. Baseline AI tagging remains available
without an OpenAI key in `ai-tagger/.env`.

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

Then confirm the configured integrations in the application:

1. Open URL Collector and run a small search. A missing or invalid
   `GOOGLE_CSE_KEY` / `GOOGLE_CSE_CX` will prevent results from loading.
2. Use **AI assist** in URL Collector, or add a source to Notebook and wait for
   it to become ready. A missing or invalid OpenAI configuration will prevent
   the intended LLM and embedding workflow.

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
`GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX`, `OPENAI_ENABLED=true`, and `OPENAI_API_KEY`
are present in `backend/.env`. An `OPENAI_API_KEY` in `ai-tagger/.env` is only
needed for LLM-enhanced reranking and structured extraction; deterministic AI
tagging works without it. After changing environment values, recreate the
affected containers so they receive the new configuration.

### 8. Institutional Capture Node Prototype

The `icn/` directory is a **mock/prototype integration** demonstrating how a
future institutional capture node could support authenticated or restricted
sources through a user-controlled browser session. It is not required for the
core Google + OpenAI workflow, and Docker Compose does not start an ICN service
or container. It should not be presented as a production-ready or supported
deployment feature. Its interfaces and security model may change substantially
before any production implementation.

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
GOOGLE_CSE_KEY=read-from-secret-manager
GOOGLE_CSE_CX=read-from-secret-manager
OPENAI_ENABLED=true
OPENAI_API_KEY=read-from-secret-manager
OPENAI_MODEL=gpt-5.2
GOVERNANCE_ANSWER_MODEL=gpt-5.5
GOVERNANCE_ASSIST_MODEL=gpt-5.4-mini
GOVERNANCE_DEEP_REVIEW_MODEL=gpt-5.5-pro
DEV_AUTH_ENABLED=false
```

Supply the placeholder credentials above through the deployment's
secret-management system. Optionally provide `OPENAI_API_KEY`, `LLM_MODEL`, and
`STRUCTURED_LLM_MODEL` to the AI tagger environment when LLM-enhanced tag
reranking and structured extraction are wanted. Do not commit API keys to the
repository or bake them into container images.

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
```

Then fill `POSTGRES_PASSWORD`, `DATABASE_URL`, `CORS_ORIGINS`,
`GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX`, and the backend OpenAI values described
above. The AI-tagger OpenAI values are optional enhancements. Start Docker
Desktop and run:

```powershell
docker compose -f docker-compose.dev.yml up --build
```

Open `http://localhost:3000` after the services are healthy.

## Example Workflow

After installation, use this workflow to verify the intended Google + OpenAI
research path:

1. Open `http://localhost:3000`.
2. In URL Collector, create or select a research purpose and run a Google-backed
   search for a policy or governance topic.
3. Save a relevant result to the purpose and capture the source as text or PDF
   through the saved-source workflow.
4. Confirm that the source is saved with its URL, capture metadata, and
   searchable text where extraction is available.
5. Add or review the AI-generated structured tags for the saved source.
6. Open the Notebook, attach the saved source, wait for it to become ready, and
   ask a question that requires
   an answer grounded in the uploaded evidence.
7. Confirm that the answer includes citations back to the saved source and
   inspect the cited passage before accepting the answer.
8. Open the Governance Workspace and verify that the same source can be used in
   an issue, agency, timeline, or evidence-review workflow.

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
|-- icn/                          # Mock/prototype for a possible future institutional capture integration
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
2. Create or select a research purpose, then use URL Collector to run a
   Google-backed search using keywords, website/domain filters, year filters,
   jurisdiction, region, and document format options.
3. Review the returned URLs, inspect their snippets and metadata, and save one
   or more relevant results to the active research purpose.
4. Upload a small PDF or plain-text file in the File Manager.
5. Run AI tagging on a saved URL or uploaded file. This baseline tagging path
   works without an OpenAI key in the AI tagger.
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

This smoke test assumes valid Google and backend OpenAI credentials. OpenAI-backed
Notebook chat, embeddings, and Governance analysis require the backend
`OPENAI_API_KEY`; Google-powered URL discovery requires `GOOGLE_CSE_KEY` and
`GOOGLE_CSE_CX`. The AI tagger independently supports deterministic tagging and
structured intelligence without an OpenAI key. Giving the tagger an OpenAI key
adds LLM-assisted reranking and structured extraction but is not required for
the tagger to operate.

## Development status

SmartScrape is under active development. The current repository is suitable for
local testing, research workflow evaluation, and continued development, but it
should be treated as pre-release research software until a stable public release
is tagged.

The Docker development stack, automated tests, and manual smoke-test workflow in
this README are the recommended ways to verify the current version. Interfaces,
configuration options, and data models may change between early releases.

## Contributing

Contributions, bug reports, reproducibility reports, and documentation fixes are
welcome through the GitHub issue tracker and pull requests. See
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, verification, and
evidence-safety guidance.

Use the repository's structured issue templates for bug reports, feature
requests, documentation issues, and reproducibility or JOSS-review reports.
Remove secrets, private documents, personal data, and restricted evidence before
posting public issues or pull requests.

## Citation

If you use SmartScrape in research, policy analysis, or institutional work,
please cite the repository and the corresponding software release. Citation
metadata is available in [CITATION.cff](CITATION.cff).

Suggested citation format for now:

> Boddu Sesha Venkata Sai Ranga Akhilesh et al. SmartScrape: Evidence collection
> and grounded analysis software for governance and policy workflows. GitHub
> repository: https://github.com/bsvsrakhilesh/Smart-Scrape

For archival citation, create a tagged release and archive it with a service
such as Zenodo to obtain a DOI.

## License

SmartScrape is licensed under the Apache License, Version 2.0. See
[LICENSE](LICENSE).

## Contact / support

For questions, bug reports, feature requests, or reproducibility issues, use the
GitHub issue tracker:

https://github.com/bsvsrakhilesh/Smart-Scrape/issues

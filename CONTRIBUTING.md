# Contributing to SmartScrape

Thank you for considering a contribution to SmartScrape. This guide explains how to propose changes, run the project locally, and verify work before it is reviewed.

SmartScrape is research software for evidence collection, preservation, tagging, and grounded analysis in governance and policy workflows. Contributions should preserve that purpose: make evidence easier to collect, audit, cite, search, and verify without weakening provenance, privacy, or reproducibility.

## Ways to contribute

Useful contributions include:

- bug reports with clear reproduction steps;
- documentation fixes for installation, reviewer setup, or user workflows;
- tests that cover evidence capture, metadata, tagging, retrieval, notebook, or governance behavior;
- fixes for URL normalization, file handling, ingestion, tagging, provenance, citation, or security behavior;
- usability improvements that make research workflows clearer without hiding evidence state or citation quality.

Please keep changes focused. Separate unrelated refactors, UI redesigns, dependency upgrades, and feature work into different pull requests.

## Before opening an issue

Search existing GitHub issues first:

https://github.com/bsvsrakhilesh/Smart-Scrape/issues

Use the structured issue template that best matches the report: bug,
feature request, documentation issue, or reproducibility/JOSS reviewer report.

For bug reports, include:

- the SmartScrape version, branch, or commit;
- operating system and browser;
- whether you used Docker Compose or local services;
- the exact command or workflow that failed;
- expected behavior and actual behavior;
- relevant logs with secrets removed;
- whether Google Custom Search or OpenAI credentials were configured.

Do not paste API keys, passwords, private documents, personal data, screenshots containing secrets, or restricted governance material into public issues.

## Development setup

The recommended local setup uses Docker Compose. It starts the React frontend, Express backend, backend worker, PostgreSQL with pgvector, Redis, FastAPI AI tagger, and AI tagger worker.

```powershell
git clone https://github.com/bsvsrakhilesh/Smart-Scrape.git
cd Smart-Scrape
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
Copy-Item ai-tagger\.env.example ai-tagger\.env
docker compose -f docker-compose.dev.yml up --build
```

For macOS or Linux, use `cp` instead of `Copy-Item`.

Configure `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX`, and backend OpenAI values when testing the full discovery and grounded-analysis workflow. The Python AI tagger has deterministic tagging paths that can run without an OpenAI key; its LLM reranking and structured extraction are optional enhancements.

The README contains the authoritative installation, configuration, smoke-test, and troubleshooting instructions.

## Repository map

- `frontend/`: React/Vite application, UI components, pages, hooks, API clients, and frontend tests.
- `backend/`: Express API, workers, queues, Prisma schema, services, routes, controllers, and backend tests.
- `ai-tagger/`: FastAPI/Celery tagging, extraction, OCR, taxonomy, ranking, and Python tests.
- `icn/`: prototype institutional capture node integration; not part of the core Docker Compose workflow.
- `docs/`: user manual and screenshots.
- `paper/`: JOSS paper source files.
- `e2e/`: Playwright end-to-end tests.

## Running tests

Install JavaScript dependencies before running Node-based tests:

```powershell
npm install
```

Run backend tests:

```powershell
npm -w backend test
```

Run frontend tests:

```powershell
npm -w frontend test
```

Run Python AI tagger tests outside Docker:

```powershell
cd ai-tagger
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m unittest discover -s tests
cd ..
```

Build the frontend and backend:

```powershell
npm run build
```

Run end-to-end tests only when the required services and test data are available:

```powershell
npm run test:e2e
```

Some backend database integration tests are intentionally skipped unless `SMARTSCRAPE_TEST_DATABASE_URL` points to a disposable PostgreSQL test database with migrations applied. Never point integration tests at production or irreplaceable research data.

## Manual verification

For user-facing changes, run the Docker Compose stack and perform a short smoke test:

1. Open `http://localhost:3000`.
2. Confirm `http://localhost:4000/health` and `http://localhost:7071/health`.
3. Upload a small, authorized PDF or text file in File Manager.
4. Confirm metadata, preview or download, tagging status, and provenance fields.
5. Add the source to Notebook and verify that ready sources produce cited answers when backend OpenAI is configured.
6. If changing URL Collector, run a small Google-backed search with valid test credentials and verify save/deduplication behavior.
7. If changing Governance Workspace, verify evidence retrieval before answer generation and inspect returned citations.

## Code expectations

- Prefer existing project patterns over new abstractions.
- Keep source provenance, citations, and audit metadata visible to users.
- Treat saved URLs, text captures, PDF captures, uploaded files, notebook sources, and governance evidence as distinct data types unless the code already defines a shared abstraction.
- Add or update tests for behavior that affects ingestion, capture, deduplication, metadata, tagging, retrieval, citations, permissions, or data deletion.
- Keep configuration in `.env.example` files and documentation synchronized.
- Avoid committing generated artifacts, local storage, virtual environments, `node_modules`, build output, screenshots unrelated to documentation, or secrets.

## Evidence, safety, and external services

SmartScrape may process public web pages, uploaded files, and organization-specific evidence. Contributions must respect privacy, copyright, access controls, robots rules, retention requirements, and local institutional policies.

Do not add code that bypasses authentication, captchas, access controls, network safety checks, or site restrictions. Do not log source text, prompts, API keys, credentials, personal data, or uploaded-file contents unless the log is explicitly designed for safe local debugging and is disabled by default.

LLM-backed features must keep evidence grounding explicit. Generated answers should distinguish retrieved source text from model inference and should make citation inspection possible.

## AI-assisted contributions

AI tools may be used to assist with coding or documentation, but contributors remain responsible for the submitted work. Review AI-assisted changes carefully for correctness, security, licensing, hallucinated APIs, and unsupported claims. Do not submit copied text, code, images, or data unless their license permits inclusion in this repository.

## Documentation changes

Update documentation when behavior, setup, environment variables, reviewer instructions, or workflow semantics change. The README is the primary reviewer-facing document, and `docs/SmartScrape_User_Manual.md` is the detailed user manual.

For JOSS-related changes, keep `paper/paper.md`, `paper/paper.bib`, `CITATION.cff`, README citation instructions, and release metadata consistent.

## Licensing

SmartScrape is licensed under the Apache License, Version 2.0. By submitting a contribution, you agree that your contribution may be distributed under the same license.

Include appropriate attribution for any third-party code, data, documentation, or assets that are copied into the repository. Do not vendor third-party material unless its license is compatible with Apache-2.0 and the attribution requirements are documented.

## Pull request checklist

Before requesting review, confirm that:

- the change has a clear purpose and limited scope;
- relevant tests or manual verification steps were run;
- documentation and `.env.example` files were updated if behavior or configuration changed;
- no secrets, private documents, large local files, or generated dependency folders are included;
- new copied third-party material has compatible licensing and attribution;
- user-facing changes preserve citation, provenance, and evidence-verification behavior.

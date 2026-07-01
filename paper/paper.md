---
title: 'SmartScrape: An evidence-preserving platform for governance document collection and grounded policy analysis'
tags:
  - research software
  - governance
  - policy analysis
  - web archiving
  - local source storage
  - information retrieval
  - document analysis
  - natural language processing
  - retrieval-augmented generation
  - React
  - Python
  - JavaScript
authors:
  - name: Boddu Sesha Venkata Sai Ranga Akhilesh
    affiliation: 1

  - name: Shahzad Gani
    affiliation: 1

  - name: Girish Agrawal
    affiliation: 2

  - name: Vidya Subramanian
    affiliation: 3

affiliations:
  - name: Centre for Atmospheric Sciences, Indian Institute of Technology Delhi, India
    index: 1

  - name: Transportation Research & Injury Prevention Centre, Indian Institute of Technology Delhi, India
    index: 2

  - name: Jindal School of Government and Public Policy, O.P. Jindal Global University, Sonipat, Haryana, India
    index: 3
date: 30 June 2026
bibliography: paper.bib
---

# Summary

Governance and policy research often relies on heterogeneous records distributed across institutional websites, local files, and digitised physical archives. These sources can be difficult to discover, may change or disappear, and are commonly separated from the provenance needed to verify later analysis. SmartScrape is an open-source platform that provides an integrated workflow for discovering, capturing, organising, and analysing such records while retaining their connection to the underlying evidence.

SmartScrape stores captured sources and derived text as linked, revision-aware records with provenance, structured metadata, and configurable tags. It combines full-text and optional semantic retrieval with evidence-constrained analytical workspaces: a Notebook for source-grounded questions and notes, and a Governance Workspace for reviewing agencies, issues, decisions, relationships, and timelines. Generated answers are linked to stored passages and checked against the retrieved evidence, while core collection, extraction, metadata, and deterministic tagging functions remain usable without a language-model service. Developed around the fragmented documentary landscape of air-quality governance in India, SmartScrape can be adapted to other domains through configurable taxonomies and metadata workflows. The platform is distributed under the Apache License 2.0 and is intended to support more traceable, auditable, and reproducible document-based research.

# Statement of need

Governance and policy work often depends on documents such as orders, notices, compliance reports, meeting minutes, action-taken reports, court directions, and agency submissions from various governance bodies, which are scattered across institutional websites, in their respective databases, or in physical copies, and are often difficult to access and require permissions. Web resources may become inaccessible or change over time through link rot and content drift [@klein2014reference]. The evidence is fragmented, unstable, inconsistently described, and difficult to trace back to the source after collection.

Although policy researchers, air-quality researchers and public-sector officials responsible for air-quality governance can manually collect and search documents, current workflows often break provenance across heterogeneous, evolving sources. Downloading files into folders does not consistently preserve source URLs, access dates, document relationships, metadata, or collection decisions. Such provenance information is used to assess the quality, reliability, and trustworthiness of data [@w3c2013prov]. Digitized physical records can be uploaded and enriched with structured metadata, although their original custodial and access information must be supplied by the user. Without this contextual information, other researchers cannot easily reconstruct which documents were consulted, where they came from, how they were organized, or which evidence supports an interpretation, weakening the reproducibility of the research process [@stodden2016reproducibility]. Search engines support document discovery, while reference managers help organize publications. However, neither provides an integrated workflow for preserving provenance, organizing heterogeneous governance records, and producing evidence-linked analysis. Generic LLM interfaces may summarize content, but their outputs can contain unsupported claims or incomplete citation support [@gao2023citations]. Retrieval-augmented generation provides a means of grounding generated responses in an external evidence collection and has been shown to improve factuality over a parametric-only baseline [@lewis2020rag].

Therefore, SmartScrape provides an evidence-preserving research platform for extracting text from URL-based sources and PDFs, storing source material in a local database, generating tags for improved searchability, and applying a metadata schema for structured evidence organization. It also includes a Notebook workspace where users can interact directly with the evidence database, ask questions, and generate cited answers through grounded document retrieval. By bringing government records, agency documents, and news sources into a single searchable archive, the platform supports faster review, stronger evidence traceability, and supports the review of prior decisions, discussions, and supporting evidence during current governance processes. The Governance Workspace further enables officers and analysts to ask work-related questions, automatically surface relevant documents, receive evidence-backed answers with citations, and identify suggested follow-up actions for further review.

*why air quality governance???

# State of the field

# Software design

## System architecture

SmartScrape uses a service-oriented architecture that separates the user interface, application logic, background processing, and document intelligence components. The web interface is implemented in React and TypeScript with Vite. It communicates with an Express and TypeScript application programming interface (API), which manages collections, files, notebooks, governance records, search requests, and provenance. PostgreSQL is the primary metadata store, accessed through Prisma, while the pgvector extension stores document embeddings alongside PostgreSQL full-text search vectors. Binary source artefacts are retained in a persistent local storage volume rather than embedded in the relational database.

These boundaries follow from the needs of evidence preservation and reproducible review. Retaining captured artefacts outside the live web protects the evidence collection from later link loss or content changes. At the same time, the relational data model connects each artefact to its source, revisions, processing configuration, and analytical use. PostgreSQL full-text search supports exact institutional names, order numbers, dates, and policy terms, whereas vector retrieval supports conceptually related wording across heterogeneous documents. Keeping both retrieval modes in the same evidence store permits keyword-only operation when embeddings are unavailable. Similarly, text extraction and deterministic tagging remain available independently of generated-answer services, preventing the basic collection and organisation workflow from depending entirely on an external language model.

Long-running operations are separated from interactive API requests. Redis-backed BullMQ workers perform document ingestion, embedding generation, URL and file tagging, and bulk saved-URL operations. A Python service, exposed through FastAPI and backed by Celery workers, performs text extraction, optical character recognition (OCR), tagging, and structured metadata extraction. This separation allows each stage to report its own status and errors, and enables failed background jobs to be retried without repeating the entire collection workflow. Development and production Docker Compose configurations provide the same principal service boundaries: frontend, API, backend worker, PostgreSQL with pgvector, Redis, AI tagger, and tagger worker.

A typical asynchronous request begins in the React client and is submitted to the Express API. The API validates the request, creates or updates the relevant database record, records the initial job state, and places a compact job message on a BullMQ queue. A backend worker then resolves the canonical URL, stored file, or Notebook source and executes the required ingestion, embedding, or tagging stage. For tagging, the backend worker submits the source to the FastAPI service, which delegates the CPU-intensive extraction and tagging work to Celery. Files mounted in the shared storage volume can be supplied via a restricted file path reference; other files are transferred to a temporary ingress volume. The completed result is returned to the backend worker and normalised before tags, structured metadata, hashes, status, and errors are persisted. The client obtains progress and terminal state through the API, so it does not communicate directly with Redis, PostgreSQL, or the Python workers.

PostgreSQL and the persistent artefact volume form the authoritative application state. Redis is used for job dispatch, transient progress, Celery results, and bounded tagging caches, but it is not the sole record of a captured source or completed analysis. Database records retain durable job status and connect URLs, stored files, document revisions, source revisions, chunks, extraction traces, and analytical runs. This separation prevents queue cleanup or cache expiry from deleting the evidence record. At the API boundary, request identifiers, structured input validation, upload limits, rate limits, and audit records provide operational traceability and constrain access to expensive collection and model operations.

## Evidence collection and preservation

The URL Collector organises discovery around a research purpose that can include a research question, jurisdiction, region, date range, target actors, and preferred source types. Web discovery is currently provided through the Google Custom Search API. Results are normalised to canonical URLs before storage, allowing duplicate links and repeated search results to be identified across searches and collections. A saved source can be captured as extracted text or as a PDF artefact. The capture pipeline respects `robots.txt`, supports direct retrieval of PDF files, and can use a browser-based path for dynamically rendered pages and document wrappers. Users can also upload existing PDF or text records, including digitised copies of physical documents.

SmartScrape treats a captured artifact as a revision rather than as an unversioned file. Each stored artifact is associated with a canonical document and a monotonically numbered document revision. The data model records the capture type, source URL, content hash, file hash, capture time, and the pipeline configuration used during capture. Capture events can additionally retain the initiating actor and request identifier. Subsequent extraction creates a source revision linked to the captured document revision and to the applicable pipeline configuration. This structure preserves the distinction between the original binary artifact, the text derived from it, and later analytical outputs. It also allows citations and governance records to refer to the exact document and source revisions used during an analysis.

## Text extraction and tagging

Text extraction follows the source format. Web pages are reduced to their principal textual content using document-structure and boilerplate-removal methods. Text-based PDFs are processed page by page, while optional Tesseract OCR is available for scanned PDFs and image-based records. Extraction results retain page or section locators and whether OCR was used. These locators are carried into subsequent structured metadata and evidence records so that extracted information can be checked against the stored artifact.

Tagging is designed to remain useful without an external language model. The baseline pipeline combines normalized terms, phrase and keyphrase candidates, high-signal identifiers, and a configurable YAML taxonomy. The included air-quality taxonomy covers document types, agencies, sectors, programmes, pollutants, and geographic areas relevant to the Commission for Air Quality Management and the National Capital Region. Taxonomies can be extended or replaced for another governance domain without retraining a model. When configured, an LLM can rerank the deterministic candidates and supplement rule-based structured extraction. The system records whether an LLM was used, the model identifier, the tagger version, the normalized text hash, and evidence locators for structured labels. LLM assistance therefore augments, rather than replaces, the deterministic tagging path.

## Notebook retrieval and grounded analysis

Documents added to a Notebook are ingested as versioned sources. Extracted text is divided into overlapping, paragraph-aware chunks, and each chunk retains its source revision, position in the document, page range where available, and character offsets. PostgreSQL stores both a full-text search representation and an optional 1,536-dimensional embedding for each chunk. Notebook retrieval combines PostgreSQL full-text ranking with cosine-distance vector retrieval; if embeddings are unavailable, keyword retrieval remains available. The retrieved passages may be reranked before a selected evidence set is supplied to the language model.

Notebook answers use stored passages as the evidence boundary. Generated citations must identify an allowed chunk and include a quotation that occurs verbatim in that chunk. Citations that do not pass this check are removed, and the grounding report distinguishes supported and unsupported claims. Each chat run records the prompt version, answer mode, model, candidate and final chunk identifiers, source and document revision identifiers, pipeline configuration identifiers, citations, grounding status, and latency. Notes created from an answer can retain the same citation bundle. These records make it possible to reconstruct which version of each source supported a particular analytical output, even if the live webpage later changes.

## Governance representation and review

The Governance Workspace adds a domain model above the document collection. It represents agencies, governance issues or case files, mandates, claims, dated events, actor positions, governance gaps, document relationships, timeline entries, and evidence clusters. Extracted objects are connected to an `ExtractionTrace` containing the source document, document and source revisions, relevant chunks or pages, evidence text, pipeline configuration, extraction method, and confidence where available. The graph therefore remains linked to documentary evidence rather than becoming a separate set of unsupported entities.

Evidence retrieval in the Governance Workspace combines metadata, graph relationships, keyword-ranked chunks, and semantic chunk retrieval. Candidate ranking considers textual relevance together with source authority, temporal relevance, retrieval coverage, and evidence diversity. Different review modes support broad landscape mapping, case-oriented chronology, and question-focused evidence review. Before an answer is returned, its citations are checked against the permitted evidence cards and their quoted text. If no factual claim passes citation validation, the workspace returns an unsupported result and asks the analyst to broaden or inspect the evidence instead of presenting an uncited answer. Suggested follow-up actions are consequently framed as tasks for further review, not as facts established by the archive.

## Configuration and extensibility

The current implementation uses external services selectively. Google Custom Search credentials are required for web discovery, and OpenAI credentials are required for the configured embedding and generated-answer workflows. In contrast, local uploads, source storage, metadata management, full-text indexing, OCR, and baseline deterministic tagging can operate without an OpenAI key. Model names, embedding dimensions, queue concurrency, extraction limits, OCR settings, and retrieval thresholds are supplied through environment configuration. Pipeline configurations are hashed and stored with capture and extraction records, providing a record of operational settings that may affect derived evidence. The service boundaries keep provider-dependent search and model operations separate from the canonical document and provenance model, although the current discovery, embedding, and generated-answer implementations target Google and OpenAI services.

# Research impact statement

# AI usage disclosure

Generative AI tools, including ChatGPT and Codex, were used to assist with code implementation, debugging and refactoring. The research idea, software architecture, workflow logic, software requirements, input-output design, validation strategy, and final implementation decisions were defined by the human author.

All AI-assisted code and documentation were reviewed, edited, tested, and validated by the author. The author accepts full responsibility for the correctness, originality, licensing compliance, and maintainability of the submitted software and manuscript.

# Acknowledgements

# References

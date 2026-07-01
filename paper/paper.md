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

Existing software for document-based research addresses distinct stages of the evidence lifecycle including reference managers collect and organise research materials; web-archiving systems preserve online content; qualitative analysis tools support coding and interpretation; and retrieval frameworks enable semantic search and retrieval-augmented generation. SmartScrape brings these functions together within a unified, provenance-aware workflow for governance-document research.

Zotero is a mature reference manager that can capture bibliographic metadata, webpages, and local snapshots; attach files and notes; support user-assigned and metadata-imported tags; detect duplicates; and search metadata and full text [@zotero2026]. It is therefore substantially more capable than a simple citation store and can support many document-collection workflows. Its organising model, however, is centred on bibliographic items, attachments, collections, and user-managed relationships. ArchiveBox addresses a different requirement: self-hosted preservation of web content in durable formats including HTML, PDF, screenshots, text, and WARC [@archivebox2026]. SmartScrape unifies selected functions from both categories within a version-aware evidence model. It canonicalises and deduplicates discovered URLs, captures web sources as extracted text or PDF, stores captured and uploaded artefacts locally, and records source URLs, hashes, capture events, document revisions, and processing configurations. It further enriches these sources with deterministic, taxonomy-based structured tags and supporting evidence locators, with optional LLM-assisted reranking. This design keeps preservation records, organisational metadata, and searchable derived information connected to the same captured source.

For qualitative analysis, Taguette provides an open-source environment for importing documents, highlighting passages, and applying researcher-defined codes and notes [@rampin2021taguette]. SmartScrape does not replace this close, researcher-led approach to coding. Instead, it applies configurable governance taxonomies to captured and uploaded sources, records provenance for structured tags, and makes processed content available for full-text and semantic retrieval. SmartScrape automates document extraction, tagging, and indexing while allowing analysts to review source tags and verify document-level analyses.

Haystack provides modular document stores, sparse and dense retrievers, generators, and pipelines for building semantic-search and retrieval-augmented applications [@haystack2026]. SmartScrape uses similar keyword- and embedding-based retrieval methods but integrates them into an end-user workflow for governance research. Retrieved passages remain linked to specific document and source revisions, citations are validated against the permitted evidence, and governance entities and timelines use the same provenance model. SmartScrape therefore differs from Haystack not through a new retrieval method, but by combining retrieval with source capture, revision tracking, governance-specific data structures, and evidence validation.

SmartScrape was developed as a standalone platform rather than as an extension of an existing system. Its main contribution is not a new archival format, qualitative-coding method, or retrieval algorithm. Instead, it provides a governance-oriented provenance model that links source discovery, captured materials, revisions, processing settings, structured governance entities, retrieved passages, and citation-verified outputs. Integrating this model into an adjacent tool would require substantial changes to that tool’s core design, while connecting multiple tools would require identifiers and provenance to be synchronised across separate data stores. SmartScrape keeps these stages within a unified evidence model and adds workflows and taxonomies for air-quality governance research. It is intended to complement, rather than replace, specialised archival, reference-management, and information-retrieval systems.

# Software design

## System architecture

SmartScrape uses a service-oriented architecture with four principal layers. A React and TypeScript interface supports source collection, evidence management, notebooks, and governance review. An Express and TypeScript application programming interface (API) implements the application and provenance rules. PostgreSQL, accessed through Prisma, stores metadata, document lineage, full-text search vectors, governance relationships, and pgvector embeddings, while a persistent local volume stores the captured binary artefacts. Redis-backed BullMQ workers handle ingestion, embeddings, tagging, and bulk operations. A separate Python service, exposed through FastAPI and backed by Celery, performs text extraction, optical character recognition (OCR), deterministic tagging, and optional model-assisted processing.

This separation was chosen because document capture, OCR, embedding, and language-model requests are slower and more failure-prone than ordinary metadata operations. The API records durable job state before dispatching work, and workers report progress and terminal status back to PostgreSQL. Redis carries transient queue, progress, result, and cache data, but it is not the authoritative record of a source or analysis. Compared with a monolithic synchronous application, this design introduces additional deployment and queue-management complexity; in return, expensive stages can be retried or scaled independently without blocking source browsing or repeating the complete collection workflow.

PostgreSQL was also chosen as the common store for relational metadata, full-text search, vector search, and governance relationships. Separate search, vector, and graph databases could offer more specialised scaling, but would require evidence identifiers and revision state to be synchronised across systems. Keeping these structures together makes it simpler to connect a retrieved passage or governance claim to the exact captured revision and processing configuration from which it was derived. The persistent artefact volume and PostgreSQL database therefore form the authoritative evidence store, while provider-dependent search and model operations remain outside the canonical evidence model.

## Evidence collection and preservation

The URL Collector organises discovery around a research purpose containing a question and optional jurisdictional, temporal, actor, and source constraints. Google Custom Search currently supplies web results, which are canonicalised before storage to identify repeated links across searches and collections. Saved pages can be captured as extracted text or PDF artefacts. Capture respects `robots.txt`, attempts direct PDF retrieval, and can use browser rendering for dynamic pages or document wrappers. Existing PDF and text records, including digitised physical records, can be uploaded directly.

Preservation is revision-based rather than link-based. Every captured artefact is associated with a canonical document and a numbered document revision. Capture records include the capture type, source URL, timestamps, cryptographic hashes, actor and request information where available, and a hashed pipeline configuration. A subsequent text extraction creates a source revision linked to the captured document revision. This deliberately separates the original bytes, derived text, and later analytical products. Local volume storage was preferred to a required cloud object store so that a research group can inspect and retain its own evidence collection; the trade-off is that multi-node storage and backup policies remain deployment responsibilities rather than application-managed services.

## Text extraction and tagging

Extraction follows the source format. Web pages are reduced to their principal text using document-structure and boilerplate-removal methods. Text PDFs are processed page by page, while optional Tesseract OCR handles scanned PDFs and image-based records. Extraction outputs retain page or section locators and whether OCR was used; later tags and evidence records reuse these locators so that a user can inspect the corresponding part of the stored artefact.

The baseline tagger combines normalised terms, phrase and keyphrase candidates, high-signal identifiers, and a configurable YAML taxonomy. The supplied air-quality taxonomy covers document types, agencies, sectors, programmes, pollutants, and geography relevant to the Commission for Air Quality Management and the National Capital Region. This deterministic path is less flexible than unconstrained LLM classification, but it is repeatable, inspectable, and available without model credentials. When enabled, an LLM reranks deterministic candidates and supplements structured extraction rather than replacing the baseline. The stored result records the tagger version, text hash, model identifier and usage status, and supporting locators, making model-assisted outputs distinguishable from rule-derived metadata.

## Notebook retrieval and grounded analysis

Notebook sources are ingested as revisions and divided into overlapping, paragraph-aware chunks. Each chunk retains its source revision, document position, page range where available, and character offsets. PostgreSQL stores a full-text search representation and an optional 1,536-dimensional embedding for each chunk. Retrieval combines full-text ranking, which is effective for order numbers, agency names, and exact policy language, with cosine-distance vector search, which can recover conceptually related wording. Maintaining both indexes costs additional storage and processing, but avoids the weaknesses of either method alone and preserves keyword-only operation when embeddings are unavailable.

Only selected stored passages are supplied as evidence to the language model. A generated citation must identify an allowed passage and contain text that can be matched back to that passage; invalid citations are removed, and a grounding report separates supported from unsupported claims. Each chat run records its prompt version, model, candidate and final chunks, source and document revisions, pipeline configurations, citations, grounding status, and latency. This validates textual traceability, not the correctness of an interpretation, so the interface keeps cited passages available for human inspection rather than treating citation validation as a substitute for review.

## Governance representation and review

The Governance Workspace represents agencies, issues or case files, mandates, claims, events, actor positions, governance gaps, document relationships, timelines, and evidence clusters. These graph-like relationships are stored relationally rather than in a separate graph database so that they share the same revision and provenance constraints as the document collection. Extracted mandates, claims, events, positions, gaps, relations, and timeline entries are linked through an `ExtractionTrace` to their document and source revisions, supporting chunks or pages, evidence text, pipeline configuration, extraction method, and confidence where available. The trade-off is that graph traversal requires application-level query logic, but provenance remains explicit within the same evidence model.

Governance retrieval combines metadata, these structured relationships, keyword-ranked passages, and semantic passage retrieval. Ranking considers textual relevance, source authority, time, retrieval coverage, and evidence diversity. Review modes support broad landscape mapping, case chronology, and question-focused evidence review. Citations are validated against the permitted evidence set before an answer is returned. If no factual claim passes validation, the workspace returns an unsupported result and directs the analyst to inspect or broaden the evidence. Suggested follow-up actions are therefore presented as review tasks rather than conclusions established by the archive.

## Configuration and extensibility

Development and production Docker Compose configurations reproduce the same service boundaries. Google credentials are required for web discovery, and OpenAI credentials are required for the configured embeddings and generated-answer workflows. Local uploads, source preservation, metadata management, full-text indexing, OCR, and deterministic tagging remain available without an OpenAI key. Model names, embedding dimensions, queue concurrency, OCR settings, extraction limits, and retrieval thresholds are environment-configured, while pipeline configurations are hashed and attached to derived records. This degraded-operation design adds multiple execution paths to test, but prevents external model availability from becoming a prerequisite for preserving and organising evidence.

# Research impact statement

# AI usage disclosure

Generative AI tools, including ChatGPT and Codex, were used to assist with code implementation, debugging and refactoring. The research idea, software architecture, workflow logic, software requirements, input-output design, validation strategy, and final implementation decisions were defined by the human author.

All AI-assisted code and documentation were reviewed, edited, tested, and validated by the author. The author accepts full responsibility for the correctness, originality, licensing compliance, and maintainability of the submitted software and manuscript.

# Acknowledgements

# References

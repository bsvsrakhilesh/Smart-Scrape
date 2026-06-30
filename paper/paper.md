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

SmartScrape is an open source research platform for collecting, preserving, organizing, and analyzing web-based and uploaded documents used in governance and policy work. It combines web discovery, source capture, local evidence storage, structured metadata, deterministic and optional LLM-assisted tagging, and grounded notebook-style analysis so that analysts can build searchable, citation-backed evidence collections. The software is distributed under the Apache License 2.0 and is designed to support reproducible review of fragmented governance documents, with air-quality governance workflows as the motivating use case.

# Statement of need

Governance and policy work often depends on documents like orders, notices, compliance reports, meeting minutes, action-taken reports, court directions, and agency submissions from various governance bodies that are across institutional websites, in their respective databases or in physical copies, which is often difficult to access and requires permissions. Likewise, online newspaper articles become unavailable after a specific period. 

Although analysts can collect and search documents manually, current workflows frequently break provenance across heterogeneous and changing sources. Existing LLM tools do not reliably support evidence-linked answers or grounded retrieval for relevant context. 

Therefore, the approach is to develop an LLM-backed tool that allows you to extract text of the required documents if in text form using their URLs or if available in PDF form, download and save them in the tool's database with LLM-generated tags for better searchability, and create a metadata schema to structure the database. SmartScrape also includes a Notebook workspace where users can interact directly with the evidence database, ask questions, and generate cited answers through grounded document retrieval. By bringing government records, agency documents, and news sources into a single searchable archive, the platform supports faster review, stronger evidence traceability, and more informed planning for future work. The Governance Workspace further enables officers and analysts to ask work-related questions, automatically surface relevant documents, receive evidence-backed answers with citations, and identify suggested follow-up actions for further review.

# State of the field

# Software design

# Research impact statement

# AI usage disclosure

Generative AI tools, including ChatGPT and Codex, were used to assist with code implementation, debugging and refactoring. The research idea, software architecture, workflow logic, software requirements, input-output design, validation strategy, and final implementation decisions were defined by the human author.

All AI-assisted code and documentation were reviewed, edited, tested, and validated by the author. The author accepts full responsibility for the correctness, originality, licensing compliance, and maintainability of the submitted software and manuscript.

# Acknowledgements

# References

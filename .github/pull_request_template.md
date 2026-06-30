## Summary

Describe the change and the user or reviewer problem it addresses.

## Scope

- [ ] Frontend
- [ ] Backend API
- [ ] Workers/queues
- [ ] AI tagger
- [ ] Database/Prisma
- [ ] Documentation
- [ ] JOSS/release metadata
- [ ] Tests/CI

## Verification

Check every command or workflow that was run:

- [ ] `npm -w backend test`
- [ ] `npm -w frontend test`
- [ ] `python -m unittest discover -s tests` from `ai-tagger/`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] Docker Compose smoke test
- [ ] Manual verification described below
- [ ] Not run; reason below

Manual verification notes:

```text

```

## Evidence, provenance, and safety

- [ ] Source provenance, citation links, audit metadata, and evidence-verification behavior are preserved or improved.
- [ ] The change does not log secrets, source text, prompts, private documents, personal data, cookies, or API keys.
- [ ] The change does not bypass robots rules, authentication, captchas, SSRF protections, or access controls.
- [ ] User-facing AI output remains grounded in retrievable evidence where the workflow requires grounded answers.
- [ ] Not applicable.

## Configuration and documentation

- [ ] README, user manual, `.env.example`, or contributor docs were updated where needed.
- [ ] New environment variables have safe defaults and are documented.
- [ ] Database migrations are included and reversible by normal Prisma migration flow where applicable.
- [ ] No generated files, local storage, virtual environments, `node_modules`, or secrets are included.

## Licensing

- [ ] New copied third-party code, data, documents, or assets have compatible licenses and attribution.
- [ ] No new copied third-party material is included.

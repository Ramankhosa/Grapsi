# Source Watch: cost and storage estimate for 5,000 monitored URLs

Prepared 24 October 2026. All costs are USD, before tax. This is a scenario estimate using explicit assumptions and checked public tariffs, not measured production usage or a provider quotation.

## Planning recommendation

- Allow **$40–60/month** for a separate worker plus the model/storage workload described below, while reusing the application's existing database. A larger managed database, paid proxy/browser services, engineering, and human review are additional.
- If existing compute and database capacity are sufficient, allow approximately **$5–20/month of incremental model/storage/backup spending** under the GLM-based scenarios below. Existing hosting remains a separate expense.
- One base copy of 5,000 pages is about **250 MB of readable text**, or **1.75 GB including HTML and text**, at the assumed page sizes.
- Allocate **20–30 GB of live crawler data initially**, or **40–60 GB including one independent full backup**, for a typical mixture of history, PDFs, and database metadata. This is an initial allocation, not a permanent ceiling.

These figures assume 5,000 effective monitored resources. Five thousand seed URLs expanded into whole websites can produce a much larger resource inventory; see the scope section below.

## Model prices used

Standard uncached API rates per million tokens; no free inference tier or provider batch discount is assumed.

| Model/reference | Input | Output | Use in this estimate |
|---|---:|---:|---|
| GLM-5.3-Flash | $0.15 | $0.50 | Compact relevance review and core text extraction |
| Gemini 3 Flash Preview | $0.50 | $3.00 | Selected scanned-PDF transcription |
| Gemini Embedding 2 text rate | $0.20 | — | Conservative reference allowance for embedding costs |
| Claude Haiku 4.5 | $1.00 | $5.00 | Alternative-model sensitivity comparison |

Sources: [Z.ai pricing](https://docs.z.ai/guides/overview/pricing), [Google API pricing](https://ai.google.dev/gemini-api/docs/pricing), and [Claude Haiku 4.5 pricing](https://platform.claude.com/docs/en/models/haiku-4-5/overview).

The new review stage has not been assigned a model by the plan; GLM is a costing assumption. The embedding reference is also an estimate rather than a proposal to replace the existing embedding index. Existing stored vectors must retain a compatible model/dimension configuration.

Important provider qualification: the repository's Zhipu client defaults to the BigModel endpoint unless configured otherwise (`src/lib/metering/providers/zhipu-provider.ts:57`). This report uses Z.ai's public USD tariff; confirm the actual account/endpoint's prices before setting the production budget. It does not inspect live account settings or keys.

## Workload assumptions

| Input | Assumption |
|---|---:|
| Unique monitored URLs | 5,000 |
| Checks per URL | Once daily |
| Month length | 30 days |
| Main source checks | 150,000/month |
| Changed-page rate | Quiet 1%, typical 5%, busy 15% of checks |
| Candidate items per changed page | 2 |
| Items reaching model review after deterministic filtering/dedup/cache | 20% |
| Reviewed items needing core extraction | 20% |
| Extractions needing selected scanned-document transcription | 10% |
| Browser use for worker sizing | Approximately 10% of main pages, bounded concurrency |
| Extra paid-attempt allowance | 20% of calculated model subtotal |

These are independent, adjustable workload assumptions. They are not measured funding-site statistics and do not predict how many real grants exist. “Extraction” includes new-call drafts and update proposals, rather than promising that every job is a new distinct opportunity. Multiple documents, more items per listing, poor filters, or broad discovery increase the workload.

Per-operation token assumptions include amortized prompts and billable output, including reasoning within the assumed allowance:

| Operation | Input tokens | Output tokens |
|---|---:|---:|
| Compact item review | 500 | 200 |
| Core extraction from a bounded evidence bundle | 8,000 | 3,000 |
| Selected scanned PDF, approximately five pages | 3,000 equivalent billable input tokens | 4,000 |
| Embedding per reviewed item | 500 | 0 |

PDF equivalent input tokens are a planning allowance, not a byte-to-token conversion. Actual document/image resolution, transcription length, and reasoning can change usage. Core extraction includes the text produced by transcription, so both transcription and subsequent fact extraction are charged. Readable PDFs are parsed locally. Embedding a longer final call representation would add a small further cost and must be measured. Output caps and retries must actually be enforced for these assumptions to hold.

## Monthly model estimate

| Scenario | Changed-page events | Reviewed items | Extraction jobs | Scanned PDFs | Models + embeddings + 20% allowance |
|---|---:|---:|---:|---:|---:|
| Quiet | 1,500 | 600 | 120 | 12 | $0.78 |
| Typical | 7,500 | 3,000 | 600 | 60 | $3.91 |
| Busy | 22,500 | 9,000 | 1,800 | 180 | $11.72 |

Typical arithmetic:

`150,000 checks × 5% changed × 2 items × 20% sent to review = 3,000 reviewed items`

`3,000 × 20% needing extraction = 600 extraction jobs`

| Typical component | Cost |
|---|---:|
| GLM review: 1.5M input + 0.6M output tokens | $0.525 |
| GLM extraction: 4.8M input + 1.8M output tokens | $1.620 |
| Gemini transcription: 0.18M input + 0.24M output tokens | $0.810 |
| Embeddings: 1.5M input tokens at reference rate | $0.300 |
| Subtotal | $3.255 |
| 20% additional-attempt allowance | $0.651 |
| Total | $3.906 |

The small model bill depends on skipping unchanged evidence and restricting expensive processing to selected candidates. It is not a prediction that 150,000 full pages can be processed for $4. At the same extraction token sizes, running GLM extraction on all 150,000 checks costs **$405/month for core extraction alone**; using Haiku 4.5 for those extractions costs **$3,450/month**, before OCR or retries.

### Model-choice sensitivity for the same typical workload

Gemini transcription and the embedding allowance remain the same in every row.

| Review + text-extraction models | Monthly model total, including 20% allowance |
|---|---:|
| GLM + GLM | $3.91 |
| Haiku 4.5 + GLM | $8.68 |
| Gemini 3 Flash + Gemini 3 Flash | $13.75 |
| Haiku 4.5 + Haiku 4.5 | $23.29 |

This compares cost, not quality. A representative extraction benchmark is needed before choosing the production model. More expensive fallbacks or larger evidence/output volumes are not necessarily covered by a flat 20% allowance.

## First-run bootstrap

An intentionally conservative bootstrap reviews all 5,000 items once, then extracts selected items:

| Bootstrap scope | One-time model estimate |
|---|---:|
| Review 5,000, extract 1,000, transcribe 100 scanned PDFs | $6.51 |
| Review 5,000, extract all 5,000, transcribe 500 scanned PDFs | $25.95 |

Both include embeddings and the 20% allowance. Allow approximately **$10–30 extra for this example bootstrap**. This is additional to steady-state monitoring and can be lower when existing catalog facts and cached results are reusable. It can be much higher if the 5,000 URLs open into a larger inventory or documents are longer than assumed.

## Base content and retained storage

All sizes use decimal units: KB = 1,000 bytes; GB = 1,000,000,000 bytes. These are assumed average sizes, not measured sizes or guaranteed compression ratios.

| Content | Assumed average | Storage for 5,000 |
|---|---:|---:|
| One readable-text base copy | 50 KB/page | 250 MB |
| One raw HTML base copy | 300 KB/page | 1.50 GB |
| Both HTML and readable text | 350 KB/page | 1.75 GB |
| Both, retaining 3 versions per page | 1.05 MB/page | 5.25 GB |
| Both, retaining 5 versions per page | 1.75 MB/page | 8.75 GB |
| One 2 MB PDF for 20% of URLs | 1,000 documents | 2.00 GB |
| One 2 MB PDF for every URL | 5,000 documents | 10.00 GB |

These rows are alternatives/components; the one-copy page rows should not be added again to the multi-version totals. They exclude images, video, browser profiles, and screenshots. Compression may reduce HTML/text storage, but this estimate does not rely on a promised reduction.

An initial typical live-data allocation could contain **8.75 GB of page versions + 2 GB PDFs + 1–3 GB metadata/indexes/recent task history = approximately 12–14 GB**. Reserving 20–30 GB gives headroom. The metadata allowance assumes bounded queue/log retention, such as 90 days of detailed check runs with older aggregates; it excludes a second copy of every content blob inside JSON task payloads. Actual PostgreSQL table/index/backup sizes need measurement.

If every URL has one PDF, the same page-history/metadata scenario is approximately 20–22 GB before PDF revisions. Several retained PDF revisions can push it above 30 GB; allocate 50 GB or more for that heavier case. Reviewed/pinned evidence must be included explicitly in the retention policy.

Do not retain a new body snapshot for every unchanged check. Saving all 5,000 HTML/text pages daily would write **52.5 GB/month** before documents, indexes, or backups. Save unique versions and keep lightweight check records for unchanged/304 responses.

At the typical assumed 5% daily change rate, first-month page bodies would be about **4.375 GB** before pruning/compression: the 1.75 GB baseline plus 7,500 changed-page bodies at 350 KB each. The 5-version figure is a longer-term capacity envelope rather than a claim that every page changes five times in month one.

If 600 extracted items per month each introduce a new 2 MB PDF and a new 350 KB detail page, additional retained bodies grow by about **1.41 GB/month**, plus facts/evidence/indexes. Updates to already stored documents and content dedup reduce that; more attachments increase it. Storage capacity must be reviewed over time.

## Hosting and storage charges

- A reference dedicated worker is DigitalOcean's regular **2-vCPU/4-GiB VM at $24/month**, with 80 GiB SSD and 4,000 GiB transfer. An **8-GiB/4-vCPU VM is $48/month**. These are starting capacity options, not a benchmark that either guarantees every site's latency. Browser-heavy runs may require the larger option. [DigitalOcean pricing](https://www.digitalocean.com/pricing/droplets).
- Store large raw content/PDFs in compressed files or object storage, and store structured facts, associations, hashes, and evidence references in PostgreSQL. Avoid duplicating full files in tasks, opportunities, and cache records.
- As a reference, Cloudflare R2 Standard is **$0.015/GB-month**, with **10 GB-month free**, plus operation allowances. At a steady 60 GB, storage-only charges are about **$0.75/month after that allowance**, provided it remains available to this account. Operations, rounding, and other account usage can change the bill. Database compute/storage/replication is a different cost. [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/).
- Main checks returning a full 300 KB body every time transfer about **45 GB/month**. Successful conditional requests reduce body traffic, while Chromium assets, discovery, attachments, and retries add traffic. The reference VM's bundled transfer is ample for that simple body-only estimate; a measured crawl is needed for full-site/browser traffic.

The $40–60 planning budget gives margin around the worker and GLM-based workload. It assumes existing application/database hosting is retained and has room, and direct HTTP/Chromium execution is used rather than purchased crawling/proxy services. It excludes engineering, human approval work, taxes, foreign-exchange fees, and a separate managed PostgreSQL plan.

## If the 5,000 URLs are whole-site seeds

Count effective monitored resources after deduplication and discovery, not seed links. Several call URLs can share a single funder host and collapse into a few listing/feed watch points; one seed can also reveal thousands of pages. Monitor relevant listing/feed surfaces daily, revisit call detail resources selectively, and explore the frontier on its own budget.

For illustration, expanding from 5,000 to **50,000 similar page resources** makes one HTML/text base copy about **17.5 GB**, and a five-version envelope about **87.5 GB**, before PDFs or metadata. If that larger inventory is checked daily with the same candidate/change fractions, the typical model arithmetic scales from $3.91 to approximately **$39.06/month**; network/worker capacity and storage also need resizing. This is proportional scenario arithmetic, not a forecast of website expansion. Enforced budgets would limit spending by deferring work and increasing backlog.

## Measurements to replace the assumptions

Run a 7–14 day representative pilot spanning static listings, JavaScript pages, feeds, opaque anchors, and PDF-heavy sources. Record actual fetched/body bytes, semantic change rate, candidates per changed page, filter pass rate, unique extraction/update rate, tokens including reasoning, retry charges, PDF sizes/pages, Chromium peak memory, and database/index growth. Apply quotas and compare those measurements with this report before activating all sources.

Implementation accounting note: `LLMModel.inputCostPer1M` and `outputCostPer1M` are stored in **cents** in this repository. Existing cost code divides by 100 before computing USD (`src/lib/metering/cost-calculator.ts:86`). New micro-USD reservations must use the same conversion; directly treating those values as dollars would inflate estimates by 100×.

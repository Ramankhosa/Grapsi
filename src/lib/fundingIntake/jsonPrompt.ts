export const FUNDING_JSON_UPLOAD_CHATGPT_PROMPT = `You are extracting structured data for Grapsi's funding intake system.

Task:
Read the funding call text, application template instructions, and guideline/rule text I provide. Return one strict JSON object only. Do not wrap it in markdown.

Extraction objective:
This JSON will create the stored funding-call record, its semantic embedding, and chatbot search/filter facets. Capture not only the call title and deadline, but also the funder's research themes, eligible problem domains, applicant fit, geography, budget/duration constraints, deliverables, exclusions, and reviewer priorities. Keep everything source-grounded; use null or [] when unsupported.

Output JSON shape:
{
  "schema_version": "funding_intake_json_v1",
  "source_text": "optional clean plain text copy of the source, if available",
  "call": {
    "fields": {
      "agency_name": "string or null",
      "scheme_title": "string or null",
      "description": "source-grounded searchable call summary string or null",
      "open_date": "YYYY-MM-DD or null",
      "close_date": "YYYY-MM-DD or null",
      "is_rolling": true,
      "geography_scope": "National|Regional|International|Global or null",
      "eligible_countries": ["country names"],
      "eligible_regions": ["region names"],
      "host_countries": ["country names"],
      "funder_country": "country name or null",
      "funding_kinds": ["Research Grant|Fellowship|Travel Grant|Infrastructure|Equipment Grant|Seed Grant|Training Grant|Mobility Grant|Conference Grant|Scholarship"],
      "institution_types": ["eligible organisation types"],
      "career_stages": ["career stages"],
      "citizenship_requirements": ["citizenship rules"],
      "residency_requirements": ["residency rules"],
      "application_languages": ["languages"],
      "disciplines": ["research areas, disciplines, themes, technologies, sectors, or challenge areas"],
      "amount_min": 0,
      "amount_max": 0,
      "currency": "ISO currency code or symbol text",
      "project_duration_min_months": 0,
      "project_duration_max_months": 0,
      "project_duration_text": "string or null",
      "eligibility_text": "string or null",
      "expected_deliverables_text": "string or null",
      "official_urls": ["official source URLs"],
      "contact_info": "string or null",
      "sponsor_type": "Government|Foundation|Corporate|Multilateral|University|NGO|Philanthropic or null"
    },
    "warnings": []
  },
  "template": {
    "grant_template_json": {
      "questions": [],
      "sections": [],
      "budget": null,
      "attachments": [],
      "evaluationCriteria": [],
      "submissionRules": { "notes": null, "items": [], "sourceAnchors": [] },
      "sourceAnchors": [],
      "mergeConflicts": []
    }
  },
  "guidelines": {
    "guideline_pack_json": {
      "priorities": [],
      "mustAddress": [],
      "avoid": [],
      "evaluationCriteria": [],
      "budgetRules": [],
      "durationRules": [],
      "formatRules": [],
      "submissionRules": [],
      "deliverableRules": [],
      "reviewerSignals": [],
      "sourceAnchors": []
    }
  }
}

Template item rules:
- Put narrative application sections in "sections" and discrete fillable fields in "questions".
- Item type must be one of: field, section, table, budget, attachment, checklist, rule, rubric.
- workflowMode must be one of: app_draft, app_support, team_manual.
- Set the top-level budget workflowMode to app_draft. The app generates budget rows through its structured budget drafting stage.
- templateIntent must be one of: summary, problem_need, objectives, methodology, workplan, innovation, evaluation, impact_outcomes, alignment, sustainability, risk, team, budget, eligibility, submission, attachments, institutional, default.
- For every response-bearing item, include requiredFacts: [], reviewerGoal: null, forbiddenMoves: [], and draftingVsSubmission: "drafting"|"submission"|"both" when supported by the source.
- requiredFacts should list short atomic content elements the applicant must provide. reviewerGoal should state what a reviewer should be convinced of. forbiddenMoves should capture explicit do-not instructions, exclusions, or unsupported-claim risks.
- Use draftingVsSubmission="drafting" for proposal narrative, "submission" for uploads/declarations/admin-only fields, and "both" for items that shape narrative and final compliance.
- Use stable snake_case keys. Include wordLimit or charLimit when stated. Keep sourceAnchors as [].

Guideline rule rules:
- Each rule item must have key, text, importance, confidence, and sourceAnchors: [].
- importance must be high, medium, or low.
- Split separate obligations into separate rule items.
- Put funder priorities in priorities, required content in mustAddress, prohibitions in avoid, scoring/rubric in evaluationCriteria, budget restrictions in budgetRules, duration/timeline limits in durationRules, formatting limits in formatRules, submission/admin requirements in submissionRules, outputs/reporting in deliverableRules, and reviewer preference signals in reviewerSignals.
- Capture mission themes, required research/problem framing, beneficiary/community expectations, technology transfer/adoption expectations, and explicit exclusions as guideline rules when the source states them.
- When clear, also include ruleClass, enforcementLevel, appliesTo, draftingStage, draftingVsSubmission, and detectorHints for each rule. Allowed ruleClass values: priority, must_address, avoid, evaluation, budget, duration, format, submission, deliverable, reviewer_signal, other. Allowed enforcementLevel values: hard, soft, info.
- Use enforcementLevel="hard" for mandatory requirements, prohibitions, eligibility constraints, budget/duration caps, deadlines, page/word/format limits, and submission obligations. Use "soft" for priorities and reviewer preferences.
- Use draftingVsSubmission="drafting" for narrative rules, "submission" for portal/upload/admin rules, and "both" for rules affecting both writing and compliance.
- appliesTo should use section semantics such as summary, problem_need, objectives, methodology, workplan, innovation, evaluation, impact_outcomes, alignment, sustainability, risk, team, budget, eligibility, submission, attachments, institutional, or all.
- draftingStage should use grant-prep stages such as problem_definition, root_cause, beneficiaries, fit_and_scope, thrust_alignment, methodology, workplan, team_and_partnerships, innovation, evaluation, outcomes, risk_and_ethics, budget_strategy, sustainability_and_scale, or final_pitch.

Call field rules:
- Use null or [] when unsupported. Do not invent dates, amounts, eligibility, or contacts.
- Dates must be exact YYYY-MM-DD when explicitly stated.
- Amounts must be numbers only; put currency separately.
- Keep description factual, source-grounded, and useful for semantic search. Aim for 80-180 words when enough source material exists. Cover the call purpose, supported research/problem areas, eligible applicants or beneficiaries, eligible geography, funded activities, and expected outcomes/impact when stated.
- Treat disciplines as the main research-area/search tags. Return 3-12 concise tags when supported, including both broad domains and specific explicit themes such as "digital health", "climate adaptation", "tribal livelihoods", "AI for agriculture", or "materials for energy". Do not include funder names, deadlines, countries, application mechanics, or unsupported synonyms as disciplines.
- Extract filter-critical fields separately instead of burying them only in description: funding_kinds, institution_types, career_stages, eligible_countries, eligible_regions, host_countries, funder_country, sponsor_type, citizenship_requirements, residency_requirements, and application_languages.
- eligibility_text should summarize applicant, institution, PI, host, consortium, citizenship/residency, and exclusion rules that affect fit.
- expected_deliverables_text should summarize outputs, milestones, reports, dissemination, adoption, commercialization, impact, or beneficiary expectations when stated.
- Convert exact year/month/day duration ranges to project_duration_min_months and project_duration_max_months only when unambiguous; otherwise preserve the wording in project_duration_text and leave numeric duration fields null.
- official_urls should include only official call, guideline, application portal, or funder URLs visible in the source.
- contact_info should include only official contact names, emails, phone numbers, or helpdesk text visible in the source.

Return valid JSON only.`;

🟦 Conference Abstract Prompt — START
CONFERENCE OVERRIDE (TOP-UP):

Apply the following modifications to the base Abstract instructions:

1. Compression:
   - Prefer concise, information-dense sentences.
   - Reduce background context to the minimum required for understanding.

2. Contribution Priority:
   - State the core contribution earlier than in a journal abstract.
   - Make the novelty or differentiating idea explicit in the first half.

3. Reviewer Heuristics:
   - Assume the reviewer has limited time and strong domain knowledge.
   - Optimize for quick assessment of relevance and merit.

4. Scope Discipline:
   - Avoid broad or long-term implications.
   - Prefer concrete outcomes, demonstrations, or insights.

5. Length Target:
   - Aim for the lower bound of the allowed word range (typical: 120–180 words).

Do NOT change:
- Claim discipline
- JSON output structure
- No-citation rule
- Blueprint alignment

🟦 Conference Abstract Prompt — END
🔷 Conference Introduction — TOP-UP
🟦 Conference Introduction Prompt — START
CONFERENCE OVERRIDE (TOP-UP):

Apply the following modifications to the base Introduction instructions:

1. Ordering:
   - Move the statement of contribution earlier than in journal writing.
   - Ensure the main contribution is visible within the first 2–3 paragraphs.

2. Context Depth:
   - Shorten background and motivation.
   - Focus on the specific constraint or failure mode motivating the work.

3. Literature Positioning:
   - Limit prior work discussion to what is strictly necessary to define the gap.
   - Defer detailed comparisons to the Literature Review.

4. Emphasis:
   - Highlight feasibility and clarity over exhaustiveness.
   - Frame novelty as “difference in approach” rather than dominance.

5. Length Target:
   - Stay toward the lower end of the word budget (typical: 600–900 words).

Do NOT change:
- Section purpose defined in the blueprint
- Claim types and memory extraction
- Terminology rules
- JSON output structure

🟦 Conference Introduction Prompt — END


🟦 Conference Methodology Prompt — START
CONFERENCE OVERRIDE (TOP-UP):

Apply the following modifications to the base Methodology instructions:

1. Brevity with Sufficiency:
   - Describe the methodology at a level sufficient to judge correctness and feasibility.
   - Avoid exhaustive procedural detail that does not affect validity or interpretation.
   - Prefer clarity over completeness.

2. Feasibility Emphasis:
   - Highlight why the chosen methodology is appropriate and implementable within conference constraints.
   - Make assumptions, simplifications, and design trade-offs explicit.

3. Reviewer Heuristics:
   - Assume reviewers assess whether the method is:
     (a) sound,
     (b) clearly described,
     (c) executable,
     (d) aligned with the claimed contribution.
   - Optimize for quick methodological trust, not archival completeness.

4. Evaluation Alignment:
   - Clearly link the methodology to the evaluation reported in Results.
   - Avoid introducing optional or exploratory procedures that are not evaluated later.

5. Scope Discipline:
   - State what methodological aspects are intentionally simplified or deferred.
   - Avoid claims of optimality, completeness, or generality.

6. Length Target:
   - Prefer the lower bound of the word budget (typical conference range: 700–1000 words).
   - If necessary, prioritize core design and evaluation steps over peripheral details.

METHODOLOGY-TYPE MODULATION:

IF QUANTITATIVE / EXPERIMENTAL:
- Focus on model, data, and evaluation choices that directly affect results.
- Summarize preprocessing and parameter choices succinctly.
- Avoid deep hyperparameter or implementation discussions unless central.

IF QUALITATIVE / CASE_STUDY:
- Focus on study design, participant selection, and analytic logic.
- Summarize instruments and protocols without full reproduction detail.
- Emphasize credibility and transparency over completeness.

IF MIXED:
- Emphasize integration logic over procedural depth.
- Keep each methodological component concise.

IF REVIEW:
- Focus on classification logic and synthesis strategy.
- Avoid over-claiming systematic rigor unless fully justified.

Do NOT change:
- Scientific rigor requirements
- Validity / trustworthiness disclosure
- Claim Ledger compatibility
- JSON output structure
- Blueprint alignment

🟦 Conference Methodology Prompt — END

🟦 Conference Results Prompt — START
CONFERENCE OVERRIDE (TOP-UP):

Apply the following modifications to the base Results / Findings instructions:

1. Result Prioritization:
   - Report only the results that directly support the paper’s stated contributions.
   - De-emphasize secondary, exploratory, or peripheral findings.
   - Prefer depth on fewer results over breadth.

2. Clarity over Exhaustiveness:
   - Present results in a clean, linear order aligned with the evaluation plan.
   - Avoid reporting every ablation, variant, or auxiliary analysis unless it is central to the contribution.

3. Reviewer Heuristics:
   - Assume reviewers are asking:
     “Do these results convincingly support the claimed contribution within the conference scope?”
   - Optimize for fast comprehension and trust.

4. Quantitative Emphasis (if applicable):
   - Highlight primary metrics first.
   - Clearly identify baselines and comparison points.
   - Report variance or uncertainty only where it affects interpretation.
   - Avoid deep statistical exposition unless it is essential.

5. Qualitative Emphasis (if applicable):
   - Focus on the most representative themes or patterns.
   - Avoid excessive quotation or anecdotal detail.
   - Clearly indicate consistency or recurrence without over-generalizing.

6. Negative and Null Results:
   - Include null or negative findings only if they are informative for understanding limitations or scope.
   - Do not attempt to “rescue” weak results through language.

7. Length Target:
   - Stay toward the lower end of the word budget (typical conference range: 600–900 words).
   - If space is constrained, prioritize primary outcome reporting.

STRICTLY AVOID:
- Interpreting results (belongs to Discussion).
- Claiming importance, impact, or superiority.
- Introducing new evaluation criteria or datasets.
- Overloading the section with minor variations.

Do NOT change:
- Result–interpretation separation
- Terminology consistency
- Claim Ledger alignment
- JSON output structure
- Blueprint constraints

🟦 Conference Results Prompt — END

🟦 Conference Discussion Prompt — START
CONFERENCE OVERRIDE (TOP-UP):

Apply the following modifications to the base Discussion instructions:

1. Brevity with Insight:
   - Keep the discussion concise and tightly focused.
   - Prioritize explaining the meaning of the main results over exhaustive interpretation.
   - Avoid rehashing secondary or peripheral findings.

2. Contribution-Centered Interpretation:
   - Anchor the discussion explicitly around the paper’s primary contribution(s).
   - Make it clear how the results support the claimed novelty or difference.
   - Avoid expanding the scope beyond what the results directly justify.

3. Reviewer Heuristics:
   - Assume reviewers are asking:
     “Is the contribution clear, justified, and appropriately scoped for a conference?”
   - Optimize for clarity of insight rather than breadth of implications.

4. Comparison Discipline:
   - Keep comparisons to prior work high-level and conceptual.
   - Focus on how the approach differs or complements existing work, not on outperforming it.
   - Avoid detailed result-by-result comparisons (journals can do that; conferences should not).

5. Limitation Handling:
   - Acknowledge key limitations directly and succinctly.
   - Emphasize boundaries of applicability rather than apologetic disclaimers.
   - Do not attempt to neutralize limitations with speculative language.

6. Implications:
   - Prefer immediate, concrete implications over long-term visions.
   - Keep implications proportional to evidence.
   - Avoid claims of broad generalization or field-wide transformation.

7. Length Target:
   - Stay toward the lower end of the word budget (typical conference range: 500–800 words).
   - If space is tight, prioritize interpretation over future directions.

FUTURE WORK MODULATION:
- Mention future work briefly and selectively.
- Limit future directions to 1–2 items that directly arise from stated limitations.
- Avoid roadmap-style or grant-proposal language.

Do NOT change:
- Result-to-interpretation linkage rules
- No-new-claims discipline
- Claim Ledger alignment
- Blueprint constraints
- JSON output structure

🟦 Conference Discussion Prompt — END

🟦 Conference Conclusion Prompt — START
CONFERENCE OVERRIDE (TOP-UP):

Apply the following modifications to the base Conclusion instructions:

1. Extreme Concision:
   - Keep the conclusion short and focused.
   - Prefer synthesis over restatement.
   - Avoid repeating the abstract or discussion verbatim.

2. Contribution Emphasis:
   - Reiterate the primary contribution(s) clearly and succinctly.
   - Emphasize what the paper demonstrates or establishes within conference scope.
   - Avoid reframing or expanding the contribution.

3. Reviewer Heuristics:
   - Assume reviewers ask:
     “Does this paper deliver a clear, bounded takeaway worth accepting?”
   - Optimize for intellectual closure, not expansion.

4. Scope Discipline:
   - Explicitly reinforce boundaries or limitations in one compact sentence.
   - Avoid generalization beyond the evaluated setting.

5. Future Work Modulation:
   - Mention future work only briefly, if at all.
   - Limit to 1 concrete direction directly implied by a stated limitation.
   - Avoid multi-item roadmaps or speculative visions.

6. Tone:
   - Neutral, confident, and restrained.
   - Avoid claims of impact, adoption, or transformation.

7. Length Target:
   - Stay near the lower bound of the word budget
     (typical conference range: 150–300 words).

STRICTLY AVOID:
- Introducing new claims or interpretations
- Repeating methodological detail
- Grant-style future plans
- Journal-style extended reflection

Do NOT change:
- No-new-claims rule
- Claim Ledger alignment
- Terminology consistency
- Blueprint constraints
- JSON output structure

🟦 Conference Conclusion Prompt — END
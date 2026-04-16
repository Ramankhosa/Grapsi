-- Add schema version marker for blueprint JSON evolution.
ALTER TABLE "paper_blueprints"
ADD COLUMN IF NOT EXISTS "blueprint_schema_version" INTEGER NOT NULL DEFAULT 2;

DO $$
DECLARE
  section_col text;
  update_sql text;
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'paper_blueprints'
        AND column_name = 'section_plan'
    ) THEN 'section_plan'
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'paper_blueprints'
        AND column_name = 'sectionPlan'
    ) THEN 'sectionPlan'
    ELSE NULL
  END INTO section_col;

  IF section_col IS NULL THEN
    RAISE EXCEPTION 'Unable to locate section plan column on paper_blueprints (expected section_plan or sectionPlan)';
  END IF;

  update_sql := format($sql$
WITH expanded AS (
  SELECT
    pb.id,
    item,
    lower(regexp_replace(COALESCE(item->>'sectionKey', ''), '[[:space:]-]+', '_', 'g')) AS normalized_section_key
  FROM "paper_blueprints" pb
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pb.%I, '[]'::jsonb)) AS items(item)
),
rewritten AS (
  SELECT
    id,
    jsonb_strip_nulls(
      item
      || jsonb_build_object(
        'thematicBlueprint',
        COALESCE(
          item->'thematicBlueprint',
          jsonb_build_object(
            'mustCover', COALESCE(item->'mustCover', '[]'::jsonb),
            'mustAvoid', COALESCE(item->'mustAvoid', '[]'::jsonb),
            'mustCoverTyping', COALESCE(item->'mustCoverTyping', '{}'::jsonb),
            'suggestedCitationCount', item->'suggestedCitationCount'
          )
        ),
        'rhetoricalBlueprint',
        COALESCE(
          item->'rhetoricalBlueprint',
          jsonb_build_object(
            'enabled', false,
            'slots',
            CASE normalized_section_key
              WHEN 'introduction' THEN jsonb_build_array(
                jsonb_build_object(
                  'key', 'ContextBackground',
                  'required', true,
                  'placement', 'start',
                  'intent', 'Introduce domain context and establish background.',
                  'constraints', jsonb_build_array('No novelty claims', 'Keep 1-2 paragraphs max'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 2)
                ),
                jsonb_build_object(
                  'key', 'GapResearchQuestion',
                  'required', true,
                  'placement', 'end',
                  'intent', 'State the gap and research question clearly near section close.',
                  'constraints', jsonb_build_array('Ground the gap in thematic evidence', 'Avoid solution details'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 2)
                ),
                jsonb_build_object(
                  'key', 'Contributions',
                  'required', true,
                  'placement', 'final',
                  'intent', 'Provide the contribution list as the final paragraph.',
                  'constraints', jsonb_build_array('Must match ResearchIntentLock contributions exactly', 'No new claims'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 1)
                ),
                jsonb_build_object(
                  'key', 'PaperStructure',
                  'required', false,
                  'placement', 'final',
                  'intent', 'Optionally preview section flow.',
                  'constraints', jsonb_build_array('1 short paragraph max'),
                  'citationPolicy', jsonb_build_object('mode', 'none', 'maxCitations', 0)
                )
              )
              WHEN 'literature_review' THEN jsonb_build_array(
                jsonb_build_object(
                  'key', 'ResearchLandscape',
                  'required', true,
                  'placement', 'start',
                  'intent', 'Frame the research landscape at a high level.',
                  'constraints', jsonb_build_array('Use thematic clusters, not paper-by-paper narration'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 2)
                ),
                jsonb_build_object(
                  'key', 'ThematicSynthesis',
                  'required', true,
                  'placement', 'middle',
                  'intent', 'Synthesize literature thematically with tension and overlap.',
                  'constraints', jsonb_build_array('Keep claims tied to evidence digest'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 2)
                ),
                jsonb_build_object(
                  'key', 'Limitations',
                  'required', true,
                  'placement', 'end',
                  'intent', 'Highlight unresolved limitations in prior work.',
                  'constraints', jsonb_build_array('Do not introduce the paper method yet'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 1)
                ),
                jsonb_build_object(
                  'key', 'StudyPositioning',
                  'required', false,
                  'placement', 'end',
                  'intent', 'Position the current study relative to the mapped gap.',
                  'constraints', jsonb_build_array('Stay concise'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 1)
                )
              )
              WHEN 'related_work' THEN jsonb_build_array(
                jsonb_build_object(
                  'key', 'ResearchLandscape',
                  'required', true,
                  'placement', 'start',
                  'intent', 'Frame the research landscape at a high level.',
                  'constraints', jsonb_build_array('Use thematic clusters, not paper-by-paper narration'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 2)
                ),
                jsonb_build_object(
                  'key', 'ThematicSynthesis',
                  'required', true,
                  'placement', 'middle',
                  'intent', 'Synthesize literature thematically with tension and overlap.',
                  'constraints', jsonb_build_array('Keep claims tied to evidence digest'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 2)
                ),
                jsonb_build_object(
                  'key', 'Limitations',
                  'required', true,
                  'placement', 'end',
                  'intent', 'Highlight unresolved limitations in prior work.',
                  'constraints', jsonb_build_array('Do not introduce the paper method yet'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 1)
                ),
                jsonb_build_object(
                  'key', 'StudyPositioning',
                  'required', false,
                  'placement', 'end',
                  'intent', 'Position the current study relative to the mapped gap.',
                  'constraints', jsonb_build_array('Stay concise'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 1)
                )
              )
              WHEN 'methodology' THEN jsonb_build_array(
                jsonb_build_object(
                  'key', 'ResearchDesign',
                  'required', true,
                  'placement', 'start',
                  'intent', 'Declare the research design and rationale.',
                  'constraints', jsonb_build_array('Do not report results'),
                  'citationPolicy', jsonb_build_object('mode', 'none', 'maxCitations', 0)
                ),
                jsonb_build_object(
                  'key', 'SystemArchitecture',
                  'required', true,
                  'placement', 'middle',
                  'intent', 'Describe the system/approach architecture.',
                  'constraints', jsonb_build_array('Align terminology with prior sections'),
                  'citationPolicy', jsonb_build_object('mode', 'none', 'maxCitations', 0)
                ),
                jsonb_build_object(
                  'key', 'DataProtocol',
                  'required', true,
                  'placement', 'middle',
                  'intent', 'Detail data sources, preprocessing, and sampling protocol.',
                  'constraints', jsonb_build_array('Report reproducibility-critical settings'),
                  'citationPolicy', jsonb_build_object('mode', 'none', 'maxCitations', 0)
                ),
                jsonb_build_object(
                  'key', 'EvaluationStrategy',
                  'required', true,
                  'placement', 'end',
                  'intent', 'Define evaluation metrics and comparison plan.',
                  'constraints', jsonb_build_array('No outcome claims'),
                  'citationPolicy', jsonb_build_object('mode', 'none', 'maxCitations', 0)
                ),
                jsonb_build_object(
                  'key', 'ImplementationDetails',
                  'required', false,
                  'placement', 'end',
                  'intent', 'Optional implementation details and tooling notes.',
                  'constraints', jsonb_build_array('Keep concise and reproducible'),
                  'citationPolicy', jsonb_build_object('mode', 'none', 'maxCitations', 0)
                )
              )
              WHEN 'results' THEN jsonb_build_array(
                jsonb_build_object(
                  'key', 'ExperimentalContext',
                  'required', true,
                  'placement', 'start',
                  'intent', 'State experimental setup context for interpreting outcomes.',
                  'constraints', jsonb_build_array('No method restatement'),
                  'citationPolicy', jsonb_build_object('mode', 'none', 'maxCitations', 0)
                ),
                jsonb_build_object(
                  'key', 'EmpiricalFindings',
                  'required', true,
                  'placement', 'middle',
                  'intent', 'Report empirical findings clearly and directly.',
                  'constraints', jsonb_build_array('Use measured outcomes only'),
                  'citationPolicy', jsonb_build_object('mode', 'none', 'maxCitations', 0)
                ),
                jsonb_build_object(
                  'key', 'ComparativeAnalysis',
                  'required', true,
                  'placement', 'end',
                  'intent', 'Compare findings against baselines or alternatives.',
                  'constraints', jsonb_build_array('Avoid causal overclaims'),
                  'citationPolicy', jsonb_build_object('mode', 'none', 'maxCitations', 0)
                ),
                jsonb_build_object(
                  'key', 'Robustness',
                  'required', false,
                  'placement', 'end',
                  'intent', 'Optional robustness and sensitivity checks.',
                  'constraints', jsonb_build_array('Mention uncertainty where relevant'),
                  'citationPolicy', jsonb_build_object('mode', 'none', 'maxCitations', 0)
                )
              )
              WHEN 'discussion' THEN jsonb_build_array(
                jsonb_build_object(
                  'key', 'Interpretation',
                  'required', true,
                  'placement', 'start',
                  'intent', 'Interpret core findings and their meaning.',
                  'constraints', jsonb_build_array('Tie interpretation to reported results'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 1)
                ),
                jsonb_build_object(
                  'key', 'RelationToLiterature',
                  'required', true,
                  'placement', 'middle',
                  'intent', 'Relate findings to prior literature and disagreements.',
                  'constraints', jsonb_build_array('Use explicit reinforce/contradict/extend framing'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 2)
                ),
                jsonb_build_object(
                  'key', 'Implications',
                  'required', true,
                  'placement', 'middle',
                  'intent', 'Explain theoretical/practical implications.',
                  'constraints', jsonb_build_array('Do not introduce unsupported new results'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 1)
                ),
                jsonb_build_object(
                  'key', 'LimitationsFuture',
                  'required', true,
                  'placement', 'end',
                  'intent', 'Close with limitations and future work.',
                  'constraints', jsonb_build_array('Maintain scope discipline'),
                  'citationPolicy', jsonb_build_object('mode', 'optional', 'maxCitations', 1)
                )
              )
              ELSE '[]'::jsonb
            END
          )
        )
      )
    ) AS section_item
  FROM expanded
),
aggregated AS (
  SELECT id, jsonb_agg(section_item) AS section_plan
  FROM rewritten
  GROUP BY id
)
UPDATE "paper_blueprints" pb
SET
  %I = aggregated.section_plan,
  "blueprint_schema_version" = 2
FROM aggregated
WHERE pb.id = aggregated.id;
$sql$, section_col, section_col);

  EXECUTE update_sql;
END $$;

UPDATE "paper_blueprints"
SET "blueprint_schema_version" = 2
WHERE "blueprint_schema_version" IS DISTINCT FROM 2;

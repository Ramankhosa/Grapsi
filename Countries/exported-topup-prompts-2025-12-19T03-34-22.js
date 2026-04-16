// ============================================================================
// COUNTRY SECTION PROMPTS (TOP-UP) - EXPORTED FROM DATABASE 2025-12-19T03:34:22.877Z
// ============================================================================
const COUNTRY_SECTION_PROMPTS = {
  'AU': [
    {
      sectionKey: 'abstract',
      instruction: `Per IP Australia guidelines, draft an Abstract of 50-150 words summarizing technical disclosure.`,
      constraints: ["50-150 words preferred, max 150","Single paragraph","Technical summary only—no advantages/marketing","Enable quick understanding of field and main features"],
      additions: ["IP Australia may amend abstracts exceeding 150 words","Reference most illustrative figure if drawings present"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'background',
      instruction: `Per IP Australia guidelines, draft Background Art describing relevant prior technology without prejudicing patentability.`,
      constraints: ["Use objective, neutral language","Avoid suggesting the invention is obvious","No harmful admissions against novelty/inventive step"],
      additions: ["Australia has no formal IDS requirement but applicants should not deliberately mislead","Use hedging language where appropriate"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'briefDescriptionOfDrawings',
      instruction: `Per IP Australia formatting guidelines, briefly describe each drawing figure.`,
      constraints: ["One sentence per figure","Format: 'Fig. X is a [view type] showing [subject]'","Match figure order in drawings"],
      additions: ["Required if drawings are present"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'claims',
      instruction: `Draft claims compliant with Section 40 of the Patents Act 1990. Claims must be clear, succinct, and fairly based on description.`,
      constraints: ["Each claim as single sentence","Multiple dependent claims permitted (including on other multiple dependents)","Claims must be fairly based on disclosed matter","All claims relate to single inventive concept"],
      additions: ["Australia allows multiple dependent claims on two or more other claims","Unity follows 'single inventive concept' standard","Claims must be clear and succinct per s.40(3)"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'detailed_description',
      instruction: `Per Section 40(2)(a) of the Patents Act 1990, draft a Description of Embodiments fully describing the invention including best method.`,
      constraints: ["Sufficient detail for skilled person to perform invention","Disclose best method known to applicant (mandatory in AU)","Consistent reference numerals matching drawings","Include practical examples where applicable"],
      additions: ["Australia requires 'best method' disclosure (s.40(2)(aa))","Description must be clear and complete enough to perform invention","Include industrial applicability where not self-evident"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'field',
      instruction: `Draft the Technical Field section.`,
      constraints: ["Limit to 1–3 sentences.","State the technical field without describing advantages or embodiments."],
      additions: [],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'fieldOfInvention',
      instruction: `Per IP Australia specification guidelines, draft a Technical Field identifying the technical area of the invention.`,
      constraints: ["1-3 sentences maximum","State technical field objectively","No features or advantages"],
      additions: ["May reference IPC/CPC classification areas"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'summary',
      instruction: `Per IP Australia practice, draft a Summary stating technical problem, inventive solution, and advantageous effects.`,
      constraints: ["Align with independent claims scope","Use flexible language ('in embodiments', 'according to aspects')","Include brief statement of advantages"],
      additions: ["Structure: problem → solution → advantages"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'title',
      instruction: `Per IP Australia guidelines and Patents Act 1990, draft a title that is brief, technically descriptive, and identifies the subject matter.`,
      constraints: ["Maximum 500 characters","No trade names, trade marks, or personal names","Sentence case, no terminal period"],
      additions: ["Title should align with technical field and claims"],
      importFiguresDirectly: false
    },
  ],
  'CA': [
    {
      sectionKey: 'abstract',
      instruction: `Per CIPO abstract guidelines, draft an Abstract summarizing the technical disclosure for searching purposes.`,
      constraints: ["Maximum 150 words","Single paragraph","Technical field, problem, solution, principal use","No advantages, value statements, or claim language"],
      additions: ["Abstract is for information/search purposes only","Reference illustrative figure if drawings present"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'background',
      instruction: `Per CIPO guidelines, draft Background Art describing relevant prior technology without prejudicing patentability.`,
      constraints: ["Use objective, neutral language","Summarize relevant prior art and limitations","Avoid harmful admissions"],
      additions: ["Canada has duty of candour but no formal IDS like USPTO","Do not deliberately conceal material prior art"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'briefDescriptionOfDrawings',
      instruction: `Per CIPO formatting guidelines, briefly describe each drawing figure.`,
      constraints: ["One sentence per figure","Required if drawings are present"],
      additions: [],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'claims',
      instruction: `Per Patent Rules and CIPO Manual of Patent Office Practice (MOPOP), draft claims that are clear, concise, and supported.`,
      constraints: ["Clear and concise language","Multiple dependent claims allowed (including on other multiple dependents)","Single inventive concept (unity)","All features supported by description"],
      additions: ["No per-claim fees for excess claims in Canada","Unity assessed under 'single general inventive concept' standard","Reference numerals may be included"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'detailedDescription',
      instruction: `Per s.27(3) of the Canadian Patent Act, draft detailed description correctly and fully describing the invention.`,
      constraints: ["At least one workable mode","Sufficient for skilled person to practice","Support for all claims"],
      additions: ["No best mode requirement in Canada"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'field',
      instruction: `Per CIPO practice, draft Technical Field indicating the area to which the invention pertains.`,
      constraints: ["1-3 sentences","Technical area only","No features or advantages"],
      additions: ["Should align with abstract requirements"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'fieldOfInvention',
      instruction: `Per CIPO practice, draft Technical Field indicating the technical area of the invention.`,
      constraints: ["1-3 sentences","No embodiments or advantages"],
      additions: [],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'modes_for_carrying_out',
      instruction: `Per s.27(3) of the Canadian Patent Act, draft Mode(s) for Carrying Out the Invention correctly and fully describing the invention.`,
      constraints: ["At least one workable mode must be described","Sufficient detail for skilled person to work invention","Each independent claim needs supporting embodiment","Reference drawings with consistent numerals"],
      additions: ["Canada does NOT require best mode disclosure (unlike US)","But must correctly and fully describe at least one workable mode","Preferred embodiments encouraged but not mandatory"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'summary',
      instruction: `Per Canadian Patent Rules, draft Disclosure of Invention explaining the problem, solution, and essential features.`,
      constraints: ["Technical problem and solution","Align with independent claims","No promotional language"],
      additions: ["Disclosure should meet s.27(3) of the Patent Act requirements"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'title',
      instruction: `Per CIPO guidelines and Patent Rules, draft a title that is brief, technically descriptive, and identifies the invention.`,
      constraints: ["Maximum 500 characters","No trade names, trade marks, or personal names","Suitable for both English and French examination"],
      additions: ["Canada is bilingual - title should be clear in both languages"],
      importFiguresDirectly: false
    },
  ],
  'IN': [
    {
      sectionKey: 'abstract',
      instruction: `Per Section 10(4)(d) and Rule 13(7)(b), provide a concise summary in not more than 150 words, commencing with the title and indicating technical field, technical advancement, and principal use.`,
      constraints: ["Hard limit of 150 words under Indian Rules","Must commence with the title of the invention","Indicate technical field, advancement, and principal use"],
      additions: ["Avoid claim-style wording per Manual guidelines"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'background',
      instruction: `cite prior art while dicussing relevant invention features,processes, design, limitations.`,
      constraints: ["One paragraph should not contain more than two to three lines and should be complete in itself."],
      additions: [],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'briefDescriptionOfDrawings',
      instruction: `List each drawing figure with a one-line description ensuring figure numbering and captions match the drawing sheets filed under Rule 15.`,
      constraints: ["Use format: 'FIG. X is a [type] view of [subject]'","Ensure consistent numbering with actual drawing sheets"],
      additions: [],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'claims',
      instruction: `Draft claims compliant with Section 10(4) and (5) of the Indian Patents Act, 1970. Claims must define the matter for which protection is sought, be clear and succinct, and be fairly based on the matter disclosed in the specification.`,
      constraints: ["Use 'comprising' as preferred open connector; 'including' acceptable; 'consisting of' for narrow scope","Prefer two-part format (preamble + 'characterised in that') when defining improvements","Multiple dependent claims permitted including on other multiple dependent claims","Maintain unity of invention under Section 10(5)"],
      additions: ["All claims must be fully supported by the detailed description","Each claim must define matter for which protection is sought per Section 10(4)"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'detailedDescription',
      instruction: `PARAGRAPH FORMATTING REQUIREMENT (STRICT):

- Each disclosure unit must appear in its own paragraph.
- Insert exactly one blank line between paragraphs.
- Do not continue a paragraph once the disclosure unit is complete.
- If additional disclosure is needed, start a new paragraph.
`,
      constraints: [],
      additions: [],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'fieldOfInvention',
      instruction: `Per Indian Patent Office Manual of Practice and Procedure, this section opens the description and indicates the technical field to which the invention relates.`,
      constraints: ["Limit to 1–3 sentences as per Manual guidelines","State the general and specific technical field without advantages or embodiments"],
      additions: [],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'objectsOfInvention',
      instruction: `Per Indian Patent Office practice, draft the 'Object(s) of the Invention' section to clearly articulate the technical problems with existing prior art and the specific solutions provided by the invention. This section is placed after Background and before Summary in Indian Complete Specifications (Form 2).`,
      constraints: ["Use statements beginning with 'The principal object of this invention is to...' or 'Another object of this invention is to...'","NEVER use 'The object...' (singular definite) as this implies only one objective","Focus on technical results achieved (e.g., 'to improve efficiency'), not the means","Each objective should correlate directly with features mentioned in the claims","Describe what the invention achieves, not how it achieves it"],
      additions: ["Acknowledge closest prior art and clearly distinguish how the invention improves upon it","Ensure objectives can be substantiated by the detailed description and claims","Do not admit non-patentability or state invention is obvious","Avoid vague or non-technical goals focusing only on commercial success","Do not overstate benefits - stick to demonstrable technical advantages"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'preamble',
      instruction: `just say the following in the output, nothing else, print ,"The following specification describes the invention.."`,
      constraints: [],
      additions: [],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'summary',
      instruction: `Per Manual of Patent Office Practice and Procedure, provide a concise summary highlighting essential features and distinguishing aspects over known art, consistent with independent claims.`,
      constraints: ["This summary should precede the detailed description for clarity","Ensure consistency with the scope of independent claims"],
      additions: [],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'title',
      instruction: `For Indian jurisdiction under Rule 13(7)(a), ensure the title is specific, indicates the features of the invention, and is normally expressed in not more than 15 words.`,
      constraints: ["Avoid trademarks and personal names per Indian Patent Manual guidelines","Focus on brevity and clarity per Patents Rules, 2003"],
      additions: [],
      importFiguresDirectly: false
    },
  ],
  'JP': [
    {
      sectionKey: 'abstract',
      instruction: `Per JPO practice, draft a concise Abstract summarizing the gist of the invention.`,
      constraints: ["Single paragraph, ~150 words recommended (max 200)","Technical summary only","No advantages, marketing language, or claim references","~800 characters maximum for Japanese version"],
      additions: ["Abstract may be shortened by JPO/JAPIO on publication","This is for information/searching purposes only"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'advantageousEffects',
      instruction: `Draft the Advantageous Effects sub-section per JPO requirements, listing specific technical advantages.`,
      constraints: ["List specific, measurable technical advantages","Support with specification features","No marketing or commercial language"],
      additions: ["This corresponds to 【発明の効果】"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'background',
      instruction: `Per JPO practice, draft Background Art describing conventional technology and prior art relevant to understanding the invention.`,
      constraints: ["Describe limitations objectively without disparaging specific patents","Do not fully state problem/solution here - reserve for Summary","Use neutral language about prior art drawbacks"],
      additions: ["Japan has no formal IDS requirement but applicants should not deliberately conceal known prior art","This section corresponds to 【背景技術】 in Japanese filings","Consider separate Citation List section for prior art references"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'briefDescriptionOfDrawings',
      instruction: `Per JPO formatting, provide brief one-sentence description for each drawing figure.`,
      constraints: ["One sentence per figure","Format: 'FIG. X is a [view type] of [subject]'","No detailed operation - reserve for Description of Embodiments"],
      additions: ["This corresponds to 【図面の簡単な説明】"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'claims',
      instruction: `Draft claims per Patent Act Article 36 and JPO Examination Guidelines, ensuring support and clarity.`,
      constraints: ["Each claim supported by description","Clear, consistent terminology","Single general inventive concept (unity)","Multiple dependent claims allowed but cannot depend on other multiple dependents"],
      additions: ["Fee based on total number of claims, not just independents","Multiple independent claims for different categories (product, method) are acceptable","Reference numerals may be included in claims"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'detailedDescription',
      instruction: `Per Patent Act Article 36(4)(i), draft Description of Embodiments enabling a skilled person to carry out the invention without undue experimentation.`,
      constraints: ["Include embodiment regarded as best mode","Sufficient detail for enablement","Use consistent reference numerals matching drawings","Avoid claim-style language"],
      additions: ["This corresponds to 【発明を実施するための形態】","Japan requires best mode disclosure integrated in this section","Consider paragraph numbering in format 【0001】"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'fieldOfInvention',
      instruction: `Per JPO specification guidelines, draft a Technical Field section stating the technical area of the invention.`,
      constraints: ["Neutral technical terminology","No advantages or problem discussion","May include classification terms"],
      additions: ["This section corresponds to 【技術分野】 in Japanese filings"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'industrialApplicability',
      instruction: `Draft Industrial Applicability section if applicability is not self-evident from other sections.`,
      constraints: ["Explain how invention can be used in industry","Specific practical applications"],
      additions: ["This corresponds to 【産業上の利用可能性】","Optional - can be omitted if self-evident"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'summary',
      instruction: `Per JPO practice, draft Summary of Invention with clear problem-solution structure including Technical Problem, Solution to Problem, and Advantageous Effects.`,
      constraints: ["Use problem-solution structure required by JPO","Technical Problem: state objective technical problem","Solution to Problem: describe how invention solves it","Advantageous Effects: list technical benefits","Align with independent claims"],
      additions: ["This section corresponds to 【発明の概要】 in Japanese filings","JPO strongly prefers explicit problem-solution format","Effects should be technical, not commercial"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'technicalProblem',
      instruction: `Draft the Technical Problem sub-section per JPO requirements, stating the objective technical problem to be solved.`,
      constraints: ["State problem objectively, not subjectively","Problem should be recognizable by skilled person","Solvable by the distinguishing features of the invention"],
      additions: ["This corresponds to 【発明が解決しようとする課題】"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'technicalSolution',
      instruction: `Draft the Solution to Problem sub-section per JPO requirements, describing how the invention solves the technical problem.`,
      constraints: ["Directly address the Technical Problem","Explain cause-effect relationship","Describe technical mechanism"],
      additions: ["This corresponds to 【課題を解決するための手段】"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'title',
      instruction: `Per JPO practice and Patent Act Article 36, draft a concise technical title that identifies the invention without marketing language or trademarks.`,
      constraints: ["Maximum 500 characters","No trade names, trade marks, personal names, or superlatives","Must be technical and descriptive","Avoid fanciful or abstract terms"],
      additions: ["Title will be translated to Japanese for official filing"],
      importFiguresDirectly: false
    },
  ],
  'PCT': [
    {
      sectionKey: 'abstract',
      instruction: `Per PCT Rule 8, draft an Abstract for searching purposes that permits quick understanding of the technical disclosure.`,
      constraints: ["50-150 words (strictly, max 150)","Technical field, problem, solution, principal use","No merits, advantages, or speculative applications","No claim-style language"],
      additions: ["Published by WIPO in international publication","Include reference to most illustrative figure (Rule 8.1(c))","ISA may amend abstract if needed (Rule 38.2)"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'background',
      instruction: `Per PCT Rule 5.1(a)(ii), draft Background Art indicating prior art useful for understanding, searching, and examining the invention.`,
      constraints: ["Cite relevant prior art documents where known","Describe limitations objectively","Do not concede obviousness or lack of novelty"],
      additions: ["Prior art citations are useful for international search","This section helps the ISA understand the technical context"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'briefDescriptionOfDrawings',
      instruction: `Per PCT Rule 5.1(a)(iv), briefly describe each figure of the drawings.`,
      constraints: ["One sentence per figure","Brief description only","Required if drawings are present"],
      additions: ["Format: 'Fig. X is a [view type] showing [subject]'"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'claims',
      instruction: `Per PCT Rules 6 and 13, draft claims that define the matter for which protection is sought, supported by the description.`,
      constraints: ["Each claim as single sentence where practicable","Clear, consistent terminology","Unity of invention under Rule 13 (single general inventive concept)","Multiple dependent claims cannot depend on other multiple dependents","Reference numerals may be included in claims (Rule 6.2(a))"],
      additions: ["3+ independent claims or 15+ total claims may trigger additional search fees","Consider national phase requirements when drafting (some offices prefer two-part form)","Claims must be numbered consecutively in Arabic numerals"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'detailed_description',
      instruction: `Per PCT Rule 5.1(a)(v), draft Mode(s) for Carrying Out the Invention setting out at least the best mode contemplated by the applicant.`,
      constraints: ["Best mode contemplated by applicant must be disclosed","Sufficient detail for enablement by skilled person","Each independent claim needs supporting embodiment","Reference drawings with consistent numerals"],
      additions: ["Required section under PCT Rule 5.1(a)(v)","Best mode disclosure required for many national phases","Use examples where they add clarity"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'detailedDescription',
      instruction: `Per PCT Rule 5.1(a)(v), draft Mode(s) for Carrying Out the Invention setting out at least the best mode contemplated by the applicant.`,
      constraints: ["Best mode must be disclosed","Sufficient detail for enablement","Support for all independent claims"],
      additions: ["Required under PCT Rule 5.1(a)(v)"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'field',
      instruction: `Per PCT Rule 5.1(a)(i), draft Technical Field indicating the technical field to which the invention relates.`,
      constraints: ["1-3 sentences","Must make sense to a skilled person","No advantages, embodiments, or detailed features"],
      additions: ["Required section under PCT Rule 5.1(a)(i)","Should be suitable for international classification purposes"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'fieldOfInvention',
      instruction: `Per PCT Rule 5.1(a)(i), draft Technical Field indicating the technical field to which the invention relates.`,
      constraints: ["1-3 sentences","Must make sense to a skilled person","No advantages, embodiments, or detailed features"],
      additions: ["Required section under PCT Rule 5.1(a)(i)"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'summary',
      instruction: `Per PCT Rule 5.1(a)(iii), draft Disclosure of Invention so the technical problem and solution can be understood, with advantageous effects relative to background art.`,
      constraints: ["Technical problem and solution must be clear","Advantageous effects compared to prior art","Align with independent claims"],
      additions: ["Required section under PCT Rule 5.1(a)(iii)","Critical for international preliminary examination under Chapter II"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'title',
      instruction: `Per PCT Rule 4.3, draft a title that is short, precise, and indicates the subject matter to which the invention relates.`,
      constraints: ["Maximum 500 characters","Brief and descriptive of the technical subject","No trademarks, trade names, or fanciful expressions","Suitable for publication in multiple PCT member states"],
      additions: ["Title appears in the international publication (WIPO)","Should be suitable for translation into multiple languages"],
      importFiguresDirectly: false
    },
  ],
  'US': [
    {
      sectionKey: 'abstract',
      instruction: `Per 37 CFR 1.72(b) and MPEP 608.01(b), draft an Abstract suitable for publication that allows quick determination of the nature of the technical disclosure.`,
      constraints: ["Maximum 150 words (strictly enforced)","Single paragraph format","Technical summary only—no legal phraseology","Must not discuss merits or speculative applications"],
      additions: ["Include reference to the figure that best characterizes the invention (e.g., '(FIG. 1)')","The USPTO may shorten abstracts exceeding 150 words","The abstract is published in the Official Gazette"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'background',
      instruction: `Per MPEP 608.01(c) and 37 CFR 1.71, draft a Background that describes relevant prior art without making admissions harmful to patentability.`,
      constraints: ["Avoid statements like 'it is known in the art' without careful consideration","Do not characterize prior art in ways that suggest the invention is obvious","Use 'conventional approaches' rather than 'well-known' where possible","Do not admit that any specific reference constitutes prior art"],
      additions: ["Under 35 USC 102/103, statements in the background may be used against patentability","Consider using hedging language: 'Some approaches have attempted...'","IDS obligations under 37 CFR 1.56 require disclosure of material prior art"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'briefDescriptionOfDrawings',
      instruction: `Per 37 CFR 1.74, provide a brief description of each drawing figure before the detailed description.`,
      constraints: ["One sentence per figure","Use format: 'FIG. X is a [view type] showing [what it depicts]'","View types: block diagram, flowchart, perspective view, cross-sectional view"],
      additions: ["This section should follow the order of figures in the drawings","Reference numerals need not be listed here—they belong in the detailed description"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'claims',
      instruction: `Draft claims compliant with 35 USC 112 and 37 CFR 1.75. Use open-ended 'comprising' language for flexibility.`,
      constraints: ["Each claim must be a single sentence","Maintain proper antecedent basis ('a processor'...'the processor')","Independent claims: system/apparatus, method, and optionally CRM claims","Dependent claims must reference only one prior claim (no multiple dependencies in US)","Avoid 'means for' unless invoking 35 USC 112(f)"],
      additions: ["Per 37 CFR 1.75(c), multiple dependent claims are allowed but incur extra fees","Consider 3 independent claims and 17 dependent claims before excess claim fees apply","Use 'configured to' or 'adapted to' for functional language without invoking 112(f)"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'detailedDescription',
      instruction: `Per 35 USC 112(a) and MPEP 2161-2165, draft a Detailed Description that satisfies the written description, enablement, and best mode requirements.`,
      constraints: ["Describe in sufficient detail to enable a person of ordinary skill to make and use the invention (enablement)","Demonstrate possession of the claimed invention (written description)","Disclose the best mode contemplated by the inventor (best mode)","Use reference numerals consistently with the drawings"],
      additions: ["Include multiple embodiments and alternatives using 'in another embodiment...'","The USPTO requires the best mode known at the time of filing to be disclosed","Support for functional claim language should be explicit in the description"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'fieldOfInvention',
      instruction: `Per MPEP 608.01(c), draft a concise Field of the Invention that identifies the technical area without describing the invention itself.`,
      constraints: ["1-3 sentences maximum","State only the technical field (e.g., 'data processing', 'chemical compositions')","Do not describe specific features, advantages, or embodiments"],
      additions: ["This section helps the examiner classify the invention for searching purposes"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'summary',
      instruction: `Per MPEP 608.01(d), draft a Summary that provides a general statement of the invention suitable for publication in the Official Gazette.`,
      constraints: ["Align closely with independent claim 1","Include all essential elements of the broadest claim","Use 'in one embodiment', 'in aspects', 'according to various embodiments' for flexibility","Avoid unnecessary limitations not in the claims"],
      additions: ["The summary may be used by the USPTO for publication purposes","Consider including a brief statement of advantageous effects"],
      importFiguresDirectly: false
    },
    {
      sectionKey: 'title',
      instruction: `Per 37 CFR 1.72(a), draft a title that is brief, technical, and specific to the invention. Avoid abstract or fanciful terms.`,
      constraints: ["Maximum 500 characters per USPTO rules","Do not include trademarks, trade names, or personal names","Use sentence case without a terminal period","Avoid words like 'new', 'improved', 'novel'"],
      additions: ["The title appears at the top of the specification and should match Form PTO/SB/16 if used"],
      importFiguresDirectly: false
    },
  ],
};

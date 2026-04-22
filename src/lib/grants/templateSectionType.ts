import type { FundingTemplateItem } from '@/lib/fundingTemplates/types'
import type { CompiledGrantTemplateSectionType } from '@/types/grant'

function looksNarrativeField(item: FundingTemplateItem): boolean {
  const text = `${item.label || ''} ${item.guidance || ''}`.toLowerCase()
  const narrativeSignals = /(summary|synopsis|description|detailed|methodology|approach|technical plan|project plan|work ?plan|implementation|background|need statement|justification|impact|outcome|functioning|innovation|proposal)/.test(text)
  const conciseSignals = /(title|name|objective|aim|scope|keyword|identifier|code|category|city|state|country|institution|contact|email|phone)/.test(text)
  return narrativeSignals && !conciseSignals
}

export function resolveGrantTemplateSectionType(
  item: FundingTemplateItem
): CompiledGrantTemplateSectionType {
  if (item.type === 'table') return 'table'
  if (item.type === 'budget') return 'budget_rows'
  if (item.type === 'checklist' || item.type === 'attachment') return 'checklist'
  if (looksNarrativeField(item)) return 'narrative'
  if (item.type === 'field') {
    if ((item.wordLimit || 0) > 350 || (item.charLimit || 0) > 2500) {
      return 'narrative'
    }
    return 'short_answer'
  }
  if ((item.wordLimit || 0) <= 350 && (item.charLimit || 0) <= 2500) {
    return 'short_answer'
  }
  return 'narrative'
}

import type { FundingCall, FundingCallDocumentKind } from '@prisma/client';
import type { FundingDocumentQualityFlag, FundingDocumentQualityReport, FundingDocumentSectionDraft } from './types';

function sameDay(date: Date, target: Date) {
  return date.toISOString().slice(0, 10) === target.toISOString().slice(0, 10);
}

function daysBetween(left: Date, right: Date) {
  const oneDay = 24 * 60 * 60 * 1000;
  const leftUtc = Date.UTC(left.getUTCFullYear(), left.getUTCMonth(), left.getUTCDate());
  const rightUtc = Date.UTC(right.getUTCFullYear(), right.getUTCMonth(), right.getUTCDate());
  return Math.abs(Math.round((leftUtc - rightUtc) / oneDay));
}

function parseDocumentDate(value: string): Date | null {
  const normalized = value.replace(/(\d+)(st|nd|rd|th)/gi, '$1').trim();
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() > 2000) {
    return parsed;
  }
  return null;
}

function extractDates(text: string) {
  const patterns = [
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
    /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g,
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/gi,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi,
  ];
  const found: Date[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const parsed = parseDocumentDate(match[0]);
      if (parsed && !found.some((existing) => sameDay(existing, parsed))) {
        found.push(parsed);
      }
    }
  }
  return found;
}

function extractCurrencyAmounts(text: string) {
  const amounts: number[] = [];
  const pattern = /(?:[$€£₹]|INR|USD|EUR|GBP|Rs\.?)\s*([0-9][0-9,]*(?:\.\d+)?)\s*(crore|cr|lakh|lac|million|mn|billion|bn|k)?/gi;
  for (const match of text.matchAll(pattern)) {
    const base = Number(String(match[1] || '').replace(/,/g, ''));
    if (!Number.isFinite(base)) {
      continue;
    }
    const unit = String(match[2] || '').toLowerCase();
    const multiplier =
      unit === 'crore' || unit === 'cr'
        ? 10_000_000
        : unit === 'lakh' || unit === 'lac'
          ? 100_000
          : unit === 'million' || unit === 'mn'
            ? 1_000_000
            : unit === 'billion' || unit === 'bn'
              ? 1_000_000_000
              : unit === 'k'
                ? 1_000
                : 1;
    amounts.push(base * multiplier);
  }
  return amounts;
}

function hasOrderOfMagnitudeConflict(documentAmount: number, structuredAmount: number) {
  if (documentAmount <= 0 || structuredAmount <= 0) {
    return false;
  }
  const ratio = Math.max(documentAmount, structuredAmount) / Math.min(documentAmount, structuredAmount);
  return ratio >= 10;
}

export function runFundingDocumentQualityChecks(
  call: Pick<
    FundingCall,
    'open_date' | 'close_date' | 'is_rolling' | 'amount_min' | 'amount_max' | 'is_active'
  >,
  sections: FundingDocumentSectionDraft[],
  options: { documentKind?: FundingCallDocumentKind } = {}
): FundingDocumentQualityReport {
  const documentKind = options.documentKind || 'call_document';
  const byType = new Map(sections.map((section) => [section.sectionType, section]));
  const sectionsFor = (types: string[]) => sections.filter((section) => types.includes(section.sectionType));
  const combinedText = sections.map((section) => section.sectionText).join('\n\n');
  const flags: FundingDocumentQualityFlag[] = [];
  const conflicts: FundingDocumentQualityFlag[] = [];
  const presence = {
    eligibility: sectionsFor(['eligibility', 'consortium_partner_rules', 'exclusions']).length > 0 || /eligib|who can apply/i.test(combinedText),
    dates: sectionsFor(['important_dates', 'corrigendum_or_amendment']).length > 0 || /deadline|closing date|last date/i.test(combinedText),
    budget: sectionsFor(['budget_rules', 'funding_support']).length > 0 || /budget|funding support|award amount/i.test(combinedText),
    thematic: sectionsFor(['thematic_areas', 'objectives', 'overview']).length > 0 || /priority area|objective|scope/i.test(combinedText),
  };

  for (const [key, present] of Object.entries(presence)) {
    if (!present) {
      flags.push({
        code: `missing_${key}_section`,
        severity: 'warning',
        message: `Document did not expose a clear ${key.replace(/_/g, ' ')} section.`,
      });
    }
  }

  const dateSections = sectionsFor(['important_dates', 'corrigendum_or_amendment']);
  const dateText = (dateSections.length > 0 ? dateSections : sections).map((section) => section.sectionText).join('\n');
  const dates = extractDates(dateText);
  if (call.close_date && dates.length > 0) {
    const closest = dates.reduce((best, date) =>
      daysBetween(date, call.close_date!) < daysBetween(best, call.close_date!) ? date : best
    );
    if (daysBetween(closest, call.close_date) > 1) {
      const flag: FundingDocumentQualityFlag = {
        code: 'close_date_conflict',
        severity: 'conflict',
        message: 'Document date evidence may conflict with the structured close date.',
        sectionType: 'important_dates',
        pageStart: dateSections[0]?.startPage ?? null,
        pageEnd: dateSections[0]?.endPage ?? null,
        structuredValue: call.close_date.toISOString().slice(0, 10),
        documentValue: closest.toISOString().slice(0, 10),
      };
      conflicts.push(flag);
      flags.push(flag);
    }
  }

  if (call.open_date && dates.length > 0) {
    const matchingOpen = dates.some((date) => daysBetween(date, call.open_date!) <= 1);
    if (!matchingOpen && /opening date|start date|applications open/i.test(dateText)) {
      flags.push({
        code: 'open_date_unverified',
        severity: 'warning',
        message: 'Document mentions an opening date but it did not match the structured open date.',
        sectionType: 'important_dates',
        structuredValue: call.open_date.toISOString().slice(0, 10),
      });
    }
  }

  const budgetSections = sectionsFor(['budget_rules', 'funding_support']);
  const amounts = extractCurrencyAmounts(budgetSections.map((section) => section.sectionText).join('\n'));
  const structuredAmounts = [call.amount_min, call.amount_max].filter((value): value is number => typeof value === 'number' && value > 0);
  for (const structuredAmount of structuredAmounts) {
    const conflictAmount = amounts.find((amount) => hasOrderOfMagnitudeConflict(amount, structuredAmount));
    if (conflictAmount) {
      const flag: FundingDocumentQualityFlag = {
        code: 'budget_amount_conflict',
        severity: 'conflict',
        message: 'Document budget amount appears to differ from the structured funding amount by at least one order of magnitude.',
        sectionType: 'budget_rules',
        pageStart: budgetSections[0]?.startPage ?? null,
        pageEnd: budgetSections[0]?.endPage ?? null,
        structuredValue: structuredAmount,
        documentValue: conflictAmount,
      };
      conflicts.push(flag);
      flags.push(flag);
      break;
    }
  }

  if (call.is_active && /\b(closed|expired|no longer accepting|applications are closed)\b/i.test(combinedText)) {
    const flag: FundingDocumentQualityFlag = {
      code: 'closed_language_conflict',
      severity: 'conflict',
      message: 'Document text contains closed or expired language while the structured call is active.',
      sectionType: byType.get('important_dates') ? 'important_dates' : undefined,
      pageStart: byType.get('important_dates')?.startPage ?? null,
      pageEnd: byType.get('important_dates')?.endPage ?? null,
      structuredValue: true,
      documentValue: 'closed_or_expired_language',
    };
    conflicts.push(flag);
    flags.push(flag);
  }

  // Presence expectations and fact-conflict checks are written against the main
  // call document. Guideline annexes legitimately omit thematic/date sections, and
  // blank application templates trip both presence and conflict checks, so
  // downgrade what does not apply to the document's kind instead of flagging it.
  let adjustedFlags = flags;
  let adjustedConflicts = conflicts;
  if (documentKind !== 'call_document') {
    adjustedFlags = flags.map((flag) => {
      if (flag.code.startsWith('missing_') && flag.severity === 'warning') {
        return { ...flag, severity: 'info' as const };
      }
      if (documentKind === 'template_document' && flag.severity === 'conflict') {
        return { ...flag, severity: 'info' as const };
      }
      return flag;
    });
    adjustedConflicts = documentKind === 'template_document' ? [] : conflicts;
  }

  return {
    presence,
    flags: adjustedFlags,
    conflicts: adjustedConflicts,
    needsManualReview: adjustedFlags.some((flag) => flag.severity === 'warning' || flag.severity === 'conflict'),
  };
}

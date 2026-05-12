function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeContextSectionKey(value?: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]+/g, '');
}

function getSourceSectionKeysFromMeta(suggestionMeta?: Record<string, unknown> | null): string[] {
  const keys: string[] = [];
  const sources = Array.isArray(suggestionMeta?.sourceSections)
    ? suggestionMeta.sourceSections
    : [];
  for (const source of sources) {
    const sourceRecord = asObjectRecord(source);
    const sectionKey = String(sourceRecord?.sectionKey || '').trim();
    const label = String(sourceRecord?.label || '').trim();
    if (sectionKey) keys.push(sectionKey);
    if (label) keys.push(label);
  }

  const relevantSection = String(suggestionMeta?.relevantSection || '').trim();
  if (relevantSection) keys.push(relevantSection);

  const seen = new Set<string>();
  return keys.filter((key) => {
    const normalized = normalizeContextSectionKey(key);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function cleanContextText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function getSourceTextFromMeta(suggestionMeta?: Record<string, unknown> | null): string {
  return cleanContextText(suggestionMeta?.sourceText) || cleanContextText(suggestionMeta?.focusText);
}

function isStrictSourceScope(suggestionMeta?: Record<string, unknown> | null): boolean {
  const scopeMode = String(suggestionMeta?.scopeMode || '').trim();
  return scopeMode === 'selected_sections' || scopeMode === 'focused_text' || !!getSourceTextFromMeta(suggestionMeta);
}

function getSectionEntries(session: any): Array<{
  sectionKey: string;
  displayName?: string;
  title?: string;
  label?: string;
  content: string;
}> {
  const entries: Array<{
    sectionKey: string;
    displayName?: string;
    title?: string;
    label?: string;
    content: string;
  }> = [];

  if (Array.isArray(session?.paperSections)) {
    for (const section of session.paperSections) {
      const sectionKey = String(section?.sectionKey || '').trim();
      const content = cleanContextText(section?.content);
      if (!sectionKey || !content) continue;
      entries.push({
        sectionKey,
        displayName: cleanContextText(section?.displayName),
        title: cleanContextText(section?.title),
        label: cleanContextText(section?.label),
        content
      });
    }
  }

  const extraSections = session?.annexureDrafts?.[0]?.extraSections;
  if (extraSections && typeof extraSections === 'object' && !Array.isArray(extraSections)) {
    for (const [sectionKey, rawContent] of Object.entries(extraSections)) {
      const key = String(sectionKey || '').trim();
      const content = cleanContextText(rawContent);
      if (!key || !content) continue;
      entries.push({ sectionKey: key, label: key, content });
    }
  }

  return entries;
}

export function buildScopedPaperContext(
  session: any,
  suggestionMeta?: Record<string, unknown> | null
): string {
  const parts: string[] = [];
  const sourceKeys = getSourceSectionKeysFromMeta(suggestionMeta);
  const sourceText = getSourceTextFromMeta(suggestionMeta);
  const strictSourceScope = isStrictSourceScope(suggestionMeta);

  if (sourceText) {
    const sourceLabel = sourceKeys[0] || String(suggestionMeta?.relevantSection || 'selected_content');
    return `Selected draft content only:\n[${sourceLabel}] ${sourceText.slice(0, 5000)}`;
  }

  const sectionEntries = getSectionEntries(session);
  const sourceKeySet = new Set(sourceKeys.map(normalizeContextSectionKey));

  if (strictSourceScope) {
    const scopedEntries = sourceKeySet.size > 0
      ? sectionEntries.filter((s: any) => (
          sourceKeySet.has(normalizeContextSectionKey(s.sectionKey)) ||
          sourceKeySet.has(normalizeContextSectionKey(s.displayName)) ||
          sourceKeySet.has(normalizeContextSectionKey(s.title)) ||
          sourceKeySet.has(normalizeContextSectionKey(s.label))
        )).slice(0, 1)
      : [];
    const sectionSnippets = scopedEntries.map((s: any) => {
      const content = s.content.length > 5000 ? `${s.content.slice(0, 5000).trimEnd()}...` : s.content;
      return `[${s.sectionKey}] ${content}`;
    });
    return sectionSnippets.length > 0
      ? `Selected draft content only:\n${sectionSnippets.join('\n')}`
      : '';
  }

  const topic = session?.researchTopic;
  if (topic?.title) parts.push(`Draft title: "${topic.title}"`);
  if (topic?.abstractDraft) {
    const abstract = topic.abstractDraft.length > 500
      ? topic.abstractDraft.slice(0, 500) + '...'
      : topic.abstractDraft;
    parts.push(`Abstract: ${abstract}`);
  }

  const blueprint = session?.paperBlueprint;
  if (blueprint?.thesisStatement) parts.push(`Thesis: ${blueprint.thesisStatement}`);
  if (blueprint?.centralObjective) parts.push(`Objective: ${blueprint.centralObjective}`);

  if (sectionEntries.length > 0) {
    const scopedEntries = sourceKeySet.size > 0
      ? sectionEntries.filter((s: any) => (
          sourceKeySet.has(normalizeContextSectionKey(s.sectionKey)) ||
          sourceKeySet.has(normalizeContextSectionKey(s.displayName)) ||
          sourceKeySet.has(normalizeContextSectionKey(s.title)) ||
          sourceKeySet.has(normalizeContextSectionKey(s.label))
        )).slice(0, 1)
      : sectionEntries.slice(0, 4);
    const sectionSnippets = scopedEntries.map((s: any) => {
      const content = s.content.length > 800 ? `${s.content.slice(0, 800).trimEnd()}...` : s.content;
      return `[${s.sectionKey}] ${content}`;
    });
    if (sectionSnippets.length > 0) {
      parts.push(`Key draft sections:\n${sectionSnippets.join('\n')}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}

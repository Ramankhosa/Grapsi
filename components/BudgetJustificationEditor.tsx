// @ts-nocheck
import React from 'react';
import EnhancedRichTextEditor from './EnhancedRichTextEditor';

interface BudgetJustificationEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

/**
 * The budget editor is the section editor with more room.
 *
 * It used to carry a "Use plain text" toggle, which existed because the old
 * TinyMCE build could fail to load from its CDN — and switching to it turned a
 * pasted budget table into unusable run-together text. The editor is local now
 * and handles tables properly, so the escape hatch is gone.
 */
const BudgetJustificationEditor: React.FC<BudgetJustificationEditorProps> = ({
  value,
  onChange,
  placeholder = 'Set out each cost, what it buys, and why the project needs it.',
  readOnly = false,
}) => (
  <EnhancedRichTextEditor
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    readOnly={readOnly}
    minHeight={readOnly ? 0 : 420}
  />
);

export default BudgetJustificationEditor;

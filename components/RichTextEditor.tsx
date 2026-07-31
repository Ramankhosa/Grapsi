// @ts-nocheck
import React from 'react';
import EnhancedRichTextEditor from './EnhancedRichTextEditor';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: number;
}

/** The proposal section editor. See EnhancedRichTextEditor for the substance. */
const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Write or paste this section of your proposal.',
  readOnly = false,
  minHeight = 260,
}) => (
  <EnhancedRichTextEditor
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    readOnly={readOnly}
    // A read-only render should be as tall as its content, not padded out to a
    // fixed height — it sits inside comparison panels and disclosure blocks.
    minHeight={readOnly ? 0 : minHeight}
  />
);

export default RichTextEditor;

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

// Component that now uses our enhanced rich text editor
const RichTextEditor: React.FC<RichTextEditorProps> = ({ 
  value, 
  onChange, 
  placeholder = 'Enter text here...', 
  readOnly = false,
  minHeight = 200
}) => {
  return (
    <EnhancedRichTextEditor
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      minHeight={minHeight}
      autoExpand={true}
    />
  );
};

export default RichTextEditor; 
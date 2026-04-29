// @ts-nocheck
import React, { useState, useEffect } from 'react';
import EnhancedRichTextEditor from './EnhancedRichTextEditor';

interface BudgetJustificationEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

const BudgetJustificationEditor: React.FC<BudgetJustificationEditorProps> = ({
  value,
  onChange,
  placeholder = 'Enter your budget justification details here...',
  readOnly = false
}) => {
  const [editorContent, setEditorContent] = useState(value || '');

  // This is crucial to update when value changes from props
  useEffect(() => {
    if (value !== undefined) {
      setEditorContent(value);
    }
  }, [value]);

  const handleContentChange = (content: string) => {
    setEditorContent(content);
    onChange(content);
  };

  // Additional features and optimizations specific to budget data
  const [useFallbackMode, setUseFallbackMode] = useState(false);
  
  // Option to force plain text mode specifically for budget data
  const toggleFallbackMode = () => {
    setUseFallbackMode(!useFallbackMode);
  };

  return (
    <div className="budget-justification-editor">
      <div className="flex justify-end mb-1">
        <button 
          onClick={toggleFallbackMode}
          className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200"
          type="button"
        >
          {useFallbackMode ? "Use rich editor" : "Use plain text"}
        </button>
      </div>
      
      {useFallbackMode ? (
        <div className="border border-gray-300 rounded-md">
          <textarea 
            className="w-full h-full min-h-[450px] p-3 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={editorContent}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder=""
            readOnly={readOnly}
          />
        </div>
      ) : (
        <EnhancedRichTextEditor
          value={editorContent}
          onChange={handleContentChange}
          placeholder=""
          readOnly={readOnly}
          minHeight={450}
          autoExpand={true}
        />
      )}
    </div>
  );
};

export default BudgetJustificationEditor;

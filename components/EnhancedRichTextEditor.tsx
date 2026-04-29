// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@tinymce/tinymce-react';

interface EnhancedRichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: number;
  autoExpand?: boolean;
}

const EnhancedRichTextEditor: React.FC<EnhancedRichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Enter text here...',
  readOnly = false,
  minHeight = 400, // ~4 inches at 96dpi
  autoExpand = true
}) => {
  const editorRef = useRef<any>(null);
  const [editorContent, setEditorContent] = useState(value);
  const [editorFailed, setEditorFailed] = useState(false);
  const [editorLoading, setEditorLoading] = useState(true);
  const [plainTextFallback, setPlainTextFallback] = useState(false);

  // Update editor content when value prop changes
  useEffect(() => {
    setEditorContent(value);
  }, [value]);

  const handleEditorChange = (content: string) => {
    setEditorContent(content);
    onChange(content);
  };
  
  // Toggle to plain text mode
  const switchToPlainText = () => {
    setPlainTextFallback(true);
  };
  
  // Handle initialization errors
  const handleEditorFailure = (err: any) => {
    console.error("Rich text editor failed to initialize:", err);
    setEditorFailed(true);
    setPlainTextFallback(true);
  };

  return (
    <div className="relative border border-gray-300 rounded-md overflow-hidden">
      {plainTextFallback ? (
        // Plain text fallback mode
        <div className="fallback-editor">
          <div className="bg-yellow-50 p-2 border-b border-yellow-100 flex justify-between items-center">
            <span className="text-yellow-700 text-sm">
              Using plain text editor as fallback
            </span>
            <button 
              onClick={() => setPlainTextFallback(false)}
              className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-200"
            >
              Try rich editor
            </button>
          </div>
          <textarea
            className="w-full h-full min-h-[450px] p-3 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={editorContent}
            onChange={(e) => handleEditorChange(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            style={{ minHeight: `${minHeight}px` }}
          />
        </div>
      ) : (
        // TinyMCE rich editor (primary mode)
        <>
          <Editor
            apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY}
            onInit={(evt, editor) => {
              editorRef.current = editor;
              setEditorLoading(false);
            }}
            value={editorContent}
            onEditorChange={handleEditorChange}
            disabled={readOnly}
            init={{
              height: minHeight,
              menubar: false, // Hide menubar entirely
              statusbar: false, // Hide status bar
              plugins: [
                'paste', 'table', 'lists' // Minimal set to support toolbar actions
              ],
              toolbar: readOnly
                ? false
                : 'undo redo | bold italic underline | bullist numlist | table | removeformat',
              toolbar_sticky: false,
              toolbar_mode: 'sliding', // Use sliding mode for toolbar if it's ever shown
              content_style: `
                body { 
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; 
                  font-size: 14px; 
                  line-height: 1.6;
                  padding: 10px;
                }
                table {
                  border-collapse: collapse;
                  width: 100%;
                  margin-bottom: 1rem;
                }
                table td, table th {
                  border: 1px solid #ddd;
                  padding: 8px;
                }
                table tr:nth-child(even) {
                  background-color: #f9f9f9;
                }
                table tr:hover {
                  background-color: #f5f5f5;
                }
                table th {
                  padding-top: 10px;
                  padding-bottom: 10px;
                  text-align: left;
                  background-color: #f2f2f2;
                  color: #333;
                }
              `,
              placeholder: placeholder,
              readonly: readOnly,
              paste_data_images: true,
              paste_as_text: false,
              paste_enable_default_filters: true,
              paste_word_valid_elements: 'table,tr,td,th,tbody,thead,tfoot',
              paste_retain_style_properties: 'all',
              table_default_attributes: {
                border: '1'
              },
              table_default_styles: {
                'border-collapse': 'collapse',
                'width': '100%'
              },
              table_responsive_width: true,
              resize: autoExpand,
              autoresize_bottom_margin: 20,
              autoresize_overflow_padding: 20,
              setup: function(editor) {
                editor.on('init', function() {
                  // Make sure we're showing the existing content, not clearing it
                  if (editorContent && editorContent.length > 0) {
                    editor.setContent(editorContent);
                  }
                });
                
                // Handle editor errors
                editor.on('LoadError', function(e) {
                  console.error('TinyMCE Load Error:', e);
                  handleEditorFailure(e);
                });
                
                // Add plain text paste option in the context menu
                editor.ui.registry.addMenuItem('pastetextonly', {
                  text: 'Paste as plain text',
                  icon: 'paste-text',
                  onAction: function() {
                    editor.execCommand('mceTogglePlainTextPaste');
                  }
                });
                
                editor.ui.registry.addContextMenu('plaintext', {
                  update: function(element) {
                    return !editor.readonly ? 'pastetextonly' : '';
                  }
                });
              }
            }}
            onLoadError={handleEditorFailure}
          />
          
          {!editorFailed && !readOnly && !editorLoading && (
            <div className="p-1 bg-gray-50 border-t border-gray-200 flex justify-end">
              <button
                onClick={switchToPlainText}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center"
              >
                Switch to plain text editor
              </button>
            </div>
          )}
          
          {readOnly && (
            <div 
              className="absolute inset-0 z-10 bg-transparent cursor-not-allowed" 
              aria-hidden="true"
            ></div>
          )}
        </>
      )}
    </div>
  );
};

export default EnhancedRichTextEditor;

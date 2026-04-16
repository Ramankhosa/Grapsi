'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface TextSelection {
  text: string;
  start: number;
  end: number;
}

export interface FigurePlan {
  id: string;
  figureNo: number;
  title: string;
  caption?: string;
  description?: string;
  imagePath?: string;
  status: 'PLANNED' | 'GENERATING' | 'GENERATED' | 'FAILED';
  category?: string;
  figureType?: string;
}

export interface UseFloatingPanelOptions {
  sessionId: string;
  authToken: string | null;
  editorRef?: React.RefObject<{ 
    getSelectionInfo?: () => TextSelection | null;
    insertAtCursor?: (content: string) => void;
    replaceSelection?: (content: string) => void;
  }>;
  onContentChange?: (newContent: string) => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useFloatingPanel({
  sessionId,
  authToken,
  editorRef,
  onContentChange
}: UseFloatingPanelOptions) {
  // State
  const [isPanelVisible, setIsPanelVisible] = useState(true);
  const [figures, setFigures] = useState<FigurePlan[]>([]);
  const [selectedText, setSelectedText] = useState<TextSelection | null>(null);
  const [currentSection, setCurrentSection] = useState<string>('');
  const [currentContent, setCurrentContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyboard shortcut for toggling panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + . to toggle panel
      if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault();
        setIsPanelVisible(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch figures
  const fetchFigures = useCallback(async () => {
    if (!authToken || !sessionId) return;

    try {
      const response = await fetch(`/api/papers/${sessionId}/figures`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setFigures(data.figures || []);
      }
    } catch (err) {
      console.error('Failed to fetch figures:', err);
    }
  }, [authToken, sessionId]);

  // Initial fetch
  useEffect(() => {
    fetchFigures();
  }, [fetchFigures]);

  // Handle text selection in editor
  const handleSelectionChange = useCallback(() => {
    if (editorRef?.current?.getSelectionInfo) {
      const selection = editorRef.current.getSelectionInfo();
      setSelectedText(selection);
    } else {
      // Fallback to window selection
      const selection = window.getSelection();
      if (selection && selection.toString().trim()) {
        setSelectedText({
          text: selection.toString(),
          start: 0,
          end: selection.toString().length
        });
      } else {
        setSelectedText(null);
      }
    }
  }, [editorRef]);

  // Listen for selection changes
  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [handleSelectionChange]);

  // Insert figure reference at cursor
  const insertFigure = useCallback((figureId: string, position: 'cursor' | 'end' = 'cursor') => {
    const figure = figures.find(f => f.id === figureId);
    if (!figure) return;

    const figureRef = `[Figure ${figure.figureNo}]`;
    
    if (editorRef?.current?.insertAtCursor) {
      if (position === 'cursor') {
        editorRef.current.insertAtCursor(figureRef);
      }
    }

    return figureRef;
  }, [figures, editorRef]);

  // Perform text action
  const performTextAction = useCallback(async (
    action: 'rewrite' | 'expand' | 'condense' | 'formal' | 'simple' | 'create_sections',
    text: string,
    customInstructions?: string
  ): Promise<string> => {
    if (!authToken || !text.trim()) {
      throw new Error('Missing required parameters');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/papers/${sessionId}/text-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          action,
          selectedText: text,
          context: currentContent?.slice(0, 500), // First 500 chars as context
          sectionKey: currentSection,
          customInstructions
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Text action failed');
      }

      // Replace the selected text with transformed text
      if (editorRef?.current?.replaceSelection && data.transformedText) {
        editorRef.current.replaceSelection(data.transformedText);
      }

      return data.transformedText;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [authToken, sessionId, currentContent, currentSection, editorRef]);

  // Generate figure from description
  const generateFigure = useCallback(async (description: string) => {
    if (!authToken || !description.trim()) {
      throw new Error('Missing required parameters');
    }

    setIsLoading(true);
    setError(null);

    try {
      // First create the figure plan
      const createResponse = await fetch(`/api/papers/${sessionId}/figures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title: description.slice(0, 100),
          description,
          category: 'AUTO',
          figureType: 'auto'
        })
      });

      const createData = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createData.error || 'Failed to create figure');
      }

      // Then generate the figure
      const generateResponse = await fetch(
        `/api/papers/${sessionId}/figures/${createData.figure.id}/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            description,
            useLLM: true,
            theme: 'academic'
          })
        }
      );

      const generateData = await generateResponse.json();
      if (!generateResponse.ok) {
        throw new Error(generateData.error || 'Failed to generate figure');
      }

      // Refresh figures list
      await fetchFigures();

      return generateData;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Figure generation failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [authToken, sessionId, fetchFigures]);

  // Open citation picker (trigger in parent)
  const openCitationPicker = useCallback(() => {
    // This should be handled by the parent component
    // Emit a custom event that the parent can listen to
    window.dispatchEvent(new CustomEvent('open-citation-picker', {
      detail: { sessionId }
    }));
  }, [sessionId]);

  // Update section context
  const updateContext = useCallback((section: string, content: string) => {
    setCurrentSection(section);
    setCurrentContent(content);
  }, []);

  return {
    // State
    isPanelVisible,
    figures,
    selectedText,
    currentSection,
    currentContent,
    isLoading,
    error,

    // Actions
    setIsPanelVisible,
    fetchFigures,
    insertFigure,
    performTextAction,
    generateFigure,
    openCitationPicker,
    updateContext,
    setSelectedText
  };
}


'use client'

import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { forwardRef, useImperativeHandle, useEffect } from 'react'
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Undo,
  Redo,
  AlignLeft,
  AlignCenter,
  Indent,
  Outdent,
  Type,
  Pilcrow
} from 'lucide-react'

interface RichTextEditorProps {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  minHeight?: string
  showToolbar?: boolean
  toolbarPosition?: 'top' | 'bottom'
  variant?: 'default' | 'claims' | 'minimal'
}

export interface RichTextEditorRef {
  getHTML: () => string
  getText: () => string
  setContent: (content: string) => void
  insertContent: (content: string) => void
  focus: () => void
  isEmpty: () => boolean
}

const MenuButton = ({
  onClick,
  isActive,
  disabled,
  children,
  title
}: {
  onClick: () => void
  isActive?: boolean
  disabled?: boolean
  children: React.ReactNode
  title?: string
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`p-1.5 rounded transition-colors ${
      isActive
        ? 'bg-indigo-100 text-indigo-700'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    } disabled:opacity-50 disabled:cursor-not-allowed`}
  >
    {children}
  </button>
)

const EditorToolbar = ({
  editor,
  variant = 'default'
}: {
  editor: Editor | null
  variant?: 'default' | 'claims' | 'minimal'
}) => {
  if (!editor) return null

  const isMinimal = variant === 'minimal'

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50/50 flex-wrap">
      {/* Text formatting */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-gray-200 mr-2">
        <MenuButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold (Ctrl+B)"
        >
          <Bold className="w-4 h-4" />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic (Ctrl+I)"
        >
          <Italic className="w-4 h-4" />
        </MenuButton>
      </div>

      {/* Headings - not shown in minimal mode */}
      {!isMinimal && (
        <div className="flex items-center gap-0.5 pr-2 border-r border-gray-200 mr-2">
          <MenuButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            isActive={editor.isActive('heading', { level: 3 })}
            title="Heading"
          >
            <Type className="w-4 h-4" />
          </MenuButton>
          <MenuButton
            onClick={() => editor.chain().focus().setParagraph().run()}
            isActive={editor.isActive('paragraph')}
            title="Paragraph"
          >
            <Pilcrow className="w-4 h-4" />
          </MenuButton>
        </div>
      )}

      {/* Lists */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-gray-200 mr-2">
        <MenuButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet List"
        >
          <List className="w-4 h-4" />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Numbered List"
        >
          <ListOrdered className="w-4 h-4" />
        </MenuButton>
      </div>

      {/* Indentation - important for claims */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-gray-200 mr-2">
        <MenuButton
          onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
          disabled={!editor.can().sinkListItem('listItem')}
          title="Increase Indent"
        >
          <Indent className="w-4 h-4" />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().liftListItem('listItem').run()}
          disabled={!editor.can().liftListItem('listItem')}
          title="Decrease Indent"
        >
          <Outdent className="w-4 h-4" />
        </MenuButton>
      </div>

      {/* Alignment - not shown in minimal mode */}
      {!isMinimal && (
        <div className="flex items-center gap-0.5 pr-2 border-r border-gray-200 mr-2">
          <MenuButton
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            isActive={editor.isActive({ textAlign: 'left' })}
            title="Align Left"
          >
            <AlignLeft className="w-4 h-4" />
          </MenuButton>
          <MenuButton
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            isActive={editor.isActive({ textAlign: 'center' })}
            title="Align Center"
          >
            <AlignCenter className="w-4 h-4" />
          </MenuButton>
        </div>
      )}

      {/* Undo/Redo */}
      <div className="flex items-center gap-0.5 ml-auto">
        <MenuButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo (Ctrl+Z)"
        >
          <Undo className="w-4 h-4" />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo (Ctrl+Y)"
        >
          <Redo className="w-4 h-4" />
        </MenuButton>
      </div>
    </div>
  )
}

const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
  (
    {
      value = '',
      onChange,
      placeholder = 'Start typing...',
      disabled = false,
      className = '',
      minHeight = '200px',
      showToolbar = true,
      toolbarPosition = 'top',
      variant = 'default'
    },
    ref
  ) => {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: {
            levels: [1, 2, 3]
          },
          bulletList: {
            keepMarks: true,
            keepAttributes: false
          },
          orderedList: {
            keepMarks: true,
            keepAttributes: false
          }
        }),
        TextAlign.configure({
          types: ['heading', 'paragraph']
        })
      ],
      content: value,
      editable: !disabled,
      immediatelyRender: false, // Prevent SSR hydration mismatches
      editorProps: {
        attributes: {
          class: `prose prose-sm max-w-none focus:outline-none ${
            variant === 'claims'
              ? 'px-0 py-0 text-gray-700 leading-relaxed'
              : 'px-4 py-3'
          } ${
            variant === 'claims' ? 'prose-claims' : ''
          }`,
          style: `min-height: ${minHeight}`
        }
      },
      onUpdate: ({ editor }) => {
        onChange?.(editor.getHTML())
      }
    })

    // Sync external value changes
    useEffect(() => {
      if (editor && value !== editor.getHTML()) {
        editor.commands.setContent(value)
      }
    }, [value, editor])

    // Update editable state
    useEffect(() => {
      if (editor) {
        editor.setEditable(!disabled)
      }
    }, [disabled, editor])

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      getHTML: () => editor?.getHTML() || '',
      getText: () => editor?.getText() || '',
      setContent: (content: string) => {
        // Avoid firing change handlers when imperatively setting content
        editor?.commands.setContent(content, { emitUpdate: false })
      },
      insertContent: (content: string) => {
        if (!editor) return
        editor.chain().focus().insertContent(content).run()
      },
      focus: () => {
        editor?.commands.focus()
      },
      isEmpty: () => editor?.isEmpty || true
    }))

    const isNormalizedStyle = variant === 'claims';

    return (
      <div
        className={`${
          isNormalizedStyle
            ? `text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded border border-gray-100 ${disabled ? 'bg-gray-100 opacity-75' : ''}`
            : `border border-gray-300 rounded-lg overflow-hidden bg-white transition-colors focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 ${
                disabled ? 'bg-gray-50 opacity-75' : ''
              }`
        } ${className}`}
      >
        {showToolbar && toolbarPosition === 'top' && (
          <EditorToolbar editor={editor} variant={variant} />
        )}
        
        <div className="relative">
          <EditorContent editor={editor} />
          {editor?.isEmpty && placeholder && (
            <div className={`absolute text-gray-400 pointer-events-none select-none ${
              variant === 'claims' ? 'top-0 left-0' : 'top-3 left-4'
            }`}>
              {placeholder}
            </div>
          )}
        </div>

        {showToolbar && toolbarPosition === 'bottom' && (
          <EditorToolbar editor={editor} variant={variant} />
        )}
      </div>
    )
  }
)

RichTextEditor.displayName = 'RichTextEditor'

export default RichTextEditor

// Claims-specific editor with pre-configured settings
export const ClaimsEditor = forwardRef<RichTextEditorRef, Omit<RichTextEditorProps, 'variant'>>(
  (props, ref) => (
    <RichTextEditor
      ref={ref}
      {...props}
      variant="claims"
      showToolbar={false}
      placeholder="1. A method for... comprising:
   a) a first step of...
   b) a second step of...

2. The method of claim 1, wherein..."
      minHeight="300px"
    />
  )
)

ClaimsEditor.displayName = 'ClaimsEditor'

// Section editor for drafting stages
export const SectionEditor = forwardRef<RichTextEditorRef, Omit<RichTextEditorProps, 'variant'>>(
  (props, ref) => (
    <RichTextEditor
      ref={ref}
      {...props}
      variant="default"
      minHeight="250px"
    />
  )
)

SectionEditor.displayName = 'SectionEditor'


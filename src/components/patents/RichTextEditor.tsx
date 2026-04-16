'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Color } from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import { useCallback, useEffect, useState } from 'react'

interface RichTextEditorProps {
  content?: string
  onChange?: (html: string) => void
  placeholder?: string
  className?: string
}

export default function RichTextEditor({
  content = '',
  onChange,
  placeholder = 'Start writing your patent annexure...',
  className = ''
}: RichTextEditorProps) {
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Color,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      onChange?.(html)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[400px] p-4',
      },
    },
    immediatelyRender: false,
  })

  const addLink = useCallback(() => {
    const url = window.prompt('Enter URL:')
    if (url) {
      editor?.chain().focus().setLink({ href: url }).run()
    }
  }, [editor])

  if (!isMounted || !editor) {
    return (
      <div className={`border border-gray-300 rounded-lg ${className}`}>
        <div className="min-h-[400px] p-4 flex items-center justify-center">
          <div className="animate-pulse text-gray-400">Loading editor...</div>
        </div>
      </div>
    )
  }

  return (
    <div className={`border border-gray-300 rounded-lg ${className}`}>
      {/* Toolbar */}
      <div className="border-b border-gray-300 p-3 bg-gray-50 flex flex-wrap gap-2">
        {/* Text Formatting */}
        <div className="flex gap-1">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('bold') ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <strong>B</strong>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('italic') ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <em>I</em>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('strike') ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <s>U</s>
          </button>
        </div>

        {/* Headings */}
        <div className="flex gap-1">
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('heading', { level: 1 }) ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            H1
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('heading', { level: 2 }) ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            H2
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('heading', { level: 3 }) ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-300 hover:bg-gray-50'
            }`}
          >
            H3
          </button>
        </div>

        {/* Lists */}
        <div className="flex gap-1">
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('bulletList') ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            • List
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('orderedList') ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            1. List
          </button>
        </div>

        {/* Text Alignment */}
        <div className="flex gap-1">
          <button
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive({ textAlign: 'left' }) ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            ⬅
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive({ textAlign: 'center' }) ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            ⬌
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive({ textAlign: 'right' }) ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            ➡
          </button>
        </div>

        {/* Links */}
        <div className="flex gap-1">
          <button
            onClick={addLink}
            className="px-3 py-1 rounded text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
          >
            🔗 Link
          </button>
        </div>

        {/* Undo/Redo */}
        <div className="flex gap-1 ml-auto">
          <button
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className="px-3 py-1 rounded text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ↶ Undo
          </button>
          <button
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className="px-3 py-1 rounded text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ↷ Redo
          </button>
        </div>
      </div>

      {/* Editor Content */}
      <div className="min-h-[400px]">
        <EditorContent
          editor={editor}
          className="prose max-w-none"
          placeholder={placeholder}
        />
      </div>

      {/* Character/Word Count */}
      <div className="border-t border-gray-300 px-3 py-2 bg-gray-50 text-xs text-gray-600">
        {editor.storage.characterCount?.characters() || 0} characters, {editor.storage.characterCount?.words() || 0} words
      </div>
    </div>
  )
}

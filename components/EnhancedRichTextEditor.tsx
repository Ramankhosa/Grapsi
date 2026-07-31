// @ts-nocheck
import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import { Placeholder } from '@tiptap/extensions';
import {
  FaBold,
  FaItalic,
  FaUnderline,
  FaListUl,
  FaListOl,
  FaTable,
  FaUndo,
  FaRedo,
  FaSuperscript,
  FaSubscript,
  FaEraser,
  FaPlus,
  FaMinus,
  FaObjectGroup,
  FaObjectUngroup,
  FaTrash,
  FaHeading,
} from 'react-icons/fa';

/**
 * The proposal editor.
 *
 * Replaces TinyMCE, which was a cloud-hosted script keyed off
 * NEXT_PUBLIC_TINYMCE_API_KEY — if the key was missing or the CDN was slow the
 * editor silently degraded to a plain <textarea>, which is why this file used
 * to carry a whole "editor failed, switch to plain text" fallback path. Budgets
 * and workplans pasted as tables came out as unusable text in that mode.
 *
 * TipTap (MIT, ProseMirror underneath) is already a dependency of this repo, so
 * this adds nothing to the bundle manifest and runs entirely locally. Tables
 * are first-class: real row/column/header/merge editing, column resizing, and
 * ProseMirror's HTML paste parser keeps table structure when content comes in
 * from Word or Excel.
 *
 * The props contract is unchanged — `value` in and `onChange` out are both HTML
 * strings — so everything downstream (the DOCX export, proposalSplit, and
 * ReviewerText's HTML-to-text pass) keeps working.
 */

interface EnhancedRichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: number;
  autoExpand?: boolean;
}

const Btn = ({ onClick, active, disabled, title, children }) => (
  <button
    type="button"
    onMouseDown={e => e.preventDefault()} // keep the selection while clicking
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    aria-pressed={active ? true : undefined}
    className={`inline-flex h-7 min-w-[28px] items-center justify-center gap-1 rounded px-1.5 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cobalt-600 disabled:cursor-not-allowed disabled:opacity-40 ${
      active
        ? 'bg-cobalt-50 text-cobalt-700'
        : 'text-nickel-600 hover:bg-nickel-100 hover:text-nickel-900'
    }`}
  >
    {children}
  </button>
);

const Divider = () => <span className="mx-1 h-4 w-px shrink-0 bg-nickel-200" aria-hidden="true" />;

function Toolbar({ editor }) {
  if (!editor) return null;

  const inTable = editor.isActive('table');

  return (
    <div className="border-b border-nickel-200 bg-nickel-25">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5">
        <Btn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold"
        >
          <FaBold />
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic"
        >
          <FaItalic />
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          title="Underline"
        >
          <FaUnderline />
        </Btn>

        <Divider />

        <Btn
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          title="Sub-heading"
        >
          <FaHeading />
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bulleted list"
        >
          <FaListUl />
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <FaListOl />
        </Btn>

        <Divider />

        {/* Units, isotopes and formulae turn up constantly in method sections. */}
        <Btn
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          active={editor.isActive('superscript')}
          title="Superscript"
        >
          <FaSuperscript />
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          active={editor.isActive('subscript')}
          title="Subscript"
        >
          <FaSubscript />
        </Btn>

        <Divider />

        <Btn
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
          active={inTable}
          title="Insert a table"
        >
          <FaTable />
          <span className="hidden sm:inline">Table</span>
        </Btn>

        <Divider />

        <Btn
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          title="Clear formatting"
        >
          <FaEraser />
        </Btn>

        <div className="ml-auto flex items-center gap-0.5">
          <Btn
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo"
          >
            <FaUndo />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo"
          >
            <FaRedo />
          </Btn>
        </div>
      </div>

      {/* Table controls appear only with the cursor inside a table. Showing
          nine permanently-disabled buttons taught users nothing. */}
      {inTable && (
        <div className="flex flex-wrap items-center gap-0.5 border-t border-nickel-200 bg-cobalt-50/60 px-2 py-1.5">
          <span className="nk-eyebrow mr-1.5 text-cobalt-700">Table</span>

          <Btn onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column">
            <FaPlus />
            <span className="hidden sm:inline">Col</span>
          </Btn>
          <Btn onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column">
            <FaMinus />
            <span className="hidden sm:inline">Col</span>
          </Btn>

          <Divider />

          <Btn onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row">
            <FaPlus />
            <span className="hidden sm:inline">Row</span>
          </Btn>
          <Btn onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row">
            <FaMinus />
            <span className="hidden sm:inline">Row</span>
          </Btn>

          <Divider />

          <Btn
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
            title="Toggle header row"
          >
            Header
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().mergeCells().run()}
            disabled={!editor.can().mergeCells()}
            title="Merge selected cells"
          >
            <FaObjectGroup />
          </Btn>
          <Btn
            onClick={() => editor.chain().focus().splitCell().run()}
            disabled={!editor.can().splitCell()}
            title="Split cell"
          >
            <FaObjectUngroup />
          </Btn>

          <Btn
            onClick={() => editor.chain().focus().deleteTable().run()}
            title="Delete the whole table"
          >
            <span className="text-red-600">
              <FaTrash />
            </span>
          </Btn>
        </div>
      )}
    </div>
  );
}

const EnhancedRichTextEditor: React.FC<EnhancedRichTextEditorProps> = ({
  value,
  onChange,
  placeholder = 'Enter text here…',
  readOnly = false,
  minHeight = 400,
}) => {
  const editor = useEditor({
    // StarterKit v3 already bundles Underline, Link and undo/redo — adding them
    // again registers duplicate extensions.
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      TableKit.configure({
        table: { resizable: true, allowTableNodeSelection: true },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Superscript,
      Subscript,
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    editable: !readOnly,
    immediatelyRender: false, // pages router renders on the server first
    editorProps: {
      attributes: {
        class: 'rte-surface focus:outline-none',
        style: `min-height:${minHeight}px`,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Take in external changes (loading a draft, switching version) without
  // stamping on the cursor while someone is typing.
  useEffect(() => {
    if (!editor) return;
    const incoming = value || '';
    if (incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [readOnly, editor]);

  if (readOnly) {
    return (
      <div className="rte-content rte-readonly">
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <div className="rte-content overflow-hidden rounded-lg border border-nickel-200 bg-white focus-within:border-cobalt-600 focus-within:ring-2 focus-within:ring-cobalt-100">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <p className="border-t border-nickel-200 bg-nickel-25 px-3 py-1.5 text-[11.5px] leading-4 text-nickel-500">
        Tables paste in from Word and Excel with their rows and columns intact.
        Drag a column edge to resize.
      </p>
    </div>
  );
};

export default EnhancedRichTextEditor;

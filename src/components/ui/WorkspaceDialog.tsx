'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useId, useRef, type ReactNode } from 'react'

/** A controlled dialog with focus containment, Escape and return-to-trigger focus. */
export default function WorkspaceDialog({ open, onOpenChange, title, description, children, sheet = false, busy = false, sheetWidth = 'w-[min(92vw,420px)]' }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string
  children: ReactNode; sheet?: boolean; busy?: boolean
  /** Width class for a sheet; wider reading panels pass their own. */
  sheetWidth?: string
}) {
  const returnFocus = useRef<HTMLElement | null>(null)
  const descriptionId = useId()
  return <Dialog.Root open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm" />
      <Dialog.Content onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={event => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus() } }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onPointerDownOutside={event => { if (busy) event.preventDefault() }}
        aria-describedby={description ? descriptionId : undefined}
        className={sheet ? `fixed inset-y-0 right-0 z-50 flex ${sheetWidth} flex-col overflow-y-auto bg-white p-5 shadow-2xl outline-none` : 'fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none'}>
        <div className="mb-5 pr-9"><Dialog.Title className="text-lg font-semibold tracking-tight text-slate-950">{title}</Dialog.Title>
          {description && <Dialog.Description id={descriptionId} className="mt-2 text-sm leading-6 text-slate-500">{description}</Dialog.Description>}</div>
        <Dialog.Close disabled={busy} aria-label="Close dialog" className="absolute right-4 top-4 rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-500"><X className="h-5 w-5" /></Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

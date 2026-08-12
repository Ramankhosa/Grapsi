// @ts-nocheck
import { useState } from 'react'
import axios from 'axios'
import { toast } from 'react-hot-toast'
import RichTextEditor from '../../../components/RichTextEditor'
import BudgetJustificationEditor from '../../../components/BudgetJustificationEditor'
import PreviousRemarksPanel from './PreviousRemarksPanel'

/**
 * Revise a section without leaving the page.
 *
 * The flow this replaces sent the user to /section/new, where the prominent
 * "Revise Section" button opened an *empty* editor — the draft had to be pasted
 * back in by hand — while the control that actually preserved the text was a
 * checkbox that navigated on change and could never be unchecked. Submitting
 * then dropped the user on the hub with an unreviewed draft and no prompt, so
 * the revision loop never closed on its own.
 *
 * Here the editor opens pre-filled, the previous remarks sit beside it, and one
 * action saves the new version and reviews it.
 */

type Stage = 'idle' | 'saving' | 'reviewing'

export default function RevisionComposer({
  callId,
  section,
  onCancel,
  onComplete,
}: {
  callId: string
  /** The version being revised — its text seeds the editor. */
  section: any
  onCancel: () => void
  onComplete: (newSectionId: string) => void
}) {
  const [content, setContent] = useState(section?.user_input || '')
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState('')

  const isBudget = String(section?.section_title || '').toLowerCase().includes('budget')
  const busy = stage !== 'idle'
  const unchanged = content.trim() === String(section?.user_input || '').trim()

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError('Add the revised text before submitting.')
      return
    }

    let newSectionId = null

    try {
      setError('')
      setStage('saving')

      const createRes = await axios.post(`/api/reviewer/calls/${callId}/sections`, {
        section_title: section.section_title,
        user_input: content,
        is_revision: true,
        previous_section_id: section.id,
      })

      newSectionId = createRes?.data?.section?.id
      if (!newSectionId) throw new Error('The new version was not created.')
    } catch (err) {
      console.error('Failed to save revision', err)
      setError(err?.response?.data?.error || "Couldn't save this revision. Your text is still here — try again.")
      setStage('idle')
      return
    }

    // The version exists from here on. A review failure must not lose it, so
    // the user is handed to the new version either way.
    try {
      setStage('reviewing')
      const reviewRes = await axios.post(`/api/reviewer/calls/${callId}/sections/${newSectionId}/review`)
      // The API refreshes the panel report when one already exists, so the
      // revision loop now closes on its own instead of leaving an "out of date"
      // badge for the user to chase.
      toast.success(
        reviewRes?.data?.report_refreshed
          ? 'Revision reviewed and the panel report updated'
          : 'Revision reviewed'
      )
    } catch (err) {
      console.error('Failed to review revision', err)
      const status = err?.response?.status
      toast.error(
        status === 429
          ? 'Saved. The reviewer is rate limited — run the review again in a minute.'
          : 'Saved, but the review failed. You can run it from the section page.'
      )
    } finally {
      setStage('idle')
      onComplete(newSectionId)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="nk-panel min-w-0">
        <div className="nk-panel-head">
          <div>
            <h2 className="nk-title">Revising {section.section_title}</h2>
            <p className="nk-sub mt-0.5">
              Saved as v{(section.version || 1) + 1}. v{section.version || 1} is kept.
            </p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} className="nk-btn-ghost nk-btn-sm">
            Cancel
          </button>
        </div>

        <div className="p-5">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700"
            >
              {error}
            </div>
          )}

          {isBudget ? (
            <BudgetJustificationEditor value={content} onChange={setContent} readOnly={busy} />
          ) : (
            <RichTextEditor
              value={content}
              onChange={setContent}
              readOnly={busy}
              placeholder="Revise this section to answer the remarks alongside."
            />
          )}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-nickel-200 pt-4">
            {unchanged && !busy && (
              <span className="mr-auto text-[12.5px] text-nickel-500">
                Nothing has changed yet.
              </span>
            )}
            <button type="button" onClick={onCancel} disabled={busy} className="nk-btn-secondary nk-btn-sm">
              Discard
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !content.trim()}
              className="nk-btn-primary nk-btn-sm"
            >
              {stage === 'saving'
                ? 'Saving…'
                : stage === 'reviewing'
                  ? 'Reviewing and updating the report…'
                  : 'Submit and review'}
            </button>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="xl:sticky xl:top-[84px]">
          <PreviousRemarksPanel review={section.ai_review_json} version={section.version} />
        </div>
      </div>
    </div>
  )
}

export type GrantReminderState = 'NONE' | 'PENDING' | 'SENDING' | 'SENT' | 'FAILED'
export interface PersonalGrantEvent {
  id: string
  title: string
  event_at: string
  timezone: string
  reminder_at: string | null
  reminder_state: GrantReminderState
  sent_at: string | null
  revision: number
}
export interface PersonalGrant {
  id: string
  funding_call_id: string
  is_favourite: boolean
  notes: string
  notes_revision: number
  events: PersonalGrantEvent[]
  funding_call?: { id: string; title: string; scheme_title: string | null; agencyName: string | null; agency_name: string | null; deadlineAt: string | null; close_date: string | null }
}
export type PersonalCalendarEvent = PersonalGrantEvent & { personal_grant: PersonalGrant }

export type ProjectAccessLevel = 'owner' | 'editor' | 'viewer'

export type ProjectCapability =
  | 'read'
  | 'editContent'
  | 'renameProject'
  | 'deleteProject'
  | 'manageCollaborators'

export interface ProjectAccessCapabilities {
  read: boolean
  editContent: boolean
  renameProject: boolean
  deleteProject: boolean
  manageCollaborators: boolean
}

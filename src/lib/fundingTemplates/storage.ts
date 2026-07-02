import fs from 'fs/promises'
import path from 'path'

export const TEMPLATE_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'funding-templates')
export const INTAKE_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'funding-intake')

function isWithinRoot(candidatePath: string, rootPath: string) {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export async function resolveManagedFundingAssetPath(storagePath: string) {
  const resolvedPath = path.resolve(path.isAbsolute(storagePath) ? storagePath : path.join(process.cwd(), storagePath))
  const resolvedRoots = [TEMPLATE_UPLOAD_DIR, INTAKE_UPLOAD_DIR].map((root) => path.resolve(root))

  if (!resolvedRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    throw new Error('Template asset storage path is outside the managed upload directories')
  }

  const [realPath, existingRoots] = await Promise.all([
    fs.realpath(resolvedPath),
    Promise.all(resolvedRoots.map((root) => fs.realpath(root).catch(() => root))),
  ])

  if (!existingRoots.some((root) => isWithinRoot(realPath, root))) {
    throw new Error('Template asset storage path resolves outside the managed upload directories')
  }

  return realPath
}

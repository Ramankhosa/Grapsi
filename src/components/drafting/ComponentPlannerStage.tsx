'use client'

import React, { useState, useEffect } from 'react'

interface ComponentPlannerStageProps {
  session: any
  patent: any
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

interface Component {
  id: string
  name: string
  type: string
  description: string
  numeral?: number
  range?: string
}

const COMPONENT_TYPES = [
  { value: 'MAIN_CONTROLLER', label: 'Main Controller (100s)' },
  { value: 'SUBSYSTEM', label: 'Subsystem (200s)' },
  { value: 'MODULE', label: 'Module (300s)' },
  { value: 'INTERFACE', label: 'Interface (400s)' },
  { value: 'SENSOR', label: 'Sensor/Actuator (500s)' },
  { value: 'ACTUATOR', label: 'Actuator (500s)' },
  { value: 'PROCESSOR', label: 'Processor (600s)' },
  { value: 'MEMORY', label: 'Memory (700s)' },
  { value: 'DISPLAY', label: 'Display (800s)' },
  { value: 'COMMUNICATION', label: 'Communication (900s)' },
  { value: 'POWER_SUPPLY', label: 'Power Supply (900s)' },
  { value: 'OTHER', label: 'Other' }
]

export default function ComponentPlannerStage({ session, patent, onComplete, onRefresh }: ComponentPlannerStageProps) {
  // Initialize components from referenceMap if available, otherwise from idea record
  const getInitialComponents = () => {
    const validTypes = ['MAIN_CONTROLLER', 'SUBSYSTEM', 'MODULE', 'INTERFACE', 'SENSOR', 'ACTUATOR', 'PROCESSOR', 'MEMORY', 'DISPLAY', 'COMMUNICATION', 'POWER_SUPPLY', 'OTHER'];
    
    if (session?.referenceMap?.components) {
      // Normalize existing components from referenceMap
      return session.referenceMap.components.map((comp: any) => ({
        ...comp,
        type: validTypes.includes(comp.type) ? comp.type : 'OTHER',
        description: comp.description || ''
      }))
    }

    // Convert idea record components to component planner format
    if (session?.ideaRecord?.components) {
      return session.ideaRecord.components.map((comp: any, index: number) => {
        const normalizedType = validTypes.includes(comp.type) ? comp.type : 'OTHER';
        return {
          id: comp.name?.toLowerCase().replace(/\s+/g, '_') || `component_${index}`,
          name: comp.name || `Component ${index + 1}`,
          type: normalizedType,
          description: comp.description || '',
          numeral: undefined,
          range: undefined
        };
      })
    }

    return []
  }

  const [components, setComponents] = useState<Component[]>(getInitialComponents())
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [showRanges, setShowRanges] = useState(false)

  const addComponent = () => {
    const newComponent: Component = {
      id: crypto.randomUUID(),
      name: '',
      type: 'OTHER',
      description: '',
      numeral: undefined
    }
    setComponents([...components, newComponent])
    setIsDirty(true)
  }

  const addSubmodule = (parentId: string) => {
    const newComponent: Component = {
      id: crypto.randomUUID(),
      name: '',
      type: 'MODULE',
      description: '',
      numeral: undefined
    }
    // @ts-ignore store parent linkage for persistence
    ;(newComponent as any).parentId = parentId
    setComponents([...components, newComponent])
    setIsDirty(true)
  }

  const updateComponent = (id: string, updates: Partial<Component>) => {
    setComponents(components.map(comp =>
      comp.id === id ? { ...comp, ...updates } : comp
    ))
    setIsDirty(true)
  }

  const removeComponent = (id: string) => {
    // Cascade remove: delete the node and all descendants
    const idsToRemove = new Set<string>()
    const collect = (targetId: string) => {
      idsToRemove.add(targetId)
      components.forEach((c: any) => {
        if ((c as any).parentId === targetId) collect(c.id)
      })
    }
    collect(id)
    setComponents(components.filter((comp) => !idsToRemove.has(comp.id)))
    setIsDirty(true)
  }

  const handleAutoAssignNumerals = async () => {
    if (components.length === 0) {
      setError('Add at least one component first')
      return
    }

    // Check for empty component names
    const emptyNames = components.filter(comp => !comp.name.trim())
    if (emptyNames.length > 0) {
      setError(`Please provide names for all components before auto-assigning numerals. ${emptyNames.length} component(s) have empty names.`)
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      // Filter out components with empty names and validate data
      const validComponents = components
        .filter(comp => comp.name && comp.name.trim())
        .map(comp => {
          // Normalize type to a valid value
          const validTypes = ['MAIN_CONTROLLER', 'SUBSYSTEM', 'MODULE', 'INTERFACE', 'SENSOR', 'ACTUATOR', 'PROCESSOR', 'MEMORY', 'DISPLAY', 'COMMUNICATION', 'POWER_SUPPLY', 'OTHER'];
          const normalizedType = validTypes.includes(comp.type) ? comp.type : 'OTHER';
          
          return {
            id: comp.id,
            name: comp.name.trim(),
            type: normalizedType,
            description: (comp.description || '').trim(),
            numeral: typeof comp.numeral === 'number' ? comp.numeral : undefined,
            // @ts-ignore include optional parentId for submodules
            parentId: (comp as any).parentId || undefined
          };
        });

      if (validComponents.length === 0) {
        setError('No valid components found. Please ensure all components have names.');
        setIsProcessing(false);
        return;
      }

      console.log('Sending components for validation:', validComponents);

      const result = await onComplete({
        action: 'update_component_map',
        sessionId: session?.id,
        components: validComponents
      })

      if (result.referenceMap) {
        setComponents(result.referenceMap.components)
        setValidationErrors([])
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to assign numerals'
      setError(errorMessage)

      // Try to extract validation errors
      if (errorMessage.includes('validation')) {
        try {
          const errorData = JSON.parse(errorMessage.split('validation errors: ')[1] || '[]')
          setValidationErrors(errorData)
        } catch {
          setValidationErrors([errorMessage])
        }
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const canProceed = components.length > 0 && components.every(comp =>
    comp.name.trim() && comp.numeral !== undefined
  )

  const handleSaveComponents = async () => {
    if (components.length === 0) {
      setError('Add at least one component first')
      return
    }
    setIsProcessing(true)
    setError(null)
    try {
      // Filter out components with empty names and validate data
      const validComponents = components
        .filter(comp => comp.name && comp.name.trim())
        .map(comp => ({
          id: comp.id,
          name: comp.name.trim(),
          type: comp.type,
          description: comp.description.trim(),
          numeral: comp.numeral,
          // @ts-ignore parent linkage
          parentId: (comp as any).parentId
        }));

      if (validComponents.length === 0) {
        setError('No valid components found. Please ensure all components have names.');
        setIsProcessing(false);
        return;
      }

      const result = await onComplete({
        action: 'update_component_map',
        sessionId: session?.id,
        components: validComponents
      })
      if (result.referenceMap) {
        setComponents(result.referenceMap.components)
        setValidationErrors([])
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save components'
      setError(errorMessage)
      if (errorMessage.includes('validation')) {
        try {
          const errorData = JSON.parse(errorMessage.split('validation errors: ')[1] || '[]')
          setValidationErrors(errorData)
        } catch {
          setValidationErrors([errorMessage])
        }
      }
    } finally {
      setIsProcessing(false)
    }
  }

  // Build a hierarchical tree from flat components using parentId
  type CompAny = Component & { parentId?: string }
  const buildTree = () => {
    const byId: Record<string, CompAny & { children: CompAny[] }> = {}
    ;(components as any as CompAny[]).forEach((c) => {
      byId[c.id] = { ...(c as any), children: [] }
    })
    const roots: (CompAny & { children: CompAny[] })[] = []
    ;(components as any as CompAny[]).forEach((c) => {
      const pid = (c as any).parentId
      if (pid && byId[pid]) {
        byId[pid].children.push(byId[c.id])
      } else {
        roots.push(byId[c.id])
      }
    })
    return roots
  }

  const tree = buildTree()

  const renderRow = (node: any, level: number) => (
    <tr key={node.id} className="group hover:bg-gray-50/80 transition-colors border-b border-gray-100 last:border-0">
      <td className="px-4 py-3 whitespace-nowrap">
        <div style={{ paddingLeft: `${level * 16}px` }} className="flex items-center">
          {level > 0 && (
            <svg className="w-3 h-3 text-gray-300 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-5h5" />
            </svg>
          )}
          <div className="flex-1">
            <input
              type="text"
              value={node.name}
              onChange={(e) => updateComponent(node.id, { name: e.target.value })}
              placeholder="Component name"
              className="w-full px-2 py-1.5 bg-transparent border border-transparent hover:border-gray-200 focus:bg-white focus:border-indigo-300 rounded text-sm font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
            />
            {node.parentId && (
              <div className="mt-0.5 text-[10px] text-gray-400 uppercase tracking-wider ml-2">Submodule</div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <select
          value={node.type}
          onChange={(e) => updateComponent(node.id, { type: e.target.value })}
          className="w-full px-2 py-1.5 bg-transparent border border-transparent hover:border-gray-200 focus:bg-white focus:border-indigo-300 rounded text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer"
        >
          {COMPONENT_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <input
          type="text"
          value={node.description}
          onChange={(e) => updateComponent(node.id, { description: e.target.value })}
          placeholder="Brief description"
          className="w-full px-2 py-1.5 bg-transparent border border-transparent hover:border-gray-200 focus:bg-white focus:border-indigo-300 rounded text-sm text-gray-600 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
        />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={999}
            value={node.numeral ?? ''}
            onChange={(e) => {
              const num = e.target.value === '' ? undefined : Number(e.target.value)
              updateComponent(node.id, { numeral: Number.isNaN(num) ? undefined : num })
            }}
            placeholder="e.g., 101"
            className="w-20 px-2 py-1.5 bg-transparent border border-transparent hover:border-gray-200 focus:bg-white focus:border-indigo-300 rounded text-sm font-mono text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
          />
          {node.numeral && (
             <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700 border border-green-100">
              #{node.numeral}
             </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-right">
        <div className="flex items-center justify-end space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => addSubmodule(node.id)}
            className="p-1 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
            title="Add Submodule"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
          <button
            onClick={() => removeComponent(node.id)}
            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Remove"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  )

  return (
    <div className="px-6 py-8 max-w-[1200px] mx-auto">
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Component Planning</h2>
          <p className="text-sm text-gray-500 mt-1">
            Define invention components and assign reference numerals.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowRanges(!showRanges)}
            className={`text-sm font-medium px-3 py-1.5 rounded-md border transition-colors ${showRanges ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            Numeral Guide
          </button>
        </div>
      </div>

      {/* Collapsible Numeral Ranges */}
      {showRanges && (
        <div className="mb-6 bg-white border border-gray-200 rounded-lg shadow-sm p-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">Reference Numeral Standards</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {[
              { range: '100-199', label: 'Main Controllers' },
              { range: '200-299', label: 'Subsystems' },
              { range: '300-399', label: 'Modules' },
              { range: '400-499', label: 'Interfaces' },
              { range: '500-599', label: 'Sensors/Actuators' },
              { range: '600-699', label: 'Processors' },
              { range: '700-799', label: 'Memory' },
              { range: '800-899', label: 'Displays' },
              { range: '900-999', label: 'Other' }
            ].map((item) => (
              <div key={item.range} className="flex items-center text-sm">
                <span className="font-mono text-indigo-600 font-medium w-16">{item.range}</span>
                <span className="text-gray-600">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 rounded-lg p-4 flex items-start">
          <div className="flex-shrink-0 mt-0.5">
            <svg className="h-4 w-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-100 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-amber-800">Validation Needed</h3>
              <ul className="mt-1 text-sm text-amber-700 space-y-1">
                {validationErrors.map((err, idx) => (
                  <li key={idx}>• {err}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Components Table Card */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mb-8">
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-sm font-medium text-gray-900">Component Structure</h3>
          <button
            onClick={addComponent}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
          >
            <svg className="w-3.5 h-3.5 mr-1.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Component
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-[30%]">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-[20%]">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-[30%]">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-[15%]">
                  Numeral
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider w-[5%]">
                  
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {tree.map((node) => (
                <React.Fragment key={`node-${node.id}`}>
                  {renderRow(node, 0)}
                  {node.children?.map((c1: any) => (
                    <React.Fragment key={`c1-${node.id}-${c1.id}`}>
                      {renderRow(c1, 1)}
                      {c1.children?.map((c2: any) => (
                        <React.Fragment key={`c2-${node.id}-${c1.id}-${c2.id}`}>
                          {renderRow(c2, 2)}
                          {c2.children?.map((c3: any) => renderRow(c3, 3))}
                        </React.Fragment>
                      ))}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
              {components.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                       <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                         <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                         </svg>
                       </div>
                       <p className="text-sm text-gray-500 mb-1">No components defined yet</p>
                       <button onClick={addComponent} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                         Add your first component
                       </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions Footer */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-gray-200">
        <div className="text-sm text-gray-500">
          <span className="font-medium text-gray-900">{components.length}</span> components defined
          {components.filter(c => c.numeral).length > 0 && (
            <span className="ml-1 text-gray-400">
              ({components.filter(c => c.numeral).length} assigned)
            </span>
          )}
        </div>
        <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
          <button
            onClick={handleAutoAssignNumerals}
            disabled={isProcessing || components.length === 0}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isProcessing ? (
              <span className="flex items-center">
                 <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                   <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                 </svg>
                 Processing...
              </span>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
                Auto Assign
              </>
            )}
          </button>
          <button
            onClick={async () => {
              await handleSaveComponents()
            }}
            disabled={isProcessing || components.length === 0}
            className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Save Draft
          </button>
          <button
            onClick={async () => {
              await handleSaveComponents()
              await onComplete({ action: 'set_stage', sessionId: session?.id, stage: 'FIGURE_PLANNER' })
            }}
            disabled={!canProceed}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Continue
            <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

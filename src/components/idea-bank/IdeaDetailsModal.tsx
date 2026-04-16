'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IdeaBankIdeaWithDetails } from '@/lib/idea-bank-service'
import { Lightbulb, TrendingUp, Zap, Target, Layers, BarChart3, Users, Calendar, Bot, Sparkles, Microscope, FileText } from 'lucide-react'

interface IdeaDetailsModalProps {
  idea: IdeaBankIdeaWithDetails
  open: boolean
  onClose: () => void
  onReserve: () => void
  onRelease: () => void
  onEdit: () => void
  onSendToSearch: () => void
  onSendToDrafting: () => void
}

export default function IdeaDetailsModal({
  idea,
  open,
  onClose,
  onReserve,
  onRelease,
  onEdit,
  onSendToSearch,
  onSendToDrafting
}: IdeaDetailsModalProps) {
  const isReserved = idea.status === 'RESERVED'
  const isReservedByUser = idea._isReservedByCurrentUser
  const canSeeFullContent = !isReserved || isReservedByUser

  const getStatusColor = () => {
    switch (idea.status) {
      case 'PUBLIC': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
      case 'RESERVED': return 'bg-amber-50 text-amber-700 border-amber-200'
      case 'LICENSED': return 'bg-blue-50 text-blue-700 border-blue-200'
      case 'ARCHIVED': return 'bg-slate-50 text-slate-600 border-slate-200'
      default: return 'bg-slate-50 text-slate-600 border-slate-200'
    }
  }

  const getDomainTagColor = () => {
    return 'bg-slate-100 text-slate-700 border-slate-200'
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-white border-slate-100 shadow-2xl p-0 gap-0">
        {/* Header with gradient accent */}
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500" />
        
        <DialogHeader className="p-6 pb-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="bg-slate-900 text-white p-1 rounded">
                  <Bot className="h-3 w-3" />
                </div>
                <span className="text-xs font-mono uppercase tracking-wider text-slate-500">AI Generated Intellectual Property</span>
              </div>
              <DialogTitle className="text-2xl font-bold text-slate-900 leading-tight">
                {idea.title}
              </DialogTitle>
              <div className="flex items-center gap-4 text-sm text-slate-500">
                {idea.noveltyScore && (
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>Novelty Score: <span className="font-mono font-bold text-slate-900">{(idea.noveltyScore * 100).toFixed(1)}%</span></span>
                  </div>
                )}
                <div className="h-4 w-px bg-slate-300" />
                <div className="flex items-center gap-1.5">
                   <Users className="w-4 h-4 text-slate-400" />
                   <span>Reservations: <span className="font-mono font-bold text-slate-900">{idea.reservedCount}</span></span>
                </div>
              </div>
            </div>
            <Badge className={`${getStatusColor()} font-mono uppercase tracking-wider text-xs px-3 py-1`}>
              {idea.status}
            </Badge>
          </div>
        </DialogHeader>

        <div className="p-8 space-y-8">
          {/* Core Principle - Main Section */}
          <div className="prose prose-slate max-w-none">
            <div className="flex items-center gap-2 mb-4">
               <Lightbulb className="w-5 h-5 text-indigo-600" />
               <h3 className="text-lg font-bold text-slate-900 m-0">Core Logic</h3>
            </div>
            <div className="text-slate-600 leading-relaxed text-base bg-slate-50 p-6 rounded-xl border border-slate-100">
              {canSeeFullContent ? (
                idea.description
              ) : (
                <div>
                   <p>{idea._redactedDescription}</p>
                   <div className="mt-4 flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 text-sm">
                      <div className="bg-amber-100 p-1.5 rounded-full">🔒</div>
                      <span className="font-medium">Content Protected. Reserve this asset to view full details.</span>
                   </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             {/* Left Column */}
             <div className="space-y-8">
                {/* Expected Advantage */}
                {idea.abstract && canSeeFullContent && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Target className="w-4 h-4 text-emerald-600" />
                      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Executive Summary</h3>
                    </div>
                    <div className="text-slate-600 italic leading-relaxed text-sm pl-6 border-l-2 border-emerald-500/30">
                      {idea.abstract}
                    </div>
                  </div>
                )}

                {/* Non-obvious Extension */}
                {idea.keyFeatures.length > 0 && canSeeFullContent && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Microscope className="w-4 h-4 text-blue-600" />
                      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Technical Specifications</h3>
                    </div>
                    <div className="space-y-2">
                      {idea.keyFeatures.map((feature, index) => (
                        <div key={index} className="flex items-start gap-3 group">
                          <span className="flex-shrink-0 w-6 h-6 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center text-xs font-mono mt-0.5 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                            {index + 1}
                          </span>
                          <div className="text-slate-600 text-sm leading-relaxed">{feature}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
             </div>

             {/* Right Column */}
             <div className="space-y-8">
                {/* Domain & Field */}
                <div>
                   <div className="flex items-center gap-2 mb-3">
                      <Layers className="w-4 h-4 text-purple-600" />
                      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Classification</h3>
                   </div>
                   <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 space-y-4">
                      {idea.technicalField && (
                        <div>
                          <span className="text-xs text-slate-400 uppercase tracking-wider font-medium block mb-1">Technical Field</span>
                          <span className="text-slate-900 font-medium">{idea.technicalField}</span>
                        </div>
                      )}
                      {idea.domainTags.length > 0 && (
                        <div>
                          <span className="text-xs text-slate-400 uppercase tracking-wider font-medium block mb-2">Domain Tags</span>
                          <div className="flex flex-wrap gap-2">
                            {idea.domainTags.map(tag => (
                              <Badge key={tag} variant="outline" className="bg-white text-slate-600 border-slate-200 font-normal">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                   </div>
                </div>

                {/* Potential Applications */}
                {idea.potentialApplications.length > 0 && canSeeFullContent && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-4 h-4 text-amber-600" />
                      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Applications</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {idea.potentialApplications.map((app, index) => (
                        <div key={index} className="flex items-center gap-3 p-2 rounded hover:bg-slate-50 transition-colors">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          <div className="text-slate-600 text-sm">{app}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
             </div>
          </div>

          {/* Footer Analysis Sections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-100">
             {/* Prior Art Analysis */}
             {idea.priorArtSummary && canSeeFullContent && (
               <div>
                 <div className="flex items-center gap-2 mb-2">
                   <FileText className="w-4 h-4 text-slate-400" />
                   <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Prior Art Analysis</h3>
                 </div>
                 <div className="text-xs text-slate-500 leading-relaxed bg-slate-50 p-3 rounded border border-slate-100">
                   {idea.priorArtSummary}
                 </div>
               </div>
             )}

             {/* Genealogy */}
             {(idea.derivedFrom || idea.derivedIdeas.length > 0) && (
               <div>
                 <div className="flex items-center gap-2 mb-2">
                   <div className="w-4 h-4 text-slate-400 flex items-center justify-center font-mono text-xs">☊</div>
                   <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Genealogy</h3>
                 </div>
                 <div className="space-y-2">
                   {idea.derivedFrom && (
                     <div className="flex items-center justify-between text-xs p-2 bg-slate-50 rounded border border-slate-100">
                       <span className="text-slate-500">Derived From</span>
                       <span className="font-medium text-slate-900 truncate max-w-[200px]">"{idea.derivedFrom.title}"</span>
                     </div>
                   )}
                   {idea.derivedIdeas.length > 0 && (
                     <div className="p-2 bg-slate-50 rounded border border-slate-100">
                       <div className="text-xs text-slate-500 mb-1">Derivatives ({idea.derivedIdeas.length})</div>
                       {idea.derivedIdeas.slice(0, 3).map(derived => (
                         <div key={derived.id} className="text-xs font-medium text-slate-900 truncate pl-2 border-l border-slate-200 my-1">
                           {derived.title}
                         </div>
                       ))}
                     </div>
                   )}
                 </div>
               </div>
             )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex flex-wrap gap-3 w-full sm:w-auto">
            {isReservedByUser ? (
              <>
                <Button
                  onClick={onRelease}
                  variant="outline"
                  className="border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                >
                  Release Asset
                </Button>
                <Button onClick={onSendToSearch} className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-200">
                  Run Novelty Search
                </Button>
                <Button onClick={onSendToDrafting} className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-200">
                  Start Drafting
                </Button>
              </>
            ) : !isReserved ? (
              <Button onClick={onReserve} size="lg" className="bg-slate-900 hover:bg-slate-800 text-white px-8 shadow-lg shadow-slate-200 w-full sm:w-auto">
                Reserve Asset
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-amber-600 bg-amber-50 px-4 py-2 rounded-lg border border-amber-100 w-full sm:w-auto justify-center">
                <span className="text-sm font-medium">Asset Reserved by Another Entity</span>
              </div>
            )}
          </div>

          <div className="flex gap-3 w-full sm:w-auto justify-end">
            <Button onClick={onEdit} variant="outline" className="border-slate-200 text-slate-600 hover:bg-white hover:text-slate-900">
              Clone & Edit
            </Button>
            <Button onClick={onClose} variant="ghost" className="text-slate-400 hover:text-slate-900">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

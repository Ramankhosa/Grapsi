'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  HelpCircle,
  Sparkles,
  Layers,
  Zap,
  Target,
  MousePointer2,
  CheckSquare,
  FolderPlus,
  Lightbulb,
  Search,
  ChevronRight,
  ChevronDown,
  GripVertical,
  Box,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface IdeationHelpModalProps {
  isOpen: boolean
  onClose: () => void
}

type HelpSection = 'overview' | 'mindmap' | 'selection' | 'buckets' | 'operators' | 'generation' | 'novelty'

const sections: { id: HelpSection; title: string; icon: React.ReactNode }[] = [
  { id: 'overview', title: 'Getting Started', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'mindmap', title: 'Mind Map', icon: <Layers className="w-4 h-4" /> },
  { id: 'selection', title: 'Selecting Dimensions', icon: <CheckSquare className="w-4 h-4" /> },
  { id: 'buckets', title: 'Using Buckets', icon: <FolderPlus className="w-4 h-4" /> },
  { id: 'operators', title: 'TRIZ Operators', icon: <Zap className="w-4 h-4" /> },
  { id: 'generation', title: 'Idea Generation', icon: <Lightbulb className="w-4 h-4" /> },
  { id: 'novelty', title: 'Novelty Check', icon: <Search className="w-4 h-4" /> },
]

export default function IdeationHelpModal({ isOpen, onClose }: IdeationHelpModalProps) {
  const [activeSection, setActiveSection] = useState<HelpSection>('overview')

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Welcome to the Patent Ideation Engine</h3>
            <p className="text-sm text-slate-600">
              The Ideation Engine helps you systematically generate patentable inventions by exploring dimensions 
              of your invention concept and combining them with proven TRIZ inventive principles.
            </p>
            
            <div className="bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-200">
              <h4 className="font-semibold text-violet-800 mb-2">Quick Start Guide</h4>
              <ol className="space-y-2 text-sm text-violet-700">
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-violet-500 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                  <span><strong>Enter your idea</strong> — Describe your invention concept in the input field</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-violet-500 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                  <span><strong>Explore the mind map</strong> — Double-click dimensions to expand and discover variations</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-violet-500 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                  <span><strong>Select dimensions</strong> — Click checkboxes to select dimensions you want to combine</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-violet-500 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
                  <span><strong>Generate ideas</strong> — Click "Generate Ideas" to create novel inventions</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-violet-500 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">5</span>
                  <span><strong>Export to Idea Bank</strong> — Save your best ideas for patent drafting</span>
                </li>
              </ol>
            </div>

            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-sm text-amber-800">
                💡 <strong>Pro Tip:</strong> The engine uses AI to check if your combinations are novel. 
                If a combination is too obvious, it will suggest "wildcard" dimensions from distant domains 
                to make your invention more innovative.
              </p>
            </div>
          </div>
        )

      case 'mindmap':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Using the Mind Map</h3>
            <p className="text-sm text-slate-600">
              The mind map visualizes your invention as a tree of dimensions. Each dimension represents 
              an aspect of your invention that can be varied to create new ideas.
            </p>

            <div className="grid gap-3">
              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <MousePointer2 className="w-4 h-4 text-violet-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Double-Click to Expand</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Double-click on any dimension family (📂) to generate specific options within that dimension.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                  <ChevronDown className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Collapse/Expand Children</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Click the collapse button (↓) to hide child nodes and keep the map organized.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Layers className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Pan & Zoom</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Drag to pan around the map. Use scroll wheel or pinch to zoom in/out.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-violet-50 rounded-lg border border-violet-200">
              <p className="text-sm text-violet-800">
                <strong>Node Types:</strong><br />
                <span className="text-xs">
                  • <strong>📂 Dimension Family</strong> — Category that can be expanded (e.g., "Material")<br />
                  • <strong>✦ Option</strong> — Specific choice within a dimension (e.g., "Carbon Fiber")
                </span>
              </p>
            </div>
          </div>
        )

      case 'selection':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Selecting Dimensions</h3>
            <p className="text-sm text-slate-600">
              Select multiple dimensions to combine them into novel inventions. The AI will find 
              creative ways to merge your selections.
            </p>

            <div className="grid gap-3">
              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <CheckSquare className="w-4 h-4 text-violet-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Click Checkbox to Select</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Each node has a checkbox. Click it to add the dimension to your selection.
                    Selected nodes pulse with a violet glow.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Target className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Selection Widget (Top Right)</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    See your current selection count. Click "Generate Ideas" when you have 2+ dimensions selected.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                  <ArrowRight className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Combine Across Branches</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Select from different dimension families for more innovative combinations.
                    Cross-domain ideas score higher on novelty checks.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-green-800">
                💡 <strong>Best Practice:</strong> Select 3-5 dimensions from at least 2 different 
                families. Too few = obvious ideas. Too many = unfocused ideas.
              </p>
            </div>
          </div>
        )

      case 'buckets':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Using Buckets</h3>
            <p className="text-sm text-slate-600">
              Buckets let you organize dimensions into groups and generate ideas for each group separately.
              This is useful when exploring multiple invention directions.
            </p>

            <div className="grid gap-3">
              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <FolderPlus className="w-4 h-4 text-violet-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Enable Buckets</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    When you have 2+ dimensions selected, click "Use Buckets" in the tray to switch to bucket mode.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <GripVertical className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Drag & Drop</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Drag dimension badges from "Unassigned" into buckets. Drop on empty area to create new bucket.
                    Buckets are auto-named based on first dimension added.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Lightbulb className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Per-Bucket Generation</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    When generating ideas with buckets, you get ideas for each bucket separately.
                    Set "Ideas per bucket" to control how many ideas each group produces.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-800">
                <strong>Example:</strong> Create buckets for "Material Variations", "Mechanism Alternatives", 
                and "User Interface Options" to explore each design axis independently.
              </p>
            </div>
          </div>
        )

      case 'operators':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900">TRIZ Operators</h3>
            <p className="text-sm text-slate-600">
              TRIZ (Theory of Inventive Problem Solving) operators are proven principles that guide 
              how dimensions combine into inventive solutions. Selecting operators steers the AI's creativity.
            </p>

            <div className="grid gap-2">
              {[
                { name: 'Segmentation', desc: 'Divide into independent parts or make modular' },
                { name: 'Extraction', desc: 'Remove problematic part or extract only what\'s needed' },
                { name: 'Local Quality', desc: 'Make non-uniform, optimize each part differently' },
                { name: 'Asymmetry', desc: 'Replace symmetry with asymmetry for function' },
                { name: 'Merging', desc: 'Combine similar objects or operations' },
                { name: 'Universality', desc: 'Make one object perform multiple functions' },
              ].map(op => (
                <div key={op.name} className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                  <Zap className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                  <div>
                    <span className="text-xs font-semibold text-amber-800">{op.name}</span>
                    <span className="text-xs text-amber-700"> — {op.desc}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-sm text-amber-800">
                💡 <strong>Tip:</strong> Operators are optional but recommended. Select 1-3 operators 
                that match your design goals. Hover over each operator button to see its detailed description.
              </p>
            </div>
          </div>
        )

      case 'generation':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Idea Generation</h3>
            <p className="text-sm text-slate-600">
              The AI synthesizes your selected dimensions and operators into structured invention ideas, 
              complete with mechanisms, variants, and patent claim hooks.
            </p>

            <div className="space-y-3">
              <h4 className="font-semibold text-slate-800">Generation Styles</h4>
              
              <div className="grid gap-2">
                <div className="flex items-start gap-2 p-2 bg-violet-50 rounded-lg border border-violet-100">
                  <Sparkles className="w-4 h-4 text-violet-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-semibold text-violet-800">Divergent</span>
                    <p className="text-xs text-violet-700">Maximum creativity — wild, cross-domain ideas using distant analogies</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 bg-blue-50 rounded-lg border border-blue-100">
                  <Target className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-semibold text-blue-800">Convergent</span>
                    <p className="text-xs text-blue-700">Practical focus — implementable solutions based on proven principles</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 bg-green-50 rounded-lg border border-green-100">
                  <Layers className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-semibold text-green-800">Low Risk</span>
                    <p className="text-xs text-green-700">Safety priority — reliability, redundancy, fail-safe mechanisms</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                  <Box className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-semibold text-amber-800">Low Cost</span>
                    <p className="text-xs text-amber-700">Cost focus — material reduction, simpler manufacturing</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-violet-50 rounded-lg border border-violet-200">
              <p className="text-sm text-violet-800">
                <strong>What you get:</strong> Each idea includes a title, problem statement, technical principle, 
                mechanism steps, variants, and suggested patent claim hooks.
              </p>
            </div>
          </div>
        )

      case 'novelty':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Novelty Assessment</h3>
            <p className="text-sm text-slate-600">
              The engine automatically checks if your dimension combinations and generated ideas are 
              novel enough for patenting. This helps avoid obvious combinations.
            </p>

            <div className="grid gap-3">
              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Search className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Pre-Generation Check</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Before generating, the AI checks if your combination is too obvious. If so, it suggests 
                    "wildcard" dimensions from distant domains to boost novelty.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Target className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Post-Generation Check</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Click "Check Novelty" on any idea to run a patent search. The AI compares against 
                    existing patents and provides a novelty score (0-100).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <Lightbulb className="w-4 h-4 text-violet-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-slate-800">Feedback Loop</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Ideas scoring below 60% are auto-flagged with mutation suggestions — specific 
                    changes that could increase novelty (like "try biological analogy").
                  </p>
                </div>
              </div>
            </div>

            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-green-800">
                <strong>Novelty Scores:</strong><br />
                <span className="text-xs">
                  • <strong>70-100:</strong> Highly inventive ✅ Ready for patent drafting<br />
                  • <strong>50-69:</strong> Non-obvious ⚡ Good with some refinement<br />
                  • <strong>30-49:</strong> Marginal ⚠️ Needs differentiation<br />
                  • <strong>0-29:</strong> Obvious ❌ Requires significant changes
                </span>
              </p>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-violet-50 to-purple-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                  <HelpCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Ideation Engine Help</h2>
                  <p className="text-xs text-slate-500">Learn how to generate patentable inventions</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-200/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            {/* Content */}
            <div className="flex flex-1 overflow-hidden">
              {/* Sidebar Navigation */}
              <div className="w-48 border-r border-slate-200 bg-slate-50 p-2 overflow-y-auto">
                {sections.map(section => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`
                      w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-all mb-1
                      ${activeSection === section.id
                        ? 'bg-violet-100 text-violet-800 font-medium'
                        : 'text-slate-600 hover:bg-slate-100'
                      }
                    `}
                  >
                    <span className={activeSection === section.id ? 'text-violet-600' : 'text-slate-400'}>
                      {section.icon}
                    </span>
                    {section.title}
                  </button>
                ))}
              </div>

              {/* Main Content */}
              <div className="flex-1 p-6 overflow-y-auto">
                {renderContent()}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="text-xs text-slate-500 flex items-center gap-3">
                <span>Shortcuts:</span>
                <span><kbd className="px-1.5 py-0.5 bg-slate-200 rounded text-[10px]">?</kbd> Help</span>
                <span><kbd className="px-1.5 py-0.5 bg-slate-200 rounded text-[10px]">i</kbd> Ideas panel</span>
                <span><kbd className="px-1.5 py-0.5 bg-slate-200 rounded text-[10px]">l</kbd> Auto-layout</span>
              </div>
              <Button onClick={onClose} className="bg-violet-500 hover:bg-violet-600 text-white">
                Got it!
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}


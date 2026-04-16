import Link from 'next/link'

export default function MinimalFooter() {
  return (
    <footer className="bg-ai-graphite-950 border-t border-ai-graphite-800 pt-16 pb-8 font-mono text-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          
          <div className="col-span-1">
            <div className="flex items-center gap-2 mb-6 text-white font-bold tracking-tighter">
              <div className="w-3 h-3 bg-ai-blue-500 rounded-sm" />
              PAPER NEST.AI
            </div>
            <p className="text-ai-graphite-500 leading-relaxed mb-6">
              System version 2.4.0<br/>
              Building the neural architecture for intellectual property.
            </p>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4 uppercase tracking-widest text-xs text-opacity-70">System</h3>
            <ul className="space-y-3 text-ai-graphite-400">
              <li><Link href="/features" className="hover:text-ai-blue-400 transition-colors">Capabilities</Link></li>
              <li><Link href="/workflow" className="hover:text-ai-blue-400 transition-colors">Workflow</Link></li>
              <li><Link href="/api" className="hover:text-ai-blue-400 transition-colors">API Status</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4 uppercase tracking-widest text-xs text-opacity-70">Protocol</h3>
            <ul className="space-y-3 text-ai-graphite-400">
              <li><Link href="/security" className="hover:text-ai-blue-400 transition-colors">Security</Link></li>
              <li><Link href="/legal" className="hover:text-ai-blue-400 transition-colors">Compliance</Link></li>
              <li><Link href="/terms" className="hover:text-ai-blue-400 transition-colors">Terms of Use</Link></li>
              <li><Link href="/privacy" className="hover:text-ai-blue-400 transition-colors">Privacy Policy</Link></li>
            </ul>
          </div>

          <div>
             <h3 className="text-white font-semibold mb-4 uppercase tracking-widest text-xs text-opacity-70">Connect</h3>
             <ul className="space-y-3 text-ai-graphite-400">
               <li><Link href="/contact" className="hover:text-ai-blue-400 transition-colors">Support Uplink</Link></li>
               <li><Link href="/twitter" className="hover:text-ai-blue-400 transition-colors">X / Twitter</Link></li>
               <li><Link href="/linkedin" className="hover:text-ai-blue-400 transition-colors">LinkedIn</Link></li>
             </ul>
          </div>
        </div>

        <div className="border-t border-ai-graphite-900 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-ai-graphite-600">
          <div>
            © 2025 Paper Nest AI Systems. All rights reserved.
          </div>
          <div className="flex gap-6">
             <span>LAT: 37.7749° N</span>
             <span>LNG: 122.4194° W</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

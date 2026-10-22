import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {it,expect,vi,afterEach} from 'vitest'
vi.mock('next/router',()=>({useRouter:()=>({query:{},isReady:true,asPath:'/finder'})}))
vi.mock('next/head',()=>({default:()=>null}))
vi.mock('@/lib/auth-context',()=>({useAuth:()=>({user:{id:'researcher',roles:['ANALYST']},isLoading:false,authFetch:vi.fn()})}))
vi.mock('@/hooks/useEntitlements',()=>({useEntitlements:()=>({hasModule:()=>true})}))
vi.mock('@/hooks/useFinderChat',()=>({useFinderChat:()=>({loadingList:true,filterDrawerOpen:false})}))
vi.mock('@/components/researcher/ResearcherTopBar',()=>({default:()=>null}))
vi.mock('@/components/FundingCallImportModal',()=>({default:()=>null}))
vi.mock('@/components/FundingDirectoryPanel',()=>({default:()=> <div>Directory results</div>}))
vi.mock('@/components/finder/FinderAiTab',()=>({default:()=>null}))
vi.mock('@/components/FundingChatFilterDrawer',()=>({default:()=>null}))
import FinderPage from '../../../pages/finder'
afterEach(()=>vi.unstubAllGlobals())
it('shows the directory while the lazily initialised chatbot has not loaded',()=>{
 vi.stubGlobal('React',React)
 const html=renderToStaticMarkup(<FinderPage/>);expect(html).toContain('Directory results');expect(html).toContain('aria-selected="true"')
})

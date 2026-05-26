'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FaArrowRight,
  FaCheckCircle,
  FaClipboardCheck,
  FaComments,
  FaGlobe,
  FaPencilAlt,
  FaSearch,
  FaTimesCircle,
  FaUniversity,
  FaUsers,
} from 'react-icons/fa'
import { useAuth } from '@/lib/auth-context'

const suiteComponents = [
  {
    icon: <FaSearch className="h-8 w-8" />,
    title: 'Grant Finder',
    description: 'Discover perfect funding opportunities tailored to your research profile and interests.',
    features: [
      'AI-powered funding matches based on your profile',
      'Real-time deadline tracking and alerts',
      'Funding success probability scoring',
      'Filter by country, grant type, and research area',
    ],
    benefits: 'Save countless hours searching for grants. Never miss an opportunity again.',
    beforeState: 'Endless manual searches through funding databases',
    afterState: 'Personalized funding recommendations delivered to you',
    image: '/AiFundFinder.jpg',
  },
  {
    icon: <FaPencilAlt className="h-8 w-8" />,
    title: 'Grant Mentor',
    description: 'Your AI co-author that guides you through every stage of proposal development.',
    features: [
      'Interactive ideation and brainstorming',
      'Section-by-section guided writing',
      'Literature-driven insights and references',
      'Auto-generated proposal drafts',
    ],
    benefits: 'Transform your ideas into compelling, structured proposals with expert guidance.',
    beforeState: 'Staring at blank pages, unsure how to structure your ideas',
    afterState: 'Guided creation of compelling, well-structured proposals',
    image: '/IdeationChatBot.jpg',
  },
  {
    icon: <FaClipboardCheck className="h-8 w-8" />,
    title: 'Grant Reviewer',
    description: 'Get honest, expert-level feedback to perfect your proposals before submission.',
    features: [
      'Section-by-section critical analysis',
      'Funding agency alignment assessment',
      'Actionable improvement suggestions',
      'Comparative scoring against successful grants',
    ],
    benefits: 'Receive candid feedback that identifies weaknesses before submission, not after rejection.',
    beforeState: 'Submitting proposals with hidden flaws and weaknesses',
    afterState: 'Confidently submitting polished, reviewer-ready proposals',
    image: '/AiReviewer.jpg',
  },
]

const testimonials = [
  {
    quote: 'The Grant Finder saved me weeks of searching. It found three perfect opportunities I would have missed.',
    author: 'Dr. Priya Sharma',
    position: 'Associate Professor, Biomedical Engineering',
  },
  {
    quote: 'Grant Mentor helped me structure my ideas into a compelling narrative. My proposal was funded on the first attempt!',
    author: 'Dr. Rajesh Verma',
    position: 'Research Scientist, Climate Studies',
  },
  {
    quote: 'The Grant Reviewer identified critical weaknesses in my methodology section that would have definitely led to rejection.',
    author: 'Prof. Neha Gupta',
    position: 'Department Chair, Computer Science',
  },
  {
    quote: 'This suite transformed our department grant success rate from 15% to over 40% in just one year.',
    author: 'Dr. Vikram Mehta',
    position: 'Research Director, University Hospital',
  },
]

const stats = [
  { value: '85%', label: 'Success rate increase' },
  { value: '3.2x', label: 'Faster proposal development' },
  { value: '40+', label: 'Funding agencies covered' },
  { value: '1000+', label: 'Researchers empowered' },
]

export default function AIGrantMentorHomePage() {
  const router = useRouter()
  const { user } = useAuth()
  const [isLoaded, setIsLoaded] = useState(false)
  const primaryCtaLabel = user ? 'Go to Dashboard' : 'Sign Up'

  useEffect(() => {
    setIsLoaded(true)
  }, [])

  const handleGetStarted = () => {
    router.push(user ? '/dashboard' : '/register')
  }

  return (
    <main className="flex min-h-screen flex-col bg-white">
      <section className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center overflow-hidden bg-blue-600 text-white">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/4 top-1/4 h-64 w-64 animate-pulse rounded-full bg-white opacity-10 mix-blend-screen" />
          <div className="absolute right-1/4 top-1/3 h-48 w-48 animate-pulse rounded-full bg-white opacity-10 mix-blend-screen" />
          <div className="absolute bottom-1/3 left-1/3 h-32 w-32 rotate-45 border-4 border-white opacity-20" />
          <div className="absolute right-1/3 top-1/2 h-24 w-24 animate-bounce border-4 border-yellow-400 opacity-20" />
        </div>

        <div className="absolute right-4 top-4 md:right-8 md:top-8">
          <img src="/lpu-logo.png" alt="LPU Logo" className="h-16 md:h-20" />
        </div>

        <div className="container relative z-10 mx-auto px-4 py-20 md:py-32">
          <div className="mx-auto max-w-5xl text-center">
            <div
              className={`transform transition-all duration-1000 ${
                isLoaded ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
              }`}
            >
              <h1 className="mb-6 text-4xl font-bold leading-tight text-white md:text-6xl xl:text-7xl">
                AI-Powered Grant Success Suite
              </h1>
              <p className="mx-auto mb-8 max-w-4xl text-xl text-white md:text-2xl">
                Your end-to-end solution that <span className="font-semibold">finds optimal funding</span>,{' '}
                <span className="font-semibold">crafts compelling proposals</span>, and{' '}
                <span className="font-semibold">provides expert reviews</span> - all powered by advanced AI.
              </p>
            </div>

            <div
              className={`mx-auto mt-12 grid max-w-4xl gap-6 transition-all delay-300 duration-1000 md:grid-cols-3 ${
                isLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {suiteComponents.map((component) => (
                <div
                  key={component.title}
                  className="group rounded-xl border border-blue-200 bg-white p-6 shadow-md transition-all duration-300 hover:-translate-y-1 hover:border-blue-400"
                >
                  <div className="mb-4 inline-flex items-center justify-center rounded-full bg-blue-600 p-4 text-white transition-all group-hover:scale-110">
                    {component.icon}
                  </div>
                  <h3 className="mb-2 text-xl font-bold text-blue-600">{component.title}</h3>
                  <p className="text-gray-700">{component.description}</p>
                </div>
              ))}
            </div>

            <div
              className={`mt-12 flex flex-col justify-center gap-4 transition-opacity delay-500 duration-700 sm:flex-row ${
                isLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <button
                onClick={handleGetStarted}
                className="flex items-center justify-center rounded-lg bg-yellow-400 px-8 py-4 text-lg font-medium text-blue-900 shadow-lg transition-all hover:bg-yellow-500"
              >
                {primaryCtaLabel}
                <FaArrowRight className="ml-2" />
              </button>
              <Link
                href="#how-it-works"
                className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-white px-8 py-4 text-lg font-medium text-blue-600 transition-all hover:border-blue-300 hover:bg-blue-50"
              >
                See How It Works
              </Link>
            </div>

            <div
              className={`mt-12 text-sm text-white transition-opacity delay-700 duration-700 ${
                isLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            >
              Powered by advanced AI - Created by researchers for researchers - Trusted by universities worldwide
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="container mx-auto px-4">
          <h2 className="mb-4 text-center text-3xl font-bold text-blue-600 md:text-5xl">
            Transform Your Grant Journey
          </h2>
          <p className="mx-auto mb-16 max-w-3xl text-center text-xl text-gray-600">
            See how our AI Grant Suite revolutionizes every step of your funding process
          </p>

          <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-3">
            {suiteComponents.map((component) => (
              <div key={component.title} className="relative">
                <div className="relative mb-8 rounded-lg bg-gray-100 p-6 shadow-md">
                  <div className="absolute -left-4 -top-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 shadow-md">
                    <FaTimesCircle className="text-xl text-red-500" />
                  </div>
                  <h3 className="mb-3 text-lg font-medium text-slate-800">Without {component.title}</h3>
                  <p className="text-slate-600">{component.beforeState}</p>
                </div>

                <div className="absolute left-1/2 top-1/2 z-10 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-lg">
                  <FaArrowRight className="text-blue-600" />
                </div>

                <div className="relative rounded-lg bg-blue-600 p-6 text-white">
                  <div className="absolute -bottom-4 -right-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 shadow-md">
                    <FaCheckCircle className="text-xl text-green-500" />
                  </div>
                  <h3 className="mb-3 text-lg font-medium">With {component.title}</h3>
                  <p>{component.afterState}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {suiteComponents.map((component, index) => (
        <section key={component.title} className={`py-20 ${index % 2 === 0 ? 'bg-white' : 'bg-blue-50'}`}>
          <div className="container mx-auto px-4">
            <div className="mx-auto flex max-w-6xl flex-col items-center md:flex-row">
              <div className={`mb-10 md:mb-0 md:w-1/2 ${index % 2 === 1 ? 'md:order-2' : ''}`}>
                <div className="mb-6 inline-flex items-center justify-center rounded-full bg-blue-600 p-6 text-white">
                  {component.icon}
                </div>
                <h2 className="mb-6 text-3xl font-bold text-blue-600 md:text-4xl">{component.title}</h2>
                <p className="mb-8 text-xl text-gray-600">{component.description}</p>
                <div className="mb-8 space-y-4">
                  {component.features.map((feature) => (
                    <div key={feature} className="flex items-start">
                      <div className="mr-3 mt-1 rounded-full bg-blue-600 p-1">
                        <FaCheckCircle className="text-white" />
                      </div>
                      <p className="text-gray-700">{feature}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 shadow-md">
                  <p className="italic text-blue-800">"{component.benefits}"</p>
                </div>
              </div>

              <div className={`md:w-1/2 ${index % 2 === 1 ? 'md:order-1 md:pr-12' : 'md:pl-12'}`}>
                <div className="rounded-xl border border-blue-100 bg-white p-6 shadow-lg">
                  <div className="mb-4 aspect-video overflow-hidden rounded-lg border border-slate-700 shadow-lg">
                    <img src={component.image} alt={`${component.title} interface`} className="h-full w-full object-cover" />
                  </div>
                  <div className="space-y-3">
                    <div className="h-3 w-full rounded-full bg-cyan-800/50" />
                    <div className="h-3 w-5/6 rounded-full bg-cyan-800/50" />
                    <div className="h-3 w-4/6 rounded-full bg-cyan-800/50" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      ))}

      <section className="bg-blue-600 py-20 text-white">
        <div className="container mx-auto px-4">
          <h2 className="mb-16 text-center text-3xl font-bold text-white md:text-4xl">
            The Impact of AI Grant Suite
          </h2>
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 md:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-white/20 bg-white/10 p-6 text-center shadow-lg backdrop-blur-md transition-all hover:bg-white/20"
              >
                <div className="mb-2 text-4xl font-bold text-yellow-300 md:text-5xl">{stat.value}</div>
                <p className="text-white">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="container mx-auto px-4">
          <h2 className="mb-4 text-center text-3xl font-bold text-blue-600 md:text-4xl">What Researchers Say</h2>
          <p className="mx-auto mb-16 max-w-3xl text-center text-xl text-gray-600">
            Join hundreds of successful researchers who have transformed their grant writing process
          </p>

          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
            {testimonials.map((testimonial) => (
              <div key={testimonial.author} className="rounded-xl border border-blue-100 bg-blue-50 p-6 shadow-md">
                <div className="mb-4 flex items-center">
                  <div className="rounded-full bg-blue-600 p-2 text-white">
                    <FaComments />
                  </div>
                  <div className="ml-3">
                    <p className="font-medium text-blue-600">{testimonial.author}</p>
                    <p className="text-sm text-gray-600">{testimonial.position}</p>
                  </div>
                </div>
                <p className="italic text-gray-700">"{testimonial.quote}"</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="bg-blue-50 py-20">
        <div className="container mx-auto px-4">
          <h2 className="mb-4 text-center text-3xl font-bold text-blue-600 md:text-4xl">How It Works</h2>
          <p className="mx-auto mb-16 max-w-3xl text-center text-xl text-gray-600">
            Our seamless workflow guides you from idea to funded proposal
          </p>

          <div className="mx-auto max-w-5xl space-y-16">
            <WorkflowStep
              badge="STEP 1: FIND"
              title="Discover Perfect Funding Opportunities"
              body="Input your research interests, experience, and institutional details. Our AI analyzes thousands of funding sources to match you with opportunities that align with your profile."
              icon={<FaSearch className="text-xl text-blue-600" />}
              actionLabel="Grant Finder in action"
              reverse={false}
              points={['Smart matching algorithm', 'Personalized recommendations', 'Real-time funding alerts']}
            />
            <WorkflowStep
              badge="STEP 2: CREATE"
              title="Develop Your Proposal with AI Guidance"
              body="Our structured workflow guides you through each section of your proposal. The AI co-author helps you articulate ideas, provides literature-backed insights, and ensures alignment with funding requirements."
              icon={<FaPencilAlt className="text-xl text-blue-600" />}
              actionLabel="Grant Mentor in action"
              reverse
              points={['AI-guided writing assistant', 'Interactive feedback system', 'Section-by-section guidance']}
            />
            <WorkflowScoreStep />
          </div>
        </div>
      </section>

      <section className="bg-blue-600 py-20 text-white">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-8 text-3xl font-bold text-white md:text-5xl">Ready to Transform Your Grant Success?</h2>
          <p className="mx-auto mb-10 max-w-3xl text-xl">
            Join hundreds of researchers who have already increased their funding success rates with our AI Grant Suite.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <button
              onClick={handleGetStarted}
              className="rounded-lg bg-yellow-400 px-8 py-4 text-lg font-medium text-blue-900 shadow-lg transition-all hover:bg-yellow-500 hover:shadow-xl"
            >
              {primaryCtaLabel}
            </button>
            <Link
              href={user ? '/projects' : '/login'}
              className="rounded-lg border border-blue-200 bg-white px-8 py-4 text-lg font-medium text-blue-600 shadow-md transition-all hover:border-blue-300 hover:bg-blue-50"
            >
              Try Grant Reviewer
            </Link>
          </div>
          <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-8">
            <div className="flex items-center">
              <FaUniversity className="mr-2 text-yellow-300" />
              <span>20+ Universities</span>
            </div>
            <div className="flex items-center">
              <FaGlobe className="mr-2 text-yellow-300" />
              <span>Global Coverage</span>
            </div>
            <div className="flex items-center">
              <FaUsers className="mr-2 text-yellow-300" />
              <span>1000+ Users</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-blue-900 py-12 text-white">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center justify-between md:flex-row">
            <div className="mb-6 md:mb-0">
              <div className="text-2xl font-bold">AI Grant Suite</div>
              <p className="mt-2 text-blue-200">(c) 2025 AI Grant Suite - All rights reserved.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-6 md:gap-8">
              <Link href="#how-it-works" className="transition-colors hover:text-yellow-300">
                Features
              </Link>
              <Link href="#how-it-works" className="transition-colors hover:text-yellow-300">
                How It Works
              </Link>
              <Link href="/contact" className="transition-colors hover:text-yellow-300">
                Contact
              </Link>
              <Link href="/privacy" className="transition-colors hover:text-yellow-300">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}

function WorkflowStep({
  badge,
  title,
  body,
  icon,
  actionLabel,
  reverse,
  points,
}: {
  badge: string
  title: string
  body: string
  icon: React.ReactNode
  actionLabel: string
  reverse: boolean
  points: string[]
}) {
  return (
    <div className="flex flex-col items-center md:flex-row">
      <div className={`mb-8 md:mb-0 md:w-1/2 ${reverse ? 'md:order-2 md:pl-8' : 'md:pr-8'}`}>
        <div className="relative rounded-lg border border-blue-100 bg-white p-6 shadow-md">
          <div className="absolute -top-3 left-4 rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white">
            {badge}
          </div>
          <h3 className="mb-4 mt-2 text-xl font-semibold text-blue-600">{title}</h3>
          <p className="mb-4 text-gray-600">{body}</p>
          <div className="flex items-center text-blue-500">
            {icon}
            <span className="ml-2 font-medium">{actionLabel}</span>
          </div>
        </div>
      </div>
      <div className={`md:w-1/2 ${reverse ? 'md:order-1' : ''}`}>
        <div className="flex aspect-video flex-col justify-center rounded-lg border border-blue-100 bg-white p-4 shadow-md">
          <div className="mb-4 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">{icon}</div>
          </div>
          <ul className="mx-auto w-full max-w-md space-y-2">
            {points.map((point) => (
              <li key={point} className="flex items-center rounded bg-blue-50 px-2 py-1 text-sm text-blue-700">
                <span className="mr-2 h-2 w-2 rounded-full bg-yellow-400" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function WorkflowScoreStep() {
  return (
    <div className="flex flex-col items-center md:flex-row">
      <div className="mb-8 md:mb-0 md:w-1/2 md:pr-8">
        <div className="relative rounded-lg border border-blue-100 bg-white p-6 shadow-md">
          <div className="absolute -top-3 left-4 rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white">
            STEP 3: PERFECT
          </div>
          <h3 className="mb-4 mt-2 text-xl font-semibold text-blue-600">Get Expert Review Before Submission</h3>
          <p className="mb-4 text-gray-600">
            Submit your completed sections for AI review that mimics the critical eye of actual grant reviewers.
            Receive detailed feedback, improvement suggestions, and an overall assessment of your proposal strengths
            and weaknesses.
          </p>
          <div className="flex items-center text-blue-500">
            <FaClipboardCheck className="mr-2" />
            <span className="font-medium">Grant Reviewer in action</span>
          </div>
        </div>
      </div>
      <div className="md:w-1/2">
        <div className="flex aspect-video flex-col justify-center rounded-lg border border-blue-100 bg-white p-4 shadow-md">
          <div className="mb-4 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <FaClipboardCheck className="text-xl text-blue-600" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['CLARITY', '95%'],
              ['IMPACT', '87%'],
              ['METHODS', '92%'],
              ['BUDGET', '89%'],
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-yellow-100 bg-yellow-50 p-2 text-center">
                <div className="text-xs font-semibold text-yellow-600">{label}</div>
                <div className="font-bold text-blue-800">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import Script from 'next/script'

const topics = ['Patent Drafting', 'Idea Bank', 'Novelty Search', 'Other'] as const

type Topic = (typeof topics)[number]

interface ContactFormState {
  name: string
  email: string
  phone: string
  topic: Topic
  message: string
}

export default function ContactPage() {
  const [formState, setFormState] = useState<ContactFormState>({
    name: '',
    email: '',
    phone: '',
    topic: 'Patent Drafting',
    message: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [isShaking, setIsShaking] = useState(false)

  useEffect(() => {
    ;(window as any).onContactRecaptchaSuccess = (token: string) => {
      setCaptchaToken(token)
      setErrorMessage(null)
    }
  }, [])

  const handleChange =
    (field: keyof ContactFormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setFormState(prev => ({ ...prev, [field]: event.target.value }))
    }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSuccessMessage(null)
    setErrorMessage(null)

    if (!formState.name.trim() || !formState.email.trim()) {
      setErrorMessage('Please provide at least your name and email.')
      triggerShake()
      return
    }

    if (!captchaToken) {
      setErrorMessage('Please complete the CAPTCHA to prove you are human.')
      triggerShake()
      return
    }

    try {
      setIsSubmitting(true)
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formState,
          recaptchaToken: captchaToken,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        const message = data?.error || 'Something went wrong. Please try again in a moment.'
        setErrorMessage(message)
        triggerShake()
      } else {
        setSuccessMessage('Thank you for reaching out. We will get back to you shortly.')
        setFormState({
          name: '',
          email: '',
          phone: '',
          topic: 'Patent Drafting',
          message: '',
        })
      }
    } catch (error) {
      console.error('Contact form submit error:', error)
      setErrorMessage('Unable to submit your request. Please try again later.')
      triggerShake()
    } finally {
      setIsSubmitting(false)
      setCaptchaToken(null)
      const recaptcha = (window as any).grecaptcha
      if (recaptcha && typeof recaptcha.reset === 'function') {
        try {
          recaptcha.reset()
        } catch {
          // ignore
        }
      }
    }
  }

  const triggerShake = () => {
    setIsShaking(true)
    setTimeout(() => setIsShaking(false), 500)
  }

  return (
    <>
      <Script src="https://www.google.com/recaptcha/api.js" strategy="afterInteractive" />
      <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-gpt-blue-600 via-gpt-gray-900 to-gpt-green-600 flex items-center justify-center px-4 py-12">
        <div className="max-w-5xl w-full mx-auto">
          <div className="grid md:grid-cols-5 gap-10 items-stretch">
            <div className="md:col-span-2 text-white space-y-6">
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm text-xs uppercase tracking-wide">
                <span className="h-2 w-2 rounded-full bg-emerald-400 mr-2 animate-pulse" />
                We usually respond within 24 hours
              </div>
              <h1 className="text-4xl md:text-5xl font-semibold leading-tight">
                Let&apos;s talk about
                <span className="block text-emerald-300 mt-1">your next big patent.</span>
              </h1>
              <p className="text-gpt-gray-100/80 text-sm md:text-base">
                Whether you are drafting your first patent, exploring our Idea Bank, or validating novelty, we are here
                to help you move faster and with more confidence.
              </p>
              <div className="space-y-3 text-sm text-gpt-gray-100/90">
                <div className="flex items-center space-x-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/20 text-emerald-300 text-lg">
                    1
                  </span>
                  <p>Share what you are working on and how we can help.</p>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/20 text-emerald-300 text-lg">
                    2
                  </span>
                  <p>Our team reviews your request and routes it to the right expert.</p>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/20 text-emerald-300 text-lg">
                    3
                  </span>
                  <p>You receive a thoughtful response with next steps.</p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 text-xs md:text-sm">
                <div className="rounded-xl border border-white/15 bg-white/5 backdrop-blur-sm p-4">
                  <p className="text-gpt-gray-100/70 mb-1">For quick questions</p>
                  <p className="font-medium text-white">Ideal for trying out PatentNest.ai</p>
                </div>
                <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 backdrop-blur-sm p-4">
                  <p className="text-gpt-gray-100/70 mb-1">Deeper collaboration</p>
                  <p className="font-medium text-white">Tell us about your portfolio or team.</p>
                </div>
              </div>
            </div>

            <div
              className={`md:col-span-3 bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-gpt-gray-200/80 p-6 md:p-8 transform transition-all duration-300 ${
                isShaking ? 'animate-[shake_0.5s_ease-in-out]' : 'hover:-translate-y-1 hover:shadow-[0_25px_60px_rgba(15,23,42,0.35)]'
              }`}
            >
              <style jsx>{`
                @keyframes shake {
                  0%,
                  100% {
                    transform: translateX(0);
                  }
                  20% {
                    transform: translateX(-4px);
                  }
                  40% {
                    transform: translateX(4px);
                  }
                  60% {
                    transform: translateX(-2px);
                  }
                  80% {
                    transform: translateX(2px);
                  }
                }
              `}</style>

              <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-gpt-blue-600 mb-1">
                  Contact PatentNest.ai
                </p>
                <h2 className="text-2xl font-semibold text-gpt-gray-900 mb-2">Tell us how we can help</h2>
                <p className="text-sm text-gpt-gray-500">
                  Fill in the form below and we&apos;ll email you back at the address you provide.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gpt-gray-700 mb-1" htmlFor="name">
                      Full name
                    </label>
                    <input
                      id="name"
                      type="text"
                      required
                      value={formState.name}
                      onChange={handleChange('name')}
                      className="block w-full rounded-lg border border-gpt-gray-200 px-3 py-2 text-sm shadow-sm focus:border-gpt-blue-500 focus:ring-2 focus:ring-gpt-blue-500/50 outline-none transition"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gpt-gray-700 mb-1" htmlFor="email">
                      Email address
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={formState.email}
                      onChange={handleChange('email')}
                      className="block w-full rounded-lg border border-gpt-gray-200 px-3 py-2 text-sm shadow-sm focus:border-gpt-blue-500 focus:ring-2 focus:ring-gpt-blue-500/50 outline-none transition"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gpt-gray-700 mb-1" htmlFor="phone">
                      Phone number (optional)
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      value={formState.phone}
                      onChange={handleChange('phone')}
                      className="block w-full rounded-lg border border-gpt-gray-200 px-3 py-2 text-sm shadow-sm focus:border-gpt-blue-500 focus:ring-2 focus:ring-gpt-blue-500/50 outline-none transition"
                      placeholder="+1 555 000 1234"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gpt-gray-700 mb-1" htmlFor="topic">
                      What do you want to talk about?
                    </label>
                    <select
                      id="topic"
                      value={formState.topic}
                      onChange={handleChange('topic')}
                      className="block w-full rounded-lg border border-gpt-gray-200 px-3 py-2 text-sm shadow-sm focus:border-gpt-blue-500 focus:ring-2 focus:ring-gpt-blue-500/50 outline-none transition bg-white"
                    >
                      {topics.map(option => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gpt-gray-700 mb-1" htmlFor="message">
                    How can we help?
                  </label>
                  <textarea
                    id="message"
                    rows={5}
                    value={formState.message}
                    onChange={handleChange('message')}
                    className="block w-full rounded-lg border border-gpt-gray-200 px-3 py-2 text-sm shadow-sm focus:border-gpt-blue-500 focus:ring-2 focus:ring-gpt-blue-500/50 outline-none transition resize-none"
                    placeholder="Share a bit about your invention, your current workflow, or the problem you’re trying to solve."
                  />
                  <p className="mt-1 text-xs text-gpt-gray-500">
                    Please do not share confidential or privileged information. Describe your needs at a high level.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border border-gpt-gray-200 bg-gpt-gray-50 px-3 py-2">
                    <div
                      className="g-recaptcha"
                      data-sitekey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
                      data-callback="onContactRecaptchaSuccess"
                    />
                  </div>
                  <p className="text-[11px] text-gpt-gray-500">
                    This site is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply.
                  </p>
                </div>

                {errorMessage && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {errorMessage}
                  </div>
                )}
                {successMessage && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    {successMessage}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <p className="text-[11px] text-gpt-gray-500">
                    By submitting this form you consent to being contacted about PatentNest.ai.
                  </p>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center justify-center rounded-lg bg-gpt-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md hover:bg-gpt-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gpt-blue-500 disabled:opacity-60 disabled:cursor-not-allowed transition"
                  >
                    {isSubmitting ? 'Sending...' : 'Send message'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}


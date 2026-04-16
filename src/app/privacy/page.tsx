import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy | PatentNest.ai',
  description: 'Privacy Policy for PatentNest.ai',
}

export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy – PatentNest.ai</h1>
        <p className="text-gray-700">
          Operated by <span className="font-semibold">Worldwide Services</span>
        </p>
        <p className="text-gray-700 mt-2">
          Last updated:{' '}
          <span className="italic">[DD Month YYYY]</span>
        </p>
        <p className="text-gray-700 mt-4">
          This Privacy Policy explains how <span className="font-semibold">Worldwide Services</span> (
          <span className="italic">“Worldwide Services”</span>, <span className="italic">“PatentNest.ai”</span>,{' '}
          <span className="italic">“we”</span>, <span className="italic">“us”</span>, or <span className="italic">“our”</span>
          ) collects, uses, shares, and protects your information when you use our website, web application, and related
          services (collectively, the <span className="italic">“Services”</span>).
        </p>
        <p className="text-gray-700 mt-4">
          By accessing or using the Services, you acknowledge that you have read and understood this Privacy Policy. If
          you do not agree, please do not use the Services.
        </p>
        <p className="text-gray-700 mt-4">
          This Privacy Policy describes how we handle your data, including your patent-related data. Our separate{' '}
          <Link href="/terms" className="text-ai-blue-600 hover:underline">
            Terms of Service / Usage Policy
          </Link>{' '}
          explains the rules for using the Service, our disclaimers, and limitations of liability.
        </p>
      </header>

      <div className="mb-10 border-b border-gray-200">
        <nav className="-mb-px flex gap-8 text-sm">
          <Link
            href="/terms"
            className="border-b-2 border-transparent text-gray-500 hover:text-gray-700 pb-2 font-medium"
          >
            Terms of Service
          </Link>
          <Link
            href="/privacy"
            className="border-b-2 border-ai-blue-500 text-ai-blue-600 pb-2 font-medium"
          >
            Privacy Policy
          </Link>
        </nav>
      </div>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">1. Who We Are and Contact Details</h2>
        <p className="text-gray-700 mb-3">
          <span className="font-semibold">Service Name:</span> PatentNest.ai
          <br />
          <span className="font-semibold">Operating Entity:</span> Worldwide Services
        </p>
        <p className="text-gray-700 mb-3">
          <span className="font-semibold">Registered / Postal Address (Worldwide Services):</span>
          <br />
          Flat/Door/Block No. 00, MALOUT ROAD
          <br />
          Village/Town: MUKTSAR, Block: 00
          <br />
          Road/Street/Lane: NEAR TAJ PALACE
          <br />
          City: SRI MUKTSAR SAHIB
          <br />
          District: SRI MUKTSAR SAHIB
          <br />
          State: PUNJAB, India – PIN 152026
          <br />
          Mobile: +91-96462-22123
          <br />
          Email:{' '}
          <a href="mailto:jaspreetmaan611@gmail.com" className="text-ai-blue-600 hover:underline">
            jaspreetmaan611@gmail.com
          </a>
        </p>
        <p className="text-gray-700">
          <span className="font-semibold">Primary Privacy Contact:</span> Dr. Ramandeep Singh, Professor, Lovely
          Professional University –{' '}
          <a href="mailto:ramankhosa@gmail.com" className="text-ai-blue-600 hover:underline">
            ramankhosa@gmail.com
          </a>{' '}
          / +91-98158-99804.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
        <p className="text-gray-700 mb-3">
          We collect information you provide to us, information from social login providers, and information collected
          automatically when you use the Services.
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700">
          <li>
            <span className="font-semibold">Account details</span> – name, email, password (if you use email/password),
            role, organisation, country/region, and preferences.
          </li>
          <li>
            <span className="font-semibold">Professional profile (optional)</span> – job title, areas of expertise,
            biography, links to professional profiles (e.g., LinkedIn).
          </li>
          <li>
            <span className="font-semibold">User Content and Patent Data</span> – invention descriptions, disclosure
            forms, draft specifications and claims, figures and diagrams, prior-art search queries and notes, and other
            patent-related material you upload or create within the Service.
          </li>
          <li>
            <span className="font-semibold">Social login data</span> – basic profile information from Google, LinkedIn
            or similar providers (e.g., name, email, avatar, public profile URL), depending on the permissions you
            grant. We never receive your social account password.
          </li>
          <li>
            <span className="font-semibold">Usage and device data</span> – IP address, browser and device type,
            operating system, pages visited, features used, error logs, and similar diagnostic data.
          </li>
          <li>
            <span className="font-semibold">Cookies and similar technologies</span> – used to keep you signed in, store
            preferences, improve performance, and enhance security.
          </li>
          <li>
            <span className="font-semibold">Billing and payment data (if applicable)</span> – limited billing metadata
            from payment processors (e.g., transaction ID, last four digits of card, plan details). We do not store full
            payment card numbers.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">3. How We Use Your Information</h2>
        <p className="text-gray-700 mb-3">We use your information to:</p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>Create and manage your account and authentication sessions</li>
          <li>Provide patent ideation, drafting, analysis, and export features</li>
          <li>Store, display, and back up your documents and projects</li>
          <li>Monitor performance, troubleshoot issues, and improve the Service</li>
          <li>Detect and prevent fraud, abuse, or security incidents</li>
          <li>
            Communicate with you about the Service, including support responses, updates, and changes to terms or
            policies
          </li>
          <li>Comply with legal, regulatory, and tax obligations</li>
        </ul>
        <p className="text-gray-700">
          Where required by law (e.g., GDPR/UK GDPR), we rely on performance of a contract, our legitimate interests,
          your consent (for certain cookies/marketing), and legal obligations as the main legal bases for processing.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">4. User Content, Patent Data, and AI</h2>
        <p className="text-gray-700 mb-3">
          You remain the owner of your User Content, including your inventions and Patent Data. We process this content
          only to provide and improve the Service, to support you when requested, and to maintain security and
          reliability.
        </p>
        <p className="text-gray-700 mb-3">
          PatentNest.ai relies on AI models to assist with drafting, analysis, and formatting. We may use third-party AI
          providers under strict contractual safeguards. Unless we clearly state otherwise and obtain your explicit
          consent, we will not allow external foundation model providers to use your Patent Data to train their general
          models for other customers.
        </p>
        <p className="text-gray-700">
          We may use aggregated, de-identified statistics (for example, generic usage patterns or error rates) to
          improve the Service. These do not identify you or your specific Patent Data. You are responsible for ensuring
          that you are permitted to upload Patent Data (for example, under any NDAs or client obligations) and for
          managing access and sharing within your team.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">5. How We Share Your Information</h2>
        <p className="text-gray-700 mb-3">
          We do not sell your personal data. We may share information with:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>
            <span className="font-semibold">Service providers</span> – hosting, infrastructure, storage, analytics,
            email and notification providers, identity providers (e.g., Google, LinkedIn), and payment processors.
          </li>
          <li>
            <span className="font-semibold">Legal and safety</span> – where required by law, regulation, or court order,
            or to protect our rights, our users, or the public.
          </li>
          <li>
            <span className="font-semibold">Business transfers</span> – in connection with a merger, acquisition,
            financing, or sale of all or part of our business, under appropriate confidentiality protections.
          </li>
          <li>
            <span className="font-semibold">With your consent</span> – where you explicitly authorize sharing (for
            example, with an integration or partner).
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">6. International Data Transfers</h2>
        <p className="text-gray-700">
          Your information may be processed in countries outside your own. Where required, we use safeguards such as
          contractual clauses, encryption, and access controls to protect your data. By using the Services, you
          understand that your data may be transferred to and processed in these locations.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">7. Data Retention</h2>
        <p className="text-gray-700">
          We retain data for as long as necessary to provide and maintain the Services, fulfil the purposes described in
          this Policy, comply with legal and accounting obligations, and resolve disputes. If you close your account, we
          will delete or anonymize your personal data within a reasonable period, except where we must retain certain
          information for legal or security reasons.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">8. Security</h2>
        <p className="text-gray-700 mb-3">
          We use reasonable technical and organizational measures to protect your information, including encryption in
          transit, access controls, logging, backups, and monitoring. However, no system is fully secure.
        </p>
        <p className="text-gray-700">
          You are responsible for using strong passwords, keeping your credentials confidential, and signing out from
          shared devices. If you suspect unauthorized access, please contact Dr. Ramandeep Singh at{' '}
          <a href="mailto:ramankhosa@gmail.com" className="text-ai-blue-600 hover:underline">
            ramankhosa@gmail.com
          </a>{' '}
          or +91-98158-99804 as soon as possible.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">9. Your Rights and Choices</h2>
        <p className="text-gray-700 mb-3">
          Depending on your jurisdiction, you may have rights to access, correct, or delete your personal data; restrict
          or object to certain processing; receive a copy in a portable format; and withdraw consent where processing is
          based on consent.
        </p>
        <p className="text-gray-700 mb-3">
          To exercise these rights, please contact us at{' '}
          <a href="mailto:ramankhosa@gmail.com" className="text-ai-blue-600 hover:underline">
            ramankhosa@gmail.com
          </a>{' '}
          and/or{' '}
          <a href="mailto:jaspreetmaan611@gmail.com" className="text-ai-blue-600 hover:underline">
            jaspreetmaan611@gmail.com
          </a>
          . We may need to verify your identity before responding.
        </p>
        <p className="text-gray-700">
          You may also have the right to complain to your local data protection authority, where applicable.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">10. Children’s Privacy</h2>
        <p className="text-gray-700">
          Our Services are intended for adults and professionals. We do not knowingly collect personal data from
          children below the age of majority in their jurisdiction without appropriate consent. If you believe a child
          has provided us with personal data, please contact us so we can take appropriate action.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">11. Third-Party Services and Links</h2>
        <p className="text-gray-700 mb-3">
          Our Services may link to or integrate with third-party services (such as social networks, cloud storage,
          payment gateways, or patent databases). Those services are governed by their own privacy policies and terms.
        </p>
        <p className="text-gray-700">
          We do not control and are not responsible for how those third parties process your information. We encourage
          you to review their policies before using or connecting those services.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">
          12. Limitation of Responsibility for User Actions
        </h2>
        <p className="text-gray-700 mb-3">
          While we take reasonable measures to protect your information and Patent Data:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>
            We are not responsible for what you or other users do with information or documents generated or exported
            from PatentNest.ai.
          </li>
          <li>
            We are not responsible for misuse, copying, or unauthorized sharing of your content by other users or third
            parties you choose to involve.
          </li>
          <li>
            You are solely responsible for verifying AI-generated outputs and obtaining independent professional advice
            before relying on them.
          </li>
        </ul>
        <p className="text-gray-700">
          For more detail on limitations of liability, indemnification, and disclaimers, please refer to our{' '}
          <Link href="/terms" className="text-ai-blue-600 hover:underline">
            Terms of Service / Usage Policy
          </Link>
          .
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">13. Changes to This Privacy Policy</h2>
        <p className="text-gray-700 mb-3">
          We may update this Privacy Policy from time to time. When we do, we will update the “Last updated” date and,
          where appropriate, provide additional notice (e.g., via email or in-app notification).
        </p>
        <p className="text-gray-700">
          Your continued use of the Services after any changes come into effect means you accept the updated Privacy
          Policy.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">14. How to Contact Us</h2>
        <p className="text-gray-700 mb-3">
          If you have questions, concerns, or requests relating to this Privacy Policy or your personal data, please
          contact:
        </p>
        <p className="text-gray-700 mb-2">
          <span className="font-semibold">Primary Privacy Contact</span>
          <br />
          Dr. Ramandeep Singh
          <br />
          Professor, Lovely Professional University
          <br />
          Email:{' '}
          <a href="mailto:ramankhosa@gmail.com" className="text-ai-blue-600 hover:underline">
            ramankhosa@gmail.com
          </a>
          <br />
          Phone: +91-98158-99804
        </p>
        <p className="text-gray-700">
          <span className="font-semibold">Operating Entity</span>
          <br />
          Worldwide Services
          <br />
          Flat/Door/Block No. 00, MALOUT ROAD
          <br />
          Village/Town: MUKTSAR, Block: 00
          <br />
          Road/Street/Lane: NEAR TAJ PALACE
          <br />
          City: SRI MUKTSAR SAHIB
          <br />
          District: SRI MUKTSAR SAHIB
          <br />
          State: PUNJAB, India – PIN 152026
          <br />
          Mobile: +91-96462-22123
          <br />
          Email:{' '}
          <a href="mailto:jaspreetmaan611@gmail.com" className="text-ai-blue-600 hover:underline">
            jaspreetmaan611@gmail.com
          </a>
        </p>
      </section>
    </main>
  )
}

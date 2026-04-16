import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service | PatentNest.ai',
  description: 'Terms of Service and usage policy for PatentNest.ai',
}

export default function TermsOfServicePage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service / Usage Policy – PatentNest.ai</h1>
        <p className="text-gray-700">
          Operated by <span className="font-semibold">Worldwide Services</span>
        </p>
        <p className="text-gray-700 mt-2">
          Effective date:{' '}
          <span className="italic">[Insert date]</span>
        </p>
        <p className="text-gray-700 mt-4">
          These Terms of Service (<span className="italic">“Terms”</span>) govern your access to and use of the
          PatentNest.ai website, web application, and related services (collectively, the{' '}
          <span className="italic">“Service”</span>). By accessing or using the Service, you agree to be bound by these
          Terms. If you do not agree, you must not use the Service.
        </p>
        <p className="text-gray-700 mt-4">
          The Service and all outputs (including AI-generated content) are provided for informational and research
          purposes only. They do not constitute legal, professional, or financial advice, do not create an
          attorney–client relationship, and do not guarantee novelty, patentability, freedom-to-operate, validity,
          enforceability, or any other legal or business outcome.
        </p>
      </header>

      <div className="mb-10 border-b border-gray-200">
        <nav className="-mb-px flex gap-8 text-sm">
          <Link
            href="/terms"
            className="border-b-2 border-ai-blue-500 text-ai-blue-600 pb-2 font-medium"
          >
            Terms of Service
          </Link>
          <Link
            href="/privacy"
            className="border-b-2 border-transparent text-gray-500 hover:text-gray-700 pb-2 font-medium"
          >
            Privacy Policy
          </Link>
        </nav>
      </div>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">1. Description of the Service</h2>
        <p className="text-gray-700">
          PatentNest.ai is an AI-powered platform operated by Worldwide Services that assists with patent-related
          activities, including but not limited to:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mt-3">
          <li>Patent idea exploration and structuring</li>
          <li>Novelty and prior-art analysis support</li>
          <li>Drafting assistance for specifications, claims, and other patent documents</li>
          <li>Patent figures and sketch generation support</li>
          <li>Multi-jurisdiction formatting and export tools</li>
        </ul>
        <p className="text-gray-700 mt-4">
          The Service and all outputs (including AI-generated content) are provided{' '}
          <span className="font-semibold">for informational and research purposes only</span>. They:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mt-3">
          <li>Do not constitute legal, professional, or financial advice</li>
          <li>Do not create an attorney–client relationship</li>
          <li>
            Do not guarantee novelty, patentability, freedom-to-operate, validity, enforceability, or any other legal or
            business outcome
          </li>
        </ul>
        <p className="text-gray-700 mt-4">
          You are solely responsible for obtaining independent professional advice and for verifying any outputs before
          relying on them.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">2. Eligibility and Accounts</h2>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>
            You represent that you are at least the age of majority in your jurisdiction and have legal capacity to
            enter into these Terms.
          </li>
          <li>
            If you use the Service on behalf of an organization (such as a firm, company, or university), you represent
            that you have authority to bind that organization to these Terms.
          </li>
        </ul>
        <p className="text-gray-700 mb-3">
          You may need to create an account to use certain features. You agree to:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700">
          <li>Provide accurate, current, and complete registration information</li>
          <li>Keep your information updated</li>
          <li>Maintain the confidentiality of your login credentials</li>
          <li>Accept responsibility for all activities that occur under your account</li>
        </ul>
        <p className="text-gray-700 mt-3">
          If you believe your account has been compromised, you must notify us promptly using the contact details at the
          end of these Terms.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">3. User Content and Patent Data</h2>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">3.1 Ownership</h3>
        <p className="text-gray-700 mb-3">
          “User Content” means any data, text, documents, files, patent numbers, drawings, comments, and other materials
          that you upload, submit, or create using the Service, including{' '}
          <span className="font-semibold">Patent Data</span> as defined in the Privacy Policy.
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>
            You retain ownership of your User Content, including all underlying inventions, patent rights, and
            intellectual property that you own under applicable law.
          </li>
          <li>Nothing in these Terms transfers ownership of your patents or inventions to Worldwide Services.</li>
        </ul>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">3.2 License to Use User Content</h3>
        <p className="text-gray-700 mb-3">
          To operate the Service, you grant Worldwide Services a worldwide, non-exclusive, royalty-free license to:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>Use, reproduce, host, process, transmit, and display your User Content</li>
          <li>Generate AI-based outputs derived from your User Content</li>
          <li>Maintain backups and perform technical operations</li>
          <li>Improve the Service as described in the Privacy Policy</li>
        </ul>
        <p className="text-gray-700 mb-3">
          This license is limited to what is necessary to operate, maintain, and improve the Service, and to comply with
          legal obligations.
        </p>
        <p className="text-gray-700">
          You represent and warrant that (a) you have all necessary rights to submit the User Content and grant this
          license, and (b) your User Content does not infringe any third-party rights or violate any applicable laws.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">4. Acceptable Use</h2>
        <p className="text-gray-700 mb-3">You agree that you will not:</p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700">
          <li>Use the Service for any unlawful, harmful, fraudulent, infringing, or misleading purpose.</li>
          <li>
            Upload or transmit any content that is illegal, obscene, defamatory, harassing, threatening, or otherwise
            objectionable.
          </li>
          <li>
            Attempt to gain unauthorized access to the Service, other users’ accounts, or related systems, or attempt to
            bypass security features.
          </li>
          <li>
            Reverse engineer, decompile, disassemble, or attempt to discover the source code, models, or underlying
            algorithms of the Service, except where permitted by law.
          </li>
          <li>
            Use the Service or its outputs to build, train, or improve a competing product or service without our prior
            written consent.
          </li>
          <li>
            Interfere with or disrupt the integrity, performance, or availability of the Service, including by
            introducing viruses, malware, or harmful code.
          </li>
          <li>Misrepresent your identity or affiliation with any person or entity.</li>
          <li>
            Use the Service to process content that you are not legally allowed to disclose (for example, in breach of
            NDAs or confidentiality obligations) without obtaining all necessary permissions.
          </li>
        </ul>
        <p className="text-gray-700 mt-3">
          We may suspend or terminate your access if we reasonably believe you have violated this section.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">5. Social Login and Third-Party Services</h2>
        <p className="text-gray-700 mb-3">
          You may choose to sign up or sign in using third-party services, such as Google or LinkedIn. Your use of those
          services is governed by their own terms and privacy policies, and we do not control or accept responsibility
          for those third-party services.
        </p>
        <p className="text-gray-700 mb-3">
          We are not responsible if a third-party provider suffers a breach or misuse that affects your data within that
          provider’s systems.
        </p>
        <p className="text-gray-700">
          The Service may also integrate with or link to third-party tools (for example, cloud storage, patent
          databases, payment gateways). You are solely responsible for ensuring such use complies with your obligations
          to clients, employers, or partners, reviewing third-party terms and privacy policies, and managing any data
          you choose to send to or receive from those third-party services.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">6. Intellectual Property in the Service</h2>
        <p className="text-gray-700 mb-3">
          All rights, title, and interest in and to the Service—including software, user interface, designs, text,
          graphics, logos, AI models, and underlying technology—are owned by Worldwide Services or its licensors.
        </p>
        <p className="text-gray-700 mb-3">
          Except as expressly permitted by these Terms or as allowed by applicable law, you may not:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>Copy, modify, distribute, sell, lease, or create derivative works based on the Service</li>
          <li>Remove or alter any proprietary notices or trademarks</li>
        </ul>
        <p className="text-gray-700">
          Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable,
          revocable license to access and use the Service for your internal business or personal purposes.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">7. Outputs Generated by the Service</h2>
        <p className="text-gray-700 mb-3">
          The Service may generate outputs based on your inputs, including text, analyses, drafts, figures, and
          suggestions (<span className="italic">“Outputs”</span>).
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>
            Subject to these Terms and applicable law, you may use Outputs for your internal business or personal
            purposes, including further development of your inventions and patent documents.
          </li>
          <li>We do not claim ownership of your inventions or patents merely because our AI assisted you.</li>
        </ul>
        <p className="text-gray-700 mb-3">
          However, Outputs may be imperfect, incomplete, inaccurate, or based on probabilistic patterns, and may
          unintentionally resemble existing content due to the nature of machine learning models.
        </p>
        <p className="text-gray-700">
          You are solely responsible for reviewing, verifying, and editing all Outputs and for ensuring they are
          suitable and lawful for your use. Outputs do not constitute legal advice, opinion, or guarantee of any kind.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">8. No Legal Advice or Guarantees</h2>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>PatentNest.ai and Worldwide Services are not a law firm and do not provide legal representation.</li>
          <li>Use of the Service does not create an attorney–client relationship.</li>
          <li>
            The Service does not guarantee novelty, patentability, validity, enforceability, or freedom-to-operate for
            any invention or patent.
          </li>
        </ul>
        <p className="text-gray-700">
          Any decision to file, prosecute, or enforce a patent (or to rely on any result or recommendation) is your own
          decision and at your own risk. You must seek independent advice from qualified professionals (for example,
          patent attorneys) before relying on any information or Outputs when making legal or business decisions.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">9. Fees, Billing, and Refund Policy</h2>
        <p className="text-gray-700 mb-3">
          If certain features require payment (<span className="italic">“Fees”</span>):
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>Fees, billing periods, and payment terms will be presented at the time of purchase or in your account.</li>
          <li>You authorize us or our payment providers to charge your chosen payment method for all applicable Fees and taxes.</li>
          <li>Subscriptions may automatically renew at the end of each billing period unless you cancel prior to renewal.</li>
        </ul>
        <p className="text-gray-700 mb-3">
          Except where required by law or expressly stated otherwise:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>All Fees are non-refundable and non-cancellable once the billing period has started or credits have been used.</li>
          <li>
            We may, in our sole discretion, issue refunds or credits in limited cases (for example, extended downtime
            caused by us). Any such decision is voluntary and does not entitle you to future refunds.
          </li>
        </ul>
        <p className="text-gray-700">
          Mandatory consumer protection rights in your jurisdiction (such as cooling-off periods) will apply where
          required.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">10. Termination and Suspension</h2>
        <p className="text-gray-700 mb-3">
          You may stop using the Service at any time. You may also request account closure in accordance with our
          processes.
        </p>
        <p className="text-gray-700 mb-3">
          We may suspend or terminate your access to the Service, in whole or in part, with or without notice if:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>We reasonably believe you have violated these Terms or our policies.</li>
          <li>Your use poses a risk to the Service, our infrastructure, other users, or the public.</li>
          <li>We are required to do so by law, regulation, or an order from a competent authority.</li>
          <li>We discontinue the Service for business or technical reasons.</li>
        </ul>
        <p className="text-gray-700 mb-3">
          Upon termination, your right to access and use the Service ceases immediately. Certain provisions of these
          Terms will survive (including those relating to intellectual property, disclaimers, limitations of liability,
          indemnification, and dispute resolution).
        </p>
        <p className="text-gray-700">
          We will handle your data after termination in accordance with our Privacy Policy.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">11. Disclaimers</h2>
        <p className="text-gray-700 mb-3">
          To the maximum extent permitted by law, the Service is provided on an <span className="font-semibold">“AS IS”</span>{' '}
          and <span className="font-semibold">“AS AVAILABLE”</span> basis.
        </p>
        <p className="text-gray-700 mb-3">
          We disclaim all warranties, express, implied, or statutory, including implied warranties of merchantability,
          fitness for a particular purpose, non-infringement, and any warranties arising from course of dealing or
          usage of trade.
        </p>
        <p className="text-gray-700">
          We do not warrant that (a) the Service will be uninterrupted, error-free, secure, or free from harmful
          components; (b) any errors or defects will be corrected; or (c) any Outputs or results are accurate, complete,
          reliable, or suitable for your intended use. You use the Service at your own risk.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">12. Limitation of Liability</h2>
        <p className="text-gray-700 mb-3">
          To the maximum extent permitted by law, Worldwide Services, PatentNest.ai, and their affiliates, officers,
          employees, agents, and licensors are not liable for any indirect, incidental, consequential, special,
          exemplary, or punitive damages, or for any loss of profits, revenues, data, goodwill, or business
          opportunities arising out of or related to the Service or these Terms.
        </p>
        <p className="text-gray-700">
          Our total aggregate liability for all claims arising out of or related to the Service or these Terms shall not
          exceed the greater of (1) the amount you paid to us for the Service during the three (3) months immediately
          preceding the event giving rise to the claim, or (2){' '}
          <span className="font-semibold">INR [insert fixed cap, e.g., 25,000]</span>. Some jurisdictions do not allow
          certain limitations, so some of the above may not apply to you. In such cases, the limitations apply only to
          the extent permitted by law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">13. Indemnification</h2>
        <p className="text-gray-700 mb-3">
          You agree to indemnify, defend, and hold harmless Worldwide Services, PatentNest.ai, and their affiliates,
          officers, employees, and agents from and against any claims, liabilities, damages, losses, and expenses
          (including reasonable attorneys’ fees) arising out of or in connection with:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700">
          <li>Your use of the Service or Outputs</li>
          <li>Your User Content (including Patent Data)</li>
          <li>Your violation of these Terms or any applicable law or regulation</li>
          <li>Your violation of any third-party rights (including IP, confidentiality, or privacy rights)</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">14. Governing Law and Dispute Resolution</h2>
        <p className="text-gray-700 mb-3">
          Unless mandatory law in your jurisdiction requires otherwise:
        </p>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-3">
          <li>
            These Terms and any dispute arising out of or relating to them or the Service shall be governed by the laws
            of <span className="font-semibold">India</span>, without regard to its conflict of law principles.
          </li>
          <li>
            The courts located in <span className="font-semibold">Sri Muktsar Sahib, Punjab, India</span> shall have
            exclusive jurisdiction over such disputes, and you consent to personal jurisdiction in those courts.
          </li>
        </ul>
        <p className="text-gray-700">
          If mandatory consumer protection or other laws in your jurisdiction require a different governing law or
          forum, those requirements will apply as necessary.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">15. Changes to These Terms</h2>
        <p className="text-gray-700">
          We may modify these Terms from time to time. When we do, we will update the “Effective date” at the top of
          this document and may provide additional notice (for example, by email or in-app notification) if the changes
          are material. Your continued use of the Service after the updated Terms become effective constitutes your
          acceptance of those changes. If you do not agree, you must stop using the Service.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-gray-900 mb-3">16. Contact Information</h2>
        <p className="text-gray-700 mb-3">
          If you have questions about these Terms or the Service, please contact:
        </p>
        <p className="text-gray-700 mb-2">
          <span className="font-semibold">Primary Contact Person</span>
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

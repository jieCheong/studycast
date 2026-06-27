import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="px-6 py-4 max-w-3xl mx-auto">
        <Link to="/" className="text-xl font-bold font-['Space_Grotesk'] tracking-tight">
          StudyCast<span className="text-primary">AI</span>
        </Link>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-8 prose prose-neutral dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p className="text-muted-foreground">Last updated: June 26, 2026</p>

        <p>
          StudyCast AI ("we," "our," or "the app") converts study materials into audio content.
          This Privacy Policy explains what information we collect, how we use it, and your rights
          regarding that information.
        </p>

        <h2>Information We Collect</h2>

        <h3>Account Information</h3>
        <p>
          When you create an account, we collect your email address and a securely hashed version
          of your password. We never store your password in plain text.
        </p>

        <h3>Content You Provide</h3>
        <ul>
          <li>Files you upload (PDF, PPTX, DOCX, video files)</li>
          <li>YouTube URLs you submit</li>
          <li>Questions you ask about your uploaded materials</li>
        </ul>

        <h3>Generated Content</h3>
        <ul>
          <li>Text extracted from your uploaded materials</li>
          <li>AI-generated scripts and audio files created from your materials</li>
        </ul>

        <h2>How We Use Your Information</h2>
        <p>We use the information you provide solely to:</p>
        <ul>
          <li>Authenticate your account and maintain your session</li>
          <li>Process your uploaded materials to generate audio content</li>
          <li>Answer questions you ask about your uploaded materials</li>
          <li>Track usage against free-tier generation limits</li>
          <li>Display your generation history to you</li>
        </ul>

        <h2>Third-Party Services</h2>
        <p>
          To provide our service, we send your content to the following third-party providers for
          processing:
        </p>
        <ul>
          <li>
            <strong>OpenAI</strong> — for generating scripts (GPT-4o-mini), converting text to
            speech (TTS), transcribing video/audio (Whisper), and generating embeddings for search
          </li>
        </ul>
        <p>
          These providers process your content according to their own privacy policies and terms of
          service. We do not control how these third parties handle data beyond the specific request
          we send them.
        </p>

        <h2>Data Storage</h2>
        <p>Your account information and generated content are stored using:</p>
        <ul>
          <li>Neon (PostgreSQL database hosting)</li>
          <li>AWS S3 (file storage for uploaded materials and generated audio)</li>
        </ul>

        <h2>Data We Do Not Collect</h2>
        <p>
          We do not use advertising networks, third-party analytics or tracking services, and we do
          not sell or share your personal information with third parties for marketing purposes.
        </p>

        <h2>Data Retention and Deletion</h2>
        <p>
          Your uploaded materials, generated content, and account information are retained as long
          as your account remains active. To request deletion of your account and associated data,
          contact us at the email address below.
        </p>

        <h2>Children's Privacy</h2>
        <p>
          StudyCast AI is not directed at children under 13, and we do not knowingly collect
          personal information from children under 13.
        </p>

        <h2>Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Continued use of the app after
          changes are posted constitutes acceptance of the updated policy.
        </p>

        <h2>Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or wish to request data deletion, contact
          us at:{" "}
          <a href="mailto:cheongjie05@gmail.com">cheongjie05@gmail.com</a>
        </p>
      </main>
    </div>
  );
}

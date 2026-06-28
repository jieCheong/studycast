import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen">
      <nav className="flex items-center px-6 py-4 max-w-3xl mx-auto">
        <Link to="/">
          <span className="text-xl font-bold font-['Space_Grotesk'] tracking-tight">
            StudyCast<span className="text-primary">AI</span>
          </span>
        </Link>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <Link to="/">
          <Button variant="ghost" size="sm" className="gap-2 mb-6">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Button>
        </Link>

        <Card>
          <CardContent className="pt-8 pb-10 px-8 space-y-8">
            <div>
              <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
              <p className="text-sm text-muted-foreground">Last updated: June 26, 2026</p>
            </div>

            <p className="text-muted-foreground leading-relaxed">
              StudyCast AI ("we," "our," or "the app") converts study materials into audio
              content. This Privacy Policy explains what information we collect, how we use it,
              and your rights regarding that information.
            </p>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Information We Collect</h2>
              <div>
                <h3 className="font-medium mb-1">Account Information</h3>
                <p className="text-muted-foreground leading-relaxed">
                  When you create an account, we collect your email address and a securely
                  hashed version of your password. We never store your password in plain text.
                </p>
              </div>
              <div>
                <h3 className="font-medium mb-1">Content You Provide</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>Files you upload (PDF, PPTX, DOCX, video files)</li>
                  <li>YouTube URLs you submit</li>
                  <li>Questions you ask about your uploaded materials</li>
                </ul>
              </div>
              <div>
                <h3 className="font-medium mb-1">Generated Content</h3>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>Text extracted from your uploaded materials</li>
                  <li>AI-generated scripts and audio files created from your materials</li>
                </ul>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold">How We Use Your Information</h2>
              <p className="text-muted-foreground leading-relaxed">We use the information you provide solely to:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Authenticate your account and maintain your session</li>
                <li>Process your uploaded materials to generate audio content</li>
                <li>Answer questions you ask about your uploaded materials</li>
                <li>Track usage against free-tier generation limits</li>
                <li>Display your generation history to you</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Third-Party Services</h2>
              <p className="text-muted-foreground leading-relaxed">
                To provide our service, we send your content to the following third-party
                providers for processing:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li><span className="font-medium text-foreground">Google Gemini</span> — for extracting text from uploaded documents</li>
                <li><span className="font-medium text-foreground">OpenAI</span> — for generating scripts (GPT-4o-mini), converting text to speech (TTS), transcribing video/audio (Whisper), and generating embeddings for search</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                These providers process your content according to their own privacy policies and
                terms of service. We do not control how these third parties handle data beyond
                the specific request we send them.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Data Storage</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your account information and generated content are stored using:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li><span className="font-medium text-foreground">Neon</span> (PostgreSQL database hosting)</li>
                <li><span className="font-medium text-foreground">AWS S3</span> (file storage for uploaded materials and generated audio)</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Data We Do Not Collect</h2>
              <p className="text-muted-foreground leading-relaxed">
                We do not use advertising networks, third-party analytics or tracking services,
                and we do not sell or share your personal information with third parties for
                marketing purposes.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Data Retention and Deletion</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your uploaded materials, generated content, and account information are retained
                as long as your account remains active. To request deletion of your account and
                associated data, contact us at the email address below.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Children's Privacy</h2>
              <p className="text-muted-foreground leading-relaxed">
                StudyCast AI is not directed at children under 13, and we do not knowingly
                collect personal information from children under 13.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Changes to This Policy</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may update this Privacy Policy from time to time. Continued use of the app
                after changes are posted constitutes acceptance of the updated policy.
              </p>
            </section>

            <section className="space-y-3 pt-4 border-t border-border">
              <h2 className="text-xl font-semibold">Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed">
                If you have questions about this Privacy Policy or wish to request data
                deletion, contact us at:{" "}
                <a href="mailto:testemail07077@gmail.com" className="text-primary hover:underline">
                  testemail07077@gmail.com
                </a>
              </p>
            </section>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
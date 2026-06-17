import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Upload, Settings, Headphones, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";

const steps = [
  { icon: Upload, title: "Upload", desc: "Drop your PDF lecture slides, notes, or textbook chapters." },
  { icon: Settings, title: "Customize", desc: "Choose study mode, language, length, and voice style." },
  { icon: Headphones, title: "Listen", desc: "Get structured audio and learn while walking, commuting, or working out." },
];

export default function Index() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto w-full">
        <span className="text-xl font-bold font-['Space_Grotesk'] tracking-tight">
          StudyCast<span className="text-primary">AI</span>
        </span>
        <Link to={user ? "/dashboard" : "/auth"}>
          <Button size="sm">{user ? "Dashboard" : "Get Started"}</Button>
        </Link>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-3xl text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              AI-powered study reinforcement
            </span>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tight">
              Turn your study materials into{" "}
              <span className="text-primary">podcast-style audio</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
              Upload PDFs, choose your learning style, and get structured audio explanations. Learn while walking, commuting, or working out.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex gap-4 justify-center"
          >
            <Link to={user ? "/dashboard" : "/auth"}>
              <Button size="lg" className="gap-2">
                Start Learning <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-20 bg-card">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.15 }}
                viewport={{ once: true }}
                className="text-center space-y-4"
              >
                <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <step.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">{step.title}</h3>
                <p className="text-muted-foreground text-sm">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} StudyCast AI. Built for students who never stop learning.
      </footer>
    </div>
  );
}
